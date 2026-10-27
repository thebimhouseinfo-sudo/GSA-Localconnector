// Actual AppKit/Node smoke test, isolated from live credentials and launch jobs.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createMacInstaller} from './mac-desktop-install.mjs';
import {runInstall} from './desktop-install.mjs';
import {createMacPrivateFile} from './mac-desktop-private-file.mjs';
import {saveDesktopConfig} from './desktop-config.mjs';
import {renderLaunchAgentPlist} from './mac-desktop-adapter.mjs';
import {randomUUID} from 'node:crypto';
import {createReleaseManifest} from './desktop-release.mjs';

const execute=promisify(execFile),sourceRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Native test requires Apple Silicon macOS');
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa desktop acceptance ')));
const home=path.join(root,'home'),privateFile=createMacPrivateFile();
await fs.mkdir(home,{mode:0o700});
const desktop=path.join(home,'Library/Application Support/GSA-Localconnector/desktop');
await fs.mkdir(desktop,{recursive:true,mode:0o700});
const envPath=path.join(desktop,'.env');
const values={tunnelId:'tunnel_0123456789abcdef0123456789abcdef',apiKey:'synthetic-native-only-do-not-log'};
await saveDesktopConfig({envPath,values,expectedIdentity:null,privateFile});
const original=(await privateFile.readVerified(envPath)).identity;
const client=path.join(root,'fixture-client');
await fs.writeFile(client,`#!/usr/bin/python3\nimport sys,time\nif '--help' in sys.argv:\n print('fixture --config string');sys.exit(0)\nprint('fixture tunnel started',flush=True)\nwhile True: time.sleep(1)\n`,{mode:0o700});
const fixtureBundleId=`com.gsa-localconnector.fixture.${randomUUID()}`;
function isolatedBundle(options){
 const build=options.platformAdapter.buildStage;
 options.platformAdapter.buildStage=async context=>{
  const stage=await build(context),bundle=path.join(stage.stageRoot,'GSA Local Connector.app');
  // Separate macOS identity prevents the real installed app from being activated
  // by the fixture's normal duplicate-instance protection. Product Swift is exact.
  const fixturePlist=path.join(bundle,'Contents/Info.plist');
  await fs.chmod(fixturePlist,0o600);
  await execute('/usr/bin/plutil',['-replace','CFBundleIdentifier','-string',fixtureBundleId,fixturePlist]);
  await fs.chmod(fixturePlist,0o400);
  await execute('/usr/bin/codesign',['--force','--sign','-','--timestamp=none',bundle]);
  const manifestPath=path.join(stage.stageRoot,'manifest.json'),previous=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  const manifest=await createReleaseManifest({sourceRoot:stage.stageRoot,platform:'darwin',arch:'arm64',version:stage.version,allowedFiles:Object.keys(previous.files)});
  await fs.chmod(manifestPath,0o600);await fs.writeFile(manifestPath,JSON.stringify(manifest));await fs.chmod(manifestPath,0o400);
  return stage;
 };
 return options;
}
const options=isolatedBundle(await createMacInstaller({home,sourceRoot,clientPath:client,registerLogin:false}));
let appPid,fixtureJob;const sentinel=spawn('/bin/sleep',['300'],{stdio:'ignore'});
async function killOwnedTree(pid){
 const ps=await execute('/bin/ps',['-o','pid=,ppid=','-ax']);
 const pairs=ps.stdout.split('\n').map(x=>x.trim().match(/^(\d+)\s+(\d+)$/)).filter(Boolean).map(x=>[Number(x[1]),Number(x[2])]);
 const owned=new Set([pid]);let changed=true;while(changed){changed=false;for(const [child,parent]of pairs)if(owned.has(parent)&&!owned.has(child)){owned.add(child);changed=true;}}
 for(const child of [...owned].reverse())try{process.kill(child,'SIGKILL');}catch{}
}
try{
 const installed=await runInstall({action:'install',...options});
 assert.equal(installed.state,'INSTALLED',JSON.stringify(installed));
 const current=JSON.parse(await fs.readFile(path.join(desktop,'runtime-current.json'),'utf8'));
 const status=JSON.parse(await fs.readFile(path.join(desktop,'status.json'),'utf8'));
 assert.equal(status.state,'RUNNING');
 appPid=current.appPid;
 assert.ok(appPid>0);process.kill(appPid,0);
 assert.equal((await privateFile.readVerified(envPath)).identity,original);
 const observer=path.join(root,'observe.swift'),observerBin=path.join(root,'observe');
 await fs.writeFile(observer,'import AppKit\nimport Foundation\nimport CoreGraphics\nlet p=pid_t(CommandLine.arguments[1])!\nguard let a=NSRunningApplication(processIdentifier:p) else {exit(2)}\nprint(a.activationPolicy.rawValue)\nlet windows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []\nprint(windows.filter {($0[kCGWindowOwnerPID as String] as? Int)==Int(p)}.count)\n');
 await execute('/usr/bin/swiftc',[observer,'-o',observerBin]);
 const observed=await execute(observerBin,[String(appPid)]);assert.equal(observed.stdout.trim().split('\n')[0],'1','menu bar app must use accessory activation policy');
 assert.equal(observed.stdout.trim().split('\n')[1],'0','saved setup must not present a setup/error window');
 const processList=await execute('/bin/ps',['-o','pid=,ppid=,comm=','-ax']);
 const rows=processList.stdout.split('\n').map(x=>x.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
 let nodeChild=rows.find(x=>Number(x[2])===appPid&&x[3].endsWith('/bin/node'));assert.ok(nodeChild,'native app must retain its bundled Node child');
 assert.equal(rows.some(x=>Number(x[2])===appPid&&/Terminal|\/bash$|\/zsh$/.test(x[3])),false);
 process.kill(sentinel.pid,0);
 const info=await fs.readFile(path.join(current.runtimeRoot,'GSA Local Connector.app/Contents/Info.plist'),'utf8');assert.match(info,/GSAConnector/);
 const safeStatus=await fs.readFile(path.join(desktop,'status.json'),'utf8');assert.equal(safeStatus.includes(values.apiKey),false);
 if(process.argv.includes('--update-fixture')){
  await killOwnedTree(appPid);appPid=undefined;
  await fs.unlink(path.join(home,'Applications/GSA Local Connector.app'));
  const updateOptions=isolatedBundle(await createMacInstaller({home,sourceRoot,clientPath:client,registerLogin:false}));
  const updated=await runInstall({action:'update',...updateOptions});
  assert.equal(updated.state,'INSTALLED',JSON.stringify(updated));
  const next=JSON.parse(await fs.readFile(path.join(desktop,'runtime-current.json'),'utf8'));appPid=next.appPid;
  const afterUpdate=await execute('/bin/ps',['-o','pid=,ppid=,comm=','-ax']);
  const nextRows=afterUpdate.stdout.split('\n').map(x=>x.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
  nodeChild=nextRows.find(x=>Number(x[2])===appPid&&x[3].endsWith('/bin/node'));assert.ok(nodeChild,'updated app retains its new bundled Node');
  assert.equal(nextRows.some(x=>Number(x[2])===appPid&&/Terminal|\/bash$|\/zsh$/.test(x[3])),false);
  assert.deepEqual((await execute(observerBin,[String(appPid)])).stdout.trim().split('\n'),['1','0']);
  assert.notEqual(next.id,current.id);
  assert.equal(await fs.readlink(path.join(home,'Applications/GSA Local Connector.app')),path.join(next.runtimeRoot,'GSA Local Connector.app'));
  assert.equal((await privateFile.readVerified(envPath)).identity,original);
  process.kill(sentinel.pid,0);
  console.log('PASS: native update restored missing app alias, launched new app, preserved saved env and neighbor');
 }
 let loginRegistration='NOT_EXECUTED';
 if(process.argv.includes('--login-fixture')){
  await killOwnedTree(appPid);appPid=undefined;
  const oldSession=status.sessionId;await fs.unlink(path.join(desktop,'status.json'));
  const fixtureLabel=`com.gsa-localconnector.fixture.${randomUUID()}`;
  const plist=path.join(root,'fixture.plist');
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const xml=renderLaunchAgentPlist({label:fixtureLabel,appPath:current.appPath,configPath:path.join(desktop,'config.json')})
   .replace('<key>RunAtLoad</key>',`<key>EnvironmentVariables</key><dict><key>HOME</key><string>${escape(home)}</string><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict><key>RunAtLoad</key>`);
  await fs.writeFile(plist,xml,{mode:0o600});await execute('/usr/bin/plutil',['-lint',plist]);
  fixtureJob=`gui/${process.getuid()}/${fixtureLabel}`;
  await execute('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,plist]);
  let reloaded;const deadline=Date.now()+15000;
  while(Date.now()<deadline){try{reloaded=JSON.parse(await fs.readFile(path.join(desktop,'status.json'),'utf8'));if(reloaded.state==='RUNNING'&&reloaded.sessionId!==oldSession)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(reloaded?.state,'RUNNING');assert.notEqual(reloaded.sessionId,oldSession);
  const job=await execute('/bin/launchctl',['print',fixtureJob]);appPid=Number(job.stdout.match(/\bpid = (\d+)/)?.[1]);assert.ok(appPid>0);
  const loginUI=await execute(observerBin,[String(appPid)]);assert.deepEqual(loginUI.stdout.trim().split('\n'),['1','0']);
  assert.equal((await privateFile.readVerified(envPath)).identity,original);process.kill(sentinel.pid,0);
  loginRegistration='TEMPORARY_RUNATLOAD_JOB_PASS';
 }
 console.log(JSON.stringify({state:'NATIVE_SMOKE_PASS',root,appPid,nodePid:Number(nodeChild[1]),accessoryMenuBarApp:true,noTerminalChild:true,savedEnvIdentityPreserved:true,noSetupWindow:true,neighborAlive:true,loginRegistration,fixtureJob:fixtureJob??null,realPlugin:'NOT_EXECUTED'}));
 if(process.argv.includes('--ui-fixture')){
  console.log(JSON.stringify({state:'UI_FIXTURE_READY',fixtureBundleId,appPath:path.join(current.runtimeRoot,'GSA Local Connector.app')}));
  await new Promise(resolve=>{process.stdin.once('data',resolve);process.stdin.once('end',resolve);process.stdin.resume();});process.stdin.pause();
 }
}finally{
 if(!appPid&&!fixtureJob)try{appPid=JSON.parse(await fs.readFile(path.join(desktop,'runtime-current.json'),'utf8')).appPid;}catch{}
 // Fixture-owned process tree only. No process-name matching or live job changes.
 let cleanupFailed=false;
 if(fixtureJob)try{await execute('/bin/launchctl',['bootout',fixtureJob]);}catch{
  try{await execute('/bin/launchctl',['print',fixtureJob]);cleanupFailed=true;}catch{}
 }
 else if(appPid)await killOwnedTree(appPid);
 // launchd bootout can leave a retained synthetic Node handling SIGTERM.
 // Reap only executables verified inside this disposable fixture directory.
 const remaining=(await execute('/bin/ps',['-axo','pid=,comm='])).stdout.split('\n').map(line=>line.trim().match(/^(\d+)\s+(.+)$/)).filter(Boolean);
 for(const row of remaining){let real;try{real=await fs.realpath(row[2]);}catch{continue;}if(real.startsWith(root+'/'))await killOwnedTree(Number(row[1]));}
 sentinel.kill('SIGTERM');
 if(cleanupFailed)throw Error(`FIXTURE_CLEANUP_FAILED: ${fixtureJob}; preserved ${root}`);
 // Preserve only sanitized output; generated fixture carries synthetic data only.
 await fs.rm(root,{recursive:true,force:true});
}
