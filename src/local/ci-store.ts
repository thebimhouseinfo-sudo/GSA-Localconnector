import fs from "node:fs/promises";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {identityDirectory} from "./identity.js";
import {reconcileInterruptedRun,type CiRunRecord} from "../core/ci-journal.js";

/** Supervisor-owned CI journal. No child process may be granted access here.
 * Atomic updates within one filesystem; concurrent writers need revision guards.
 */
export class CiStoreError extends Error {
 constructor(public readonly code:"INVALID_RUN_ID"|"RUN_NOT_FOUND"|"RUN_REVISION_CONFLICT"|"INVALID_RUN_RECORD",message:string){super(message);}
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const assertId=(id:string)=>{if(!UUID.test(id))throw new CiStoreError("INVALID_RUN_ID","Invalid run ID");};
function checkRecord(r:CiRunRecord):void {
 assertId(r.run_id);
 if(!r.workspace_id||!r.workflow||!Number.isSafeInteger(r.revision)||r.revision<1||!/^[a-f0-9]{64}$/.test(r.source_sha256))throw new CiStoreError("INVALID_RUN_RECORD","Invalid CI record");
}
export class CiJournalStore {
 constructor(private readonly root=path.join(identityDirectory(),"ci-runs")){}
 private recordPath(id:string):string{assertId(id);return path.join(this.root,id+".json");}
 async load(id:string):Promise<CiRunRecord>{
  let data:string;
  try{data=await fs.readFile(this.recordPath(id),"utf8");}
  catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")throw new CiStoreError("RUN_NOT_FOUND","Run does not exist");throw e;}
  const record=JSON.parse(data) as CiRunRecord;
  checkRecord(record);
  if(record.run_id!==id)throw new CiStoreError("INVALID_RUN_RECORD","Identity mismatch");
  return record;
 }
 async save(record:CiRunRecord,expectedRevision:number|null):Promise<void>{
  checkRecord(record);
  if(expectedRevision===null){
   await fs.mkdir(this.root,{recursive:true,mode:0o700});
   await fs.writeFile(this.recordPath(record.run_id),JSON.stringify(record)+"\n",{flag:"wx",mode:0o600});
   return;
  }
  const lock=this.recordPath(record.run_id)+".lock";
  let handle:Awaited<ReturnType<typeof fs.open>>;
  try{handle=await fs.open(lock,"wx",0o600);}
  catch(e){
   if((e as NodeJS.ErrnoException).code==="EEXIST")throw new CiStoreError("RUN_REVISION_CONFLICT","Record is already being updated");
   throw e;
  }
  try{
   const previous=await this.load(record.run_id);
   if(previous.revision!==expectedRevision||record.revision!==expectedRevision+1)throw new CiStoreError("RUN_REVISION_CONFLICT","Stale revision");
   const tmp=path.join(this.root,".run-"+randomBytes(12).toString("hex"));
   try{
    await fs.writeFile(tmp,JSON.stringify(record)+"\n",{flag:"wx",mode:0o600});
    await fs.rename(tmp,this.recordPath(record.run_id));
   }finally{await fs.rm(tmp,{force:true});}
  }finally{await handle.close();await fs.rm(lock,{force:true});}
 }
 /** Recovery is an explicit supervisor operation; each transition is persisted with
  * revision preconditions. A stale lock or conflicting writer stops recovery.
  */
 async reconcileInterrupted():Promise<{recovered:string[];unchanged:number}>{
  let files:string[];
  try{files=await fs.readdir(this.root);}
  catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {recovered:[],unchanged:0};throw e;}
  const recovered:string[]=[];let unchanged=0;
  for(const file of files.filter(x=>x.endsWith(".json")&&UUID.test(x.slice(0,-5))).sort()){
   const r=await this.load(file.slice(0,-5));
   const next=reconcileInterruptedRun(r);
   if(next===r){unchanged++;continue;}
   await this.save(next,r.revision);
   recovered.push(r.run_id);
  }
  return {recovered,unchanged};
 }
 async list():Promise<Array<{run_id:string;workspace_id:string;state:string;revision:number}>>{
  let files:string[];
  try{files=await fs.readdir(this.root);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return [];throw e;}
  const records=[];
  for(const file of files.filter(x=>UUID.test(x.replace(/\.json$/,""))&&x.endsWith(".json")).slice(0,1000)){
   const r=await this.load(file.slice(0,-5));
   records.push({run_id:r.run_id,workspace_id:r.workspace_id,state:r.state,revision:r.revision});
  }
  return records;
 }
}
