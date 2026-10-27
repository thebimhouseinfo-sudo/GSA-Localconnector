import {randomUUID} from "node:crypto";
import type {SandboxedProcessRequest,SandboxedProcessReceipt,VerifiedNativeSandbox} from "./native-io.js";
export type ProcessState="QUEUED"|"RUNNING"|"SUCCEEDED"|"FAILED"|"CANCELLED"|"UNKNOWN";
export type WorkspaceProcessStop={state:"STOPPED"|"UNKNOWN";pending_starts:number;outcomes:readonly {process_id:string;stopped:boolean;state:ProcessState}[]};
/** Admission tokens survive every asynchronous reservation and cannot be reopened by a bind. */
export class ProcessAdmission {
 private readonly generations=new Map<string,number>();
 private readonly fenced=new Set<string>();
 private readonly pending=new Map<string,Set<Promise<void>>>();
 fence(id:string):void{this.generations.set(id,(this.generations.get(id)??0)+1);this.fenced.add(id);}
 resume(id:string):void{this.generations.set(id,(this.generations.get(id)??0)+1);this.fenced.delete(id);}
 begin(id:string){
  const generation=this.generations.get(id)??0;
  const check=()=>{if(this.fenced.has(id)||(this.generations.get(id)??0)!==generation)throw new ProcessError("SECURITY_BLOCKED","Workspace process admission fenced; old managed work must be confirmed stopped");};
  check();let done!:()=>void,finished=false;const promise=new Promise<void>(resolve=>done=resolve);
  const entries=this.pending.get(id)??new Set<Promise<void>>();entries.add(promise);this.pending.set(id,entries);
  return {check,finish:()=>{if(finished)return;finished=true;entries.delete(promise);if(!entries.size&&this.pending.get(id)===entries)this.pending.delete(id);done();}};
 }
 count(id:string):number{return this.pending.get(id)?.size??0;}
 async settle(id:string):Promise<void>{await Promise.all(this.pending.get(id)??[]);}
}
/** Only bounds the caller's observation: the work and its ownership remain live. */
export async function observeProcessStop(work:Promise<unknown>,snapshot:()=>WorkspaceProcessStop):Promise<WorkspaceProcessStop>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([work.catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(resolve,15000);})]);return snapshot();}
 finally{if(timer)clearTimeout(timer);}
}
export interface ProcessRecord {
 readonly process_id:string; readonly workspace_id:string; readonly state:ProcessState;
 readonly created_at:string;readonly updated_at:string;
 readonly receipt?:SandboxedProcessReceipt;
}
export class ProcessError extends Error{constructor(public readonly code:"SECURITY_BLOCKED"|"PROCESS_NOT_FOUND"|"PROCESS_BUSY"|"INVALID_PROCESS",message:string){super(message);}}
export function validateProcessRequest(request:SandboxedProcessRequest):void{
 if(!request.workspace_id||!request.executable||!Array.isArray(request.argv)||request.argv.some(a=>typeof a!=="string"||a.includes(String.fromCharCode(0)))||request.cwd_relative!=="."||!Number.isSafeInteger(request.time_limit_ms)||request.time_limit_ms<1||request.time_limit_ms>120000||!Number.isSafeInteger(request.max_output_bytes)||request.max_output_bytes<1||request.max_output_bytes>2097152||request.network_allowed)
  throw new ProcessError("INVALID_PROCESS","Invalid process request");
}
/** Reference lifecycle. Native worker must be injected; this class never spawns unrestricted OS children. */
export class ProcessManager {
 private readonly records=new Map<string,ProcessRecord>();
 private readonly active=new Map<string,Promise<void>>();
 private readonly admission=new ProcessAdmission();
 constructor(private readonly native:VerifiedNativeSandbox|null){}
 fenceWorkspace(workspaceId:string):void{this.admission.fence(workspaceId);}
 resumeWorkspace(workspaceId:string):boolean{
  if(this.admission.count(workspaceId)||this.list(workspaceId).some(r=>!this.confirmed(r)))return false;
  this.admission.resume(workspaceId);return true;
 }
 private confirmed(record:ProcessRecord):boolean{return ["SUCCEEDED","FAILED","CANCELLED"].includes(record.state);}
 async stopWorkspace(workspaceId:string):Promise<WorkspaceProcessStop>{
  const selected=this.list(workspaceId).filter(r=>!this.confirmed(r));
  const work=Promise.all(selected.map(async record=>{try{await this.stop(workspaceId,record.process_id);}catch{}}));
  return observeProcessStop(work,()=>{
   const outcomes=selected.map(record=>{const current=this.get(workspaceId,record.process_id);return {process_id:record.process_id,stopped:this.confirmed(current),state:current.state};});
   const pending_starts=this.admission.count(workspaceId);
   return {state:pending_starts||outcomes.some(r=>!r.stopped)?"UNKNOWN":"STOPPED",pending_starts,outcomes};
  });
 }
 list(workspaceId:string):ProcessRecord[]{return [...this.records.values()].filter(r=>r.workspace_id===workspaceId);}
 get(workspaceId:string,id:string):ProcessRecord{
  const r=this.records.get(id);
  if(!r||r.workspace_id!==workspaceId)throw new ProcessError("PROCESS_NOT_FOUND","Unknown owned process");
  return r;
 }
 /** Start now, return an owned ID before the sandbox exits. This is NOT durable
  * process recovery and does not grant OS process cancellation.
  */
 start(request:SandboxedProcessRequest):ProcessRecord {
  if(!this.native?.verified)throw new ProcessError("SECURITY_BLOCKED","Native sandbox unavailable");
  validateProcessRequest(request);
  const admission=this.admission.begin(request.workspace_id);
  admission.finish();admission.check();
  if([...this.records.values()].filter(r=>r.state==="RUNNING").length>=4)throw new ProcessError("PROCESS_BUSY","Concurrent process limit");
  const now=new Date().toISOString(),id=randomUUID();
  const started:ProcessRecord={process_id:id,workspace_id:request.workspace_id,state:"RUNNING",created_at:now,updated_at:now};
  this.records.set(id,started);
  const task=(async()=>{
   try {
    const output=await this.native!.execute({...request,process_id:id});
    const length=Buffer.byteLength(output.stdout,"utf8")+Buffer.byteLength(output.stderr,"utf8");
    if(length>request.max_output_bytes)throw Error("OUTPUT_LIMIT_EXCEEDED");
    const state:ProcessState=output.cancelled?"CANCELLED":output.output_limited||output.signal!==null?"UNKNOWN":output.timed_out?"FAILED":output.exit_code===0?"SUCCEEDED":output.exit_code===null?"UNKNOWN":"FAILED";
    this.records.set(id,{...started,state,receipt:output,updated_at:new Date().toISOString()});
   }catch{
    this.records.set(id,{...started,state:"UNKNOWN",updated_at:new Date().toISOString()});
   }finally{this.active.delete(id);}
  })();
  this.active.set(id,task);
  return started;
 }
 /** Cancellation can only be attempted via a verified native implementation
  * which owns the process tree. Never pretend a missing cancel hook succeeded.
  */
 async stop(workspaceId:string,processId:string):Promise<{requested:boolean;record:ProcessRecord}>{
  const record=this.get(workspaceId,processId);
  if(this.confirmed(record))return {requested:false,record};
  if(!this.native?.verified||!this.native.cancel)throw new ProcessError("SECURITY_BLOCKED","Native process-tree cancellation unavailable");
  const requested=await this.native.cancel(processId,workspaceId);
  if(!requested)throw new ProcessError("PROCESS_BUSY","Native supervisor did not confirm cancellation request");
  // Acknowledged request is not proof of termination. Final receipt still controls state.
  return {requested:true,record:this.get(workspaceId,processId)};
 }
 async settle(workspaceId:string,processId:string):Promise<ProcessRecord>{
  this.get(workspaceId,processId);
  await this.active.get(processId);
  return this.get(workspaceId,processId);
 }
 async run(request:SandboxedProcessRequest):Promise<ProcessRecord>{
  const started=this.start(request);
  return this.settle(request.workspace_id,started.process_id);
 }
}
