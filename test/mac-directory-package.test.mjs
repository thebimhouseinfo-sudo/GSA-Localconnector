import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReleaseManifest,verifyReleaseManifest} from '../scripts/desktop-release.mjs';
import {verify as verifyMacRuntime} from '../scripts/mac-package.mjs';
import {createMacInstaller} from '../scripts/mac-desktop-install.mjs';
import {directorySourceFiles as legacyNativeSources} from '../scripts/mac-package.mjs';
import {directorySourceFiles as desktopNativeSources} from '../scripts/mac-desktop-install.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function tempRoot(t,prefix){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),prefix)));await fs.chmod(root,0o700);t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function writePrivate(root,name,bytes){const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,bytes,{mode:0o600});return file;}

test('both installers allowlist only the immutable tree broker source',()=>{
 const expected=['native/macos-files/tree-broker.swift'];
 assert.deepEqual(legacyNativeSources(),expected);assert.deepEqual(desktopNativeSources(),expected);
});

test('desktop release manifest carries the exact tree source bytes and detects tampering',async t=>{
 const source=await tempRoot(t,'gsa-tree-source-'),release=await tempRoot(t,'gsa-tree-release-');
 const artifact=desktopNativeSources()[0],bytes=await fs.readFile(path.resolve(artifact));
 await writePrivate(source,artifact,bytes);
 const manifest=await createReleaseManifest({sourceRoot:source,platform:'darwin',arch:'arm64',version:'fixture',allowedFiles:desktopNativeSources()});
 assert.deepEqual(Object.keys(manifest.files),[artifact]);
 await writePrivate(release,artifact,bytes);assert.equal(await verifyReleaseManifest({releaseRoot:release,manifest}),true);
 await fs.writeFile(path.join(release,artifact),'changed');await assert.rejects(verifyReleaseManifest({releaseRoot:release,manifest}),e=>e.code==='RELEASE_INVALID');
 await fs.unlink(path.join(release,artifact));await assert.rejects(verifyReleaseManifest({releaseRoot:release,manifest}),e=>e.code==='RELEASE_INVALID');
});

test('legacy runtime manifest verifies the tree source and rejects changed or unlisted artifacts',async t=>{
 const root=await tempRoot(t,'gsa-mac-runtime-tree-');
 const names=['dist/src/mcp/http-cli.js','scripts/macos-owner-launcher.py','bin/node',...legacyNativeSources()];
 const files={};for(const name of names){const bytes=Buffer.from(`synthetic:${name}`);await writePrivate(root,name,bytes);files[name]=sha(bytes);}
 await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({format:'gsa-mac-runtime-v1',files}),{mode:0o600});
 await verifyMacRuntime(root);
 await fs.writeFile(path.join(root,names.at(-1)),'tampered');await assert.rejects(verifyMacRuntime(root),/integrity/);
});

test('runtime verification keeps old manifests valid but rejects a new directory loader without its source',async t=>{
 const root=await tempRoot(t,'gsa-mac-runtime-legacy-tree-');
 const base=['dist/src/mcp/http-cli.js','scripts/macos-owner-launcher.py','bin/node'];
 const writeManifest=async names=>{const files={};for(const name of names){const bytes=Buffer.from(`synthetic:${name}`);await writePrivate(root,name,bytes);files[name]=sha(bytes);}await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({format:'gsa-mac-runtime-v1',files}),{mode:0o600});};
 await writeManifest(base);assert.equal((await verifyMacRuntime(root)).format,'gsa-mac-runtime-v1');
 await fs.rm(root,{recursive:true,force:true});await fs.mkdir(root,{mode:0o700});
 const loader='dist/src/hosts/macos-directory-installation.js';await writeManifest([...base,loader]);
 await assert.rejects(verifyMacRuntime(root));
});

test('desktop stage verification requires UI provenance and still rejects a loader without its tree source',async t=>{
 const home=await tempRoot(t,'gsa-desktop-manifest-home-'),stageRoot=path.join(home,'stage');await fs.mkdir(stageRoot,{mode:0o700});
 const installer=await createMacInstaller({home,sourceRoot:home,registerLogin:false});
 const base=['dist/src/mcp/http-cli.js'];
 const writeManifest=async names=>{const files={};for(const name of names){const bytes=Buffer.from(`synthetic:${name}`);await writePrivate(stageRoot,name,bytes);files[name]=sha(bytes);}await fs.writeFile(path.join(stageRoot,'manifest.json'),JSON.stringify({format:'gsa-desktop-release-v1',platform:'darwin',arch:'arm64',version:'fixture',files}),{mode:0o600});};
 await writeManifest(base);await assert.rejects(installer.platformAdapter.verifyStage({stageRoot}),()=>true,'a new stage without ui-provenance.json must not pass verification');
 await fs.rm(stageRoot,{recursive:true,force:true});await fs.mkdir(stageRoot,{mode:0o700});
 await writeManifest([...base,'dist/src/hosts/macos-directory-installation.js']);
 await assert.rejects(installer.platformAdapter.verifyStage({stageRoot}),e=>e.code==='RELEASE_INVALID','loader source containment remains checked before UI receipt verification');
});
