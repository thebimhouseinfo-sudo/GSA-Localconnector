import {createHash} from "node:crypto";
import type {ScopedFileRef} from "./native-io.js";
import {validateWorkspaceRelative} from "./workspace-path.js";

export type DirectoryEntry =
 {readonly path:string;readonly kind:"directory"} |
 {readonly path:string;readonly kind:"file";readonly size:number;readonly sha256:string};
export interface DirectoryManifest {
 readonly format:"gsa-directory-manifest-v1";
 readonly entries:readonly DirectoryEntry[];readonly total_bytes:number;readonly sha256:string;
}
export interface DirectoryEntryObservation {
 readonly path:string;readonly device:string;readonly inode:string;readonly kind:"directory"|"file";
 readonly size:number;readonly mtime_ns:string;readonly ctime_ns:string;
}
export interface DirectoryCapture {
 readonly manifest:DirectoryManifest;
 readonly files:readonly {readonly path:string;readonly bytes:Uint8Array}[];
 readonly observations:readonly DirectoryEntryObservation[];
}
export interface NativeDirectoryReader {capture(source:ScopedFileRef):Promise<DirectoryCapture>}
export interface DirectoryCopyOutcome {
 readonly copy_id:string;readonly status:"APPLIED"|"CONFLICT"|"UNKNOWN";
 readonly source:ScopedFileRef;readonly destination:ScopedFileRef;readonly manifest_sha256:string;
 readonly acknowledged:readonly {readonly path:string;readonly kind:"directory"|"file"}[];
 readonly pending_path:string|null;readonly reason:string;readonly committed:false;
 readonly readback?:{readonly status:"MATCH"|"DIFFERENT"|"ABSENT"|"UNAVAILABLE";readonly manifest_sha256:string|null;readonly reason:string};
}
const FORMAT="gsa-directory-manifest-v1";
const BYTE_LIMIT=8_388_608,ENTRY_LIMIT=1024,MANIFEST_LIMIT=524_288,RESPONSE_LIMIT=12_582_912;
const sha=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");
function requireValue(ok:unknown,message:string):asserts ok {if(!ok)throw new Error(`Invalid directory capture: ${message}`);}
function object(value:unknown,keys:readonly string[],label:string):Record<string,unknown>{
 requireValue(value!==null && typeof value==="object" && !Array.isArray(value),`${label} shape`);
 const obj=value as Record<string,unknown>;
 requireValue(Object.getPrototypeOf(obj)===Object.prototype || Object.getPrototypeOf(obj)===null,`${label} shape`);
 const actual=Reflect.ownKeys(obj);requireValue(actual.length===keys.length && actual.every(k=>typeof k==="string" && keys.includes(k)),`${label} fields`);
 requireValue(keys.every(k=>Object.getOwnPropertyDescriptor(obj,k)?.get===undefined && Object.getOwnPropertyDescriptor(obj,k)?.set===undefined),`${label} fields`);
 return obj;
}
function safeSize(value:unknown):value is number{return typeof value==="number" && Number.isSafeInteger(value) && value>=0;}
function validPath(value:unknown):value is string {
 if(typeof value!=="string" || Buffer.byteLength(value)>4096 || Buffer.from(value).toString("utf8")!==value)return false;
 if(value==="")return true;
 const parts=value.split("/");return parts.length<=16 && parts.every(p=>p!=="" && p!=="." && p!==".." && !p.includes("\\") && !p.includes("\0") && p.toLowerCase()!==".gsa-trash");
}
function compare(a:{path:string},b:{path:string}):number{return Buffer.compare(Buffer.from(a.path),Buffer.from(b.path));}
function canonical(entries:readonly DirectoryEntry[]):string {
 return JSON.stringify([FORMAT,[...entries].sort(compare).map(e=>e.kind==="directory"?[e.path,e.kind]:[e.path,e.kind,e.size,e.sha256])]);
}
/** Portable content digest, independent of native identities and input ordering. */
export function directoryManifestDigest(entries:readonly DirectoryEntry[]):string {return sha(canonical(entries));}
/** Validate the JSON wire capture only; no filesystem access or native authority. */
export function validateDirectoryCapture(value:unknown):DirectoryCapture {
 const capture=object(value,["manifest","files","observations"],"capture");
 const manifest=object(capture.manifest,["format","entries","total_bytes","sha256"],"manifest");
 requireValue(manifest.format===FORMAT,"manifest format");
 requireValue(Array.isArray(manifest.entries) && manifest.entries.length>0 && manifest.entries.length<=ENTRY_LIMIT,"entry limit");
 const entries:DirectoryEntry[]=[],seen=new Map<string,DirectoryEntry>();let total=0;
 for(const raw of manifest.entries){
  requireValue(raw!==null && typeof raw==="object","entry shape");
  const kind=(raw as Record<string,unknown>).kind;
  requireValue(kind==="directory" || kind==="file","entry kind");
  const entry=object(raw,kind==="directory"?["path","kind"]:["path","kind","size","sha256"],"entry");
  requireValue(validPath(entry.path),"entry path/name/depth limit");
  requireValue(!seen.has(entry.path),"duplicate entry path");
  if(entries.length===0)requireValue(entry.path==="" && kind==="directory","directory root required");
  else {
   requireValue(entry.path!=="" && compare(entries[entries.length-1]!,{path:entry.path})<0,"canonical entry order");
   const slash=entry.path.lastIndexOf("/"),parent=slash<0?"":entry.path.slice(0,slash);
   requireValue(seen.get(parent)?.kind==="directory","directory parent/ancestor required");
  }
  let result:DirectoryEntry;
  if(kind==="file"){
   requireValue(safeSize(entry.size) && entry.size<=BYTE_LIMIT,"file size limit");
   requireValue(typeof entry.sha256==="string" && /^[a-f0-9]{64}$/.test(entry.sha256),"file hash");
   total+=entry.size;requireValue(total<=BYTE_LIMIT,"total byte limit");
   result={path:entry.path,kind,size:entry.size,sha256:entry.sha256};
  }else result={path:entry.path,kind};
  seen.set(result.path,result);entries.push(result);
 }
 const encoded=canonical(entries);requireValue(Buffer.byteLength(encoded)<=MANIFEST_LIMIT,"canonical manifest size limit");
 requireValue(safeSize(manifest.total_bytes) && manifest.total_bytes===total,"manifest total bytes");
 requireValue(manifest.sha256===sha(encoded),"manifest digest/hash mismatch");
 const expectedFiles=entries.filter((entry):entry is Extract<DirectoryEntry,{kind:"file"}>=>entry.kind==="file");
 requireValue(Array.isArray(capture.files) && capture.files.length===expectedFiles.length,"file payload count mismatch");
 for(let index=0;index<capture.files.length;index++)requireValue(Object.hasOwn(capture.files,index),"missing file payload");
 const files=capture.files.map((raw:unknown,index:number)=>{
  const payload=object(raw,["path","base64"],"file payload"),entry=expectedFiles[index]!;
  requireValue(payload.path===entry.path,"file payload canonical order mismatch");
  requireValue(typeof payload.base64==="string" && payload.base64.length<=Math.ceil(BYTE_LIMIT/3)*4,"base64 payload size limit");
  requireValue(payload.base64.length===Math.ceil(entry.size/3)*4 && !/[^A-Za-z0-9+/=]/.test(payload.base64),"base64 encoding/size");
  const bytes=Buffer.from(payload.base64,"base64");
  requireValue(bytes.toString("base64")===payload.base64,"canonical base64 encoding");
  requireValue(bytes.length===entry.size,"file payload size mismatch");requireValue(sha(bytes)===entry.sha256,"file content hash mismatch");
  return {path:entry.path,bytes:new Uint8Array(bytes)};
 });
 requireValue(Array.isArray(capture.observations) && capture.observations.length===entries.length,"observation count mismatch");
 for(let index=0;index<capture.observations.length;index++)requireValue(Object.hasOwn(capture.observations,index),"missing observation");
 const observations=capture.observations.map((raw:unknown,index:number):DirectoryEntryObservation=>{
  const obs=object(raw,["path","device","inode","kind","size","mtime_ns","ctime_ns"],"observation"),entry=entries[index]!;
  requireValue(obs.path===entry.path && obs.kind===entry.kind,"observation entry/order mismatch");
  for(const key of ["device","inode","mtime_ns","ctime_ns"])requireValue(typeof obs[key]==="string" && /^(0|[1-9][0-9]{0,31})$/.test(obs[key]),"observation decimal stat field");
  requireValue(safeSize(obs.size) && (entry.kind!=="file" || obs.size===entry.size),"observation size mismatch");
  if(index>0)requireValue(obs.device===(capture.observations as Record<string,unknown>[])[0]!.device,"observation device boundary");
  return {path:entry.path,kind:entry.kind,device:obs.device as string,inode:obs.inode as string,size:obs.size,mtime_ns:obs.mtime_ns as string,ctime_ns:obs.ctime_ns as string};
 });
 requireValue(Buffer.byteLength(JSON.stringify(value))<=RESPONSE_LIMIT,"response byte limit");
 return {manifest:{format:FORMAT,entries,total_bytes:total,sha256:manifest.sha256 as string},files,observations};
}

export interface DirectoryCopyPinnedRef {
 readonly workspace_id:string;readonly path:string;readonly canonical_root:string;
 readonly role:"workspace"|"reference";readonly revision:number;
 readonly rootIdentity:Readonly<{device:string;inode:string}>;
 readonly permissions:readonly ("read"|"write"|"execute")[];
}
export interface DirectoryCopyIntent {
 readonly source:DirectoryCopyPinnedRef;readonly destination:DirectoryCopyPinnedRef;
 readonly expected_manifest_sha256:string;readonly manifest:DirectoryManifest;
}
export interface DirectoryCopyRecord {
 readonly format:"gsa-directory-copy-record-v1";readonly copy_id:string;readonly revision:number;
 readonly intent:DirectoryCopyIntent;readonly status:"PENDING"|"APPLIED"|"CONFLICT"|"UNKNOWN";
 readonly acknowledged:readonly {readonly path:string;readonly kind:"directory"|"file"}[];
 readonly pending_path:string|null;readonly reason:string;
}
export interface DirectoryCopyStoreApi {
 readonly rootDirectory:string;
 create(id:string,intent:DirectoryCopyIntent):Promise<{record:DirectoryCopyRecord;created:boolean}>;
 beginEntry(id:string,expectedRevision:number,path:string):Promise<DirectoryCopyRecord>;
 acknowledgeEntry(id:string,expectedRevision:number,path:string,kind:"directory"|"file"):Promise<DirectoryCopyRecord>;
 finish(id:string,expectedRevision:number,status:"APPLIED"|"CONFLICT"|"UNKNOWN",reason:string):Promise<DirectoryCopyRecord>;
 load(id:string):Promise<DirectoryCopyRecord>;
}
export class DirectoryCopyError extends Error {constructor(readonly code:string,message:string){super(message);}}
export function assertDirectoryCopyId(id:string):void {
 if(typeof id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw new DirectoryCopyError("INVALID_DIRECTORY_COPY","Invalid copy ID");
}
function invalidCopy(message:string):never {throw new DirectoryCopyError("INVALID_DIRECTORY_COPY",`Invalid directory copy: ${message}`);}
function metadataObject(value:unknown,keys:readonly string[]):Record<string,unknown>{try{return object(value,keys,"metadata");}catch{invalidCopy("metadata fields");}}
function freezeMetadata<T>(value:T):T {if(value&&typeof value==="object"){for(const item of Object.values(value))freezeMetadata(item);Object.freeze(value);}return value;}
/** Finite namespace schedule; paths remain relative to the new destination root. */
export function directoryCopySchedule(manifest:DirectoryManifest):readonly DirectoryEntry[]{
 return [...manifest.entries.filter(e=>e.kind==="directory").sort((a,b)=>a.path.split("/").length-b.path.split("/").length||compare(a,b)),...manifest.entries.filter(e=>e.kind==="file").sort(compare)];
}
export function cloneDirectoryCopyIntent(value:unknown):DirectoryCopyIntent {
 const intent=metadataObject(value,["source","destination","expected_manifest_sha256","manifest"]);
 const pin=(value:unknown,source:boolean):DirectoryCopyPinnedRef=>{
  const p=metadataObject(value,["workspace_id","path","canonical_root","role","revision","rootIdentity","permissions"]);
  if(typeof p.workspace_id!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(p.workspace_id))invalidCopy("workspace ID");
  if(typeof p.path!=="string"||!p.path||Buffer.byteLength(p.path)>4096||Buffer.from(p.path).toString("utf8")!==p.path||p.path.split("/").some(part=>part.toLowerCase()===".gsa-trash"))invalidCopy("path");
  try{validateWorkspaceRelative(p.path,source);}catch{invalidCopy("path");}
  if(typeof p.canonical_root!=="string"||!p.canonical_root.startsWith("/")||p.canonical_root==="/"||p.canonical_root.split("/").slice(1).some(x=>!x||x==="."||x==="..")||p.canonical_root.includes("\0")||Buffer.byteLength(p.canonical_root)>4096||Buffer.from(p.canonical_root).toString("utf8")!==p.canonical_root)invalidCopy("canonical root");
  if(!Number.isSafeInteger(p.revision)||(p.revision as number)<1||!["reference","workspace"].includes(p.role as string))invalidCopy("pin revision/role");
  const identity=metadataObject(p.rootIdentity,["device","inode"]);
  for(const k of ["device","inode"])if(typeof identity[k]!=="string"||!/^(0|[1-9][0-9]{0,31})$/.test(identity[k] as string))invalidCopy("identity");
  if(!Array.isArray(p.permissions)||p.permissions.length>3||new Set(p.permissions).size!==p.permissions.length||p.permissions.some(x=>!["read","write","execute"].includes(x))||!p.permissions.includes("read")||!source&&(p.role!=="workspace"||!p.permissions.includes("write")))invalidCopy("permissions");
  return {workspace_id:p.workspace_id,path:p.path,canonical_root:p.canonical_root,role:p.role as DirectoryCopyPinnedRef["role"],revision:p.revision as number,rootIdentity:{device:identity.device as string,inode:identity.inode as string},permissions:[...p.permissions]};
 };
 const m=metadataObject(intent.manifest,["format","entries","total_bytes","sha256"]);
 if(m.format!==FORMAT||!Array.isArray(m.entries)||m.entries.length<1||m.entries.length>ENTRY_LIMIT)invalidCopy("manifest entry limit");
 const entries:DirectoryEntry[]=[],seen=new Map<string,DirectoryEntry>();let total=0;
 for(const raw of m.entries){
  const kind=raw?.kind;if(kind!=="file"&&kind!=="directory")invalidCopy("manifest kind");
  const e=metadataObject(raw,kind==="file"?["path","kind","size","sha256"]:["path","kind"]);
  if(!validPath(e.path)||seen.has(e.path))invalidCopy("manifest path");
  if(!entries.length){if(e.path!==""||kind!=="directory")invalidCopy("manifest root");}
  else if(e.path===""||compare(entries.at(-1)!,{path:e.path})>=0||seen.get(e.path.includes("/")?e.path.slice(0,e.path.lastIndexOf("/")):"")?.kind!=="directory")invalidCopy("manifest order/parent");
  let entry:DirectoryEntry;
  if(kind==="file"){
   if(!safeSize(e.size)||e.size>BYTE_LIMIT||typeof e.sha256!=="string"||!/^[a-f0-9]{64}$/.test(e.sha256))invalidCopy("file metadata");
   total+=e.size;entry={path:e.path,kind,size:e.size,sha256:e.sha256};
  }else entry={path:e.path,kind};
  entries.push(entry);seen.set(entry.path,entry);
 }
 if(total>BYTE_LIMIT||m.total_bytes!==total||Buffer.byteLength(canonical(entries))>MANIFEST_LIMIT)throw new DirectoryCopyError("DIRECTORY_COPY_RECORD_LIMIT","Manifest size limit exceeded");
 if(typeof m.sha256!=="string"||m.sha256!==directoryManifestDigest(entries)||intent.expected_manifest_sha256!==m.sha256)invalidCopy("manifest hash");
 return freezeMetadata({source:pin(intent.source,true),destination:pin(intent.destination,false),expected_manifest_sha256:m.sha256,manifest:{format:FORMAT,entries,total_bytes:total,sha256:m.sha256}} as DirectoryCopyIntent);
}
export function assertDirectoryCopyIntentBudget(intent:DirectoryCopyIntent):void {
 const pinned=cloneDirectoryCopyIntent(intent),schedule=directoryCopySchedule(pinned.manifest);
 const longest=schedule.reduce((a,b)=>JSON.stringify(a.path).length>JSON.stringify(b.path).length?a:b).path;
 const maximal={format:"gsa-directory-copy-record-v1",copy_id:"00000000-0000-0000-0000-000000000000",revision:Number.MAX_SAFE_INTEGER,intent:pinned,status:"CONFLICT",acknowledged:schedule.map(({path,kind})=>({path,kind})),pending_path:longest,reason:"\u0000".repeat(256)};
 if(Buffer.byteLength(JSON.stringify(maximal))+1>1_048_576)throw new DirectoryCopyError("DIRECTORY_COPY_RECORD_LIMIT","Directory copy maximal record budget limit exceeded");
}
export function cloneDirectoryCopyRecord(value:unknown):DirectoryCopyRecord {
 const r=metadataObject(value,["format","copy_id","revision","intent","status","acknowledged","pending_path","reason"]);
 assertDirectoryCopyId(r.copy_id as string);
 if(r.format!=="gsa-directory-copy-record-v1"||!Number.isSafeInteger(r.revision)||(r.revision as number)<1||!["PENDING","APPLIED","CONFLICT","UNKNOWN"].includes(r.status as string))invalidCopy("record status/revision");
 const intent=cloneDirectoryCopyIntent(r.intent),schedule=directoryCopySchedule(intent.manifest);
 if(!Array.isArray(r.acknowledged)||r.acknowledged.length>schedule.length)invalidCopy("acknowledgement prefix");
 const acknowledged=r.acknowledged.map((raw:unknown,i:number)=>{const e=metadataObject(raw,["path","kind"]);if(e.path!==schedule[i]!.path||e.kind!==schedule[i]!.kind)invalidCopy("acknowledgement schedule");return {path:e.path as string,kind:e.kind as "directory"|"file"};});
 if(r.pending_path!==null&&r.pending_path!==schedule[acknowledged.length]?.path)invalidCopy("pending schedule");
 if(r.status==="APPLIED"&&(acknowledged.length!==schedule.length||r.pending_path!==null))invalidCopy("incomplete applied record");
 if(typeof r.reason!=="string"||!r.reason||Buffer.from(r.reason).toString("utf8")!==r.reason||Buffer.byteLength(r.reason)>256)invalidCopy("reason");
 const result={format:"gsa-directory-copy-record-v1",copy_id:r.copy_id,revision:r.revision,intent,status:r.status,acknowledged,pending_path:r.pending_path,reason:r.reason} as DirectoryCopyRecord;
 if(Buffer.byteLength(JSON.stringify(result))+1>1_048_576)throw new DirectoryCopyError("DIRECTORY_COPY_RECORD_LIMIT","Directory copy record size limit exceeded");
 return freezeMetadata(result);
}

/** Exact, bounded public metadata only; never expose native pins or payloads. */
export function validateDirectoryCopyOutcome(value:unknown):DirectoryCopyOutcome {
 const keys=["copy_id","status","source","destination","manifest_sha256","acknowledged","pending_path","reason","committed"];
 const hasReadback=value!==null&&typeof value==="object"&&Object.hasOwn(value,"readback");
 const r=metadataObject(value,hasReadback?[...keys,"readback"]:keys);
 assertDirectoryCopyId(r.copy_id as string);
 if(!["APPLIED","CONFLICT","UNKNOWN"].includes(r.status as string)||r.committed!==false)invalidCopy("public status/commit");
 const text=(v:unknown,max:number):v is string=>typeof v==="string"&&v.length>0&&Buffer.byteLength(v)<=max&&Buffer.from(v).toString("utf8")===v;
 const hash=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
 const ref=(value:unknown,source:boolean):ScopedFileRef=>{
  const p=metadataObject(value,["workspace_id","path"]);
  if(typeof p.workspace_id!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(p.workspace_id)||!text(p.path,4096)||p.path.split("/").some(x=>x.toLowerCase()===".gsa-trash"))invalidCopy("public reference");
  try{validateWorkspaceRelative(p.path,source);}catch{invalidCopy("public path");}
  return {workspace_id:p.workspace_id,path:p.path};
 };
 if(!hash(r.manifest_sha256)||!text(r.reason,256)||!Array.isArray(r.acknowledged)||r.acknowledged.length>ENTRY_LIMIT)invalidCopy("public metadata bounds");
 const seen=new Set<string>();
 const acknowledged=Array.from(r.acknowledged,(raw:unknown)=>{
  const e=metadataObject(raw,["path","kind"]);
  if(!validPath(e.path)||!["directory","file"].includes(e.kind as string)||seen.has(e.path))invalidCopy("public acknowledgement");
  seen.add(e.path);return {path:e.path,kind:e.kind as "directory"|"file"};
 });
 if(r.pending_path!==null&&(!validPath(r.pending_path)||seen.has(r.pending_path)))invalidCopy("public pending path");
 if(r.status==="APPLIED"&&r.pending_path!==null)invalidCopy("public applied pending path");
 let readback:DirectoryCopyOutcome["readback"];
 if(hasReadback){
  const b=metadataObject(r.readback,["status","manifest_sha256","reason"]);
  if(!["MATCH","DIFFERENT","ABSENT","UNAVAILABLE"].includes(b.status as string)||(b.manifest_sha256!==null&&!hash(b.manifest_sha256))||!text(b.reason,256))invalidCopy("public readback");
  readback={status:b.status as NonNullable<DirectoryCopyOutcome["readback"]>["status"],manifest_sha256:b.manifest_sha256 as string|null,reason:b.reason};
 }
 const result:DirectoryCopyOutcome={copy_id:r.copy_id as string,status:r.status as DirectoryCopyOutcome["status"],source:ref(r.source,true),destination:ref(r.destination,false),manifest_sha256:r.manifest_sha256,acknowledged,pending_path:r.pending_path as string|null,reason:r.reason,committed:false,...(readback?{readback}:{})};
 if(Buffer.byteLength(JSON.stringify(result))+1>1_048_576)invalidCopy("public outcome size");
 return freezeMetadata(result);
}
