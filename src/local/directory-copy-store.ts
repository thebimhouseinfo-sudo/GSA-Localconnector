import fs from "node:fs/promises";
import {constants} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {assertDirectoryCopyId,assertDirectoryCopyIntentBudget,cloneDirectoryCopyIntent,cloneDirectoryCopyRecord,directoryCopySchedule,DirectoryCopyError,type DirectoryCopyIntent,type DirectoryCopyRecord,type DirectoryCopyStoreApi} from "../core/directory-copy.js";

const MAX=1_048_576;
const fail=(code:string,message:string):never=>{throw new DirectoryCopyError(code,message);};
const identity=(s:{dev:bigint;ino:bigint})=>`${s.dev}:${s.ino}`;
/** Protected metadata only. No default live identity root, native effects or mutation replay. */
export class DirectoryCopyStore implements DirectoryCopyStoreApi {
 readonly rootDirectory:string;
 private readonly root:string;
 private rootIdentity:string|undefined;
 constructor(root:string){
  if(typeof root!=="string"||!path.isAbsolute(root)||path.normalize(root)!==root)fail("INVALID_DIRECTORY_COPY","A canonical absolute journal directory is required");
  this.root=root;this.rootDirectory=root;Object.defineProperty(this,"rootDirectory",{writable:false,configurable:false});
 }
 private async directory():Promise<void>{
  const uid=process.getuid?.();if(uid===undefined)fail("SECURITY_BLOCKED","Verified POSIX ownership is required");
  // Reject aliases and writable ancestry; root-owned sticky temporary parents are permitted.
  const ancestors:string[]=[];for(let p=path.dirname(this.root);;p=path.dirname(p)){ancestors.unshift(p);if(p===path.dirname(p))break;}
  for(const p of ancestors){
   const s=await fs.lstat(p);
   if(!s.isDirectory()||s.isSymbolicLink()||![0,uid].includes(s.uid)||((s.mode&0o022)!==0&&!(s.uid===0&&(s.mode&0o1000)!==0)))fail("INVALID_DIRECTORY_COPY","Unsafe journal ancestry");
  }
  const s=await fs.lstat(this.root,{bigint:true});
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==BigInt(uid!)||(s.mode&0o777n)!==0o700n||await fs.realpath(this.root)!==this.root)fail("INVALID_DIRECTORY_COPY","Unsafe journal directory");
  const current=identity(s);if(this.rootIdentity!==undefined&&this.rootIdentity!==current)fail("INVALID_DIRECTORY_COPY","Journal directory changed");this.rootIdentity=current;
 }
 private file(id:string):string {assertDirectoryCopyId(id);return path.join(this.root,id+".json");}
 private async syncDirectory():Promise<void>{const fd=await fs.open(this.root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await fd.sync();}finally{await fd.close();}}
 async load(id:string):Promise<DirectoryCopyRecord>{
  const file=this.file(id);await this.directory();
  let fd;try{fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")fail("DIRECTORY_COPY_NOT_FOUND","Unknown transaction");throw error;}
  try{
   const before=await fd.stat({bigint:true});
   if(!before.isFile()||before.nlink!==1n||before.uid!==BigInt(process.getuid!())||(before.mode&0o777n)!==0o600n)fail("INVALID_DIRECTORY_COPY","Unsafe journal record");
   if(before.size>BigInt(MAX))fail("DIRECTORY_COPY_RECORD_LIMIT","Journal metadata exceeds size limit");
   const data=Buffer.alloc(Number(before.size)+1);let count=0;
   while(count<data.length){const r=await fd.read(data,count,data.length-count,count);if(!r.bytesRead)break;count+=r.bytesRead;}
   const after=await fd.stat({bigint:true}),named=await fs.lstat(file,{bigint:true});await this.directory();
   if(count!==Number(before.size)||identity(before)!==identity(after)||identity(before)!==identity(named)||before.ctimeNs!==after.ctimeNs||before.mtimeNs!==after.mtimeNs||after.nlink!==1n)fail("INVALID_DIRECTORY_COPY","Journal record changed while reading");
   const encoded=data.subarray(0,count),decoded=encoded.toString("utf8");
   if(!Buffer.from(decoded).equals(encoded))fail("INVALID_DIRECTORY_COPY","Invalid journal UTF-8 encoding");
   let parsed:unknown;try{parsed=JSON.parse(decoded);}catch{fail("INVALID_DIRECTORY_COPY","Invalid journal encoding");}
   const record=cloneDirectoryCopyRecord(parsed as DirectoryCopyRecord);if(record.copy_id!==id)fail("INVALID_DIRECTORY_COPY","Journal identity mismatch");return record;
  }finally{await fd.close();}
 }
 private async locked<T>(id:string,operation:()=>Promise<T>):Promise<T>{
  assertDirectoryCopyId(id);await this.directory();
  const lock=path.join(this.root,id+".lock");let fd;
  try{fd=await fs.open(lock,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}
  catch(error){if((error as NodeJS.ErrnoException).code==="EEXIST")fail("DIRECTORY_COPY_LOCKED","Transaction lock exists; automatic stale-lock removal is forbidden");throw error;}
  let owned;
  try{owned=await fd.stat({bigint:true});}
  catch(error){
   // Identity is unverified: close our descriptor, but retain the named lock.
   try{await fd.close();}
   catch{throw new DirectoryCopyError("RESULT_UNKNOWN","Initial lock identity and descriptor release are uncertain; inspect durable state");}
   throw error;
  }
  try{await fd.sync();await this.syncDirectory();await this.directory();return await operation();}
  finally{
   try{
    await fd.close();
    // Never remove a replacement lock belonging to another writer.
    const named=await fs.lstat(lock,{bigint:true});
    if(identity(named)!==identity(owned)||!named.isFile()||named.nlink!==1n)fail("RESULT_UNKNOWN","Transaction lock ownership changed; inspect durable state");
    await this.directory();await fs.unlink(lock);await this.syncDirectory();
   }catch{throw new DirectoryCopyError("RESULT_UNKNOWN","Journal operation or lock release is uncertain; inspect durable state");}
  }
 }
 private async publish(record:DirectoryCopyRecord,exclusive:boolean):Promise<void>{
  const copy=cloneDirectoryCopyRecord(record),encoded=JSON.stringify(copy)+"\n";
  if(Buffer.byteLength(encoded)>MAX)fail("DIRECTORY_COPY_RECORD_LIMIT","Journal metadata exceeds limit");
  const target=this.file(copy.copy_id),temporary=path.join(this.root,".transaction-"+randomUUID());let published=false,tempExists=false;
  try{
   await this.directory();const fd=await fs.open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);tempExists=true;
   try{await fd.writeFile(encoded);await fd.sync();}finally{await fd.close();}
   await this.directory();
   if(exclusive){
    // Link publishes a complete inode without overwriting an existing ID. The brief
    // two-link window is rejected by readers until the private temp name is removed.
    await fs.link(temporary,target);published=true;
    await fs.unlink(temporary);tempExists=false;
   }else{await fs.rename(temporary,target);published=true;tempExists=false;}
   await this.syncDirectory();await this.directory();
  }catch(error){if(published)throw new DirectoryCopyError("RESULT_UNKNOWN","Journal publication may have completed; inspect the transaction before continuing");throw error;}
  finally{if(tempExists&&!published){await this.directory();await fs.unlink(temporary);}}
 }
 async create(id:string,intent:DirectoryCopyIntent):Promise<{record:DirectoryCopyRecord;created:boolean}>{
  assertDirectoryCopyId(id);const captured=cloneDirectoryCopyIntent(intent);assertDirectoryCopyIntentBudget(captured);
  const candidate=cloneDirectoryCopyRecord({format:"gsa-directory-copy-record-v1",copy_id:id,revision:1,intent:captured,status:"PENDING",acknowledged:[],pending_path:null,reason:"INTENT_DURABLE"});
  return this.locked(id,async()=>{
   try{const record=await this.load(id);if(!isDeepStrictEqual(record.intent,captured))fail("DIRECTORY_COPY_INTENT_CONFLICT","Copy ID already binds different intent");return {record,created:false};}
   catch(error){if(!(error instanceof DirectoryCopyError)||error.code!=="DIRECTORY_COPY_NOT_FOUND")throw error;}
   await this.publish(candidate,true);return {record:cloneDirectoryCopyRecord(candidate),created:true};
  });
 }
 private async change(id:string,expectedRevision:number,transform:(record:DirectoryCopyRecord)=>DirectoryCopyRecord):Promise<DirectoryCopyRecord>{
  assertDirectoryCopyId(id);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail("DIRECTORY_COPY_REVISION_CONFLICT","Invalid expected revision");
  return this.locked(id,async()=>{
   const record=await this.load(id);
   if(record.status!=="PENDING")fail("DIRECTORY_COPY_TERMINAL","Terminal copy record is immutable");
   if(record.revision!==expectedRevision||record.revision===Number.MAX_SAFE_INTEGER)fail("DIRECTORY_COPY_REVISION_CONFLICT","Stale copy revision");
   const next=cloneDirectoryCopyRecord({...transform(record),revision:record.revision+1});await this.publish(next,false);return next;
  });
 }
 async beginEntry(id:string,expectedRevision:number,path:string):Promise<DirectoryCopyRecord>{
  if(typeof path!=="string")fail("INVALID_DIRECTORY_COPY","Invalid path");
  return this.change(id,expectedRevision,record=>{
   if(record.pending_path!==null||directoryCopySchedule(record.intent.manifest)[record.acknowledged.length]?.path!==path)fail("INVALID_DIRECTORY_COPY","Invalid pending entry schedule path");
   return {...record,pending_path:path};
  });
 }
 async acknowledgeEntry(id:string,expectedRevision:number,path:string,kind:"directory"|"file"):Promise<DirectoryCopyRecord>{
  if(typeof path!=="string"||!["directory","file"].includes(kind))fail("INVALID_DIRECTORY_COPY","Invalid path/kind");
  return this.change(id,expectedRevision,record=>{
   const next=directoryCopySchedule(record.intent.manifest)[record.acknowledged.length];
   if(record.pending_path===null||record.pending_path!==path||next?.kind!==kind)fail("INVALID_DIRECTORY_COPY","Invalid pending acknowledgement kind/sequence");
   return {...record,acknowledged:[...record.acknowledged,{path,kind}],pending_path:null};
  });
 }
 async finish(id:string,expectedRevision:number,status:"APPLIED"|"CONFLICT"|"UNKNOWN",reason:string):Promise<DirectoryCopyRecord>{
  if(!["APPLIED","CONFLICT","UNKNOWN"].includes(status)||typeof reason!=="string"||!reason||Buffer.byteLength(reason)>256||Buffer.from(reason).toString("utf8")!==reason)fail("INVALID_DIRECTORY_COPY","Invalid terminal status/reason");
  return this.change(id,expectedRevision,record=>({...record,status,reason}));
 }
}
