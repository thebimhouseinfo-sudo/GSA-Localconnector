import fs from "node:fs/promises";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {identityDirectory} from "./identity.js";
import {WorkspaceRegistry} from "../core/workspace.js";
import type {WorkspacePermission} from "../core/contracts.js";
export const grantPath=(dir=identityDirectory())=>path.join(dir,"trusted-workspaces.json");
type Entry={id:string;root:string;permissions:WorkspacePermission[]};
function validateEntries(v:unknown):Entry[]{
 if(!Array.isArray(v)||v.length>128)throw Error("INVALID_GRANT_STORE");
 return v.map(e=>{
  if(!e||typeof e!=="object"||typeof e.id!=="string"||typeof e.root!=="string"||!Array.isArray(e.permissions)||e.permissions.some((p:unknown)=>!["read","write","execute"].includes(String(p))))throw Error("INVALID_GRANT_STORE");
  return e as Entry;
 });
}
async function readEntries(dir:string):Promise<Entry[]> {
 try{return validateEntries(JSON.parse(await fs.readFile(grantPath(dir),"utf8")));}
 catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return [];throw e;}
}
export async function loadTrustedRegistry(dir=identityDirectory()):Promise<WorkspaceRegistry>{
 const registry=new WorkspaceRegistry();
 for(const e of await readEntries(dir))await registry.enrollTrusted(e.id,e.root,e.permissions);
 return registry;
}
/** Cross-process serialization for grant changes. A failed/restarted owner leaves an
 * exclusive lock behind: fail closed rather than overwriting another writer.
 * Local repair of a stale lock requires explicit operator action.
 */
async function withGrantLock<T>(dir:string,fn:()=>Promise<T>):Promise<T>{
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const lock=path.join(dir,".trusted-workspaces.lock");
 let handle:Awaited<ReturnType<typeof fs.open>>;
 try{handle=await fs.open(lock,"wx",0o600);}
 catch(e){
  if((e as NodeJS.ErrnoException).code==="EEXIST")throw Error("GRANT_STORE_BUSY");
  throw e;
 }
 try{return await fn();}
 finally{await handle.close();await fs.rm(lock,{force:true});}
}
async function persistEntries(dir:string,entries:Entry[]):Promise<void>{
 const tmp=path.join(dir,".workspaces-"+randomBytes(8).toString("hex"));
 try{
  await fs.writeFile(tmp,JSON.stringify(entries,null,2)+"\n",{flag:"wx",mode:0o600});
  await fs.rename(tmp,grantPath(dir));
 }finally{await fs.rm(tmp,{force:true});}
}
export async function enrollReadOnly(id:string,root:string,dir=identityDirectory()):Promise<void>{
 await withGrantLock(dir,async()=>{
  const registry=await loadTrustedRegistry(dir);
  await registry.enrollTrusted(id,root,["read"]);
  const canonical=registry.requireGrant(id,"read").canonicalRoot;
  const existing=await readEntries(dir);
  const duplicate=existing.find(e=>e.root===canonical&&e.id!==id);
  if(duplicate)throw Error("WORKSPACE_DUPLICATE_ROOT");
  await persistEntries(dir,[...existing.filter(e=>e.id!==id),{id,root:canonical,permissions:["read"]}]);
 });
}
export async function revokeTrusted(id:string,dir=identityDirectory()):Promise<void>{
 await withGrantLock(dir,async()=>{
  const entries=await readEntries(dir);
  if(!entries.some(e=>e.id===id))throw Error("WORKSPACE_NOT_FOUND");
  await persistEntries(dir,entries.filter(e=>e.id!==id));
 });
}
