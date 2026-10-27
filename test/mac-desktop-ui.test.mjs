import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {createReleaseManifest} from '../scripts/desktop-release.mjs';
import {describeUiIntent, selectCompatibleUi, selectLegacyUiDescriptor, copyVerifiedUi, recordBuiltUi, legacyUiProfile, currentUiProfile, validateLegacyUiDescriptor, uiBundleFiles} from '../scripts/mac-desktop-ui.mjs';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gsa desktop ui test ')));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const files = {
    'native/macos-desktop/App.swift': 'synthetic swift app',
    'native/macos-desktop/Info.plist': '<plist>synthetic</plist>',
    'scripts/build-desktop-icons.mjs': 'synthetic icon builder',
    'assets/desktop/LICENSE': 'synthetic license',
    'assets/desktop/plug-zap.svg': '<svg>synthetic icon</svg>',
  };
  for (const [relative, contents] of Object.entries(files)) {
    const destination = path.join(root, relative);
    await fs.mkdir(path.dirname(destination), {recursive:true});
    await fs.writeFile(destination, contents);
  }
  return {root, files};
}

const uiInputFiles=[
  'native/macos-desktop/App.swift',
  'native/macos-desktop/Info.plist',
  'scripts/build-desktop-icons.mjs',
  'assets/desktop/LICENSE',
  'assets/desktop/plug-zap.svg',
];

async function actualUiInputsFixture(t) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa ui inputs ')));
  await fs.chmod(root,0o700);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const relative of uiInputFiles){
    const destination=path.join(root,relative);
    await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
    await fs.copyFile(path.resolve(relative),destination);
    await fs.chmod(destination,0o600);
  }
  return root;
}

test('UI intent binds every UI input and the exact config resource path', async t => {
  const {root} = await fixture(t);
  const configPath = path.join(root, 'private config', 'config.json');
  const intent = await describeUiIntent({sourceRoot:root, configPath});
  assert.equal(intent.format, 'gsa-desktop-ui-intent-v1');
  assert.equal(intent.configPath, configPath);
  for (const relative of [
    'native/macos-desktop/App.swift',
    'native/macos-desktop/Info.plist',
    'scripts/build-desktop-icons.mjs',
    'assets/desktop/LICENSE',
    'assets/desktop/plug-zap.svg',
  ]) {
    assert.match(intent.files[relative], /^[a-f0-9]{64}$/, `intent must hash ${relative}`);
  }
  assert.match(intent.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(intent.target);
  assert.ok(intent.recipe);
});

function commandFor(identity, calls=[]) {
  return async (executable, args) => {
    calls.push([executable, [...args]]);
    if (args.includes('--verify')) return {stdout:'', stderr:''};
    return {stdout:`Identifier=${identity.identifier}\nCDHash=${identity.cdhash}\n# designated => ${identity.designatedRequirement}\n`, stderr:''};
  };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function releaseFixture(t) {
  const {root} = await fixture(t);
  const home = path.join(root, 'managed');
  const installRoot = path.join(home, 'GSA-Localconnector');
  const runtimes = path.join(installRoot, 'runtimes');
  await fs.mkdir(runtimes, {recursive:true, mode:0o700});
  await fs.chmod(home, 0o700); await fs.chmod(installRoot, 0o700); await fs.chmod(runtimes, 0o700);
  const runtimeId = '508bf766-23c5-4cac-9e8c-81731203957e';
  const runtimeRoot = path.join(runtimes, runtimeId);
  const bundle = path.join(runtimeRoot, 'GSA Local Connector.app');
  const configPath=path.join(root, 'managed config', 'config.json');
  const intent = await describeUiIntent({sourceRoot:root, configPath});
  for (const rel of uiBundleFiles) {
    const destination = path.join(bundle, rel);
    await fs.mkdir(path.dirname(destination), {recursive:true, mode:0o700});
    const bytes = rel==='Contents/Info.plist' ? await fs.readFile(path.join(root,'native/macos-desktop/Info.plist'))
      : rel==='Contents/Resources/Icon-LICENSE.txt' ? await fs.readFile(path.join(root,'assets/desktop/LICENSE'))
      : rel==='Contents/Resources/desktop-config-path.txt' ? Buffer.from(configPath)
      : Buffer.from(`synthetic signed bundle file: ${rel}`);
    await fs.writeFile(destination, bytes, {mode:rel.includes('/MacOS/')?0o500:0o400});
  }
  const identity = {identifier:'com.gsa-localconnector.mac.desktop', cdhash:'0123456789abcdef0123456789abcdef01234567', designatedRequirement:'cdhash H"0123456789abcdef0123456789abcdef01234567"'};
  const calls=[];
  const provenance = await recordBuiltUi({bundle, intent, command:commandFor(identity,calls), buildMetadata:{compilerVersion:'fixture-swiftc'}});
  await fs.writeFile(path.join(runtimeRoot, 'ui-provenance.json'), JSON.stringify(provenance), {mode:0o400});
  const allowedFiles=[];
  async function walk(dir,prefix='') { for (const name of await fs.readdir(dir)) { const rel=prefix?`${prefix}/${name}`:name; const p=path.join(dir,name); if ((await fs.lstat(p)).isDirectory()) await walk(p,rel); else if(rel!=='manifest.json') allowedFiles.push(rel); } }
  await walk(runtimeRoot);
  const manifest=await createReleaseManifest({sourceRoot:runtimeRoot,platform:'darwin',arch:'arm64',version:runtimeId,allowedFiles});
  await fs.writeFile(path.join(runtimeRoot,'manifest.json'),JSON.stringify(manifest),{mode:0o400});
  return {root,installRoot,runtimeId,runtimeRoot,bundle,intent,identity,provenance,manifest,calls};
}

async function replacePrivate(file, bytes, mode=0o400) {
  await fs.chmod(file,0o600);
  try { await fs.writeFile(file,bytes); }
  finally { await fs.chmod(file,mode); }
}

test('a backend-only runtime update reuses exact UI bytes and verifies the signed identity without build tools', async t => {
  const f=await releaseFixture(t);
  const selection=await selectCompatibleUi({installRoot:f.installRoot,currentRelease:{state:'VALID',id:f.runtimeId,runtimeRoot:f.runtimeRoot},intent:f.intent});
  assert.equal(selection.decision,'reuse');
  assert.equal(selection.releaseId,f.runtimeId);
  const destination=path.join(f.root,'new-stage','GSA Local Connector.app');
  await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700}); await fs.chmod(path.dirname(path.dirname(destination)),0o700);
  const calls=[];
  const result=await copyVerifiedUi({selection,destinationBundle:destination,command:commandFor(f.identity,calls)});
  assert.equal(result.origin,'observed-local-build');
  assert.equal(result.reusedFrom.releaseId,f.runtimeId);
  assert.equal(calls.length,4);
  assert.ok(calls.every(([,args])=>args[0]==='--verify'||args[0]==='--display'));
  for (const rel of uiBundleFiles) {
    assert.deepEqual(await fs.readFile(path.join(destination,rel)),await fs.readFile(path.join(f.bundle,rel)),rel);
    assert.equal((await fs.stat(path.join(destination,rel))).mode & 0o777,rel.includes('/MacOS/')?0o500:0o400,rel);
  }
});

test('a second backend update reuses the persisted UI receipt from the first updated runtime', async t => {
  const f=await releaseFixture(t);
  const first=await selectCompatibleUi({installRoot:f.installRoot,currentRelease:{state:'VALID',id:f.runtimeId,runtimeRoot:f.runtimeRoot},intent:f.intent});
  const secondId='fedcba98-7654-4321-8765-fedcba987654';
  const secondRoot=path.join(f.installRoot,'runtimes',secondId);
  await fs.mkdir(secondRoot,{mode:0o700});
  const secondBundle=path.join(secondRoot,'GSA Local Connector.app');
  const persisted=await copyVerifiedUi({selection:first,destinationBundle:secondBundle,command:commandFor(f.identity)});
  await fs.writeFile(path.join(secondRoot,'ui-provenance.json'),JSON.stringify(persisted),{mode:0o400});
  await fs.writeFile(path.join(secondRoot,'backend-marker'),'second backend release',{mode:0o400});
  const allowedFiles=[];
  async function walk(dir,prefix=''){for(const name of await fs.readdir(dir)){const rel=prefix?`${prefix}/${name}`:name,p=path.join(dir,name);if((await fs.lstat(p)).isDirectory())await walk(p,rel);else allowedFiles.push(rel);}}
  await walk(secondRoot);
  const manifest=await createReleaseManifest({sourceRoot:secondRoot,platform:'darwin',arch:'arm64',version:secondId,allowedFiles});
  await fs.writeFile(path.join(secondRoot,'manifest.json'),JSON.stringify(manifest),{mode:0o400});
  const selectedAgain=await selectCompatibleUi({installRoot:f.installRoot,currentRelease:{state:'VALID',id:secondId,runtimeRoot:secondRoot},intent:f.intent});
  assert.equal(selectedAgain.decision,'reuse');
  assert.equal(selectedAgain.releaseId,secondId);
  assert.equal(selectedAgain.provenance.reusedFrom.releaseId,f.runtimeId);
  assert.deepEqual(selectedAgain.provenance.artifact.files,persisted.artifact.files);
  assert.equal(selectedAgain.provenance.sourceBuildAttestation,'observed-local-build');
});

test('the valid current 508bf UI receipt wins before the pinned 55ad fallback is considered', async t => {
  const f=await releaseFixture(t);
  const legacy=legacyUiProfile();
  const legacyRoot=path.join(f.installRoot,'runtimes',legacy.releaseId);
  await fs.mkdir(legacyRoot,{mode:0o700});
  await fs.writeFile(path.join(legacyRoot,'manifest.json'),'deliberately irrelevant sibling',{mode:0o400});
  const selected=await selectCompatibleUi({installRoot:f.installRoot,currentRelease:{state:'VALID',id:f.runtimeId,runtimeRoot:f.runtimeRoot},intent:f.intent});
  assert.equal(selected.decision,'reuse');
  assert.equal(selected.releaseId,'508bf766-23c5-4cac-9e8c-81731203957e');
  assert.equal(selected.provenance.origin,'observed-local-build');
});

test('a changed UI intent refuses stale reuse, while backend runtime identity is not part of the intent', async t => {
  const f=await releaseFixture(t);
  const changed=await describeUiIntent({sourceRoot:f.root,configPath:path.join(f.root,'different-config.json')});
  const selection=await selectCompatibleUi({installRoot:f.installRoot,currentRelease:{state:'VALID',id:f.runtimeId,runtimeRoot:f.runtimeRoot},intent:changed});
  assert.deepEqual(selection,{decision:'build',reason:'UI_INTENT_CHANGED'});
  assert.equal(f.intent.fingerprint, (await describeUiIntent({sourceRoot:f.root,configPath:path.join(f.root,'managed config','config.json')})).fingerprint);
  assert.notEqual(f.runtimeId,'fedcba98-7654-4321-8765-fedcba987654');
});

function intentForProfile(profile) {
  const body={format:'gsa-desktop-ui-intent-v1',files:profile.inputs,configPath:profile.configPath,target:'arm64-apple-macos13.0',recipe:'gsa-native-menu-ui-v1'};
  return {...body,fingerprint:createHash('sha256').update(canonical(body)).digest('hex')};
}

test('fixed 508bf and 55ad descriptors preserve unavailable attestation, and a genuine UI intent change selects build', async t => {
  for(const profile of [currentUiProfile(),legacyUiProfile()]) await t.test(profile.profile,async t2=>{
    const desiredIntent=intentForProfile(profile);
    const descriptor={releaseId:profile.releaseId,manifestSha256:profile.manifestSha256,files:profile.files,identity:profile.identity,desiredIntent};
    const decision=selectLegacyUiDescriptor({descriptor,intent:desiredIntent});
    assert.equal(decision.decision,'reuse');
    assert.equal(decision.provenance.origin,'reviewed-legacy-artifact-adoption');
    assert.equal(decision.provenance.sourceBuildAttestation,'unavailable');
    assert.equal(decision.provenance.legacy.profile,profile.profile);
    assert.throws(()=>validateLegacyUiDescriptor({...descriptor,manifestSha256:'0'.repeat(64)}),{code:'UI_LEGACY_MISMATCH'});
    assert.throws(()=>validateLegacyUiDescriptor({...descriptor,identity:{...profile.identity,designatedRequirement:'identifier "com.gsa-localconnector.mac.desktop"'}}),{code:'UI_LEGACY_MISMATCH'});
    const sourceRoot=await actualUiInputsFixture(t2);
    const actualIntent=await describeUiIntent({sourceRoot,configPath:profile.configPath});
    assert.equal(actualIntent.fingerprint,desiredIntent.fingerprint,'copied UI sources must reproduce the pinned intent');
    const app=path.join(sourceRoot,'native/macos-desktop/App.swift');
    const original=await fs.readFile(app);
    await fs.chmod(app,0o600);await fs.writeFile(app,Buffer.concat([original,Buffer.from('\nchanged in disposable fixture')]));
    await fs.chmod(app,0o600);
    const changedIntent=await describeUiIntent({sourceRoot,configPath:profile.configPath});
    assert.notEqual(changedIntent.fingerprint,actualIntent.fingerprint);
    assert.deepEqual(selectLegacyUiDescriptor({descriptor,intent:changedIntent}),{decision:'build',reason:'UI_INTENT_CHANGED'});
    const {root}=await fixture(t2);
    const persisted=path.join(root,'ui-provenance.json');
    await fs.writeFile(persisted,JSON.stringify(decision.provenance),{mode:0o400});
    assert.deepEqual(JSON.parse(await fs.readFile(persisted,'utf8')),decision.provenance);
  });
});

test('built UI provenance refuses mismatched Info.plist, license, or config resource bytes', async t => {
  const targets=['Contents/Info.plist','Contents/Resources/Icon-LICENSE.txt','Contents/Resources/desktop-config-path.txt'];
  for(const rel of targets) await t.test(rel,async t2=>{
    const f=await releaseFixture(t2);
    await replacePrivate(path.join(f.bundle,rel),'changed resource');
    await assert.rejects(recordBuiltUi({bundle:f.bundle,intent:f.intent,command:commandFor(f.identity)}),{code:'UI_RESOURCE_INTENT_MISMATCH'});
  });
});

test('an absent current artifact requests a build instead of admitting an unknown legacy bundle', async t => {
  const f=await releaseFixture(t);
  const selection=await selectCompatibleUi({installRoot:f.installRoot,currentRelease:{state:'EMPTY'},intent:f.intent});
  assert.deepEqual(selection,{decision:'build',reason:'FIRST_INSTALL'});
});

test('missing or tampered bundle bytes, symlinks, hardlinks, and special files fail release admission', async t => {
  for (const kind of ['missing','tamper','symlink','hardlink','socket']) {
    await t.test(kind, async t2 => {
      const f=await releaseFixture(t2);
      const target=path.join(f.bundle,uiBundleFiles[0]);
      let server;
      if(kind==='missing') await fs.unlink(target);
      if(kind==='tamper') await replacePrivate(target,'changed after release manifest');
      if(kind==='symlink') { await fs.unlink(target); await fs.symlink(path.join(f.root,'outside'),target); }
      if(kind==='hardlink') { const outside=path.join(f.root,'linked-outside'); await fs.writeFile(outside,'outside'); await fs.unlink(target); await fs.link(outside,target); }
      if(kind==='socket') {
        const socketRoot=await fs.realpath(await fs.mkdtemp('/tmp/g-'));
        await fs.chmod(socketRoot,0o700);t2.after(()=>fs.rm(socketRoot,{recursive:true,force:true}));
        const boundPath=path.join(socketRoot,`s${randomUUID().slice(0,8)}`);
        const socketPath=path.join(f.bundle,'Contents','Resources','socket-entry');
        server=net.createServer(); await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(boundPath,resolve);});
        await fs.rename(boundPath,socketPath);
      }
      try { await assert.rejects(selectCompatibleUi({installRoot:f.installRoot,currentRelease:{state:'VALID',id:f.runtimeId,runtimeRoot:f.runtimeRoot},intent:f.intent})); }
      finally { if(server) await new Promise(resolve=>server.close(resolve)); }
    });
  }
});

test('a changed source during copy aborts the staged artifact and preserves the active pointer', async t => {
  const f=await releaseFixture(t);
  const selection=await selectCompatibleUi({installRoot:f.installRoot,currentRelease:{state:'VALID',id:f.runtimeId,runtimeRoot:f.runtimeRoot},intent:f.intent});
  const pointer=path.join(f.root,'runtime-current.json'); await fs.writeFile(pointer,JSON.stringify({id:f.runtimeId,runtimeRoot:f.runtimeRoot}));
  const destination=path.join(f.root,'race-stage','GSA Local Connector.app');
  await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
  let changed=false;
  const raceCommand=async (executable,args)=>{
    if(args.includes('--display')&&!changed){changed=true;await replacePrivate(path.join(f.bundle,uiBundleFiles[0]),'raced source content');}
    return commandFor(f.identity)(executable,args);
  };
  await assert.rejects(copyVerifiedUi({selection,destinationBundle:destination,command:raceCommand}),{code:'UI_ARTIFACT_CHANGED'});
  assert.equal(await fs.readFile(pointer,'utf8'),JSON.stringify({id:f.runtimeId,runtimeRoot:f.runtimeRoot}));
});

test('a read-only signature result with the wrong designated requirement is refused before copying', async t => {
  const f=await releaseFixture(t);
  const selection=await selectCompatibleUi({installRoot:f.installRoot,currentRelease:{state:'VALID',id:f.runtimeId,runtimeRoot:f.runtimeRoot},intent:f.intent});
  const destination=path.join(f.root,'wrong-dr-stage','GSA Local Connector.app');
  await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
  const wrong={...f.identity,designatedRequirement:'identifier "com.gsa-localconnector.mac.desktop"'};
  await assert.rejects(copyVerifiedUi({selection,destinationBundle:destination,command:commandFor(wrong)}),{code:'UI_SIGNATURE_INVALID'});
  await assert.rejects(fs.lstat(destination),{code:'ENOENT'});
});

test('per-directory inventory is bounded before release admission', async t => {
  const f=await releaseFixture(t);
  const extras=[];
  for(let index=0;index<33;index++){
    const name=`unexpected-${index}`; extras.push(`GSA Local Connector.app/Contents/${name}`);
    await fs.writeFile(path.join(f.bundle,'Contents',name),'untrusted extra',{mode:0o400});
  }
  const allowedFiles=Object.keys(f.manifest.files).concat(extras);
  const manifest=await createReleaseManifest({sourceRoot:f.runtimeRoot,platform:'darwin',arch:'arm64',version:f.runtimeId,allowedFiles});
  await replacePrivate(path.join(f.runtimeRoot,'manifest.json'),JSON.stringify(manifest));
  await assert.rejects(selectCompatibleUi({installRoot:f.installRoot,currentRelease:{state:'VALID',id:f.runtimeId,runtimeRoot:f.runtimeRoot},intent:f.intent}),{code:'UI_INVENTORY_LIMIT'});
});

test('an oversized sparse candidate is rejected by bounded preflight before content verification', async t => {
  const f=await releaseFixture(t);
  const sparse=path.join(f.runtimeRoot,'oversized-sparse');
  const handle=await fs.open(sparse,'wx',0o400);
  try { await handle.truncate(256*1024*1024+1); }
  finally { await handle.close(); }
  const manifest={...f.manifest,files:{...f.manifest.files,'oversized-sparse':'0'.repeat(64)}};
  await replacePrivate(path.join(f.runtimeRoot,'manifest.json'),JSON.stringify(manifest));
  await assert.rejects(selectCompatibleUi({installRoot:f.installRoot,currentRelease:{state:'VALID',id:f.runtimeId,runtimeRoot:f.runtimeRoot},intent:f.intent}),{code:'UI_INVENTORY_LIMIT'});
});

test('each UI source input and a config path change produces a different intent fingerprint', async t => {
  const {root, files} = await fixture(t);
  const configPath = path.join(root, 'config.json');
  const baseline = await describeUiIntent({sourceRoot:root, configPath});
  for (const relative of Object.keys(files)) {
    const destination = path.join(root, relative);
    const original = await fs.readFile(destination);
    await fs.writeFile(destination, Buffer.concat([original, Buffer.from('\nchanged') ]));
    const changed = await describeUiIntent({sourceRoot:root, configPath});
    assert.notEqual(changed.fingerprint, baseline.fingerprint, `changing ${relative} must invalidate UI reuse`);
    await fs.writeFile(destination, original);
  }
  const changedConfig = await describeUiIntent({sourceRoot:root, configPath:path.join(root, 'other-config.json')});
  assert.notEqual(changedConfig.fingerprint, baseline.fingerprint, 'changing the resource config path must invalidate UI reuse');
});
