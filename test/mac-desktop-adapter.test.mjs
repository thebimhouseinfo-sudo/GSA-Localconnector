import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { MacDesktopAdapter, ensureLogin, renderLaunchAgentPlist } from '../scripts/mac-desktop-adapter.mjs';

test('first install enables launch at login and updates preserve the saved preference', () => {
  assert.equal(ensureLogin({ firstInstall: true, existingPreference: null }), true);
  assert.equal(ensureLogin({ firstInstall: false, existingPreference: false }), false);
  assert.equal(ensureLogin({ firstInstall: false, existingPreference: true }), true);
});

test('LaunchAgent starts the app bundle executable directly with nonsecret config path', () => {
  const plist = renderLaunchAgentPlist({
    label: 'com.example.fixture',
    appPath: '/tmp/Fixture & Test/GSA Local Connector.app',
    configPath: '/tmp/Fixture & Test/private/config.json',
  });
  assert.match(plist, /<plist version="1\.0">/);
  assert.match(plist, /<string>com\.example\.fixture<\/string>/);
  assert.match(plist, /GSA Local Connector\.app\/Contents\/MacOS\/GSA Local Connector/);
  assert.match(plist, /--desktop-config/);
  assert.match(plist, /<true\/>/);
  assert.match(plist, /&amp;/);
  assert.doesNotMatch(plist, /CONTROL_PLANE_API_KEY|sk-[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(plist, /Terminal\.app|osascript|bash|zsh/);
});

test('rejects missing or unsafe launch paths instead of rendering a partial agent', () => {
  assert.throws(() => renderLaunchAgentPlist({ label: 'bad label', appPath: '/Applications/A.app', configPath: '/tmp/c.json' }));
  assert.throws(() => renderLaunchAgentPlist({ label: 'com.example.fixture', appPath: '', configPath: '/tmp/c.json' }));
});

test('overlapping slow status probes publish once and future refreshes still work',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-status-overlap-')));
 try{
  const statusPath=path.join(root,'status.json'),adapter=new MacDesktopAdapter({configPath:path.join(root,'config.json')});
  let release,count=0;
  const waiting=new Promise(resolve=>{release=resolve;});
  adapter.config={statusPath};
  adapter.runtime={status:async()=>{count++;await waiting;return {state:'RUNNING',connection:'CONNECTING'};}};
  const requests=Array.from({length:3},()=>adapter.publishStatus());
  release();
  const results=await Promise.all(requests);
  assert.equal(count,1);
  assert.deepEqual(results,Array(3).fill({state:'RUNNING',connection:'CONNECTING',desktopPaused:false}));
  adapter.runtime={status:async()=>({state:'RUNNING',connection:'CONNECTED'})};
  await adapter.publishStatus();
  assert.equal(JSON.parse(await fs.readFile(statusPath,'utf8')).connection,'CONNECTED');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('stage readiness requires the same installation for both successful states',async()=>{
 const {isStageReady}=await import('../scripts/mac-desktop-install.mjs');
 for(const state of ['RUNNING','SETUP_REQUIRED']){
  assert.equal(isStageReady({installationId:'current-stage',state},'current-stage'),true);
  assert.equal(isStageReady({installationId:'old-stage',state},'current-stage'),false);
  assert.equal(isStageReady({state},'current-stage'),false);
 }
 for(const state of ['STARTING','FAILED','STOPPED'])assert.equal(isStageReady({installationId:'current-stage',state},'current-stage'),false);
});

test('blocked Quit status is published without changing runtime state; retry can replace outcome',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-quit-outcome-')));
 try{
  const statusPath=path.join(root,'status.json'),adapter=new MacDesktopAdapter({configPath:path.join(root,'config.json')});
  adapter.config={statusPath};
  adapter.runtime={status:async()=>({state:'RUNNING',connection:'CONNECTED'})};
  adapter.quitOutcome={stopAttempt:1,stopBlockedReason:'ACTIVE_WORK_UNKNOWN'};
  const denied=await adapter.publishStatus();
  assert.deepEqual(denied,{state:'RUNNING',connection:'CONNECTED',desktopPaused:false,stopAttempt:1,stopBlockedReason:'ACTIVE_WORK_UNKNOWN'});
  assert.deepEqual(JSON.parse(await fs.readFile(statusPath,'utf8')),denied);
  adapter.quitOutcome={stopAttempt:2,stopBlockedReason:'ACTIVE_WORK_PRESENT'};
  assert.equal((await adapter.publishStatus()).stopAttempt,2);
  assert.equal(JSON.parse(await fs.readFile(statusPath,'utf8')).stopBlockedReason,'ACTIVE_WORK_PRESENT');
  adapter.quitOutcome={stopAttempt:3,stopBlockedReason:null};
  adapter.runtime={status:async()=>({state:'STOPPED',connection:'DISCONNECTED'})};
  assert.deepEqual(await adapter.publishStatus(),{state:'STOPPED',connection:'DISCONNECTED',desktopPaused:false,stopAttempt:3,stopBlockedReason:null});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});


test('menu registration cleanup reports stale/revoked counts and preserves running session',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-menu-prune-')));
 try{
  const statusPath=path.join(root,'status.json');
  let runs=0;
  const adapter=new MacDesktopAdapter({configPath:path.join(root,'config.json'),registrationPruner:async()=>{
    runs++;
    return {removed_stale:6,removed_revoked:2,retained_active:2,retained_reauth_required:0};
  }});
  adapter.config={directory:root,statusPath};
  adapter.runtime={status:async()=>({state:'RUNNING',connection:'CONNECTED'})};
  const first=await adapter.pruneInactiveRegistrations();
  assert.equal(first.registrationPruneStatus,'DONE');
  assert.equal(first.registrationPruneAttempt,1);
  assert.deepEqual(first.registrationPruneSummary,{removed_stale:6,removed_revoked:2,retained_active:2,retained_reauth_required:0});
  assert.equal(JSON.parse(await fs.readFile(statusPath,'utf8')).registrationPruneStatus,'DONE');
  assert.equal(runs,1,'no owner process or tunnel is stopped by this operation');
  const second=await adapter.pruneInactiveRegistrations();
  assert.equal(second.registrationPruneAttempt,2);
  assert.equal(runs,2,'each explicit menu request has one serial pruner invocation');
  adapter.runtime={status:async()=>({state:'STOPPED',connection:'DISCONNECTED'})};
  const stopped=await adapter.pruneInactiveRegistrations();
  assert.equal(stopped.registrationPruneStatus,'FAILED');
  assert.equal(stopped.registrationPruneAttempt,3);
  assert.equal(runs,2,'stopped app must not mutate protected registrations');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('menu registration cleanup fail-closed result is reported without leaking private errors',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-menu-prune-denied-')));
 try{
  const adapter=new MacDesktopAdapter({configPath:path.join(root,'config.json'),registrationPruner:async()=>{throw Object.assign(Error('private folder path'),{code:'GRANT_STORE_BUSY'});}});
  adapter.config={directory:root,statusPath:path.join(root,'status.json')};
  adapter.runtime={status:async()=>({state:'RUNNING',connection:'CONNECTED'})};
  const result=await adapter.pruneInactiveRegistrations();
  assert.equal(result.registrationPruneStatus,'FAILED');
  assert.equal(result.registrationPruneReason,'GRANT_STORE_BUSY');
  assert.doesNotMatch(JSON.stringify(result),/private folder path/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('menu Pause/Resume only changes private admission state; no process is killed',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-menu-pause-')));
 await fs.chmod(root,0o700);
 try{
  const statusPath=path.join(root,'status.json');
  const adapter=new MacDesktopAdapter({configPath:path.join(root,'config.json')});
  adapter.config={directory:root,statusPath};
  const events=[];
  adapter.runtime={status:async()=>({state:'RUNNING',connection:'CONNECTED'})};
  const paused=await adapter.setPaused(true);
  assert.equal(paused.desktopPaused,true);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'pause-state.json'),'utf8')).paused,true);
  assert.equal(JSON.parse(await fs.readFile(statusPath,'utf8')).desktopPaused,true);
  const resumed=await adapter.setPaused(false);
  assert.equal(resumed.desktopPaused,false);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'pause-state.json'),'utf8')).paused,false);
  adapter.runtime={status:async()=>({state:'STOPPED',connection:'DISCONNECTED'})};
  await assert.rejects(adapter.setPaused(true),/DESKTOP_NOT_RUNNING/);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'pause-state.json'),'utf8')).paused,false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
