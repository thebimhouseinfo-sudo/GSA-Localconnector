import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const moduleUrl=pathToFileURL(path.resolve('scripts/install-mac-scoped-files.mjs')).href;
test('recovery archive rejects missing, linked and unprotected evidence without modifying it',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-recovery-archive-test-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const installer=await import(moduleUrl);assert.equal(typeof installer.readMacRecoveryArchive,'function');
 await assert.rejects(installer.readMacRecoveryArchive(root));
 const outside=path.join(root,'outside');await fs.writeFile(outside,'fixture',{mode:0o600});await fs.symlink(outside,path.join(root,'report.json'));
 await assert.rejects(installer.readMacRecoveryArchive(root));assert.equal(await fs.readFile(outside,'utf8'),'fixture');
 await fs.unlink(path.join(root,'report.json'));await fs.writeFile(path.join(root,'report.json'),'fixture',{mode:0o644});await fs.chmod(path.join(root,'report.json'),0o644);
 await assert.rejects(installer.readMacRecoveryArchive(root));assert.equal(await fs.readFile(path.join(root,'report.json'),'utf8'),'fixture');
});
test('archive reads remain bounded if a file grows after its initial stat',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-archive-grow-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const report=path.join(root,'report.json');await fs.writeFile(report,'x',{mode:0o600});const installer=await import(moduleUrl),open=fs.open;let served=0;
 (fs as any).open=async (...args:any[])=>{const handle=await (open as any)(...args);if(args[0]!==report)return handle;let first=true;
  return {stat:async()=>{const info=await handle.stat();if(first){first=false;await fs.appendFile(report,Buffer.alloc(600*1024));}return info;},readFile:async()=>{const bytes=await handle.readFile();served+=bytes.length;return bytes;},read:async(...values:any[])=>{const result=await (handle.read as any)(...values);served+=result.bytesRead;return result;},close:()=>handle.close()};};
 try{await assert.rejects(installer.readMacRecoveryArchive(root));assert.ok(served<=512*1024+1,`read ${served} bytes despite 512 KiB bound`);}
 finally{(fs as any).open=open;}
});
test('archive rechecks private directory permissions before reading another file',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-archive-mode-')));t.after(async()=>{await fs.chmod(root,0o700);await fs.rm(root,{recursive:true,force:true});});
 for(const name of ['report.json','production-build.json','production-release-recovery','base-build.json','base-evidence.json','base-release-broker'])await fs.writeFile(path.join(root,name),'fixture',{mode:0o600});
 const installer=await import(moduleUrl),open=fs.open;let opened=0;
 (fs as any).open=async(...args:any[])=>{const handle=await (open as any)(...args);opened++;if(opened===1)await fs.chmod(root,0o755);return handle;};
 try{await assert.rejects(installer.readMacRecoveryArchive(root));assert.equal(opened,1);}
 finally{(fs as any).open=open;}
});
test('archive rejects a parent replaced with a symlink during a read',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-archive-ancestor-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const parent=path.join(root,'parent'),moved=path.join(root,'moved'),archive=path.join(parent,'archive');await fs.mkdir(parent,{mode:0o700});await fs.mkdir(archive,{mode:0o700});
 for(const name of ['report.json','production-build.json','production-release-recovery','base-build.json','base-evidence.json','base-release-broker'])await fs.writeFile(path.join(archive,name),'fixture',{mode:0o600});
 const installer=await import(moduleUrl),open=fs.open;let opened=0;
 (fs as any).open=async(...args:any[])=>{const handle=await (open as any)(...args);opened++;if(opened===1){await fs.rename(parent,moved);await fs.symlink(moved,parent);}return handle;};
 try{await assert.rejects(installer.readMacRecoveryArchive(archive));assert.equal(opened,1);}
 finally{(fs as any).open=open;}
});
test('BASE archive bytes must match the exact hashes in the qualification report',async()=>{
 const {createHash}=await import('node:crypto'),installer=await import(moduleUrl),digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
 const build=Buffer.from('base build'),evidence=Buffer.from('base evidence'),release=Buffer.from('base release');
 const report={sourceHashes:{baseBuild:digest(build),baseEvidence:digest(evidence),baseBinary:digest(release)}};
 assert.equal(typeof installer.requireMacRecoveryBaseInputs,'function');
 assert.doesNotThrow(()=>installer.requireMacRecoveryBaseInputs(report,build,evidence,release));
 for(const args of [[Buffer.from('changed'),evidence,release],[build,Buffer.from('changed'),release],[build,evidence,Buffer.from('changed')]])assert.throws(()=>installer.requireMacRecoveryBaseInputs(report,...args));
 assert.throws(()=>installer.requireMacRecoveryBaseInputs({sourceHashes:{}},build,evidence,release));
});

test('read-only recovery archive preflight requires a qualified archive and never touches active grant state',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-qualified-recovery-cli-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const protectedState=path.join(root,'trusted-workspaces.json');
 await fs.writeFile(protectedState,'SENTINEL-DO-NOT-CHANGE',{mode:0o600});
 const script=path.resolve('scripts/install-mac-scoped-files.mjs');
 const noArchive=spawnSync(process.execPath,[script,'verify-recovery-archive'],{encoding:'utf8'});
 assert.notEqual(noArchive.status,0);
 const badArchive=spawnSync(process.execPath,[script,'verify-recovery-archive','--qualification-archive',root],{encoding:'utf8'});
 assert.notEqual(badArchive.status,0);
 assert.ok(!badArchive.stdout.includes('RECOVERY_ARCHIVE_VERIFIED_READ_ONLY'));
 assert.equal(await fs.readFile(protectedState,'utf8'),'SENTINEL-DO-NOT-CHANGE');
 assert.equal((await fs.readdir(root)).length,1,'preflight does not create staging or owner files');
});
