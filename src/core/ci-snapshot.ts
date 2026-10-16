import {createHash} from "node:crypto";
import {validateWorkspaceRelative} from "./workspace-path.js";
export class SnapshotError extends Error{
 constructor(public readonly code:"INVALID_SNAPSHOT"|"SNAPSHOT_QUOTA"|"SNAPSHOT_DUPLICATE",message:string){super(message);}
}
export type SnapshotEntry={readonly path:string;readonly bytes:Uint8Array;readonly sha256:string};
export type SnapshotManifest={readonly source_sha256:string;readonly files:readonly {path:string;sha256:string;size:number}[];readonly total_bytes:number};
/** Pure source snapshot planner. The host must write this into a protected directory
 * that is NOT mounted into the execution process; it must provide a separate copy.
 */
export function createSnapshotManifest(entries:readonly {path:string;bytes:Uint8Array}[],maxFiles=5000,maxBytes=64*1024*1024):SnapshotManifest{
 if(!entries.length||entries.length>maxFiles)throw new SnapshotError("SNAPSHOT_QUOTA","Invalid file count");
 const seen=new Set<string>();let total=0;
 const files=entries.map(entry=>{
  validateWorkspaceRelative(entry.path);
  if(seen.has(entry.path))throw new SnapshotError("SNAPSHOT_DUPLICATE","Duplicate source path");
  seen.add(entry.path);
  if(!(entry.bytes instanceof Uint8Array))throw new SnapshotError("INVALID_SNAPSHOT","Invalid file bytes");
  total+=entry.bytes.length;
  if(total>maxBytes)throw new SnapshotError("SNAPSHOT_QUOTA","Source exceeds quota");
  return {path:entry.path,sha256:createHash("sha256").update(entry.bytes).digest("hex"),size:entry.bytes.length};
 }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const digest=createHash("sha256").update(JSON.stringify(files)).digest("hex");
 return {files,total_bytes:total,source_sha256:digest};
}
