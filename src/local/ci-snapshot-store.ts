import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {identityDirectory} from "./identity.js";
import {createSnapshotManifest} from "../core/ci-snapshot.js";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class SnapshotStoreError extends Error{
 constructor(public readonly code:"INVALID_RUN_ID"|"SNAPSHOT_EXISTS"|"SNAPSHOT_INTEGRITY",message:string){super(message);}
}
/** Trusted-supervisor storage only. The child process must NEVER receive this root.
 * This module takes already verified bytes; it does not authorize host Workspace reads.
 */
export class CiSnapshotStore{
 constructor(private readonly root=path.join(identityDirectory(),"ci-snapshots")){}
 async persist(runId:string,entries:readonly {path:string;bytes:Uint8Array}[]){
  if(!UUID.test(runId))throw new SnapshotStoreError("INVALID_RUN_ID","Invalid CI run ID");
  const manifest=createSnapshotManifest(entries);
  await fs.mkdir(this.root,{recursive:true,mode:0o700});
  const destination=path.join(this.root,runId);
  try{await fs.mkdir(destination,{mode:0o700});}
  catch(e){if((e as NodeJS.ErrnoException).code==="EEXIST")throw new SnapshotStoreError("SNAPSHOT_EXISTS","Snapshot already recorded");throw e;}
  try{
   for(const file of manifest.files){
    const full=path.join(destination,"files",...file.path.split("/"));
    await fs.mkdir(path.dirname(full),{recursive:true,mode:0o700});
    const source=entries.find(x=>x.path===file.path)!;
    await fs.writeFile(full,source.bytes,{flag:"wx",mode:0o400});
   }
   await fs.writeFile(path.join(destination,"manifest.json"),JSON.stringify(manifest)+"\n",{flag:"wx",mode:0o400});
  }catch(e){await fs.rm(destination,{recursive:true,force:true});throw e;}
  return manifest;
 }
 async verify(runId:string){
  if(!UUID.test(runId))throw new SnapshotStoreError("INVALID_RUN_ID","Invalid CI run ID");
  const destination=path.join(this.root,runId);
  const manifest=JSON.parse(await fs.readFile(path.join(destination,"manifest.json"),"utf8")) as ReturnType<typeof createSnapshotManifest>;
  const observed=[];
  for(const file of manifest.files){
   const relative=file.path;
   if(!relative||relative.includes("..")||relative.startsWith("/")||relative.includes("\\"))throw new SnapshotStoreError("SNAPSHOT_INTEGRITY","Invalid stored path");
   const b=await fs.readFile(path.join(destination,"files",...relative.split("/")));
   if(b.length!==file.size||createHash("sha256").update(b).digest("hex")!==file.sha256)throw new SnapshotStoreError("SNAPSHOT_INTEGRITY","Snapshot contents changed");
   observed.push({path:relative,bytes:b});
  }
  const computed=createSnapshotManifest(observed);
  if(computed.source_sha256!==manifest.source_sha256||computed.total_bytes!==manifest.total_bytes)throw new SnapshotStoreError("SNAPSHOT_INTEGRITY","Source fingerprint changed");
  return computed;
 }
}
