import {randomUUID} from "node:crypto";
import type {SandboxedProcessRequest,VerifiedNativeProcessController,NativeProcessStatus} from "./native-io.js";
import {requireNativeBackend} from "./native-io.js";
export class DurableProcessError extends Error{
 constructor(public readonly code:"PROCESS_NOT_FOUND"|"PROCESS_LIMIT"|"INVALID_PROCESS_REQUEST"|"PROCESS_ALREADY_FINISHED",message:string){super(message);}
}
type Entry={workspace_id:string;native_id:string;public_id:string};
export class DurableProcessManager{
 private readonly owned=new Map<string,Entry>();
 constructor(private readonly backend:VerifiedNativeProcessController|null,private readonly maxActive=16){}
 list(workspaceId:string){return [...this.owned.values()].filter(x=>x.workspace_id===workspaceId).map(x=>({process_id:x.public_id,workspace_id:x.workspace_id}));}
 private get(workspaceId:string,publicId:string):Entry{
  const e=this.owned.get(publicId);
  if(!e||e.workspace_id!==workspaceId)throw new DurableProcessError("PROCESS_NOT_FOUND","Process not owned by workspace");
  return e;
 }
 async start(request:SandboxedProcessRequest):Promise<{process_id:string;state:"RUNNING"}>{
  const native=requireNativeBackend(this.backend);
  if(!request.workspace_id||!request.executable||request.cwd_relative!=="."||request.network_allowed||
    !Number.isInteger(request.time_limit_ms)||request.time_limit_ms<1||request.time_limit_ms>120000||
    !Number.isInteger(request.max_output_bytes)||request.max_output_bytes<1||request.max_output_bytes>2097152||
    !Array.isArray(request.argv)||request.argv.some(a=>typeof a!=="string"||a.includes(String.fromCharCode(0))))
    throw new DurableProcessError("INVALID_PROCESS_REQUEST","Unacceptable process request");
  if([...this.owned.values()].filter(x=>x.workspace_id===request.workspace_id).length>=this.maxActive)
    throw new DurableProcessError("PROCESS_LIMIT","Process registry quota exhausted");
  const started=await native.start(request);
  if(!started.native_id)throw new DurableProcessError("INVALID_PROCESS_REQUEST","Native backend omitted process identity");
  const public_id=randomUUID();
  this.owned.set(public_id,{public_id,workspace_id:request.workspace_id,native_id:started.native_id});
  return {process_id:public_id,state:"RUNNING"};
 }
 async status(workspaceId:string,id:string):Promise<NativeProcessStatus>{
  const native=requireNativeBackend(this.backend);
  return native.status(this.get(workspaceId,id).native_id);
 }
 async output(workspaceId:string,id:string,cursor=0,limit=65536){
  const native=requireNativeBackend(this.backend);
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>65536)
    throw new DurableProcessError("INVALID_PROCESS_REQUEST","Invalid output range");
  const out=await native.output(this.get(workspaceId,id).native_id,cursor,limit);
  if(Buffer.byteLength(out.stdout)+Buffer.byteLength(out.stderr)>limit)
    throw new DurableProcessError("PROCESS_LIMIT","Native response violated output cap");
  return out;
 }
 async stop(workspaceId:string,id:string){
  const native=requireNativeBackend(this.backend);
  const entry=this.get(workspaceId,id);
  return native.stop(entry.native_id);
 }
}
