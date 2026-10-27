#!/usr/bin/env node
// Test-only, import-safe, one-slot recovery containment fixture.
// No native execution is authorized by this file or its acknowledgement flag.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";
import {createHash,createHmac,randomBytes,randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";

let candidate;

const source=fileURLToPath(new URL("../native/macos-files/recovery-broker.swift",import.meta.url));
const sourceHash="d31392926056ce369999ee48ccc4c3ce47a715a25e3db972da015b496407e14f";
const launcher=fileURLToPath(new URL("./macos-owner-launcher.py",import.meta.url));
const script=fileURLToPath(import.meta.url);
const protocol="gsa-file-recovery-v1";
const maxOutput=1024*1024;
const timeoutMs=30000;
const sha=(data)=>createHash("sha256").update(data).digest("hex");
const ident=(s)=>({device:String(s.dev),inode:String(s.ino)});
const xmlEscape=(s)=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");
function plist(value){
 const rows=Object.entries(value).map(([key,item])=>`<key>${xmlEscape(key)}</key>${typeof item==="boolean"?`<${item?"true":"false"}/>`:typeof item==="number"?`<integer>${item}</integer>`:Array.isArray(item)?`<array>${item.map(x=>`<string>${xmlEscape(x)}</string>`).join("")}</array>`:`<string>${xmlEscape(item)}</string>`}`).join("");
 return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${rows}</dict></plist>\n`;
}
function run(executable,args,input="",max=65536,ownerLockFD,inheritEnv=false,commandTimeout=timeoutMs){
 return new Promise((resolve,reject)=>{
  const env=inheritEnv?process.env:{PATH:"/usr/bin:/bin",HOME:"/var/empty",LANG:"C",TMPDIR:"/private/tmp"};
  const child=spawn(executable,args,{shell:false,env,stdio:ownerLockFD===undefined?["pipe","pipe","pipe"]:["pipe","pipe","pipe",ownerLockFD]});
  let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),failure,closed=false;
  const timer=setTimeout(()=>{failure=Error(`TIMEOUT ${executable}`);child.kill("SIGKILL");},commandTimeout);
  child.stdout.on("data",chunk=>{if(stdout.length+chunk.length>max){failure=Error(`STDOUT_LIMIT ${executable}`);child.kill("SIGKILL");}else stdout=Buffer.concat([stdout,chunk]);});
  child.stderr.on("data",chunk=>{if(stderr.length+chunk.length>65536){failure=Error(`STDERR_LIMIT ${executable}`);child.kill("SIGKILL");}else stderr=Buffer.concat([stderr,chunk]);});
  child.on("error",error=>{failure=error;});
  child.on("close",code=>{closed=true;clearTimeout(timer);if(failure)return reject(failure);if(code!==0)return reject(Error(`COMMAND_FAILED ${executable} ${JSON.stringify(args)} exit=${code} stderr=${stderr.toString("utf8").slice(0,1200)}`));resolve(stdout);});
  child.stdin.on("error",()=>{});child.stdin.end(input);
  // Keep the promise pending until close, including after timeout/overflow kill.
  void closed;
 });
}
async function protectedRead(file,max){
 const before=await fs.lstat(file);
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.uid!==process.getuid()||(before.mode&0o077)!==0||before.size>max)throw Error(`unsafe test installation file ${file}`);
 const handle=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const opened=await handle.stat();if(opened.dev!==before.dev||opened.ino!==before.ino)throw Error(`test installation changed ${file}`);
  const bytes=Buffer.alloc(before.size+1);let offset=0;while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
  const after=await handle.stat();if(offset!==before.size||after.ctimeMs!==before.ctimeMs||after.mtimeMs!==before.mtimeMs)throw Error(`test installation changed ${file}`);
  return bytes.subarray(0,offset);
 }finally{await handle.close();}
}
async function protectedDirectory(dir){
 const s=await fs.lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||![0,process.getuid()].includes(s.uid)||(s.mode&0o777)!==0o700||await fs.realpath(dir)!==dir)throw Error(`unsafe test installation directory ${dir}`);
}
async function fixtureRoot(){
 const root=process.env.GSA_NATIVE_FIXTURE_ROOT;if(!root)throw Error("missing isolated fixture root");
 if(!root.startsWith("/private/tmp/gsa-recovery-held-parent-")||await fs.realpath(root)!==root)throw Error("fixture root is not canonical private temporary storage");
 const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700)throw Error("unsafe fixture root");
 return root;
}
async function actualOwnerCheck(root){
 const identity=path.join(root,"owner");
 if(process.env.GSA_OWNER_LOCK_FD!=="3"||process.env.GSA_OWNER_IDENTITY!==identity)throw Error("isolated FD3 owner environment missing");
 const result=await run("/usr/bin/python3",[launcher,"--identity",identity,"--verify"],"",4096,3,true);
 const owner=JSON.parse(result.toString("utf8"));if(owner.format!=="gsa-owner-v1"||owner.session!==process.env.GSA_OWNER_SESSION)throw Error("isolated FD3 owner verification failed");
}

import {reserveAttempt,createInvocationBudget,parseObserverHit,checkEligibility,createChildLifecycle} from "./mac-recovery-probe-control.mjs";

export async function inspectSettled(adapter,lifecycle,id){
 lifecycle.assertIdle();
 return adapter.readTransaction(id);
}

const reservation=fileURLToPath(new URL('../docs/reports/.recovery-parent-probe-20261023/attempt.json',import.meta.url));
const ack='--ack-existing-five-plus-one';
export async function getPlan(){
 return {status:'REQUIRES_REVIEW_AND_USER_EXTENSION',nativeExecution:false,approvalRequired:true,
  mutationInvocations:1,inspectInvocations:1,historicalAttempts:5,attemptReservation:reservation,
  source_sha256:sha(await fs.readFile(source)),expected_source_sha256:sourceHash,
  candidate:'fresh private unchanged-source build; old binary is absent; no old-binary certification',
  command:'node scripts/test-mac-recovery-parent-probe.mjs --run-one '+ack};
}
export function classifyObservation({relocated,preserved,unchanged,captured,reportedEffect,nativeInspectExecuted,inspectDidNotMutate,receiptsValid}){
 if(unchanged===false||relocated&&reportedEffect===true)return 'BLOCKING_OUTSIDE_EFFECT';
 if(!relocated)return 'INCONCLUSIVE';
 if(!preserved||!unchanged||captured||reportedEffect||!inspectDidNotMutate)return 'BLOCKING_OUTSIDE_EFFECT';
 if(receiptsValid!==true)return 'UNVERIFIED_NATIVE_RECEIPT';
 return nativeInspectExecuted?'OBSERVED_OUTSIDE_PRESERVED':'UNVERIFIED_NATIVE_INSPECT_NOT_EXECUTED';
}
export function validateReceipt(value,request){
 const keys=['ok','protocol','transaction_id','status','intent','observations','retained_handles','reason'];
 const exact=(o,allowed)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>allowed.includes(k));
 if(!exact(value,keys)||keys.some(k=>!Object.hasOwn(value,k))||value.ok!==true||value.protocol!==protocol||value.transaction_id!==request.transaction_id||!['APPLIED','CONFLICT','UNKNOWN'].includes(value.status)||typeof value.reason!=='string')return false;
 const intent=value.intent,ik=['protocol','transaction_id','operation','workspace_id','revision','path','expected_sha256','after_sha256'];
 if(!exact(intent,ik)||ik.some(k=>!Object.hasOwn(intent,k)))return false;
 for(const key of ['protocol','transaction_id','workspace_id','revision','path','expected_sha256'])if(intent[key]!==request[key])return false;
 if(intent.operation!=='replace'||intent.after_sha256!==sha(Buffer.from(request.base64,'base64')))return false;
 const observations=value.observations,booleans=['captured','published','source_absent','destination_present','restored_exclusively'],hashes=['source_sha256','destination_sha256','captured_sha256'],identities=['capturedIdentity','publishedIdentity'];
 if(!exact(observations,[...booleans,...hashes,...identities]))return false;
 for(const k of booleans)if(Object.hasOwn(observations,k)&&typeof observations[k]!=='boolean')return false;
 for(const k of hashes)if(Object.hasOwn(observations,k)&&!/^[a-f0-9]{64}$/.test(observations[k]))return false;
 for(const k of identities)if(Object.hasOwn(observations,k)&&(!exact(observations[k],['device','inode'])||!['device','inode'].every(f=>typeof observations[k][f]==='string'&&/^\d{1,32}$/.test(observations[k][f]))))return false;
 return Array.isArray(value.retained_handles)&&value.retained_handles.length<=1&&value.retained_handles.every(id=>id===request.transaction_id);
}
// This observer is a separate process. It never instruments the broker. The
// PID, parent PID, process birth tuple and vnode FD are checked before SIGSTOP.
export const observerSource=String.raw`import Darwin
import Foundation
let a=CommandLine.arguments
guard a.count>=4,let pid=Int32(a[2]),let parent=UInt32(a[3]) else{exit(64)}
func processRecord()->[String:Any]? {
 var b=proc_bsdinfo();let size=MemoryLayout<proc_bsdinfo>.size
 guard proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&b,Int32(size))==size,b.pbi_pid==UInt32(pid),b.pbi_ppid==parent else{return nil}
 return ["pid":Int(pid),"parentPid":Int(parent),"startTime":"\(b.pbi_start_tvsec):\(b.pbi_start_tvusec)"]
}
func emit(_ value:[String:Any]){guard let bytes=try? JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]) else{exit(70)};FileHandle.standardOutput.write(bytes);FileHandle.standardOutput.write(Data([10]))}
if a[1]=="identity"{guard let b=processRecord() else{exit(5)};emit(b);exit(0)}
guard a.count==7,let dev=UInt32(a[5]),let ino=UInt64(a[6]) else{exit(64)}
func sameProcess()->Bool{guard let b=processRecord() else{return false};return b["startTime"] as? String==a[4]}
func matching(_ wanted:Int32?=nil)->Int32? {
 guard sameProcess() else{return nil}
 let n=proc_pidinfo(pid,PROC_PIDLISTFDS,0,nil,0);guard n>0 && n<65536 else{return nil}
 var list=[UInt8](repeating:0,count:Int(n))
 let got=list.withUnsafeMutableBytes{proc_pidinfo(pid,PROC_PIDLISTFDS,0,$0.baseAddress,n)}
 let stride=MemoryLayout<proc_fdinfo>.size;guard got>=stride else{return nil}
 for off in Swift.stride(from:0,to:Int(got)-stride+1,by:stride){
  let fd=list.withUnsafeBytes{$0.loadUnaligned(fromByteOffset:off,as:proc_fdinfo.self)}.proc_fd
  if let wanted = wanted,fd != wanted{continue}
  let infoCount=MemoryLayout<vnode_fdinfo>.size
  var info=[UInt8](repeating:0,count:infoCount)
  let size=info.withUnsafeMutableBytes{proc_pidfdinfo(pid,fd,PROC_PIDFDVNODEINFO,$0.baseAddress,Int32(infoCount))}
  if size>=MemoryLayout<proc_fileinfo>.size+MemoryLayout<vinfo_stat>.size{
   let s=info.withUnsafeBytes{$0.loadUnaligned(fromByteOffset:MemoryLayout<proc_fileinfo>.size,as:vinfo_stat.self)}
   if s.vst_dev==dev && s.vst_ino==ino{return fd}
  }
 }
 return nil
}
if a[1].hasPrefix("confirm:"){
 guard let wanted=Int32(a[1].dropFirst(8)),sameProcess(),let fd=matching(wanted) else{exit(5)}
 emit(["pid":Int(pid),"parentPid":Int(parent),"startTime":a[4],"fd":Int(fd),"device":String(dev),"inode":String(ino)]);exit(0)
}
guard a[1]=="watch" else{exit(64)}
let until=Date().addingTimeInterval(4)
while Date()<until{
 guard sameProcess() else{exit(5)}
 if let fd=matching(),sameProcess(){guard kill(pid,SIGSTOP)==0 else{exit(6)};emit(["pid":Int(pid),"parentPid":Int(parent),"startTime":a[4],"fd":Int(fd),"device":String(dev),"inode":String(ino)]);exit(0)}
 usleep(200)
}
exit(2)
`;
async function recordTree(root){
 const rows=[];let count=0;
 async function visit(directory,relative=''){
  for(const name of (await fs.readdir(directory)).sort()){
   if(++count>128)throw Error('FIXTURE_TREE_LIMIT');
   const file=path.join(directory,name),rel=relative?relative+'/'+name:name,s=await fs.lstat(file,{bigint:true});
   if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile()))throw Error('UNEXPECTED_FIXTURE_ENTRY');
   if(s.isDirectory()){rows.push({path:rel,kind:'directory',...ident(s)});await visit(file,rel);}
   else{if(s.size>16n*1024n*1024n)throw Error('FIXTURE_FILE_LIMIT');rows.push({path:rel,kind:'file',...ident(s),size:Number(s.size),sha256:sha(await fs.readFile(file))});}
  }
 }
 await visit(root);return rows;
}
async function snapshotSource(file){
 try{const s=await fs.lstat(file,{bigint:true});if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.size>8n*1024n*1024n)throw Error('UNSAFE_FIXTURE_SOURCE');return {exists:true,...ident(s),sha256:sha(await fs.readFile(file))};}
 catch(e){if(e.code==='ENOENT')return {exists:false};throw e;}
}
async function runChecked(){
 const root=await fixtureRoot();await actualOwnerCheck(root);
 candidate=path.join(root,'candidate');
 const build=JSON.parse((await protectedRead(path.join(root,'build.json'),16384)).toString());
 if(sha(await fs.readFile(source))!==sourceHash||build.source_sha256!==sourceHash||sha(await protectedRead(candidate,16*1024*1024))!==build.candidate_sha256)throw Error('FRESH_CANDIDATE_BINDING_MISMATCH');
 const observer=path.join(root,'fd-observer');
 if(sha(await protectedRead(observer,16*1024*1024))!==build.observer_sha256)throw Error('OBSERVER_BINDING_MISMATCH');
 const [{WorkspaceRegistry},{loadCheckedMacRecoveryInstallation}]=await Promise.all([
  import("../dist/src/core/workspace.js"),import("../dist/src/hosts/macos-recovery-installation.js")
 ]);
 const base=await fs.realpath(await fs.mkdtemp(path.join(root,"case-")));await fs.chmod(base,0o700);
 const baseStat=await fs.lstat(base),work=path.join(base,"workspace"),recovery=path.join(base,"recovery"),installation=path.join(base,"installation");

  for(const directory of [work,recovery,installation])await fs.mkdir(directory,{mode:0o700});
  const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:"work",root:work,role:"workspace"}]);
  const grant=registry.list().find(g=>g.id==="work");if(!grant)throw Error("workspace grant missing");
  const workIdentity=grant.rootIdentity,recoveryIdentity=ident(await fs.stat(recovery,{bigint:true}));
  if(workIdentity.device!==recoveryIdentity.device)throw Error("disposable roots unexpectedly on different volumes");
  const app=path.join(installation,"work","RecoveryBroker.app"),contents=path.join(app,"Contents"),macos=path.join(contents,"MacOS"),signature=path.join(contents,"_CodeSignature");
  for(const directory of [path.join(installation,"work"),app,contents,macos,signature])await fs.mkdir(directory,{mode:0o700});
  const binary=path.join(macos,"recovery-broker");await fs.copyFile(candidate,binary);await fs.chmod(binary,0o500);
  const info={CFBundleIdentifier:"local.gsa.recovery.disposable",CFBundleName:"RecoveryBroker",CFBundleExecutable:"recovery-broker",CFBundlePackageType:"APPL",GSARecoveryProtocol:protocol,GSAWorkspaceRoot:work,GSARecoveryRoot:recovery,GSAWorkspaceID:"work",GSARevision:grant.revision,GSADevice:workIdentity.device,GSAInode:workIdentity.inode,GSARecoveryDevice:recoveryIdentity.device,GSARecoveryInode:recoveryIdentity.inode};
  const infoPath=path.join(contents,"Info.plist");await fs.writeFile(infoPath,plist(info),{mode:0o600,flag:"wx"});
  const entitlementsPath=path.join(base,"entitlements.plist");
  await fs.writeFile(entitlementsPath,plist({"com.apple.security.app-sandbox":true,"com.apple.security.temporary-exception.files.absolute-path.read-write":[work+"/",recovery+"/"]}),{mode:0o600,flag:"wx"});
  await run("/usr/bin/codesign",["--force","--deep","--sign","-","--entitlements",entitlementsPath,app],"",65536);
  await run("/usr/bin/codesign",["--verify","--deep","--strict",app],"",65536);
  // The checked loader requires owner-only app directories and files; apply the
  // modes before taking artifact digests, then confirm the signature still verifies.
  for(const directory of [app,contents,macos,signature])await fs.chmod(directory,0o700);
  for(const file of [binary,infoPath,path.join(signature,"CodeResources")])await fs.chmod(file,file===binary?0o500:0o600);
  await run("/usr/bin/codesign",["--verify","--deep","--strict",app],"",65536);
  const artifactPaths={"Contents/MacOS/recovery-broker":binary,"Contents/Info.plist":infoPath,"Contents/_CodeSignature/CodeResources":path.join(signature,"CodeResources")};
  const artifacts={};for(const [name,file] of Object.entries(artifactPaths))artifacts[name]=sha(await protectedRead(file,16*1024*1024));
  const proofKey=randomBytes(32);await fs.writeFile(path.join(installation,"proof-key"),proofKey,{mode:0o600,flag:"wx"});
  const proof={format:"gsa-scoped-files-v1",hostRelease:os.release(),arch:process.arch,grants:[{id:"work",root:work,rootIdentity:workIdentity,revision:grant.revision,artifacts:{},recovery:{root:recovery,rootIdentity:recoveryIdentity,artifacts}}]};
  const body=JSON.stringify(proof),hmac=createHmac("sha256",proofKey).update(body).digest("hex");
  await fs.writeFile(path.join(installation,"install.json"),JSON.stringify({body,hmac}),{mode:0o600,flag:"wx"});

  const held=path.join(work,'held-'+randomUUID()),outside=path.join(base,'outside');
  await fs.mkdir(held,{mode:0o700});await fs.mkdir(outside,{mode:0o700});
  const itemName='item-'+randomUUID()+'.txt',item=path.join(held,itemName),relative=path.relative(work,item);
  const originalBytes=Buffer.from('original recovery containment fixture\n');await fs.writeFile(item,originalBytes,{mode:0o600,flag:'wx'});
  const original=await snapshotSource(item),parentIdentity=ident(await fs.stat(held,{bigint:true}));
  const canaries=[path.join(work,'neighbor.txt'),path.join(recovery,'neighbor.txt'),path.join(outside,'neighbor.txt')];
  for(const c of canaries)await fs.writeFile(c,'independent-canary:'+path.basename(path.dirname(c)),{mode:0o600,flag:'wx'});
  const beforeCanaries=await Promise.all(canaries.map(async p=>({path:p,...await snapshotSource(p)})));
  const relocated=path.join(outside,'relocated-'+randomUUID()),movedItem=path.join(relocated,itemName),budget=createInvocationBudget();
  const report={format:'gsa-recovery-parent-observation-v1',state:'INCONCLUSIVE',build,fixture:base,original,parentIdentity,relative,relocated,operations:[],events:[],native:[],canariesBefore:beforeCanaries,activation:false};
  let activeChild,activeIdentity,mutationRequest;
  const lifecycle=createChildLifecycle();
  const identify=async child=>JSON.parse((await run(observer,['identity',String(child.pid),String(process.pid)],'',4096,undefined,false,250)).toString());
  const stillOwned=async child=>{
   if(child.exitCode!==null||child.signalCode!==null)return false;
   try{const p=await identify(child);return p.pid===child.pid&&p.parentPid===process.pid&&p.startTime===activeIdentity?.startTime;}catch{return false;}
  };
  async function signalOwned(child,signal){
   if(child.exitCode!==null||child.signalCode!==null)return false;
   try{
    const parent=Number((await run('/bin/ps',['-p',String(child.pid),'-o','ppid='],'',4096,undefined,false,250)).toString().trim());
    const executable=(await run('/bin/ps',['-p',String(child.pid),'-o','comm='],'',4096,undefined,false,250)).toString().trim();
    if(parent!==process.pid||await fs.realpath(executable)!==await fs.realpath(binary))return false;
    if(activeIdentity&&!await stillOwned(child))return false;
    return child.kill(signal);
   }catch{return false;}
  }
  async function resumeOwned(){if(activeChild&&await signalOwned(activeChild,'SIGCONT'))report.events.push({event:'owned-resume',at:Date.now()});}
  async function brokerCommand(executable,args,input,max,ownerLockFD){
   if(executable==='/usr/bin/codesign'||executable==='/usr/bin/plutil')return run(executable,args,input,max);
   if(executable!==binary||args.length||ownerLockFD!==3)throw Error('UNEXPECTED_RECOVERY_COMMAND');
   lifecycle.assertIdle();
   const q=JSON.parse(input);budget.consume(q.operation);report.operations.push(q.operation);
   if(q.operation==='replace'){
    mutationRequest=q;
    // Durable slot is consumed before spawn, including spawn/observer failure.
    await reserveAttempt(reservation,{format:'gsa-recovery-one-slot-v1',historicalAttempts:5,newAttempt:1,at:new Date().toISOString(),transaction_id:q.transaction_id,fixture:base,build,script_sha256:sha(await fs.readFile(script))});
   }
   let out=Buffer.alloc(0),err=Buffer.alloc(0),failure,killTimer,terminating=false;
   lifecycle.beforeLaunch();
   let child;
   try{child=spawn(executable,args,{shell:false,env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'},stdio:['pipe','pipe','pipe',3]});}
   catch(e){lifecycle.markCleanupUnverified();throw e;}
   activeChild=child;activeIdentity=undefined;
   const receipt={operation:q.operation,transaction_id:q.transaction_id,request_sha256:sha(Buffer.from(input)),request_bytes:Buffer.byteLength(input),pid:child.pid??null};report.native.push(receipt);
   const closed=new Promise(resolve=>{child.on('error',e=>{failure=e;});child.on('close',(code,signal)=>{lifecycle.confirmClosed();resolve({code,signal});});});
   const deadline=Date.now()+30000;
   async function boundedClose(){
    let limit;
    try{return await Promise.race([closed,new Promise((_,reject)=>{limit=setTimeout(()=>reject(Error('OWNED_CHILD_CLEANUP_UNVERIFIED')),Math.max(1,deadline-Date.now()));})]);}
    catch(e){lifecycle.markCleanupUnverified();throw e;}
    finally{clearTimeout(limit);}
   }
   const terminate=async()=>{
    if(terminating)return;terminating=true;
    await signalOwned(child,'SIGCONT');await signalOwned(child,'SIGTERM');
    killTimer=setTimeout(()=>{void signalOwned(child,'SIGKILL');},750);
   };
   child.stdout.on('data',b=>{if(out.length+b.length>max){failure=Error('NATIVE_OUTPUT_LIMIT');void terminate();}else out=Buffer.concat([out,b]);});
   child.stderr.on('data',b=>{if(err.length+b.length>65536){failure=Error('NATIVE_DIAGNOSTIC_LIMIT');void terminate();}else err=Buffer.concat([err,b]);});
   child.stdin.on('error',()=>{});
   const timer=setTimeout(()=>{failure=Error('NATIVE_TIMEOUT');void terminate();},26000);
   try{
    if(q.operation==='replace'){
     activeIdentity=await identify(child);assert.equal(activeIdentity.parentPid,process.pid);
     child.stdin.end(input);
     try{
      const hit=JSON.parse((await run(observer,['watch',String(child.pid),String(process.pid),activeIdentity.startTime,parentIdentity.device,parentIdentity.inode],'',4096,undefined,false,5000)).toString());
      const state=(await run('/bin/ps',['-p',String(child.pid),'-o','state='],'',4096,undefined,false,250)).toString().trim();
      const confirmation=JSON.parse((await run(observer,['confirm:'+hit.fd,String(child.pid),String(process.pid),activeIdentity.startTime,parentIdentity.device,parentIdentity.inode],'',4096,undefined,false,250)).toString());
      const processIdentity={pid:child.pid,startTime:activeIdentity.startTime};
      const normalized={format:'libproc-owned-pid-fd-v1',pid:child.pid,processIdentity,fd:hit.fd,parentIdentity:{device:hit.device,inode:hit.inode},stop:{pid:child.pid,processIdentity,signal:'SIGSTOP',state},confirmation:{pid:confirmation.pid,processIdentity:{pid:confirmation.pid,startTime:confirmation.startTime},fd:confirmation.fd,parentIdentity:{device:confirmation.device,inode:confirmation.inode}}};
      parseObserverHit(JSON.stringify(normalized),{pid:child.pid,device:parentIdentity.device,inode:parentIdentity.inode,processIdentity});
      report.observer={hit,state,confirmation,normalized};
      const capturedExists=await fs.lstat(path.join(recovery,q.transaction_id,'captured')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
      const eligibility=checkEligibility({original,observed:await snapshotSource(item),capturedExists,stopped:/^T/.test(state),processMatches:await stillOwned(child),fdMatches:true});report.eligibility=eligibility;
      if(eligibility.eligible){
       assert.equal(await fs.lstat(relocated).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}),false);
       report.events.push({event:'eligible-before-relocation',at:Date.now()});await fs.rename(held,relocated);
       assert.deepEqual(ident(await fs.stat(relocated,{bigint:true})),parentIdentity);report.relocated=true;report.events.push({event:'parent-relocated',at:Date.now()});
      }
     }catch(e){report.observerFailure=String(e.message);}
     finally{await resumeOwned();}
    }else child.stdin.end(input);
    const exit=await boundedClose();Object.assign(receipt,exit,{stdout:out.toString(),stderr:err.toString(),failure:failure?.message??null});
    if(failure||exit.code!==0)throw failure??Error('RECOVERY_HELPER_EXIT_'+exit.code);
    try{const value=JSON.parse(out.toString());receipt.valid=validateReceipt(value,mutationRequest);
     const observations=value.observations;
     if(value.status==='APPLIED'||observations?.captured===true||observations?.published===true||observations?.restored_exclusively===true){report.reportedEffect=true;if(report.relocated)report.state='BLOCKING_OUTSIDE_EFFECT';}
    }catch{receipt.valid=false;}
    if(q.operation==='replace'){
     // Explicit test fault: save the real reply, then drop only its acknowledgement.
     // This leaves the checked adapter UNKNOWN and forces one fresh inspect.
     receipt.acknowledgementDropped=true;throw Error('TEST_ONLY_ACKNOWLEDGEMENT_DROPPED');
    }
    return out;
   }finally{
    try{if(child.exitCode===null&&child.signalCode===null){child.stdin.end();await terminate();}await boundedClose();}
    finally{Object.assign(receipt,{stdout:out.toString(),stderr:err.toString(),failure:failure?.message??receipt.failure??null});clearTimeout(timer);clearTimeout(killTimer);}
   }
  }
  const io={ownerLockFD:3,authorize:async id=>{registry.requireGrant(id,'read');registry.requireGrant(id,'write');},protectedRead,protectedDirectory,command:brokerCommand};
  try{
   const adapter=await loadCheckedMacRecoveryInstallation(registry,installation,io);
   report.signedArtifacts=artifacts;report.source_sha256=sourceHash;
   report.replacement_sha256=sha(Buffer.alloc(8*1024*1024,90));
   report.mutation=await adapter.replaceIfHash({workspace_id:'work',path:relative},Buffer.alloc(8*1024*1024,90),original.sha256);
   lifecycle.assertIdle();
   report.sourceAfter=await snapshotSource(item);report.outsideAfter=await snapshotSource(movedItem);
   if(report.relocated&&(!report.outsideAfter.exists||report.outsideAfter.sha256!==original.sha256||report.outsideAfter.device!==original.device||report.outsideAfter.inode!==original.inode))report.state='BLOCKING_OUTSIDE_EFFECT';
   const initialCanaries=await Promise.all(canaries.map(snapshotSource));
   if(initialCanaries.some((c,i)=>c.sha256!==beforeCanaries[i].sha256||c.device!==beforeCanaries[i].device||c.inode!==beforeCanaries[i].inode))report.state='BLOCKING_OUTSIDE_EFFECT';
   const beforeInspect={workspace:await recordTree(work),recovery:await recordTree(recovery),outside:await recordTree(outside)};
   report.inspect=await inspectSettled(adapter,lifecycle,report.mutation.transaction_id);
   lifecycle.assertIdle();
   report.nativeInspectExecuted=report.operations.filter(operation=>operation==='inspect').length===1;
   const afterInspect={workspace:await recordTree(work),recovery:await recordTree(recovery),outside:await recordTree(outside)};
   report.inspectDidNotMutate=JSON.stringify(beforeInspect)===JSON.stringify(afterInspect);report.namespaceBeforeInspect=beforeInspect;report.namespaceAfterInspect=afterInspect;
   report.canariesAfter=await Promise.all(canaries.map(async p=>({path:p,...await snapshotSource(p)})));
   const unchanged=report.canariesAfter.every((c,i)=>c.sha256===beforeCanaries[i].sha256&&c.device===beforeCanaries[i].device&&c.inode===beforeCanaries[i].inode);
   const preserved=report.outsideAfter.exists===true&&report.outsideAfter.sha256===original.sha256&&report.outsideAfter.device===original.device&&report.outsideAfter.inode===original.inode;
   const captured=await fs.lstat(path.join(recovery,report.mutation.transaction_id,'captured')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
   // A capture restored later still crossed the outside boundary. Terminal
   // transaction readback may be cached; it cannot certify native inspection.
   report.reportedEffect=report.native.some(receipt=>{try{const value=JSON.parse(receipt.stdout),observations=value.observations;return value.status==='APPLIED'||observations?.captured===true||observations?.published===true||observations?.restored_exclusively===true;}catch{return false;}});
   report.receiptsValid=report.native.length===2&&report.native.every(receipt=>receipt.valid===true);
   if(report.state!=='BLOCKING_OUTSIDE_EFFECT')report.state=classifyObservation({...report,preserved,unchanged,captured});
  }catch(e){report.failure=String(e.stack??e);report.state=report.state==='BLOCKING_OUTSIDE_EFFECT'?report.state:report.relocated?'UNVERIFIED_AFTER_RELOCATION':'INCONCLUSIVE';}
  finally{
   await resumeOwned();
   report.childCleanupUnverified=lifecycle.cleanupUnverified;
   if(report.childCleanupUnverified&&report.state!=='BLOCKING_OUTSIDE_EFFECT')report.state='UNVERIFIED_CHILD_CLEANUP';
   report.finalCanaries=await Promise.all(canaries.map(async file=>{try{return {path:file,...await snapshotSource(file)};}catch(e){return {path:file,error:String(e.message)};}}));
   if(report.finalCanaries.some((c,i)=>c.exists===false||c.exists===true&&(c.sha256!==beforeCanaries[i].sha256||c.device!==beforeCanaries[i].device||c.inode!==beforeCanaries[i].inode)))report.state='BLOCKING_OUTSIDE_EFFECT';
   const reportFile=path.join(root,'result.json');await fs.writeFile(reportFile,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
   console.log(JSON.stringify({state:report.state,result:reportFile,fixture:base,operations:report.operations,activation:false}));
  }
}
async function nativeMain(){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('APPLE_SILICON_MAC_REQUIRED');
 if(sha(await fs.readFile(source))!==sourceHash)throw Error('SOURCE_PIN_MISMATCH');
 await fs.lstat(reservation).then(()=>{throw Error('ATTEMPT_ALREADY_RESERVED');},e=>{if(e.code!=='ENOENT')throw e;});
 const ownerRoot=await fs.realpath(await fs.mkdtemp('/private/tmp/gsa-recovery-held-parent-'));await fs.chmod(ownerRoot,0o700);
 await fs.mkdir(path.join(ownerRoot,'owner'),{mode:0o700});
 const reservationParent=path.dirname(reservation);await fs.mkdir(reservationParent,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});await protectedDirectory(reservationParent);
 candidate=path.join(ownerRoot,'candidate');
 await run('/usr/bin/swiftc',[source,'-o',candidate],'',65536);await fs.chmod(candidate,0o500);
 const observerFile=path.join(ownerRoot,'observer.swift'),observer=path.join(ownerRoot,'fd-observer');await fs.writeFile(observerFile,observerSource,{mode:0o600,flag:'wx'});
 await run('/usr/bin/swiftc',['-O',observerFile,'-o',observer],'',65536);await fs.chmod(observer,0o500);
 const build={source_sha256:sourceHash,candidate_sha256:sha(await fs.readFile(candidate)),observer_sha256:sha(await fs.readFile(observer)),hostRelease:os.release(),arch:process.arch,compiler_version:(await run('/usr/bin/swiftc',['--version'])).toString().trim(),arguments:[source,'-o',candidate],historical_binary_evidence_reused:false};
 await fs.writeFile(path.join(ownerRoot,'build.json'),JSON.stringify(build),{mode:0o600,flag:'wx'});
 const child=spawn('/usr/bin/python3',[launcher,'--identity',path.join(ownerRoot,'owner'),'--node',process.execPath,'--entry',script],{shell:false,detached:true,stdio:'inherit',env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp',GSA_NATIVE_FIXTURE_ROOT:ownerRoot}});
 const ownerIdentity=async()=>JSON.parse((await run(observer,['identity',String(child.pid),String(process.pid)],'',4096,undefined,false,250)).toString());
 let birth;try{birth=await ownerIdentity();}catch{throw Error('OWNER_IDENTITY_UNVERIFIED; preserved '+ownerRoot);}
 const signalGroup=async signal=>{
  if(child.exitCode!==null||child.signalCode!==null)return;
  try{const current=await ownerIdentity();if(current.startTime===birth.startTime&&current.pid===child.pid&&current.parentPid===process.pid)process.kill(-child.pid,signal);}catch{}
 };
 let expired=false,killTimer;const timer=setTimeout(()=>{expired=true;void (async()=>{await signalGroup('SIGCONT');await signalGroup('SIGTERM');killTimer=setTimeout(()=>{void signalGroup('SIGKILL');},1500);})();},90000);
 let waitLimit,code;
 try{code=await Promise.race([new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code));}),new Promise((_,reject)=>{waitLimit=setTimeout(()=>reject(Error('OWNER_CLEANUP_UNVERIFIED; preserved '+ownerRoot)),95000);})]);}
 finally{clearTimeout(timer);clearTimeout(killTimer);clearTimeout(waitLimit);}
 if(expired||code!==0)throw Error('OWNED_FIXTURE_FAILED; preserved '+ownerRoot);
}
async function main(){
 const args=process.argv.slice(2);
 if(process.env.GSA_OWNER_LOCK_FD!==undefined){if(args.length)throw Error('INTERNAL_ARGUMENTS_INVALID');return runChecked();}
 if(args.length===0||args.length===1&&args[0]==='--plan'){console.log(JSON.stringify(await getPlan()));return;}
 if(args[0]==='--run-one'&&args.length===1)throw Error('ACKNOWLEDGEMENT_REQUIRED');
 if(args.length!==2||args[0]!=='--run-one'||args[1]!==ack)throw Error('INVALID_ARGUMENTS');
 // This flag acknowledges the bounds; it does not authenticate human approval.
 // The calling operator must already have reviewed explicit quota extension.
 await nativeMain();
}
if(process.argv[1]&&path.resolve(process.argv[1])===script)main().catch(error=>{console.error(error.message);process.exitCode=1;});
