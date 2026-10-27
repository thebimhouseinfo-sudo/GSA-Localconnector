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
  assert.deepEqual(results,Array(3).fill({state:'RUNNING',connection:'CONNECTING'}));
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
