import { createRequire } from "node:module";
import { connectorStatus } from "../index.js";
import { WorkspaceRegistry } from "../core/workspace.js";
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {enrollReadOnly} from "../local/grants.js";
import {plannedTools,plannedToolNames} from "./catalog.js";
import {validateWorkflow} from "../core/ci-dag.js";
import {dispatchFileMutation} from "./write-dispatch.js";
import type {NativeScopedFiles} from "../core/native-io.js";

/** Read-only file surface with explicit caller-authorized absolute-root binding; no shell or CI. */
export interface ToolCall { name: string; arguments?: Record<string, unknown> }
export interface ToolResult { content: Array<{type:"text";text:string}>; isError?: boolean }
const definitions = [
  {name:"connector_status",description:"Return host capabilities; shell and CI remain blocked",inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"list_workspaces",description:"List explicitly trusted workspaces; does not enroll new ones",inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"get_workspace",description:"Inspect trusted workspace metadata",inputSchema:{type:"object",properties:{workspace_id:{type:"string"}},required:["workspace_id"],additionalProperties:false}},
  {name:"list_directory",description:"Read immediate directory entries in an enrolled read-only workspace",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"}},required:["workspace_id","path"],additionalProperties:false}},
  {name:"bind_workspaces",description:"Bind user-provided absolute directory paths as read-only workspaces on this host. Requires explicit user-provided paths; never discover or widen roots automatically.",inputSchema:{type:"object",properties:{paths:{type:"array",items:{type:"string"},minItems:1,maxItems:16}},required:["paths"],additionalProperties:false}},
  {name:"get_file_info",description:"Metadata and SHA256 of a file within a bound workspace; max 8 MiB hash",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"}},required:["workspace_id","path"],additionalProperties:false}},
  {name:"search",description:"Search UTF-8 text across bounded files under a workspace-relative directory; no external grep subprocess",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"},query:{type:"string"}},required:["workspace_id","path","query"],additionalProperties:false}},
  {name:"fetch_file",description:"Read UTF-8 text from an enrolled read-only workspace (maximum 64 KiB)",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"},start_line:{type:"integer",minimum:1},max_lines:{type:"integer",minimum:1,maximum:500}},required:["workspace_id","path"],additionalProperties:false}}
] as const;
export function toolDefinitions() {return [...definitions,...plannedTools];}
export function createReadOnlyTools(registry: WorkspaceRegistry, nativeFiles:NativeScopedFiles|null=null) {
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
          {const outputs=[];
           for(const root of args.paths as string[]){
             const stat=await fs.stat(root);
             if(!stat.isDirectory())throw Error("WORKSPACE_NOT_DIRECTORY");
             const canonical=await fs.realpath(root);
             const existing=registry.list().find(g=>g.canonicalRoot===canonical);
             const id=existing?.id??"ws-"+(await import("node:crypto")).createHash("sha256").update(canonical).digest("hex").slice(0,16);
             await enrollReadOnly(id,canonical);
             await registry.enrollTrusted(id,canonical,["read"]);
             outputs.push({workspace_id:id,root:canonical,permissions:["read"]});
           }
           result=outputs;
          }break;
        case "list_directory":
          if(typeof args.workspace_id!=="string"||typeof args.path!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          {const target=await registry.resolveExistingRead(args.workspace_id,args.path);
           const entries=await fs.readdir(target,{withFileTypes:true});
           result=entries.slice(0,500).map(e=>({name:e.name,kind:e.isDirectory()?"directory":e.isFile()?"file":"other"}));
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
             if(relative.endsWith(".yaml")){workflows.push({path:relative,format:"yaml",validation:"UNSUPPORTED_FORMAT"});continue;}
             try{
               const parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await fs.readFile(target))) as unknown;
               workflows.push({path:relative,format:"json",...validateWorkflow(parsed)});
             }catch(e){workflows.push({path:relative,format:"json",validation:"INVALID",reason:e instanceof Error?e.message:"UNKNOWN_ERROR"});}
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
           try{parsed=JSON.parse(text);}catch{throw Error("CI_MANIFEST_REQUIRES_JSON_SUBSET");}
           result={...validateWorkflow(parsed),execution_allowed:false,format:"JSON-compatible YAML subset"};
          }break;
        case "list_capabilities":
          if(Object.keys(args).some(k=>k!=="workspace_id")||(args.workspace_id!==undefined&&typeof args.workspace_id!=="string"))throw Error("INVALID_ARGUMENTS");
          {if(typeof args.workspace_id==="string"&&!registry.get(args.workspace_id))throw Error("WORKSPACE_NOT_FOUND");
           result={read:["connector_status","list_workspaces","get_workspace","bind_workspaces","list_directory","fetch_file","get_file_info","search","glob","list_capabilities","ci_validate_workflow","ci_list_workflows"],blocked:plannedTools.map(t=>t.name).filter(n=>n!=="glob"&&n!=="list_capabilities"&&n!=="ci_validate_workflow"&&n!=="ci_list_workflows"),shellIsolation:"blocked",reason:"Native OS sandbox and write grants are not verified"};
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
        case "create_file":case "update_file":case "edit_file":case "create_directory":case "delete_file":case "copy_file":case "move_file":
          result=await dispatchFileMutation(call.name,args,registry,nativeFiles);break;
        default: if(plannedToolNames.has(call.name))throw Error("SECURITY_BLOCKED"); else throw Error("UNKNOWN_TOOL");
      }
      return {content:[{type:"text",text:JSON.stringify({ok:true,result})}]};
    } catch(e) {
      return {isError:true,content:[{type:"text",text:JSON.stringify({ok:false,code:e instanceof Error?e.message:"UNKNOWN_ERROR"})}]};
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
