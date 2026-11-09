import fs from "node:fs/promises";
import {constants} from "node:fs";
import path from "node:path";
import {identityDirectory} from "./identity.js";

/** Local desktop Pause only stops admission of NEW tool effects.
 * In-flight commands and recovery journals remain untouched. */
export async function isDesktopPaused(identityRoot?:string):Promise<boolean>{
 if(process.platform!=="darwin")return false;
 const file=path.join(identityRoot??identityDirectory(),"desktop","pause-state.json");
 let stat;
 try{stat=await fs.lstat(file,{bigint:true});}
 catch(error){
  if((error as NodeJS.ErrnoException).code==="ENOENT")return false;
  throw Error("DESKTOP_PAUSE_STATE_UNTRUSTED");
 }
 const uid=process.getuid?.();
 if(uid===undefined||!stat.isFile()||stat.isSymbolicLink()||
  stat.uid!==BigInt(uid)||stat.nlink!==1n||(stat.mode&0o777n)!==0o600n||
  stat.size<1n||stat.size>512n)throw Error("DESKTOP_PAUSE_STATE_UNTRUSTED");
 const fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const opened=await fd.stat({bigint:true});
  if(opened.dev!==stat.dev||opened.ino!==stat.ino)throw Error("DESKTOP_PAUSE_STATE_UNTRUSTED");
  const bytes=await fd.readFile();
  const after=await fd.stat({bigint:true});
  if(bytes.byteLength!==Number(stat.size)||after.ctimeNs!==stat.ctimeNs||
   after.mtimeNs!==stat.mtimeNs||after.ino!==stat.ino)throw Error("DESKTOP_PAUSE_STATE_UNTRUSTED");
  let value:unknown;
  try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw Error("DESKTOP_PAUSE_STATE_UNTRUSTED");}
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("DESKTOP_PAUSE_STATE_UNTRUSTED");
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==2||v.format!=="gsa-desktop-pause-v1"||typeof v.paused!=="boolean")
   throw Error("DESKTOP_PAUSE_STATE_UNTRUSTED");
  return v.paused;
 }finally{await fd.close();}
}
