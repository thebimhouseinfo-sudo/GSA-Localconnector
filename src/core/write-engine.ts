import {TextDecoder} from "node:util";
import {applyUnifiedTextPatch} from "./unified-patch.js";
import {exactTextEdit,planExactEdit,requireExpectedHash,sha256} from "./edit-guards.js";
import type {NativeScopedFiles,ScopedFileRef,MutationReceipt} from "./native-io.js";
const MAX_BYTES=8*1024*1024;
export class MutationError extends Error {constructor(public readonly code:"INVALID_ARGUMENTS"|"FILE_TOO_LARGE",message:string){super(message);}}
function validate(ref:ScopedFileRef):void{
 if(!ref.workspace_id||!ref.path||ref.path==="."||ref.path.startsWith("/")||ref.path.startsWith("-")||ref.path.includes("\\")||ref.path.split("/").some(p=>p==="."||p===".."||!p)||ref.path.includes("\0"))throw new MutationError("INVALID_ARGUMENTS","Expected clean Workspace-relative path");
}
function body(value:string):Uint8Array{
 const b=Buffer.from(value,"utf8");
 if(b.byteLength>MAX_BYTES)throw new MutationError("FILE_TOO_LARGE","Mutation exceeds 8 MiB");
 return b;
}
function receipt(ref:ScopedFileRef,before:string|null,after:string|null):MutationReceipt{return {workspace_id:ref.workspace_id,path:ref.path,before_sha256:before,after_sha256:after,file_mutated:true,committed:false};}
/** Commit boundary is delegated to a native handle-relative filesystem. */
export async function createFile(io:NativeScopedFiles,ref:ScopedFileRef,content:string):Promise<MutationReceipt>{
 validate(ref);const bytes=body(content);await io.createExclusive(ref,bytes);return receipt(ref,null,sha256(bytes));
}
export async function updateFile(io:NativeScopedFiles,ref:ScopedFileRef,content:string,expectedSha256:string):Promise<MutationReceipt>{
 validate(ref);const bytes=body(content);const snap=await io.read(ref,MAX_BYTES);
 requireExpectedHash(snap.bytes,expectedSha256);
 await io.replaceIfHash(ref,bytes,expectedSha256);
 return receipt(ref,expectedSha256,sha256(bytes));
}
export async function editFile(io:NativeScopedFiles,ref:ScopedFileRef,oldText:string,newText:string,expectedSha256:string):Promise<MutationReceipt>{
 validate(ref);const snap=await io.read(ref,MAX_BYTES);
 const planned=planExactEdit(snap.bytes,expectedSha256,oldText,newText);
 await io.replaceIfHash(ref,planned.content,expectedSha256);
 return receipt(ref,planned.before_sha256,planned.after_sha256);
}
export async function createDirectory(io:NativeScopedFiles,ref:ScopedFileRef):Promise<void>{validate(ref);await io.makeDirectory(ref);}
export async function trashFile(io:NativeScopedFiles,ref:ScopedFileRef,expectedSha256:string):Promise<MutationReceipt>{
 validate(ref);const snap=await io.read(ref,MAX_BYTES);requireExpectedHash(snap.bytes,expectedSha256);
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

export async function applyPatch(io:NativeScopedFiles,ref:ScopedFileRef,patch:string,expectedSha256:string):Promise<MutationReceipt>{
 validate(ref);
 const snap=await io.read(ref,MAX_BYTES);
 requireExpectedHash(snap.bytes,expectedSha256);
 const original=new TextDecoder("utf-8",{fatal:true}).decode(snap.bytes);
 const next=body(applyUnifiedTextPatch(original,patch));
 await io.replaceIfHash(ref,next,expectedSha256);
 return receipt(ref,expectedSha256,sha256(next));
}
