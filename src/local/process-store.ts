import fs from "node:fs/promises";
import {constants} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import type {ProcessJournal,ProcessJournalRecord} from "../core/process-journal.js";
import {requireProtectedState} from "./protected-state.js";
import {withProtectedJournalLock} from "./protected-journal-io.js";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const bad:(code?:string)=>never=(code="PROCESS_JOURNAL_UNSAFE")=>{throw Object.assign(Error(code),{code});};
export class ProcessJournalStore implements ProcessJournal {
 private readonly unreadable=new Set<string>();
 private readonly unresolved=new Set<string>();
 private listing:Promise<ProcessJournalRecord[]>|undefined;
 health(){return {unreadable_records:this.unreadable.size,unresolved_records:this.unresolved.size,admission_blocked:this.unreadable.size>0||this.unresolved.size>0};}
 private readonly pending=new Map<string,Promise<unknown>>();
 constructor(private readonly root:string){}
 private file(id:string){if(!UUID.test(id))bad("PROCESS_NOT_FOUND");return path.join(this.root,id+".json");}
 private async directory(){
  requireProtectedState();await fs.mkdir(this.root,{recursive:true,mode:0o700});
  const info=await fs.lstat(this.root);if(!info.isDirectory()||info.uid!==process.getuid?.()||(info.mode&0o077))bad();
 }
 private locked<T>(id:string,operation:()=>Promise<T>):Promise<T>{
  this.file(id);
  return withProtectedJournalLock({root:this.root,directory:()=>this.directory(),
   syncDirectory:async()=>{},durableLock:false,lockedCode:"PROCESS_JOURNAL_LOCKED",
   error:(code,message)=>Object.assign(Error(message),{code})},id,operation);
 }
 private validate(r:ProcessJournalRecord){
  if(!r||r.format!=="gsa-process-v1"||!UUID.test(r.process_id)||!UUID.test(r.owner_session)||!r.workspace_id||
   !Number.isSafeInteger(r.revision)||r.revision<1||(r.native_id!==null&&(typeof r.native_id!=="string"||r.native_id.length>256))||
   (r.output_limited!==undefined&&typeof r.output_limited!=="boolean")||typeof r.stopped!=="boolean"||typeof r.output_complete!=="boolean"||typeof r.stdout!=="string"||typeof r.stderr!=="string"||
   Buffer.byteLength(r.stdout)+Buffer.byteLength(r.stderr)>2097152||!r.status||!["QUEUED","RUNNING","SUCCEEDED","FAILED","CANCELLED","UNKNOWN"].includes(r.status.state)||
   !(r.status.exit_code===null||Number.isInteger(r.status.exit_code))||typeof r.status.started_at!=="string"||
   !(r.status.ended_at===null||typeof r.status.ended_at==="string"))bad();
 }
 private async archiveDirectory(create=false):Promise<boolean>{
  const archive=path.join(this.root,"archive");
  if(create)await fs.mkdir(archive,{mode:0o700,recursive:true});
  let info;try{info=await fs.lstat(archive);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}
  if(!info.isDirectory()||info.uid!==process.getuid?.()||(info.mode&0o077))bad();return true;
 }
 async load(id:string):Promise<ProcessJournalRecord|null>{
  await this.directory();const current=await this.readRecord(this.file(id),id);if(current)return current;
  if(!await this.archiveDirectory())return null;
  return this.readRecord(path.join(this.root,"archive",id+".json"),id);
 }
 private async readRecord(file:string,id:string):Promise<ProcessJournalRecord|null>{
  let fd:Awaited<ReturnType<typeof fs.open>>;
  try{fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}
  try{
   const info=await fd.stat();if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid?.()||(info.mode&0o077)||info.size>13*1024*1024)bad();
   const data=Buffer.alloc(info.size);let offset=0;while(offset<data.length){const n=await fd.read(data,offset,data.length-offset,offset);if(!n.bytesRead)bad();offset+=n.bytesRead;}
   if((await fd.read(Buffer.alloc(1),0,1,offset)).bytesRead)bad();
   const after=await fd.stat();if(after.size!==info.size||after.ctimeMs!==info.ctimeMs||after.mtimeMs!==info.mtimeMs)bad();
   const record=JSON.parse(data.toString("utf8"));this.validate(record);if(record.process_id!==id)bad();return record;
  }finally{await fd.close();}
 }
 private async write(record:ProcessJournalRecord,exclusive:boolean){
  this.validate(record);await this.directory();const destination=this.file(record.process_id),temporary=path.join(this.root,".process-"+randomUUID());
  const fd=await fs.open(exclusive?destination:temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{try{await fd.writeFile(JSON.stringify(record)+"\n");await fd.sync();}finally{await fd.close();}
   if(!exclusive)await fs.rename(temporary,destination);
   const directory=await fs.open(this.root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await directory.sync();}finally{await directory.close();}
  }finally{if(!exclusive)await fs.rm(temporary,{force:true});}
 }
 async create(record:ProcessJournalRecord){
  this.validate(record);
  await this.locked(record.process_id,async()=>{
   if(await this.load(record.process_id))bad("EEXIST");
   await this.write(record,true);
  });
 }
 async save(record:ProcessJournalRecord,expectedRevision:number):Promise<void>{
  const task=(this.pending.get(record.process_id)??Promise.resolve()).then(()=>this.locked(record.process_id,async()=>{
   const previous=await this.load(record.process_id);if(!previous||previous.revision!==expectedRevision||record.revision!==expectedRevision+1)bad("PROCESS_REVISION_CONFLICT");
   if(previous.stopped&&previous.output_complete)bad("PROCESS_TERMINAL_IMMUTABLE");
   if(record.workspace_id!==previous.workspace_id||record.owner_session!==previous.owner_session||
    (previous.native_id!==null&&record.native_id!==previous.native_id))bad();
   await this.write(record,false);
  }));
  const retained=task.catch(()=>{});this.pending.set(record.process_id,retained);try{await task;}finally{if(this.pending.get(record.process_id)===retained)this.pending.delete(record.process_id);}
 }
 private async available(id:string):Promise<ProcessJournalRecord|null>{
  try{const record=await this.load(id);this.unreadable.delete(id);return record;}catch{
   this.unreadable.add(id);
   // Preserve damaged evidence; never infer that an unreadable process stopped.
   process.stderr.write("PROCESS_JOURNAL_UNREADABLE "+id+"\n");return null;
  }
 }
 list():Promise<ProcessJournalRecord[]>{
  if(!this.listing)this.listing=this.scan().finally(()=>{this.listing=undefined;});
  return this.listing;
 }
 private async scan():Promise<ProcessJournalRecord[]>{
  await this.directory();this.unreadable.clear();
  const names=(await fs.readdir(this.root)).filter(name=>name.endsWith(".json")&&UUID.test(name.slice(0,-5)));
  const rows:Array<{record:ProcessJournalRecord;name:string;mtime:number}>=[];
  for(const name of names){
   const record=await this.available(name.slice(0,-5));if(!record)continue;
   try{rows.push({record,name,mtime:(await fs.lstat(path.join(this.root,name))).mtimeMs});}
   catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  }
  rows.sort((a,b)=>b.mtime-a.mtime);let sealed=0,moved=false;
  const active:ProcessJournalRecord[]=[];
  for(const row of rows){
   const r=row.record;
   if(r.stopped&&r.output_complete&&r.status.state!=="UNKNOWN"&&++sealed>1000){
    try{
     const archived=await this.locked(r.process_id,async()=>{
      // Another store may have moved or updated this ID after the scan.
      const current=await this.readRecord(this.file(r.process_id),r.process_id);
      if(!current)return true;
      if(!current.stopped||!current.output_complete||current.status.state==="UNKNOWN")return false;
      await this.archiveDirectory(true);
      const target=path.join(this.root,"archive",row.name);
      if(await this.readRecord(target,r.process_id))bad("PROCESS_JOURNAL_DUPLICATE");
      await fs.rename(this.file(r.process_id),target);moved=true;return true;
     });
     if(!archived)active.push(r);
    }catch(error){
     // A competing writer may finish first; archival is retryable housekeeping.
     if((error as NodeJS.ErrnoException).code!=="PROCESS_JOURNAL_LOCKED")throw error;
     active.push(r);
    }
   }else active.push(r);
  }
  if(moved)for(const directory of [this.root,path.join(this.root,"archive")]){
   const fd=await fs.open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await fd.sync();}finally{await fd.close();}
  }
  return active.slice(0,1000);
 }
 async reconcileAfterOwnerFence(session:string):Promise<void>{
  if(process.env.GSA_OWNER_LOCK_FD!=="3"||process.env.GSA_OWNER_SESSION!==session||!UUID.test(session))bad("SERVER_OWNER_REQUIRED");
  await this.directory();
  // Reconciliation is not a display page: every prior-owner intent must be fenced.
  for(const name of await fs.readdir(this.root)){
   if(!name.endsWith(".json")||!UUID.test(name.slice(0,-5)))continue;
   const record=await this.available(name.slice(0,-5));if(!record)continue;
   if(record.owner_session===session||record.stopped){this.unresolved.delete(record.process_id);continue;}
   // Losing the old owner fence is not proof that detached native descendants
   // stopped. Preserve uncertain ownership and block new process admission
   // until actual OS provenance can be obtained; never invent terminal status.
   if(record.status.state==="UNKNOWN"&&!record.stopped){this.unresolved.add(record.process_id);continue;}
   try{
    await this.save({...record,revision:record.revision+1,status:{...record.status,state:"UNKNOWN",exit_code:null,ended_at:null,stopped:false},stopped:false,output_complete:false},record.revision);
    this.unresolved.add(record.process_id);
   }catch(error){
    if((error as NodeJS.ErrnoException).code!=="PROCESS_JOURNAL_LOCKED")throw error;
    // Preserve the lock and uncertain intent; diagnostics may start, commands may not.
    this.unresolved.add(record.process_id);
    process.stderr.write("PROCESS_JOURNAL_RECONCILIATION_BLOCKED "+record.process_id+"\n");
   }
  }
 }
}
