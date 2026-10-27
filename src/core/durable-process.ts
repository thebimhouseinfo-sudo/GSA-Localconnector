import {randomUUID} from "node:crypto";
import type {SandboxedProcessRequest,VerifiedNativeProcessController,NativeProcessStatus,VerifiedNativeSandbox,SandboxedProcessReceipt} from "./native-io.js";
import {validateProcessRequest,type ProcessRecord,type ProcessState,type WorkspaceProcessStop,ProcessAdmission,observeProcessStop} from "./process-manager.js";
import {requireNativeBackend} from "./native-io.js";
import type {ProcessJournal,ProcessJournalRecord} from "./process-journal.js";
export interface ProcessPersistence {store:ProcessJournal;ownerSession:string}
export class DurableProcessError extends Error{
 constructor(public readonly code:"PROCESS_NOT_FOUND"|"PROCESS_LIMIT"|"INVALID_PROCESS_REQUEST"|"PROCESS_ALREADY_FINISHED",message:string){super(message);}
}
type Entry={workspace_id:string;native_id:string;public_id:string;active:boolean;expired?:boolean;record?:ProcessJournalRecord;saving?:Promise<void>;command?:VerifiedNativeSandbox;stopAttempt?:Promise<{stopped:boolean;state:ProcessState}>};
export class DurableProcessManager{
 private readonly owned=new Map<string,Entry>();
 private readonly pending=new Map<string,number>();
 private readonly ready:Promise<void>;
 private readonly admission=new ProcessAdmission();
 private readonly ownerSession:string|undefined;
 private initialized=false;
 private currentOwner(entry:Entry):boolean{return this.persistence?.ownerSession===this.ownerSession&&(!entry.record||entry.record.owner_session===this.ownerSession);}
 fenceWorkspace(workspaceId:string):void{this.admission.fence(workspaceId);}
 resumeWorkspace(workspaceId:string):boolean{
  if(!this.initialized||this.admission.count(workspaceId)||[...this.owned.values()].some(e=>e.workspace_id===workspaceId&&e.active))return false;
  this.admission.resume(workspaceId);return true;
 }
 private stopOwned(entry:Entry):Promise<{stopped:boolean;state:ProcessState}>{
  return entry.stopAttempt??(entry.stopAttempt=this.stop(entry.workspace_id,entry.public_id));
 }
 async stopWorkspace(workspaceId:string):Promise<WorkspaceProcessStop>{
  const selected=new Set<Entry>();
  const collect=()=>{for(const entry of this.owned.values())if(entry.workspace_id===workspaceId&&entry.active)selected.add(entry);};
  collect();
  const work=(async()=>{
   await this.ready;collect();
   // Cancel known work immediately while late acknowledgements retain their own continuation.
   const stop=async(entry:Entry)=>{if(!entry.active||!this.currentOwner(entry))return;try{await this.stopOwned(entry);}catch{}};
   const known=[...selected].map(stop);
   await this.admission.settle(workspaceId);collect();
   await Promise.allSettled([...known,...[...selected].map(entry=>entry.stopAttempt??stop(entry))]);
  })();
  const result=await observeProcessStop(work,()=>{
   collect();
   const pending_starts=this.admission.count(workspaceId);
   const outcomes=[...selected].map(entry=>({process_id:entry.public_id,stopped:!entry.active&&(!entry.record||entry.record.stopped),state:entry.record?.status.state??(entry.active?"UNKNOWN":"CANCELLED") as ProcessState}));
   return {state:this.initialized&&!pending_starts&&outcomes.every(r=>r.stopped)?"STOPPED":"UNKNOWN",pending_starts,outcomes};
  });
  // A later explicit revocation may retry an unconfirmed stop, but this observation
  // shares any late-start continuation already in flight.
  void work.then(()=>{for(const entry of selected)if(entry.active)entry.stopAttempt=undefined;},()=>{});
  return result;
 }
 private begin(workspaceId:string){
  const token=this.admission.begin(workspaceId),owner=this.ownerSession;
  return {finish:token.finish,check:()=>{token.check();if(owner!==this.persistence?.ownerSession)throw Error("SECURITY_BLOCKED: Process owner changed");}};
 }
 private observe(entry:Entry,status:NativeProcessStatus):NativeProcessStatus{
  if(!this.persistence&&(status.stopped||["SUCCEEDED","FAILED","CANCELLED"].includes(status.state)))entry.active=false;
  return status;
 }
 constructor(private readonly backend:VerifiedNativeProcessController|null,private readonly maxActive=16,private readonly persistence?:ProcessPersistence){
  this.ownerSession=persistence?.ownerSession;
  this.ready=(persistence?persistence.store.list().then(records=>{for(const record of records)this.hydrate(record);}):Promise.resolve()).then(()=>{this.initialized=true;});
  // Retain the rejecting readiness promise for callers without an unhandled
  // rejection when the factory is created before its first invocation.
  void this.ready.catch(()=>{});
 }
 async initialize():Promise<void>{await this.ready;}
 /** Persist the existing synchronous sandbox execution, preserving its full receipt.
  * This path never translates a command identity into a controller-native ID. */
 run(input:SandboxedProcessRequest,sandbox:VerifiedNativeSandbox):Promise<ProcessRecord>{
  return this.executeCommand(input,sandbox);
 }
 /** Return only after intent/RUNNING is durable. Completion keeps the same ID
  * and journal path as run(); background errors retain UNKNOWN ownership. */
 startCommand(input:SandboxedProcessRequest,sandbox:VerifiedNativeSandbox):Promise<{process_id:string;state:"RUNNING"}>{
  return new Promise((resolve,reject)=>{
   let acknowledged=false;
   void this.executeCommand(input,sandbox,id=>{acknowledged=true;resolve({process_id:id,state:"RUNNING"});})
    .catch(error=>{if(!acknowledged)reject(error);});
  });
 }
 private executeCommand(input:SandboxedProcessRequest,sandbox:VerifiedNativeSandbox,onStarted?:(id:string)=>void):Promise<ProcessRecord>{
  const token=this.begin(input.workspace_id);
  return this.executeAdmittedCommand(input,sandbox,token,onStarted).finally(token.finish);
 }
 private async executeAdmittedCommand(input:SandboxedProcessRequest,sandbox:VerifiedNativeSandbox,token:ReturnType<DurableProcessManager["begin"]>,onStarted?:(id:string)=>void):Promise<ProcessRecord>{
  if(!sandbox?.verified||!this.persistence)throw Error("SECURITY_BLOCKED");
  validateProcessRequest(input);
  const request={...input,argv:[...input.argv]};
  await this.ready;token.check();
  if([...this.owned.values()].filter(e=>e.command&&e.active).length>=4)throw new DurableProcessError("PROCESS_LIMIT","Concurrent command limit");
  const id=randomUUID(),now=new Date().toISOString();
  const initial:ProcessJournalRecord={format:"gsa-process-v1",process_id:id,workspace_id:request.workspace_id,native_id:null,owner_session:this.persistence.ownerSession,revision:1,
   status:{state:"QUEUED",exit_code:null,started_at:now,ended_at:null},stopped:false,stdout:"",stderr:"",output_complete:false};
  const entry:Entry={public_id:id,workspace_id:request.workspace_id,native_id:"",active:true,record:initial,command:sandbox};
  this.owned.set(id,entry); // Reserve before any journal or execution await.
  let created=false,effects=false;
  const save=async(status:NativeProcessStatus,receipt?:SandboxedProcessReceipt)=>{
   const previous=entry.record!;
   const stopped=["SUCCEEDED","FAILED","CANCELLED"].includes(status.state);
   const next:ProcessJournalRecord={...previous,revision:previous.revision+1,status:{...status,stopped},stopped,
    stdout:receipt?.stdout??previous.stdout,stderr:receipt?.stderr??previous.stderr,output_complete:stopped&&!!receipt};
   await this.persistence!.store.save(next,previous.revision);entry.record=next;entry.active=!stopped;
  };
  try{
   await this.persistence.store.create(initial);created=true;
   token.check();
   await save({...initial.status,state:"RUNNING"});
   token.check();
   effects=true;
   let receipt:SandboxedProcessReceipt;
   try{
    const execution=sandbox.execute({...request,process_id:id});
    token.finish();onStarted?.(id);
    receipt=await execution;
    if(Buffer.byteLength(receipt.stdout)+Buffer.byteLength(receipt.stderr)>request.max_output_bytes)throw Error("OUTPUT_LIMIT_EXCEEDED");
   }catch{
    await save({state:"UNKNOWN",exit_code:null,started_at:now,ended_at:null,stopped:false});
    return {process_id:id,workspace_id:request.workspace_id,state:"UNKNOWN",created_at:now,updated_at:new Date().toISOString()};
   }
   const state:ProcessState=receipt.cancelled?"CANCELLED":receipt.output_limited||receipt.signal!==null?"UNKNOWN":receipt.timed_out?"FAILED":receipt.exit_code===0?"SUCCEEDED":receipt.exit_code===null?"UNKNOWN":"FAILED";
   const ended=new Date().toISOString();
   await save({state,exit_code:receipt.exit_code,started_at:now,ended_at:ended},receipt);
   return {process_id:id,workspace_id:request.workspace_id,state,created_at:now,updated_at:ended,receipt};
  }catch(error){
   if(!created){
    // A rejected journal publication may still have written intent. Retain uncertainty.
    entry.record={...initial,status:{...initial.status,state:"UNKNOWN"},stopped:false,output_complete:false};entry.active=true;
   }
   else{
    entry.record={...entry.record!,status:{state:"UNKNOWN",exit_code:null,started_at:now,ended_at:null,stopped:false},stopped:false,output_complete:false};
    entry.active=effects; // A failed durable final save never releases uncertain work.
    if(!effects){
     // The generation check prevented any backend call; a durable cancelled intent is honest.
     try{await save({state:"CANCELLED",exit_code:null,started_at:now,ended_at:new Date().toISOString(),stopped:true});}
     catch{entry.active=true;}
    }
   }
   throw error;
  }
 }
 private hydrate(record:ProcessJournalRecord):Entry{
  const entry={workspace_id:record.workspace_id,native_id:record.native_id??"",public_id:record.process_id,active:!record.stopped,record};
  this.owned.set(record.process_id,entry);return entry;
 }
 async list(workspaceId:string){await this.ready;return [...this.owned.values()].filter(x=>x.workspace_id===workspaceId).map(x=>({process_id:x.public_id,workspace_id:x.workspace_id}));}
 private async entry(workspaceId:string,id:string):Promise<Entry>{
  await this.ready;if(!this.owned.has(id)&&this.persistence){const record=await this.persistence.store.load(id);if(record)this.hydrate(record);}
  return this.get(workspaceId,id);
 }
 private async persist(entry:Entry,status:NativeProcessStatus,confirmedStop=false):Promise<void>{
  if(!this.persistence||!entry.record)return;
  const save=(entry.saving??Promise.resolve()).then(async()=>{
   const previous=entry.record!;
   if(previous.stopped&&status.ended_at===null)return;
   const stopped=confirmedStop||status.stopped===true||["SUCCEEDED","FAILED","CANCELLED"].includes(status.state);
   let stdout=previous.stdout,stderr=previous.stderr,output_complete=previous.output_complete;
   if(stopped&&!output_complete){
    let cursor=0;stdout="";stderr="";
    try{for(let pages=0;pages<64;pages++){
     const page=await requireNativeBackend(this.backend).output(entry.native_id,cursor,65536);stdout+=page.stdout;stderr+=page.stderr;
     if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>2097152)throw Error("PROCESS_OUTPUT_LIMIT");
     if(page.next_cursor===null){output_complete=status.state!=="UNKNOWN";break;}
     if(!Number.isSafeInteger(page.next_cursor)||page.next_cursor<=cursor)throw Error("PROCESS_OUTPUT_CURSOR");cursor=page.next_cursor;
    }}catch{stdout=previous.stdout;stderr=previous.stderr;output_complete=false;}
   }
   const record:ProcessJournalRecord={...previous,native_id:entry.native_id||null,revision:previous.revision+1,status:{...status,stopped},stopped,stdout,stderr,output_complete};
   await this.persistence!.store.save(record,previous.revision);entry.record=record;if(stopped)entry.active=false;
  });entry.saving=save.catch(()=>{});await save;
 }
 private get(workspaceId:string,publicId:string):Entry{
  const e=this.owned.get(publicId);
  if(!e||e.workspace_id!==workspaceId)throw new DurableProcessError("PROCESS_NOT_FOUND","Process not owned by workspace");
  if(e.expired)throw new DurableProcessError("PROCESS_NOT_FOUND","Native process history expired; outcome unavailable");
  return e;
 }
 start(request:SandboxedProcessRequest):Promise<{process_id:string;state:"RUNNING"}>{
  const token=this.begin(request.workspace_id);
  return this.startAdmitted(request,token).finally(token.finish);
 }
 private async startAdmitted(request:SandboxedProcessRequest,token:ReturnType<DurableProcessManager["begin"]>):Promise<{process_id:string;state:"RUNNING"}>{
  const native=requireNativeBackend(this.backend);
  await this.ready;token.check();
  if(!request.workspace_id||!request.executable||request.cwd_relative!=="."||request.network_allowed||
    !Number.isInteger(request.time_limit_ms)||request.time_limit_ms<1||request.time_limit_ms>120000||
    !Number.isInteger(request.max_output_bytes)||request.max_output_bytes<1||request.max_output_bytes>2097152||
    !Array.isArray(request.argv)||request.argv.some(a=>typeof a!=="string"||a.includes(String.fromCharCode(0))))
    throw new DurableProcessError("INVALID_PROCESS_REQUEST","Unacceptable process request");
  // Refresh completed entries without dropping their ownership or historical output.
  const entries=[...this.owned.values()].filter(x=>x.workspace_id===request.workspace_id&&x.active);
  await Promise.all(entries.map(async entry=>{
   if(entry.command||!entry.native_id)return;
   if(entry.record?.owner_session&&entry.record.owner_session!==this.persistence?.ownerSession)return;
   try{const status=this.observe(entry,await native.status(entry.native_id));await this.persist(entry,status);}
   catch(error){
    // Only an explicit native missing-identity response retires stale ownership.
    // Transport failures and UNKNOWN states still retain their authority slot.
    if((error as {code?:unknown}|null)?.code!=="PROCESS_NOT_FOUND")throw error;
    entry.active=false;entry.expired=true;
   }
  }));
  token.check();
  const active=[...this.owned.values()].filter(x=>x.workspace_id===request.workspace_id&&x.active).length;
  const pending=this.pending.get(request.workspace_id)??0;
  if(active+pending>=this.maxActive)
    throw new DurableProcessError("PROCESS_LIMIT","Active process quota exhausted");
  // Reserve before awaiting native.start so simultaneous starts share the same quota.
  this.pending.set(request.workspace_id,pending+1);
  const public_id=randomUUID();let entry:Entry|undefined,effects=false,created=false;
  try{
   if(this.persistence){
    const record:ProcessJournalRecord={format:"gsa-process-v1",process_id:public_id,workspace_id:request.workspace_id,native_id:null,owner_session:this.persistence.ownerSession,revision:1,
     status:{state:"QUEUED",exit_code:null,started_at:new Date().toISOString(),ended_at:null},stopped:false,stdout:"",stderr:"",output_complete:false};
    entry=this.hydrate(record);entry.active=false;
    await this.persistence.store.create(record);created=true;
   }
   token.check();effects=true;
   entry??={public_id,workspace_id:request.workspace_id,native_id:"",active:false};
   this.owned.set(public_id,entry);
   const started=await native.start({...request,process_id:public_id});
   if(!started.native_id)throw new DurableProcessError("INVALID_PROCESS_REQUEST","Native backend omitted process identity");
   entry??={public_id,workspace_id:request.workspace_id,native_id:started.native_id,active:true};entry.native_id=started.native_id;entry.active=true;this.owned.set(public_id,entry);
   try{token.check();}catch(error){await this.stopOwned(entry).catch(()=>{});throw error;}
   await this.persist(entry,{state:"QUEUED",exit_code:null,started_at:entry.record?.status.started_at??new Date().toISOString(),ended_at:null});
   if(this.persistence&&native.wait){const owned=entry;void native.wait(started.native_id).then(status=>this.persist(owned,status)).catch(()=>{});}
   try{token.check();}catch(error){await this.stopOwned(entry).catch(()=>{});throw error;}
   return {process_id:public_id,state:"RUNNING"};
  }catch(error){
   if(entry&&!entry.native_id){
    entry.active=true;
    const uncertain=effects||!!this.persistence&&!created;
    const status:NativeProcessStatus={state:uncertain?"UNKNOWN":"CANCELLED",exit_code:null,started_at:entry.record?.status.started_at??new Date().toISOString(),ended_at:uncertain?null:new Date().toISOString()};
    try{if(!this.persistence||created)await this.persist(entry,status,!uncertain);}
    catch{if(entry.record)entry.record={...entry.record,status:{...status,state:"UNKNOWN",stopped:false},stopped:false,output_complete:false};throw error;}
    if(uncertain&&entry.record)entry.record={...entry.record,status:{...status,stopped:false},stopped:false,output_complete:false};
    if(!this.persistence&&!effects)entry.active=false;
   }
   throw error;
  }finally{
   const remaining=(this.pending.get(request.workspace_id)??1)-1;
   if(remaining)this.pending.set(request.workspace_id,remaining);else this.pending.delete(request.workspace_id);
  }
 }
 async status(workspaceId:string,id:string):Promise<NativeProcessStatus>{
  const entry=await this.entry(workspaceId,id);
  if(entry.record?.stopped)return {...entry.record.status,stopped:true};
  if(entry.record&&entry.record.owner_session!==this.persistence?.ownerSession)return {...entry.record.status,state:"UNKNOWN",exit_code:null,stopped:false};
  if(entry.command)return {...entry.record!.status};
  if(entry.record?.native_id===null)return {...entry.record.status,state:"UNKNOWN",exit_code:null,stopped:false};
  const native=requireNativeBackend(this.backend);
  const status=this.observe(entry,await native.status(entry.native_id));await this.persist(entry,status);return status;
 }
 async output(workspaceId:string,id:string,cursor=0,limit=65536){
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>65536)
    throw new DurableProcessError("INVALID_PROCESS_REQUEST","Invalid output range");
  const entry=await this.entry(workspaceId,id);
  if(entry.record&&(entry.command||entry.record.native_id===null||entry.record.stopped||entry.record.owner_session!==this.persistence?.ownerSession)){
   const stdout=Buffer.from(entry.record.stdout),all=Buffer.concat([stdout,Buffer.from(entry.record.stderr)]);
   if(cursor>all.length||(cursor<all.length&&(all[cursor]&0xc0)===0x80))throw new DurableProcessError("INVALID_PROCESS_REQUEST","Invalid output cursor");
   let end=Math.min(all.length,cursor+limit);while(end>cursor&&end<all.length&&(all[end]&0xc0)===0x80)end--;
   if(end===cursor&&end<all.length)throw new DurableProcessError("INVALID_PROCESS_REQUEST","Output limit splits UTF-8");
   return {stdout:all.subarray(cursor,Math.min(end,stdout.length)).toString(),stderr:all.subarray(Math.max(cursor,stdout.length),end).toString(),next_cursor:end<all.length?end:null,complete:entry.record.stopped&&entry.record.output_complete};
  }
  const native=requireNativeBackend(this.backend);
  const out=await native.output(entry.native_id,cursor,limit);
  if(Buffer.byteLength(out.stdout)+Buffer.byteLength(out.stderr)>limit)
    throw new DurableProcessError("PROCESS_LIMIT","Native response violated output cap");
  return out;
 }
 async stop(workspaceId:string,id:string){
  const entry=await this.entry(workspaceId,id);
  if(entry.record?.stopped)return {stopped:true,state:entry.record.status.state};
  if(!this.currentOwner(entry))throw new DurableProcessError("PROCESS_NOT_FOUND","No live process belongs to the current owner");
  if(entry.command&&!entry.record?.stopped){
   if(!entry.command.cancel)throw Error("SECURITY_BLOCKED");
   const requested=await entry.command.cancel(id,workspaceId);
   if(entry.record?.stopped)return {requested,stopped:true,state:entry.record.status.state};
   return {requested,stopped:false,state:entry.record!.status.state};
  }
  const native=requireNativeBackend(this.backend);
  if(entry.record&&entry.record.owner_session!==this.persistence?.ownerSession)throw new DurableProcessError("PROCESS_NOT_FOUND","No live process belongs to the current owner");
  if(!entry.native_id)throw new DurableProcessError("PROCESS_NOT_FOUND","No live native identity belongs to this record");
  const result=await native.stop(entry.native_id);
  // Confirmed termination releases authority even when the outcome is UNKNOWN.
  if(result.stopped){if(this.persistence){const status=await native.status(entry.native_id).catch(()=>({state:"UNKNOWN" as const,exit_code:null,started_at:entry.record?.status.started_at??new Date().toISOString(),ended_at:new Date().toISOString()}));await this.persist(entry,status,true);}entry.active=false;}
  return result;
 }
}
