import fs from "node:fs/promises";
import {constants} from "node:fs";
import path from "node:path";
import {identityDirectory} from "./identity.js";

export type PauseReason="UID_UNAVAILABLE"|"NOT_PRIVATE"|"LINK_COUNT"|"CHANGED_DURING_READ"|"INVALID_CONTENT"|"STAT_FAILED";
export class DesktopPauseUntrusted extends Error {
 readonly code="DESKTOP_PAUSE_STATE_UNTRUSTED";
 constructor(readonly reason:PauseReason){super("DESKTOP_PAUSE_STATE_UNTRUSTED");}
}
export type PauseFileReading={exists:false;paused:false}|{exists:true;paused:boolean};

async function readOnce(file:string):Promise<PauseFileReading>{
 let stat;
 try{stat=await fs.lstat(file,{bigint:true});}
 catch(error){
  if((error as NodeJS.ErrnoException).code==="ENOENT")return {exists:false,paused:false};
  throw new DesktopPauseUntrusted("STAT_FAILED");
 }
 const uid=process.getuid?.();
 if(uid===undefined)throw new DesktopPauseUntrusted("UID_UNAVAILABLE");
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==BigInt(uid)||
  (stat.mode&0o777n)!==0o600n||stat.size<1n||stat.size>512n)throw new DesktopPauseUntrusted("NOT_PRIVATE");
 if(stat.nlink!==1n)throw new DesktopPauseUntrusted("LINK_COUNT");
 let fd;
 try{fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
 catch(error){throw new DesktopPauseUntrusted((error as NodeJS.ErrnoException).code==="ENOENT"?"CHANGED_DURING_READ":"NOT_PRIVATE");}
 try{
  const opened=await fd.stat({bigint:true});
  const changed=(s:typeof stat)=>s.dev!==stat.dev||s.ino!==stat.ino||s.ctimeNs!==stat.ctimeNs||s.mtimeNs!==stat.mtimeNs||s.size!==stat.size;
  if(changed(opened))throw new DesktopPauseUntrusted("CHANGED_DURING_READ");
  const bytes=await fd.readFile();
  const after=await fd.stat({bigint:true});
  if(changed(after)||bytes.byteLength!==Number(stat.size))throw new DesktopPauseUntrusted("CHANGED_DURING_READ");
  let value:unknown;
  try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw new DesktopPauseUntrusted("INVALID_CONTENT");}
  if(!value||typeof value!=="object"||Array.isArray(value))throw new DesktopPauseUntrusted("INVALID_CONTENT");
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==2||v.format!=="gsa-desktop-pause-v1"||typeof v.paused!=="boolean")throw new DesktopPauseUntrusted("INVALID_CONTENT");
  return {exists:true,paused:v.paused};
 }finally{await fd.close();}
}

export async function readDesktopPauseFile(file:string,opts:{attempts?:number;delayMs?:number}={}):Promise<PauseFileReading>{
 if(process.platform!=="darwin")return {exists:false,paused:false};
 const attempts=opts.attempts??3,delay=opts.delayMs??20;
 for(let attempt=1;;attempt++){
  try{return await readOnce(file);}
  catch(error){
   if(!(error instanceof DesktopPauseUntrusted)||!["LINK_COUNT","CHANGED_DURING_READ"].includes(error.reason)||attempt>=attempts)throw error;
   await new Promise(resolve=>setTimeout(resolve,delay));
  }
 }
}
export async function isDesktopPaused(identityRoot?:string):Promise<boolean>{
 if(process.platform!=="darwin")return false;
 return (await readDesktopPauseFile(path.join(identityRoot??identityDirectory(),"desktop","pause-state.json"))).paused;
}
