import fs from "node:fs/promises";
import {normalizedStrippedMacFileCode} from "./macos-file-code.js";
import {requireMacFileBuild,requireMacFileEvidence} from "./macos-file-evidence.js";
import {constants} from "node:fs";
import path from "node:path";
import os from "node:os";
import {isDeepStrictEqual} from "node:util";
import {spawn} from "node:child_process";
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import type {NativeScopedFiles,ScopedFileRef} from "../core/native-io.js";
import type {WorkspaceRegistry} from "../core/workspace.js";
import type {WorkspaceGrant,WorkspacePermission} from "../core/contracts.js";
import {validateWorkspaceRelative} from "../core/workspace-path.js";
import {identityDirectory} from "../local/identity.js";
import {MAC_FILE_RECOVERY_ACTIVATION_BLOCKED} from "./macos-file-recovery.js";
import {loadCheckedMacRecoveryInstallation} from "./macos-recovery-installation.js";
import type {NativeRecoverableFileMutations,NativeFileOperation} from "../core/native-io.js";

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
/** Physical two-way separation from every currently selected project root. */
export async function assertMacFileInstallationSeparated(registry:WorkspaceRegistry,installationRoot:string):Promise<readonly WorkspaceGrant[]>{
 const selected=registry.list();
 async function ancestry(root:string,privateRoot=false){
  if(!path.isAbsolute(root)||path.normalize(root)!==root||root==="/"||root.includes("\0")||root.length>4096||await fs.realpath(root)!==root)blocked("Unsafe scoped file installation ancestry");
  const uid=process.getuid?.();if(uid===undefined)blocked("Unsafe scoped file installation owner");
  const dirs:string[]=[];for(let p=root;;p=path.dirname(p)){dirs.unshift(p);if(p===path.dirname(p))break;}
  const chain:Array<{device:string;inode:string}>=[];
  for(const dir of dirs){const st=await fs.lstat(dir,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink())blocked("Unsafe scoped file installation ancestry");
   if(privateRoot&&(![0n,BigInt(uid)].includes(st.uid)||((st.mode&0o022n)!==0n&&!(st.uid===0n&&(st.mode&0o1000n)!==0n))))blocked("Unsafe scoped file installation ancestry");
   if(privateRoot&&dir===root&&(st.uid!==BigInt(uid)||(st.mode&0o777n)!==0o700n))blocked("Unsafe scoped file installation directory");
   chain.push({device:String(st.dev),inode:String(st.ino)});
  }
  return chain;
 }
 const installation=await ancestry(installationRoot,true),protectedRoot=installation.at(-1)!;
 for(const grant of selected){const chain=await ancestry(grant.canonicalRoot),root=chain.at(-1)!;
  if(!isDeepStrictEqual(root,grant.rootIdentity))blocked("Scoped file root changed");
  if(chain.some(value=>isDeepStrictEqual(value,protectedRoot))||installation.some(value=>isDeepStrictEqual(value,root)))blocked("Scoped file installation overlaps a selected project root");
 }
 if(!isDeepStrictEqual(registry.list(),selected))blocked("Scoped file roots changed during installation check");
 return selected;
}
async function command(executable:string,args:string[],input:string,max:number,ownerLockFD?:3):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{shell:false,env:{PATH:"/usr/bin:/bin",HOME:"/var/empty",LANG:"C",TMPDIR:"/private/tmp"},stdio:ownerLockFD===undefined?["pipe","pipe","pipe"]:["pipe","pipe","pipe",ownerLockFD]});
  const {stdin,stdout,stderr}=child;
  if(!stdin||!stdout||!stderr){child.kill("SIGKILL");reject(Error("MUTATION_OUTCOME_UNKNOWN: helper pipes unavailable"));return;}
  let output=Buffer.alloc(0),diagnostics=0,error:Error|undefined;const abort=(reason:string)=>{error=Error(reason);child.kill("SIGKILL");};const timer=setTimeout(()=>abort("MUTATION_OUTCOME_UNKNOWN: helper timeout"),15000);
  stdout.on("data",(b:Buffer)=>{if(output.length+b.length>max)abort("MUTATION_OUTCOME_UNKNOWN: output limit");else output=Buffer.concat([output,b]);});stderr.on("data",(b:Buffer)=>{diagnostics+=b.length;if(diagnostics>65536)abort("Helper diagnostics limit");});child.on("error",e=>{error=e;});stdin.on("error",()=>{});child.on("close",code=>{clearTimeout(timer);if(error||code!==0)reject(error??Error("MUTATION_OUTCOME_UNKNOWN: helper failed"));else resolve(output);});stdin.end(input);
 });
}
type Bound={id:string;root:string;rootIdentity:{device:string;inode:string};revision:number;role:"workspace"|"reference";artifacts:Record<string,string>;presign_sha256:string;code_sha256:string};
export interface MacScopedFilesOptions {ownerLockFD?:3;authorize?:(workspaceId:string,permission:WorkspacePermission)=>Promise<void>}
/** Keep one loader/activation boundary. Recovery cannot be enabled by editing a
 * manifest/check-name list: native evidence and reviewed installation are missing.
 * A later accepted installation must supply per-root Recovery Broker.app,
 * workspace/recovery identity+revision+artifact/entitlement checks and its private
 * journal before this hook may construct createMacFileRecovery. */
export function macFileRecoveryActivation():Readonly<{available:boolean;reason:string}>{
 return Object.freeze({available:false,reason:MAC_FILE_RECOVERY_ACTIVATION_BLOCKED});
}
/** Fixed-operation host I/O only. App Sandbox never authorizes a host shell.
 * Compare-and-mutate operations fail closed: APFS provides no content CAS primitive.
 */
export async function loadMacScopedFiles(registry:WorkspaceRegistry,installationRoot=path.join(identityDirectory(),"scoped-files"),options:MacScopedFilesOptions={}):Promise<NativeScopedFiles>{
 return constructMacScopedFiles(registry,installationRoot,options);
}
// Candidate construction is unexported. Native fixtures expose only a temporary
// module copy; runtime callers always require completed evidence.
async function constructMacScopedFiles(registry:WorkspaceRegistry,installationRoot:string,options:MacScopedFilesOptions={},candidate=false):Promise<NativeScopedFiles>{
 if(process.platform!=="darwin")blocked("macOS scoped files unavailable on this platform");
 await assertMacFileInstallationSeparated(registry,installationRoot);
 await protectedDirectory(installationRoot);
 const key=await protectedRead(path.join(installationRoot,"proof-key"),32);if(key.length!==32)blocked("Invalid scoped file proof key");
 const envelope=JSON.parse((await protectedRead(path.join(installationRoot,"install.json"),1024*1024)).toString());
 if(typeof envelope.body!=="string"||typeof envelope.hmac!=="string"||!/^[a-f0-9]{64}$/.test(envelope.hmac)||!timingSafeEqual(createHmac("sha256",key).update(envelope.body).digest(),Buffer.from(envelope.hmac,"hex")))blocked("Invalid scoped file proof");
 const proof=JSON.parse(envelope.body);
 if(proof.format!=="gsa-scoped-files-v2"||proof.hostRelease!==os.release()||proof.arch!==process.arch||!Array.isArray(proof.grants))blocked("Invalid scoped file binding");
 requireMacFileBuild(proof.build);
 if(proof.build.hostRelease!==proof.hostRelease||proof.build.arch!==proof.arch)blocked("Invalid release host binding");
 if(!candidate)requireMacFileEvidence(proof.evidence,proof.build);
 if(proof.grants.length!==registry.list().length)blocked("Scoped file grant set changed");
 const bindings=new Map<string,Bound>();
 for(const b of proof.grants as Bound[]){if(!b||typeof b.id!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(b.id)||bindings.has(b.id)||!b.artifacts||typeof b.root!=="string"||!b.rootIdentity||b.presign_sha256!==proof.build.release_sha256||b.code_sha256!==proof.build.code_sha256||!Number.isSafeInteger(b.revision)||b.revision<1||!["workspace","reference"].includes(b.role))blocked("Invalid grant binding");bindings.set(b.id,b);}
 async function invoke(ref:ScopedFileRef,operation:string,extra:Record<string,unknown>={},destination?:ScopedFileRef,beforeExecute?:()=>Promise<void>){
  validateWorkspaceRelative(ref.path);const grant=registry.requireGrant(ref.workspace_id,operation==="read"?"read":"write");registry.requireGrant(ref.workspace_id,"read");
  if(destination&&(destination.workspace_id!==ref.workspace_id))blocked("Cross-root operation denied");if(destination)validateWorkspaceRelative(destination.path);
  await options.authorize?.(ref.workspace_id,operation==="read"?"read":"write");
  const bound=bindings.get(grant.id);
  if(!bound||bound.root!==grant.canonicalRoot||bound.revision!==grant.revision||bound.role!==roleOf(grant)||bound.rootIdentity.device!==grant.rootIdentity.device||bound.rootIdentity.inode!==grant.rootIdentity.inode)blocked("Scoped file grant changed; reinstall required");
  const dir=path.join(installationRoot,grant.id);await protectedDirectory(dir);
  const app=path.join(dir,"Broker.app"),binary=path.join(app,"Contents/MacOS/broker");
  for(const directory of [app,path.join(app,"Contents"),path.join(app,"Contents/MacOS"),path.join(app,"Contents/_CodeSignature")])await protectedDirectory(directory);
  const expected=["Contents/MacOS/broker","Contents/Info.plist","Contents/_CodeSignature/CodeResources"];
  if(Object.keys(bound.artifacts).length!==expected.length)blocked("Invalid broker manifest");
  let infoBytes:Buffer|undefined;
  for(const relative of expected){const digest=bound.artifacts[relative];const bytes=await protectedRead(path.join(app,relative),16*1024*1024);if(typeof digest!=="string"||!/^[a-f0-9]{64}$/.test(digest)||sha(bytes)!==digest)blocked("Broker changed");if(relative==="Contents/Info.plist")infoBytes=bytes;}
  await validateBundle(app,bound,infoBytes!);
  await beforeExecute?.();
  const selected=await assertMacFileInstallationSeparated(registry,installationRoot);
  await options.authorize?.(ref.workspace_id,operation==="read"?"read":"write");
  requirePinned(grant,operation==="read"?"read":"write");
  if(!isDeepStrictEqual(registry.list(),selected))blocked("Scoped file roots changed before dispatch");
  const result=JSON.parse((await command(binary,[],JSON.stringify({operation,workspace_id:grant.id,role:bound.role,root:grant.canonicalRoot,device:grant.rootIdentity.device,inode:grant.rootIdentity.inode,revision:grant.revision,path:ref.path,...extra,...(destination?{destination:destination.path}:{})}),12*1024*1024,options.ownerLockFD)).toString());
  if(result.ok!==true){const code=typeof result.error==="string"?result.error:"MUTATION_OUTCOME_UNKNOWN";throw Object.assign(Error(code),{code:code.startsWith("SECURITY_BLOCKED")?"SECURITY_BLOCKED":code});}
  return result;
 }
 const bytes=(data:Uint8Array)=>{if(data.byteLength>MAX)throw Error("WRITE_LIMIT_EXCEEDED");return Buffer.from(data).toString("base64");};
 const expected=(hash:string)=>{if(!/^[a-f0-9]{64}$/.test(hash))throw Error("INVALID_SHA256");return hash;};
 const pin=(id:string,permission:WorkspacePermission):WorkspaceGrant=>{
  const grant=registry.requireGrant(id,permission);
  return Object.freeze({...grant,rootIdentity:Object.freeze({...grant.rootIdentity}),permissions:Object.freeze([...grant.permissions])});
 };
 const requirePinned=(captured:WorkspaceGrant,permission:WorkspacePermission)=>{
  const current=registry.requireGrant(captured.id,permission),bound=bindings.get(captured.id);
  if(current.canonicalRoot!==captured.canonicalRoot||current.revision!==captured.revision||current.role!==captured.role||current.rootIdentity.device!==captured.rootIdentity.device||current.rootIdentity.inode!==captured.rootIdentity.inode||current.permissions.length!==captured.permissions.length||!current.permissions.every(p=>captured.permissions.includes(p)))blocked("Scoped file grant changed during copy");
  if(!bound||bound.root!==captured.canonicalRoot||bound.revision!==captured.revision||bound.role!==roleOf(captured)||bound.rootIdentity.device!==captured.rootIdentity.device||bound.rootIdentity.inode!==captured.rootIdentity.inode)blocked("Scoped file grant changed; reinstall required");
 };
 const readSnapshot=async(ref:ScopedFileRef,maxBytes:number,beforeExecute?:()=>Promise<void>)=>{
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>MAX)throw Error("READ_LIMIT_EXCEEDED");
  const r=await invoke(ref,"read",{maxBytes},undefined,beforeExecute),data=Buffer.from(r.base64,"base64");
  if(data.length>maxBytes||sha(data)!==r.sha256)blocked("Invalid broker read receipt");
  return {bytes:data,sha256:r.sha256,kind:"file" as const};
 };
 const roleOf=(grant:WorkspaceGrant)=>grant.role??(grant.permissions.includes("write")?"workspace":"reference");
 async function validateBundle(app:string,bound:Bound,infoBytes:Buffer):Promise<void>{
  await command("/usr/bin/codesign",["--verify","--strict",app],"",65536);
  const info=JSON.parse((await command("/usr/bin/plutil",["-convert","json","-o","-","-"],infoBytes.toString("utf8"),65536)).toString());
  const expected={CFBundleExecutable:"broker",GSAWorkspaceID:bound.id,GSAWorkspaceRole:bound.role,GSAWorkspaceRoot:bound.root,GSARevision:bound.revision,GSADevice:bound.rootIdentity.device,GSAInode:bound.rootIdentity.inode};
  if(!info||Object.entries(expected).some(([key,value])=>info[key]!==value))blocked("Invalid signed broker binding");
  const signed=await command("/usr/bin/codesign",["--display","--entitlements",":-",app],"",65536);
  const entitlements=JSON.parse((await command("/usr/bin/plutil",["-convert","json","-o","-","-"],signed.toString("utf8"),65536)).toString());
  const sandbox="com.apple.security.app-sandbox",rights="com.apple.security.temporary-exception.files.absolute-path."+(bound.role==="reference"?"read-only":"read-write");
  if(!entitlements||Object.keys(entitlements).length!==2||entitlements[sandbox]!==true||!Array.isArray(entitlements[rights])||entitlements[rights].length!==1||entitlements[rights][0]!==bound.root+"/")blocked("Invalid signed broker entitlements");
 }
 async function validateInstalled(grant:WorkspaceGrant):Promise<void>{
  requirePinned(grant,"read");const bound=bindings.get(grant.id)!;
  const dir=path.join(installationRoot,grant.id),app=path.join(dir,"Broker.app");
  for(const directory of [dir,app,path.join(app,"Contents"),path.join(app,"Contents/MacOS"),path.join(app,"Contents/_CodeSignature")])await protectedDirectory(directory);
  const expected=["Contents/MacOS/broker","Contents/Info.plist","Contents/_CodeSignature/CodeResources"];
  if(Object.keys(bound.artifacts).length!==expected.length)blocked("Invalid broker manifest");
  let info:Buffer|undefined;
  for(const relative of expected){const bytes=await protectedRead(path.join(app,relative),16*1024*1024),digest=bound.artifacts[relative];if(typeof digest!=="string"||!/^[a-f0-9]{64}$/.test(digest)||sha(bytes)!==digest)blocked("Broker changed");if(relative==="Contents/Info.plist")info=bytes;}
  await validateBundle(app,bound,info!);
  {
   const scratch=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-file-code-"))),copy=path.join(scratch,"broker");await fs.chmod(scratch,0o700);
   try{await fs.copyFile(path.join(app,"Contents/MacOS/broker"),copy,constants.COPYFILE_EXCL);await fs.chmod(copy,0o700);await command("/usr/bin/codesign",["--remove-signature",copy],"",65536);if(sha(normalizedStrippedMacFileCode(await fs.readFile(copy)))!==proof.build.code_sha256)blocked("Broker release code changed");}
   finally{await fs.unlink(copy).catch(()=>{});await fs.rmdir(scratch);}
  }
  requirePinned(grant,"read");
 }
 // Loading must not advertise a stale installation for the currently selected roots.
 for(const grant of registry.list())await validateInstalled(pin(grant.id,"read"));
 // The checked constructor is concretely wired, but production activation is a
 // source-controlled decision requiring native evidence and reviewed installation.
 const recovery=macFileRecoveryActivation();
 let recoverableMutations:NativeRecoverableFileMutations|undefined;
 if(recovery.available&&options.ownerLockFD===3&&options.authorize){
  try{recoverableMutations=await loadCheckedMacRecoveryInstallation(registry,installationRoot,{ownerLockFD:3,authorize:id=>options.authorize!(id,"write"),protectedRead,protectedDirectory,command});}
  catch{/* Missing/stale recovery installation must preserve the legacy subset. */}
 }
 const supportedOperations:readonly NativeFileOperation[]=Object.freeze(["create_file","create_directory","copy_file",...(recoverableMutations?["update_file","edit_file","apply_patch","delete_file"] as const:[])]);
 return {
  supportedOperations,...(recoverableMutations?{recoverableMutations}:{}),
  read:readSnapshot,
  async createExclusive(ref,data){await invoke(ref,"create",{base64:bytes(data)});},
  async replaceIfHash(ref,data,hash){await invoke(ref,"replace",{base64:bytes(data),expectedSha256:expected(hash)});},
  async makeDirectory(ref){await invoke(ref,"mkdir");},
  async copyExclusive(source,dest,hash){
   // Capture caller-owned arguments before any await; each broker keeps only its own root.
   const from=Object.freeze({...source}),to=Object.freeze({...dest}),wanted=expected(hash);
   validateWorkspaceRelative(from.path);validateWorkspaceRelative(to.path);
   const sourceGrant=pin(from.workspace_id,"read"),destGrant=pin(to.workspace_id,"write");
   const check=()=>{requirePinned(sourceGrant,"read");requirePinned(destGrant,"write");registry.requireGrant(destGrant.id,"read");};
   check();
   const snapshot=await readSnapshot(from,MAX,async()=>{check();});
   if(snapshot.sha256!==wanted)throw Object.assign(Error("HASH_CONFLICT"),{code:"HASH_CONFLICT"});
   await invoke(to,"create",{base64:bytes(snapshot.bytes)},undefined,async()=>{
    check();
    // Recheck observed root identities and durable/controller authorization after capture.
    // This is a final observed check, not an atomic transaction across two grants.
    for(const [grant,permission] of [[sourceGrant,"read"],[destGrant,"write"]] as const){
     const currentRoot=await fs.stat(grant.canonicalRoot,{bigint:true});
     if(String(currentRoot.dev)!==grant.rootIdentity.device||String(currentRoot.ino)!==grant.rootIdentity.inode)blocked("Scoped file root changed during copy");
     await options.authorize?.(grant.id,permission);
    }
    check();
   });
  },
  async moveExclusive(source,dest,hash){await invoke(source,"move",{expectedSha256:expected(hash)},dest);},
  async trashIfHash(ref,hash){await invoke(ref,"trash",{expectedSha256:expected(hash)});}
 };
}
