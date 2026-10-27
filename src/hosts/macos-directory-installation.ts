import fs from "node:fs/promises";
import {constants,fstatSync} from "node:fs";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import type {WorkspaceRegistry} from "../core/workspace.js";
import type {WorkspacePermission} from "../core/contracts.js";
import type {NativeDirectoryCopies,NativeScopedFiles} from "../core/native-io.js";
import {validateWorkspaceRelative} from "../core/workspace-path.js";
import {validateDirectoryCapture,type NativeDirectoryReader} from "../core/directory-copy.js";
import {DirectoryCopyStore} from "../local/directory-copy-store.js";
import {createMacDirectoryCopies} from "./macos-directory-copy.js";
import {normalizedStrippedMacFileCode} from "./macos-file-code.js";
import {assertMacFileInstallationSeparated} from "./macos-scoped-files.js";
import {requireMacDirectoryBuild,requireMacDirectoryEvidence,type DirectoryInstallationProof,type DirectoryTreeBinding} from "./macos-directory-evidence.js";

export interface DirectoryInstallationIO {
 readonly protectedRead:(file:string,max:number)=>Promise<Buffer>;
 readonly protectedDirectory:(directory:string)=>Promise<void>;
 readonly command:(executable:string,args:string[],input:string,max:number,ownerLockFD?:3)=>Promise<Buffer>;
}
const REASON="Exact tree-reader native proof and installation review pending";
export function macDirectoryCopyActivation():Readonly<{available:false;reason:typeof REASON}>{return Object.freeze({available:false,reason:REASON});}
const sha=(v:Uint8Array)=>createHash("sha256").update(v).digest("hex");
function fail(message="Unsafe or stale directory installation"):never {throw Object.assign(Error(message),{code:"SECURITY_BLOCKED"});}
function exact(v:any,keys:readonly string[]):void {if(!v||typeof v!=="object"||Array.isArray(v)||Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))fail();}
const hash=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const artifacts=["Contents/MacOS/tree-broker","Contents/Info.plist","Contents/_CodeSignature/CodeResources"] as const;
async function protectedRead(file:string,max:number):Promise<Buffer>{
 if(!path.isAbsolute(file)||path.normalize(file)!==file||file.includes("\0")||Buffer.byteLength(file)>4096)fail();
 const uid=process.getuid?.();if(uid===undefined)fail();
 const ancestors:string[]=[];for(let dir=path.dirname(file);;dir=path.dirname(dir)){ancestors.unshift(dir);if(dir===path.dirname(dir))break;}
 for(const dir of ancestors){const st=await fs.lstat(dir);if(!st.isDirectory()||st.isSymbolicLink()||![0,uid].includes(st.uid)||((st.mode&0o022)!==0&&!(st.uid===0&&(st.mode&0o1000)!==0)))fail();}
 if(await fs.realpath(path.dirname(file))!==path.dirname(file))fail();
 const before=await fs.lstat(file,{bigint:true});
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.uid!==BigInt(process.getuid!())||(before.mode&0o077n)!==0n||before.size>BigInt(max))fail();
 const fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const opened=await fd.stat({bigint:true});if(opened.dev!==before.dev||opened.ino!==before.ino)fail();const bytes=Buffer.alloc(Number(before.size)+1);let count=0;while(count<bytes.length){const r=await fd.read(bytes,count,bytes.length-count,count);if(!r.bytesRead)break;count+=r.bytesRead;}const after=await fd.stat({bigint:true}),named=await fs.lstat(file,{bigint:true});if(count!==Number(before.size)||after.ctimeNs!==before.ctimeNs||after.mtimeNs!==before.mtimeNs||after.nlink!==1n||named.dev!==before.dev||named.ino!==before.ino)fail();return bytes.subarray(0,count);}finally{await fd.close();}
}
async function protectedDirectory(directory:string):Promise<void>{const st=await fs.lstat(directory);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o777)!==0o700||await fs.realpath(directory)!==directory)fail();}
async function command(executable:string,args:string[],input:string,max:number,ownerLockFD?:3):Promise<Buffer>{
 if(ownerLockFD!==3||Buffer.byteLength(input)>65536)fail();
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{shell:false,env:{PATH:"/usr/bin:/bin",HOME:"/var/empty",LANG:"C",TMPDIR:"/private/tmp"},stdio:["pipe","pipe","pipe",3]});
  const {stdin,stdout,stderr}=child;if(!stdin||!stdout||!stderr){child.kill("SIGKILL");reject(Object.assign(Error("Directory helper pipes unavailable"),{code:"SECURITY_BLOCKED"}));return;}
  let output=Buffer.alloc(0),diagnostics=0,error:Error|undefined;
  const abort=(message:string)=>{error=Object.assign(Error(message),{code:"SECURITY_BLOCKED"});child.kill("SIGKILL");};
  const timer=setTimeout(()=>abort("Directory helper timeout"),15000);
  stdout.on("data",(b:Buffer)=>{if(output.length+b.length>max)abort("Directory helper output limit");else output=Buffer.concat([output,b]);});
  stderr.on("data",(b:Buffer)=>{diagnostics+=b.length;if(diagnostics>65536)abort("Directory helper diagnostics limit");});
  child.on("error",e=>{error=e;});stdin.on("error",()=>{});child.on("close",code=>{clearTimeout(timer);if(error||code!==0)reject(error??Object.assign(Error("Directory helper failed"),{code:"SECURITY_BLOCKED"}));else resolve(output);});stdin.end(input);
 });
}
const defaults:DirectoryInstallationIO={protectedRead,protectedDirectory,command};
/** Checked, source-blocked loader. Injected transport data cannot grant activation. */
export async function loadCheckedMacDirectoryInstallation(registry:WorkspaceRegistry,installationRoot:string,base:NativeScopedFiles,options:{ownerLockFD:3;authorize:(workspaceId:string,permission:WorkspacePermission)=>Promise<void>},io:DirectoryInstallationIO=defaults):Promise<NativeDirectoryCopies>{
 try{return await load(registry,installationRoot,base,options,io);}catch(error){if((error as {code?:string}).code==="SECURITY_BLOCKED")throw error;fail();}
}
async function load(registry:WorkspaceRegistry,installationRoot:string,base:NativeScopedFiles,options:{ownerLockFD:3;authorize:(workspaceId:string,permission:WorkspacePermission)=>Promise<void>},io:DirectoryInstallationIO):Promise<NativeDirectoryCopies>{
 if(process.platform!=="darwin"||process.arch!=="arm64"||options?.ownerLockFD!==3||typeof options.authorize!=="function"||path.basename(installationRoot)!=="directory-copy")fail();
 fstatSync(3);
 const initialGrants=registry.list(),records=path.join(installationRoot,"copy-records");
 if(!initialGrants.length)fail();
 const proofPath=path.join(installationRoot,"install.json");
 const read=async(file:string,max:number)=>{const bytes=await io.protectedRead(file,max);if(!Buffer.isBuffer(bytes)||bytes.length>max)fail();return bytes;};
 async function separated():Promise<void>{
  const identityRoot=path.dirname(installationRoot);
  await assertMacFileInstallationSeparated(registry,identityRoot);await io.protectedDirectory(identityRoot);
  await assertMacFileInstallationSeparated(registry,installationRoot);await assertMacFileInstallationSeparated(registry,records);
  await io.protectedDirectory(installationRoot);await io.protectedDirectory(records);
  if(!isDeepStrictEqual(registry.list(),initialGrants))fail();
 }
 function parse(bytes:Buffer):any {const text=bytes.toString("utf8");if(Buffer.from(text).compare(bytes)!==0)fail();return JSON.parse(text);}
 async function manifest():Promise<DirectoryInstallationProof>{
  await separated();const key=await read(path.join(installationRoot,"proof-key"),32);if(key.length!==32)fail();
  const envelope=parse(await read(proofPath,65536));exact(envelope,["body","hmac"]);
  if(typeof envelope.body!=="string"||Buffer.byteLength(envelope.body)>65536||!hash(envelope.hmac)||!timingSafeEqual(createHmac("sha256",key).update(envelope.body).digest(),Buffer.from(envelope.hmac,"hex")))fail();
  const proof=JSON.parse(envelope.body);exact(proof,["format","hostRelease","arch","build","grants","evidence_file","evidence_sha256"]);
  if(proof.format!=="gsa-directory-copy-installation-v1"||proof.hostRelease!==os.release()||proof.arch!==process.arch||proof.evidence_file!=="native-evidence.json"||!hash(proof.evidence_sha256)||!Array.isArray(proof.grants)||proof.grants.length!==initialGrants.length)fail();
  requireMacDirectoryBuild(proof.build);if(proof.build.hostRelease!==proof.hostRelease||proof.build.arch!==proof.arch)fail();
  const source=await read(fileURLToPath(new URL("../../../native/macos-files/tree-broker.swift",import.meta.url)),65536);if(sha(source)!==proof.build.source_sha256)fail("Directory tree source changed");
  const seen=new Set<string>();
  for(const b of proof.grants){
   exact(b,["id","root","rootIdentity","revision","role","artifacts","presign_sha256","code_sha256"]);exact(b.rootIdentity,["device","inode"]);exact(b.artifacts,artifacts);
   if(typeof b.id!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(b.id)||seen.has(b.id)||![b.rootIdentity.device,b.rootIdentity.inode].every(v=>typeof v==="string"&&/^(0|[1-9][0-9]{0,31})$/.test(v))||!Object.values(b.artifacts).every(hash)||b.presign_sha256!==proof.build.release_sha256||b.code_sha256!==proof.build.code_sha256)fail();seen.add(b.id);
   const g=registry.requireGrant(b.id,"read"),role=g.role??(g.permissions.includes("write")?"workspace":"reference");
   if(b.root!==g.canonicalRoot||b.revision!==g.revision||b.role!==role||!isDeepStrictEqual(b.rootIdentity,g.rootIdentity))fail();
  }
  const evidence=await read(path.join(installationRoot,"native-evidence.json"),1_048_576);if(sha(evidence)!==proof.evidence_sha256)fail("Directory native evidence digest changed");requireMacDirectoryEvidence(parse(evidence),proof.build);
  return proof as DirectoryInstallationProof;
 }
 const initial=await manifest();
 async function checked(id:string):Promise<{binding:DirectoryTreeBinding;binary:string}>{
  const current=await manifest();if(!isDeepStrictEqual(initial,current))fail();const b=initial.grants.find(v=>v.id===id);if(!b)fail();
  const dir=path.join(installationRoot,id),app=path.join(dir,"TreeReader.app"),binary=path.join(app,"Contents/MacOS/tree-broker");
  for(const d of [dir,app,path.join(app,"Contents"),path.join(app,"Contents/MacOS"),path.join(app,"Contents/_CodeSignature")]){await assertMacFileInstallationSeparated(registry,d);await io.protectedDirectory(d);}
  let infoBytes:Buffer|undefined,binaryBytes:Buffer|undefined;
  for(const name of artifacts){const bytes=await read(path.join(app,name),16*1024*1024);if(sha(bytes)!==b.artifacts[name])fail("Directory artifact changed");if(name==="Contents/Info.plist")infoBytes=bytes;if(name==="Contents/MacOS/tree-broker")binaryBytes=bytes;}
  const run=(exe:string,args:string[],input="",max=65536)=>io.command(exe,args,input,max,3);
  await run("/usr/bin/codesign",["--verify","--strict",app]);
  const info=parse(await run("/usr/bin/plutil",["-convert","json","-o","-","-"],infoBytes!.toString("utf8")));
  const expected={CFBundleExecutable:"tree-broker",GSAWorkspaceID:b.id,GSAWorkspaceRole:b.role,GSAWorkspaceRoot:b.root,GSARevision:b.revision,GSADevice:b.rootIdentity.device,GSAInode:b.rootIdentity.inode};
  if(!info||Object.entries(expected).some(([k,v])=>info[k]!==v))fail("Directory signed binding changed");
  const signed=await run("/usr/bin/codesign",["--display","--entitlements",":-",app]),entitlements=parse(await run("/usr/bin/plutil",["-convert","json","-o","-","-"],signed.toString("utf8")));
  if(!isDeepStrictEqual(entitlements,{"com.apple.security.app-sandbox":true,"com.apple.security.temporary-exception.files.absolute-path.read-only":[b.root+"/"]}))fail("Directory readonly entitlements changed");
  const scratch=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-tree-code-"))),copy=path.join(scratch,"tree-broker");await fs.chmod(scratch,0o700);
  try{await fs.writeFile(copy,binaryBytes!,{mode:0o700,flag:"wx"});await run("/usr/bin/codesign",["--remove-signature",copy]);if(sha(normalizedStrippedMacFileCode(await fs.readFile(copy)))!==initial.build.code_sha256)fail("Directory release code changed");}finally{await fs.unlink(copy).catch(()=>{});await fs.rmdir(scratch);}
  await options.authorize(id,"read");await separated();const g=registry.requireGrant(id,"read");if(g.canonicalRoot!==b.root||g.revision!==b.revision||(g.role??(g.permissions.includes("write")?"workspace":"reference"))!==b.role||!isDeepStrictEqual(g.rootIdentity,b.rootIdentity))fail();
  return {binding:b,binary};
 }
 for(const g of initialGrants)await checked(g.id);
 const activation=macDirectoryCopyActivation();if(!activation.available)fail(activation.reason);
 // This private constructor is reachable only after a future reviewed source activation.
 return construct(registry,base,records,options.authorize,async source=>{
  const ref=Object.freeze({workspace_id:source.workspace_id,path:source.path});validateWorkspaceRelative(ref.path,true);
  if(Buffer.byteLength(ref.path)>4096||Buffer.from(ref.path).toString("utf8")!==ref.path)fail();
  const target=await checked(ref.workspace_id),b=target.binding,q={operation:"capture_tree",workspace_id:b.id,role:b.role,root:b.root,device:b.rootIdentity.device,inode:b.rootIdentity.inode,revision:b.revision,path:ref.path};
  const raw=await io.command(target.binary,[],JSON.stringify(q),12_582_912,3);if(raw.length>12_582_912)fail();const r=parse(raw);
  await checked(ref.workspace_id);
  if(r?.ok!==true){exact(r,["ok","error"]);if(r.ok!==false||typeof r.error!=="string"||!/^[A-Z_]{1,64}$/.test(r.error))fail();throw Object.assign(Error(r.error),{code:r.error});}
  exact(r,["ok","format","binding","capture"]);const expected={...q};delete (expected as Partial<typeof q>).operation;
  if(r.format!=="gsa-directory-capture-response-v1"||!isDeepStrictEqual(r.binding,expected))fail();const capture=validateDirectoryCapture(r.capture);
  if(ref.path==="."&&(capture.observations[0]?.device!==b.rootIdentity.device||capture.observations[0]?.inode!==b.rootIdentity.inode))fail();return capture;
 });
}
function construct(registry:WorkspaceRegistry,base:NativeScopedFiles,records:string,authorize:(id:string,permission:WorkspacePermission)=>Promise<void>,capture:NativeDirectoryReader["capture"]):NativeDirectoryCopies {
 return createMacDirectoryCopies(registry,{capture},base,new DirectoryCopyStore(records),authorize);
}
