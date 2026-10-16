import { createRequire } from "node:module";
import { connectorStatus } from "../index.js";
import { WorkspaceRegistry } from "../core/workspace.js";
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {enrollReadOnlyBatch,revokeTrusted} from "../local/grants.js";
import {plannedTools,plannedToolNames} from "./catalog.js";
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
import {requireNativeBackend,type NativeScopedFiles,type VerifiedNativeSandbox,type VerifiedNativeProcessController} from "../core/native-io.js";
import {executeGit} from "../core/git-engine.js";
import {ProcessManager} from "../core/process-manager.js";
import {DurableProcessManager} from "../core/durable-process.js";

/** Read-only file surface with explicit caller-authorized absolute-root binding; no shell or CI. */
export interface ToolCall { name: string; arguments?: Record<string, unknown> }
export interface ToolResult { content: Array<{type:"text";text:string}>; isError?: boolean }
const definitions = [
  {name:"connector_status",description:"Return host capabilities; shell and CI remain blocked",inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"list_workspaces",description:"List explicitly trusted workspaces; does not enroll new ones",inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"get_workspace",description:"Inspect trusted workspace metadata",inputSchema:{type:"object",properties:{workspace_id:{type:"string"}},required:["workspace_id"],additionalProperties:false}},
  {name:"list_directory",description:"Read immediate directory entries in an enrolled read-only workspace",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"}},required:["workspace_id","path"],additionalProperties:false}},
  {name:"bind_workspaces",description:"Bind user-provided absolute directory paths as read-only workspaces on this host. Requires explicit user-provided paths; never discover or widen roots automatically.",inputSchema:{type:"object",properties:{paths:{type:"array",items:{type:"string"},minItems:1,maxItems:16}},required:["paths"],additionalProperties:false}},
  {name:"unbind_workspace",description:"Revoke a previously bound workspace on the selected host; subsequent calls lose the grant",inputSchema:{type:"object",properties:{workspace_id:{type:"string"}},required:["workspace_id"],additionalProperties:false}},
  {name:"get_file_info",description:"Metadata and SHA256 of a file within a bound workspace; max 8 MiB hash",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"}},required:["workspace_id","path"],additionalProperties:false}},
  {name:"search",description:"Search UTF-8 text across bounded files under a workspace-relative directory; no external grep subprocess",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"},query:{type:"string"}},required:["workspace_id","path","query"],additionalProperties:false}},
  {name:"fetch_file",description:"Read UTF-8 text from an enrolled read-only workspace (maximum 64 KiB)",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"},start_line:{type:"integer",minimum:1},max_lines:{type:"integer",minimum:1,maximum:500}},required:["workspace_id","path"],additionalProperties:false}}
] as const;
export function toolDefinitions() {return [...definitions,...plannedTools];}
export function createReadOnlyTools(registry: WorkspaceRegistry, nativeFiles:NativeScopedFiles|null=null, sandbox:VerifiedNativeSandbox|null=null, ciStore:CiJournalStore|null=null, artifacts:CiArtifactStore|null=null, logs:CiLogStore|null=null, nativeProcesses:VerifiedNativeProcessController|null=null, snapshots:CiSnapshotStore|null=null, sourceCapture:VerifiedWorkspaceSourceCapture|null=null, ciExecutor:VerifiedCiExecutor|null=null) {
  const processes=new ProcessManager(sandbox);
  const durable=new DurableProcessManager(nativeProcesses);
  const sourceService=new CiSourceCaptureService(sourceCapture,snapshots??new CiSnapshotStore(),ciStore??new CiJournalStore());
  const ciService=new CiRunService(ciStore??new CiJournalStore(),snapshots??new CiSnapshotStore(),ciExecutor);
  return async (call:ToolCall):Promise<ToolResult> => {
    try {
      const args=call.arguments??{};
      let result:unknown;
      switch(call.name) {
        case "connector_status":
          if(Object.keys(args).length) throw Error("INVALID_ARGUMENTS");
          result=connectorStatus();break;
        case "list_workspaces":
          if(Object.keys(args).length) throw Error("INVALID_ARGUMENTS");
          result=registry.list().map(g=>({workspace_id:g.id,permissions:g.permissions,revision:g.revision}));break;
        case "get_workspace":
          if(typeof args.workspace_id!=="string"||Object.keys(args).length!==1) throw Error("INVALID_ARGUMENTS");
          {const g=registry.get(args.workspace_id);if(!g) throw Error("WORKSPACE_NOT_FOUND");
          result={workspace_id:g.id,permissions:g.permissions,revision:g.revision};}break;
        case "bind_workspaces":
          if(Object.keys(args).length!==1||!Array.isArray(args.paths)||args.paths.length<1||args.paths.length>16||args.paths.some(p=>typeof p!=="string"||!path.isAbsolute(p)))throw Error("INVALID_ARGUMENTS");
          {const requests=[];
           for(const root of args.paths as string[]){
             const stat=await fs.stat(root);
             if(!stat.isDirectory())throw Error("WORKSPACE_NOT_DIRECTORY");
             const canonical=await fs.realpath(root);
             const existing=registry.list().find(g=>g.canonicalRoot===canonical);
             const id=existing?.id??"ws-"+createHash("sha256").update(canonical).digest("hex").slice(0,16);
             requests.push({id,root:canonical});
           }
           const bound=await enrollReadOnlyBatch(requests);
           const outputs=[];
           for(const item of bound){
             await registry.enrollTrusted(item.id,item.root,["read"]);
             outputs.push({workspace_id:item.id,root:item.root,permissions:["read"]});
           }
           result=outputs;
          }break;
        case "unbind_workspace":
          if(typeof args.workspace_id!=="string"||Object.keys(args).length!==1)throw Error("INVALID_ARGUMENTS");
          if(!registry.get(args.workspace_id))throw Error("WORKSPACE_NOT_FOUND");
          await revokeTrusted(args.workspace_id);
          registry.revoke(args.workspace_id);
          result={workspace_id:args.workspace_id,revoked:true};break;
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
          result=await sourceService.prepare(args.workspace_id);break;
        case "ci_run":
          if(typeof args.workspace_id!=="string"||typeof args.workflow!=="string"||typeof args.source_run_id!=="string"||Object.keys(args).length!==3)throw Error("INVALID_ARGUMENTS");
          requireNativeBackend(ciExecutor);
          registry.requireGrant(args.workspace_id,"execute");
          await sourceService.requireOwned(args.workspace_id,args.source_run_id);
          {const file=await registry.resolveExistingRead(args.workspace_id,args.workflow);
           const stat=await fs.stat(file);
           if(!stat.isFile()||stat.size>65536)throw Error("CI_MANIFEST_TOO_LARGE");
           const workflow=parseCiManifest(new TextDecoder("utf-8",{fatal:true}).decode(await fs.readFile(file)));
           result=await ciService.submit(args.workspace_id,workflow,args.source_run_id);
          }break;
        case "ci_rerun_failed":
          if(typeof args.workspace_id!=="string"||typeof args.run_id!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          registry.requireGrant(args.workspace_id,"execute");
          result=await (ciStore??new CiJournalStore()).prepareRerun(args.run_id,args.workspace_id,snapshots??new CiSnapshotStore());break;
        case "ci_cancel":
          if(typeof args.workspace_id!=="string"||typeof args.run_id!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          registry.requireGrant(args.workspace_id,"execute");
          result=await (ciStore??new CiJournalStore()).cancelQueued(args.run_id,args.workspace_id);break;
        case "ci_status":
          if(typeof args.workspace_id!=="string"||typeof args.run_id!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          registry.requireGrant(args.workspace_id,"read");
          {const record=await (ciStore??new CiJournalStore()).load(args.run_id);
           if(record.workspace_id!==args.workspace_id)throw Error("RUN_NOT_FOUND");
           result=record;
          }break;
        case "ci_logs":
          if(typeof args.workspace_id!=="string"||typeof args.run_id!=="string"||Object.keys(args).some(k=>!["workspace_id","run_id"].includes(k)))throw Error("INVALID_ARGUMENTS");
          registry.requireGrant(args.workspace_id,"read");
          {const run=await (ciStore??new CiJournalStore()).load(args.run_id);
           if(run.workspace_id!==args.workspace_id)throw Error("RUN_NOT_FOUND");
           result=await (logs??new CiLogStore()).page(args.run_id);
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
           result={read:["connector_status","list_workspaces","get_workspace","bind_workspaces","unbind_workspace","list_directory","fetch_file","get_file_info","search","glob","list_capabilities","ci_validate_workflow","ci_list_workflows","ci_list_runs","ci_status","ci_artifacts","ci_read_artifact","ci_logs","ci_cancel","ci_rerun_failed","ci_prepare_source","ci_run"],blocked:plannedTools.map(t=>t.name).filter(n=>n!=="glob"&&n!=="list_capabilities"&&n!=="ci_validate_workflow"&&n!=="ci_list_workflows"&&n!=="ci_list_runs"&&n!=="ci_status"&&n!=="ci_artifacts"&&n!=="ci_read_artifact"&&n!=="ci_logs"&&n!=="ci_cancel"&&n!=="ci_rerun_failed"&&n!=="ci_prepare_source"&&n!=="ci_run"),shellIsolation:"blocked",reason:"Native OS sandbox and write grants are not verified"};
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
        case "create_file":case "update_file":case "edit_file":case "apply_patch":case "create_directory":case "delete_file":case "copy_file":case "move_file":
          result=await dispatchFileMutation(call.name,args,registry,nativeFiles);break;
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
          result=nativeProcesses?durable.list(args.workspace_id):processes.list(args.workspace_id);break;
        case "process_status":case "process_output":
          if(typeof args.workspace_id!=="string"||typeof args.process_id!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          registry.requireGrant(args.workspace_id,"execute");
          result=nativeProcesses?(call.name==="process_status"?await durable.status(args.workspace_id,args.process_id):await durable.output(args.workspace_id,args.process_id)):processes.get(args.workspace_id,args.process_id);break;
        case "batch_file_operations":
          if(typeof args.workspace_id!=="string"||Object.keys(args).some(k=>!["workspace_id","operations"].includes(k)))throw Error("INVALID_ARGUMENTS");
          result=await batchFileOperations(registry,nativeFiles,args.workspace_id,args.operations);break;
        default: if(plannedToolNames.has(call.name))throw Error("SECURITY_BLOCKED"); else throw Error("UNKNOWN_TOOL");
      }
      return {content:[{type:"text",text:JSON.stringify({ok:true,result})}]};
    } catch(e) {
      return {isError:true,content:[{type:"text",text:JSON.stringify({ok:false,code:e&&typeof e==="object"&&"code" in e&&typeof e.code==="string"?e.code:e instanceof Error?e.message:"UNKNOWN_ERROR"})}]};
    }
  };
}

/** JSON-RPC MCP stdio adapter; no external dependencies and no privileges.
 * Framing is newline-delimited JSON per MCP stdio transport.
 */
export async function runStdio(registry=new WorkspaceRegistry()):Promise<void> {
  const {createInterface}=await import("node:readline");
  const invoke=createReadOnlyTools(registry);
  const version="2025-03-26";
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
    if(!line.trim()) continue;
    let id: unknown;
    try {
      const req=JSON.parse(line) as {jsonrpc?:string;id?:unknown;method?:string;params?:Record<string,unknown>};
      id=req.id;
      if(req.jsonrpc!=="2.0") throw Error("INVALID_REQUEST");
      if(req.method==="notifications/initialized") continue;
      let result:unknown;
      if(req.method==="initialize") result={protocolVersion:version,capabilities:{tools:{listChanged:false}},serverInfo:{name:"gsa-localconnector",version:"0.1.0"}};
      else if(req.method==="ping") result={};
      else if(req.method==="tools/list") result={tools:toolDefinitions()};
      else if(req.method==="tools/call") {
        if(!req.params||typeof req.params.name!=="string")throw Error("INVALID_PARAMS");
        result=await invoke({name:req.params.name,arguments:req.params.arguments as Record<string,unknown>});
      } else throw Error("METHOD_NOT_FOUND");
      if(id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:"2.0",id,result})+"\n");
    } catch(e) {
      if(id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:"2.0",id,error:{code:-32603,message:e instanceof Error?e.message:"Internal error"}})+"\n");
    }
  }
}
