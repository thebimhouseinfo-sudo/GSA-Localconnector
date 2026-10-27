#!/usr/bin/env node
// Import-safe, one-slot readback. The run flag does not authorize execution.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {reserveAttempt,createChildLifecycle} from './mac-recovery-probe-control.mjs';

const script=fileURLToPath(import.meta.url);
const source=fileURLToPath(new URL('../native/macos-files/recovery-broker.swift',import.meta.url));
const launcher=fileURLToPath(new URL('./macos-owner-launcher.py',import.meta.url));
const evidence=fileURLToPath(new URL('../docs/reports/2026-10-23-mac-recovery-parent-native.json',import.meta.url));
const reservation=fileURLToPath(new URL('../docs/reports/.recovery-parent-probe-20261023/readback.json',import.meta.url));
const fixture='/private/tmp/gsa-recovery-held-parent-dsZj4b/case-XLjui9';
const transaction='811ff7e5-2b53-4074-8a1e-c5e5d9dfbfe9';
const sourceHash='6b5debec3543ca6d0c25b2844e77113630f884ca1513d168bfd161d52fe0fab8';
const protocol='gsa-file-recovery-v1';
const acknowledgement='--ack-new-readonly-approval';
const command=`node scripts/test-mac-recovery-retained-inspect.mjs --run-one ${acknowledgement}`;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const lifecycle=createChildLifecycle();
let activeChild;

export async function getPlan(){
 return {status:'REQUIRES_REVIEW_AND_NEW_READONLY_APPROVAL',nativeExecution:false,approvalRequired:true,
  mutationInvocations:0,relocations:0,replays:0,inspectInvocations:1,transaction_id:transaction,fixture,
  source_sha256:sha(await fs.readFile(source)),expected_source_sha256:sourceHash,
  driver_sha256:sha(await fs.readFile(script)),reservation,command,
  preserves:'original fixture, apps, receipts; fresh private candidate; all new receipts retained',activation:false};
}

async function safeDirectory(dir){
 const s=await fs.lstat(dir);
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700||await fs.realpath(dir)!==dir)throw Error('UNSAFE_DIRECTORY '+dir);
}
async function read(file,max=16*1024*1024){
 const s=await fs.lstat(file);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077)!==0||s.size>max)throw Error('UNSAFE_FILE '+file);
 const h=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const a=await h.stat();assert.equal(a.dev,s.dev);assert.equal(a.ino,s.ino);
  const bytes=await h.readFile();const b=await h.stat();
  assert.equal(bytes.length,s.size);assert.equal(b.ctimeMs,s.ctimeMs);assert.equal(b.mtimeMs,s.mtimeMs);
  return bytes;
 }finally{await h.close();}
}
async function save(file,value){await fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});}
function run(executable,args,{input='',fd,env={},timeout=30000,owner=false}={}){
 lifecycle.beforeLaunch();
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{shell:false,env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp',...env},stdio:fd===undefined?['pipe','pipe','pipe']:['pipe','pipe','pipe',fd]});
  activeChild=child;
  let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),failure,killLimit,hardKill;
  const terminate=reason=>{
   failure??=reason;
   // An owner timeout cannot certify descendant cleanup merely from owner close.
   if(owner)lifecycle.markCleanupUnverified();
   if(child.exitCode===null&&child.signalCode===null)child.kill(owner?'SIGTERM':'SIGKILL');
   if(owner)hardKill??=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},1500);
   killLimit??=setTimeout(()=>{lifecycle.markCleanupUnverified();reject(Error('OWNED_CHILD_CLEANUP_UNVERIFIED'));},2000);
  };
  const timer=setTimeout(()=>terminate('TIMEOUT'),timeout);
  child.stdout.on('data',b=>{if(stdout.length+b.length>1024*1024)terminate('STDOUT_LIMIT');else stdout=Buffer.concat([stdout,b]);});
  child.stderr.on('data',b=>{if(stderr.length+b.length>65536)terminate('STDERR_LIMIT');else stderr=Buffer.concat([stderr,b]);});
  child.on('error',error=>{failure??=error.message;});
  child.on('close',(code,signal)=>{
   clearTimeout(timer);clearTimeout(killLimit);clearTimeout(hardKill);activeChild=undefined;lifecycle.confirmClosed();
   resolve({pid:child.pid,code,signal,stdout:stdout.toString(),stderr:stderr.toString(),failure:failure??null});
  });
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
async function checked(executable,args,options){
 const result=await run(executable,args,options);
 assert.equal(result.failure,null);assert.equal(result.signal,null);assert.equal(result.code,0,JSON.stringify(result));
 return result.stdout;
}

export async function recordTree(root){
 await safeDirectory(root);const rootStat=await fs.lstat(root,{bigint:true});
 const rows=[{path:'.',kind:'directory',device:String(rootStat.dev),inode:String(rootStat.ino),mode:String(rootStat.mode),mtimeNs:String(rootStat.mtimeNs),ctimeNs:String(rootStat.ctimeNs)}];
 async function visit(dir,relative=''){
  for(const name of (await fs.readdir(dir)).sort()){
   if(rows.length>=128)throw Error('TREE_LIMIT');
   const file=path.join(dir,name),rel=relative?relative+'/'+name:name,s=await fs.lstat(file,{bigint:true});
   if(s.isSymbolicLink()||s.uid!==BigInt(process.getuid())||(!s.isDirectory()&&!s.isFile()))throw Error('UNSAFE_TREE_ENTRY');
   const row={path:rel,kind:s.isDirectory()?'directory':'file',device:String(s.dev),inode:String(s.ino),mode:String(s.mode),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)};
   if(s.isFile()){if(s.nlink!==1n||s.size>16n*1024n*1024n)throw Error('UNSAFE_TREE_FILE');Object.assign(row,{size:Number(s.size),sha256:sha(await read(file))});}
   rows.push(row);if(s.isDirectory())await visit(file,rel);
  }
 }
 await visit(root);return rows;
}
async function namespace(){return Object.fromEntries(await Promise.all(['workspace','recovery','outside'].map(async name=>[name,await recordTree(path.join(fixture,name))])));}
export function validateReceipt(value,intent){
 const keys=['ok','protocol','transaction_id','status','intent','observations','retained_handles','reason'];
 assert.deepEqual(Object.keys(value).sort(),keys.sort());
 assert.equal(value.ok,true);assert.equal(value.protocol,protocol);assert.equal(value.transaction_id,transaction);
 assert.equal(value.status,'UNKNOWN');assert.equal(value.reason,'PATH_OUTSIDE_SCOPE');assert.deepEqual(value.intent,intent);
 assert.deepEqual(value.observations,{captured:false});assert.deepEqual(value.retained_handles,[]);
 return true;
}

async function inspectOnce(staging){
 await safeDirectory(staging);
 if(!staging.startsWith('/private/tmp/gsa-retained-inspect-'))throw Error('STAGING_PREFIX');
 const owner=path.join(staging,'owner');
 if(process.env.GSA_OWNER_LOCK_FD!=='3'||process.env.GSA_OWNER_IDENTITY!==owner)throw Error('OWNER_ENVIRONMENT');
 const verified=JSON.parse(await checked('/usr/bin/python3',[launcher,'--identity',owner,'--verify'],{fd:3,env:{GSA_OWNER_LOCK_FD:'3',GSA_OWNER_IDENTITY:owner,GSA_OWNER_SESSION:process.env.GSA_OWNER_SESSION}}));
 assert.equal(verified.format,'gsa-owner-v1');assert.equal(verified.session,process.env.GSA_OWNER_SESSION);
 const build=JSON.parse(await read(path.join(staging,'build.json')));
 assert.equal(sha(await fs.readFile(source)),sourceHash);assert.equal(build.source_sha256,sourceHash);
 const binary=path.join(staging,'RecoveryBroker.app/Contents/MacOS/recovery-broker');
 assert.equal(sha(await read(binary)),build.signed_binary_sha256);
 const prior=JSON.parse(await read(evidence));assert.equal(prior.fixture,fixture);assert.equal(prior.eligibility.eligible,true);
 assert.equal(prior.childCleanupUnverified,false);assert.equal(prior.native[0].transaction_id,transaction);
 const originalResult=await read(path.join(path.dirname(fixture),'result.json'));
 assert.deepEqual(JSON.parse(originalResult),prior);
 const intent=JSON.parse(await read(path.join(fixture,'recovery',transaction,'intent.json')));
 assert.deepEqual(intent,JSON.parse(prior.native[0].stdout).intent);
 const before=await namespace();
 // Match every retained path/identity/hash against the original settled receipt.
 for(const name of ['workspace','recovery','outside'])assert.deepEqual(before[name].filter(row=>row.path!=='.').map(({mode,mtimeNs,ctimeNs,...row})=>row),prior.namespaceAfterInspect[name]);
 const request={protocol,operation:'inspect',transaction_id:transaction};
 const report={format:'gsa-retained-inspect-v1',state:'UNVERIFIED',activation:false,build,fixture,transaction_id:transaction,request,before,mutationInvocations:0,inspectInvocations:0};
 // The fixed durable slot is consumed before the sole native invocation. Never retry.
 await reserveAttempt(reservation,{format:'gsa-retained-inspect-reservation-v1',transaction_id:transaction,source_sha256:sourceHash,driver_sha256:sha(await fs.readFile(script)),staging,command,mutationInvocations:0,inspectInvocations:1});
 try{
  report.inspectInvocations=1;
  report.native=await run(binary,[],{input:JSON.stringify(request),fd:3});
  report.after=await namespace();assert.deepEqual(report.after,before);
  assert.equal(report.native.failure,null);assert.equal(report.native.code,0);assert.equal(report.native.signal,null);
  report.receipt=JSON.parse(report.native.stdout);validateReceipt(report.receipt,intent);
  assert.deepEqual(await read(path.join(path.dirname(fixture),'result.json')),originalResult);
  report.state='PASS_READONLY_RETAINED_INSPECT';
 }catch(error){report.failure=error.message;throw error;}
 finally{
  report.childCleanupUnverified=lifecycle.cleanupUnverified;
  if(!lifecycle.cleanupUnverified){report.after??=await namespace();if(JSON.stringify(report.after)!==JSON.stringify(before))report.state='BLOCKING_NAMESPACE_CHANGED';}
  await save(path.join(staging,'readback-result.json'),report);
  console.log(JSON.stringify({state:report.state,result:path.join(staging,'readback-result.json'),fixture,activation:false}));
 }
}

async function prepareAndRun(){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('APPLE_SILICON_MAC_REQUIRED');
 assert.equal(sha(await fs.readFile(source)),sourceHash);
 await fs.lstat(reservation).then(()=>{throw Error('READBACK_ALREADY_RESERVED');},error=>{if(error.code!=='ENOENT')throw error;});
 await safeDirectory(fixture);await safeDirectory(path.dirname(reservation));
 const staging=await fs.realpath(await fs.mkdtemp('/private/tmp/gsa-retained-inspect-'));
 await fs.chmod(staging,0o700);await fs.mkdir(path.join(staging,'owner'),{mode:0o700});
 const original=path.join(fixture,'installation/work/RecoveryBroker.app');
 const prior=JSON.parse(await read(evidence));
 const info=await read(path.join(original,'Contents/Info.plist'));
 assert.equal(sha(info),prior.signedArtifacts['Contents/Info.plist']);
 const entitlements=await read(path.join(fixture,'entitlements.plist'));
 await checked('/usr/bin/codesign',['--verify','--deep','--strict',original]);
 const originalSignedEntitlements=await checked('/usr/bin/codesign',['--display','--entitlements',':-',original]);
 const parsedInfo=JSON.parse(await checked('/usr/bin/plutil',['-convert','json','-o','-',path.join(original,'Contents/Info.plist')]));
 const parsedEntitlements=JSON.parse(await checked('/usr/bin/plutil',['-convert','json','-o','-',path.join(fixture,'entitlements.plist')]));
 assert.equal(parsedInfo.GSARecoveryProtocol,protocol);assert.equal(parsedInfo.GSAWorkspaceID,'work');assert.equal(parsedInfo.GSARevision,1);
 for(const [name,prefix] of [['workspace','GSA'],['recovery','GSARecovery']]){
  const root=path.join(fixture,name),s=await fs.stat(root,{bigint:true});
  assert.equal(parsedInfo[name==='workspace'?'GSAWorkspaceRoot':'GSARecoveryRoot'],root);
  assert.equal(parsedInfo[prefix+'Device'],String(s.dev));assert.equal(parsedInfo[prefix+'Inode'],String(s.ino));
 }
 assert.deepEqual(parsedEntitlements,{'com.apple.security.app-sandbox':true,'com.apple.security.temporary-exception.files.absolute-path.read-write':[path.join(fixture,'workspace')+'/',path.join(fixture,'recovery')+'/']});
 const app=path.join(staging,'RecoveryBroker.app'),contents=path.join(app,'Contents'),macos=path.join(contents,'MacOS');
 for(const dir of [app,contents,macos])await fs.mkdir(dir,{mode:0o700});
 await fs.writeFile(path.join(contents,'Info.plist'),info,{mode:0o600,flag:'wx'});
 const entitlementsPath=path.join(staging,'entitlements.plist');await fs.writeFile(entitlementsPath,entitlements,{mode:0o600,flag:'wx'});
 const binary=path.join(macos,'recovery-broker');
 const compiler=await checked('/usr/bin/swiftc',['--version']);
 await checked('/usr/bin/swiftc',[source,'-o',binary],{timeout:60000});await fs.chmod(binary,0o500);
 assert.equal(sha(await fs.readFile(source)),sourceHash);
 await checked('/usr/bin/codesign',['--force','--deep','--sign','-','--entitlements',entitlementsPath,app]);
 await checked('/usr/bin/codesign',['--verify','--deep','--strict',app]);
 assert.equal(await checked('/usr/bin/codesign',['--display','--entitlements',':-',app]),originalSignedEntitlements);
 const build={source_sha256:sourceHash,driver_sha256:sha(await fs.readFile(script)),signed_binary_sha256:sha(await read(binary)),info_sha256:sha(info),entitlements_sha256:sha(entitlements),compiler,hostRelease:os.release(),arch:process.arch,arguments:[source,'-o',binary],command,staging};
 await save(path.join(staging,'build.json'),build);
 // Launcher execs this script; all inner children inherit only the verified owner FD.
 const ownerResult=await run('/usr/bin/python3',[launcher,'--identity',path.join(staging,'owner'),'--node',process.execPath,'--entry',script],{env:{GSA_RETAINED_INSPECT_STAGING:staging},timeout:90000,owner:true});
 await save(path.join(staging,'owner-result.json'),ownerResult);
 assert.equal(ownerResult.failure,null);assert.equal(ownerResult.code,0);assert.equal(ownerResult.signal,null);
 console.log(JSON.stringify({staging,result:path.join(staging,'readback-result.json')}));
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length===0&&process.env.GSA_OWNER_LOCK_FD==='3')return inspectOnce(process.env.GSA_RETAINED_INSPECT_STAGING??'');
 if(args.length===0||args.length===1&&args[0]==='--plan'){console.log(JSON.stringify(await getPlan(),null,2));return;}
 if(args.length!==2||args[0]!=='--run-one'||args[1]!==acknowledgement)throw Error('INVALID_ARGUMENTS_OR_ACKNOWLEDGEMENT');
 await prepareAndRun();
}
// Terminate only the currently owned direct child; never discover/kill other PIDs.
if(process.argv[1]&&path.resolve(process.argv[1])===script){
 process.on('SIGTERM',()=>{if(activeChild&&activeChild.exitCode===null&&activeChild.signalCode===null)activeChild.kill('SIGKILL');process.exitCode=143;});
 main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
