import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verify,launchPlist,label} from './mac-package.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-package-test-')));await fs.chmod(root,0o700);t.after(()=>fs.rm(root,{recursive:true,force:true}));const entries={};for(const name of ['dist/src/mcp/http-cli.js','scripts/macos-owner-launcher.py','bin/node']){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true,mode:0o700});await fs.writeFile(path.join(root,name),'test',{mode:0o600});entries[name]=hash('test');}await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({format:'gsa-mac-runtime-v1',files:entries}),{mode:0o600});return root;}
test('verifies exact private runtime and rejects changed artifact',async t=>{const root=await fixture(t);await verify(root);await fs.writeFile(path.join(root,'bin/node'),'changed');await assert.rejects(verify(root),/integrity/);});
test('rejects unexpected files and symbolic links',async t=>{const root=await fixture(t);await fs.writeFile(path.join(root,'unexpected'),'x',{mode:0o600});await assert.rejects(verify(root),/Unexpected/);await fs.unlink(path.join(root,'unexpected'));await fs.unlink(path.join(root,'bin/node'));await fs.symlink('/usr/bin/true',path.join(root,'bin/node'));await assert.rejects(verify(root),/Symlink/);});
test('rejects public permissions',async t=>{const root=await fixture(t);await fs.chmod(path.join(root,'bin/node'),0o644);await assert.rejects(verify(root),/Unsafe private file/);});
test('LaunchAgent uses precise label, absolute argv, no shell and XML escapes',()=>{const text=launchPlist('/Users/a & b/runtime');assert.ok(text.includes(label));assert.ok(text.includes('/Users/a &amp; b/runtime/bin/node'));assert.ok(text.includes('<key>SuccessfulExit</key><false/>'));assert.ok(!text.includes('/bin/sh'));assert.ok(!text.includes('Terminal'));});

async function legacyFixture(t){
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-legacy-uninstall-')));await fs.chmod(home,0o700);
 t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const base=path.join(home,'Library/Application Support/GSA-Localconnector'),id='01234567-89ab-cdef-0123-456789abcdef',root=path.join(base,'runtimes',id);
 await fs.mkdir(root,{recursive:true,mode:0o700});const entries={};
 for(const name of ['dist/src/mcp/http-cli.js','scripts/macos-owner-launcher.py','scripts/mac-package.mjs','bin/node']){
  await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true,mode:0o700});await fs.writeFile(path.join(root,name),'legacy-fixture',{mode:0o600});entries[name]=hash('legacy-fixture');
 }
 await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({format:'gsa-mac-runtime-v1',id,files:entries}),{mode:0o600});
 const pointer=path.join(base,'runtime-current.json');await fs.writeFile(pointer,JSON.stringify({id,previous:null}),{mode:0o600});
 const plistPath=path.join(home,'Library/LaunchAgents',label+'.plist');await fs.mkdir(path.dirname(plistPath),{recursive:true,mode:0o700});await fs.writeFile(plistPath,launchPlist(root,home),{mode:0o600});
 const desktop=path.join(base,'desktop');await fs.mkdir(desktop,{mode:0o700});await fs.writeFile(path.join(desktop,'runtime-current.json'),'desktop-pointer-sentinel',{mode:0o600});
 const sibling=path.join(base,'runtimes','desktop-sibling');await fs.mkdir(sibling,{mode:0o700});await fs.writeFile(path.join(sibling,'sentinel'),'desktop-release',{mode:0o600});
 return {home,base,root,pointer,plistPath,desktop,sibling};
}

test('legacy uninstall removes only its verified current release and preserves desktop and older releases',async t=>{
 const {uninstallLegacy}=await import('./mac-package.mjs'),f=await legacyFixture(t),calls=[];
 const result=await uninstallLegacy({home:f.home,runCommand:async(command,args)=>{calls.push([command,args]);return {code:0,output:command==='/bin/launchctl'?'PID\tStatus\tLabel\n':''};}});
 assert.equal(result.state,'MAC_RUNTIME_UNINSTALLED');
 for(const removed of [f.root,f.pointer,f.plistPath])await assert.rejects(fs.access(removed));
 assert.equal(await fs.readFile(path.join(f.sibling,'sentinel'),'utf8'),'desktop-release');
 assert.equal(await fs.readFile(path.join(f.desktop,'runtime-current.json'),'utf8'),'desktop-pointer-sentinel');
 assert.ok(calls.length>0);assert.equal(calls.some(([,args])=>args.includes('bootout')),false);
});

test('a desktop-owned shared plist refuses legacy uninstall before any command or deletion',async t=>{
 const {uninstallLegacy}=await import('./mac-package.mjs'),f=await legacyFixture(t),text='<plist>desktop-owned fixture</plist>';
 await fs.writeFile(f.plistPath,text);let calls=0;
 await assert.rejects(uninstallLegacy({home:f.home,runCommand:async()=>{calls++;return {code:0};}}),/ownership unverified/);
 assert.equal(calls,0);assert.equal(await fs.readFile(f.plistPath,'utf8'),text);await fs.access(f.root);await fs.access(f.pointer);
});

test('a registered shared job refuses uninstall without bootout and preserves all components',async t=>{
 const {uninstallLegacy}=await import('./mac-package.mjs'),f=await legacyFixture(t),calls=[];
 await assert.rejects(uninstallLegacy({home:f.home,runCommand:async(command,args)=>{calls.push([command,args]);return {code:0,output:`PID\tStatus\tLabel\n42\t0\t${label}\n`};}}),/Shared launch label is registered/);
 assert.equal(calls.length,1);assert.equal(calls[0][1][0],'list');
 for(const preserved of [f.root,f.pointer,f.plistPath,f.desktop,f.sibling])await fs.access(preserved);
});

test('unverified legacy manifest refuses uninstall before commands or deletion',async t=>{
 const {uninstallLegacy}=await import('./mac-package.mjs'),f=await legacyFixture(t),file=path.join(f.root,'manifest.json');
 const manifest=JSON.parse(await fs.readFile(file,'utf8'));manifest.id='foreign-id';await fs.writeFile(file,JSON.stringify(manifest));
 await assert.rejects(uninstallLegacy({home:f.home,runCommand:()=>assert.fail('unverified ownership must not execute commands')}),/ownership unverified/);
 await fs.access(f.root);await fs.access(f.pointer);await fs.access(f.plistPath);
});

test('legacy stop refuses an occupied shared label without bootout',async()=>{
 const {stopLegacy}=await import('./mac-package.mjs'),calls=[];
 await assert.rejects(stopLegacy({runCommand:async(command,args)=>{calls.push([command,args]);return {code:0,output:`PID\tStatus\tLabel\n42\t0\t${label}\n`};}}),/ownership ambiguous/);
 assert.equal(calls.length,1);assert.equal(calls[0][1][0],'list');
});

test('unknown shared-job query and active owner both refuse before deletion',async t=>{
 const {uninstallLegacy}=await import('./mac-package.mjs');
 for(const scenario of ['unknown-job','busy-owner']){
  const f=await legacyFixture(t);
  await assert.rejects(uninstallLegacy({home:f.home,runCommand:async command=>{
   if(command==='/bin/launchctl')return scenario==='unknown-job'?{code:1,output:'query failed'}:{code:0,output:'PID\tStatus\tLabel\n'};
   return {code:75,output:''};
  }}),/ownership ambiguous|unverified server owner/);
  for(const preserved of [f.root,f.pointer,f.plistPath,f.desktop,f.sibling])await fs.access(preserved);
 }
});
