import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import fs from "node:fs/promises";
import {identityDirectory} from "./identity.js";

export interface MacOwner {session:string;identityRoot:string;lockFD:3}
const launcher=fileURLToPath(new URL("../../../scripts/macos-owner-launcher.py",import.meta.url));
/** Only the trusted supervisor and fixed-operation helpers receive this FD.
 * It must never be inherited by an untrusted host command.
 */
export async function withMacOwner(entry:string,operation:(owner?:MacOwner)=>Promise<void>):Promise<void>{
 if(process.platform!=="darwin")return operation();
 if(process.env.GSA_OWNER_LOCK_FD!==undefined){
  const owner=await verifyMacOwner();return operation(owner);
 }
 const requested=identityDirectory();await fs.mkdir(requested,{recursive:true,mode:0o700});
 if((await fs.lstat(requested)).isSymbolicLink())throw Error("SERVER_OWNER_UNSAFE_DIRECTORY");
 const canonical=await fs.realpath(requested);
 await new Promise<void>((resolve,reject)=>{
  const child=spawn("/usr/bin/python3",[launcher,"--identity",canonical,"--node",process.execPath,"--entry",entry],{stdio:"inherit",env:process.env});
  const forward=(signal:NodeJS.Signals)=>child.kill(signal);
  const term=()=>forward("SIGTERM"),interrupt=()=>forward("SIGINT");
  process.on("SIGTERM",term);process.on("SIGINT",interrupt);
  child.on("error",reject);
  child.on("close",(code,signal)=>{process.off("SIGTERM",term);process.off("SIGINT",interrupt);process.exitCode=code??(signal?1:0);resolve();});
 });
}
export async function verifyMacOwner(identityRoot=identityDirectory(),helper=launcher):Promise<MacOwner>{
 identityRoot=await fs.realpath(identityRoot);
 if(process.env.GSA_OWNER_LOCK_FD!=="3"||process.env.GSA_OWNER_IDENTITY!==identityRoot)throw Error("SERVER_OWNER_REQUIRED");
 return new Promise((resolve,reject)=>{
  const proc=spawn("/usr/bin/python3",[helper,"--identity",identityRoot,"--verify"],{stdio:["ignore","pipe","pipe",3],env:process.env});
  let output="",bytes=0,error:Error|undefined;
  const timer=setTimeout(()=>{error=Error("SERVER_OWNER_TIMEOUT");proc.kill("SIGKILL");},5000);
  proc.stdout!.on("data",data=>{bytes+=data.length;if(bytes>4096){error=Error("SERVER_OWNER_INVALID");proc.kill("SIGKILL");}else output+=data;});
  proc.stderr!.on("data",()=>{});proc.on("error",value=>{error=value;});
  proc.on("close",code=>{clearTimeout(timer);if(error||code!==0)return reject(error??Error("SERVER_OWNER_INVALID"));
   try{const value=JSON.parse(output);if(value.format!=="gsa-owner-v1"||value.session!==process.env.GSA_OWNER_SESSION||!/^[a-f0-9-]{36}$/.test(value.session))throw Error("SERVER_OWNER_INVALID");resolve({session:value.session,identityRoot,lockFD:3});}catch(e){reject(e);}
  });
 });
}
