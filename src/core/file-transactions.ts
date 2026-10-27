import {validateWorkspaceRelative} from "./workspace-path.js";

export type FileTransactionStatus="APPLIED"|"CONFLICT"|"UNKNOWN";
export type FileTransactionOperation="replace"|"move"|"trash";
export interface FileTransactionRef {
 readonly workspace_id:string;readonly path:string;readonly revision:number;
 readonly rootIdentity:Readonly<{device:string;inode:string}>;
}
export interface FileTransactionIntent {
 readonly operation:FileTransactionOperation;
 readonly source:FileTransactionRef;readonly destination:FileTransactionRef|null;
 readonly expected_sha256:string;readonly after_sha256:string|null;
}
export interface FileTransactionObservations {
 readonly captured:boolean|null;readonly published:boolean|null;
 readonly source_absent:boolean|null;readonly destination_present:boolean|null;
 readonly source_sha256:string|null;readonly destination_sha256:string|null;
 readonly capturedIdentity:Readonly<{device:string;inode:string}>|null;
 readonly publishedIdentity:Readonly<{device:string;inode:string}>|null;
}
export type FileTransactionReason="INTENT_DURABLE"|"INTERRUPTED"|"VERIFIED_READBACK"|"HASH_CONFLICT"|"ENTRY_CONFLICT"|"AUTHORIZATION_CHANGED"|"IO_UNCERTAIN";
export interface FileTransactionRecord {
 readonly transaction_id:string;readonly revision:number;readonly intent:FileTransactionIntent;
 readonly status:"PENDING"|FileTransactionStatus;readonly observations:FileTransactionObservations;
 readonly retained_handles:readonly string[];readonly reason:FileTransactionReason;
}
export interface FileTransactionOutcome {
 readonly transaction_id:string;readonly status:FileTransactionStatus;readonly intent:FileTransactionIntent;
 readonly observations:FileTransactionObservations;readonly retained_handles:readonly string[];readonly reason:FileTransactionReason;
}
export interface FileTransactionReadback {
 readonly status:FileTransactionStatus;readonly observations:FileTransactionObservations;
 readonly retained_handles:readonly string[];readonly reason:Exclude<FileTransactionReason,"INTENT_DURABLE">;
}
export class FileTransactionError extends Error {
 constructor(readonly code:string,message:string){super(message);}
}
const invalid=():never=>{throw new FileTransactionError("INVALID_FILE_TRANSACTION","Invalid bounded file transaction metadata");};
export function assertFileTransactionId(id:string):void {if(typeof id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))invalid();}
const keys=(value:unknown,names:readonly string[]):Record<string,unknown>=>{
 if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==names.length||Object.keys(value).some(k=>!names.includes(k)))invalid();
 return value as Record<string,unknown>;
};
const hash=(value:unknown)=>{if(typeof value!=="string"||!/^[a-f0-9]{64}$/.test(value))invalid();};
const identity=(value:unknown)=>{const v=keys(value,["device","inode"]);for(const key of ["device","inode"])if(typeof v[key]!=="string"||!/^\d{1,32}$/.test(v[key] as string))invalid();};
const ref=(value:unknown)=>{
 const v=keys(value,["workspace_id","path","revision","rootIdentity"]);
 if(typeof v.workspace_id!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v.workspace_id)||typeof v.path!=="string"||v.path.length>4096||!Number.isSafeInteger(v.revision)||Number(v.revision)<1)invalid();
 validateWorkspaceRelative(v.path as string);identity(v.rootIdentity);
};
function validateIntent(value:unknown):void {
 const v=keys(value,["operation","source","destination","expected_sha256","after_sha256"]);
 if(!["replace","move","trash"].includes(v.operation as string))invalid();ref(v.source);hash(v.expected_sha256);
 if(v.operation==="move"){ref(v.destination);if(v.after_sha256!==v.expected_sha256)invalid();}
 else if(v.destination!==null)invalid();
 if(v.operation==="trash"){if(v.after_sha256!==null)invalid();}else hash(v.after_sha256);
}
function validateObservations(value:unknown):void {
 const v=keys(value,["captured","published","source_absent","destination_present","source_sha256","destination_sha256","capturedIdentity","publishedIdentity"]);
 for(const key of ["captured","published","source_absent","destination_present"])if(v[key]!==null&&typeof v[key]!=="boolean")invalid();
 for(const key of ["source_sha256","destination_sha256"])if(v[key]!==null)hash(v[key]);
 for(const key of ["capturedIdentity","publishedIdentity"])if(v[key]!==null)identity(v[key]);
}
export function validateFileTransactionRecord(value:unknown):asserts value is FileTransactionRecord {
 const v=keys(value,["transaction_id","revision","intent","status","observations","retained_handles","reason"]);
 assertFileTransactionId(v.transaction_id as string);validateIntent(v.intent);validateObservations(v.observations);
 if(!Number.isSafeInteger(v.revision)||Number(v.revision)<1||!["PENDING","APPLIED","CONFLICT","UNKNOWN"].includes(v.status as string)||!["INTENT_DURABLE","INTERRUPTED","VERIFIED_READBACK","HASH_CONFLICT","ENTRY_CONFLICT","AUTHORIZATION_CHANGED","IO_UNCERTAIN"].includes(v.reason as string))invalid();
 if(!Array.isArray(v.retained_handles)||v.retained_handles.length>8||new Set(v.retained_handles).size!==v.retained_handles.length)invalid();for(const id of v.retained_handles as string[])assertFileTransactionId(id);
 const r=value as FileTransactionRecord;
 if(r.status==="PENDING"&&(r.reason!=="INTENT_DURABLE"||r.retained_handles.length||Object.values(r.observations).some(x=>x!==null)))invalid();
 if(r.status!=="PENDING"&&r.reason==="INTENT_DURABLE")invalid();
 if(r.status==="APPLIED"){
  const o=r.observations;
  if(r.reason!=="VERIFIED_READBACK"||o.captured!==true||!o.capturedIdentity||!r.retained_handles.length)invalid();
  if(r.intent.operation==="trash"){if(o.source_absent!==true)invalid();}
  else if(o.published!==true||o.destination_present!==true||o.destination_sha256!==r.intent.after_sha256||!o.publishedIdentity||r.intent.operation==="move"&&o.source_absent!==true)invalid();
 }
}
function freeze<T>(value:T):T {if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export function cloneFileTransaction(record:FileTransactionRecord):FileTransactionRecord {const copy=structuredClone(record);validateFileTransactionRecord(copy);return freeze(copy);}
export function newFileTransaction(id:string,intent:FileTransactionIntent):FileTransactionRecord {
 const record={transaction_id:id,revision:1,intent:structuredClone(intent),status:"PENDING" as const,observations:{captured:null,published:null,source_absent:null,destination_present:null,source_sha256:null,destination_sha256:null,capturedIdentity:null,publishedIdentity:null},retained_handles:[],reason:"INTENT_DURABLE" as const};
 return cloneFileTransaction(record);
}
/** Observation only: this module cannot execute or certify native file mutation. */
export function transitionFileTransaction(previous:FileTransactionRecord,observed:FileTransactionReadback,expectedRevision:number,explicitReadback=false):FileTransactionRecord {
 const before=cloneFileTransaction(previous);
 if(before.revision!==expectedRevision||!Number.isSafeInteger(expectedRevision+1))throw new FileTransactionError("FILE_TRANSACTION_REVISION_CONFLICT","Stale transaction revision");
 if(before.status==="APPLIED"||before.status==="CONFLICT")throw new FileTransactionError("FILE_TRANSACTION_TERMINAL","Terminal observation is immutable");
 if((before.status==="UNKNOWN"||observed.status==="APPLIED")&&!explicitReadback)throw new FileTransactionError("FILE_TRANSACTION_READBACK_REQUIRED","Explicit readback required; never replay a mutation");
 const update=keys(observed,["status","observations","retained_handles","reason"]);
 if(!["APPLIED","CONFLICT","UNKNOWN"].includes(update.status as string)||!Array.isArray(update.retained_handles)||before.retained_handles.some(id=>!(update.retained_handles as unknown[]).includes(id)))invalid();
 validateObservations(update.observations);
 const nextObservations=update.observations as unknown as FileTransactionObservations;
 for(const effect of ["captured","published"] as const)if(before.observations[effect]===true&&nextObservations[effect]!==true)invalid();
 for(const name of ["capturedIdentity","publishedIdentity"] as const){
  const prior=before.observations[name],next=nextObservations[name];
  if(prior&&(!next||prior.device!==next.device||prior.inode!==next.inode))invalid();
 }
 return cloneFileTransaction({...before,...structuredClone(update),revision:before.revision+1} as FileTransactionRecord);
}
export function reconcileFileTransaction(record:FileTransactionRecord,readback?:FileTransactionReadback):FileTransactionRecord {
 const before=cloneFileTransaction(record);
 if(readback)return transitionFileTransaction(before,readback,before.revision,true);
 if(before.status!=="PENDING")return before;
 return transitionFileTransaction(before,{status:"UNKNOWN",observations:before.observations,retained_handles:before.retained_handles,reason:"INTERRUPTED"},before.revision);
}
export function fileTransactionOutcome(record:FileTransactionRecord):FileTransactionOutcome {
 const r=cloneFileTransaction(record);if(r.status==="PENDING")throw new FileTransactionError("FILE_TRANSACTION_PENDING","No observed outcome yet");
 return freeze({transaction_id:r.transaction_id,status:r.status,intent:r.intent,observations:r.observations,retained_handles:r.retained_handles,reason:r.reason});
}
