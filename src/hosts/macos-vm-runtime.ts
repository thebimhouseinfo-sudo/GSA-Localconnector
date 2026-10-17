import {validateArtifactPaths} from "../core/ci-dag.js";
import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {constants} from "node:fs";
import fs from "node:fs/promises";
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import os from "node:os";
import path from "node:path";
import {AsyncResource} from "node:async_hooks";
import {identityDirectory} from "../local/identity.js";
import type {WorkspaceRegistry} from "../core/workspace.js";
import {validateWorkspaceRelative} from "../core/workspace-path.js";
import type {VerifiedWorkspaceSourceCapture} from "../core/ci-source-capture.js";
import type {NativeProcessStatus,SandboxedProcessRequest,SandboxedProcessReceipt,VerifiedNativeProcessController,VerifiedNativeSandbox} from "../core/native-io.js";

export const MAC_VM_IMAGE_SHA256="9aca11f8edb5474df457c073dbfe140b27aa31f22e46ab1405bed089c5d57666";
export const MAC_VM_REQUIRED_CHECKS=["allowed-build","outside-read","outside-write","nested-process","source-integrity","secret-exposure","network-denied","timeout","output-cap","cgroup-descendants","clean-stop"] as const;
const ARTIFACTS=["bin/worker-host","bin/source-capture","scripts/prepare-vm-worker-seed.py","native/macos-vm/guest_worker.py"] as const;
const MAX_SOURCE=4*1024*1024;
type InstallBody={format:"gsa-native-vm-v1";platform:"darwin";arch:"arm64";hostRelease:string;imagePath:string;imageSHA256:string;imageBytes:number;artifacts:Record<string,string>;checks:string[]};
export interface MacVmRuntime {
 sandbox:VerifiedNativeSandbox;processes:VerifiedNativeProcessController;sourceCapture:VerifiedWorkspaceSourceCapture;
 executeSnapshot(request:SandboxedProcessRequest,entries:readonly {path:string;bytes:Uint8Array}[]):Promise<SandboxedProcessReceipt>;
}
export interface MacVmRuntimeOptions {authorize?:(workspaceId:string)=>Promise<void>;ownerLockFD?:3}
class RuntimeBlocked extends Error {readonly code="SECURITY_BLOCKED";constructor(reason:string){super("SECURITY_BLOCKED: "+reason);}}
function blocked(reason:string):never{throw new RuntimeBlocked(reason);}
function object(value:unknown):Record<string,any>{if(!value||typeof value!=="object"||Array.isArray(value))blocked("invalid object");return value as Record<string,any>;}
function sha(data:Uint8Array|string){return createHash("sha256").update(data).digest("hex");}
export function validateMacVmInstallBody(value:unknown):InstallBody{
 const b=object(value);
 if(b.format!=="gsa-native-vm-v1"||b.platform!=="darwin"||b.arch!=="arm64"||b.hostRelease!==os.release()||
 typeof b.imagePath!=="string"||!path.posix.isAbsolute(b.imagePath)||path.posix.normalize(b.imagePath)!==b.imagePath||/[\0\r\n]/.test(b.imagePath)||
 b.imageSHA256!==MAC_VM_IMAGE_SHA256||b.imageBytes!==3758096384||!Array.isArray(b.checks)||
 !MAC_VM_REQUIRED_CHECKS.every(c=>b.checks.includes(c)))blocked("installation proof binding");
 const artifacts=object(b.artifacts);
 if(Object.keys(artifacts).length!==ARTIFACTS.length||!ARTIFACTS.every(k=>typeof artifacts[k]==="string"&&/^[a-f0-9]{64}$/.test(artifacts[k])))blocked("artifact manifest");
 return b as InstallBody;
}
type SourceFile={path:string;base64:string;sha256:string;size:number;executable:boolean};
type SourceSnapshot={protocolVersion:string;state:string;canonicalRoot:string;files:SourceFile[];totalBytes:number;securityVerified:false};
export function filterMacVmSourceSnapshot(value:unknown,root:string):SourceSnapshot{
 const input=object(value);
 if(input.protocolVersion!=="gsa-source-capture-v1"||input.state!=="CAPTURED"||input.canonicalRoot!==root||input.securityVerified!==false||!Array.isArray(input.files)||input.files.length>1000)blocked("SOURCE_UNVERIFIED");
 const seen=new Set<string>();const files:SourceFile[]=[];let total=0;let originalTotal=0;
 for(const raw of input.files){
  const f=object(raw);validateWorkspaceRelative(f.path);
  const key=f.path.toLowerCase();if(seen.has(key))blocked("duplicate source path");seen.add(key);
  if(typeof f.base64!=="string"||f.base64.length>Math.ceil(MAX_SOURCE/3)*4||!Number.isSafeInteger(f.size)||f.size<0||typeof f.executable!=="boolean"||typeof f.sha256!=="string"||!/^[a-f0-9]{64}$/.test(f.sha256))blocked("invalid source entry");
  const bytes=Buffer.from(f.base64,"base64");originalTotal+=bytes.length;
  if(bytes.toString("base64")!==f.base64||bytes.length!==f.size||sha(bytes)!==f.sha256||originalTotal>MAX_SOURCE)blocked("SOURCE_UNVERIFIED");
  if(f.path.split("/").some((name:string)=>name.toLowerCase().startsWith(".env")||[".npmrc",".pypirc",".git-credentials",".ssh"].includes(name.toLowerCase())))continue;
  files.push({path:f.path,base64:f.base64,sha256:f.sha256,size:f.size,executable:f.executable});total+=bytes.length;
 }
 if(input.totalBytes!==originalTotal)blocked("SOURCE_UNVERIFIED");
 return {protocolVersion:input.protocolVersion,state:"CAPTURED",canonicalRoot:root,files:files.sort((a,b)=>a.path.localeCompare(b.path)),totalBytes:total,securityVerified:false};
}
async function protectedPath(file:string,directory=false){
 const st=await fs.lstat(file);
 if(st.isSymbolicLink()||(directory?!st.isDirectory():!st.isFile())||![0,process.getuid?.()].includes(st.uid)||(st.mode&0o077)!==0||(directory&&(st.mode&0o777)!==0o700)||(!directory&&st.nlink!==1))blocked("unsafe installation permissions/type");
 return st;
}
async function protectedRead(file:string,max:number){
 const before=await protectedPath(file);if(before.size>max)blocked("oversized installation artifact");
 const fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const opened=await fd.stat();if(opened.ino!==before.ino||opened.dev!==before.dev)blocked("installation changed");
  const data=Buffer.alloc(before.size);let position=0;
  while(position<data.length){const {bytesRead}=await fd.read(data,position,data.length-position,position);if(!bytesRead)blocked("installation truncated");position+=bytesRead;}
  const extra=Buffer.alloc(1);if((await fd.read(extra,0,1,position)).bytesRead!==0)blocked("installation grew");const after=await fd.stat();
  if(data.length>max||after.size!==before.size||after.ctimeMs!==before.ctimeMs||after.mtimeMs!==before.mtimeMs)blocked("installation changed");
  return data;
 }finally{await fd.close();}
}
const environment={PATH:"/usr/bin:/bin:/usr/sbin:/sbin",LANG:"C.UTF-8",HOME:"/var/empty",TMPDIR:"/private/tmp"};
function child(file:string,args:readonly string[]=[],ownerLockFD?:3){return spawn(file,[...args],{stdio:ownerLockFD===undefined?["pipe","pipe","pipe"]:["pipe","pipe","pipe",ownerLockFD],env:environment,shell:false}) as ChildProcessWithoutNullStreams;}
async function boundedCommand(file:string,args:readonly string[],input:string,max:number,timeout=45000,ownerLockFD?:3):Promise<Buffer>{
 return await new Promise((resolve,reject)=>{
  const proc=child(file,args,ownerLockFD);let output=Buffer.alloc(0);let size=0;let error:Error|undefined;
  const abort=(reason:string)=>{error=new RuntimeBlocked(reason);proc.kill("SIGKILL");};
  const timer=setTimeout(()=>abort("trusted helper timeout"),timeout);
  proc.stdout.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size>max)abort("trusted helper output cap");else output=Buffer.concat([output,chunk]);});
  let diagnostics=0;proc.stderr.on("data",(chunk:Buffer)=>{diagnostics+=chunk.length;if(diagnostics>65536)abort("trusted helper diagnostic cap");});
  proc.on("error",e=>{error=e;});proc.stdin.on("error",()=>{});
  proc.on("close",code=>{clearTimeout(timer);if(error||code!==0)reject(error??new RuntimeBlocked("trusted helper failed"));else resolve(output);});
  proc.stdin.end(input);
 });
}
function validateRequest(req:SandboxedProcessRequest){
 if(typeof req.workspace_id!=="string"||!req.executable||req.executable.includes("\0")||(!path.posix.isAbsolute(req.executable)&&req.executable.includes("/"))||
 !Array.isArray(req.argv)||req.argv.some(x=>typeof x!=="string"||x.includes("\0"))||Buffer.byteLength(JSON.stringify(req))>60000||
 !Number.isSafeInteger(req.time_limit_ms)||req.time_limit_ms<1||req.time_limit_ms>120000||!Number.isSafeInteger(req.max_output_bytes)||req.max_output_bytes<1||req.max_output_bytes>1048576||req.network_allowed!==false)blocked("invalid process request");
 validateWorkspaceRelative(req.cwd_relative,true);
 validateArtifactPaths(req.artifact_paths);
}
/** Validates the entire bounded payload before any protected CI evidence is written. */
export function validateMacVmArtifacts(request:SandboxedProcessRequest,result:Record<string,any>):Pick<SandboxedProcessReceipt,"artifacts"|"artifact_error">{
 const paths=validateArtifactPaths(request.artifact_paths);
 if(request.artifact_paths===undefined&&result.artifacts===undefined&&result.artifact_error===undefined)return {};
 if(!Array.isArray(result.artifacts)||result.artifacts.length>20||!(result.artifact_error===null||result.artifact_error==="artifact_missing_unsafe_or_over_quota"))blocked("VM artifact receipt");
 if(result.artifact_error!==null){if(result.artifacts.length!==0)blocked("VM partial artifact receipt");return {artifacts:[],artifact_error:result.artifact_error};}
 if(result.artifacts.length!==paths.length)blocked("VM artifact count");
 const seen=new Set<string>();let total=0;
 const artifacts=result.artifacts.map((raw:unknown)=>{
  const entry=object(raw);
  if(Object.keys(entry).some(k=>!["path","size","sha256","base64"].includes(k))||typeof entry.path!=="string"||!paths.includes(entry.path)||seen.has(entry.path.toLowerCase())||!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>1048576||typeof entry.sha256!=="string"||!/^[a-f0-9]{64}$/.test(entry.sha256)||typeof entry.base64!=="string"||entry.base64.length>1398104)blocked("VM artifact integrity");
  seen.add(entry.path.toLowerCase());total+=entry.size;if(total>1048576)blocked("VM artifact quota");
  const bytes=Buffer.from(entry.base64,"base64");
  if(bytes.toString("base64")!==entry.base64||bytes.length!==entry.size||sha(bytes)!==entry.sha256)blocked("VM artifact bytes");
  return {path:entry.path,size:entry.size,sha256:entry.sha256,base64:entry.base64};
 });
 return {artifacts,artifact_error:null};
}

type Run={id:string;request:SandboxedProcessRequest;authorize:()=>Promise<void>;source?:SourceSnapshot;status:NativeProcessStatus;receipt?:SandboxedProcessReceipt;done:Promise<SandboxedProcessReceipt>;proc?:ChildProcessWithoutNullStreams;stopRequested:boolean;clean:boolean;failure?:unknown};
export async function loadMacVmRuntime(registry:WorkspaceRegistry,installationRoot=path.join(identityDirectory(),"native-vm"),options:MacVmRuntimeOptions={}):Promise<MacVmRuntime>{
 try{
  if(process.platform!=="darwin"||process.arch!=="arm64")blocked("host platform");
  if(!path.isAbsolute(installationRoot)||await fs.realpath(installationRoot)!==installationRoot)blocked("installation root must be canonical");
  await protectedPath(installationRoot,true);
  const key=await protectedRead(path.join(installationRoot,"native-proof-key"),32);if(key.length!==32)blocked("proof key");
  const signed=object(JSON.parse((await protectedRead(path.join(installationRoot,"install.json"),16384)).toString("utf8")));
  if(typeof signed.body!=="string"||typeof signed.hmac!=="string"||!/^[a-f0-9]{64}$/.test(signed.hmac)||!timingSafeEqual(Buffer.from(signed.hmac,"hex"),createHmac("sha256",key).update(signed.body).digest()))blocked("installation signature");
  const install=validateMacVmInstallBody(JSON.parse(signed.body));
  const verifyArtifacts=async()=>{
   for(const name of ARTIFACTS){
    const parts=name.split("/");for(let i=1;i<parts.length;i++)await protectedPath(path.join(installationRoot,...parts.slice(0,i)),true);
    if(sha(await protectedRead(path.join(installationRoot,name),16*1024*1024))!==install.artifacts[name])blocked("artifact digest");
   }
  };
  await verifyArtifacts();
  if(await fs.realpath(install.imagePath)!==install.imagePath||(await protectedPath(install.imagePath)).size!==install.imageBytes)blocked("pinned image metadata");
  // WorkerHost independently opens, hashes and clones the pinned image for each VM.
  const fingerprint=sha(signed.body);const runs=new Map<string,Run>();let active=0;
  const authorization=(workspaceId:string)=>AsyncResource.bind(async()=>{await options.authorize?.(workspaceId);});
  function pruneHistory(){
   // Keep the newest 128 terminal receipts plus active/unconfirmed sessions.
   // Expired IDs return PROCESS_NOT_FOUND; they never become another session.
   const terminal=[...runs.values()].filter(r=>r.status.ended_at&&(!r.proc||r.clean));
   for(const old of terminal.slice(0,Math.max(0,terminal.length-128)))runs.delete(old.id);
  }
  function grant(workspaceId:string){
   const read=registry.requireGrant(workspaceId,"read"),exec=registry.requireGrant(workspaceId,"execute");if(exec.revision!==read.revision)blocked("grant changed");
   for(const protectedRoot of [installationRoot,identityDirectory()]){
    const into=path.relative(read.canonicalRoot,protectedRoot),out=path.relative(protectedRoot,read.canonicalRoot);
    if(into===""||(!into.startsWith(".."+path.sep)&&into!==".."&&!path.isAbsolute(into))||out===""||(!out.startsWith(".."+path.sep)&&out!==".."&&!path.isAbsolute(out)))blocked("workspace overlaps protected connector state");
   }
   return read;
  }
  async function snapshot(workspaceId:string,authorize=authorization(workspaceId)){
   await authorize();const enrolled=grant(workspaceId);await verifyArtifacts();await authorize();
   const output=await boundedCommand(path.join(installationRoot,"bin/source-capture"),[],JSON.stringify({protocolVersion:"gsa-source-capture-v1",canonicalRoot:enrolled.canonicalRoot,maxBytes:MAX_SOURCE,excludeNames:[".git","node_modules","dist","local-state",".continue"]}),7*1024*1024,45000,options.ownerLockFD);
   await authorize();const raw=object(JSON.parse(output.toString("utf8")));const identity=object(raw.rootIdentity);
   const pinned=(enrolled as typeof enrolled&{rootIdentity?:{device:string;inode:string}}).rootIdentity;
   if(!pinned||!Number.isSafeInteger(identity.device)||!Number.isSafeInteger(identity.inode)||String(identity.device)!==pinned.device||String(identity.inode)!==pinned.inode||grant(workspaceId).revision!==enrolled.revision)blocked("SOURCE_UNVERIFIED");
   return {source:filterMacVmSourceSnapshot(raw,enrolled.canonicalRoot),enrolled};
  }
  async function executeRun(run:Run):Promise<SandboxedProcessReceipt>{
   let scratch:string|undefined;let timer:NodeJS.Timeout|undefined;let poll:NodeJS.Timeout|undefined;let forceStop:NodeJS.Timeout|undefined;
   try{
    await run.authorize();
    const captured=run.source?{source:run.source,enrolled:grant(run.request.workspace_id)}:await snapshot(run.request.workspace_id,run.authorize);
    const {source,enrolled}=captured;
    if(run.stopRequested){run.clean=true;return {exit_code:null,signal:null,stdout:"",stderr:"",cancelled:true,timed_out:false};}
    scratch=await fs.mkdtemp(path.join(installationRoot,"run-"));await fs.chmod(scratch,0o700);
    const sourcePath=path.join(scratch,"snapshot.json");await fs.writeFile(sourcePath,JSON.stringify(source),{mode:0o600,flag:"wx"});
    const nonce=randomBytes(32).toString("hex");
    const seed=object(JSON.parse((await boundedCommand("/usr/bin/python3",[path.join(installationRoot,"scripts/prepare-vm-worker-seed.py"),path.join(scratch,"seed"),nonce,run.request.workspace_id,sourcePath],"",16384,45000,options.ownerLockFD)).toString("utf8")));
    if(typeof seed.seedImagePath!=="string"||seed.seedImagePath!==path.join(scratch,"worker-seed.iso")||!Number.isSafeInteger(seed.seedBytes)||seed.seedBytes<4096||seed.seedBytes>16777216||typeof seed.seedSHA256!=="string"||!/^[a-f0-9]{64}$/.test(seed.seedSHA256))blocked("seed receipt");
    await run.authorize();if(grant(run.request.workspace_id).revision!==enrolled.revision)blocked("grant changed");
    if(run.stopRequested){run.clean=true;return {exit_code:null,signal:null,stdout:"",stderr:"",cancelled:true,timed_out:false};}
    await verifyArtifacts();
    await run.authorize();
    return await new Promise<SandboxedProcessReceipt>((resolve,reject)=>{
     if(grant(run.request.workspace_id).revision!==enrolled.revision)blocked("grant changed before VM start");
     const proc=child(path.join(installationRoot,"bin/worker-host"),[],options.ownerLockFD);run.proc=proc;
     let buffered=Buffer.alloc(0),total=0,diagnostics=0;let ready=false,started=false,executeSent=false,shutdown=false,clean=false;let receipt:SandboxedProcessReceipt|undefined;let failure:Error|undefined;
     function send(value:object){proc.stdin.write(JSON.stringify(value)+"\n");}
     function abort(reason:string){
      failure??=new RuntimeBlocked(reason);run.stopRequested=true;proc.kill("SIGTERM");
      // A forced host termination never sets clean=true or yields a receipt.
      forceStop??=setTimeout(()=>proc.kill("SIGKILL"),15000);
     }
     timer=setTimeout(()=>abort("VM supervisor deadline"),200000);
     let checking=false;
     poll=setInterval(()=>{
      if(checking)return;checking=true;
      void (async()=>{await run.authorize();if(grant(run.request.workspace_id).revision!==enrolled.revision)blocked("grant revoked or changed");})().catch(()=>abort("controller or grant revoked/expired")).finally(()=>{checking=false;});
     },100);
     proc.stdin.on("error",()=>{});proc.on("error",e=>{failure=e;});
     proc.stderr.on("data",(data:Buffer)=>{diagnostics+=data.length;if(diagnostics>65536)abort("VM diagnostic cap");});
     proc.stdout.on("data",(data:Buffer)=>{
      try{
       total+=data.length;if(total>10*1024*1024)blocked("VM transcript cap");buffered=Buffer.concat([buffered,data]);if(buffered.length>8*1024*1024+65536)blocked("VM frame cap");
       while(buffered.includes(10)){
        const end=buffered.indexOf(10),frame=object(JSON.parse(buffered.subarray(0,end).toString("utf8")));buffered=buffered.subarray(end+1);
        if(frame.nonce!==nonce||frame.workspace_id!==run.request.workspace_id)blocked("VM frame identity");
        if(frame.protocol==="gsa-vm-host-v1"){
         if(frame.type==="started"){if(started||frame.host_shares!==0||frame.network_devices!==0)blocked("VM configuration");started=true;}
         else if(frame.type==="stopped"){clean=frame.clean===true;run.clean=clean;if(!clean)blocked("VM stop unverified");}
         else if(frame.type!=="guest-log")blocked("VM host failure");
         continue;
        }
        if(frame.protocol!=="gsa-vm-worker-v1"||!started)blocked("VM protocol");
        if(frame.type==="ready"){
         if(ready||frame.seq!==0)blocked("duplicate VM ready");ready=true;run.status={...run.status,state:"RUNNING"};
         void run.authorize().then(()=>{
          if(run.stopRequested||grant(run.request.workspace_id).revision!==enrolled.revision)blocked("grant changed before guest execution");
          executeSent=true;send({...run.request,protocol:"gsa-vm-worker-v1",type:"request",nonce,seq:1,method:"execute"});
         }).catch(()=>abort("controller denied guest execution"));
        }else if(frame.type==="result"&&frame.seq===1&&ready&&executeSent&&!receipt){
         const r=object(frame.result);
         if(r.source_verified!==true||!(r.exit_code===null||Number.isInteger(r.exit_code))||!(r.signal===null||(Number.isInteger(r.signal)&&r.signal>0&&r.signal<128))||typeof r.stdout!=="string"||typeof r.stderr!=="string"||typeof r.cancelled!=="boolean"||typeof r.timed_out!=="boolean"||typeof r.output_limited!=="boolean"||Buffer.byteLength(r.stdout)+Buffer.byteLength(r.stderr)>run.request.max_output_bytes)blocked("VM result integrity");
         const signal=r.signal===null?null:Object.entries(os.constants.signals).find(([,number])=>number===r.signal)?.[0]??`SIG${r.signal}`;
         receipt={exit_code:r.exit_code,signal,stdout:r.stdout,stderr:r.stderr,cancelled:r.cancelled,timed_out:r.timed_out,output_limited:r.output_limited,...validateMacVmArtifacts(run.request,r)};
         shutdown=true;send({protocol:"gsa-vm-worker-v1",type:"request",nonce,workspace_id:run.request.workspace_id,seq:2,method:"shutdown"});
        }else if(!(frame.type==="result"&&frame.seq===2&&shutdown&&frame.result?.shutdown===true))blocked("VM guest failure");
       }
      }catch(e){abort(e instanceof Error?e.message:"VM protocol failure");}
     });
     proc.on("close",code=>{
      if(timer)clearTimeout(timer);if(poll)clearInterval(poll);if(forceStop)clearTimeout(forceStop);
      if(failure)return reject(failure);
      if(!clean||code!==0||buffered.length) return reject(new RuntimeBlocked("VM clean stop missing"));
      if(run.stopRequested)return resolve({exit_code:null,signal:null,stdout:receipt?.stdout??"",stderr:receipt?.stderr??"",cancelled:true,timed_out:false});
      if(!receipt||!shutdown)return reject(new RuntimeBlocked("VM result missing"));
      void run.authorize().then(()=>{if(grant(run.request.workspace_id).revision!==enrolled.revision)blocked("grant changed");resolve(receipt!);}).catch(reject);
     });
     send({protocolVersion:"gsa-vm-host-v1",workspaceID:run.request.workspace_id,nonce,imagePath:install.imagePath,expectedSHA256:install.imageSHA256,expectedBytes:install.imageBytes,...seed,timeoutSeconds:180});
    });
   }finally{
    if(timer)clearTimeout(timer);if(poll)clearInterval(poll);if(forceStop)clearTimeout(forceStop);
    if(scratch&&(!run.proc||run.clean))await fs.rm(scratch,{recursive:true,force:true});
   }
  }
  function begin(request:SandboxedProcessRequest,source?:SourceSnapshot,authorize=authorization(request.workspace_id)):Run{
   validateRequest(request);grant(request.workspace_id);
   if(active>=2)blocked("native process quota");active++;
   const id=randomUUID();const run:Run={id,request:{...request,argv:[...request.argv]},authorize,source,status:{state:"QUEUED",started_at:new Date().toISOString(),ended_at:null,exit_code:null},done:null!,stopRequested:false,clean:false};
   runs.set(id,run);
   run.done=executeRun(run).then(receipt=>{run.receipt=receipt;run.status={...run.status,state:receipt.cancelled?"CANCELLED":receipt.exit_code===0&&!receipt.timed_out&&!receipt.output_limited?"SUCCEEDED":"FAILED",exit_code:receipt.exit_code,ended_at:new Date().toISOString()};return receipt;},failure=>{run.failure=failure;run.status={...run.status,state:"UNKNOWN",ended_at:new Date().toISOString()};throw failure;}).finally(()=>{if(!run.proc||run.clean)active--;pruneHistory();});
   void run.done.catch(()=>{});return run;
  }
  function owned(id:string){const run=runs.get(id);if(!run)throw Object.assign(new Error("Native process not found or terminal history expired"),{code:"PROCESS_NOT_FOUND"});return run;}
  async function stop(run:Run){
   if(run.status.ended_at)return {stopped:run.clean,state:run.status.state};
   run.stopRequested=true;run.proc?.kill("SIGTERM");
   let timeout:NodeJS.Timeout|undefined;
   await Promise.race([run.done.catch(()=>{}),new Promise<void>(resolve=>{timeout=setTimeout(resolve,15000);})]);if(timeout)clearTimeout(timeout);
   return {stopped:run.clean&&run.status.ended_at!==null,state:run.status.state};
  }
  const sandbox:VerifiedNativeSandbox={platform:"macos",verified:true,policy_fingerprint:fingerprint,execute:async req=>{const authorize=authorization(req.workspace_id);await authorize();return begin(req,undefined,authorize).done;},cancel:async(id,workspace)=>{const run=[...runs.values()].find(r=>r.request.process_id===id&&r.request.workspace_id===workspace);return run?(await stop(run)).stopped:false;}};
  const processes:VerifiedNativeProcessController={platform:"macos",verified:true,policy_fingerprint:fingerprint,
   start:async req=>{const authorize=authorization(req.workspace_id);await authorize();return {native_id:begin(req,undefined,authorize).id};},
   status:async id=>{const run=owned(id);return {...run.status,stopped:run.status.ended_at!==null&&(!run.proc||run.clean)};},stop:async id=>stop(owned(id)),
   wait:async id=>{const run=owned(id);await run.done.catch(()=>{});return {...run.status,stopped:run.status.ended_at!==null&&(!run.proc||run.clean)};},
   output:async(id,cursor,limit)=>{
    if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>65536)blocked("invalid output range");
    const run=owned(id),stdout=Buffer.from(run.receipt?.stdout??""),stderr=Buffer.from(run.receipt?.stderr??"");const all=Buffer.concat([stdout,stderr]);
    if(cursor>all.length||(cursor<all.length&&(all[cursor]&0xc0)===0x80))blocked("output cursor outside stream");const end=Math.min(all.length,cursor+limit);
    // Latin ASCII guest output and UTF-8 are paged only at complete character boundaries.
    let boundary=end;while(boundary>cursor&&boundary<all.length&&(all[boundary]&0xc0)===0x80)boundary--;
    if(boundary===cursor&&end>cursor)blocked("output limit splits UTF-8 character");
    const out=all.subarray(cursor,Math.min(boundary,stdout.length)).toString("utf8");
    const err=all.subarray(Math.max(cursor,stdout.length),boundary).toString("utf8");
    return {stdout:out,stderr:err,next_cursor:boundary<all.length?boundary:null};
   }};
  const sourceCapture:VerifiedWorkspaceSourceCapture={platform:"macos",verified:true,policy_fingerprint:fingerprint,capture:async id=>(await snapshot(id)).source.files.map(f=>({path:f.path,bytes:Buffer.from(f.base64,"base64")}))};
  return {sandbox,processes,sourceCapture,executeSnapshot:async(request,entries)=>{
   const authorize=authorization(request.workspace_id);await authorize();
   const enrolled=grant(request.workspace_id);
   if(!Array.isArray(entries)||entries.length>1000)blocked("snapshot file count");
   let totalBytes=0;const files=entries.map(entry=>{
    if(!(entry.bytes instanceof Uint8Array))blocked("invalid snapshot bytes");totalBytes+=entry.bytes.length;if(totalBytes>MAX_SOURCE)blocked("snapshot byte quota");
    const bytes=Buffer.from(entry.bytes);return {path:entry.path,base64:bytes.toString("base64"),size:bytes.length,sha256:sha(bytes),executable:false};
   });
   const source=filterMacVmSourceSnapshot({protocolVersion:"gsa-source-capture-v1",state:"CAPTURED",canonicalRoot:enrolled.canonicalRoot,files,totalBytes,securityVerified:false},enrolled.canonicalRoot);
   return begin(request,source,authorize).done;
  }};
 }catch(error){if(error instanceof RuntimeBlocked)throw error;throw new RuntimeBlocked(error instanceof Error?error.message:"installation rejected");}
}
