import fs from "node:fs/promises";
import {constants as flags} from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {validateWorkspaceRelative} from "../core/workspace-path.js";
import {WorkspaceRegistry} from "../core/workspace.js";

/** Candidate only: NOT a verified NativeScopedFiles capability.
 * Node pathname APIs cannot atomically anchor every ancestor against rename races.
 * Do not inject this into live MCP mutation dispatch.
 */
export class NativeFileCandidate {
 constructor(private readonly registry:WorkspaceRegistry){}
 private async existingParent(id:string,relative:string):Promise<{dir:string;base:string}>{
  validateWorkspaceRelative(relative);
  const grant=this.registry.requireGrant(id,"read");
  const normalized=relative.split("/");
  const base=normalized.pop()!;
  const dir=normalized.length?await this.registry.resolveExistingRead(id,normalized.join("/")):grant.canonicalRoot;
  if(!(await fs.stat(dir)).isDirectory())throw Error("NOT_A_DIRECTORY");
  return {dir,base};
 }
 async readCandidate(id:string,relative:string,maxBytes=65536):Promise<{bytes:Uint8Array;sha256:string}>{
  const {dir,base}=await this.existingParent(id,relative);
  const file=path.join(dir,base);
  if((await fs.lstat(file)).isSymbolicLink())throw Error("SYMLINK_DENIED");
  const fd=await fs.open(file,flags.O_RDONLY|(flags.O_NOFOLLOW??0));
  try{
   const st=await fd.stat();
   if(!st.isFile()||st.size>maxBytes||st.size<0)throw Error("READ_LIMIT_EXCEEDED");
   const bytes=await fd.readFile();
   if(bytes.length>maxBytes)throw Error("READ_LIMIT_EXCEEDED");
   return {bytes,sha256:createHash("sha256").update(bytes).digest("hex")};
  }finally{await fd.close();}
 }
 async createExclusiveCandidate(id:string,relative:string,bytes:Uint8Array):Promise<void>{
  this.registry.requireGrant(id,"write");
  const {dir,base}=await this.existingParent(id,relative);
  if(bytes.byteLength>8*1024*1024)throw Error("WRITE_LIMIT_EXCEEDED");
  const fd=await fs.open(path.join(dir,base),flags.O_WRONLY|flags.O_CREAT|flags.O_EXCL|(flags.O_NOFOLLOW??0),0o600);
  try{await fd.writeFile(bytes);}finally{await fd.close();}
 }
}
