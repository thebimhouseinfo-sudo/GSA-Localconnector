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
