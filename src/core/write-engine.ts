import {TextDecoder} from "node:util";
import {applyUnifiedTextPatch} from "./unified-patch.js";
import {validateWorkspaceRelative} from "./workspace-path.js";
import {exactTextEdit,planExactEdit,requireExpectedHash,sha256} from "./edit-guards.js";
import type {NativeScopedFiles,ScopedFileRef,MutationReceipt} from "./native-io.js";
import {FileTransactionError,fileTransactionOutcome,type FileTransactionIntent,type FileTransactionOutcome} from "./file-transactions.js";
/** Uncertain outcomes deliberately have no synthetic legacy receipt fields. */
export type RecoverableMutationResult=MutationReceipt|(FileTransactionOutcome & Partial<Record<keyof MutationReceipt,never>>);
const MAX_BYTES=8*1024*1024;
export class MutationError extends Error {constructor(public readonly code:"INVALID_ARGUMENTS"|"FILE_TOO_LARGE",message:string){super(message);}}
function validate(ref:ScopedFileRef):void{
 if(!ref.workspace_id)throw new MutationError("INVALID_ARGUMENTS","Missing Workspace");
 validateWorkspaceRelative(ref.path);
}
function captureRef(ref:ScopedFileRef):ScopedFileRef{
 const captured=Object.freeze({workspace_id:ref.workspace_id,path:ref.path});
 validate(captured);return captured;
}

function body(value:string):Uint8Array{
 const b=Buffer.from(value,"utf8");
 if(b.byteLength>MAX_BYTES)throw new MutationError("FILE_TOO_LARGE","Mutation exceeds 8 MiB");
 return b;
}
function receipt(ref:ScopedFileRef,before:string|null,after:string|null):MutationReceipt{return {workspace_id:ref.workspace_id,path:ref.path,before_sha256:before,after_sha256:after,file_mutated:true,committed:false};}
/** Validate a returned observation without creating or persisting an intent.
 * The local revision is used only by the existing metadata validator. */
function observedOutcome(value:FileTransactionOutcome,ref:ScopedFileRef,operation:FileTransactionIntent["operation"],before:string,after:string|null):FileTransactionOutcome{
 const outcome=fileTransactionOutcome({...value,revision:1});
 const intent=outcome.intent;
 if(intent.operation!==operation||intent.source.workspace_id!==ref.workspace_id||intent.source.path!==ref.path||intent.destination!==null||intent.expected_sha256!==before||intent.after_sha256!==after){
  throw new FileTransactionError("INVALID_FILE_TRANSACTION","Native transaction does not match requested mutation; effects require reconciliation");
 }
 return outcome;
}
async function replace(io:NativeScopedFiles,ref:ScopedFileRef,bytes:Uint8Array,expectedSha256:string):Promise<RecoverableMutationResult>{
 const afterSha256=sha256(bytes);
 if(io.recoverableMutations){
  const outcome=await io.recoverableMutations.replaceIfHash(ref,bytes,expectedSha256);
  return observedOutcome(outcome,ref,"replace",expectedSha256,afterSha256);
 }
 await io.replaceIfHash(ref,bytes,expectedSha256);
 return receipt(ref,expectedSha256,afterSha256);
}
/** Commit boundary is delegated to a native handle-relative filesystem. */
function boundedBytes(content:Uint8Array):Uint8Array {
 if(content.byteLength>MAX_BYTES)throw new MutationError("FILE_TOO_LARGE","Mutation exceeds 8 MiB");
 return Buffer.from(content);
}
export async function createFileBytes(io:NativeScopedFiles,ref:ScopedFileRef,content:Uint8Array):Promise<MutationReceipt>{
 ref=captureRef(ref);const bytes=boundedBytes(content);await io.createExclusive(ref,bytes);return receipt(ref,null,sha256(bytes));
}
export async function createFile(io:NativeScopedFiles,ref:ScopedFileRef,content:string):Promise<MutationReceipt>{
 return createFileBytes(io,ref,body(content));
}
export async function updateFileBytes(io:NativeScopedFiles,ref:ScopedFileRef,content:Uint8Array,expectedSha256:string):Promise<RecoverableMutationResult>{
 ref=captureRef(ref);const bytes=boundedBytes(content);const snap=await io.read(ref,MAX_BYTES);
 requireExpectedHash(snap.bytes,expectedSha256);
 return replace(io,ref,bytes,expectedSha256);
}
export async function updateFile(io:NativeScopedFiles,ref:ScopedFileRef,content:string,expectedSha256:string):Promise<RecoverableMutationResult>{
 return updateFileBytes(io,ref,body(content),expectedSha256);
}
export async function editFile(io:NativeScopedFiles,ref:ScopedFileRef,oldText:string,newText:string,expectedSha256:string):Promise<RecoverableMutationResult>{
 ref=captureRef(ref);const snap=await io.read(ref,MAX_BYTES);
 const planned=planExactEdit(snap.bytes,expectedSha256,oldText,newText);
 return replace(io,ref,planned.content,expectedSha256);
}
/** Safe non-destructive text-edit path available on a qualified BASE create-only backend.
 * A source digest is a snapshot precondition, not a claim that concurrent source
 * changes are locked. Destination creation is exclusive and never replaces data.
 */
export async function editFileAsNewVersion(io:NativeScopedFiles,source:ScopedFileRef,destination:ScopedFileRef,oldText:string,newText:string,expectedSha256:string):Promise<MutationReceipt&{source_workspace_id:string;source_path:string;source_sha256:string}>{
 source=captureRef(source);destination=captureRef(destination);
 if(source.workspace_id===destination.workspace_id&&source.path===destination.path)
  throw new MutationError("INVALID_ARGUMENTS","Destination must differ from source");
 const captured=await io.read(source,MAX_BYTES);
 const planned=planExactEdit(captured.bytes,expectedSha256,oldText,newText);
 if(planned.content.byteLength>MAX_BYTES)throw new MutationError("FILE_TOO_LARGE","Versioned edit exceeds 8 MiB");
 // Capture again to reject a source edit that happened during planning.
 // The caller knows the resulting version derives from the pinned snapshot.
 const reread=await io.read(source,MAX_BYTES);
 requireExpectedHash(reread.bytes,expectedSha256);
 await io.createExclusive(destination,planned.content);
 // The exclusive effect has occurred. A failed or mismatching readback must
 // return UNKNOWN; never retry or pretend the created file was rolled back.
 try{
  const observed=await io.read(destination,MAX_BYTES);
  if(sha256(observed.bytes)!==planned.after_sha256)throw Error("VERSION_READBACK_MISMATCH");
 }catch{
  throw Object.assign(Error("Version was created but verified readback is unavailable; inspect destination before retrying"),{code:"RESULT_UNKNOWN"});
 }
 return {...receipt(destination,null,planned.after_sha256),
  source_workspace_id:source.workspace_id,source_path:source.path,source_sha256:planned.before_sha256};
}
export async function createDirectory(io:NativeScopedFiles,ref:ScopedFileRef):Promise<void>{validate(ref);await io.makeDirectory(ref);}
export async function trashFile(io:NativeScopedFiles,ref:ScopedFileRef,expectedSha256:string):Promise<RecoverableMutationResult>{
 ref=captureRef(ref);const snap=await io.read(ref,MAX_BYTES);requireExpectedHash(snap.bytes,expectedSha256);
 if(io.recoverableMutations){
  const outcome=await io.recoverableMutations.trashIfHash(ref,expectedSha256);
  return observedOutcome(outcome,ref,"trash",expectedSha256,null);
 }
 await io.trashIfHash(ref,expectedSha256);return receipt(ref,expectedSha256,null);
}
export async function copyFile(io:NativeScopedFiles,source:ScopedFileRef,dest:ScopedFileRef,expectedSha256:string):Promise<MutationReceipt>{
 validate(source);validate(dest);const snap=await io.read(source,MAX_BYTES);requireExpectedHash(snap.bytes,expectedSha256);
 await io.copyExclusive(source,dest,expectedSha256);return receipt(dest,null,expectedSha256);
}
/** A verified destination copy followed by a separately journaled, recoverable
 * source trash. This is NOT an atomic cross-root rename. Partial effects are
 * reported explicitly, and no uncertain step is ever retried automatically. */
export type RecoverableMoveResult=MutationReceipt|{
 readonly operation:"move";readonly status:"APPLIED"|"CONFLICT"|"UNKNOWN";
 readonly source:ScopedFileRef;readonly destination:ScopedFileRef;
 readonly expected_sha256:string;readonly destination_created:true;
 readonly source_transaction:FileTransactionOutcome|null;
 readonly reason:"VERIFIED_READBACK"|"SOURCE_CONFLICT"|"SOURCE_UNKNOWN"|"SOURCE_ERROR"|"DESTINATION_UNKNOWN";
};
export async function moveFile(io:NativeScopedFiles,source:ScopedFileRef,dest:ScopedFileRef,expectedSha256:string):Promise<RecoverableMoveResult>{
 source=captureRef(source);dest=captureRef(dest);
 if(source.workspace_id===dest.workspace_id&&source.path===dest.path)
  throw new MutationError("INVALID_ARGUMENTS","Move destination must differ from source");
 const snap=await io.read(source,MAX_BYTES);requireExpectedHash(snap.bytes,expectedSha256);
 if(!io.recoverableMutations){
  await io.moveExclusive(source,dest,expectedSha256);return receipt(dest,null,expectedSha256);
 }
 // Exclusive copy must be fully acknowledged before source removal is attempted.
 await io.copyExclusive(source,dest,expectedSha256);
 const base={operation:"move" as const,source,destination:dest,expected_sha256:expectedSha256,destination_created:true as const};
 let verified=false;
 try{
  const observed=await io.read(dest,MAX_BYTES);
  verified=sha256(observed.bytes)===expectedSha256;
 }catch{/* Preserve created destination, keep source and report uncertainty. */}
 if(!verified)return {...base,status:"UNKNOWN",source_transaction:null,reason:"DESTINATION_UNKNOWN"};
 let sourceTransaction:FileTransactionOutcome;
 try{
  sourceTransaction=observedOutcome(await io.recoverableMutations.trashIfHash(source,expectedSha256),source,"trash",expectedSha256,null);
 }catch{
  // The destination is verified, but the source may have been captured.
  // Never claim a successful move or undo the destination on uncertainty.
  return {...base,status:"UNKNOWN",source_transaction:null,reason:"SOURCE_ERROR"};
 }
 return {...base,source_transaction:sourceTransaction,
  status:sourceTransaction.status,
  reason:sourceTransaction.status==="APPLIED"?"VERIFIED_READBACK":sourceTransaction.status==="CONFLICT"?"SOURCE_CONFLICT":"SOURCE_UNKNOWN"};
}

export async function applyPatch(io:NativeScopedFiles,ref:ScopedFileRef,patch:string,expectedSha256:string):Promise<RecoverableMutationResult>{
 ref=captureRef(ref);
 const snap=await io.read(ref,MAX_BYTES);
 requireExpectedHash(snap.bytes,expectedSha256);
 const original=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(snap.bytes);
 const next=body(applyUnifiedTextPatch(original,patch));
 return replace(io,ref,next,expectedSha256);
}
