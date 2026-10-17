import fs from "node:fs/promises";
import {requireProtectedState} from "./protected-state.js";
import {constants,type Stats} from "node:fs";
import path from "node:path";
import {createHash,randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import {identityDirectory} from "./identity.js";

export type ControlLeaseCode="SESSION_BUSY"|"SESSION_INVALID"|"SESSION_EXPIRED"|"CONTROL_LEASE_UNSAFE"|"CONTROL_LEASE_LOCKED";
export class ControlLeaseError extends Error {
 constructor(public readonly code:ControlLeaseCode,message:string){super(message);this.name="ControlLeaseError";}
}
export interface ControlLease {session_id:string;expires_at:number;revision:number}
interface StoredLease {version:1;installation_id:string;session_id:string|null;token_sha256:string|null;expires_at:number;revision:number}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const unsafe=(message:string):never=>{throw new ControlLeaseError("CONTROL_LEASE_UNSAFE",message);};
const invalid=():never=>{throw new ControlLeaseError("SESSION_INVALID","Invalid controller credential or installation identity");};

/** Host-owned durable single-controller lease. Never give this directory to jobs.
 * Exclusive locks are deliberately not recovered using process IDs or age.
 */
export class ControlLeaseStore {
 private pending:Promise<unknown>=Promise.resolve();
 constructor(private readonly dir=identityDirectory(),private readonly ttlMs=300000,
  private readonly clock:()=>number=Date.now){
  if(!Number.isSafeInteger(ttlMs)||ttlMs<=0)throw new RangeError("Invalid control lease TTL");
 }
 private file(name:string):string{return path.join(this.dir,name);}
 private now():number{
  const now=this.clock();
  if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(now+this.ttlMs))unsafe("Invalid lease clock");
  return now;
 }
 private check(info:Stats,directory=false):void{
  if(typeof process.getuid!=="function"||info.uid!==process.getuid()||info.mode&0o077||
     (directory?!info.isDirectory():!info.isFile()||info.nlink!==1))unsafe("Unsafe control lease ownership, type or permissions");
 }
 private async checkExisting(name:string):Promise<boolean>{
  try{this.check(await fs.lstat(this.file(name)));return true;}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}
 }
 private async directory():Promise<void>{
  try{this.check(await fs.lstat(this.dir),true);}
  catch(error){
   if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
   await fs.mkdir(this.dir,{recursive:true,mode:0o700});
   this.check(await fs.lstat(this.dir),true);
  }
 }
 private async read(name:string):Promise<string|null>{
  let handle:Awaited<ReturnType<typeof fs.open>>;
  try{handle=await fs.open(this.file(name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
  catch(error){
   if((error as NodeJS.ErrnoException).code==="ENOENT")return null;
   if(["ELOOP","EISDIR"].includes((error as NodeJS.ErrnoException).code??""))unsafe("Unsafe control lease file");
   throw error;
  }
  try{
   const info=await handle.stat();this.check(info);
   if(info.size>4096)unsafe("Oversized control lease file");
   return await handle.readFile("utf8");
  }finally{await handle.close();}
 }
 private locked<T>(operation:()=>Promise<T>):Promise<T>{
  requireProtectedState();
  const task=this.pending.then(()=>this.withFileLock(operation));
  this.pending=task.catch(()=>undefined);
  return task;
 }
 private async withFileLock<T>(operation:()=>Promise<T>):Promise<T>{
  await this.directory();
  let handle:Awaited<ReturnType<typeof fs.open>>;
  try{handle=await fs.open(this.file("control-lease.lock"),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(error){
   if(["EEXIST","ELOOP"].includes((error as NodeJS.ErrnoException).code??"")){
    await this.checkExisting("control-lease.lock");
    throw new ControlLeaseError("CONTROL_LEASE_LOCKED","Control lease lock exists; explicit recovery required");
   }
   throw error;
  }
  try{
   this.check(await handle.stat());
   await handle.writeFile(JSON.stringify({owner_session:process.env.GSA_OWNER_SESSION??null}));
   // Validate every preexisting path before initializing any durable identity.
   await this.checkExisting("installation-id");await this.checkExisting("control-lease.json");
   return await operation();
  }finally{await handle.close();await fs.unlink(this.file("control-lease.lock"));}
 }
 private async identity():Promise<string>{
  let text=await this.read("installation-id");
  if(text===null){
   if(await this.read("control-lease.json")!==null)invalid();
   text=randomUUID()+"\n";
   const handle=await fs.open(this.file("installation-id"),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();}
  }
  const id=text.trim();if(!UUID.test(id))invalid();
  return id;
 }
 private async load(installationId:string):Promise<StoredLease|null>{
  const text=await this.read("control-lease.json");if(text===null)return null;
  const record:StoredLease=(()=>{
   try{return JSON.parse(text) as StoredLease;}catch{return unsafe("Malformed control lease record");}
  })();
  if(!record||record.version!==1||record.installation_id!==installationId)invalid();
  if(!Number.isSafeInteger(record.revision)||record.revision<1||!Number.isSafeInteger(record.expires_at)||record.expires_at<0)unsafe("Invalid control lease record");
  if(record.token_sha256===null){
   if(record.session_id!==null||record.expires_at!==0)unsafe("Invalid released lease");
  }else if(typeof record.token_sha256!=="string"||!/^[a-f0-9]{64}$/.test(record.token_sha256)||
           typeof record.session_id!=="string"||!UUID.test(record.session_id))unsafe("Invalid active lease");
  return record;
 }
 private revision(previous:StoredLease|null):number{
  const revision=(previous?.revision??0)+1;
  if(!Number.isSafeInteger(revision))unsafe("Lease revision exhausted");return revision;
 }
 private async save(record:StoredLease):Promise<void>{
  const tmp=this.file(".control-"+randomBytes(16).toString("hex"));
  const handle=await fs.open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{
   try{await handle.writeFile(JSON.stringify(record)+"\n");await handle.sync();}finally{await handle.close();}
   await this.checkExisting("control-lease.json");
   await fs.rename(tmp,this.file("control-lease.json"));
   const directory=await fs.open(this.dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   try{await directory.sync();}finally{await directory.close();}
  }finally{await fs.rm(tmp,{force:true});}
 }
 private authenticate(record:StoredLease|null,token:string,checkExpiry=true):StoredLease&{session_id:string}{
  // Compare fixed-size hashes, including malformed tokens, without persisting the secret.
  const candidate=createHash("sha256").update(typeof token==="string"?token:"").digest();
  const expected=Buffer.from(record?.token_sha256??"0".repeat(64),"hex");
  const matches=timingSafeEqual(candidate,expected);
  if(typeof token!=="string"||!/^[a-f0-9]{64}$/.test(token)||!record?.token_sha256||!matches)return invalid();
  if(checkExpiry&&record.expires_at<=this.now())throw new ControlLeaseError("SESSION_EXPIRED","Controller lease expired");
  return record as StoredLease&{session_id:string};
 }
 private publicLease(record:StoredLease&{session_id:string}):ControlLease{
  return {session_id:record.session_id,expires_at:record.expires_at,revision:record.revision};
 }
 async acquire():Promise<ControlLease&{control_token:string}>{
  return this.locked(async()=>{
   const installation_id=await this.identity(),previous=await this.load(installation_id),now=this.now();
   if(previous?.token_sha256&&previous.expires_at>now)throw new ControlLeaseError("SESSION_BUSY","Another controller holds the lease");
   const control_token=randomBytes(32).toString("hex");
   const record:StoredLease&{session_id:string}={version:1,installation_id,session_id:randomUUID(),
    token_sha256:createHash("sha256").update(control_token).digest("hex"),expires_at:now+this.ttlMs,revision:this.revision(previous)};
   await this.save(record);return {...this.publicLease(record),control_token};
  });
 }
 async renew(token:string):Promise<ControlLease>{
  return this.locked(async()=>{
   const id=await this.identity(),previous=this.authenticate(await this.load(id),token);
   const next={...previous,expires_at:this.now()+this.ttlMs,revision:this.revision(previous)};
   await this.save(next);return this.publicLease(next);
  });
 }
 async require(token:string):Promise<ControlLease>{
  return this.locked(async()=>this.publicLease(this.authenticate(await this.load(await this.identity()),token)));
 }
 async release(token:string):Promise<void>{
  await this.locked(async()=>{
   const id=await this.identity(),previous=this.authenticate(await this.load(id),token,false);
   await this.save({version:1,installation_id:id,session_id:null,token_sha256:null,expires_at:0,revision:this.revision(previous)});
  });
 }
 /** Privileged startup only, after kernel fencing proves every old helper exited. */
 async invalidateAfterOwnerFence(session:string):Promise<void>{
  if(process.env.GSA_OWNER_LOCK_FD!=="3"||process.env.GSA_OWNER_SESSION!==session||!UUID.test(session))unsafe("Verified owner fence required");
  await this.directory();
  const stale=await this.read("control-lease.lock");
  if(stale!==null){
   let prior:{owner_session?:string}={};try{prior=JSON.parse(stale);}catch{/* A crash can precede the metadata write. Kernel fencing is the proof. */}
   if(prior?.owner_session===session)unsafe("Current owner control lock is active");
   await fs.unlink(this.file("control-lease.lock"));
  }
  await this.locked(async()=>{
   const installation_id=await this.identity(),previous=await this.load(installation_id);
   if(previous?.token_sha256)await this.save({version:1,installation_id,session_id:null,token_sha256:null,expires_at:0,revision:this.revision(previous)});
  });
 }
}
