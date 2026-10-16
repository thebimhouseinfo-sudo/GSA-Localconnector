import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {validateWorkspaceRelative} from "../core/workspace-path.js";
import {CiSnapshotStore} from "./ci-snapshot-store.js";

export class CiWorkingCopyError extends Error {
 constructor(public readonly code:"INVALID_ROOT"|"WORKING_COPY_EXISTS"|"SOURCE_CHANGED",message:string){super(message);}
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function isSubdir(parent:string,child:string):boolean{
 const r=path.relative(parent,child);
 return r===""||(!r.startsWith(".."+path.sep)&&r!==".."&&!path.isAbsolute(r));
}
/** Builds an independent writable tree from a hash-verified host-owned source
 * reference. The trusted supervisor must enforce that sandbox processes can
 * access workingDir but NEVER snapshotRoot; this is NOT OS sandbox proof.
 */
export class CiWorkingCopyStore{
 constructor(private readonly snapshotRoot:string,private readonly workingRoot:string){
  if(!path.isAbsolute(snapshotRoot)||!path.isAbsolute(workingRoot)||
     isSubdir(snapshotRoot,workingRoot)||isSubdir(workingRoot,snapshotRoot))
   throw new CiWorkingCopyError("INVALID_ROOT","Snapshot and working tree roots must be disjoint");
 }
 async create(runId:string):Promise<{run_id:string;working_dir:string;source_sha256:string;verified:false}>{
  if(!UUID.test(runId))throw new CiWorkingCopyError("INVALID_ROOT","Invalid CI run identity");
  const snapshot=new CiSnapshotStore(this.snapshotRoot);
  const manifest=await snapshot.verify(runId);
  await fs.mkdir(this.workingRoot,{recursive:true,mode:0o700});
  const target=path.join(this.workingRoot,runId);
  try{await fs.mkdir(target,{mode:0o700});}
  catch(e){if((e as NodeJS.ErrnoException).code==="EEXIST")throw new CiWorkingCopyError("WORKING_COPY_EXISTS","Working tree already exists");throw e;}
  try{
   for(const file of manifest.files){
    validateWorkspaceRelative(file.path);
    const src=path.join(this.snapshotRoot,runId,"files",...file.path.split("/"));
    const bytes=await fs.readFile(src);
    if(bytes.length!==file.size||createHash("sha256").update(bytes).digest("hex")!==file.sha256)
     throw new CiWorkingCopyError("SOURCE_CHANGED","Immutable reference changed after verification");
    const dest=path.join(target,...file.path.split("/"));
    await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
    await fs.writeFile(dest,bytes,{flag:"wx",mode:0o600});
   }
   return {run_id:runId,working_dir:target,source_sha256:manifest.source_sha256,verified:false};
  }catch(e){await fs.rm(target,{recursive:true,force:true});throw e;}
 }
}
