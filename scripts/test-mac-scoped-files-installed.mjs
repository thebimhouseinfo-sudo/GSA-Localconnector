#!/usr/bin/env node
// Bounded, disposable exact-release held-parent relocation plus strict-loader journey.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {enrollRolesTrustedBatch} from '../dist/src/local/grants.js';
import {loadTrustedRegistry,revokeTrusted} from '../dist/src/local/grants.js';
import {ControlLeaseStore} from '../dist/src/local/control-lease.js';
import {withControlToken} from '../dist/src/mcp/control-context.js';
import {authorizeMcpWorkspace} from '../dist/src/mcp/runtime-bootstrap.js';
import {applyMacScopedFiles} from './install-mac-scoped-files.mjs';
import {requireMacFileEvidence} from '../dist/src/hosts/macos-file-evidence.js';

const thisFile=fileURLToPath(import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const fail=(message)=>{throw Error(message)};
function run(file,args,input='',timeout=120000){return new Promise((resolve,reject)=>{const child=spawn(file,args,{shell:false,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'}});let out=Buffer.alloc(0),err=Buffer.alloc(0),failure;const timer=setTimeout(()=>{failure=Error('TIMEOUT '+path.basename(file));child.kill('SIGKILL')},timeout);child.stdout.on('data',b=>{out=Buffer.concat([out,b]);if(out.length>2*1024*1024){failure=Error('STDOUT_LIMIT');child.kill('SIGKILL')}});child.stderr.on('data',b=>{err=Buffer.concat([err,b]);if(err.length>65536){failure=Error('STDERR_LIMIT');child.kill('SIGKILL')}});child.on('error',e=>failure=e);child.on('close',code=>{clearTimeout(timer);if(failure)reject(failure);else if(code!==0)reject(Error(`COMMAND ${path.basename(file)} exit ${code}: ${err.toString().slice(0,1200)}`));else resolve({stdout:out,stderr:err})});child.stdin.on('error',()=>{});child.stdin.end(input)})}
async function identity(p){const s=await fs.stat(p,{bigint:true});return {device:String(s.dev),inode:String(s.ino)}}
async function ensurePrivate(p){await fs.mkdir(p,{mode:0o700});await fs.chmod(p,0o700)}
const observerSource=`import Darwin\nimport Foundation\nlet a=CommandLine.arguments\nguard a.count==4,let pid=Int32(a[1]),let wantedDev=UInt32(a[2]),let wantedIno=UInt64(a[3]) else { exit(64) }\nlet deadline=Date().addingTimeInterval(4.0)\nwhile Date()<deadline {\n let n=proc_pidinfo(pid,PROC_PIDLISTFDS,0,nil,0)\n if n>0 && n<65536 {\n  let listCount=Int(n);var list=[UInt8](repeating:0,count:listCount)\n  let got=list.withUnsafeMutableBytes { proc_pidinfo(pid,PROC_PIDLISTFDS,0,$0.baseAddress,Int32(listCount)) }\n  if got>0 {\n   let stride=MemoryLayout<proc_fdinfo>.size\n   for off in Swift.stride(from:0,to:Int(got)-stride+1,by:stride) {\n    let item=list.withUnsafeBytes { $0.loadUnaligned(fromByteOffset:off,as:proc_fdinfo.self) }\n    let infoCount=MemoryLayout<vnode_fdinfo>.size;var info=[UInt8](repeating:0,count:infoCount)\n    let size=info.withUnsafeMutableBytes { proc_pidfdinfo(pid,item.proc_fd,PROC_PIDFDVNODEINFO,$0.baseAddress,Int32(infoCount)) }\n    if size>=MemoryLayout<proc_fileinfo>.size+MemoryLayout<vinfo_stat>.size {\n     let dev=info.withUnsafeBytes { $0.loadUnaligned(fromByteOffset:MemoryLayout<proc_fileinfo>.size,as:vinfo_stat.self).vst_dev }\n     let ino=info.withUnsafeBytes { $0.loadUnaligned(fromByteOffset:MemoryLayout<proc_fileinfo>.size,as:vinfo_stat.self).vst_ino }\n     if dev==wantedDev && ino==wantedIno { let flags=info.withUnsafeBytes{$0.loadUnaligned(fromByteOffset:0,as:proc_fileinfo.self).fi_openflags};let stopped=kill(pid,SIGSTOP);print("HIT \\(item.proc_fd) \\(flags) \\(dev) \\(ino) stop=\\(stopped)");fflush(stdout);exit(stopped==0 ? 0 : 4) }\n    }\n   }\n  }\n }\n usleep(500)\n}\nexit(2)\n`;
async function compileObserver(base){const file=path.join(base,'fd-observer.swift'),binary=path.join(base,'fd-observer');await fs.writeFile(file,observerSource,{mode:0o600,flag:'wx'});await run('/usr/bin/xcrun',['swiftc','-O',file,'-o',binary]);return binary}
const singleObserverSource=`import Darwin
import Foundation
let a=CommandLine.arguments
guard a.count==4,let pid=Int32(a[1]),let wantedDev=UInt32(a[2]),let wantedIno=UInt64(a[3]) else {exit(64)}
func matchingFD()->(Int32,UInt32)? {
 let n=proc_pidinfo(pid,PROC_PIDLISTFDS,0,nil,0);guard n>0 && n<65536 else{return nil}
 let listCount=Int(n);var list=[UInt8](repeating:0,count:listCount)
 let got=list.withUnsafeMutableBytes{proc_pidinfo(pid,PROC_PIDLISTFDS,0,$0.baseAddress,Int32(listCount))};guard got>0 else{return nil}
 let stride=MemoryLayout<proc_fdinfo>.size
 for off in Swift.stride(from:0,to:Int(got)-stride+1,by:stride){
  let item=list.withUnsafeBytes{$0.loadUnaligned(fromByteOffset:off,as:proc_fdinfo.self)}
  let infoCount=MemoryLayout<vnode_fdinfo>.size;var info=[UInt8](repeating:0,count:infoCount)
  let actual=info.withUnsafeMutableBytes{proc_pidfdinfo(pid,item.proc_fd,PROC_PIDFDVNODEINFO,$0.baseAddress,Int32(infoCount))}
  if actual>=MemoryLayout<proc_fileinfo>.size+MemoryLayout<vinfo_stat>.size{
   let vnode=info.withUnsafeBytes{$0.loadUnaligned(fromByteOffset:MemoryLayout<proc_fileinfo>.size,as:vinfo_stat.self)}
   if vnode.vst_dev==wantedDev && vnode.vst_ino==wantedIno{let flags=info.withUnsafeBytes{$0.loadUnaligned(fromByteOffset:0,as:proc_fileinfo.self).fi_openflags};return(item.proc_fd,flags)}
  }
 }
 return nil
}
print("ARMED");fflush(stdout)
let deadline=Date().addingTimeInterval(5)
while Date()<deadline{if let hit=matchingFD(){let stopped=kill(pid,SIGSTOP);print("HIT \\(hit.0) \\(hit.1) \\(wantedDev) \\(wantedIno) stop=\\(stopped)");fflush(stdout);exit(stopped==0 ? 0:4)};usleep(200)}
exit(2)
`;
async function compileSingleObserver(base){const file=path.join(base,'single-fd-observer.swift'),binary=path.join(base,'single-fd-observer');await fs.writeFile(file,singleObserverSource,{mode:0o600,flag:'wx'});await run('/usr/bin/xcrun',['swiftc','-O',file,'-o',binary]);return binary}
const confirmObserverSource=`import Darwin
import Foundation
let a=CommandLine.arguments
guard a.count==5,let pid=Int32(a[1]),let wantedFD=Int32(a[2]),let wantedDev=UInt32(a[3]),let wantedIno=UInt64(a[4]) else{exit(64)}
let n=proc_pidinfo(pid,PROC_PIDLISTFDS,0,nil,0);guard n>0 && n<65536 else{exit(5)}
let listCount=Int(n);var list=[UInt8](repeating:0,count:listCount)
let got=list.withUnsafeMutableBytes{proc_pidinfo(pid,PROC_PIDLISTFDS,0,$0.baseAddress,Int32(listCount))};guard got>0 else{exit(5)}
let stride=MemoryLayout<proc_fdinfo>.size
for off in Swift.stride(from:0,to:Int(got)-stride+1,by:stride){
 let item=list.withUnsafeBytes{$0.loadUnaligned(fromByteOffset:off,as:proc_fdinfo.self)};guard item.proc_fd==wantedFD else{continue}
 let infoCount=MemoryLayout<vnode_fdinfo>.size;var info=[UInt8](repeating:0,count:infoCount)
 let size=info.withUnsafeMutableBytes{proc_pidfdinfo(pid,item.proc_fd,PROC_PIDFDVNODEINFO,$0.baseAddress,Int32(infoCount))}
 if size>=MemoryLayout<proc_fileinfo>.size+MemoryLayout<vinfo_stat>.size{let vnode=info.withUnsafeBytes{$0.loadUnaligned(fromByteOffset:MemoryLayout<proc_fileinfo>.size,as:vinfo_stat.self)};if vnode.vst_dev==wantedDev && vnode.vst_ino==wantedIno{print("CONFIRMED \\(item.proc_fd) \\(wantedDev) \\(wantedIno)");exit(0)}}
}
exit(5)
`;
async function compileConfirmObserver(base){const file=path.join(base,'confirm-fd-observer.swift'),binary=path.join(base,'confirm-fd-observer');await fs.writeFile(file,confirmObserverSource,{mode:0o600,flag:'wx'});await run('/usr/bin/xcrun',['swiftc','-O',file,'-o',binary]);return binary}
function lineReader(stream){let text='',ended=false,error;const queue=[],waiters=[];stream.on('data',chunk=>{text+=chunk.toString('utf8');while(text.includes('\n')){const at=text.indexOf('\n'),line=text.slice(0,at);text=text.slice(at+1);const waiter=waiters.shift();if(waiter)waiter.resolve(line);else queue.push(line)}});stream.on('error',e=>{error=e;while(waiters.length)waiters.shift().reject(e)});stream.on('end',()=>{ended=true;while(waiters.length){const w=waiters.shift();w.resolve(text);}});return {next(timeout){if(queue.length)return Promise.resolve(queue.shift());if(error)return Promise.reject(error);if(ended)return Promise.resolve(null);return new Promise((resolve,reject)=>{const waiter={resolve,reject};waiters.push(waiter);const timer=setTimeout(()=>{const i=waiters.indexOf(waiter);if(i>=0)waiters.splice(i,1);reject(Error('observer line timeout'))},timeout);const oldResolve=waiter.resolve;waiter.resolve=value=>{clearTimeout(timer);oldResolve(value)};const oldReject=waiter.reject;waiter.reject=e=>{clearTimeout(timer);oldReject(e)}})}}}
async function runOwner(identityRoot,mode,env,timeoutMs=60000){return await new Promise((resolve,reject)=>{
 const child=spawn('/usr/bin/python3',[path.resolve('scripts/macos-owner-launcher.py'),'--identity',identityRoot,'--node',process.execPath,'--entry',thisFile],{shell:false,detached:true,stdio:['ignore','pipe','pipe'],env:{...env,GSA_NATIVE_MODE:mode}}),pgid=child.pid;
 let out=Buffer.alloc(0),err=Buffer.alloc(0),failure,finishing=false;
 const signalGroup=signal=>{if(!Number.isSafeInteger(pgid))return;try{process.kill(-pgid,signal)}catch(e){if(e.code!=='ESRCH')throw e}};
 const groupExists=()=>{if(!Number.isSafeInteger(pgid))return false;try{process.kill(-pgid,0);return true}catch(e){return e.code!=='ESRCH'}};
 const stopGroup=()=>{try{signalGroup('SIGCONT')}catch{}try{signalGroup('SIGTERM')}catch{}setTimeout(()=>{if(groupExists())try{signalGroup('SIGKILL')}catch{}},1200).unref()};
 const drainGroup=async()=>{if(!groupExists())return true;stopGroup();const until=Date.now()+2500;while(Date.now()<until&&groupExists())await new Promise(r=>setTimeout(r,50));if(groupExists()){try{signalGroup('SIGKILL')}catch{}const killUntil=Date.now()+1000;while(Date.now()<killUntil&&groupExists())await new Promise(r=>setTimeout(r,50));}return !groupExists()};
 const failAndStop=message=>{if(!failure)failure=Error(message);if(!finishing){finishing=true;stopGroup()}};
 const timer=setTimeout(()=>failAndStop('owner mode timeout'),timeoutMs);
 child.stdout.on('data',b=>{out=Buffer.concat([out,b]);if(out.length>1024*1024)failAndStop('owner mode output cap')});
 child.stderr.on('data',b=>{err=Buffer.concat([err,b]);if(err.length>65536)failAndStop('owner mode diagnostics cap')});
 child.on('error',e=>{failure=e;stopGroup()});
 child.on('close',async(code,signal)=>{clearTimeout(timer);const clean=await drainGroup();if(!clean){reject(Error('owned owner process group remained after bounded cleanup'));return}if(failure)reject(failure);else if(code!==0)reject(Error('owner mode exit '+code+' signal '+signal+': '+err.toString().slice(0,3000)));else resolve({stdout:out.toString('utf8'),stderr:err.toString('utf8')})});
})}
async function singleProbeMode(){
 const root=process.env.GSA_NATIVE_FIXTURE_ROOT,stage=process.env.GSA_NATIVE_STAGE,observer=process.env.GSA_NATIVE_OBSERVER,confirm=process.env.GSA_NATIVE_CONFIRM_OBSERVER,canaryPath=process.env.GSA_NATIVE_CANARY_PATH,canarySha=process.env.GSA_NATIVE_CANARY_SHA;
 if(!root||!stage||!observer||!confirm||!canaryPath||!canarySha)fail('single probe inputs missing');
 const work=path.join(root,'workspace'),outside=path.join(root,'outside'),held=path.join(work,'held'),parentId=await identity(held),manifest=JSON.parse(await fs.readFile(path.join(stage,'install.json'),'utf8')),proof=JSON.parse(manifest.body),grant=proof.grants.find(g=>g.role==='workspace'),binary=path.join(stage,grant.id,'Broker.app/Contents/MacOS/broker');
 const runId=randomUUID(),targetName='relocation-canary-'+runId+'.bin',targetPath=path.join(held,targetName),relocatedPath=path.join(outside,'held-relocated-'+runId),outsideTarget=path.join(relocatedPath,targetName);
 const beforeExists=await fs.stat(targetPath).then(()=>true,()=>false);if(beforeExists)fail('unique relocation target unexpectedly exists');
 const payload=Buffer.alloc(8*1024*1024,0x5a),metadata={operation:'create',workspace_id:grant.id,role:grant.role,root:grant.root,device:grant.rootIdentity.device,inode:grant.rootIdentity.inode,revision:grant.revision,path:'held/'+targetName},wire={...metadata,base64:payload.toString('base64')},wireJson=JSON.stringify(wire),payloadSha=sha(payload),requestSha=sha(Buffer.from(wireJson));
 if(Buffer.byteLength(wireJson)>12*1024*1024||payloadSha!==sha(payload))fail('relocation request bound mismatch');
 const request={...metadata,payload_ref:'interiorRelocation.payload'};
 let broker,observerChild,brokerDone=false,observerDone=false,brokerCode=null,brokerSignal=null,brokerOut=Buffer.alloc(0),brokerErr=Buffer.alloc(0),observerErr=Buffer.alloc(0),spawnError=null,observedLine=null,stopSent=false,resumed=false,moveCompleted=false;
 const events={previousRunnableAttempts:4,thisRun:1,cumulativeRunnableAttempts:5,previousCap:3,userAuthorizedAdditionalProbe:1};
 const result={status:'INCONCLUSIVE',observation_method:'libproc-owned-pid-fd-v1',attempt_index:5,run_id:runId,request,parentPath:held,relocatedPath,request_bytes:Buffer.byteLength(wireJson),request_sha256:requestSha,payload:{encoding:'repeat-byte-v1',byte:90,length:payload.length,sha256:payloadSha},parentIdentity:parentId,targetBeforeMove:{path:targetPath,exists:false},targetOutsideBefore:{path:outsideTarget,exists:false},targetOutsideAfter:{path:outsideTarget,exists:false},outsideTargetAbsent:false,stopped:false,resumed:false,attemptLedger:events,timeline:{}};
 const started=performance.now();
 try{
  broker=spawn(binary,[],{shell:false,stdio:['pipe','pipe','pipe',3],env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'}});
  broker.stdout.on('data',b=>{brokerOut=Buffer.concat([brokerOut,b]);if(brokerOut.length>65536)broker.kill('SIGKILL')});broker.stderr.on('data',b=>{observerErr=Buffer.concat([observerErr,b]);if(observerErr.length>65536)broker.kill('SIGKILL')});broker.on('error',e=>{spawnError=String(e)});broker.stdin.on('error',e=>{spawnError=String(e)});broker.on('close',(code,signal)=>{brokerDone=true;brokerCode=code;brokerSignal=signal});
  const brokerClosed=new Promise(resolve=>broker.once('close',resolve));
  observerChild=spawn(observer,[String(broker.pid),parentId.device,parentId.inode],{shell:false,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'}});
  observerChild.stderr.on('data',b=>{observerErr=Buffer.concat([observerErr,b]);if(observerErr.length>65536)observerChild.kill('SIGKILL')});observerChild.on('error',e=>{spawnError=String(e)});observerChild.on('close',()=>{observerDone=true});
  const lines=lineReader(observerChild.stdout),armed=await lines.next(5000);if(armed!=='ARMED')fail('owned-PID observer did not arm');
  broker.stdin.end(wireJson);
  const line=await lines.next(6000).catch(()=>null);
  if(line&&line.startsWith('HIT ')){
   observedLine=line;stopSent=true;
   const match=/^HIT (\d+) (\d+) (\d+) (\d+) stop=0$/.exec(line);if(!match){result.reason='invalid owned-PID stop response';try{process.kill(broker.pid,'SIGCONT');resumed=true}catch{}}
   if(match){
   const fd=Number(match[1]),flags=Number(match[2]),observedIdentity={device:match[3],inode:match[4]};result.pid=broker.pid;result.fd=fd;result.flags=flags;result.parentIdentity=observedIdentity;
   const ps=await run('/bin/ps',['-o','stat=','-p',String(broker.pid)],'',1000).then(r=>r.stdout.toString().trim(),()=>''),confirmOut=await run(confirm,[String(broker.pid),String(fd),parentId.device,parentId.inode],'',1000).then(r=>r.stdout.toString().trim(),()=>''),heldFD=confirmOut===`CONFIRMED ${fd} ${parentId.device} ${parentId.inode}`;
   result.stopConfirmation={pid:broker.pid,signal:'SIGSTOP',state:ps,fd,parentIdentity:observedIdentity,fdStillOpen:heldFD};result.timeline.stopConfirmed=performance.now()-started;
   const insideExists=await fs.stat(targetPath).then(()=>true,()=>false);result.targetBeforeMove={path:targetPath,exists:insideExists};result.timeline.targetAbsentBeforeMove=performance.now()-started;
   if(!/^T/.test(ps)||!heldFD||insideExists){result.reason=!/^T/.test(ps)?'stop not confirmed':!heldFD?'same parent FD no longer open':'target appeared before relocation';if(/^T/.test(ps)){try{process.kill(broker.pid,'SIGCONT');resumed=true}catch{}}}
   else{
    await fs.rename(held,relocatedPath);moveCompleted=true;result.timeline.parentRelocated=performance.now()-started;result.relocatedIdentity=await identity(relocatedPath);
    const outsideExists=await fs.stat(outsideTarget).then(()=>true,()=>false);result.targetOutsideBefore={path:outsideTarget,exists:outsideExists};result.timeline.outsideTargetAbsentBeforeResume=performance.now()-started;
    process.kill(broker.pid,'SIGCONT');resumed=true;result.stopped=true;result.resumed=true;result.timeline.resumed=performance.now()-started;
    const timer=setTimeout(()=>{if(!brokerDone){try{process.kill(broker.pid,'SIGKILL')}catch{}}},15000).unref();await brokerClosed;clearTimeout(timer);
    result.response=JSON.parse(brokerOut.toString('utf8'));result.exitCode=brokerCode;result.exitSignal=brokerSignal;
    const outsideStat=await fs.stat(outsideTarget).then(async s=>({path:outsideTarget,exists:true,size:s.size,sha256:sha(await fs.readFile(outsideTarget))}),()=>({path:outsideTarget,exists:false}));result.targetOutsideAfter=outsideStat;result.timeline.outsideTargetObservedAfterResume=performance.now()-started;
    if(outsideExists||outsideStat.exists){result.status='COUNTEREXAMPLE';result.reason='target existed outside granted root during relocation';}
    else if(result.response?.ok===false&&['PATH_OR_ACCESS_DENIED','ROOT_UNVERIFIED','SECURITY_BLOCKED','ALREADY_EXISTS_OR_DENIED'].includes(result.response.error)){result.status='OBSERVED';result.outsideTargetAbsent=true;}
    else{result.status='INCONCLUSIVE';result.reason='release response did not establish denial and outside absence';}
   }
   }
  }else{
   result.reason=line===null?'observer missed the one bounded FD window':line;
  }
  if(broker.stdin.writable)broker.stdin.end();
  if(!brokerDone)await Promise.race([brokerClosed,new Promise(resolve=>setTimeout(resolve,15000))]);
  if(!brokerDone){try{process.kill(broker.pid,'SIGCONT')}catch{};try{process.kill(broker.pid,'SIGTERM')}catch{};await Promise.race([brokerClosed,new Promise(resolve=>setTimeout(resolve,1000))]);if(!brokerDone){try{process.kill(broker.pid,'SIGKILL')}catch{};await brokerClosed}}
  if(!result.response&&brokerOut.length)result.response=JSON.parse(brokerOut.toString('utf8'));
  if(!result.exitCode){result.exitCode=brokerCode;result.exitSignal=brokerSignal}
  result.stopped=stopSent&&/^T/.test(result.stopConfirmation?.state??'');result.resumed=stopSent&&(resumed||brokerDone);
 }finally{
  if(stopSent&&!resumed&&broker&&!brokerDone){try{process.kill(broker.pid,'SIGCONT')}catch{};resumed=true}
  if(broker&&!brokerDone){try{process.kill(broker.pid,'SIGTERM')}catch{};await Promise.race([new Promise(resolve=>broker.once('close',resolve)),new Promise(resolve=>setTimeout(resolve,1000))]);if(!brokerDone){try{process.kill(broker.pid,'SIGKILL')}catch{};await new Promise(resolve=>broker.once('close',resolve))}}
  if(observerChild&&!observerDone){try{observerChild.kill('SIGTERM')}catch{};await new Promise(resolve=>observerChild.once('close',resolve))}
  if(stopSent&&!result.timeline.resumed){result.timeline.resumed=performance.now();result.resumed=true}
 }
 const canaryAfter=sha(await fs.readFile(canaryPath));if(canaryAfter!==canarySha)result.canaryChanged=true;
 result.targetAfter=await fs.stat(targetPath).then(s=>({path:targetPath,exists:true,size:s.size}),()=>({path:targetPath,exists:false}));
 result.outsideCanary={path:canaryPath,before_sha256:canarySha,after_sha256:canaryAfter};
 return {scope:'single bounded exact staged signed RELEASE held-parent relocation attempt',stage,release_sha256:proof.build.release_sha256,code_sha256:proof.build.code_sha256,workspaceRoot:work,heldParent:held,heldParentIdentity:parentId,relocatedParent:relocatedPath,relocatedIdentity:result.relocatedIdentity??null,directLaunch:process.env.GSA_NATIVE_LAUNCH_RESULT,priorAttempts:[{pid:90193,result:'observer miss'},{pid:90195,result:'held FD found but old shared target already existed; no relocation'},{pid:90369,result:'observer miss'},{pid:90371,result:'held FD found but old shared target already existed; no relocation'}],authorizedNewAttempts:1,cumulativeRunnableAttempts:5,originalCap:3,userExtendedCap:5,attempts:[{...result,elapsed_ms:performance.now()-started,spawnError}]};
}
async function verifyLaunch(bundle){
 const result=await new Promise((resolve,reject)=>{const child=spawn(bundle,[],{shell:false,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'}});let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0);child.on('error',reject);child.stdout.on('data',b=>stdout=Buffer.concat([stdout,b]));child.stderr.on('data',b=>stderr=Buffer.concat([stderr,b]));child.on('close',(code,signal)=>resolve({code,signal,stdout:stdout.toString('utf8'),stderr:stderr.toString('utf8')}));child.stdin.on('error',()=>{});child.stdin.end('{}')});
 if(result.code!==0||result.signal||!JSON.parse(result.stdout).error||result.stderr)fail('Staged release failed direct launch probe: '+JSON.stringify(result));return result;
}
async function childMode(){
 const root=process.env.GSA_NATIVE_FIXTURE_ROOT,stage=process.env.GSA_NATIVE_STAGE,observer=process.env.GSA_NATIVE_OBSERVER;
 if(!root||!stage||!observer)fail('missing fixture arguments');
 const work=path.join(root,'workspace'),outside=path.join(root,'outside'),held=path.join(work,'held'),moved=path.join(outside,'held-relocated');
 const stat=await identity(held),rootGrant=JSON.parse(await fs.readFile(path.join(stage,'install.json'),'utf8'));
 const proof=JSON.parse(rootGrant.body),bundle=proof.grants.find(g=>g.role==='workspace'),binary=path.join(stage,bundle.id,'Broker.app/Contents/MacOS/broker');
 const payload=Buffer.alloc(8*1024*1024,0x5a),events=[];let observed=false,relocationResult='INCONCLUSIVE';
 for(let attempt=1;attempt<=3&&!observed;attempt++){
  const request={operation:'create',workspace_id:bundle.id,role:bundle.role,root:bundle.root,device:bundle.rootIdentity.device,inode:bundle.rootIdentity.inode,revision:bundle.revision,path:`held/relocation-canary-${attempt}.bin`,base64:payload.toString('base64')};
  const requestJSON=JSON.stringify(request);if(Buffer.byteLength(requestJSON)>12*1024*1024)fail('request exceeds broker bound');
  const targetPath=path.join(held,path.basename(request.path));const before=await fs.stat(targetPath).then(()=>true,()=>false);if(before)fail('target already exists');
  const broker=spawn(binary,[],{shell:false,stdio:['pipe','pipe','pipe',3],env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'}});let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),done=false,code=null,spawnError=null;
  broker.on('error',e=>{spawnError=e});broker.stdin.on('error',e=>{spawnError=e});const closed=new Promise(resolve=>broker.once('close',(c,s)=>{done=true;code=c;resolve()}));const watchdog=setTimeout(()=>{try{process.kill(broker.pid,'SIGCONT');process.kill(broker.pid,'SIGTERM')}catch{}setTimeout(()=>{if(!done)try{process.kill(broker.pid,'SIGKILL')}catch{}},1000).unref()},25000).unref();broker.stdout.on('data',b=>stdout=Buffer.concat([stdout,b]));broker.stderr.on('data',b=>stderr=Buffer.concat([stderr,b]));
  broker.stdin.end(requestJSON);
  const found=await run(observer,[String(broker.pid),stat.device,stat.inode],'',5000).then(r=>r.stdout.toString().trim(),e=>`OBSERVER_${String(e.message).replace(/\s+/g,'_')}`);
  if(found.startsWith('HIT ')){
   observed=true;const [,fd,flags,device,inode]=found.split(' ');events.push({attempt,pid:broker.pid,fd:Number(fd),flags:Number(flags),parentIdentity:{device,inode},observer:'libproc-owned-pid-fd-v1',request:{workspace_id:bundle.id,root:bundle.root,revision:bundle.revision,path:request.path,operation:'create'}});
   try{
    await new Promise(r=>setTimeout(r,10));const stopState=(await run('/bin/ps',['-o','stat=','-p',String(broker.pid)],'',1000).then(x=>x.stdout.toString().trim(),()=>''));
    if(!stopState.includes('T')){relocationResult='INCONCLUSIVE_STOP_NOT_CONFIRMED';process.kill(broker.pid,'SIGCONT');await closed;break;}
    const stillHeld=await run(observer,[String(broker.pid),stat.device,stat.inode],'',1000).then(r=>r.stdout.toString().trim(),()=> 'MISSED');
    if(!stillHeld.startsWith('HIT ')){relocationResult='INCONCLUSIVE_STOPPED_FD_NOT_CONFIRMED';process.kill(broker.pid,'SIGCONT');await closed;break;}
    const targetBeforeMove=await fs.stat(targetPath).then(()=>true,()=>false);if(targetBeforeMove){relocationResult='INCONCLUSIVE_TARGET_ALREADY_MUTATED';process.kill(broker.pid,'SIGCONT');await closed;events[events.length-1]={...events.at(-1),stopState,targetBeforeMove,exitCode:code,response:stdout.toString('utf8'),stderr:stderr.toString('utf8')};break;}
    await fs.rename(held,moved);const movedIdentity=await identity(moved);if(movedIdentity.device!==stat.device||movedIdentity.inode!==stat.inode)fail('relocated directory identity changed');
    const targetOutside=path.join(moved,path.basename(request.path));const absentBefore=!(await fs.stat(targetOutside).then(()=>true,()=>false));
    process.kill(broker.pid,'SIGCONT');await closed;
    const targetAfter=await fs.stat(targetOutside).then(async s=>({exists:true,size:s.size,sha256:sha(await fs.readFile(targetOutside))}),()=>({exists:false}));
    const response=JSON.parse(stdout.toString('utf8'));
    relocationResult=response.ok===false&&!targetAfter.exists&&absentBefore?'OBSERVED':'COUNTEREXAMPLE';
    events[events.length-1]={...events.at(-1),parentPath:held,relocatedPath:moved,relocatedIdentity:movedIdentity,stopped:true,resumed:true,response,targetOutsideBefore:absentBefore,targetBeforeMove,targetOutsideAfter:targetAfter,exitCode:code,spawnError:spawnError?String(spawnError):null,stderr:stderr.toString('utf8').slice(0,1000)};
   }finally{clearTimeout(watchdog);if(!done){try{process.kill(broker.pid,'SIGCONT')}catch{}try{process.kill(broker.pid,'SIGTERM')}catch{}await Promise.race([closed,new Promise(r=>setTimeout(r,1000))]);if(!done){try{process.kill(broker.pid,'SIGKILL')}catch{}await closed}}}
   break;
  }
  await closed;clearTimeout(watchdog);events.push({attempt,pid:broker.pid,observer:found,request:{workspace_id:bundle.id,root:bundle.root,revision:bundle.revision,path:request.path,operation:'create'},exitCode:code,spawnError:spawnError?String(spawnError):null,response:stdout.toString('utf8').slice(0,500)});
 }
 const relocatedIdentity=await identity(moved).catch(()=>null);const result={scope:'exact staged signed RELEASE broker, bounded held-parent relocation probe',stage,release_sha256:proof.build.release_sha256,code_sha256:proof.build.code_sha256,workspaceRoot:work,heldParent:held,heldParentIdentity:stat,relocatedParent:moved,relocatedIdentity,payload_sha256:sha(payload),attempts:events,relocation:relocationResult};
 console.log(JSON.stringify(result));
 if(!observed)process.exitCode=2;
 else if(relocationResult==='COUNTEREXAMPLE')process.exitCode=3;
}

async function journeyMode(){
 const root=process.env.GSA_NATIVE_FIXTURE_ROOT,stage=process.env.GSA_NATIVE_STAGE;
 const identityRoot=path.join(root,'identity'),workspace=path.join(root,'workspace'),reference=path.join(root,'reference'),outside=path.join(root,'outside');
 const outsidePath=process.env.GSA_NATIVE_CANARY_PATH??path.join(outside,'canary.bin');
 const canaryBefore=sha(await fs.readFile(outsidePath)),expectedCanary=process.env.GSA_NATIVE_CANARY_SHA;
 if(expectedCanary&&canaryBefore!==expectedCanary)fail('pre-relocation outside canary baseline changed');
 const relocationReceipt=JSON.parse(process.env.GSA_NATIVE_RELOCATION_RECEIPT??'{"status":"INCONCLUSIVE","reason":"No relocation receipt supplied"}');
 const eventOrder=['outside_canary_baseline'];if(relocationReceipt.status==='OBSERVED')eventOrder.push('interior_relocation');
 const proof=JSON.parse((await fs.readFile(path.join(stage,'install.json'),'utf8'))).body;
 const body=JSON.parse(proof),roots=body.grants;
 const registry=await loadTrustedRegistry(identityRoot),leaseStore=new ControlLeaseStore(identityRoot),lease=await leaseStore.acquire();
 const authorize=(id,permission)=>authorizeMcpWorkspace(registry,id,identityRoot,permission);
 try{
 const source=await fs.readFile(new URL('../dist/src/hosts/macos-scoped-files.js',import.meta.url),'utf8');
 const moduleSource=source.replace('async function constructMacScopedFiles(', 'export async function constructMacScopedFiles(')
  .replace(/from (["'])(\.[^"']+)\1/g,(_m,q,rel)=>`from ${q}${new URL(rel,new URL('../dist/src/hosts/macos-scoped-files.js',import.meta.url)).href}${q}`);
 const mod=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
 const io=await mod.constructMacScopedFiles(registry,stage,{ownerLockFD:3,authorize},true);
 eventOrder.push('candidate_operations_start');
 const work=roots.find(r=>r.role==='workspace'),ref=roots.find(r=>r.role==='reference');
 const bind=(g,p)=>({workspace_id:g.id,root:g.root,revision:g.revision,role:g.role,device:g.rootIdentity.device,inode:g.rootIdentity.inode,path:p});
 const call=(id,fn)=>withControlToken(leaseStore,lease.control_token,fn);
 await fs.mkdir(path.join(workspace,'journey'),{mode:0o700});
 const created=Buffer.from('workspace-native-create-read');
 const createReq={...bind(work,'journey/create.bin'),operation:'create',base64:created.toString('base64')};
 await call(work.id,()=>io.createExclusive({workspace_id:work.id,path:'journey/create.bin'},created));
 const readReq={...bind(work,'journey/create.bin'),operation:'read'};
 const read=await call(work.id,()=>io.read({workspace_id:work.id,path:'journey/create.bin'},1024));
 const mkdirReq={...bind(work,'journey/new-dir'),operation:'mkdir'};
 await call(work.id,()=>io.makeDirectory({workspace_id:work.id,path:'journey/new-dir'}));
 const mkdirStat=await fs.stat(path.join(workspace,'journey/new-dir'));
 const refBytes=Buffer.from('reference-copy-source');await fs.writeFile(path.join(reference,'copy-source.bin'),refBytes,{flag:'wx',mode:0o600});
 const refReq={...bind(ref,'copy-source.bin'),operation:'read'};
 const refRead=await call(ref.id,()=>io.read({workspace_id:ref.id,path:'copy-source.bin'},1024));
 const copyReq={...bind(work,'copy-out.bin'),operation:'create',base64:Buffer.from(refRead.bytes).toString('base64')};
 const sourceRequest=refReq;
 await call(work.id,()=>io.copyExclusive({workspace_id:ref.id,path:'copy-source.bin'},{workspace_id:work.id,path:'copy-out.bin'},refRead.sha256));
 const copyBack=await fs.readFile(path.join(workspace,'copy-out.bin'));
 const collisionPath=path.join(workspace,'collision.bin'),collisionBytes=Buffer.from('preserve-this');await fs.writeFile(collisionPath,collisionBytes,{flag:'wx',mode:0o600});
 const collisionReq={...bind(work,'collision.bin'),operation:'create',base64:Buffer.from('overwrite').toString('base64')};let collisionError;
 try{await call(work.id,()=>io.createExclusive({workspace_id:work.id,path:'collision.bin'},Buffer.from('overwrite')));}catch(e){collisionError=String(e.code??e.message);}
 const collisionAfter=await fs.readFile(collisionPath);
 const refDestReq={...bind(ref,'denied-destination.bin'),operation:'create',base64:refBytes.toString('base64')};let refDestError;
 try{await call(ref.id,()=>io.createExclusive({workspace_id:ref.id,path:'denied-destination.bin'},refBytes));}catch(e){refDestError=String(e.code??e.message);}
 const refDestAbsent=await fs.stat(path.join(reference,'denied-destination.bin')).then(()=>false,()=>true);
 const artifactReq={...bind(work,'artifact-mismatch.bin'),operation:'create',base64:Buffer.from('mismatch').toString('base64')};
 const binary=path.join(stage,work.id,'Broker.app/Contents/MacOS/broker'),original=await fs.readFile(binary),mode=(await fs.stat(binary)).mode&0o777;let artifactError;
 try{await fs.chmod(binary,0o700);const changed=Buffer.from(original);changed[changed.length-1]^=1;await fs.writeFile(binary,changed);try{await call(work.id,()=>io.createExclusive({workspace_id:work.id,path:'artifact-mismatch.bin'},Buffer.from('mismatch')));}catch(e){artifactError=String(e.code??e.message);}}
 finally{await fs.writeFile(binary,original);await fs.chmod(binary,mode);}
 const artifactAbsent=await fs.stat(path.join(workspace,'artifact-mismatch.bin')).then(()=>false,()=>true);
 const staleReq={...bind(work,'stale-grant.bin'),operation:'create',base64:Buffer.from('stale').toString('base64')};await revokeTrusted(work.id,identityRoot);let staleError;
 try{await call(work.id,()=>io.createExclusive({workspace_id:work.id,path:'stale-grant.bin'},Buffer.from('stale')));}catch(e){staleError=String(e.code??e.message);}
 const staleAbsent=await fs.stat(path.join(workspace,'stale-grant.bin')).then(()=>false,()=>true);
 eventOrder.push('candidate_operations_complete');const canaryAfter=sha(await fs.readFile(outsidePath));eventOrder.push('outside_canary_readback');
 assert.equal(canaryAfter,canaryBefore,'outside canary changed during candidate operations');
 let strictError;try{await mod.loadMacScopedFiles(registry,stage,{ownerLockFD:3,authorize});}catch(e){strictError=String(e.code??e.message);}
 const observations={
  create:{request:createReq,response:{ok:true},expected_sha256:sha(created),readback_sha256:sha(await fs.readFile(path.join(workspace,'journey/create.bin')))},
  read:{request:readReq,response:{ok:true,base64:Buffer.from(read.bytes).toString('base64'),sha256:read.sha256},expected_sha256:sha(created)},
  mkdir:{request:mkdirReq,response:{ok:true},isDirectory:mkdirStat.isDirectory()},
  referenceRead:{request:refReq,response:{ok:true,base64:Buffer.from(refRead.bytes).toString('base64'),sha256:refRead.sha256},expected_sha256:sha(refBytes)},
  copy:{request:copyReq,sourceRequest,response:{ok:true},expected_sha256:sha(refBytes),readback_sha256:sha(copyBack)},
  collision:{request:collisionReq,error:collisionError,before_sha256:sha(collisionBytes),after_sha256:sha(collisionAfter)},
  referenceDestination:{request:refDestReq,error:refDestError,absent:refDestAbsent},
  staleGrant:{request:staleReq,error:staleError,absent:staleAbsent},
  artifactMismatch:{request:artifactReq,error:artifactError,absent:artifactAbsent},
  outsideCanaries:[{path:outsidePath,before_sha256:canaryBefore,after_sha256:canaryAfter,event_order:eventOrder}],
  interiorRelocation:relocationReceipt
 };
 console.log(JSON.stringify({scope:'candidate constructor real staged RELEASE with evidence check bypassed only for composition; public loader strict rejection',stage,build:body.build,fixture:{stage:await identity(stage),stagePath:stage,hostRelease:body.hostRelease,arch:body.arch,owner_fd:3,roots:roots.map(g=>({id:g.id,root:g.root,rootIdentity:g.rootIdentity,revision:g.revision,role:g.role,artifacts:g.artifacts,presign_sha256:g.presign_sha256,code_sha256:g.code_sha256}))},observations,strictLoader:{error:strictError},raw:{createReadBase64:created.toString('base64'),referenceBase64:Buffer.from(refRead.bytes).toString('base64')}}));
 }finally{await leaseStore.release(lease.control_token)}
}

async function strictWorkerMode(){
 const root=process.env.GSA_NATIVE_FIXTURE_ROOT,identityRoot=path.join(root,'identity'),workspace=path.join(root,'workspace'),reference=path.join(root,'reference'),installation=path.join(identityRoot,'scoped-files');
 const registry=await loadTrustedRegistry(identityRoot),leaseStore=new ControlLeaseStore(identityRoot),lease=await leaseStore.acquire(),authorize=(id,permission)=>authorizeMcpWorkspace(registry,id,identityRoot,permission);
 try{
  const io=await import('../dist/src/hosts/macos-scoped-files.js'),native=await io.loadMacScopedFiles(registry,installation,{ownerLockFD:3,authorize});
  const roots=registry.list(),work=roots.find(g=>g.role==='workspace'),ref=roots.find(g=>g.role==='reference');if(!work||!ref)fail('strict loader fixture roots missing');
  const call=(id,fn)=>withControlToken(leaseStore,lease.control_token,fn),created=Buffer.from('strict-loader-create-read'),source=Buffer.from('strict-loader-reference-copy');
  await call(work.id,()=>native.makeDirectory({workspace_id:work.id,path:'strict'}));const mkdirStat=await fs.stat(path.join(workspace,'strict'));
  await call(work.id,()=>native.createExclusive({workspace_id:work.id,path:'strict/create.bin'},created));const read=await call(work.id,()=>native.read({workspace_id:work.id,path:'strict/create.bin'},1024));
  await fs.writeFile(path.join(reference,'strict-source.bin'),source,{flag:'wx',mode:0o600});
  const refRead=await call(ref.id,()=>native.read({workspace_id:ref.id,path:'strict-source.bin'},1024));const copy=await call(work.id,()=>native.copyExclusive({workspace_id:ref.id,path:'strict-source.bin'},{workspace_id:work.id,path:'strict/copy.bin'},refRead.sha256));
  const copied=await fs.readFile(path.join(workspace,'strict/copy.bin')),createBack=await fs.readFile(path.join(workspace,'strict/create.bin'));
  const checks={createRead:read.bytes.equals(created)&&sha(read.bytes)===sha(created)&&sha(createBack)===sha(created),mkdir:mkdirStat.isDirectory(),referenceRead:refRead.bytes.equals(source)&&sha(refRead.bytes)===sha(source),copy:sha(copied)===sha(source)&&sha(copied)===sha(refRead.bytes)};
  if(Object.values(checks).some(ok=>!ok))fail('public strict loader operation readback/hash assertion failed');
  console.log(JSON.stringify({scope:'public strict loadMacScopedFiles on applied disposable installation',status:'STRICT_PUBLIC_LOADER_OK',roots:roots.map(g=>({id:g.id,root:g.canonicalRoot,revision:g.revision,role:g.role,rootIdentity:g.rootIdentity})),operations:checks,hashes:{create:sha(createBack),reference:sha(refRead.bytes),copy:sha(copied)}}));
 }finally{await leaseStore.release(lease.control_token)}
}

async function main(){
 if(process.platform!=='darwin'||process.arch!=='arm64')fail('macOS ARM64 required');
 if(process.env.GSA_NATIVE_MODE==='worker'){const receipt=await singleProbeMode();console.log(JSON.stringify(receipt));return}
 if(process.env.GSA_NATIVE_MODE==='journey-worker')return journeyMode();
 if(process.env.GSA_NATIVE_MODE==='strict-worker')return strictWorkerMode();
 if(process.argv.includes('--single-probe'))return mainSingleProbe();
 if(!process.argv.includes('--journey'))fail('Usage: test-mac-scoped-files-installed.mjs --journey | --single-probe');
 const base=await fs.realpath(await fs.mkdtemp('/private/tmp/gsa-mac-files-installed-'));await fs.chmod(base,0o700);const baseStat=await fs.lstat(base);let preserve=false;
 try{
  const identityRoot=path.join(base,'identity'),workspace=path.join(base,'workspace'),reference=path.join(base,'reference'),outside=path.join(base,'outside');for(const dir of [identityRoot,workspace,reference,outside])await ensurePrivate(dir);const held=path.join(workspace,'held');await ensurePrivate(held);
  const payload=Buffer.alloc(8*1024*1024,0x5a);await fs.writeFile(path.join(held,'source.bin'),payload,{mode:0o600,flag:'wx'});
  await enrollRolesTrustedBatch([{id:'work',root:workspace,role:'workspace'},{id:'ref',root:reference,role:'reference'}],identityRoot);
  const installer=await import('../scripts/install-mac-scoped-files.mjs');const staged=await installer.stageMacScopedFiles(identityRoot),workspaceBundle=staged.grants.find(g=>g.role==='workspace');const launch=await verifyLaunch(path.join(staged.stage,workspaceBundle.id,'Broker.app/Contents/MacOS/broker'));const journey=process.argv.includes('--journey');const observer=journey?'':await compileObserver(base);
  const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp',GSA_NATIVE_FIXTURE_ROOT:base,GSA_NATIVE_STAGE:staged.stage,GSA_NATIVE_OBSERVER:observer,GSA_NATIVE_MODE:journey?'journey-worker':'worker'};
  const child=spawn('/usr/bin/python3',[path.resolve('scripts/macos-owner-launcher.py'),'--identity',identityRoot,'--node',process.execPath,'--entry',thisFile],{shell:false,stdio:'inherit',env});const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(c,s)=>resolve(c??(s?1:0)));});
  if(code===2)fail('INCONCLUSIVE: no held-parent FD observed in three bounded release attempts');if(code===3)fail('COUNTEREXAMPLE: exact release broker mutated the relocated ungranted sibling');if(code!==0)fail('installed release probe failed, exit '+code);console.log(JSON.stringify({directLaunch:launch,journey}));
 }catch(error){preserve=true;console.error(JSON.stringify({result:'UNVERIFIED_OR_FAILED',error:String(error?.stack??error),preserved_fixture:base}));throw error;
 }finally{if(!preserve){const now=await fs.lstat(base);if(now.dev!==baseStat.dev||now.ino!==baseStat.ino||now.isSymbolicLink()||await fs.realpath(base)!==base)console.error('cleanup refused: fixture identity changed '+base);else await fs.rm(base,{recursive:true,force:false});}}
}

async function mainSingleProbe(){
 const reportPath=path.resolve('docs/reports/2026-10-22-mac-single-probe-native.jsonl');let report;
 try{report=await fs.open(reportPath,'wx',0o600);}catch(e){if(e.code==='EEXIST')fail('The one authorized additional relocation probe is already reserved/consumed; no probe launched');throw e;}
 await report.writeFile(JSON.stringify({status:'STARTED',authorizedNewAttempts:1,cumulativeRunnableAttempts:5,previousRunnableAttempts:4,previousCapExceeded:true})+'\n');await report.sync();await report.close();
 const append=async value=>{const h=await fs.open(reportPath,'a',0o600);try{await h.writeFile(JSON.stringify(value)+'\n');await h.sync()}finally{await h.close()}};
 const base=await fs.realpath(await fs.mkdtemp('/private/tmp/gsa-mac-single-probe-'));await fs.chmod(base,0o700);const baseStat=await fs.lstat(base);let preserve=false;
 try{
  const identityRoot=path.join(base,'identity'),workspace=path.join(base,'workspace'),reference=path.join(base,'reference'),outside=path.join(base,'outside'),held=path.join(workspace,'held'),canaryPath=path.join(outside,'canary.bin');
  for(const dir of [identityRoot,workspace,reference,outside,held])await ensurePrivate(dir);
  await fs.writeFile(path.join(held,'source.bin'),Buffer.alloc(8*1024*1024,0x5a),{mode:0o600,flag:'wx'});
  const canary=Buffer.from('outside-canary-baseline-v2');await fs.writeFile(canaryPath,canary,{mode:0o600,flag:'wx'});const canarySha=sha(canary);
  await enrollRolesTrustedBatch([{id:'work',root:workspace,role:'workspace'},{id:'ref',root:reference,role:'reference'}],identityRoot);
  const installer=await import('../scripts/install-mac-scoped-files.mjs'),staged=await installer.stageMacScopedFiles(identityRoot),workspaceBundle=staged.grants.find(g=>g.role==='workspace');
  const launch=await verifyLaunch(path.join(staged.stage,workspaceBundle.id,'Broker.app/Contents/MacOS/broker'));
  const observer=await compileSingleObserver(base),confirm=await compileConfirmObserver(base),env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp',GSA_NATIVE_FIXTURE_ROOT:base,GSA_NATIVE_STAGE:staged.stage,GSA_NATIVE_OBSERVER:observer,GSA_NATIVE_CONFIRM_OBSERVER:confirm,GSA_NATIVE_CANARY_PATH:canaryPath,GSA_NATIVE_CANARY_SHA:canarySha};
  const relocationRun=await runOwner(identityRoot,'worker',env,30000),relocation=JSON.parse(relocationRun.stdout.trim().split('\n').at(-1));
  await append({status:'RELOCATION_RESULT',directLaunch:launch,relocation});
  const attempt=relocation.attempts?.[0];
  if(!attempt||attempt.status!=='OBSERVED'){
   if(attempt?.status==='COUNTEREXAMPLE'||attempt?.canaryChanged)preserve=true;
   await append({status:'INCONCLUSIVE_OR_COUNTEREXAMPLE',strictLoader:'NOT_RUN',reason:attempt?.reason??'single probe did not produce a complete OBSERVED receipt'});
   console.log(JSON.stringify({status:attempt?.status??'INCONCLUSIVE',strictLoader:'NOT_RUN',report:reportPath}));return;
  }
  const journeyEnv={...env,GSA_NATIVE_RELOCATION_RECEIPT:JSON.stringify(attempt)};
  const journeyRun=await runOwner(identityRoot,'journey-worker',journeyEnv,90000),journey=JSON.parse(journeyRun.stdout.trim().split('\n').at(-1));
  const evidence={format:'gsa-scoped-files-native-evidence-v2',signing_profile:'gsa-scoped-files-adhoc-single-root-v1',build:journey.build,fixture:{owner_fd:3,hostRelease:journey.fixture.hostRelease,arch:journey.fixture.arch,stage:journey.fixture.stagePath,stageIdentity:journey.fixture.stage,roots:journey.fixture.roots},observations:journey.observations,unresolved:[]};
  requireMacFileEvidence(evidence,evidence.build);
  const rootSpec=[{id:'work',root:workspace,role:'workspace'},{id:'ref',root:reference,role:'reference'}],reEnrolled=await enrollRolesTrustedBatch(rootSpec,identityRoot);
  if(reEnrolled.length!==2||reEnrolled.some(g=>{const old=evidence.fixture.roots.find(r=>r.id===g.id),workspaceRevoked=g.id==='work';return !old||g.grant.canonicalRoot!==rootSpec.find(r=>r.id===g.id).root||(workspaceRevoked?g.grant.revision<=old.revision:g.grant.revision!==old.revision)||g.grant.rootIdentity.device!==old.rootIdentity.device||g.grant.rootIdentity.inode!==old.rootIdentity.inode}))fail('fixture roots changed unexpectedly or revision did not advance as expected');
  const applied=await installer.applyMacScopedFiles(identityRoot,evidence);
  const strictRun=await runOwner(identityRoot,'strict-worker',{...env,GSA_NATIVE_STAGE:path.join(identityRoot,'scoped-files')},90000),strict=JSON.parse(strictRun.stdout.trim().split('\n').at(-1));
  if(strict.status!=='STRICT_PUBLIC_LOADER_OK')fail('public strict loader journey did not complete');
  await append({status:'COMPOSED_EVIDENCE_VALIDATED_AND_INSTALLED',evidence,applied,strict});
  console.log(JSON.stringify({status:'STRICT_PUBLIC_LOADER_OK',report:reportPath,installation:applied.installation}));
 }catch(error){preserve=true;await append({status:'FAILED_OR_UNVERIFIED',error:String(error?.message??error),fixture:base});throw error;
 }finally{const now=await fs.lstat(base).catch(()=>null);if(!preserve&&now&&now.dev===baseStat.dev&&now.ino===baseStat.ino&&!now.isSymbolicLink()&&await fs.realpath(base)===base)await fs.rm(base,{recursive:true,force:false});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===thisFile)main().catch(error=>{console.error(String(error?.stack??error));process.exitCode=1});
