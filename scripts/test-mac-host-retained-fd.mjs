#!/usr/bin/env node
// Separate test-only single-case probe. No production grants or policy changes.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
import {HOST_PROFILE} from './test-mac-host-bootstrap-v2.mjs';
import {reserveAttempt,createChildLifecycle} from './mac-recovery-probe-control.mjs';
const exec=promisify(execFile),script=fileURLToPath(import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const slot=fileURLToPath(new URL('../docs/reports/.mac-host-retained-fd-v1.attempt.json',import.meta.url));
const ack='--ack-one-retained-fd-probe',profileHash='ac6bd382dcef686e4b990049556f4949563f9acefe92f8b5c3ed28159d1e24fd';
export const HELPER_SOURCE=String.raw`#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
int main(int argc,char **argv){
 if(argc==5&&strcmp(argv[1],"--inspect")==0){
  pid_t pid=(pid_t)strtol(argv[2],NULL,10),parent=(pid_t)strtol(argv[3],NULL,10);int fd=(int)strtol(argv[4],NULL,10);
  struct proc_bsdinfo b;char p[PROC_PIDPATHINFO_MAXSIZE];
  if(pid<=1||parent<=1||fd<0||proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&b,sizeof(b))!=(int)sizeof(b)||b.pbi_pid!=(uint32_t)pid||b.pbi_ppid!=(uint32_t)parent||b.pbi_uid!=getuid()||proc_pidpath(pid,p,sizeof(p))<=0)return 5;
  printf("{\"pid\":%d,\"parentPid\":%d,\"birth\":\"%" PRIu64 ":%" PRIu64 "\",\"executable\":\"%s\"",pid,parent,b.pbi_start_tvsec,b.pbi_start_tvusec,p);
  if(fd){struct vnode_fdinfo v;if(proc_pidfdinfo(pid,fd,PROC_PIDFDVNODEINFO,&v,sizeof(v))!=(int)sizeof(v))return 6;
   printf(",\"fd\":%d,\"dev\":\"%u\",\"ino\":\"%" PRIu64 "\"",fd,v.pvi.vi_stat.vst_dev,v.pvi.vi_stat.vst_ino);}
  puts("}");return 0;
 }
 if(argc!=2)return 64;
 int fd=open(argv[1],O_RDONLY|O_NOFOLLOW);struct stat s;if(fd<3||fstat(fd,&s)!=0)return 65;
 // No marker read occurs before the single release byte.
 printf("{\"type\":\"ready\",\"pid\":%d,\"fd\":%d,\"dev\":\"%u\",\"ino\":\"%" PRIu64 "\"}\n",getpid(),fd,(unsigned)s.st_dev,(uint64_t)s.st_ino);fflush(stdout);
 char trigger;if(read(STDIN_FILENO,&trigger,1)!=1||trigger!='G')return 66;
 unsigned char bytes[128];ssize_t n=read(fd,bytes,sizeof(bytes));int e=n<0?errno:0;
 printf("{\"type\":\"read\",\"n\":%zd,\"errno\":%d,\"hex\":\"",n,e);
 for(ssize_t i=0;i<n;i++)printf("%02x",bytes[i]);puts("\"}");close(fd);
 return n<0?77:0;
}
`;
export async function getPlan(){return {nativeExecution:false,activation:false,maximumSandboxInvocations:1,maximumRenames:1,maximumReadonlyObservers:3,childMs:5000,suiteMs:30000,outputBytes:16384,
 profile_sha256:sha(HOST_PROFILE),helper_source_sha256:sha(HELPER_SOURCE),driver_sha256:sha(await fs.readFile(script)),reservation:slot,
 command:`node scripts/test-mac-host-retained-fd.mjs --run ${ack}`,exposure:'unchanged v2 literal root names, two named sysctls and literal /dev/null data-write',
 limit:'one retained-FD read after disposable root relocation; no actual grant revocation, cancellation, process-domain or full Mac certification'};}
export function classifyRead(value,code,signal){
 if(signal||value?.type!=='read'||!Number.isInteger(value.n)||!Number.isInteger(value.errno)||typeof value.hex!=='string'||!/^([a-f0-9]{2})*$/.test(value.hex))throw Error('UNVERIFIED_READ_RECEIPT');
 if(code===0&&value.n>0&&value.n<=128&&value.hex.length===value.n*2&&value.errno===0)return 'RETAINED_FD_AUTHORITY_SURVIVES';
 if(code===77&&value.n===-1&&[1,13].includes(value.errno)&&value.hex==='')return 'PASS_RETAINED_FD_READ_DENIED_ONLY';
 throw Error('UNVERIFIED_READ_OUTCOME');
}
export async function relocateAndRelease(ready,expected,operations){
 for(const key of ['pid','fd','dev','ino'])if(ready[key]!==expected[key])throw Error('READY_IDENTITY_MISMATCH');
 await operations.verify();await operations.rename();await operations.confirm();operations.release();
}
export function recordFailure(report,key,error){
 report[key]=String(error.message);
 if(!report.authoritySurvives&&report.state!=='BLOCKING_CANARY_CHANGED')report.state='UNVERIFIED';
}
export function createProbeTransport({argv,cwd,env,lifecycle,spawnImpl=spawn,timeoutMs=5000}){
 assert.ok(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=5000);lifecycle.beforeLaunch();
 let child;try{child=spawnImpl('/usr/bin/sandbox-exec',argv,{cwd,env,stdio:['pipe','pipe','pipe'],shell:false});}catch(e){lifecycle.markCleanupUnverified();throw e;}
 let stdout='',stderr='',closed=false,failure=null,code=null,signal=null,resolveReady,rejectReady,resolveDone,rejectDone;
 const ready=new Promise((a,b)=>{resolveReady=a;rejectReady=b;}),done=new Promise((a,b)=>{resolveDone=a;rejectDone=b;});void ready.catch(()=>{});void done.catch(()=>{});
 const until=Date.now()+timeoutMs;
 const fail=e=>{failure??=String(e.message);lifecycle.markCleanupUnverified();rejectReady(e);rejectDone(e);};
 const timer=setTimeout(()=>fail(Error('CHILD_TIMEOUT')),timeoutMs);
 const assertActive=()=>{if(closed||failure||lifecycle.cleanupUnverified||Date.now()>=until)throw Error('CHILD_NO_LONGER_ELIGIBLE');};
 const add=(kind,data)=>{
  if(failure)return;
  const available=16384-Buffer.byteLength(stdout)-Buffer.byteLength(stderr),bytes=Buffer.from(data);
  if(bytes.length>available){
   let end=available;while(end>0&&(bytes[end]&0xc0)===0x80)end--;
   const prefix=bytes.subarray(0,end).toString();if(kind==='out')stdout+=prefix;else stderr+=prefix;
   fail(Error('OUTPUT_LIMIT'));return;
  }
  if(kind==='out'){stdout+=data;if(stdout.includes('\n')){try{resolveReady(JSON.parse(stdout.split('\n')[0]));}catch(e){rejectReady(e);}}}else stderr+=data;
 };
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdin.on('error',()=>{});
 child.stdout.on('data',s=>add('out',s));child.stderr.on('data',s=>add('err',s));child.on('error',fail);
 child.on('close',(c,s)=>{closed=true;code=c;signal=s;clearTimeout(timer);lifecycle.confirmClosed();rejectReady(Error('CLOSED_BEFORE_READY'));resolveDone({code,signal});});
 return {child,ready,done,assertActive,get closed(){return closed;},release(){assertActive();child.stdin.end('G');},dispose(){clearTimeout(timer);},snapshot(){return {pid:child.pid??null,code,signal,stdout,stderr,failure};}};
}
export async function cleanupLeaf(transport,lifecycle,observe,{waitMs=1000}={}){
 assert.ok(Number.isInteger(waitMs)&&waitMs>0&&waitMs<=1000);
 lifecycle.markCleanupUnverified();const child=transport.child,result={detachedUnconfirmed:false};
 // EOF exits the fixed helper without authorizing its marker read. This action
 // needs no PID lookup and remains safe when libproc observation is unavailable.
 child.stdin.end();
 try{if(!transport.closed){await observe();if(!transport.closed)child.kill('SIGTERM');}}
 catch(e){result.observationFailure=String(e.message);}
 if(!transport.closed)await new Promise(resolve=>{
  const close=()=>{clearTimeout(timer);resolve();};
  const timer=setTimeout(()=>{child.removeListener('close',close);resolve();},waitMs);child.once('close',close);
 });
 if(!transport.closed){
  result.detachedUnconfirmed=true;
  // Preserve uncertainty and the PID receipt; do not leave pipe/child handles
  // keeping the diagnostic parent alive, and do not signal an unverified PID.
  child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();child.unref();
 }
 return result;
}
async function runOnce(){
 if(process.platform!=='darwin')throw Error('MAC_ONLY');assert.equal(sha(HOST_PROFILE),profileHash);
 await fs.lstat(slot).then(()=>{throw Error('ATTEMPT_ALREADY_CONSUMED');},e=>{if(e.code!=='ENOENT')throw e;});
 const deadline=Date.now()+30000,root=await fs.realpath(await fs.mkdtemp('/private/tmp/gsa-host-retained-fd-'));await fs.chmod(root,0o700);
 const w=path.join(root,'workspace'),outside=path.join(root,'outside'),moved=path.join(outside,'moved-workspace');
 for(const p of [w,outside])await fs.mkdir(p,{mode:0o700});
 const marker=path.join(w,'marker'),source=path.join(w,'helper.c'),helper=path.join(w,'helper');
 const markerBytes=Buffer.from('SYNTHETIC_HELD_FD_MARKER'),canary=Buffer.from('OUTSIDE_CANARY');
 await fs.writeFile(marker,markerBytes,{mode:0o600,flag:'wx'});await fs.writeFile(source,HELPER_SOURCE,{mode:0o600,flag:'wx'});await fs.writeFile(path.join(outside,'canary'),canary,{mode:0o600,flag:'wx'});
 const identity=async p=>{const s=await fs.lstat(p,{bigint:true});return {dev:String(s.dev),ino:String(s.ino)};};
 const workspaceIdentity=await identity(w),markerIdentity=await identity(marker),canaryIdentity=await identity(path.join(outside,'canary'));
 assert.equal(workspaceIdentity.dev,(await identity(outside)).dev);
 const report={state:'UNVERIFIED',activation:false,root,profile_sha256:profileHash,driver_sha256:sha(await fs.readFile(script)),helper_source_sha256:sha(HELPER_SOURCE),renames:0,sandboxInvocations:0,observerCalls:0,
  baseline:{workspaceIdentity,markerIdentity,marker_sha256:sha(markerBytes),canaryIdentity,canary_sha256:sha(canary)}};
 const lifecycle=createChildLifecycle();let child,transport,birth,helperIdentity,relocated=false;
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:w,TMPDIR:w,LANG:'C',LC_ALL:'C',DEVELOPER_DIR:'/Library/Developer/CommandLineTools'};
 const observe=async(fd=0)=>{
  if(++report.observerCalls>3)throw Error('OBSERVER_BUDGET');
  const executable=relocated?path.join(moved,'helper'):helper;
  assert.deepEqual(await identity(executable),helperIdentity);
  const r=JSON.parse((await exec(executable,['--inspect',String(child.pid),String(process.pid),String(fd)],{env,timeout:750,maxBuffer:4096})).stdout);
  assert.equal(r.pid,child.pid);assert.equal(r.parentPid,process.pid);if(birth)assert.equal(r.birth,birth);
  assert.ok([helper,path.join(moved,'helper')].includes(r.executable));return r;
 };
 try{
  await reserveAttempt(slot,{...report,maximumSandboxInvocations:1,maximumRenames:1,maximumReadonlyObservers:3,command:(await getPlan()).command});
  await exec('/usr/bin/clang',['-O0','-Wall','-Wextra','-Werror',source,'-o',helper],{env,timeout:15000,maxBuffer:16384});
  helperIdentity=await identity(helper);report.helper_sha256=sha(await fs.readFile(helper));report.helperIdentity=helperIdentity;
  if(Date.now()+6500>deadline)throw Error('SUITE_DEADLINE');
  report.sandboxInvocations++;
  transport=createProbeTransport({argv:['-p',HOST_PROFILE,'-D','WORKSPACE='+w,helper,marker],cwd:w,env,lifecycle});child=transport.child;
  const assertActive=()=>{transport.assertActive();if(Date.now()>=deadline)throw Error('SUITE_DEADLINE');};
  try{
   const announced=await transport.ready;assert.equal(announced.type,'ready');assert.ok(Number.isInteger(announced.fd)&&announced.fd>=3);
   const observed=await observe(announced.fd);birth=observed.birth;report.before=observed;
   await relocateAndRelease(announced,{pid:child.pid,fd:announced.fd,...markerIdentity},{
    verify:async()=>{assertActive();assert.deepEqual({dev:observed.dev,ino:observed.ino},markerIdentity);assert.deepEqual(await identity(w),workspaceIdentity);assert.deepEqual(await fs.readFile(marker),markerBytes);assert.deepEqual(await fs.readdir(outside),['canary']);assert.deepEqual(await identity(path.join(outside,'canary')),canaryIdentity);assert.deepEqual(await fs.readFile(path.join(outside,'canary')),canary);},
    rename:async()=>{assertActive();assert.equal(report.renames,0);report.renames++;await fs.rename(w,moved);relocated=true;},
    confirm:async()=>{await assert.rejects(fs.lstat(w),e=>e.code==='ENOENT');assert.deepEqual(await identity(moved),workspaceIdentity);assert.deepEqual(await identity(path.join(moved,'marker')),markerIdentity);report.after=await observe(announced.fd);assert.deepEqual({dev:report.after.dev,ino:report.after.ino},markerIdentity);},
    release:()=>{assertActive();transport.release();}
   });
   const outcome=await transport.done,lines=transport.snapshot().stdout.trim().split('\n');assert.equal(lines.length,2);report.read=JSON.parse(lines[1]);
   report.state=classifyRead(report.read,outcome.code,outcome.signal);
   report.authoritySurvives=report.state==='RETAINED_FD_AUTHORITY_SURVIVES';
   if(report.state==='RETAINED_FD_AUTHORITY_SURVIVES')assert.equal(report.read.hex,markerBytes.toString('hex'));
   assert.deepEqual(await identity(path.join(outside,'canary')),canaryIdentity);assert.deepEqual(await fs.readFile(path.join(outside,'canary')),canary);assert.deepEqual(await fs.readFile(path.join(moved,'marker')),markerBytes);
   lifecycle.assertIdle();
  }finally{transport.dispose();}
 }catch(e){recordFailure(report,'failure',e);}
 finally{
  if(child&&!transport.closed){
   report.cleanup=await cleanupLeaf(transport,lifecycle,observe);
  }
  report.cleanupUnverified=lifecycle.cleanupUnverified;report.childClosed=transport?.closed??false;if(transport)report.transport=transport.snapshot();
  try{report.final={oldPathPresent:await fs.lstat(w).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}),movedPathPresent:await fs.lstat(moved).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}),canaryIdentity:await identity(path.join(outside,'canary')),canary_sha256:sha(await fs.readFile(path.join(outside,'canary')))};
   if(JSON.stringify(report.final.canaryIdentity)!==JSON.stringify(canaryIdentity)||report.final.canary_sha256!==sha(canary))report.state='BLOCKING_CANARY_CHANGED';
  }catch(e){recordFailure(report,'finalInspectionFailure',e);}
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({state:report.state,result:path.join(root,'result.json'),sandboxInvocations:report.sandboxInvocations,renames:report.renames,activation:false}));
 }
 if(report.state!=='PASS_RETAINED_FD_READ_DENIED_ONLY'||report.cleanupUnverified)process.exitCode=1;
}
async function main(){const a=process.argv.slice(2);if(a.length===0||a.length===1&&a[0]==='--plan'){console.log(JSON.stringify(await getPlan()));return;}if(a.length!==2||a[0]!=='--run'||a[1]!==ack)throw Error('EXPLICIT_ACKNOWLEDGEMENT_REQUIRED');await runOnce();}
if(process.argv[1]&&path.resolve(process.argv[1])===script)main().catch(e=>{console.error(e.message);process.exitCode=1;});
