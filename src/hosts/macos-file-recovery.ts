import type {NativeRecoverableFileMutations,ScopedFileRef} from "../core/native-io.js";
import type {WorkspaceRegistry} from "../core/workspace.js";
import type {FileTransactionStore} from "../local/file-transaction-store.js";
import {createHash,randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {validateWorkspaceRelative} from "../core/workspace-path.js";
import {assertFileTransactionId,cloneFileTransaction,fileTransactionOutcome,newFileTransaction,type FileTransactionIntent,type FileTransactionObservations,type FileTransactionOutcome,type FileTransactionReadback,type FileTransactionRecord,type FileTransactionRef} from "../core/file-transactions.js";

export interface MacFileRecoveryOptions {
 readonly registry:WorkspaceRegistry;
 readonly store:Pick<FileTransactionStore,"create"|"load"|"update">;
 readonly authorize:(workspaceId:string)=>Promise<void>;
 readonly invoke:(ref:ScopedFileRef,request:Readonly<Record<string,unknown>>)=>Promise<unknown>;
}
export const MAC_FILE_RECOVERY_ACTIVATION_BLOCKED="Native recovery containment/crash evidence and reviewed installation are not available";
const PROTOCOL="gsa-file-recovery-v1",MAX=8*1024*1024;
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const invalid=():never=>{throw Error("INVALID_NATIVE_RECOVERY_OUTCOME");};
function object(value:unknown,allowed:readonly string[],required=allowed):Record<string,unknown>{
 if(!value||typeof value!=="object"||Array.isArray(value))invalid();
 const result=value as Record<string,unknown>;
 if(Object.keys(result).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(result,k)))invalid();return result;
}
function hash(value:unknown):asserts value is string {if(typeof value!=="string"||!/^[a-f0-9]{64}$/.test(value))invalid();}
function identity(value:unknown):Readonly<{device:string;inode:string}>{
 const o=object(value,["device","inode"]);for(const k of ["device","inode"])if(typeof o[k]!=="string"||!/^\d{1,32}$/.test(o[k] as string))invalid();
 return {device:o.device as string,inode:o.inode as string};
}
function normalize(value:unknown,record:FileTransactionRecord):FileTransactionReadback{
 const r=object(value,["ok","protocol","transaction_id","status","intent","observations","retained_handles","reason"]);
 if(r.ok!==true||r.protocol!==PROTOCOL||r.transaction_id!==record.transaction_id||!["APPLIED","CONFLICT","UNKNOWN"].includes(r.status as string)||typeof r.reason!=="string")invalid();
 const i=object(r.intent,["protocol","transaction_id","operation","workspace_id","revision","path","expected_sha256","after_sha256"]),expected=record.intent;
 if(i.protocol!==PROTOCOL||i.transaction_id!==record.transaction_id||i.operation!==expected.operation||i.workspace_id!==expected.source.workspace_id||i.revision!==expected.source.revision||i.path!==expected.source.path||i.expected_sha256!==expected.expected_sha256||i.after_sha256!==(expected.after_sha256??""))invalid();
 const raw=object(r.observations,["captured","published","source_absent","destination_present","source_sha256","destination_sha256","capturedIdentity","publishedIdentity","captured_sha256","restored_exclusively"],[]);
 const observations:FileTransactionObservations={captured:null,published:null,source_absent:null,destination_present:null,source_sha256:null,destination_sha256:null,capturedIdentity:null,publishedIdentity:null};
 for(const key of ["captured","published","source_absent","destination_present"] as const)if(Object.hasOwn(raw,key)){if(typeof raw[key]!=="boolean")invalid();(observations as any)[key]=raw[key];}
 for(const key of ["source_sha256","destination_sha256"] as const)if(Object.hasOwn(raw,key)){hash(raw[key]);(observations as any)[key]=raw[key];}
 for(const key of ["capturedIdentity","publishedIdentity"] as const)if(Object.hasOwn(raw,key))(observations as any)[key]=identity(raw[key]);
 if(Object.hasOwn(raw,"captured_sha256"))hash(raw.captured_sha256);
 if(Object.hasOwn(raw,"restored_exclusively")&&typeof raw.restored_exclusively!=="boolean")invalid();
 const handles=r.retained_handles;
 if(!Array.isArray(handles)||handles.length>1||handles.some(id=>id!==record.transaction_id))invalid();
 const retained=handles as string[],nativeReason=r.reason as string;
 if(raw.restored_exclusively===true&&(retained.length||raw.captured!==true))invalid();
 let reason:FileTransactionReadback["reason"];
 if(r.status==="APPLIED"){
  if(r.reason!=="VERIFIED_READBACK"||raw.captured_sha256!==expected.expected_sha256)invalid();reason="VERIFIED_READBACK";
 }else if(r.reason==="HASH_CONFLICT")reason="HASH_CONFLICT";
 else if(["UNSAFE_CAPTURE_PRESERVED","CAPTURE_CONFLICT","SOURCE_RECREATED","DESTINATION_PRESENT_OR_PUBLICATION_DENIED"].includes(nativeReason))reason="ENTRY_CONFLICT";
 else if(["GRANT_BINDING_MISMATCH","ROOT_CHANGED","ROOT_UNVERIFIED","RECOVERY_OVERLAPS_WORKSPACE"].includes(nativeReason))reason="AUTHORIZATION_CHANGED";
 else reason="IO_UNCERTAIN";
 const readback={status:r.status as FileTransactionReadback["status"],observations,retained_handles:[...retained],reason};
 // Existing validation enforces the complete operation-specific APPLIED evidence.
 cloneFileTransaction({...record,...readback});return readback;
}
function uncertain(record:FileTransactionRecord,reason:FileTransactionReadback["reason"],observed?:FileTransactionReadback):FileTransactionRecord{
 const prior=record.observations,next=observed?.observations;
 const observations={...prior};
 if(next)for(const key of Object.keys(next) as (keyof FileTransactionObservations)[])if(next[key]!==null)(observations as any)[key]=next[key];
 // Proven historical effects and retained handles must survive later sparse inspection.
 for(const key of ["captured","published"] as const)if(prior[key]===true)(observations as any)[key]=true;
 for(const key of ["capturedIdentity","publishedIdentity"] as const)if(prior[key])(observations as any)[key]=prior[key];
 const retained_handles=[...new Set([...record.retained_handles,...(observed?.retained_handles??[])])];
 return cloneFileTransaction({...record,status:"UNKNOWN",reason,observations,retained_handles});
}
/** Fixed-protocol coordinator only. Production activation is separately blocked by
 * the loader until the exact signed native boundary has independent evidence. */
export function createMacFileRecovery(options:MacFileRecoveryOptions):NativeRecoverableFileMutations & {readTransaction(id:string):Promise<FileTransactionOutcome>}{
 const {registry,store,authorize,invoke}=options;
 function capture(ref:ScopedFileRef):FileTransactionRef{
  const id=ref.workspace_id,relative=ref.path;validateWorkspaceRelative(relative);
  const g=registry.requireGrant(id,"write");registry.requireGrant(id,"read");
  if(g.role==="reference")throw Error("PERMISSION_DENIED");
  return Object.freeze({workspace_id:id,path:relative,revision:g.revision,rootIdentity:Object.freeze({...g.rootIdentity})});
 }
 function recheck(ref:FileTransactionRef):void{
  const current=capture(ref);
  if(!isDeepStrictEqual(current,ref))throw Error("GRANT_BINDING_MISMATCH");
 }
 async function check(ref:FileTransactionRef):Promise<void>{await authorize(ref.workspace_id);recheck(ref);}
 async function unknown(record:FileTransactionRecord,reason:FileTransactionReadback["reason"],observed?:FileTransactionReadback):Promise<FileTransactionOutcome>{
  const result=uncertain(record,reason,observed);
  try{return fileTransactionOutcome(await store.update(record.transaction_id,record.revision,{status:"UNKNOWN",observations:result.observations,retained_handles:result.retained_handles,reason},true));}
  catch{return fileTransactionOutcome(result);}
 }
 async function finish(record:FileTransactionRecord,value:unknown):Promise<FileTransactionOutcome>{
  let observed:FileTransactionReadback;try{observed=normalize(value,record);}catch{return unknown(record,"IO_UNCERTAIN");}
  try{return fileTransactionOutcome(await store.update(record.transaction_id,record.revision,observed,true));}
  catch{return unknown(record,"IO_UNCERTAIN",observed);}
 }
 async function mutate(ref:ScopedFileRef,operation:"replace"|"trash",data:Uint8Array|undefined,expected:string):Promise<FileTransactionOutcome>{
  const captured=capture(ref);hash(expected);const bytes=data===undefined?undefined:Buffer.from(data);
  if(bytes&&bytes.length>MAX)throw Error("WRITE_LIMIT_EXCEEDED");
  const intent:FileTransactionIntent={operation,source:captured,destination:null,expected_sha256:expected,after_sha256:bytes?sha(bytes):null};
  await check(captured);const id=randomUUID();let record=newFileTransaction(id,intent);
  try{
   record=await store.create(id,intent);
   if(record.transaction_id!==id||!isDeepStrictEqual(record.intent,intent)||record.status!=="PENDING"||record.revision!==1)return fileTransactionOutcome(uncertain(newFileTransaction(id,intent),"IO_UNCERTAIN"));
  }catch{return fileTransactionOutcome(uncertain(record,"IO_UNCERTAIN"));}
  try{await check(captured);}catch{return unknown(record,"AUTHORIZATION_CHANGED");}
  const request=Object.freeze({protocol:PROTOCOL,operation,transaction_id:id,workspace_id:captured.workspace_id,revision:captured.revision,path:captured.path,expected_sha256:expected,...(bytes?{base64:bytes.toString("base64")}:{})});
  let response:unknown;try{response=await invoke(Object.freeze({workspace_id:captured.workspace_id,path:captured.path}),request);}catch{return unknown(record,"IO_UNCERTAIN");}
  return finish(record,response);
 }
 return {
  replaceIfHash:(ref,bytes,expected)=>mutate(ref,"replace",bytes,expected),
  trashIfHash:(ref,expected)=>mutate(ref,"trash",undefined,expected),
  async readTransaction(id){
   assertFileTransactionId(id);const record=await store.load(id);
   // A failed authority check must not disclose protected transaction metadata.
   await authorize(record.intent.source.workspace_id);
   try{recheck(record.intent.source);}catch{
    if(record.status==="APPLIED"||record.status==="CONFLICT")return fileTransactionOutcome(uncertain(record,"AUTHORIZATION_CHANGED"));
    return unknown(record,"AUTHORIZATION_CHANGED");
   }
   if(record.status==="APPLIED"||record.status==="CONFLICT")return fileTransactionOutcome(record);
   let response:unknown;try{response=await invoke(Object.freeze({workspace_id:record.intent.source.workspace_id,path:record.intent.source.path}),Object.freeze({protocol:PROTOCOL,operation:"inspect",transaction_id:id}));}
   catch{return unknown(record,"IO_UNCERTAIN");}
   return finish(record,response);
  }
 };
}
