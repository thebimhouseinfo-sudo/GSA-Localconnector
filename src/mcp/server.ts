import { createRequire } from "node:module";
import { connectorStatus } from "../index.js";
import { WorkspaceRegistry } from "../core/workspace.js";
import fs from "node:fs/promises";

/** Strict read-only bootstrap surface. No shell, CI, or enrollment tools. */
export interface ToolCall { name: string; arguments?: Record<string, unknown> }
export interface ToolResult { content: Array<{type:"text";text:string}>; isError?: boolean }
const definitions = [
  {name:"connector_status",description:"Return host capabilities; shell and CI remain blocked",inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"list_workspaces",description:"List explicitly trusted workspaces; does not enroll new ones",inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"get_workspace",description:"Inspect trusted workspace metadata",inputSchema:{type:"object",properties:{workspace_id:{type:"string"}},required:["workspace_id"],additionalProperties:false}},
  {name:"list_directory",description:"Read immediate directory entries in an enrolled read-only workspace",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"}},required:["workspace_id","path"],additionalProperties:false}},
  {name:"fetch_file",description:"Read UTF-8 text from an enrolled read-only workspace (maximum 64 KiB)",inputSchema:{type:"object",properties:{workspace_id:{type:"string"},path:{type:"string"}},required:["workspace_id","path"],additionalProperties:false}}
] as const;
export function toolDefinitions() {return definitions;}
export function createReadOnlyTools(registry: WorkspaceRegistry) {
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
        case "list_directory":
          if(typeof args.workspace_id!=="string"||typeof args.path!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          {const target=await registry.resolveExistingRead(args.workspace_id,args.path);
           const entries=await fs.readdir(target,{withFileTypes:true});
           result=entries.slice(0,500).map(e=>({name:e.name,kind:e.isDirectory()?"directory":e.isFile()?"file":"other"}));
          }break;
        case "fetch_file":
          if(typeof args.workspace_id!=="string"||typeof args.path!=="string"||Object.keys(args).length!==2)throw Error("INVALID_ARGUMENTS");
          {const target=await registry.resolveExistingRead(args.workspace_id,args.path);
           const stat=await fs.stat(target);
           if(!stat.isFile()||stat.size>65536)throw Error("READ_LIMIT_EXCEEDED");
           const data=await fs.readFile(target);
           const value=new TextDecoder("utf-8",{fatal:true}).decode(data);
           result={path:args.path,text:value};
          }break;
        default: throw Error("UNKNOWN_TOOL");
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
