import {assertFileTransactionId,fileTransactionOutcome} from "../core/file-transactions.js";
import {protectedStateCapability,requireProtectedState} from "../local/protected-state.js";
import { createRequire } from "node:module";
import { connectorStatus } from "../index.js";
import { WorkspaceRegistry } from "../core/workspace.js";
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {enrollReadOnlyBatch,enrollRolesTrustedBatch,revokeTrusted,readTrustedRootBindings,loadTrustedRegistry} from "../local/grants.js";
import {identityDirectory} from "../local/identity.js";
import {ConnectorError,type WorkspaceGrant,type WorkspaceRole} from "../core/contracts.js";
import {plannedTools,plannedToolNames,controlledToolNames} from "./catalog.js";
import {validateWorkflow} from "../core/ci-dag.js";
import {parseCiManifest} from "../core/ci-manifest.js";
import {dispatchFileMutation} from "./write-dispatch.js";
import {batchFileOperations} from "./batch-dispatch.js";
import {CiJournalStore} from "../local/ci-store.js";
import {CiArtifactStore} from "../local/ci-artifacts.js";
import {CiLogStore} from "../local/ci-log-store.js";
import {CiSnapshotStore} from "../local/ci-snapshot-store.js";
import {CiSourceCaptureService,type VerifiedWorkspaceSourceCapture} from "../core/ci-source-capture.js";
import {CiRunService,type VerifiedCiExecutor} from "../core/ci-run-service.js";
import {requireNativeBackend,type NativeScopedFiles,type NativeFileOperation,type VerifiedNativeSandbox,type VerifiedNativeProcessController} from "../core/native-io.js";
import {executeGit} from "../core/git-engine.js";
import {ProcessManager} from "../core/process-manager.js";
import {ControlLeaseError,type ControlLeaseStore} from "../local/control-lease.js";
import {withControlToken,requireCurrentControl} from "./control-context.js";
import {DurableProcessManager} from "../core/durable-process.js";

/** Scoped capability surface; role intent never enables an unavailable native backend. */
export interface ToolCall { name: string; arguments?: Record<string, unknown> }
export interface ToolResult { content: Array<{type:"text";text:string}>; isError?: boolean }
const definitions = [
  {name:"connector_status",description:"Return host capabilities; shell and CI remain blocked",inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"list_workspaces",description:"List explicitly trusted workspaces; does not enroll new ones",inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"get_workspace",description:"Inspect trusted workspace metadata",inputSchema:{type:"object",properties:{workspace_id:{type:"string"}},required:["workspace_id"],additionalProperties:false}},
  {name:"list_directory",description:"Read immediate directory entries in an enrolled workspace or reference",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"}},required:["workspace_id","path"],additionalProperties:false}},
  {name:"bind_workspaces",description:"Select explicit workspace/reference roots on this host, or legacy read-only paths. Roles grant intent; backend availability is reported separately. Never discover extra roots.",inputSchema:{type:"object",properties:{paths:{type:"array",items:{type:"string"},minItems:1,maxItems:16},roots:{type:"array",minItems:1,maxItems:16,items:{type:"object",properties:{path:{type:"string"},role:{type:"string",enum:["workspace","reference"]}},required:["path","role"],additionalProperties:false}}},oneOf:[{required:["paths"],not:{required:["roots"]}},{required:["roots"],not:{required:["paths"]}}],additionalProperties:false}},
  {name:"unbind_workspace",description:"Revoke a previously bound workspace on the selected host; subsequent calls lose the grant",inputSchema:{type:"object",properties:{workspace_id:{type:"string"}},required:["workspace_id"],additionalProperties:false}},
  {name:"get_file_info",description:"Metadata and SHA256 of a file within a bound workspace; max 8 MiB hash",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"}},required:["workspace_id","path"],additionalProperties:false}},
  {name:"search",description:"Search UTF-8 text across bounded files under a workspace-relative directory; no external grep subprocess",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"},query:{type:"string"}},required:["workspace_id","path","query"],additionalProperties:false}},
  {name:"fetch_file",description:"Read UTF-8 text from an enrolled workspace or reference (maximum 64 KiB)",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"},start_line:{type:"integer",minimum:1},max_lines:{type:"integer",minimum:1,maximum:500}},required:["workspace_id","path"],additionalProperties:false}}
] as const;
function validPage(args:Record<string,unknown>,maxLimit:number):boolean{
  return (args.cursor===undefined||(Number.isSafeInteger(args.cursor)&&Number(args.cursor)>=0))&&
    (args.limit===undefined||(Number.isSafeInteger(args.limit)&&Number(args.limit)>=1&&Number(args.limit)<=maxLimit));
}
export function toolDefinitions() {return [...definitions,...plannedTools].map(definition=>({
 ...definition,inputSchema:{...definition.inputSchema,
  properties:{...definition.inputSchema.properties,...(controlledToolNames.has(definition.name)?{control_token:{type:"string"}}:{})},
  required:[...("required" in definition.inputSchema?definition.inputSchema.required:[]),...(controlledToolNames.has(definition.name)?["control_token"]:[])]}
 }));}
export function createReadOnlyTools(registry: WorkspaceRegistry, nativeFiles:NativeScopedFiles|null=null, sandbox:VerifiedNativeSandbox|null=null, ciStore:CiJournalStore|null=null, artifacts:CiArtifactStore|null=null, logs:CiLogStore|null=null, nativeProcesses:VerifiedNativeProcessController|null=null, snapshots:CiSnapshotStore|null=null, sourceCapture:VerifiedWorkspaceSourceCapture|null=null, ciExecutor:VerifiedCiExecutor|null=null, controlStore:ControlLeaseStore|null=null,options:{grantDirectory?:string;fileBlockedReason?:string}={}) {
  const allFileOperations:readonly NativeFileOperation[]=["create_file","update_file","edit_file","apply_patch","create_directory","delete_file","copy_file","move_file"];
  const fileOperations:readonly NativeFileOperation[]=Object.freeze(nativeFiles?allFileOperations.filter(name=>nativeFiles.supportedOperations===undefined||nativeFiles.supportedOperations.includes(name)):[]);
  const fullFileWrites=allFileOperations.every(name=>fileOperations.includes(name));
  const fileTransactionReadbackAvailable=()=>typeof nativeFiles?.recoverableMutations?.readTransaction==="function"&&protectedStateCapability().available&&controlStore!==null;
  const fileCapabilities=()=>({fileTransactionReadbackAvailable:fileTransactionReadbackAvailable(),fileBackendAvailable:!!nativeFiles,fileOperations,hostFileWrites:fullFileWrites,fileBlockedReason:options.fileBlockedReason??(nativeFiles&&!fullFileWrites?"Partial native backend; compare-and-mutate operations remain blocked":nativeFiles?null:"Verified native file installation unavailable")});
  let resolvedGrantDirectory=options.grantDirectory;
  const grantDirectory=()=>resolvedGrantDirectory??(resolvedGrantDirectory=identityDirectory());
  let scopeDesynchronized=false,scopeQueue:Promise<void>=Promise.resolve();
  const assertSynchronized=()=>{if(scopeDesynchronized)throw new ConnectorError("RESULT_UNKNOWN","Scope state is uncertain; reload the protected registry in a fresh dispatcher");};
  const authorizeScope=async()=>{assertSynchronized();if(controlStore)await requireCurrentControl();};
  const serializeScope=<T>(operation:()=>Promise<T>):Promise<T>=>{
    const queued=scopeQueue.then(async()=>{await authorizeScope();return operation();});
    scopeQueue=queued.then(()=>undefined,()=>undefined);return queued;
  };
  const grantKey=(grant:WorkspaceGrant)=>JSON.stringify([grant.id,grant.canonicalRoot,grant.rootIdentity.device,grant.rootIdentity.inode,grant.role??null,[...new Set(grant.permissions)].sort(),grant.revision]);
  const setKey=(grants:readonly WorkspaceGrant[])=>JSON.stringify(grants.map(grantKey).sort());
  const publishScope=async<T>(operation:(beforePublish:(grants:readonly WorkspaceGrant[])=>Promise<void>)=>Promise<T>,verify:(registry:WorkspaceRegistry,result:T)=>void):Promise<T>=>{
    let published=false;
    let expected:string|undefined;
    try{
      const result=await operation(async grants=>{await authorizeScope();expected=setKey(grants);});published=true;
      const durable=await loadTrustedRegistry(grantDirectory());
      if(expected===undefined||setKey(durable.list())!==expected)throw Error("Durable scope differs from the complete intended publication");
      verify(durable,result);
      const applied=await registry.replaceTrustedSnapshot(durable.list());
      const readback=await loadTrustedRegistry(grantDirectory());
      if(setKey(readback.list())!==setKey(applied)||setKey(registry.list())!==setKey(applied))throw Error("Durable scope changed during reconciliation");
      return result;
    }catch(error){
      if(published||error&&typeof error==="object"&&"code" in error&&error.code==="RESULT_UNKNOWN"){
        scopeDesynchronized=true;
        throw new ConnectorError("RESULT_UNKNOWN","Scope publication may have completed; reload the protected registry in a fresh dispatcher. "+String(error));
      }
      throw error;
    }
  };
  const bindSelections=(args:Record<string,unknown>):{path:string;role?:WorkspaceRole}[]=>{
    if(!args||typeof args!=="object"||Array.isArray(args)||Object.keys(args).length!==1)throw Error("INVALID_ARGUMENTS");
    const explicit=Object.hasOwn(args,"roots"),values=explicit?args.roots:args.paths;
    if(!Array.isArray(values)||values.length<1||values.length>16)throw Error("INVALID_ARGUMENTS");
    return Array.from(values,value=>{
      const root=explicit?value?.path:value,role=explicit?value?.role:undefined;
      if(explicit&&(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==2||!Object.hasOwn(value,"path")||!Object.hasOwn(value,"role")||(role!=="workspace"&&role!=="reference")))throw Error("INVALID_ARGUMENTS");
      if(typeof root!=="string"||!path.isAbsolute(root)||root.includes("\0"))throw Error("INVALID_ARGUMENTS");
      return {path:root,...(explicit?{role:role as WorkspaceRole}:{})};
    });
  };
  const processes=new ProcessManager(sandbox);
  const durable=new DurableProcessManager(nativeProcesses);
  const sourceService=()=>new CiSourceCaptureService(sourceCapture,snapshots??new CiSnapshotStore(),ciStore??new CiJournalStore());
  let coordinator:CiRunService|null=null;
  const ciService=()=>coordinator??(coordinator=new CiRunService(ciStore??new CiJournalStore(),snapshots??new CiSnapshotStore(),ciExecutor));
  const invoke=async (call:ToolCall):Promise<ToolResult> => {
    try {
      const args=call.arguments??{};
      const diagnostic=["connector_status","acquire_control","renew_control","release_control","stop_process","ci_cancel"].includes(call.name)||call.name==="list_capabilities"&&args.workspace_id===undefined;
      if(!diagnostic)assertSynchronized();
      let result:unknown;
      switch(call.name) {
        case "acquire_control":
          if(Object.keys(args).length)throw Error("INVALID_ARGUMENTS");
          if(!controlStore)throw Error("SECURITY_BLOCKED");
          result=await controlStore.acquire();break;
        case "renew_control":case "release_control":
          if(typeof args.control_token!=="string"||Object.keys(args).length!==1)throw Error("INVALID_ARGUMENTS");
          if(!controlStore)throw Error("SECURITY_BLOCKED");
          if(call.name==="renew_control")result=await controlStore.renew(args.control_token);
          else{await controlStore.release(args.control_token);result={released:true};}
          break;
        case "connector_status":
          if(Object.keys(args).length) throw Error("INVALID_ARGUMENTS");
          {const base=connectorStatus(),protectedStorage=protectedStateCapability();result={...base,
           protected_state_available:protectedStorage.available,protected_state_reason:protectedStorage.reason??null,
           capabilities:{...base.capabilities,shellIsolation:sandbox?.verified?"verified":"blocked",localCi:ciExecutor?.verified?"available":"blocked"},
           readyForShell:!!sandbox?.verified,executionEnvironment:sandbox?.verified?"linux-arm64-vm":null,
           workspaceMode:sandbox?.verified?"disposable-snapshot":null,...fileCapabilities(),git:"blocked",
           workspace_roles:["workspace","reference"],workspace_role_semantics:"grant-intent; backend-availability-reported-separately",
           processHistory:"current-server-only; newest 128 terminal native receipts",restartRecovery:"blocked"};}break;
        case "list_workspaces":
          if(Object.keys(args).length) throw Error("INVALID_ARGUMENTS");
          result=registry.list().map(g=>({workspace_id:g.id,role:g.role??null,permissions:g.permissions,revision:g.revision}));break;
        case "get_workspace":
          if(typeof args.workspace_id!=="string"||Object.keys(args).length!==1) throw Error("INVALID_ARGUMENTS");
          {const g=registry.get(args.workspace_id);if(!g) throw Error("WORKSPACE_NOT_FOUND");
          result={workspace_id:g.id,role:g.role??null,permissions:g.permissions,revision:g.revision};}break;
        case "bind_workspaces":
          requireProtectedState();
          {const selections=bindSelections(args);
           result=await serializeScope(async()=>{
             const directory=grantDirectory();
             const recorded=await readTrustedRootBindings(directory),requests:Array<{id:string;root:string;role?:WorkspaceRole}>=[];
             for(const [index,selection] of selections.entries()){
               let canonical:string;
               try{
                 canonical=await fs.realpath(selection.path);
                 if(!(await fs.stat(canonical)).isDirectory())throw Error("Not a directory");
               }catch(error){throw new ConnectorError("PATH_OUTSIDE_SCOPE",`Root at index ${index} (${selection.path}) is unavailable or not a directory; select an existing accessible directory. ${String(error)}`);}
               const existing=recorded.find(entry=>entry.root===canonical);
               const id=existing?.id??"ws-"+createHash("sha256").update(canonical).digest("hex").slice(0,16);
               requests.push({id,root:canonical,...(selection.role===undefined?{}:{role:selection.role})});
             }
             const bound=await publishScope(beforePublish=>selections[0]!.role===undefined?
               enrollReadOnlyBatch(requests,directory,beforePublish):
               enrollRolesTrustedBatch(requests.map(request=>({...request,role:request.role!})),directory,beforePublish),
               (durable,items)=>{for(const item of items){const active=durable.get(item.id);if(!active||grantKey(active)!==grantKey(item.grant))throw Error("Bound grant changed after publication");}});
             return bound.map(item=>({workspace_id:item.id,root:item.root,role:item.grant.role??null,permissions:item.grant.permissions,revision:item.grant.revision}));
           });
          }break;
        case "unbind_workspace":
          requireProtectedState();
          if(typeof args.workspace_id!=="string"||Object.keys(args).length!==1)throw Error("INVALID_ARGUMENTS");
          {const workspaceId=args.workspace_id;
           result=await serializeScope(async()=>{
             await publishScope(beforePublish=>revokeTrusted(workspaceId,grantDirectory(),beforePublish),(durable)=>{if(durable.get(workspaceId))throw Error("Revoked grant remains active after publication");});
             return {workspace_id:workspaceId,revoked:true};
           });
          }break;
        case "list_directory":
          if(typeof args.workspace_id!=="string"||typeof args.path!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          {const target=await registry.resolveExistingRead(args.workspace_id,args.path);
           const entries=await fs.readdir(target,{withFileTypes:true});
           result=entries.slice(0,500).map(e=>({name:e.name,kind:e.isDirectory()?"directory":e.isFile()?"file":"other"}));
          }break;
        case "ci_list_runs":
          if(typeof args.workspace_id!=="string"||Object.keys(args).length!==1)throw Error("INVALID_ARGUMENTS");
          registry.requireGrant(args.workspace_id,"read");
          result=(await (ciStore??new CiJournalStore()).list()).filter(r=>r.workspace_id===args.workspace_id);break;
        case "ci_prepare_source":
          if(typeof args.workspace_id!=="string"||Object.keys(args).length!==1)throw Error("INVALID_ARGUMENTS");
          requireNativeBackend(sourceCapture);
          registry.requireGrant(args.workspace_id,"read");
          result=await sourceService().prepare(args.workspace_id);break;
        case "ci_run":
          if(typeof args.workspace_id!=="string"||typeof args.workflow!=="string"||typeof args.source_run_id!=="string"||Object.keys(args).length!==3)throw Error("INVALID_ARGUMENTS");
          requireNativeBackend(ciExecutor);
          registry.requireGrant(args.workspace_id,"execute");
          await sourceService().requireOwned(args.workspace_id,args.source_run_id);
          result=await ciService().submit(args.workspace_id,args.workflow,args.source_run_id);break;
        case "ci_rerun_failed":
          if(typeof args.workspace_id!=="string"||typeof args.run_id!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          registry.requireGrant(args.workspace_id,"execute");
          requireNativeBackend(ciExecutor);
          result=await ciService().rerunFailed(args.workspace_id,args.run_id);break;
        case "ci_cancel":
          if(typeof args.workspace_id!=="string"||typeof args.run_id!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          registry.requireGrant(args.workspace_id,"execute");
          result=await ciService().cancel(args.workspace_id,args.run_id);break;
        case "ci_status":
          if(typeof args.workspace_id!=="string"||typeof args.run_id!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          registry.requireGrant(args.workspace_id,"read");
          {const record=await (ciStore??new CiJournalStore()).load(args.run_id);
           if(record.workspace_id!==args.workspace_id)throw Error("RUN_NOT_FOUND");
           result=record;
          }break;
        case "ci_logs":
          if(typeof args.workspace_id!=="string"||typeof args.run_id!=="string"||Object.keys(args).some(k=>!["workspace_id","run_id","cursor","limit"].includes(k))||!validPage(args,100))throw Error("INVALID_ARGUMENTS");
          registry.requireGrant(args.workspace_id,"read");
          {const run=await (ciStore??new CiJournalStore()).load(args.run_id);
           if(run.workspace_id!==args.workspace_id)throw Error("RUN_NOT_FOUND");
           result=await (logs??new CiLogStore()).page(args.run_id,Number(args.cursor??0),Number(args.limit??50));
          }break;
        case "ci_artifacts":case "ci_read_artifact":
          if(typeof args.workspace_id!=="string"||typeof args.run_id!=="string"||Object.keys(args).some(k=>!["workspace_id","run_id","artifact"].includes(k)))throw Error("INVALID_ARGUMENTS");
          registry.requireGrant(args.workspace_id,"read");
          {const run=await (ciStore??new CiJournalStore()).load(args.run_id);
           if(run.workspace_id!==args.workspace_id)throw Error("RUN_NOT_FOUND");
           if(call.name==="ci_artifacts"){
            if(args.artifact!==undefined)throw Error("INVALID_ARGUMENTS");
            result=await (artifacts??new CiArtifactStore()).list(args.run_id);
           }else{
            if(typeof args.artifact!=="string")throw Error("INVALID_ARGUMENTS");
            const data=await (artifacts??new CiArtifactStore()).read(args.run_id,args.artifact);
            result={...data.metadata,base64:Buffer.from(data.bytes).toString("base64")};
           }
          }break;
        case "ci_list_workflows":
          if(typeof args.workspace_id!=="string"||Object.keys(args).length!==1)throw Error("INVALID_ARGUMENTS");
          {registry.requireGrant(args.workspace_id,"read");
           const candidates=[".gsa/ci.json",".gsa/ci.yaml"];
           const workflows=[];
           for(const relative of candidates){
             let target:string;
             try{target=await registry.resolveExistingRead(args.workspace_id,relative);}
             catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")continue;throw e;}
             const stat=await fs.stat(target);
             if(!stat.isFile())continue;
             if(stat.size>65536)throw Error("CI_MANIFEST_TOO_LARGE");

             try{
               const parsed=parseCiManifest(new TextDecoder("utf-8",{fatal:true}).decode(await fs.readFile(target)));
               workflows.push({path:relative,format:relative.endsWith(".yaml")?"yaml":"json",...validateWorkflow(parsed)});
             }catch(e){workflows.push({path:relative,format:relative.endsWith(".yaml")?"yaml":"json",validation:"INVALID",reason:e instanceof Error?e.message:"UNKNOWN_ERROR"});}
           }
           result={workflows,execution_allowed:false};
          }break;
        case "ci_validate_workflow":
          if(typeof args.workspace_id!=="string"||typeof args.workflow!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          {const file=await registry.resolveExistingRead(args.workspace_id,args.workflow);
           const stat=await fs.stat(file);
           if(!stat.isFile()||stat.size>65536)throw Error("CI_MANIFEST_TOO_LARGE");
           const text=new TextDecoder("utf-8",{fatal:true}).decode(await fs.readFile(file));
           let parsed:unknown;
           try{parsed=parseCiManifest(text);}catch{throw Error("CI_MANIFEST_INVALID");}
           result={...validateWorkflow(parsed),execution_allowed:false,format:"Strict YAML subset or JSON"};
          }break;
        case "list_capabilities":
          if(Object.keys(args).some(k=>k!=="workspace_id")||(args.workspace_id!==undefined&&typeof args.workspace_id!=="string"))throw Error("INVALID_ARGUMENTS");
          {if(typeof args.workspace_id==="string"&&!registry.get(args.workspace_id))throw Error("WORKSPACE_NOT_FOUND");
           const protectedStorage=protectedStateCapability();
           const read=["connector_status","list_workspaces","get_workspace","bind_workspaces","unbind_workspace","list_directory","fetch_file","get_file_info","search","glob","list_capabilities","ci_validate_workflow","ci_list_workflows","ci_list_runs","ci_status","ci_artifacts","ci_read_artifact","ci_logs"].filter(name=>protectedStorage.available||!controlledToolNames.has(name));
           const execution=sandbox?.verified?["run_command","start_process","stop_process","list_processes","process_status","process_output"]:[];
           const ci=ciExecutor?.verified?["ci_run","ci_rerun_failed","ci_cancel"]:[];
           if(sourceCapture?.verified)ci.push("ci_prepare_source");
           if(fileTransactionReadbackAvailable())read.push("get_file_transaction");
           const files=protectedStorage.available?[...fileOperations,...(fullFileWrites?["batch_file_operations"]:[])]:[];
           const enabled=new Set([...read,...files,...execution,...ci,...(controlStore&&protectedStorage.available?["acquire_control","renew_control","release_control"]:[])]);
           result={workspace_roles:["workspace","reference"],workspace_role_semantics:"grant-intent; backend-availability-reported-separately",protected_state_available:protectedStorage.available,protected_state_reason:protectedStorage.reason??null,read,files,execution,ci,blocked:plannedTools.map(t=>t.name).filter(n=>!enabled.has(n)),shellIsolation:sandbox?.verified?"verified":"blocked",...fileCapabilities(),git:"blocked",executionEnvironment:sandbox?.verified?"linux-arm64-vm":null,workspaceMode:sandbox?.verified?"disposable-snapshot":null,restartRecovery:"blocked"};
          }break;
        case "glob":
          if(typeof args.workspace_id!=="string"||typeof args.path!=="string"||typeof args.pattern!=="string"||Object.keys(args).length!==3||args.pattern.length>160||!args.pattern)throw Error("INVALID_ARGUMENTS");
          {const dir=await registry.resolveExistingRead(args.workspace_id,args.path);
           if(!(await fs.stat(dir)).isDirectory())throw Error("NOT_A_DIRECTORY");
           const pattern=args.pattern as string;
           if(pattern.includes("..")||pattern.includes("/")||pattern.includes(String.fromCharCode(92))||pattern.includes("**"))throw Error("INVALID_GLOB");
           const escaped=Array.from(pattern).map(ch=>ch==="*" ? ".*" : ch==="?" ? "." : /[\\^$+?.()|{}\[\]]/.test(ch) ? String.fromCharCode(92)+ch : ch).join("");
           const re=new RegExp("^"+escaped+"$");
           const found=[];
           for(const e of (await fs.readdir(dir,{withFileTypes:true})).slice(0,500))
             if(!e.isSymbolicLink()&&re.test(e.name))found.push({name:e.name,kind:e.isDirectory()?"directory":e.isFile()?"file":"other"});
           result={entries:found,truncated:false};
          }break;
        case "get_file_info":
          if(typeof args.workspace_id!=="string"||typeof args.path!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          {const target=await registry.resolveExistingRead(args.workspace_id,args.path);
           const stat=await fs.stat(target);
           let sha256:null|string=null;
           if(stat.isFile()&&stat.size<=8*1024*1024)sha256=createHash("sha256").update(await fs.readFile(target)).digest("hex");
           result={path:args.path,kind:stat.isDirectory()?"directory":stat.isFile()?"file":"other",size:stat.size,mtime:stat.mtime.toISOString(),sha256};
          }break;
        case "search":
          if(typeof args.workspace_id!=="string"||typeof args.path!=="string"||typeof args.query!=="string"||Object.keys(args).length!==3||!args.query||args.query.length>200)throw Error("INVALID_ARGUMENTS");
          {const root=await registry.resolveExistingRead(args.workspace_id,args.path);
           const stat=await fs.stat(root);
           if(!stat.isDirectory())throw Error("NOT_A_DIRECTORY");
           const matches:Array<{path:string;line:number;snippet:string}>=[];
           let examined=0;
           const pending=[args.path as string];
           while(pending.length&&examined<200&&matches.length<100){
             const rel=pending.shift()!;
             const dir=await registry.resolveExistingRead(args.workspace_id,rel);
             const entries=await fs.readdir(dir,{withFileTypes:true});
             for(const e of entries){
               if(examined>=200||matches.length>=100)break;
               if(e.name.startsWith(".")||e.isSymbolicLink())continue;
               const child=rel==="."?e.name:rel+"/"+e.name;
               if(e.isDirectory()){if(pending.length<100)pending.push(child);continue;}
               if(!e.isFile())continue;
               examined++;
               const file=await registry.resolveExistingRead(args.workspace_id,child);
               const sz=await fs.stat(file);
               if(sz.size>65536)continue;
               let lines:string[];
               try{lines=new TextDecoder("utf-8",{fatal:true}).decode(await fs.readFile(file)).split(/\r?\n/);}catch{continue;}
               for(let i=0;i<lines.length&&matches.length<100;i++)if(lines[i].includes(args.query as string))matches.push({path:child,line:i+1,snippet:lines[i].slice(0,240)});
             }
           }
           result={matches,files_examined:examined,truncated:pending.length>0||examined>=200||matches.length>=100};
          }break;
        case "fetch_file":
          if(typeof args.workspace_id!=="string"||typeof args.path!=="string"||Object.keys(args).some(k=>!["workspace_id","path","start_line","max_lines"].includes(k))||(args.start_line!==undefined&&(!Number.isInteger(args.start_line)||Number(args.start_line)<1))||(args.max_lines!==undefined&&(!Number.isInteger(args.max_lines)||Number(args.max_lines)<1||Number(args.max_lines)>500)))throw Error("INVALID_ARGUMENTS");
          {const target=await registry.resolveExistingRead(args.workspace_id,args.path);
           const stat=await fs.stat(target);
           if(!stat.isFile()||stat.size>65536)throw Error("READ_LIMIT_EXCEEDED");
           const data=await fs.readFile(target);
           const value=new TextDecoder("utf-8",{fatal:true}).decode(data);
           const lines=value.split(/\r?\n/);
           const start=Number(args.start_line??1),count=Number(args.max_lines??lines.length);
           result={path:args.path,text:lines.slice(start-1,start-1+count).join("\n"),start_line:start,end_line:Math.min(lines.length,start-1+count),total_lines:lines.length,truncated:start-1+count<lines.length};
          }break;
        case "get_file_transaction": {
          if(Object.keys(args).length!==1||typeof args.transaction_id!=="string")throw Error("INVALID_ARGUMENTS");
          try{assertFileTransactionId(args.transaction_id);}catch{throw Error("INVALID_ARGUMENTS");}
          requireProtectedState();
          const recovery=nativeFiles?.recoverableMutations;
          if(!fileTransactionReadbackAvailable()||!recovery?.readTransaction)throw Error("SECURITY_BLOCKED");
          const observed=await recovery.readTransaction(args.transaction_id);
          const outcomeKeys=["transaction_id","status","intent","observations","retained_handles","reason"];
          if(!observed||typeof observed!=="object"||Array.isArray(observed)||Object.keys(observed).length!==outcomeKeys.length||Object.keys(observed).some(key=>!outcomeKeys.includes(key)))throw Error("INVALID_FILE_TRANSACTION");
          // Validate the outcome boundary without inventing observations or journal scope.
          const outcome=fileTransactionOutcome({...observed,revision:1});
          if(outcome.transaction_id!==args.transaction_id)throw Error("INVALID_FILE_TRANSACTION");
          if(outcome.status!=="APPLIED")return {isError:true,content:[{type:"text",text:JSON.stringify({ok:false,code:outcome.status==="UNKNOWN"?"RESULT_UNKNOWN":"FILE_TRANSACTION_CONFLICT",result:outcome})}]};
          result=outcome;break;
        }
        case "create_file":case "update_file":case "edit_file":case "apply_patch":case "create_directory":case "delete_file":case "copy_file":case "move_file":
          if(!fileOperations.includes(call.name))throw Error("SECURITY_BLOCKED");
          result=await dispatchFileMutation(call.name,args,registry,nativeFiles);
          if(result&&typeof result==="object"&&"transaction_id" in result&&"status" in result&&(result.status==="CONFLICT"||result.status==="UNKNOWN")){
            return {isError:true,content:[{type:"text",text:JSON.stringify({ok:false,code:result.status==="UNKNOWN"?"RESULT_UNKNOWN":"FILE_TRANSACTION_CONFLICT",result})}]};
          }
          break;
        case "git_status":case "git_diff":case "git_log":case "git_show":case "compare_commits":
        case "git_add":case "git_commit":case "create_branch":case "git_checkout":case "git_fetch":case "git_pull":case "git_push":
          if(typeof args.workspace_id!=="string")throw Error("INVALID_ARGUMENTS");
          requireNativeBackend(sandbox);
          registry.requireGrant(args.workspace_id,["git_status","git_diff","git_log","git_show","compare_commits"].includes(call.name)?"read":"execute");
          {const {workspace_id,...parameters}=args;
           result=await executeGit(sandbox,args.workspace_id,call.name,parameters);
          }break;
        case "run_command":
          if(typeof args.workspace_id!=="string"||typeof args.command!=="string"||!Array.isArray(args.args)||args.args.some(x=>typeof x!=="string"))throw Error("INVALID_ARGUMENTS");
          requireNativeBackend(sandbox);
          registry.requireGrant(args.workspace_id,"execute");
          result=await processes.run({workspace_id:args.workspace_id,executable:args.command,argv:args.args as string[],cwd_relative:".",time_limit_ms:30000,max_output_bytes:65536,network_allowed:false});break;
        case "start_process":
          if(typeof args.workspace_id!=="string"||typeof args.command!=="string"||!Array.isArray(args.args)||args.args.some(x=>typeof x!=="string")||Object.keys(args).length!==3)throw Error("INVALID_ARGUMENTS");
          if(!nativeProcesses)requireNativeBackend(sandbox);
          registry.requireGrant(args.workspace_id,"execute");
          {const request={workspace_id:args.workspace_id,executable:args.command,argv:args.args as string[],cwd_relative:"." as const,time_limit_ms:30000,max_output_bytes:65536,network_allowed:false};
           result=nativeProcesses?await durable.start(request):processes.start(request);
          }break;
        case "stop_process":
          if(typeof args.workspace_id!=="string"||typeof args.process_id!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          if(!nativeProcesses)requireNativeBackend(sandbox);
          registry.requireGrant(args.workspace_id,"execute");
          result=nativeProcesses?await durable.stop(args.workspace_id,args.process_id):await processes.stop(args.workspace_id,args.process_id);break;
        case "list_processes":
          if(typeof args.workspace_id!=="string"||Object.keys(args).length!==1)throw Error("INVALID_ARGUMENTS");
          registry.requireGrant(args.workspace_id,"execute");
          result=nativeProcesses?await durable.list(args.workspace_id):processes.list(args.workspace_id);break;
        case "process_status":case "process_output":
          if(typeof args.workspace_id!=="string"||typeof args.process_id!=="string"||
            Object.keys(args).some(k=>!(call.name==="process_output"?["workspace_id","process_id","cursor","limit"]:["workspace_id","process_id"]).includes(k))||
            !validPage(args,65536))throw Error("INVALID_ARGUMENTS");
          registry.requireGrant(args.workspace_id,"execute");
          if(!nativeProcesses&&(args.cursor!==undefined||args.limit!==undefined))throw Error("SECURITY_BLOCKED");
          result=nativeProcesses?(call.name==="process_status"?await durable.status(args.workspace_id,args.process_id):await durable.output(args.workspace_id,args.process_id,Number(args.cursor??0),Number(args.limit??65536))):processes.get(args.workspace_id,args.process_id);break;
        case "batch_file_operations":
          if(!fullFileWrites)throw Error("SECURITY_BLOCKED");
          if(typeof args.workspace_id!=="string"||Object.keys(args).some(k=>!["workspace_id","operations"].includes(k)))throw Error("INVALID_ARGUMENTS");
          result=await batchFileOperations(registry,nativeFiles,args.workspace_id,args.operations);break;
        default: if(plannedToolNames.has(call.name))throw Error("SECURITY_BLOCKED"); else throw Error("UNKNOWN_TOOL");
      }
      return {content:[{type:"text",text:JSON.stringify({ok:true,result})}]};
    } catch(e) {
      return {isError:true,content:[{type:"text",text:JSON.stringify({ok:false,code:e&&typeof e==="object"&&"code" in e&&typeof e.code==="string"?e.code:e instanceof Error?e.message:"UNKNOWN_ERROR",...(e instanceof Error?{message:e.message}:{})})}]};
    }
  };
  return async(call:ToolCall):Promise<ToolResult>=>{
    if(!controlStore||!controlledToolNames.has(call.name))return invoke(call);
    try{
      const {control_token,...args}=call.arguments??{};
      if(typeof control_token!=="string")throw new ControlLeaseError("SESSION_INVALID","Controller token is required");
      return await withControlToken(controlStore,control_token,()=>invoke({...call,arguments:args}));
    }catch(error){
      return {isError:true,content:[{type:"text",text:JSON.stringify({ok:false,code:error&&typeof error==="object"&&"code" in error?error.code:"SESSION_INVALID"})}]};
    }
  };
}

/** JSON-RPC MCP stdio adapter; no external dependencies and no privileges.
 * Framing is newline-delimited JSON per MCP stdio transport.
 */
export async function runStdio(registry=new WorkspaceRegistry(),invoke:(call:ToolCall)=>Promise<ToolResult>=createReadOnlyTools(registry),streams:{input:import("node:stream").Readable;output:import("node:stream").Writable}={input:process.stdin,output:process.stdout}):Promise<void> {
  const {createInterface}=await import("node:readline");
  const version="2025-03-26";
  const pending=new Set<Promise<void>>();
  const urgentControls=new Set(["release_control","renew_control","stop_process","ci_cancel"]);
  let activeCalls=0,activeControls=0;
  const handle=async(line:string):Promise<void>=>{
    let id: unknown;
    try {
      const req=JSON.parse(line) as {jsonrpc?:string;id?:unknown;method?:string;params?:Record<string,unknown>};
      id=req.id;
      if(req.jsonrpc!=="2.0") throw Error("INVALID_REQUEST");
      if(req.method==="notifications/initialized") return;
      let result:unknown;
      if(req.method==="initialize") result={protocolVersion:version,capabilities:{tools:{listChanged:false}},serverInfo:{name:"gsa-localconnector",version:"0.1.0"}};
      else if(req.method==="ping") result={};
      else if(req.method==="tools/list") result={tools:toolDefinitions()};
      else if(req.method==="tools/call") {
        if(!req.params||typeof req.params.name!=="string")throw Error("INVALID_PARAMS");
        const urgent=urgentControls.has(req.params.name);
        if(urgent?activeControls>=4:activeCalls>=32)throw Error("SERVER_BUSY");
        if(urgent)activeControls++;else activeCalls++;
        try{result=await invoke({name:req.params.name,arguments:req.params.arguments as Record<string,unknown>});}
        finally{if(urgent)activeControls--;else activeCalls--;}
      } else throw Error("METHOD_NOT_FOUND");
      if(id!==undefined)streams.output.write(JSON.stringify({jsonrpc:"2.0",id,result})+"\n");
    } catch(e) {
      if(id!==undefined)streams.output.write(JSON.stringify({jsonrpc:"2.0",id,error:{code:-32603,message:e instanceof Error?e.message:"Internal error"}})+"\n");
    }
  };
  for await(const line of createInterface({input:streams.input,crlfDelay:Infinity})) {
    if(!line.trim())continue;
    // JSON-RPC IDs correlate responses; held jobs must not serialize controls.
    const task=handle(line);pending.add(task);
    void task.then(()=>pending.delete(task),()=>pending.delete(task));
  }
  await Promise.allSettled(pending);
}
