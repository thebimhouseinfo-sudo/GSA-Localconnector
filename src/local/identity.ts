import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {randomBytes} from "node:crypto";

export function identityDirectory(platform:NodeJS.Platform=process.platform,home=os.homedir()):string {
 if(platform==="win32") return path.join(process.env.LOCALAPPDATA || path.join(home,"AppData","Local"),"GSA-Localconnector");
 if(platform==="darwin") return path.join(home,"Library","Application Support","GSA-Localconnector");
 throw Error("UNSUPPORTED_PLATFORM");
}
export function tokenFile(dir=identityDirectory()):string {return path.join(dir,"mcp-token");}
export async function initializeToken(dir=identityDirectory()):Promise<{path:string;created:boolean}> {
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const dest=tokenFile(dir);
 try {
  const existing=(await fs.readFile(dest,"utf8")).trim();
  if(existing.length<32) throw Error("Existing token invalid; refusing overwrite");
  return {path:dest,created:false};
 } catch(error) {
  if((error as NodeJS.ErrnoException).code!=="ENOENT") throw error;
 }
 const secret=randomBytes(48).toString("base64url")+"\n";
 try {
  const handle=await fs.open(dest,"wx",0o600);
  try {await handle.writeFile(secret,"utf8");}finally {await handle.close();}
  return {path:dest,created:true};
 } catch(error) {
  if((error as NodeJS.ErrnoException).code==="EEXIST") return initializeToken(dir);
  throw error;
 }
}
export async function loadToken(dir=identityDirectory()):Promise<string> {
 const token=(await fs.readFile(tokenFile(dir),"utf8")).trim();
 if(token.length<32)throw Error("Invalid MCP token file");
 return token;
}
