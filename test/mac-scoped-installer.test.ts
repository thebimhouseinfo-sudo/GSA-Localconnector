import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {enrollRolesTrustedBatch} from '../src/local/grants.js';
const moduleUrl=pathToFileURL(path.resolve('scripts/install-mac-scoped-files.mjs')).href;
async function fixture(t:any){const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-scoped-installer-')));t.after(()=>fs.rm(temp,{recursive:true,force:true}));const identity=path.join(temp,'identity'),workspace=path.join(temp,'workspace');await fs.mkdir(workspace,{mode:0o700});await enrollRolesTrustedBatch([{id:'work',root:workspace,role:'workspace'}],identity);return {identity,workspace,temp};}
test('installer inspect uses selected durable roots and does not create an installation',async t=>{const f=await fixture(t);const installer=await import(moduleUrl);const before=(await fs.readdir(f.identity)).sort();const report=await installer.inspectMacScopedFiles(f.identity);assert.equal(report.state,'SCOPED_FILES_PLAN');assert.equal(report.grants.length,1);assert.equal(report.grants[0].id,'work');assert.equal(report.grants[0].root,f.workspace);assert.deepEqual((await fs.readdir(f.identity)).sort(),before);});
test('installer holds owner fencing throughout the supplied publication operation',async t=>{const f=await fixture(t);const installer=await import(moduleUrl);let attempted=false;await installer.withStoppedMacConnector(f.identity,async()=>{const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn('/usr/bin/python3',['-c','import os,fcntl,sys\nf=os.open(sys.argv[1],os.O_RDWR|os.O_NOFOLLOW)\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(75)\nsys.exit(0)',path.join(f.identity,'server-owner.lock')],{stdio:'ignore'});child.on('error',reject);child.on('close',resolve);});assert.equal(code,75);attempted=true;});assert(attempted);});
test('publication refuses fabricated check strings and preserves previous installation',async t=>{const f=await fixture(t);const installer=await import(moduleUrl);const old=path.join(f.identity,'scoped-files');await fs.mkdir(old,{mode:0o700});await fs.writeFile(path.join(old,'keep'),'previous',{mode:0o600});await assert.rejects(installer.applyMacScopedFiles(f.identity,{checks:['native-read','ancestor-relocation'],verified:true}),/evidence|fixture|containment/i);assert.equal(await fs.readFile(path.join(old,'keep'),'utf8'),'previous');});
test('publication rejects a fully populated legacy PASS-label proof without raw observations',async()=>{const installer=await import(moduleUrl);const build={};assert.throws(()=>installer.requireMacFileEvidence({format:'gsa-scoped-files-native-evidence-v1',build,signing_profile:installer.signingProfile,fixture:{roots:[{},{}]},release:{installedJourney:'PASS',interiorRelocation:'PASS',outsideCanaries:'PASS'},instrumented:{kind:'DIAGNOSTIC_ONLY'},unresolved:[]},build),/evidence|fixture|containment/i);});
test('legacy installer refuses an existing recovery journal before any publication',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files'),journal=path.join(live,'file-transactions');
 await fs.mkdir(live,{mode:0o700});await fs.mkdir(journal,{mode:0o700});await fs.writeFile(path.join(journal,'retained'), 'fixture',{mode:0o600});
 const before=await fs.readFile(path.join(journal,'retained'));
 assert.equal(typeof installer.assertLegacyBaseSafe,'function');
 await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/recovery|journal/i);
 assert.deepEqual(await fs.readFile(path.join(journal,'retained')),before);
});
test('legacy installer refuses an unverified live installation rather than downgrading it',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files');
 await fs.mkdir(live,{mode:0o700});await fs.writeFile(path.join(live,'install.json'),'not-a-proof',{mode:0o600});
 assert.equal(typeof installer.assertLegacyBaseSafe,'function');
 await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/unsafe|proof|installation/i);
 assert.equal(await fs.readFile(path.join(live,'install.json'),'utf8'),'not-a-proof');
});
test('legacy installation guard accepts valid BASE proof but refuses recovery proof',async t=>{
 const {createHmac}=await import('node:crypto'),{receiptSample}=await import('./helpers/mac-file-evidence-fixture.js');
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files');await fs.mkdir(live,{mode:0o700});
 const {loadTrustedRegistry}=await import('../src/local/grants.js');const grant=(await loadTrustedRegistry(f.identity)).list()[0]!;
 const key=Buffer.alloc(32,12),evidence=receiptSample(os.release(),process.arch),proof:any={format:'gsa-scoped-files-v2',hostRelease:evidence.build.hostRelease,arch:evidence.build.arch,build:evidence.build,evidence,grants:[{...evidence.fixture.roots[0],id:grant.id,root:grant.canonicalRoot,rootIdentity:grant.rootIdentity,role:grant.role,revision:grant.revision}]};
 await fs.writeFile(path.join(live,'proof-key'),key,{mode:0o600});
 const writeProof=async()=>{const body=JSON.stringify(proof),hmac=createHmac('sha256',key).update(body).digest('hex');await fs.writeFile(path.join(live,'install.json'),JSON.stringify({body,hmac}),{mode:0o600});};
 await writeProof();assert.equal(typeof installer.assertLegacyBaseSafe,'function');await installer.assertLegacyBaseSafe(f.identity);
 proof.recoveryQualification='fixture';await writeProof();await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/recovery/i);
 delete proof.recoveryQualification;proof.grants[0].recovery={};await writeProof();await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/recovery/i);
 delete proof.grants[0].recovery;const original=proof.grants;proof.hostRelease='different-host';await writeProof();await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/unsafe|proof|installation/i);
 proof.hostRelease=os.release();proof.grants=[null];await writeProof();await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/unsafe|proof|installation/i);
 proof.grants=original;proof.grants[0].root='/different-root';await writeProof();await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/unsafe|proof|installation/i);
});
test('legacy guard rechecks a journal created while it reads the proof',async t=>{
 const {createHmac}=await import('node:crypto'),{receiptSample}=await import('./helpers/mac-file-evidence-fixture.js'),{loadTrustedRegistry}=await import('../src/local/grants.js');
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files');await fs.mkdir(live,{mode:0o700});
 const grant=(await loadTrustedRegistry(f.identity)).list()[0]!,key=Buffer.alloc(32,12),evidence=receiptSample(os.release(),process.arch);
 const proof={format:'gsa-scoped-files-v2',hostRelease:os.release(),arch:process.arch,build:evidence.build,evidence,grants:[{...evidence.fixture.roots[0],id:grant.id,root:grant.canonicalRoot,rootIdentity:grant.rootIdentity,role:grant.role,revision:grant.revision}]};
 const body=JSON.stringify(proof),hmac=createHmac('sha256',key).update(body).digest('hex');await fs.writeFile(path.join(live,'proof-key'),key,{mode:0o600});await fs.writeFile(path.join(live,'install.json'),JSON.stringify({body,hmac}),{mode:0o600});
 const open=fs.open;let injected=false;
 (fs as any).open=async (...args:any[])=>{if(!injected&&args[0]===path.join(live,'proof-key')){injected=true;await fs.mkdir(path.join(live,'file-transactions'),{mode:0o700});}return (open as any)(...args);};
 try{await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/journal/i);assert.equal(injected,true);}
 finally{(fs as any).open=open;}
});
