import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test,type TestContext} from 'node:test';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import type {NativeScopedFiles} from '../src/core/native-io.js';
import {requireMacDirectoryBuild,requireMacDirectoryEvidence,type DirectoryTreeBuild} from '../src/hosts/macos-directory-evidence.js';
import {loadCheckedMacDirectoryInstallation,macDirectoryCopyActivation} from '../src/hosts/macos-directory-installation.js';
import {directoryEvidenceFixture,machOFixture,sha,writeInstallationFixture} from './helpers/directory-installation-fixture.js';

const fixtureTest=(name:string,fn:(t:TestContext)=>void|Promise<void>)=>test(name,{skip:process.platform!=='darwin'||process.arch!=='arm64'?'Mac ARM64 installation fixture uses the documented host loader boundary':false},fn);
const base=():NativeScopedFiles=>{const unavailable=async()=>{throw Error('base fake should not execute');};return {supportedOperations:['create_file','create_directory','copy_file'],read:unavailable,createExclusive:unavailable,replaceIfHash:unavailable,makeDirectory:unavailable,copyExclusive:unavailable,moveExclusive:unavailable,trashIfHash:unavailable};};

test('directory build validator accepts a structurally complete synthetic ARM64 build',async()=>{
 const {build}=await directoryEvidenceFixture();assert.doesNotThrow(()=>requireMacDirectoryBuild(build));
});

test('directory evidence validates raw bounded capture and request-response bindings',async()=>{
 const {build,evidence}=await directoryEvidenceFixture();assert.doesNotThrow(()=>requireMacDirectoryEvidence(evidence,build));
 const mutations:Array<[string,(value:any)=>void]>=[
  ['missing evidence member',value=>delete value.observations.ungrantedPath],
  ['extra public field',value=>value.extra='claimed PASS'],
  ['positive response binding mismatch',value=>value.observations.workspaceCapture.response.binding.path='elsewhere'],
  ['manifest capture payload substitution',value=>value.observations.referenceCapture.response.capture.files[0].base64='eA=='],
  ['negative response with payload',value=>value.observations.unsafeSymlink.response.capture={}],
  ['unrecognized native denial',value=>value.observations.unsafeSpecial.response.error='SOMETHING_ELSE'],
  ['unsupported protocol operation',value=>value.observations.invalidWriteRequest.request.operation='read'],
  ['relocation disclosure claim',value=>value.observations.relocation.outside_content_returned=true],
  ['relocation identity substitution',value=>value.observations.relocation.relocatedIdentity.inode='999'],
  ['unresolved fixture claim',value=>value.unresolved.push('unverified')],
 ];
 for(const [label,change] of mutations){const clone=structuredClone(evidence);change(clone);assert.throws(()=>requireMacDirectoryEvidence(clone,build),/evidence|invalid|binding/i,label);}
 const wrongBuild={...build,release_sha256:'f'.repeat(64)} as DirectoryTreeBuild;assert.throws(()=>requireMacDirectoryEvidence(evidence,wrongBuild));
});

fixtureTest('synthetic HMAC, artifact, root and evidence proof still cannot activate directory copies',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-directory-install-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const work=path.join(root,'work');await fs.mkdir(work,{mode:0o700});const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:'work',root:work,role:'workspace'}]);
 const install=await writeInstallationFixture(root,registry);
 const calls:Array<{executable:string;args:string[];input:string;max:number;fd?:3}>=[];const io={...install.io,command:async(executable:string,args:string[],input:string,max:number,fd?:3)=>{calls.push({executable,args,input,max,fd});return (install.io.command as (...args:any[])=>Promise<Buffer>)(executable,args,input,max,fd);}};
 const reason='Exact tree-reader native proof and installation review pending';assert.deepEqual(macDirectoryCopyActivation(),{available:false,reason});
 await assert.rejects(loadCheckedMacDirectoryInstallation(registry,install.installRoot,base(),{ownerLockFD:3,authorize:async()=>{}},io),(error:any)=>error.code==='SECURITY_BLOCKED'&&error.message===reason);
 assert(calls.some(call=>call.executable==='/usr/bin/codesign'&&call.args.includes('--verify')));assert(calls.every(call=>call.fd===3));
});

fixtureTest('invalid HMAC and evidence digest fail before any signing command',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-directory-install-invalid-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const work=path.join(root,'work');await fs.mkdir(work,{mode:0o700});const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:'work',root:work,role:'workspace'}]);const install=await writeInstallationFixture(root,registry);let commands=0;
 const io={...install.io,command:async(..._args:any[])=>{commands++;return Buffer.alloc(0);}};
 const proofFile=path.join(install.installRoot,'install.json'),envelope=JSON.parse(await fs.readFile(proofFile,'utf8'));envelope.hmac='0'.repeat(64);await fs.writeFile(proofFile,JSON.stringify(envelope),{mode:0o600});
 await assert.rejects(loadCheckedMacDirectoryInstallation(registry,install.installRoot,base(),{ownerLockFD:3,authorize:async()=>{}},io),(error:any)=>error.code==='SECURITY_BLOCKED');assert.equal(commands,0);
 await install.writeProof();await install.tamperEvidence();await assert.rejects(loadCheckedMacDirectoryInstallation(registry,install.installRoot,base(),{ownerLockFD:3,authorize:async()=>{}},io),(error:any)=>error.code==='SECURITY_BLOCKED');assert.equal(commands,0);
});

fixtureTest('compiled tree source is bounded, protected-read input and a source mismatch fails before signing',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-directory-source-pin-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const work=path.join(root,'work');await fs.mkdir(work,{mode:0o700});const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:'work',root:work,role:'workspace'}]);
 const install=await writeInstallationFixture(root,registry),sourceReads:Array<{file:string;max:number}>=[],commands:string[]=[];
 const io={...install.io,protectedRead:async(file:string,max:number)=>{if(file===install.sourcePath){sourceReads.push({file,max});return Buffer.from('mismatched synthetic protected source');}return install.io.protectedRead(file,max);},command:async(executable:string)=>{commands.push(executable);return Buffer.alloc(0);}};
 await assert.rejects(loadCheckedMacDirectoryInstallation(registry,install.installRoot,base(),{ownerLockFD:3,authorize:async()=>{}},io),(error:any)=>error.code==='SECURITY_BLOCKED');
 assert.deepEqual(sourceReads,[{file:install.sourcePath,max:65536}]);assert.deepEqual(commands,[]);
});

fixtureTest('installation is rejected when a selected project shares its identity parent',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-directory-parent-overlap-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const stage=path.join(root,'stage'),identity=path.join(stage,'identity'),work=path.join(identity,'project');await fs.mkdir(work,{recursive:true,mode:0o700});
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:'work',root:work,role:'workspace'}]);
 const install=await writeInstallationFixture(stage,registry);let commands=0;const io={...install.io,command:async()=>{commands++;return Buffer.alloc(0);}};
 await assert.rejects(loadCheckedMacDirectoryInstallation(registry,install.installRoot,base(),{ownerLockFD:3,authorize:async()=>{}},io),(error:any)=>error.code==='SECURITY_BLOCKED');
 assert.equal(commands,0);
});

test('synthetic helper payload stays bounded fixture data and never uses a native compiler',()=>{
 const code=machOFixture();assert.equal(code.length,144);assert.match(sha(code),/^[a-f0-9]{64}$/);
});
