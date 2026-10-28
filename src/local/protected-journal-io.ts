import fs from "node:fs/promises";
import {constants} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";

export interface ProtectedJournalContext {
 readonly root:string;
 readonly directory:(create?:boolean)=>Promise<void>;
 readonly syncDirectory:()=>Promise<void>;
 readonly error:(code:string,message:string)=>Error;
 readonly lockedCode:string;
 readonly durableLock:boolean;
}
const identity=(s:{dev:bigint;ino:bigint})=>`${s.dev}:${s.ino}`;
/** Shared coordination and publication only; each journal retains its own schema and ancestry rules. */
export async function withProtectedJournalLock<T>(ctx:ProtectedJournalContext,id:string,operation:()=>Promise<T>):Promise<T>{
 await ctx.directory(true);const lock=path.join(ctx.root,id+".lock");let fd;
 try{fd=await fs.open(lock,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}
 catch(error){if((error as NodeJS.ErrnoException).code==="EEXIST")throw ctx.error(ctx.lockedCode,"Transaction lock exists; automatic stale-lock removal is forbidden");throw error;}
 let owned;
 try{owned=await fd.stat({bigint:true});}
 catch(error){try{await fd.close();}catch{throw ctx.error("RESULT_UNKNOWN","Initial lock identity and descriptor release are uncertain; inspect durable state");}throw error;}
 try{
  if(ctx.durableLock){await fd.sync();await ctx.syncDirectory();}
  await ctx.directory();return await operation();
 }finally{
  try{
   await fd.close();const named=await fs.lstat(lock,{bigint:true});
   if(identity(named)!==identity(owned)||!named.isFile()||named.nlink!==1n)throw ctx.error("RESULT_UNKNOWN","Transaction lock ownership changed; inspect durable state");
   await ctx.directory();await fs.unlink(lock);if(ctx.durableLock)await ctx.syncDirectory();
  }catch{throw ctx.error("RESULT_UNKNOWN","Journal operation or lock release is uncertain; inspect durable state");}
 }
}
export async function publishProtectedJournal(ctx:ProtectedJournalContext,target:string,encoded:string,exclusive:boolean):Promise<void>{
 const temporary=path.join(ctx.root,".transaction-"+randomUUID());let published=false,tempExists=false;
 try{
  await ctx.directory();const fd=await fs.open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);tempExists=true;
  try{await fd.writeFile(encoded);await fd.sync();}finally{await fd.close();}
  await ctx.directory();
  if(exclusive){await fs.link(temporary,target);published=true;await fs.unlink(temporary);tempExists=false;}
  else{await fs.rename(temporary,target);published=true;tempExists=false;}
  await ctx.syncDirectory();await ctx.directory();
 }catch(error){if(published)throw ctx.error("RESULT_UNKNOWN","Journal publication may have completed; inspect the transaction before continuing");throw error;}
 finally{if(tempExists&&!published){await ctx.directory();await fs.unlink(temporary);}}
}
