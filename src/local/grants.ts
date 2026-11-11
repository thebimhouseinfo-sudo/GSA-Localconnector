import fs from "node:fs/promises";
import {protectedStateCapability,requireProtectedState} from "./protected-state.js";
import {constants,type Stats} from "node:fs";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {identityDirectory} from "./identity.js";
import {WorkspaceRegistry} from "../core/workspace.js";
import {ConnectorError,type WorkspaceGrant,type WorkspacePermission,type WorkspaceRole,type WorkspaceRoleRequest} from "../core/contracts.js";
export const grantPath=(dir=identityDirectory())=>path.join(dir,"trusted-workspaces.json");
type Entry={id:string;root:string;permissions:WorkspacePermission[];rootIdentity?:{device:string;inode:string};revision?:number;revoked?:true;role?:WorkspaceRole};
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
 if(!Array.isArray(value)||value.filter(raw=>!raw?.revoked).length>128)throw Error("INVALID_GRANT_STORE");
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
  if(raw.role!==undefined){
   if(!["workspace","reference"].includes(raw.role)||!pinned)throw Error("INVALID_GRANT_STORE");
   const expected=raw.revoked?[]:raw.role==="workspace"?["read","write","execute"]:["read"];
   if(new Set(raw.permissions).size!==expected.length||!expected.every(permission=>raw.permissions.includes(permission)))throw Error("INVALID_GRANT_STORE");
  }
  return raw as Entry;
 });
}
type GrantStore={entries:Entry[];revisionFloor:number};
async function readStore(dir:string):Promise<GrantStore>{
 if(!await protectedDirectory(dir))return {entries:[],revisionFloor:0};
 let handle:Awaited<ReturnType<typeof fs.open>>;
 try{handle=await fs.open(grantPath(dir),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
 catch(error){
  if((error as NodeJS.ErrnoException).code==="ENOENT")return {entries:[],revisionFloor:0};
  if(["ELOOP","EISDIR"].includes((error as NodeJS.ErrnoException).code??""))unsafe();throw error;
 }
 try{
  const before=await handle.stat();protectedInfo(before);if(before.size>1024*1024)unsafe();
  const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const read=await handle.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)unsafe();offset+=read.bytesRead;}
  if((await handle.read(Buffer.alloc(1),0,1,offset)).bytesRead)unsafe();
  const after=await handle.stat();
  if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)unsafe();
  const raw=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  if(Array.isArray(raw))return {entries:validateEntries(raw),revisionFloor:0};
  if(!raw||raw.format!=="gsa-grants-v2"||Object.keys(raw).length!==3||!Number.isSafeInteger(raw.revision_floor)||raw.revision_floor<1)throw Error("INVALID_GRANT_STORE");
  const entries=validateEntries(raw.entries);
  if(entries.some(entry=>(entry.revision??0)>raw.revision_floor))throw Error("INVALID_GRANT_STORE");
  return {entries,revisionFloor:raw.revision_floor};
 }finally{await handle.close();}
}
async function readEntries(dir:string):Promise<Entry[]>{return (await readStore(dir)).entries;}
const pinned=(entry:Entry):entry is Entry&{rootIdentity:NonNullable<Entry['rootIdentity']>;revision:number}=>entry.rootIdentity!==undefined&&entry.revision!==undefined;
const asGrant=(entry:Entry&{rootIdentity:NonNullable<Entry['rootIdentity']>;revision:number}):WorkspaceGrant=>({id:entry.id,canonicalRoot:entry.root,rootIdentity:entry.rootIdentity,revision:entry.revision,permissions:entry.permissions,...(entry.role===undefined?{}:{role:entry.role})});
/** Structural metadata only: no old directory resolution and no access authority. */
export async function readTrustedRootBindings(dir=identityDirectory()):Promise<readonly {id:string;root:string}[]>{
 requireProtectedState();
 return Object.freeze((await readEntries(dir)).filter(entry=>!entry.revoked).map(entry=>Object.freeze({id:entry.id,root:entry.root})));
}
/** Validate the complete active set, with explicit entries last so legacy imports cannot hide overlaps. */
async function validatedRegistry(entries:Entry[],privateRoot?:string):Promise<WorkspaceRegistry>{
 validateEntries(entries);
 const registry=new WorkspaceRegistry(path,privateRoot?[privateRoot]:[]),active=entries.filter(entry=>!entry.revoked&&pinned(entry));
 for(const entry of [...active.filter(entry=>entry.role===undefined),...active.filter(entry=>entry.role!==undefined)])
  if(pinned(entry))await registry.importTrusted(asGrant(entry));
 if(entries.some(entry=>entry.role!==undefined)){
  const grants=registry.list();
  const contains=(parent:string,child:string)=>{const rel=path.relative(parent,child);return rel===""||rel!==".."&&!rel.startsWith(".."+path.sep)&&!path.isAbsolute(rel);};
  const authority=(grant:WorkspaceGrant)=>grant.role??(grant.permissions.some(permission=>permission==="write"||permission==="execute")?"workspace":"reference");
  for(let i=0;i<grants.length;i++)for(let j=i+1;j<grants.length;j++){
   const a=grants[i]!,b=grants[j]!;
   if(a.canonicalRoot===b.canonicalRoot||(a.rootIdentity.device===b.rootIdentity.device&&a.rootIdentity.inode===b.rootIdentity.inode)||
    authority(a)!==authority(b)&&(contains(a.canonicalRoot,b.canonicalRoot)||contains(b.canonicalRoot,a.canonicalRoot)))
    throw new ConnectorError("PERMISSION_DENIED",`Workspace/reference roots overlap or alias another selected root: ${a.id} (${authority(a)}: ${a.canonicalRoot}) conflicts with ${b.id} (${authority(b)}: ${b.canonicalRoot})`);
  }
 }
 return registry;
}
/** Legacy entries have no durable identity pin. They grant NO access, including
 * reads, until explicit trusted re-enrollment records the selected current root.
 */
export async function loadTrustedRegistry(dir=identityDirectory()):Promise<WorkspaceRegistry>{
 if(!protectedStateCapability().available)return new WorkspaceRegistry();
 return validatedRegistry(await readEntries(dir),dir);
}
/** Inspect only the identity of explicitly pinned durable roots.
 * Never grant authority from this read: the caller must separately use
 * loadTrustedRegistry for any operation requiring a valid current root.
 */
async function stalePinnedEntries(entries:readonly Entry[]):Promise<Entry[]>{
 const result:Entry[]=[];
 for(const entry of entries){
  if(entry.revoked||!pinned(entry))continue;
  let canonical:string,stat;
  try{
   canonical=await fs.realpath(entry.root);
   stat=await fs.lstat(entry.root,{bigint:true});
  }catch(error){
   if(["ENOENT","ENOTDIR"].includes((error as NodeJS.ErrnoException).code??"")){result.push(entry);continue;}
   throw error; // EACCES/IO errors are unknown, never permission for revocation
  }
  if(canonical!==entry.root||!stat.isDirectory()||
    String(stat.dev)!==entry.rootIdentity.device||String(stat.ino)!==entry.rootIdentity.inode)result.push(entry);
 }
 return result;
}
/** Diagnostics only: old pins never authorize access to the currently named path. */
export async function inspectTrustedWorkspaceRecovery(dir=identityDirectory()):Promise<readonly {workspace_id:string;root:string;role:WorkspaceRole|null;revision:number|null;state:"ACTIVE"|"STALE"|"REAUTH_REQUIRED"|"REVOKED";reason:string}[]>{
 requireProtectedState();
 const entries=await readEntries(dir),status=[];
 for(const entry of entries){
  const common={workspace_id:entry.id,root:entry.root,role:entry.role??null,revision:entry.revision??null};
  if(entry.revoked){status.push({...common,state:"REVOKED" as const,reason:"GRANT_REVOKED"});continue;}
  if(!pinned(entry)){status.push({...common,state:"REAUTH_REQUIRED" as const,reason:"UNPINNED_LEGACY_GRANT"});continue;}
  try{
   const canonical=await fs.realpath(entry.root),stat=await fs.lstat(entry.root,{bigint:true});
   const reason=canonical!==entry.root?"ROOT_CANONICAL_CHANGED":!stat.isDirectory()?"ROOT_NOT_DIRECTORY":
    String(stat.dev)!==entry.rootIdentity.device?"ROOT_DEVICE_CHANGED":String(stat.ino)!==entry.rootIdentity.inode?"ROOT_INODE_CHANGED":null;
   status.push({...common,state:reason?"STALE" as const:"ACTIVE" as const,reason:reason??"IDENTITY_VERIFIED"});
  }catch(error){
   const code=(error as NodeJS.ErrnoException).code;
   if(["ENOENT","ENOTDIR"].includes(code??""))status.push({...common,state:"STALE" as const,reason:"ROOT_NOT_FOUND"});
   else if(["EACCES","EPERM"].includes(code??""))status.push({...common,state:"REAUTH_REQUIRED" as const,reason:"ROOT_PERMISSION_DENIED"});
   else throw error; // Unknown I/O failure is not proof of stale authority.
  }
 }
 return Object.freeze(status.map(item=>Object.freeze(item)));
}
export async function inspectStaleTrustedRoots(dir=identityDirectory()):Promise<readonly {id:string;root:string;revision:number}[]>{
 requireProtectedState();
 const entries=(await readStore(dir)).entries;
 return Object.freeze((await stalePinnedEntries(entries)).map(entry=>Object.freeze({id:entry.id,root:entry.root,revision:entry.revision!})));
}
/** Local administration only, under the same owner/stopped fence as broker rebind.
 * Preserve matching grants verbatim. Revoke just the durable pins whose exact
 * canonical inode is lost; never reinterpret old authority as a new root grant.
 */
export async function revokeStaleTrustedRoots(dir=identityDirectory()):Promise<{revoked:readonly {id:string;root:string;revision:number}[];retained:number}>{
 return withGrantLock(dir,async publication=>{
  const store=await readStore(dir),stale=await stalePinnedEntries(store.entries);
  if(!stale.length)return {revoked:[],retained:store.entries.filter(entry=>!entry.revoked&&pinned(entry)).length};
  const ids=new Set(stale.map(entry=>entry.id));let floor=store.revisionFloor;
  const revised=store.entries.map(entry=>{
   if(!ids.has(entry.id))return entry;
   floor=Math.max(floor,entry.revision!)+1;
   if(!Number.isSafeInteger(floor))throw Error("INVALID_GRANT_STORE");
   return {...entry,revoked:true as const,permissions:[] as WorkspacePermission[],revision:floor};
  });
  await validatedRegistry(revised,dir); // refuse publication if any retained root is unsafe
  await persistEntries(dir,revised,publication,undefined,floor);
  return {revoked:stale.map(entry=>({id:entry.id,root:entry.root,revision:revised.find(v=>v.id===entry.id)!.revision!})),
   retained:revised.filter(entry=>!entry.revoked&&pinned(entry)).length};
 });
}
/** Recheck durable revocation/epoch and root identity before and during native work. */
export async function requirePersistedGrant(registry:WorkspaceRegistry,workspaceId:string,dir=identityDirectory(),permission:WorkspacePermission="execute"):Promise<WorkspaceGrant>{
 requireProtectedState();
 const live=registry.requireGrant(workspaceId,permission);registry.requireGrant(workspaceId,"read");
 const entry=(await readEntries(dir)).find(value=>value.id===workspaceId&&!value.revoked);
 if(!entry||!pinned(entry)||!entry.permissions.includes("read")||!entry.permissions.includes(permission))throw Error("WORKSPACE_GRANT_REVOKED");
 if(entry.role!==live.role||entry.root!==live.canonicalRoot||entry.revision!==live.revision||entry.rootIdentity.device!==live.rootIdentity.device||
   entry.rootIdentity.inode!==live.rootIdentity.inode||JSON.stringify([...entry.permissions].sort())!==JSON.stringify([...live.permissions].sort()))throw Error("WORKSPACE_GRANT_CHANGED");
 return new WorkspaceRegistry(path,[dir]).importTrusted(asGrant(entry));
}
/** Cross-process lock files are never guessed stale from PIDs or timestamps. */
type Publication={published:boolean};
type BeforePublish=(grants:readonly WorkspaceGrant[])=>Promise<void>;
function publicationError(error:unknown):ConnectorError {
 return new ConnectorError("RESULT_UNKNOWN","Grant store may already be published; read it back before retrying. "+String(error));
}
async function withGrantLock<T>(dir:string,operation:(publication:Publication)=>Promise<T>):Promise<T>{
 requireProtectedState();
 await protectedDirectory(dir,true);const lock=path.join(dir,".trusted-workspaces.lock");
 let handle:Awaited<ReturnType<typeof fs.open>>;
 try{handle=await fs.open(lock,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
 catch(error){
  if(["EEXIST","ELOOP"].includes((error as NodeJS.ErrnoException).code??"")){protectedInfo(await fs.lstat(lock));throw Error("GRANT_STORE_BUSY");}
  throw error;
 }
 const publication:Publication={published:false};let result:T|undefined,error:unknown,failed=false,owned:Stats|undefined,closed=false;
 try{const observed=await handle.stat();protectedInfo(observed);owned=observed;result=await operation(publication);}catch(cause){failed=true;error=cause;}
 try{await handle.close();closed=true;}
 catch{failed=true;error=new ConnectorError("RESULT_UNKNOWN","Grant lock descriptor release is uncertain; inspect durable state");}
 // A failed initial stat gives no authority to remove the named lock. A replaced
 // lock belongs to another writer even when its permissions and owner match.
 if(closed&&owned)try{
  const visible=await fs.lstat(lock);protectedInfo(visible);
  if(visible.dev!==owned.dev||visible.ino!==owned.ino)throw new ConnectorError("RESULT_UNKNOWN","Grant lock identity changed; inspect durable state");
  await fs.unlink(lock);
 }catch(cause){failed=true;error=cause instanceof ConnectorError?cause:new ConnectorError("RESULT_UNKNOWN","Grant lock release is uncertain; inspect durable state");}
 if(failed)throw publication.published?publicationError(error):error;
 return result as T;
}
async function persistEntries(dir:string,entries:Entry[],publication:Publication,beforePublish?:BeforePublish,revisionFloor=0):Promise<void>{
 validateEntries(entries);
 const compact=entries.filter(entry=>entry.revoked).length>256;
 if(compact||revisionFloor>0){
  revisionFloor=entries.reduce((floor,entry)=>Math.max(floor,entry.revision??0),revisionFloor);
  if(compact)entries=entries.filter(entry=>!entry.revoked);
 }
 const payload=JSON.stringify(revisionFloor>0?{format:"gsa-grants-v2",revision_floor:revisionFloor,entries}:entries,null,2)+"\n";
 if(Buffer.byteLength(payload)>1024*1024)throw Error("GRANT_STORE_QUOTA");
 const tmp=path.join(dir,".workspaces-"+randomBytes(16).toString("hex"));
 const handle=await fs.open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{
  try{await handle.writeFile(payload);await handle.sync();}finally{await handle.close();}
  if(beforePublish){
   const active=entries.filter(entry=>!entry.revoked&&pinned(entry)).map(entry=>{
    const grant=asGrant(entry as Entry&{rootIdentity:NonNullable<Entry['rootIdentity']>;revision:number});
    return Object.freeze({...grant,rootIdentity:Object.freeze({...grant.rootIdentity}),permissions:Object.freeze([...grant.permissions])});
   });
   await beforePublish(Object.freeze(active));
  }
  await fs.rename(tmp,grantPath(dir));
  publication.published=true;
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
export async function enrollReadOnlyBatch(requests:ReadonlyArray<{id:string;root:string}>,dir=identityDirectory(),beforePublish?:BeforePublish):Promise<Array<{id:string;root:string;grant:WorkspaceGrant}>>{
 return enrollBatch(requests,["read"],dir,beforePublish);
}
/** Trusted local administration only. Never call from ordinary MCP binding.
 * The supplied absolute root is explicitly reselected and receives no write grant.
 */
export async function enrollExecute(id:string,root:string,dir=identityDirectory()):Promise<WorkspaceGrant>{
 return (await enrollBatch([{id,root}],["read","execute"],dir))[0].grant;
}
/** Explicit trusted role selection; never reinterpret an ordinary read-only binding as workspace consent. */
export async function enrollRolesTrustedBatch(requests:readonly WorkspaceRoleRequest[],dir=identityDirectory(),beforePublish?:BeforePublish,revokeStaleIds:readonly string[]=[]):Promise<Array<{id:string;root:string;grant:WorkspaceGrant}>>{
 if(!Array.isArray(requests)||requests.length<1||requests.length>16)throw new ConnectorError("SOURCE_UNVERIFIED","Select one through sixteen roots");
 const selections=Array.from(requests,request=>{
  if(!request||typeof request.id!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(request.id)||!["workspace","reference"].includes(request.role))
   throw new ConnectorError("SOURCE_UNVERIFIED","Invalid workspace role selection");
  if(typeof request.root!=="string"||!path.isAbsolute(request.root)||request.root.includes("\0"))throw new ConnectorError("PATH_OUTSIDE_SCOPE","Root must be absolute");
  return {id:request.id,root:request.root,role:request.role};
 });
 if(!Array.isArray(revokeStaleIds)||revokeStaleIds.length>16||new Set(revokeStaleIds).size!==revokeStaleIds.length||
  revokeStaleIds.some(id=>typeof id!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)))
  throw new ConnectorError("SOURCE_UNVERIFIED","Invalid explicit stale-grant IDs");
 return withGrantLock(dir,async publication=>{
  const stored=await readStore(dir),previous=stored.entries,requestedIds=new Set(selections.map(request=>request.id));
  const retiredIds=new Set(revokeStaleIds);
  if([...retiredIds].some(id=>requestedIds.has(id)))throw new ConnectorError("PERMISSION_DENIED","Cannot bind and retire the same workspace ID");
  const retired=previous.filter(entry=>retiredIds.has(entry.id));
  if(retired.length!==retiredIds.size||retired.some(entry=>entry.revoked||!pinned(entry))||
    (await stalePinnedEntries(retired)).length!==retired.length)
   throw new ConnectorError("PERMISSION_DENIED","Only verified stale and explicitly identified workspace IDs may be retired");
  let floor=stored.revisionFloor;
  const tombstones=retired.map(entry=>{
   floor=Math.max(floor,entry.revision!)+1;
   if(!Number.isSafeInteger(floor))throw Error("INVALID_GRANT_STORE");
   return {...entry,revoked:true as const,permissions:[] as WorkspacePermission[],revision:floor};
  });
  // The caller must reselect the changed root explicitly. Unmentioned grants stay untouched.
  const retained=previous.filter(entry=>!requestedIds.has(entry.id)&&!retiredIds.has(entry.id));
  const observed=await new WorkspaceRegistry(path,[dir]).enrollRolesTrusted(selections);
  const chosen=observed.map(grant=>{
   const old=previous.find(entry=>entry.id===grant.id);
   const identical=old&&!old.revoked&&old.role===grant.role&&old.root===grant.canonicalRoot&&
    old.rootIdentity?.device===grant.rootIdentity.device&&old.rootIdentity?.inode===grant.rootIdentity.inode&&
    new Set(old.permissions).size===new Set(grant.permissions).size&&old.permissions.every(permission=>grant.permissions.includes(permission));
   const revision=identical?old.revision!:Math.max(old?.revision??0,floor)+1;
   if(!Number.isSafeInteger(revision))throw Error("INVALID_GRANT_STORE");
   return {...grant,revision};
  });
  const next:Entry[]=[...retained,...tombstones,...chosen.map(grant=>({id:grant.id,root:grant.canonicalRoot,role:grant.role,permissions:[...grant.permissions],rootIdentity:{...grant.rootIdentity},revision:grant.revision}))];
  let registry:WorkspaceRegistry;
  try{registry=await validatedRegistry(next,dir);}
  catch(error){
   if(error instanceof ConnectorError&&error.code==="SOURCE_UNVERIFIED")
    throw new ConnectorError("WORKSPACE_REAUTH_REQUIRED","Other retained roots need reauthorization; inspect_workspace_recovery then explicitly rebind or retire verifiably stale IDs");
   throw error;
  }
  const bound=chosen.map(grant=>({id:grant.id,root:grant.canonicalRoot,grant:registry.get(grant.id)!}));
  await persistEntries(dir,next,publication,beforePublish,floor);return bound;
 });
}
async function enrollBatch(requests:ReadonlyArray<{id:string;root:string}>,permissions:WorkspacePermission[],dir:string,beforePublish?:BeforePublish):Promise<Array<{id:string;root:string;grant:WorkspaceGrant}>>{
 if(!requests.length||requests.length>16)throw Error("INVALID_ARGUMENTS");
 return withGrantLock(dir,async publication=>{
  const stored=await readStore(dir),previous=stored.entries,next=previous.slice(),bound:Array<{id:string;root:string;grant:WorkspaceGrant}>=[];
  for(const request of requests){
   if(previous.some(entry=>entry.id===request.id&&entry.role!==undefined))
    throw new ConnectorError("PERMISSION_DENIED","This ID has an explicit role; use explicit workspace/reference role selection");
   const observed=await new WorkspaceRegistry(path,[dir]).enrollTrusted(request.id,request.root,permissions);
   const old=next.find(entry=>entry.id===request.id),revision=Math.max(old?.revision??0,stored.revisionFloor)+1;
   if(!Number.isSafeInteger(revision))throw Error("INVALID_GRANT_STORE");
   const root=observed.canonicalRoot,grant={...observed,revision};
   if(bound.some(entry=>entry.id===request.id)||next.some(entry=>!entry.revoked&&entry.id!==request.id&&entry.root===root))throw Error("WORKSPACE_DUPLICATE_ROOT");
   const index=next.findIndex(entry=>entry.id===request.id);if(index>=0)next.splice(index,1);
   next.push({id:request.id,root,permissions:[...permissions],rootIdentity:{...grant.rootIdentity},revision});
   bound.push({id:request.id,root,grant});
  }
  if(next.some(entry=>entry.role!==undefined))await validatedRegistry(next,dir);
  await persistEntries(dir,next,publication,beforePublish,stored.revisionFloor);return bound;
 });
}
export async function revokeTrusted(id:string,dir=identityDirectory(),beforePublish?:BeforePublish):Promise<void>{
 await withGrantLock(dir,async publication=>{
  const stored=await readStore(dir),entries=stored.entries,entry=entries.find(value=>value.id===id&&!value.revoked);
  if(!entry)throw Error("WORKSPACE_NOT_FOUND");
  if(!pinned(entry)){
   // Legacy entries cannot authorize access and have no meaningful persisted epoch.
   const next=entries.filter(value=>value.id!==id);
   await persistEntries(dir,next,publication,beforePublish,stored.revisionFloor);return;
  }
  const revision=Math.max(entry.revision,stored.revisionFloor)+1;if(!Number.isSafeInteger(revision))throw Error("INVALID_GRANT_STORE");
  const next:Entry[]=entries.map(value=>value===entry?{...entry,permissions:[],revoked:true,revision}:value);
  await persistEntries(dir,next,publication,beforePublish,stored.revisionFloor);
 });
}
