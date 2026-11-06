#!/usr/bin/env node
// Hosted-only, fail-closed signed broker + actual owner coordinator interruption.
// No production identity, workspace or Mac user's installation is touched.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const source=path.resolve('native/macos-files/recovery-broker.swift');
const worker=fileURLToPath(new URL('./ci-mac-a-owner-recovery-worker.mjs',import.meta.url));
const launcher=fileURLToPath(new URL('./macos-owner-launcher.py',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const PFX='/private/tmp/gsa-ci-a-owner-';
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('BLOCKED C-A: real Darwin ARM64 required');
const root=await fs.realpath(await fs.mkdtemp(PFX));
await fs.chmod(root,0o700);
const identity=path.join(root,'identity'),work=path.join(root,'work'),recovery=path.join(root,'recovery');
const app=path.join(root,'RecoveryBroker.app'),macos=path.join(app,'Contents','MacOS');
for(const p of [identity,work,recovery,macos])await fs.mkdir(p,{recursive:true,mode:0o700});
await fs.writeFile(path.join(root,'outside'),'canary',{flag:'wx',mode:0o600});
const info={CFBundleIdentifier:'local.gsa.ci.recovery.'+sha(root).slice(0,20),
 CFBundleName:'RecoveryBroker',CFBundleExecutable:'recovery-broker',CFBundlePackageType:'APPL',
 GSARecoveryProtocol:'gsa-file-recovery-v1',GSAWorkspaceRoot:work,GSARecoveryRoot:recovery,
 GSAWorkspaceID:'work',GSARevision:1,
 GSADevice:String((await fs.stat(work)).dev),GSAInode:String((await fs.stat(work)).ino),
 GSARecoveryDevice:String((await fs.stat(recovery)).dev),GSARecoveryInode:String((await fs.stat(recovery)).ino)};
const xml=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const dict=o=>Object.entries(o).map(([k,v])=>'<key>'+xml(k)+'</key>'+(Array.isArray(v)?'<array>'+v.map(x=>'<string>'+xml(x)+'</string>').join('')+'</array>':typeof v==='boolean'?'<'+(v?'true':'false')+'/>':typeof v==='number'?'<integer>'+v+'</integer>':'<string>'+xml(v)+'</string>')).join('');
const plist=o=>'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>'+dict(o)+'</dict></plist>\n';
const bin=path.join(macos,'recovery-broker'),signFile=path.join(root,'entitlements.plist');
let stopVerified=false,passed=false,owned=false;
try{
 await fs.writeFile(path.join(app,'Contents','Info.plist'),plist(info),{mode:0o600});
 await fs.writeFile(signFile,plist({'com.apple.security.app-sandbox':true,
  'com.apple.security.temporary-exception.files.absolute-path.read-write':[work+'/',recovery+'/']}),{mode:0o600});
 function command(exe,args){
  const p=spawnSync(exe,args,{encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
  if(p.error||p.status!==0)throw Error('C-A native command failed '+exe+' '+String(p.stderr??p.error).slice(0,1200));
 }
 command('/usr/bin/swiftc',[source,'-o',bin]);
 await fs.chmod(bin,0o700);
 command('/usr/bin/codesign',['--force','--sign','-','--entitlements',signFile,app]);
 command('/usr/bin/codesign',['--verify','--strict',app]);
 // Node fixture is executed through the real Mac owner FD3 launcher.
 const child=spawn('/usr/bin/python3',[launcher,'--identity',identity,'--node',process.execPath,'--entry',worker],
  {shell:false,detached:true,stdio:['ignore','pipe','pipe'],
  env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',TMPDIR:'/private/tmp',LANG:'C',GSA_CI_A_ROOT:root}});
 owned=true;
 const leader=child.pid;
 if(!Number.isSafeInteger(leader)||leader<=1)throw Error('OWNER_PID_INVALID');
 let stdout='',stderr='',time,err=null;
 const finished=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{
   err=Error('OWNER_TIMEOUT; preserving evidence');
   // Terminate only the exact child process originally launched by this test,
   // never a foreign PID/group. Other descendants must be checked separately.
   try{child.kill('SIGTERM');}catch{}
  },90000);time=timer;
  child.stdout.on('data',part=>{stdout+=part;if(Buffer.byteLength(stdout)>65536){err=Error('OWNER_STDOUT_LIMIT');child.kill('SIGTERM');}});
  child.stderr.on('data',part=>{stderr+=part;if(Buffer.byteLength(stderr)>65536){err=Error('OWNER_STDERR_LIMIT');child.kill('SIGTERM');}});
  child.on('error',reject);
  child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});
 });
 if(err||finished.code!==0||finished.signal)throw Error('OWNER_NATIVE_FIXTURE_FAILED '+String(err??finished.code)+' '+stderr.slice(-1600));
 // Parent has reaped the precise owner launcher. Never infer escaped descendant
 // absence from group-only ESRCH; also inspect each spawned direct broker PID.
 const recorded=JSON.parse(await fs.readFile(path.join(root,'owned-child-pids.json'),'utf8'));
 assert.ok(Array.isArray(recorded)&&recorded.length===2);
 for(const pid of [leader,...recorded]){
  assert.ok(Number.isSafeInteger(pid)&&pid>1);
  try{process.kill(pid,0);throw Error('OWNED_PROCESS_STOP_UNVERIFIED '+pid);}
  catch(e){if(e.code!=='ESRCH')throw e;}
 }
 // Recorded child inventory exhausts the direct helper spawns in this worker.
 // No claim is made about escaping/untracked descendants of arbitrary binaries.
 try{process.kill(-leader,0);throw Error('OWNER_PROCESS_GROUP_STILL_PRESENT');}
 catch(e){if(e.code!=='ESRCH')throw e;}
 stopVerified=true;
 assert.equal(await fs.readFile(path.join(root,'outside'),'utf8'),'canary');
 const outcome=stdout.trim().split('\n').map(x=>{try{return JSON.parse(x);}catch{return null;}}).find(x=>x?.gate==='C-A-owner-native-coordinator');
 assert.equal(outcome?.state,'PASS');
 assert.equal(outcome.journalReadback,'APPLIED');
 assert.deepEqual(outcome.operations,['replace','inspect']);
 console.log(JSON.stringify({gate:'C-A-owner-interruption',state:'PASS',
   proof:'signed Swift broker + production FileTransactionStore/createMacFileRecovery + real FD3 owner; lost response/explicit inspect, direct helper physical stop; no mutation replay',
   ownerGroupAbsent:true,verifiedOwnedPids:[leader,...recorded],
   limitations:'checked installed-loader qualification and arbitrary escaped descendants not covered',
   sourceSha256:sha(await fs.readFile(source)),installedOnUserMac:false}));
 passed=true;
}finally{
 if(passed&&stopVerified){
  const old=await fs.lstat(root);
  if(old.isDirectory()&&!old.isSymbolicLink()&&await fs.realpath(root)===root&&old.uid===process.getuid())
   await fs.rm(root,{recursive:true});
  else throw Error('C-A disposable fixture root identity changed');
 }else console.error('BLOCKED C-A: preserved unresolved disposable fixture '+root);
}
