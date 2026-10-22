import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInstall, createReleaseManifest, verifyReleaseManifest } from '../scripts/desktop-install.mjs';
import {createMacInstaller} from '../scripts/mac-desktop-install.mjs';
import {createMacPrivateFile} from '../scripts/mac-desktop-private-file.mjs';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gsa installer test ')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function adapter(overrides = {}) {
  const calls = [];
  const api = {
    inspectHost: async () => ({ platform: 'darwin', arch: 'arm64', tools: { node: true, swift: true } }),
    inspectCurrent: async () => ({ state: 'EMPTY' }),
    buildStage: async () => { calls.push('build'); return { stageRoot: '/tmp/stage-fixture' }; },
    verifyStage: async () => { calls.push('verify'); return true; },
    activateStage: async () => { calls.push('activate'); },
    rollbackStage: async () => { calls.push('rollback'); },
    startApp: async () => { calls.push('start'); return true; },
    ensureLogin: async options => { calls.push(['login', options]); },
    stopOwned: async () => { calls.push('stop-owned'); return {stopped:true}; },
    removeManaged: async () => { calls.push('remove-managed'); },
    resolveEnvPath: async envPath => ({ path: envPath, identity: 'fixture-env-identity' }),
    ...overrides,
  };
  return { api, calls };
}

test('failed stage verification leaves the active pointer untouched', async t => {
  const root = await fixture(t);
  const pointer = path.join(root, 'runtime-current.json');
  await fs.writeFile(pointer, '{"id":"old-fixture"}');
  const { api, calls } = adapter({ inspectCurrent: async () => ({ state: 'VALID', pointer }), verifyStage: async () => { calls.push('verify'); return false; } });
  const result = await runInstall({ action: 'update', platformAdapter: api, sourceRoot: root, installRoot: path.join(root, 'install'), envPath: path.join(root, 'saved.env') });
  assert.equal(result.state, 'FAILED');
  assert.equal(await fs.readFile(pointer, 'utf8'), '{"id":"old-fixture"}');
  assert.deepEqual(calls, ['build', 'verify']);
});

test('unknown active ownership refuses without stopping or replacing anything', async t => {
  const root = await fixture(t);
  const { api, calls } = adapter({ inspectCurrent: async () => ({ state: 'UNKNOWN_ACTIVE' }) });
  const result = await runInstall({ action: 'update', platformAdapter: api, sourceRoot: root, installRoot: path.join(root, 'install'), envPath: path.join(root, 'saved.env') });
  assert.equal(result.state, 'FAILED');
  assert.equal(calls.includes('stop-owned'), false);
  assert.equal(calls.includes('build'), false);
});

test('stale active pointer refuses update before staging', async t => {
  const root = await fixture(t);
  const { api, calls } = adapter({ inspectCurrent: async () => ({ state: 'STALE_POINTER' }) });
  const result = await runInstall({ action: 'update', platformAdapter: api, sourceRoot: root, installRoot: path.join(root, 'install'), envPath: path.join(root, 'saved.env') });
  assert.equal(result.state, 'FAILED');
  assert.equal(calls.includes('build'), false);
  assert.equal(calls.includes('activate'), false);
});

test('start failure rolls back staged update and reports failure', async t => {
  const root = await fixture(t);
  const { api, calls } = adapter({ inspectCurrent: async () => ({ state: 'VALID', version: 'old' }), startApp: async () => false });
  const result = await runInstall({ action: 'update', platformAdapter: api, sourceRoot: root, installRoot: path.join(root, 'install'), envPath: path.join(root, 'saved.env') });
  assert.equal(result.state, 'FAILED');
  assert.ok(calls.includes('rollback'));
});

test('a partially failed activation still invokes rollback',async t=>{
 const root=await fixture(t);
 const {api,calls}=adapter({activateStage:async()=>{calls.push('partial-activate');throw Error('synthetic activation failure');}});
 const result=await runInstall({action:'install',platformAdapter:api,sourceRoot:root,installRoot:path.join(root,'install'),envPath:path.join(root,'saved.env')});
 assert.equal(result.state,'FAILED');assert.ok(calls.includes('rollback'));
});

test('concurrent Mac installers cannot both acquire the same installation', {skip:process.platform!=='darwin'},async t=>{
 const root=await fixture(t),home=path.join(root,'home');await fs.mkdir(home,{mode:0o700});
 const first=await createMacInstaller({home,sourceRoot:root,registerLogin:false});
 const second=await createMacInstaller({home,sourceRoot:root,registerLogin:false});
 try{
  assert.equal((await first.platformAdapter.inspectCurrent({action:'install'})).state,'EMPTY');
  assert.equal((await second.platformAdapter.inspectCurrent({action:'install'})).state,'UNKNOWN_ACTIVE');
 }finally{await first.platformAdapter.releaseInstall?.();await second.platformAdapter.releaseInstall?.();}
});

test('uninstall refuses a replaced LaunchAgent before removing the managed app or runtime', {skip:process.platform!=='darwin'},async t=>{
 const root=await fixture(t),home=path.join(root,'home');await fs.mkdir(home,{mode:0o700});
 const options=await createMacInstaller({home,sourceRoot:root,registerLogin:true});
 const runtimeRoot=path.join(options.installRoot,'runtimes','fixture-runtime');
 await fs.mkdir(path.join(runtimeRoot,'GSA Local Connector.app'),{recursive:true,mode:0o700});
 const appPath=path.join(home,'Applications/GSA Local Connector.app');await fs.mkdir(path.dirname(appPath),{recursive:true});await fs.symlink(path.join(runtimeRoot,'GSA Local Connector.app'),appPath);
 const desktop=path.join(options.installRoot,'desktop');await fs.mkdir(desktop,{mode:0o700});
 for(const name of ['config.json','runtime-current.json'])await fs.writeFile(path.join(desktop,name),'{}',{mode:0o600});
 const plist=path.join(home,'Library/LaunchAgents/com.gsa-localconnector.mac.plist');await fs.mkdir(path.dirname(plist),{recursive:true});
 const unrelated='<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>com.unrelated.user</string><key>ProgramArguments</key><array><string>/unrelated/user/program</string></array></dict></plist>';
 await fs.writeFile(plist,unrelated,{mode:0o600});
 await assert.rejects(options.platformAdapter.removeManaged({state:'VALID',runtimeRoot}));
 assert.equal(await fs.readFile(plist,'utf8'),unrelated);assert.ok((await fs.lstat(appPath)).isSymbolicLink());assert.ok((await fs.stat(runtimeRoot)).isDirectory());
});

test('update recovers an absent app alias only from a fully verified owned installation', {skip:process.platform!=='darwin'},async t=>{
 const root=await fixture(t),home=path.join(root,'home');await fs.mkdir(home,{mode:0o700});
 const options=await createMacInstaller({home,sourceRoot:root,registerLogin:false});
 const id='01234567-1234-1234-1234-0123456789ab',runtimeRoot=path.join(options.installRoot,'runtimes',id);
 await fs.mkdir(path.join(runtimeRoot,'GSA Local Connector.app'),{recursive:true,mode:0o700});
 await fs.writeFile(path.join(runtimeRoot,'GSA Local Connector.app','fixture'),'synthetic application');
 const manifest=await createReleaseManifest({sourceRoot:runtimeRoot,platform:'darwin',arch:'arm64',version:'fixture',allowedFiles:['GSA Local Connector.app/fixture']});
 await fs.writeFile(path.join(runtimeRoot,'manifest.json'),JSON.stringify(manifest));
 const desktop=path.join(options.installRoot,'desktop'),appPath=path.join(home,'Applications/GSA Local Connector.app');
 await fs.mkdir(desktop,{mode:0o700});await fs.mkdir(path.dirname(appPath),{recursive:true});
 const file=createMacPrivateFile(),envPath=path.join(desktop,'.env');
 await file.replaceVerified(path.join(desktop,'runtime-current.json'),Buffer.from(JSON.stringify({id,runtimeRoot,appPath,envPath,loginPreference:true})),null);
 await file.replaceVerified(path.join(desktop,'config.json'),Buffer.from(JSON.stringify({runtimeRoot,envPath})),null);
 try{
  assert.equal((await options.platformAdapter.inspectCurrent({action:'update'})).state,'VALID');
  await fs.mkdir(appPath);
  assert.equal((await options.platformAdapter.inspectCurrent({action:'update'})).state,'STALE_POINTER','foreign entry must refuse');
  await fs.rmdir(appPath);
  await fs.writeFile(path.join(runtimeRoot,'GSA Local Connector.app','fixture'),'tampered');
  assert.equal((await options.platformAdapter.inspectCurrent({action:'update'})).state,'STALE_POINTER','damaged release must refuse');
 }finally{await options.platformAdapter.releaseInstall();}
});

test('first install enables login startup and existing configuration path is passed through without reading its key', async t => {
  const root = await fixture(t);
  const configured = path.join(root, 'existing configuration', '.env');
  const { api, calls } = adapter({ resolveEnvPath: async envPath => ({ path: envPath, identity: 'stable-config-identity' }) });
  await runInstall({ action: 'install', platformAdapter: api, sourceRoot: root, installRoot: path.join(root, 'install with spaces'), envPath: configured });
  assert.deepEqual(calls.find(x => Array.isArray(x) && x[0] === 'login'), ['login', { firstInstall: true, existingPreference: null }]);
  assert.equal(calls.includes('read-key'), false);
});

test('doctor reports missing host capability without attempting automatic installation or reading the key', async t => {
  const root = await fixture(t);
  const { api, calls } = adapter({ inspectHost: async () => ({ platform: 'darwin', arch: 'arm64', tools: { swift: false } }) });
  const result = await runInstall({ action: 'doctor', platformAdapter: api, sourceRoot: root, installRoot: path.join(root, 'install'), envPath: path.join(root, 'saved.env') });
  assert.equal(result.state, 'FAILED');
  assert.equal(calls.includes('build'), false);
  assert.equal(calls.includes('read-key'), false);
});

test('repair preserves existing login preference and saved config identity', async t => {
  const root = await fixture(t);
  const { api, calls } = adapter({ inspectCurrent: async () => ({ state: 'VALID', loginPreference: false, envIdentity: 'stable-config-identity' }) });
  await runInstall({ action: 'repair', platformAdapter: api, sourceRoot: root, installRoot: path.join(root, 'install'), envPath: path.join(root, 'saved.env') });
  assert.deepEqual(calls.find(x => Array.isArray(x) && x[0] === 'login'), ['login', { firstInstall: false, existingPreference: false }]);
});

test('uninstall removes managed runtime and keeps local configuration', async t => {
  const root = await fixture(t);
  const configured = path.join(root, 'saved.env');
  await fs.writeFile(configured, 'CONTROL_PLANE_API_KEY=synthetic-installer-sentinel');
  const { api, calls } = adapter({ inspectCurrent: async () => ({ state: 'VALID' }) });
  await runInstall({ action: 'uninstall', platformAdapter: api, sourceRoot: root, installRoot: path.join(root, 'install'), envPath: configured });
  assert.equal(await fs.readFile(configured, 'utf8'), 'CONTROL_PLANE_API_KEY=synthetic-installer-sentinel');
  assert.ok(calls.includes('remove-managed'));
});

test('manifest allowlist excludes credentials, traversal, links and unlisted files', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'bin'));
  await fs.writeFile(path.join(root, 'bin', 'app'), 'synthetic-app');
  await fs.writeFile(path.join(root, '.env'), 'synthetic-installer-sentinel');
  const manifest = await createReleaseManifest({ sourceRoot: root, platform: 'darwin', arch: 'arm64', version: 'fixture', allowedFiles: ['bin/app'] });
  const releaseRoot=path.join(root,'release');await fs.mkdir(path.join(releaseRoot,'bin'),{recursive:true});
  await fs.copyFile(path.join(root,'bin/app'),path.join(releaseRoot,'bin/app'));
  assert.equal(await verifyReleaseManifest({ releaseRoot, manifest }), true);
  await assert.rejects(createReleaseManifest({ sourceRoot: root, platform: 'darwin', arch: 'arm64', version: 'fixture', allowedFiles: ['bin/app', '.env'] }));
  await assert.rejects(createReleaseManifest({ sourceRoot: root, platform: 'darwin', arch: 'arm64', version: 'fixture', allowedFiles: ['../outside'] }));
  await fs.writeFile(path.join(releaseRoot, 'extra'), 'unlisted');
  await assert.rejects(verifyReleaseManifest({ releaseRoot, manifest }));
  await fs.unlink(path.join(releaseRoot,'extra'));
  await fs.writeFile(path.join(releaseRoot, 'bin', 'app'), 'altered');
  await assert.rejects(verifyReleaseManifest({ releaseRoot, manifest }));
  assert.equal(JSON.stringify(manifest).includes('synthetic-installer-sentinel'), false);
});
