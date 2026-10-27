import path from "node:path";
import {isDeepStrictEqual} from "node:util";
import type {WorkspaceRegistry} from "../core/workspace.js";
import type {WorkspaceGrant,WorkspacePermission} from "../core/contracts.js";
import type {NativeDirectoryCopies,NativeScopedFiles,ScopedFileRef} from "../core/native-io.js";
import {validateWorkspaceRelative} from "../core/workspace-path.js";
import {assertMacFileInstallationSeparated} from "./macos-scoped-files.js";
import {assertDirectoryCopyId,assertDirectoryCopyIntentBudget,cloneDirectoryCopyIntent,directoryCopySchedule,validateDirectoryCapture,DirectoryCopyError,type DirectoryCapture,type DirectoryCopyPinnedRef,type DirectoryCopyRecord,type DirectoryCopyOutcome,type DirectoryCopyStoreApi,type NativeDirectoryReader} from "../core/directory-copy.js";

const fail=(code:string,message:string):never=>{throw new DirectoryCopyError(code,message);};
const inside=(a:string,b:string)=>a===b||b.startsWith(a+path.sep);
const ref=(value:ScopedFileRef,root=false):ScopedFileRef=>{
 const copy=Object.freeze({workspace_id:value.workspace_id,path:value.path});
 validateWorkspaceRelative(copy.path,root);
 if(Buffer.byteLength(copy.path)>4096||Buffer.from(copy.path).toString("utf8")!==copy.path||copy.path.split("/").some(p=>p.toLowerCase()===".gsa-trash"))fail("INVALID_DIRECTORY_COPY","Invalid directory path");
 return copy;
};
const scoped=(pin:DirectoryCopyPinnedRef):ScopedFileRef=>({workspace_id:pin.workspace_id,path:pin.path});
/** Detached bounded internal bytes; all reader results still undergo the wire contract checks. */
function checkedCapture(value:DirectoryCapture):DirectoryCapture {
 if(!value||!Array.isArray(value.files)||value.files.length>1024)fail("INVALID_DIRECTORY_COPY","Invalid capture payload count");
 let total=0;
 for(const file of value.files){
  if(!(file.bytes instanceof Uint8Array)||file.bytes.byteLength>8_388_608)fail("INVALID_DIRECTORY_COPY","Invalid bounded capture bytes");
  total+=file.bytes.byteLength;if(total>8_388_608)fail("INVALID_DIRECTORY_COPY","Capture byte limit exceeded");
 }
 return validateDirectoryCapture({manifest:value.manifest,files:value.files.map(f=>({path:f.path,base64:Buffer.from(f.bytes).toString("base64")})),observations:value.observations});
}
function publicOutcome(record:DirectoryCopyRecord,readback?:DirectoryCopyOutcome["readback"]):DirectoryCopyOutcome {
 const result:DirectoryCopyOutcome={copy_id:record.copy_id,status:record.status==="PENDING"?"UNKNOWN":record.status,source:scoped(record.intent.source),destination:scoped(record.intent.destination),manifest_sha256:record.intent.manifest.sha256,acknowledged:record.acknowledged.map(e=>Object.freeze({...e})),pending_path:record.pending_path,reason:record.status==="PENDING"?"INTERRUPTED: last durable progress; no replay":record.reason,committed:false,...(readback?{readback:Object.freeze({...readback})}:{})};
 Object.freeze(result.source);Object.freeze(result.destination);Object.freeze(result.acknowledged);return Object.freeze(result);
}
/** Composition only; production tree capability activation remains a separate reviewed boundary.
 * APPLIED records acknowledged exclusive calls and a final observed content match.
 * Void mkdir receipts cannot prove continuous created-inode identity or ancestor fsync. */
export function createMacDirectoryCopies(registry:WorkspaceRegistry,reader:NativeDirectoryReader,base:NativeScopedFiles,store:DirectoryCopyStoreApi,authorize:(workspaceId:string,permission:WorkspacePermission)=>Promise<void>):NativeDirectoryCopies {
 const root=store.rootDirectory;
 if(typeof root!=="string"||!path.isAbsolute(root)||path.normalize(root)!==root||root==="/"||root.includes("\0"))fail("INVALID_DIRECTORY_COPY","Canonical protected store root required");
 const pin=(value:ScopedFileRef,permission:WorkspacePermission):DirectoryCopyPinnedRef=>{
  const g=registry.requireGrant(value.workspace_id,permission);registry.requireGrant(value.workspace_id,"read");
  const role=g.role??(g.permissions.includes("write")?"workspace":"reference");
  if(permission==="write"&&role!=="workspace")fail("PERMISSION_DENIED","Destination must be workspace");
  return Object.freeze({workspace_id:g.id,path:value.path,canonical_root:g.canonicalRoot,role,revision:g.revision,rootIdentity:Object.freeze({...g.rootIdentity}),permissions:Object.freeze([...g.permissions])});
 };
 const requirePin=(p:DirectoryCopyPinnedRef,permission:WorkspacePermission)=>{
  const current=pin(scoped(p),permission);
  if(!isDeepStrictEqual({...current,permissions:[...current.permissions].sort()},{...p,permissions:[...p.permissions].sort()}))fail("SECURITY_BLOCKED","Directory copy grant changed");
 };
 async function separated():Promise<readonly WorkspaceGrant[]>{
  const selected=registry.list();
  for(const g of selected)if(inside(root,g.canonicalRoot)||inside(g.canonicalRoot,root))fail("SECURITY_BLOCKED","Directory copy store overlaps a selected root");
  const checked=await assertMacFileInstallationSeparated(registry,root);
  if(!isDeepStrictEqual(selected,checked)||!isDeepStrictEqual(selected,registry.list()))fail("SECURITY_BLOCKED","Directory copy scopes changed during admission");
  return checked;
 }
 async function check(source:DirectoryCopyPinnedRef,destination?:DirectoryCopyPinnedRef,write=false):Promise<void>{
  const selection=registry.list();
  requirePin(source,"read");if(destination)requirePin(destination,write?"write":"read");
  await authorize(source.workspace_id,"read");
  if(destination){await authorize(destination.workspace_id,"read");if(write)await authorize(destination.workspace_id,"write");}
  // Authorization is asynchronous and can outlive a root replacement. Observe
  // physical roots after it, then compare both registry pins synchronously.
  await separated();
  requirePin(source,"read");if(destination)requirePin(destination,write?"write":"read");
  if(!isDeepStrictEqual(selection,registry.list()))fail("SECURITY_BLOCKED","Directory copy scopes changed before dispatch");
 }
 async function readback(record:DirectoryCopyRecord):Promise<DirectoryCopyOutcome["readback"]>{
  await check(record.intent.source,record.intent.destination);
  try{
   const current=checkedCapture(await reader.capture(scoped(record.intent.destination)));
   await check(record.intent.source,record.intent.destination);
   return {status:current.manifest.sha256===record.intent.manifest.sha256?"MATCH":"DIFFERENT",manifest_sha256:current.manifest.sha256,reason:"Read-only observed destination bytes and directory structure"};
  }catch(error){
   // Revocation never becomes permission to disclose a stored receipt.
   await check(record.intent.source,record.intent.destination);
   const code=(error as {code?:string}).code;
   return {status:code==="ENOENT"?"ABSENT":"UNAVAILABLE",manifest_sha256:null,reason:code==="ENOENT"?"Destination absent":"Destination observation unavailable"};
  }
 }
 return {
  async inspect(source){const from=ref(source,true),pinned=pin(from,"read");await check(pinned);const capture=checkedCapture(await reader.capture(from));await check(pinned);return Object.freeze({...capture.manifest,entries:Object.freeze(capture.manifest.entries.map(e=>Object.freeze({...e})))});},
  async copy(copyId,source,destination,expectedManifestSha256){
   // Capture every caller-owned value synchronously, before authorization or native I/O.
   const id=copyId,from=ref(source,true),to=ref(destination),expected=expectedManifestSha256;
   assertDirectoryCopyId(id);if(typeof expected!=="string"||!/^[a-f0-9]{64}$/.test(expected))fail("INVALID_DIRECTORY_COPY","Invalid manifest hash");
   const sourcePin=pin(from,"read"),destinationPin=pin(to,"write");
   const sourcePath=from.path==="."?sourcePin.canonical_root:path.join(sourcePin.canonical_root,from.path),destinationPath=path.join(destinationPin.canonical_root,to.path);
   if(inside(sourcePath,destinationPath)||inside(destinationPath,sourcePath))fail("DIRECTORY_COPY_INTENT_CONFLICT","Directory source/destination overlap");
   await check(sourcePin,destinationPin,true);
   const capture=checkedCapture(await reader.capture(from));
   if(capture.manifest.sha256!==expected)fail("HASH_CONFLICT","Source manifest hash conflict");
   const intent=cloneDirectoryCopyIntent({source:sourcePin,destination:destinationPin,expected_manifest_sha256:expected,manifest:capture.manifest});
   for(const entry of directoryCopySchedule(intent.manifest))ref({workspace_id:to.workspace_id,path:entry.path?`${to.path}/${entry.path}`:to.path});
   assertDirectoryCopyIntentBudget(intent);await check(sourcePin,destinationPin,true);
   const created=await store.create(id,intent);let record=created.record;
   if(!created.created)return publicOutcome(record,await readback(record));
   const observedDirectories=new Map<string,string>();
   const remember=(observed:DirectoryCapture)=>{
    for(const o of observed.observations)if(o.kind==="directory"){
     const identity=`${o.device}:${o.inode}`,previous=observedDirectories.get(o.path);
     if(previous!==undefined&&previous!==identity)fail("DIRECTORY_COPY_IDENTITY_CHANGED","Observed destination directory identity replacement");
     observedDirectories.set(o.path,identity);
    }
   };
   const files=new Map(capture.files.map(f=>[f.path,f.bytes]));
   let attempted=false;
   try{
    assertDirectoryCopyIntentBudget(intent);
    for(const entry of directoryCopySchedule(intent.manifest)){
     await check(sourcePin,destinationPin,true);
     record=await store.beginEntry(id,record.revision,entry.path);
     await check(sourcePin,destinationPin,true);
     const target=ref({workspace_id:to.workspace_id,path:entry.path?`${to.path}/${entry.path}`:to.path});
     attempted=true;
     if(entry.kind==="directory")await base.makeDirectory(target);
     else await base.createExclusive(target,new Uint8Array(files.get(entry.path)!));
     await check(sourcePin,destinationPin,true);
     record=await store.acknowledgeEntry(id,record.revision,entry.path,entry.kind);
     if(entry.kind==="directory"){
      await check(sourcePin,destinationPin);
      remember(checkedCapture(await reader.capture(to)));
      await check(sourcePin,destinationPin);
     }
    }
    await check(sourcePin,destinationPin);
    const observed=checkedCapture(await reader.capture(to));remember(observed);
    const finalDirectories=new Set(observed.observations.filter(o=>o.kind==="directory").map(o=>o.path));
    if([...observedDirectories.keys()].some(p=>!finalDirectories.has(p)))fail("DIRECTORY_COPY_IDENTITY_CHANGED","Observed destination directory disappeared");
    if(observed.manifest.sha256!==intent.manifest.sha256)fail("DIRECTORY_COPY_READBACK_DIFFERENT","Final destination content differs");
    await check(sourcePin,destinationPin,true);
    record=await store.finish(id,record.revision,"APPLIED","Exclusive creates acknowledged; final observed bytes/structure match; no continuous inode or ancestor fsync proof");
    return publicOutcome(record,{status:"MATCH",manifest_sha256:observed.manifest.sha256,reason:"Final observed bytes and directory structure match"});
   }catch(error){
    const code=(error as {code?:string}).code;
    // The actual base broker conflates collision and denial. Its result is uncertain;
    // only an explicit EEXIST receipt establishes a known collision.
    const status=code==="EEXIST"?"CONFLICT":"UNKNOWN";
    const reason=code==="DIRECTORY_COPY_IDENTITY_CHANGED"?"Observed destination directory identity replacement":code==="DIRECTORY_COPY_READBACK_DIFFERENT"?"Final destination content differs":status==="CONFLICT"?"Exclusive destination entry collision; prior effects may remain":attempted?"Copy interrupted after possible effects; inspect durable progress; no replay":"Copy interrupted before next dispatch; no replay";
    try{await check(sourcePin,destinationPin,true);record=await store.finish(id,record.revision,status,reason);}catch{/* Preserve the last acknowledged durable revision and pending path. */}
    return publicOutcome({...record,status,reason});
   }
  },
  async readCopy(copyId){const id=copyId;assertDirectoryCopyId(id);await separated();const record=await store.load(id);return publicOutcome(record,await readback(record));}
 };
}
