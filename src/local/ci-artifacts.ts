import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {identityDirectory} from "./identity.js";
export class ArtifactError extends Error {constructor(public readonly code:"INVALID_ARTIFACT"|"ARTIFACT_NOT_FOUND"|"ARTIFACT_HASH_MISMATCH",message:string){super(message);}}
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
export interface ArtifactMetadata {name:string;sha256:string;bytes:number}
export class CiArtifactStore {
 constructor(private readonly root=path.join(identityDirectory(),"ci-artifacts")){}
 private location(runId:string,name:string):string{
  if(!ID.test(runId)||!NAME.test(name)||name==="."||name==="..")throw new ArtifactError("INVALID_ARTIFACT","Invalid run ID or artifact name");
  return path.join(this.root,runId,name);
 }
 async ingest(runId:string,name:string,bytes:Uint8Array):Promise<ArtifactMetadata>{
  if(bytes.length>8*1024*1024)throw new ArtifactError("INVALID_ARTIFACT","Artifact exceeds size limit");
  const file=this.location(runId,name);
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  await fs.writeFile(file,bytes,{flag:"wx",mode:0o600});
  return {name,sha256:sha(bytes),bytes:bytes.length};
 }
 async read(runId:string,name:string):Promise<{metadata:ArtifactMetadata;bytes:Uint8Array}>{
  const file=this.location(runId,name);
  let bytes:Buffer;
  try{const stat=await fs.stat(file);if(!stat.isFile()||stat.size>8*1024*1024)throw new ArtifactError("INVALID_ARTIFACT","Artifact size/type invalid");bytes=await fs.readFile(file);}
  catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")throw new ArtifactError("ARTIFACT_NOT_FOUND","Artifact unavailable");throw e;}
  return {metadata:{name,sha256:sha(bytes),bytes:bytes.length},bytes};
 }
 async list(runId:string):Promise<ArtifactMetadata[]>{
  this.location(runId,"index");
  let names:string[];
  try{names=await fs.readdir(path.join(this.root,runId));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return [];throw e;}
  const records:ArtifactMetadata[]=[];
  for(const name of names.filter(x=>NAME.test(x)).slice(0,100)){
   const r=await this.read(runId,name);records.push(r.metadata);
  }
  return records;
 }
}
