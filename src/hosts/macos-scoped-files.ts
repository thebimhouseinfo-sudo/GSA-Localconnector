import fs from "node:fs/promises";
import {constants} from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import type {NativeScopedFiles,ScopedFileRef} from "../core/native-io.js";
import type {WorkspaceRegistry} from "../core/workspace.js";
import {validateWorkspaceRelative} from "../core/workspace-path.js";
import {identityDirectory} from "../local/identity.js";

const MAX=8*1024*1024;
const sha=(data:Uint8Array|string)=>createHash("sha256").update(data).digest("hex");
function blocked(message:string):never {throw Object.assign(Error(message),{code:"SECURITY_BLOCKED"});}
async function protectedRead(file:string,max:number):Promise<Buffer>{
 const before=await fs.lstat(file);
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||![0,process.getuid?.()].includes(before.uid)||(before.mode&0o077)!==0||before.size>max)blocked("Unsafe scoped file installation");
 const fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const opened=await fd.stat();if(opened.dev!==before.dev||opened.ino!==before.ino)blocked("Installation changed");const bytes=Buffer.alloc(before.size+1);let pos=0;while(pos<bytes.length){const r=await fd.read(bytes,pos,bytes.length-pos,pos);if(!r.bytesRead)break;pos+=r.bytesRead;}const after=await fd.stat();if(pos!==before.size||after.ctimeMs!==before.ctimeMs||after.mtimeMs!==before.mtimeMs)blocked("Installation changed");return bytes.subarray(0,pos);}finally{await fd.close();}
}
async function protectedDirectory(dir:string){const st=await fs.lstat(dir);if(!st.isDirectory()||st.isSymbolicLink()||![0,process.getuid?.()].includes(st.uid)||(st.mode&0o777)!==0o700||await fs.realpath(dir)!==dir)blocked("Unsafe scoped files directory");}
async function command(executable:string,args:string[],input:string,max:number,ownerLockFD?:3):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{shell:false,env:{PATH:"/usr/bin:/bin",HOME:"/var/empty",LANG:"C",TMPDIR:"/private/tmp"},stdio:ownerLockFD===undefined?["pipe","pipe","pipe"]:["pipe","pipe","pipe",ownerLockFD]});
  const {stdin,stdout,stderr}=child;
  if(!stdin||!stdout||!stderr){child.kill("SIGKILL");reject(Error("MUTATION_OUTCOME_UNKNOWN: helper pipes unavailable"));return;}
  let output=Buffer.alloc(0),diagnostics=0,error:Error|undefined;const abort=(reason:string)=>{error=Error(reason);child.kill("SIGKILL");};const timer=setTimeout(()=>abort("MUTATION_OUTCOME_UNKNOWN: helper timeout"),15000);
  stdout.on("data",(b:Buffer)=>{if(output.length+b.length>max)abort("MUTATION_OUTCOME_UNKNOWN: output limit");else output=Buffer.concat([output,b]);});stderr.on("data",(b:Buffer)=>{diagnostics+=b.length;if(diagnostics>65536)abort("Helper diagnostics limit");});child.on("error",e=>{error=e;});stdin.on("error",()=>{});child.on("close",code=>{clearTimeout(timer);if(error||code!==0)reject(error??Error("MUTATION_OUTCOME_UNKNOWN: helper failed"));else resolve(output);});stdin.end(input);
 });
}
type Bound={id:string;root:string;rootIdentity:{device:string;inode:string};revision:number;artifacts:Record<string,string>};
export interface MacScopedFilesOptions {ownerLockFD?:3;authorize?:(workspaceId:string)=>Promise<void>}
/** Fixed-operation host I/O only. App Sandbox never authorizes a host shell.
 * Compare-and-mutate operations fail closed: APFS provides no content CAS primitive.
 */
export async function loadMacScopedFiles(registry:WorkspaceRegistry,installationRoot=path.join(identityDirectory(),"scoped-files"),options:MacScopedFilesOptions={}):Promise<NativeScopedFiles>{
 if(process.platform!=="darwin")blocked("macOS scoped files unavailable on this platform");
 await protectedDirectory(installationRoot);
 const key=await protectedRead(path.join(installationRoot,"proof-key"),32);if(key.length!==32)blocked("Invalid scoped file proof key");
 const envelope=JSON.parse((await protectedRead(path.join(installationRoot,"install.json"),1024*1024)).toString());
 if(typeof envelope.body!=="string"||typeof envelope.hmac!=="string"||!/^[a-f0-9]{64}$/.test(envelope.hmac)||!timingSafeEqual(createHmac("sha256",key).update(envelope.body).digest(),Buffer.from(envelope.hmac,"hex")))blocked("Invalid scoped file proof");
 const proof=JSON.parse(envelope.body);
 if(proof.format!=="gsa-scoped-files-v1"||proof.hostRelease!==os.release()||proof.arch!==process.arch||!Array.isArray(proof.grants)||!Array.isArray(proof.checks)||!["native-read","create-exclusive","mkdir","copy-exclusive","symlink-denied","hardlink-denied","traversal-denied","read-cap","hash-conflict","root-identity","ancestor-relocation"].every(c=>proof.checks.includes(c)))blocked("Invalid scoped file binding");
 const bindings=new Map<string,Bound>();
 for(const b of proof.grants as Bound[]){if(!b||typeof b.id!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(b.id)||bindings.has(b.id)||!b.artifacts||typeof b.root!=="string"||!b.rootIdentity||!Number.isSafeInteger(b.revision))blocked("Invalid grant binding");bindings.set(b.id,b);}
 async function invoke(ref:ScopedFileRef,operation:string,extra:Record<string,unknown>={},destination?:ScopedFileRef){
  validateWorkspaceRelative(ref.path);const grant=registry.requireGrant(ref.workspace_id,operation==="read"?"read":"write");registry.requireGrant(ref.workspace_id,"read");
  if(destination&&(destination.workspace_id!==ref.workspace_id))blocked("Cross-root operation denied");if(destination)validateWorkspaceRelative(destination.path);
  await options.authorize?.(ref.workspace_id);
  const bound=bindings.get(grant.id);
  if(!bound||bound.root!==grant.canonicalRoot||bound.revision!==grant.revision||bound.rootIdentity.device!==grant.rootIdentity.device||bound.rootIdentity.inode!==grant.rootIdentity.inode)blocked("Scoped file grant changed; reinstall required");
  const dir=path.join(installationRoot,grant.id);await protectedDirectory(dir);
  const app=path.join(dir,"Broker.app"),binary=path.join(app,"Contents/MacOS/broker");
  for(const directory of [app,path.join(app,"Contents"),path.join(app,"Contents/MacOS"),path.join(app,"Contents/_CodeSignature")])await protectedDirectory(directory);
  const expected=["Contents/MacOS/broker","Contents/Info.plist","Contents/_CodeSignature/CodeResources"];
  if(Object.keys(bound.artifacts).length!==expected.length)blocked("Invalid broker manifest");
  for(const relative of expected){const digest=bound.artifacts[relative];if(typeof digest!=="string"||!/^[a-f0-9]{64}$/.test(digest)||sha(await protectedRead(path.join(app,relative),16*1024*1024))!==digest)blocked("Broker changed");}
  await command("/usr/bin/codesign",["--verify","--strict",app],"",65536);
  const result=JSON.parse((await command(binary,[],JSON.stringify({operation,root:grant.canonicalRoot,device:grant.rootIdentity.device,inode:grant.rootIdentity.inode,revision:grant.revision,path:ref.path,...extra,...(destination?{destination:destination.path}:{})}),12*1024*1024,options.ownerLockFD)).toString());
  if(result.ok!==true){const code=typeof result.error==="string"?result.error:"MUTATION_OUTCOME_UNKNOWN";throw Object.assign(Error(code),{code:code.startsWith("SECURITY_BLOCKED")?"SECURITY_BLOCKED":code});}
  return result;
 }
 const bytes=(data:Uint8Array)=>{if(data.byteLength>MAX)throw Error("WRITE_LIMIT_EXCEEDED");return Buffer.from(data).toString("base64");};
 const expected=(hash:string)=>{if(!/^[a-f0-9]{64}$/.test(hash))throw Error("INVALID_SHA256");return hash;};
 return {
  async read(ref,maxBytes){if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>MAX)throw Error("READ_LIMIT_EXCEEDED");const r=await invoke(ref,"read",{maxBytes});const data=Buffer.from(r.base64,"base64");if(data.length>maxBytes||sha(data)!==r.sha256)blocked("Invalid broker read receipt");return {bytes:data,sha256:r.sha256,kind:"file"};},
  async createExclusive(ref,data){await invoke(ref,"create",{base64:bytes(data)});},
  async replaceIfHash(ref,data,hash){await invoke(ref,"replace",{base64:bytes(data),expectedSha256:expected(hash)});},
  async makeDirectory(ref){await invoke(ref,"mkdir");},
  async copyExclusive(source,dest,hash){await invoke(source,"copy",{expectedSha256:expected(hash)},dest);},
  async moveExclusive(source,dest,hash){await invoke(source,"move",{expectedSha256:expected(hash)},dest);},
  async trashIfHash(ref,hash){await invoke(ref,"trash",{expectedSha256:expected(hash)});}
 };
}
