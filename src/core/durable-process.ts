import {randomUUID} from "node:crypto";
import type {SandboxedProcessRequest,VerifiedNativeProcessController,NativeProcessStatus} from "./native-io.js";
import {requireNativeBackend} from "./native-io.js";
import type {ProcessJournal,ProcessJournalRecord} from "./process-journal.js";
export interface ProcessPersistence {store:ProcessJournal;ownerSession:string}
export class DurableProcessError extends Error{
 constructor(public readonly code:"PROCESS_NOT_FOUND"|"PROCESS_LIMIT"|"INVALID_PROCESS_REQUEST"|"PROCESS_ALREADY_FINISHED",message:string){super(message);}
}
type Entry={workspace_id:string;native_id:string;public_id:string;active:boolean;expired?:boolean;record?:ProcessJournalRecord;saving?:Promise<void>};
export class DurableProcessManager{
 private readonly owned=new Map<string,Entry>();
 private readonly pending=new Map<string,number>();
 private readonly ready:Promise<void>;
 private observe(entry:Entry,status:NativeProcessStatus):NativeProcessStatus{
  if(status.stopped||["SUCCEEDED","FAILED","CANCELLED"].includes(status.state))entry.active=false;
  return status;
 }
 constructor(private readonly backend:VerifiedNativeProcessController|null,private readonly maxActive=16,private readonly persistence?:ProcessPersistence){
  this.ready=persistence?persistence.store.list().then(records=>{for(const record of records)this.hydrate(record);}):Promise.resolve();
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
 async start(request:SandboxedProcessRequest):Promise<{process_id:string;state:"RUNNING"}>{
  const native=requireNativeBackend(this.backend);
  await this.ready;
  if(!request.workspace_id||!request.executable||request.cwd_relative!=="."||request.network_allowed||
    !Number.isInteger(request.time_limit_ms)||request.time_limit_ms<1||request.time_limit_ms>120000||
    !Number.isInteger(request.max_output_bytes)||request.max_output_bytes<1||request.max_output_bytes>2097152||
    !Array.isArray(request.argv)||request.argv.some(a=>typeof a!=="string"||a.includes(String.fromCharCode(0))))
    throw new DurableProcessError("INVALID_PROCESS_REQUEST","Unacceptable process request");
  // Refresh completed entries without dropping their ownership or historical output.
  const entries=[...this.owned.values()].filter(x=>x.workspace_id===request.workspace_id&&x.active);
  await Promise.all(entries.map(async entry=>{
   if(entry.record?.owner_session&&entry.record.owner_session!==this.persistence?.ownerSession)return;
   try{this.observe(entry,await native.status(entry.native_id));}
   catch(error){
    // Only an explicit native missing-identity response retires stale ownership.
    // Transport failures and UNKNOWN states still retain their authority slot.
    if((error as {code?:unknown}|null)?.code!=="PROCESS_NOT_FOUND")throw error;
    entry.active=false;entry.expired=true;
   }
  }));
  const active=[...this.owned.values()].filter(x=>x.workspace_id===request.workspace_id&&x.active).length;
  const pending=this.pending.get(request.workspace_id)??0;
  if(active+pending>=this.maxActive)
    throw new DurableProcessError("PROCESS_LIMIT","Active process quota exhausted");
  // Reserve before awaiting native.start so simultaneous starts share the same quota.
  this.pending.set(request.workspace_id,pending+1);
  const public_id=randomUUID();let entry:Entry|undefined;
  try{
   if(this.persistence){
    const record:ProcessJournalRecord={format:"gsa-process-v1",process_id:public_id,workspace_id:request.workspace_id,native_id:null,owner_session:this.persistence.ownerSession,revision:1,
     status:{state:"QUEUED",exit_code:null,started_at:new Date().toISOString(),ended_at:null},stopped:false,stdout:"",stderr:"",output_complete:false};
    await this.persistence.store.create(record);entry=this.hydrate(record);entry.active=false;
   }
   const started=await native.start({...request,process_id:public_id});
   if(!started.native_id)throw new DurableProcessError("INVALID_PROCESS_REQUEST","Native backend omitted process identity");
   entry??={public_id,workspace_id:request.workspace_id,native_id:started.native_id,active:true};entry.native_id=started.native_id;entry.active=true;this.owned.set(public_id,entry);
   await this.persist(entry,{state:"QUEUED",exit_code:null,started_at:entry.record?.status.started_at??new Date().toISOString(),ended_at:null});
   if(this.persistence&&native.wait){const owned=entry;void native.wait(started.native_id).then(status=>this.persist(owned,status)).catch(()=>{});}
   return {process_id:public_id,state:"RUNNING"};
  }catch(error){
   if(entry&&!entry.native_id){entry.active=false;await this.persist(entry,{state:"UNKNOWN",exit_code:null,started_at:entry.record?.status.started_at??new Date().toISOString(),ended_at:new Date().toISOString()},true);}
   throw error;
  }finally{
   const remaining=(this.pending.get(request.workspace_id)??1)-1;
   if(remaining)this.pending.set(request.workspace_id,remaining);else this.pending.delete(request.workspace_id);
  }
 }
 async status(workspaceId:string,id:string):Promise<NativeProcessStatus>{
  const native=requireNativeBackend(this.backend);
  const entry=await this.entry(workspaceId,id);
  if(entry.record&&(entry.record.stopped||entry.record.owner_session!==this.persistence?.ownerSession))return {...entry.record.status,stopped:entry.record.stopped};
  const status=this.observe(entry,await native.status(entry.native_id));await this.persist(entry,status);return status;
 }
 async output(workspaceId:string,id:string,cursor=0,limit=65536){
  const native=requireNativeBackend(this.backend);
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>65536)
    throw new DurableProcessError("INVALID_PROCESS_REQUEST","Invalid output range");
  const entry=await this.entry(workspaceId,id);
  if(entry.record&&(entry.record.stopped||entry.record.owner_session!==this.persistence?.ownerSession)){
   const stdout=Buffer.from(entry.record.stdout),all=Buffer.concat([stdout,Buffer.from(entry.record.stderr)]);
   if(cursor>all.length||(cursor<all.length&&(all[cursor]&0xc0)===0x80))throw new DurableProcessError("INVALID_PROCESS_REQUEST","Invalid output cursor");
   let end=Math.min(all.length,cursor+limit);while(end>cursor&&end<all.length&&(all[end]&0xc0)===0x80)end--;
   if(end===cursor&&end<all.length)throw new DurableProcessError("INVALID_PROCESS_REQUEST","Output limit splits UTF-8");
   return {stdout:all.subarray(cursor,Math.min(end,stdout.length)).toString(),stderr:all.subarray(Math.max(cursor,stdout.length),end).toString(),next_cursor:end<all.length?end:null,complete:entry.record.output_complete};
  }
  const out=await native.output(entry.native_id,cursor,limit);
  if(Buffer.byteLength(out.stdout)+Buffer.byteLength(out.stderr)>limit)
    throw new DurableProcessError("PROCESS_LIMIT","Native response violated output cap");
  return out;
 }
 async stop(workspaceId:string,id:string){
  const native=requireNativeBackend(this.backend);
  const entry=await this.entry(workspaceId,id);
  if(entry.record?.stopped)return {stopped:true,state:entry.record.status.state};
  const result=await native.stop(entry.native_id);
  // Confirmed termination releases authority even when the outcome is UNKNOWN.
  if(result.stopped){entry.active=false;if(this.persistence){const status=await native.status(entry.native_id).catch(()=>({state:"UNKNOWN" as const,exit_code:null,started_at:entry.record?.status.started_at??new Date().toISOString(),ended_at:new Date().toISOString()}));await this.persist(entry,status,true);}}
  return result;
 }
}
