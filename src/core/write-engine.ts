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
export async function createFile(io:NativeScopedFiles,ref:ScopedFileRef,content:string):Promise<MutationReceipt>{
 validate(ref);const bytes=body(content);await io.createExclusive(ref,bytes);return receipt(ref,null,sha256(bytes));
}
export async function updateFile(io:NativeScopedFiles,ref:ScopedFileRef,content:string,expectedSha256:string):Promise<RecoverableMutationResult>{
 ref=captureRef(ref);const bytes=body(content);const snap=await io.read(ref,MAX_BYTES);
 requireExpectedHash(snap.bytes,expectedSha256);
 return replace(io,ref,bytes,expectedSha256);
}
export async function editFile(io:NativeScopedFiles,ref:ScopedFileRef,oldText:string,newText:string,expectedSha256:string):Promise<RecoverableMutationResult>{
 ref=captureRef(ref);const snap=await io.read(ref,MAX_BYTES);
 const planned=planExactEdit(snap.bytes,expectedSha256,oldText,newText);
 return replace(io,ref,planned.content,expectedSha256);
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
export async function moveFile(io:NativeScopedFiles,source:ScopedFileRef,dest:ScopedFileRef,expectedSha256:string):Promise<MutationReceipt>{
 validate(source);validate(dest);const snap=await io.read(source,MAX_BYTES);requireExpectedHash(snap.bytes,expectedSha256);
 await io.moveExclusive(source,dest,expectedSha256);return receipt(dest,null,expectedSha256);
}

export async function applyPatch(io:NativeScopedFiles,ref:ScopedFileRef,patch:string,expectedSha256:string):Promise<RecoverableMutationResult>{
 ref=captureRef(ref);
 const snap=await io.read(ref,MAX_BYTES);
 requireExpectedHash(snap.bytes,expectedSha256);
 const original=new TextDecoder("utf-8",{fatal:true}).decode(snap.bytes);
 const next=body(applyUnifiedTextPatch(original,patch));
 return replace(io,ref,next,expectedSha256);
}
