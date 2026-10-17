import fs from "node:fs/promises";
import {protectedStateCapability,requireProtectedState} from "./protected-state.js";
import {constants,type Stats} from "node:fs";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {identityDirectory} from "./identity.js";
import {WorkspaceRegistry} from "../core/workspace.js";
import type {WorkspaceGrant,WorkspacePermission} from "../core/contracts.js";
export const grantPath=(dir=identityDirectory())=>path.join(dir,"trusted-workspaces.json");
type Entry={id:string;root:string;permissions:WorkspacePermission[];rootIdentity?:{device:string;inode:string};revision?:number;revoked?:true};
const unsafe=():never=>{throw Error("UNSAFE_GRANT_STORE");};
function protectedInfo(info:Stats,directory=false):void{
 if(typeof process.getuid!=="function"||info.uid!==process.getuid()||(info.mode&0o077)!==0||
   (directory?!info.isDirectory():!info.isFile()||info.nlink!==1))unsafe();
}
async function protectedDirectory(dir:string,create=false):Promise<boolean>{
 try{protectedInfo(await fs.lstat(dir),true);return true;}
 catch(error){
  if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
  if(!create)return false;
  await fs.mkdir(dir,{recursive:true,mode:0o700});protectedInfo(await fs.lstat(dir),true);return true;
 }
}
function validateEntries(value:unknown):Entry[]{
 if(!Array.isArray(value)||value.length>128)throw Error("INVALID_GRANT_STORE");
 const ids=new Set<string>(),roots=new Set<string>();
 return value.map(raw=>{
  if(!raw||typeof raw!=="object"||typeof raw.id!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(raw.id)||
   typeof raw.root!=="string"||!path.isAbsolute(raw.root)||!Array.isArray(raw.permissions)||
   raw.permissions.some((permission:unknown)=>typeof permission!=="string"||!["read","write","execute"].includes(permission))||
   (raw.revoked!==undefined&&raw.revoked!==true)||ids.has(raw.id))throw Error("INVALID_GRANT_STORE");
  ids.add(raw.id);
  if(!raw.revoked){if(roots.has(raw.root))throw Error("INVALID_GRANT_STORE");roots.add(raw.root);}
  const pinned=raw.rootIdentity!==undefined||raw.revision!==undefined;
  if(pinned&&(!raw.rootIdentity||!Number.isSafeInteger(raw.revision)||raw.revision<1||
   ![raw.rootIdentity.device,raw.rootIdentity.inode].every(value=>typeof value==="string"&&/^(0|[1-9][0-9]{0,31})$/.test(value))))throw Error("INVALID_GRANT_STORE");
  if(raw.revoked&&!pinned)throw Error("INVALID_GRANT_STORE");
  return raw as Entry;
 });
}
async function readEntries(dir:string):Promise<Entry[]>{
 if(!await protectedDirectory(dir))return [];
 let handle:Awaited<ReturnType<typeof fs.open>>;
 try{handle=await fs.open(grantPath(dir),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
 catch(error){
  if((error as NodeJS.ErrnoException).code==="ENOENT")return [];
  if(["ELOOP","EISDIR"].includes((error as NodeJS.ErrnoException).code??""))unsafe();throw error;
 }
 try{
  const before=await handle.stat();protectedInfo(before);if(before.size>1024*1024)unsafe();
  const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const read=await handle.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)unsafe();offset+=read.bytesRead;}
  if((await handle.read(Buffer.alloc(1),0,1,offset)).bytesRead)unsafe();
  const after=await handle.stat();
  if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)unsafe();
  return validateEntries(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
 }finally{await handle.close();}
}
const pinned=(entry:Entry):entry is Entry&{rootIdentity:NonNullable<Entry['rootIdentity']>;revision:number}=>entry.rootIdentity!==undefined&&entry.revision!==undefined;
const asGrant=(entry:Entry&{rootIdentity:NonNullable<Entry['rootIdentity']>;revision:number}):WorkspaceGrant=>({id:entry.id,canonicalRoot:entry.root,rootIdentity:entry.rootIdentity,revision:entry.revision,permissions:entry.permissions});
/** Legacy entries have no durable identity pin. They grant NO access, including
 * reads, until explicit trusted re-enrollment records the selected current root.
 */
export async function loadTrustedRegistry(dir=identityDirectory()):Promise<WorkspaceRegistry>{
 const registry=new WorkspaceRegistry();
 if(!protectedStateCapability().available)return registry;
 for(const entry of await readEntries(dir))if(!entry.revoked&&pinned(entry))await registry.importTrusted(asGrant(entry));
 return registry;
}
/** Recheck durable revocation/epoch and root identity before and during native work. */
export async function requirePersistedGrant(registry:WorkspaceRegistry,workspaceId:string,dir=identityDirectory()):Promise<WorkspaceGrant>{
 requireProtectedState();
 const live=registry.requireGrant(workspaceId,"execute");registry.requireGrant(workspaceId,"read");
 const entry=(await readEntries(dir)).find(value=>value.id===workspaceId&&!value.revoked);
 if(!entry||!pinned(entry)||!entry.permissions.includes("read")||!entry.permissions.includes("execute"))throw Error("WORKSPACE_GRANT_REVOKED");
 if(entry.root!==live.canonicalRoot||entry.revision!==live.revision||entry.rootIdentity.device!==live.rootIdentity.device||
   entry.rootIdentity.inode!==live.rootIdentity.inode||JSON.stringify([...entry.permissions].sort())!==JSON.stringify([...live.permissions].sort()))throw Error("WORKSPACE_GRANT_CHANGED");
 return new WorkspaceRegistry().importTrusted(asGrant(entry));
}
/** Cross-process lock files are never guessed stale from PIDs or timestamps. */
async function withGrantLock<T>(dir:string,operation:()=>Promise<T>):Promise<T>{
 requireProtectedState();
 await protectedDirectory(dir,true);const lock=path.join(dir,".trusted-workspaces.lock");
 let handle:Awaited<ReturnType<typeof fs.open>>;
 try{handle=await fs.open(lock,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
 catch(error){
  if(["EEXIST","ELOOP"].includes((error as NodeJS.ErrnoException).code??"")){protectedInfo(await fs.lstat(lock));throw Error("GRANT_STORE_BUSY");}
  throw error;
 }
 try{protectedInfo(await handle.stat());return await operation();}
 finally{await handle.close();await fs.unlink(lock);}
}
async function persistEntries(dir:string,entries:Entry[]):Promise<void>{
 validateEntries(entries);const tmp=path.join(dir,".workspaces-"+randomBytes(16).toString("hex"));
 const handle=await fs.open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{
  try{await handle.writeFile(JSON.stringify(entries,null,2)+"\n");await handle.sync();}finally{await handle.close();}
  await fs.rename(tmp,grantPath(dir));
  const directory=await fs.open(dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await directory.sync();}finally{await directory.close();}
 }finally{await fs.rm(tmp,{force:true});}
}
export async function enrollReadOnly(id:string,root:string,dir=identityDirectory()):Promise<void>{
 await enrollReadOnlyBatch([{id,root}],dir);
}
/** Explicit binding captures a new identity even if a previous root was replaced.
 * Ordinary MCP binding always grants read only; it never upgrades execution rights.
 */
export async function enrollReadOnlyBatch(requests:ReadonlyArray<{id:string;root:string}>,dir=identityDirectory()):Promise<Array<{id:string;root:string;grant:WorkspaceGrant}>>{
 return enrollBatch(requests,["read"],dir);
}
/** Trusted local administration only. Never call from ordinary MCP binding.
 * The supplied absolute root is explicitly reselected and receives no write grant.
 */
export async function enrollExecute(id:string,root:string,dir=identityDirectory()):Promise<WorkspaceGrant>{
 return (await enrollBatch([{id,root}],["read","execute"],dir))[0].grant;
}
async function enrollBatch(requests:ReadonlyArray<{id:string;root:string}>,permissions:WorkspacePermission[],dir:string):Promise<Array<{id:string;root:string;grant:WorkspaceGrant}>>{
 if(!requests.length||requests.length>16)throw Error("INVALID_ARGUMENTS");
 return withGrantLock(dir,async()=>{
  const previous=await readEntries(dir),next=previous.slice(),bound:Array<{id:string;root:string;grant:WorkspaceGrant}>=[];
  for(const request of requests){
   const observed=await new WorkspaceRegistry().enrollTrusted(request.id,request.root,permissions);
   const old=next.find(entry=>entry.id===request.id),revision=(old?.revision??0)+1;
   if(!Number.isSafeInteger(revision))throw Error("INVALID_GRANT_STORE");
   const root=observed.canonicalRoot,grant={...observed,revision};
   if(bound.some(entry=>entry.id===request.id)||next.some(entry=>!entry.revoked&&entry.id!==request.id&&entry.root===root))throw Error("WORKSPACE_DUPLICATE_ROOT");
   const index=next.findIndex(entry=>entry.id===request.id);if(index>=0)next.splice(index,1);
   next.push({id:request.id,root,permissions:[...permissions],rootIdentity:{...grant.rootIdentity},revision});
   bound.push({id:request.id,root,grant});
  }
  await persistEntries(dir,next);return bound;
 });
}
export async function revokeTrusted(id:string,dir=identityDirectory()):Promise<void>{
 await withGrantLock(dir,async()=>{
  const entries=await readEntries(dir),entry=entries.find(value=>value.id===id&&!value.revoked);
  if(!entry)throw Error("WORKSPACE_NOT_FOUND");
  if(!pinned(entry)){
   // Legacy entries cannot authorize access and have no meaningful persisted epoch.
   await persistEntries(dir,entries.filter(value=>value.id!==id));return;
  }
  const revision=entry.revision+1;if(!Number.isSafeInteger(revision))throw Error("INVALID_GRANT_STORE");
  await persistEntries(dir,entries.map(value=>value===entry?{...entry,permissions:[],revoked:true,revision}:value));
 });
}
