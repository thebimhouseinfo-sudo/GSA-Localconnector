import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {identityDirectory} from "./identity.js";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export class CiLogError extends Error{constructor(public readonly code:"INVALID_RUN_ID"|"LOG_LIMIT_EXCEEDED",message:string){super(message);}}
export interface CiLogChunk{sequence:number;stream:"stdout"|"stderr";text:string;sha256:string}
export class CiLogStore{
 constructor(private readonly root=path.join(identityDirectory(),"ci-logs")){}
 private directory(runId:string):string{if(!UUID.test(runId))throw new CiLogError("INVALID_RUN_ID","Invalid CI run identity");return path.join(this.root,runId);}
 async append(runId:string,sequence:number,stream:"stdout"|"stderr",text:string):Promise<CiLogChunk>{
  if(!Number.isSafeInteger(sequence)||sequence<1||sequence>10000||!["stdout","stderr"].includes(stream)||Buffer.byteLength(text)>65536)throw new CiLogError("LOG_LIMIT_EXCEEDED","Invalid log chunk");
  const folder=this.directory(runId);await fs.mkdir(folder,{recursive:true,mode:0o700});
  const chunk={sequence,stream,text,sha256:createHash("sha256").update(text).digest("hex")};
  await fs.writeFile(path.join(folder,String(sequence).padStart(8,"0")+".json"),JSON.stringify(chunk)+"\n",{flag:"wx",mode:0o600});
  return chunk;
 }
 async page(runId:string,cursor=0,limit=50):Promise<{entries:CiLogChunk[];next_cursor:number|null}>{
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new CiLogError("LOG_LIMIT_EXCEEDED","Invalid log cursor");
  const folder=this.directory(runId);let files:string[];
  try{files=(await fs.readdir(folder)).filter(x=>/^\d{8}\.json$/.test(x)).sort();}
  catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {entries:[],next_cursor:null};throw e;}
  const entries=[];
  for(const file of files.slice(cursor,cursor+limit)){
   const entry=JSON.parse(await fs.readFile(path.join(folder,file),"utf8")) as CiLogChunk;
   if(entry.sha256!==createHash("sha256").update(entry.text).digest("hex"))throw new CiLogError("LOG_LIMIT_EXCEEDED","Corrupt log content");
   entries.push(entry);
  }
  return {entries,next_cursor:cursor+entries.length<files.length?cursor+entries.length:null};
 }
}
