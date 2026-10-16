import {randomUUID} from "node:crypto";
import type {SandboxedProcessRequest,SandboxedProcessReceipt,VerifiedNativeSandbox} from "./native-io.js";
export type ProcessState="QUEUED"|"RUNNING"|"SUCCEEDED"|"FAILED"|"CANCELLED"|"UNKNOWN";
export interface ProcessRecord {
 readonly process_id:string; readonly workspace_id:string; readonly state:ProcessState;
 readonly created_at:string;readonly updated_at:string;
 readonly receipt?:SandboxedProcessReceipt;
}
export class ProcessError extends Error{constructor(public readonly code:"SECURITY_BLOCKED"|"PROCESS_NOT_FOUND"|"PROCESS_BUSY"|"INVALID_PROCESS",message:string){super(message);}}
/** Reference lifecycle. Native worker must be injected; this class never spawns unrestricted OS children. */
export class ProcessManager {
 private readonly records=new Map<string,ProcessRecord>();
 constructor(private readonly native:VerifiedNativeSandbox|null){}
 list(workspaceId:string):ProcessRecord[]{return [...this.records.values()].filter(r=>r.workspace_id===workspaceId);}
 get(workspaceId:string,id:string):ProcessRecord{
  const r=this.records.get(id);
  if(!r||r.workspace_id!==workspaceId)throw new ProcessError("PROCESS_NOT_FOUND","Unknown owned process");
  return r;
 }
 async run(request:SandboxedProcessRequest):Promise<ProcessRecord>{
  if(!this.native?.verified)throw new ProcessError("SECURITY_BLOCKED","Native sandbox unavailable");
  if(!request.workspace_id||!request.executable||!Array.isArray(request.argv)||request.argv.some(a=>typeof a!=="string"||a.includes("\\0"))||request.cwd_relative!=="."||!Number.isSafeInteger(request.time_limit_ms)||request.time_limit_ms<1||request.time_limit_ms>120000||!Number.isSafeInteger(request.max_output_bytes)||request.max_output_bytes<1||request.max_output_bytes>2097152||request.network_allowed)throw new ProcessError("INVALID_PROCESS","Invalid process request");
  const now=new Date().toISOString(),id=randomUUID();
  const init:ProcessRecord={process_id:id,workspace_id:request.workspace_id,state:"RUNNING",created_at:now,updated_at:now};
  this.records.set(id,init);
  try{
   const receipt=await this.native.execute(request);
   if(Buffer.byteLength(receipt.stdout,"utf8")+Buffer.byteLength(receipt.stderr,"utf8")>request.max_output_bytes)
     throw new ProcessError("INVALID_PROCESS","Native backend exceeded output quota");
   const state:ProcessState=receipt.cancelled?"CANCELLED":receipt.timed_out?"FAILED":receipt.exit_code===0?"SUCCEEDED":receipt.exit_code===null?"UNKNOWN":"FAILED";
   const done:ProcessRecord={...init,state,receipt,updated_at:new Date().toISOString()};
   this.records.set(id,done);return done;
  }catch{
   const unknown:ProcessRecord={...init,state:"UNKNOWN",updated_at:new Date().toISOString()};
   this.records.set(id,unknown);return unknown;
  }
 }
}
