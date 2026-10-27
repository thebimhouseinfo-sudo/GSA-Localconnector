import type {WorkspaceRegistry} from "../core/workspace.js";
import type {NativeRecoverableFileMutations} from "../core/native-io.js";
import type {ScopedFileRef} from "../core/native-io.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {FileTransactionStore} from "../local/file-transaction-store.js";
import {createMacFileRecovery} from "./macos-file-recovery.js";
import {validateWorkspaceRelative} from "../core/workspace-path.js";
import {assertFileTransactionId} from "../core/file-transactions.js";
import {requireMacFileBuild,requireMacFileEvidence} from "./macos-file-evidence.js";
export interface RecoveryInstallationIO {
 readonly ownerLockFD?:3;
 readonly authorize:(workspaceId:string)=>Promise<void>;
 readonly protectedRead:(file:string,max:number)=>Promise<Buffer>;
 readonly protectedDirectory:(directory:string)=>Promise<void>;
 readonly command:(executable:string,args:string[],input:string,max:number,ownerLockFD?:3)=>Promise<Buffer>;
}
const PROTOCOL="gsa-file-recovery-v1";
const ARTIFACTS=["Contents/MacOS/recovery-broker","Contents/Info.plist","Contents/_CodeSignature/CodeResources"];
const BASE_ARTIFACTS=["Contents/MacOS/broker","Contents/Info.plist","Contents/_CodeSignature/CodeResources"];
function fail():never {throw Object.assign(Error("Unsafe or stale recovery installation"),{code:"SECURITY_BLOCKED"});}
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
type Identity={device:string;inode:string};
type Binding={id:string;root:string;rootIdentity:Identity;revision:number;recovery:{root:string;rootIdentity:Identity;artifacts:Record<string,string>}};
function identity(value:unknown):Identity{
 if(!value||typeof value!=="object"||Array.isArray(value))fail();const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==2||!["device","inode"].every(k=>typeof v[k]==="string"&&/^\d{1,32}$/.test(v[k] as string)))fail();return {device:v.device as string,inode:v.inode as string};
}
const inode=(s:{dev:bigint;ino:bigint}):Identity=>({device:String(s.dev),inode:String(s.ino)});
async function ancestry(root:string,privateRoot=false):Promise<Identity[]>{
 if(typeof root!=="string"||!path.isAbsolute(root)||path.normalize(root)!==root||root==="/"||root.includes("\0")||root.length>4096||await fs.realpath(root)!==root)fail();
 const uid=process.getuid?.();if(uid===undefined)fail();const result:Identity[]=[];
 const dirs:string[]=[];for(let p=root;;p=path.dirname(p)){dirs.unshift(p);if(p===path.dirname(p))break;}
 for(const dir of dirs){const s=await fs.lstat(dir,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink())fail();
  if(privateRoot&&(![0n,BigInt(uid)].includes(s.uid)||((s.mode&0o022n)!==0n&&!(s.uid===0n&&(s.mode&0o1000n)!==0n))))fail();
  if(dir===root&&privateRoot&&(s.uid!==BigInt(uid)||(s.mode&0o777n)!==0o700n))fail();result.push(inode(s));}
 return result;
}
function requestSnapshot(value:Readonly<Record<string,unknown>>,ref:ScopedFileRef,revision:number):Readonly<Record<string,unknown>>{
 const q=structuredClone(value),op=q.operation;
 if(q.protocol!==PROTOCOL||!["replace","trash","inspect"].includes(op as string))fail();assertFileTransactionId(q.transaction_id as string);
 const allowed=op==="inspect"?["protocol","operation","transaction_id"]:["protocol","operation","transaction_id","workspace_id","revision","path","expected_sha256",...(op==="replace"?["base64"]:[])];
 if(Object.keys(q).length!==allowed.length||Object.keys(q).some(k=>!allowed.includes(k)))fail();
 if(op!=="inspect"){
  if(q.workspace_id!==ref.workspace_id||q.path!==ref.path||q.revision!==revision||typeof q.expected_sha256!=="string"||!/^[a-f0-9]{64}$/.test(q.expected_sha256))fail();
  if(op==="replace"){
   if(typeof q.base64!=="string"||q.base64.length>Math.ceil(8*1024*1024/3)*4)fail();
   const bytes=Buffer.from(q.base64,"base64");if(bytes.length>8*1024*1024||bytes.toString("base64")!==q.base64)fail();
  }
 }
 return Object.freeze(q);
}
/** Internal checked constructor, with loader-owned IO only; not a public API or
 * production activation flag. Synthetic IO tests do not certify native signing. */
export async function loadCheckedMacRecoveryInstallation(registry:WorkspaceRegistry,installationRoot:string,io:RecoveryInstallationIO):Promise<NativeRecoverableFileMutations>{
 if(process.platform!=="darwin"||io.ownerLockFD!==3)fail();
 const {protectedRead,protectedDirectory,command,authorize}=io;
 const installedGrants=registry.list();
 const requireInstalledGrants=()=>{if(!isDeepStrictEqual(registry.list(),installedGrants))fail();};
 await ancestry(installationRoot,true);await protectedDirectory(installationRoot);
 const journal=path.join(installationRoot,"file-transactions");
 let initialBodyHash:string|undefined;
 async function manifest():Promise<Map<string,Binding>>{
  requireInstalledGrants();
  await ancestry(installationRoot,true);await protectedDirectory(installationRoot);
  const key=await protectedRead(path.join(installationRoot,"proof-key"),32);if(key.length!==32)fail();
  const envelope=JSON.parse((await protectedRead(path.join(installationRoot,"install.json"),1024*1024)).toString());
  if(typeof envelope.body!=="string"||typeof envelope.hmac!=="string"||!/^[a-f0-9]{64}$/.test(envelope.hmac)||!timingSafeEqual(createHmac("sha256",key).update(envelope.body).digest(),Buffer.from(envelope.hmac,"hex")))fail();
  const proof=JSON.parse(envelope.body);
  if(proof.format!=="gsa-scoped-files-v2"||proof.hostRelease!==os.release()||proof.arch!==process.arch||!Array.isArray(proof.grants)||proof.grants.length!==installedGrants.length)fail();
  // These unchanged validators qualify the BASE release only. They are not
  // native recovery evidence and do not remove the separate activation hold.
  requireMacFileBuild(proof.build);
  if(proof.build.hostRelease!==proof.hostRelease||proof.build.arch!==proof.arch)fail();
  requireMacFileEvidence(proof.evidence,proof.build);
  const bodyHash=sha(Buffer.from(envelope.body));
  if(initialBodyHash!==undefined&&bodyHash!==initialBodyHash)fail();
  const bindings=new Map<string,Binding>(),seen=new Set<string>();
  for(const b of proof.grants){
   if(!b||typeof b.id!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(b.id)||seen.has(b.id)||typeof b.root!=="string"||!Number.isSafeInteger(b.revision)||b.revision<1)fail();
   seen.add(b.id);
   const grant=installedGrants.find(g=>g.id===b.id),rootIdentity=identity(b.rootIdentity);
   if(!grant||!["workspace","reference"].includes(b.role)||b.role!==(grant.role??(grant.permissions.includes("write")?"workspace":"reference"))||b.root!==grant.canonicalRoot||b.revision!==grant.revision||!isDeepStrictEqual(rootIdentity,grant.rootIdentity)||b.presign_sha256!==proof.build.release_sha256||b.code_sha256!==proof.build.code_sha256)fail();
   if(!b.artifacts||typeof b.artifacts!=="object"||Array.isArray(b.artifacts)||Object.keys(b.artifacts).length!==BASE_ARTIFACTS.length)fail();
   for(const name of BASE_ARTIFACTS)if(typeof b.artifacts[name]!=="string"||!/^[a-f0-9]{64}$/.test(b.artifacts[name]))fail();
   const baseApp=path.join(installationRoot,b.id,"Broker.app");
   for(const dir of [path.join(installationRoot,b.id),baseApp,path.join(baseApp,"Contents"),path.join(baseApp,"Contents/MacOS"),path.join(baseApp,"Contents/_CodeSignature")])await protectedDirectory(dir);
   for(const name of BASE_ARTIFACTS)if(sha(await protectedRead(path.join(baseApp,name),16*1024*1024))!==b.artifacts[name])fail();
   // Read-only reference bindings need no recovery broker. Selected working
   // roots are checked below; missing recovery metadata cannot confer support.
   if(b.role==="reference"){if(Object.hasOwn(b,"recovery"))fail();continue;}
   if(!Object.hasOwn(b,"recovery"))continue;
   const r=b.recovery;
   if(!r||typeof r!=="object"||Array.isArray(r)||Object.keys(r).length!==3||!Object.keys(r).every(k=>["root","rootIdentity","artifacts"].includes(k))||typeof r.root!=="string"||!r.artifacts||typeof r.artifacts!=="object"||Array.isArray(r.artifacts)||Object.keys(r.artifacts).length!==ARTIFACTS.length)fail();
   for(const name of ARTIFACTS)if(typeof r.artifacts[name]!=="string"||!/^[a-f0-9]{64}$/.test(r.artifacts[name]))fail();
   bindings.set(b.id,{id:b.id,root:b.root,rootIdentity:identity(b.rootIdentity),revision:b.revision,recovery:{root:r.root,rootIdentity:identity(r.rootIdentity),artifacts:{...r.artifacts}}});
  }
  requireInstalledGrants();
  initialBodyHash??=bodyHash;
  return bindings;
 }
 const initial=await manifest();
 async function protectSelectedRoots(bindings:ReadonlyMap<string,Binding>):Promise<void>{
  const selected=registry.list();
  const protectedChains=[await ancestry(installationRoot,true)];
  // The fixed journal may not exist until the first durable intent. Its parent
  // is already checked; if it exists, validate its actual identity/ancestry too.
  try{await fs.lstat(journal);protectedChains.push(await ancestry(journal,true));}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  for(const binding of bindings.values()){
   const chain=await ancestry(binding.recovery.root,true);
   if(!isDeepStrictEqual(chain.at(-1),binding.recovery.rootIdentity))fail();
   protectedChains.push(chain);
  }
  for(const grant of selected){
   const chain=await ancestry(grant.canonicalRoot),root=chain.at(-1)!;
   if(!isDeepStrictEqual(root,grant.rootIdentity))fail();
   for(const protectedChain of protectedChains){
    const protectedRoot=protectedChain.at(-1)!;
    // Check both directions by physical identity, including equal roots and
    // case aliases. No workspace or reference may contain/be contained by a
    // writable recovery root, the installation, or the protected journal.
    if(chain.some(v=>isDeepStrictEqual(v,protectedRoot))||protectedChain.some(v=>isDeepStrictEqual(v,root)))fail();
   }
  }
  // Root enrollment/revocation can finish while filesystem metadata awaits.
  if(!isDeepStrictEqual(registry.list(),selected))fail();
  requireInstalledGrants();
 }
 await protectSelectedRoots(initial);
 async function checked(id:string):Promise<{binding:Binding;app:string;binary:string}>{
  const currentBindings=await manifest(),current=currentBindings.get(id),bound=initial.get(id);
  if(!current||!bound||!isDeepStrictEqual(current,bound))fail();
  await protectSelectedRoots(currentBindings);
  const grant=registry.requireGrant(id,"write");registry.requireGrant(id,"read");
  if(grant.role==="reference"||grant.canonicalRoot!==bound.root||grant.revision!==bound.revision||!isDeepStrictEqual(grant.rootIdentity,bound.rootIdentity))fail();
  const work=await ancestry(bound.root),recovery=await ancestry(bound.recovery.root,true),w=work.at(-1)!,r=recovery.at(-1)!;
  if(!isDeepStrictEqual(w,bound.rootIdentity)||!isDeepStrictEqual(r,bound.recovery.rootIdentity)||w.device!==r.device||work.some(v=>isDeepStrictEqual(v,r))||recovery.some(v=>isDeepStrictEqual(v,w)))fail();
  const app=path.join(installationRoot,id,"RecoveryBroker.app"),binary=path.join(app,"Contents/MacOS/recovery-broker");
  for(const dir of [path.join(installationRoot,id),app,path.join(app,"Contents"),path.join(app,"Contents/MacOS"),path.join(app,"Contents/_CodeSignature")])await protectedDirectory(dir);
  let infoBytes:Buffer|undefined;
  for(const name of ARTIFACTS){const bytes=await protectedRead(path.join(app,name),16*1024*1024);if(sha(bytes)!==bound.recovery.artifacts[name])fail();if(name==="Contents/Info.plist")infoBytes=bytes;}
  await command("/usr/bin/codesign",["--verify","--strict",app],"",65536);
  const info=JSON.parse((await command("/usr/bin/plutil",["-convert","json","-o","-","-"],infoBytes!.toString("utf8"),65536)).toString());
  const expected={CFBundleExecutable:"recovery-broker",GSARecoveryProtocol:PROTOCOL,GSAWorkspaceRoot:bound.root,GSARecoveryRoot:bound.recovery.root,GSAWorkspaceID:id,GSARevision:bound.revision,GSADevice:w.device,GSAInode:w.inode,GSARecoveryDevice:r.device,GSARecoveryInode:r.inode};
  if(!info||Object.entries(expected).some(([key,value])=>info[key]!==value))fail();
  const signed=await command("/usr/bin/codesign",["--display","--entitlements",":-",app],"",65536);
  const entitlements=JSON.parse((await command("/usr/bin/plutil",["-convert","json","-o","-","-"],signed.toString("utf8"),65536)).toString());
  const rights="com.apple.security.temporary-exception.files.absolute-path.read-write",sandbox="com.apple.security.app-sandbox";
  if(!entitlements||Object.keys(entitlements).length!==2||entitlements[sandbox]!==true||!Array.isArray(entitlements[rights])||entitlements[rights].length!==2||new Set(entitlements[rights]).size!==2||![bound.root+"/",bound.recovery.root+"/"].every(v=>entitlements[rights].includes(v)))fail();
  // Signing/plist commands await other processes. Do not let an enrollment or
  // HMAC-valid installation rewrite during those waits reach the broker.
  await manifest();await protectSelectedRoots(initial);
  return {binding:bound,app,binary};
 }
 const selected=registry.list().filter(g=>g.permissions.includes("write"));if(!selected.length)fail();
 for(const grant of selected)await checked(grant.id);
 return createMacFileRecovery({registry,store:new FileTransactionStore(journal),authorize,invoke:async(ref,request)=>{
  const pinned=Object.freeze({workspace_id:ref.workspace_id,path:ref.path});validateWorkspaceRelative(pinned.path);
  const known=initial.get(pinned.workspace_id);if(!known)fail();const q=requestSnapshot(request,pinned,known.revision);
  const target=await checked(pinned.workspace_id);
  await manifest();
  await protectSelectedRoots(initial);
  // Recheck durable controller/grant authority after all signing and protected
  // filesystem reads, then synchronously fence the complete installed grant set.
  await authorize(pinned.workspace_id);
  const grant=registry.requireGrant(pinned.workspace_id,"write");
  if(grant.canonicalRoot!==target.binding.root||grant.revision!==target.binding.revision||!isDeepStrictEqual(grant.rootIdentity,target.binding.rootIdentity))fail();
  requireInstalledGrants();
  return JSON.parse((await command(target.binary,[],JSON.stringify(q),32768,3)).toString());
 }});
}
