import fs from "node:fs/promises";
import {constants} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import type {ProcessJournal,ProcessJournalRecord} from "../core/process-journal.js";
import {requireProtectedState} from "./protected-state.js";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const bad:(code?:string)=>never=(code="PROCESS_JOURNAL_UNSAFE")=>{throw Object.assign(Error(code),{code});};
export class ProcessJournalStore implements ProcessJournal {
 private readonly pending=new Map<string,Promise<unknown>>();
 constructor(private readonly root:string){}
 private file(id:string){if(!UUID.test(id))bad("PROCESS_NOT_FOUND");return path.join(this.root,id+".json");}
 private async directory(){
  requireProtectedState();await fs.mkdir(this.root,{recursive:true,mode:0o700});
  const info=await fs.lstat(this.root);if(!info.isDirectory()||info.uid!==process.getuid?.()||(info.mode&0o077))bad();
 }
 private validate(r:ProcessJournalRecord){
  if(!r||r.format!=="gsa-process-v1"||!UUID.test(r.process_id)||!UUID.test(r.owner_session)||!r.workspace_id||
   !Number.isSafeInteger(r.revision)||r.revision<1||(r.native_id!==null&&(typeof r.native_id!=="string"||r.native_id.length>256))||
   typeof r.stopped!=="boolean"||typeof r.output_complete!=="boolean"||typeof r.stdout!=="string"||typeof r.stderr!=="string"||
   Buffer.byteLength(r.stdout)+Buffer.byteLength(r.stderr)>2097152||!r.status||!["QUEUED","RUNNING","SUCCEEDED","FAILED","CANCELLED","UNKNOWN"].includes(r.status.state)||
   !(r.status.exit_code===null||Number.isInteger(r.status.exit_code))||typeof r.status.started_at!=="string"||
   !(r.status.ended_at===null||typeof r.status.ended_at==="string"))bad();
 }
 async load(id:string):Promise<ProcessJournalRecord|null>{
  await this.directory();let fd:Awaited<ReturnType<typeof fs.open>>;
  try{fd=await fs.open(this.file(id),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}
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
 async create(record:ProcessJournalRecord){await this.write(record,true);}
 async save(record:ProcessJournalRecord,expectedRevision:number):Promise<void>{
  const task=(this.pending.get(record.process_id)??Promise.resolve()).then(async()=>{
   const previous=await this.load(record.process_id);if(!previous||previous.revision!==expectedRevision||record.revision!==expectedRevision+1)bad("PROCESS_REVISION_CONFLICT");
   if(previous.stopped&&previous.output_complete)bad("PROCESS_TERMINAL_IMMUTABLE");
   if(record.workspace_id!==previous.workspace_id||record.owner_session!==previous.owner_session||
    (previous.native_id!==null&&record.native_id!==previous.native_id))bad();
   await this.write(record,false);
  });
  const retained=task.catch(()=>{});this.pending.set(record.process_id,retained);try{await task;}finally{if(this.pending.get(record.process_id)===retained)this.pending.delete(record.process_id);}
 }
 async list():Promise<ProcessJournalRecord[]>{
  await this.directory();const names=(await fs.readdir(this.root)).filter(name=>name.endsWith(".json")&&UUID.test(name.slice(0,-5)));
  if(names.length>10000)bad("PROCESS_JOURNAL_QUOTA");
  const dated=await Promise.all(names.map(async name=>({name,mtime:(await fs.lstat(path.join(this.root,name))).mtimeMs})));
  const records=await Promise.all(dated.sort((a,b)=>b.mtime-a.mtime).slice(0,1000).map(({name})=>this.load(name.slice(0,-5))));
  return records.filter((record):record is ProcessJournalRecord=>record!==null);
 }
 async reconcileAfterOwnerFence(session:string):Promise<void>{
  if(process.env.GSA_OWNER_LOCK_FD!=="3"||process.env.GSA_OWNER_SESSION!==session||!UUID.test(session))bad("SERVER_OWNER_REQUIRED");
  for(const record of await this.list()){
   if(record.owner_session===session||record.stopped)continue;
   await this.save({...record,revision:record.revision+1,status:{...record.status,state:"UNKNOWN",exit_code:null,ended_at:new Date().toISOString(),stopped:true},stopped:true,output_complete:false},record.revision);
  }
 }
}
