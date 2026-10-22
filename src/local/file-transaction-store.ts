import fs from "node:fs/promises";
import {constants} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {assertFileTransactionId,cloneFileTransaction,newFileTransaction,reconcileFileTransaction,transitionFileTransaction,FileTransactionError,type FileTransactionIntent,type FileTransactionReadback,type FileTransactionRecord} from "../core/file-transactions.js";

const MAX=32768;
const fail=(code:string,message:string):never=>{throw new FileTransactionError(code,message);};
const identity=(s:{dev:bigint;ino:bigint})=>`${s.dev}:${s.ino}`;
/** Protected metadata only. No default live identity root, native effects or mutation replay. */
export class FileTransactionStore {
 private readonly root:string;
 private rootIdentity:string|undefined;
 constructor(root:string){
  if(typeof root!=="string"||!path.isAbsolute(root)||path.normalize(root)!==root)fail("UNSAFE_FILE_TRANSACTION_STORE","A canonical absolute journal directory is required");
  this.root=root;
 }
 private async directory(create=false):Promise<void>{
  const uid=process.getuid?.();if(uid===undefined)fail("SECURITY_BLOCKED","Verified POSIX ownership is required");
  // Reject aliases and writable ancestry; root-owned sticky temporary parents are permitted.
  const ancestors:string[]=[];for(let p=path.dirname(this.root);;p=path.dirname(p)){ancestors.unshift(p);if(p===path.dirname(p))break;}
  for(const p of ancestors){
   const s=await fs.lstat(p);
   if(!s.isDirectory()||s.isSymbolicLink()||![0,uid].includes(s.uid)||((s.mode&0o022)!==0&&!(s.uid===0&&(s.mode&0o1000)!==0)))fail("UNSAFE_FILE_TRANSACTION_STORE","Unsafe journal ancestry");
  }
  if(create){try{await fs.mkdir(this.root,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}}
  const s=await fs.lstat(this.root,{bigint:true});
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==BigInt(uid!)||(s.mode&0o777n)!==0o700n||await fs.realpath(this.root)!==this.root)fail("UNSAFE_FILE_TRANSACTION_STORE","Unsafe journal directory");
  const current=identity(s);if(this.rootIdentity!==undefined&&this.rootIdentity!==current)fail("UNSAFE_FILE_TRANSACTION_STORE","Journal directory changed");this.rootIdentity=current;
 }
 private file(id:string):string {assertFileTransactionId(id);return path.join(this.root,id+".json");}
 private async syncDirectory():Promise<void>{const fd=await fs.open(this.root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await fd.sync();}finally{await fd.close();}}
 async load(id:string):Promise<FileTransactionRecord>{
  const file=this.file(id);await this.directory();
  let fd;try{fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")fail("FILE_TRANSACTION_NOT_FOUND","Unknown transaction");throw error;}
  try{
   const before=await fd.stat({bigint:true});
   if(!before.isFile()||before.nlink!==1n||before.uid!==BigInt(process.getuid!())||(before.mode&0o777n)!==0o600n||before.size>BigInt(MAX))fail("UNSAFE_FILE_TRANSACTION_RECORD","Unsafe journal record");
   const data=Buffer.alloc(Number(before.size)+1);let count=0;
   while(count<data.length){const r=await fd.read(data,count,data.length-count,count);if(!r.bytesRead)break;count+=r.bytesRead;}
   const after=await fd.stat({bigint:true}),named=await fs.lstat(file,{bigint:true});await this.directory();
   if(count!==Number(before.size)||identity(before)!==identity(after)||identity(before)!==identity(named)||before.ctimeNs!==after.ctimeNs||before.mtimeNs!==after.mtimeNs||after.nlink!==1n)fail("UNSAFE_FILE_TRANSACTION_RECORD","Journal record changed while reading");
   let parsed:unknown;try{parsed=JSON.parse(data.subarray(0,count).toString("utf8"));}catch{fail("INVALID_FILE_TRANSACTION","Invalid journal encoding");}
   const record=cloneFileTransaction(parsed as FileTransactionRecord);if(record.transaction_id!==id)fail("INVALID_FILE_TRANSACTION","Journal identity mismatch");return record;
  }finally{await fd.close();}
 }
 private async locked<T>(id:string,operation:()=>Promise<T>):Promise<T>{
  assertFileTransactionId(id);await this.directory(true);
  const lock=path.join(this.root,id+".lock");let fd;
  try{fd=await fs.open(lock,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}
  catch(error){if((error as NodeJS.ErrnoException).code==="EEXIST")fail("FILE_TRANSACTION_LOCKED","Transaction lock exists; automatic stale-lock removal is forbidden");throw error;}
  const owned=await fd.stat({bigint:true});
  try{await fd.sync();await this.syncDirectory();await this.directory();return await operation();}
  finally{
   try{
    await fd.close();
    // Never remove a replacement lock belonging to another writer.
    const named=await fs.lstat(lock,{bigint:true});
    if(identity(named)!==identity(owned)||!named.isFile()||named.nlink!==1n)fail("RESULT_UNKNOWN","Transaction lock ownership changed; inspect durable state");
    await this.directory();await fs.unlink(lock);await this.syncDirectory();
   }catch{throw new FileTransactionError("RESULT_UNKNOWN","Journal operation or lock release is uncertain; inspect durable state");}
  }
 }
 private async publish(record:FileTransactionRecord,exclusive:boolean):Promise<void>{
  const copy=cloneFileTransaction(record),encoded=JSON.stringify(copy)+"\n";
  if(Buffer.byteLength(encoded)>MAX)fail("INVALID_FILE_TRANSACTION","Journal metadata exceeds limit");
  const target=this.file(copy.transaction_id),temporary=path.join(this.root,".transaction-"+randomUUID());let published=false,tempExists=false;
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
  }catch(error){if(published)throw new FileTransactionError("RESULT_UNKNOWN","Journal publication may have completed; inspect the transaction before continuing");throw error;}
  finally{if(tempExists&&!published){await this.directory();await fs.unlink(temporary);}}
 }
 async create(id:string,intent:FileTransactionIntent):Promise<FileTransactionRecord>{
  const candidate=newFileTransaction(id,intent); // clone before the first await
  return this.locked(id,async()=>{
   try{const existing=await this.load(id);if(!isDeepStrictEqual(existing.intent,candidate.intent))fail("FILE_TRANSACTION_INTENT_CONFLICT","Transaction ID already binds different intent");return existing;}
   catch(error){if(!(error instanceof FileTransactionError)||error.code!=="FILE_TRANSACTION_NOT_FOUND")throw error;}
   await this.publish(candidate,true);return candidate;
  });
 }
 async update(id:string,expectedRevision:number,observation:FileTransactionReadback,explicitReadback=false):Promise<FileTransactionRecord>{
  assertFileTransactionId(id);const captured=structuredClone(observation);
  return this.locked(id,async()=>{const previous=await this.load(id),next=transitionFileTransaction(previous,captured,expectedRevision,explicitReadback);await this.publish(next,false);return next;});
 }
 async reconcile(id:string,expectedRevision:number,readback?:FileTransactionReadback):Promise<FileTransactionRecord>{
  assertFileTransactionId(id);const captured=readback===undefined?undefined:structuredClone(readback);
  return this.locked(id,async()=>{
   const previous=await this.load(id);if(previous.revision!==expectedRevision)fail("FILE_TRANSACTION_REVISION_CONFLICT","Stale transaction revision");
   const next=reconcileFileTransaction(previous,captured);if(next.revision!==previous.revision)await this.publish(next,false);return next;
  });
 }
}
