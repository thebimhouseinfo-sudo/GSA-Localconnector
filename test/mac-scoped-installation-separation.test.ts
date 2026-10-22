import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,createHmac} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test,type TestContext} from 'node:test';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import {loadMacScopedFilesCandidate as loadMacScopedFiles,fixtureBuild} from './helpers/mac-scoped-candidate.js';
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
async function fixture(t:TestContext,layout:'siblings'|'work-parent'|'installation-parent'='siblings'){
 const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-install-separation-')));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const installation=path.join(temp,layout==='work-parent'?'work/installation':'installation'),work=path.join(temp,layout==='installation-parent'?'installation/work':'work');
 await fs.mkdir(installation,{recursive:true,mode:0o700});await fs.mkdir(work,{recursive:true,mode:0o700});
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:'work',root:work,role:'workspace'}]);const grant=registry.get('work')!;
 const app=path.join(installation,'work','Broker.app'),contents=path.join(app,'Contents'),macos=path.join(contents,'MacOS');await fs.mkdir(macos,{recursive:true,mode:0o700});
 const info={CFBundleExecutable:'broker',CFBundleIdentifier:'local.gsa.separation',CFBundleName:'Broker',CFBundlePackageType:'APPL',GSAWorkspaceID:'work',GSAWorkspaceRole:'workspace',GSARevision:grant.revision,GSAWorkspaceRoot:work,GSADevice:grant.rootIdentity.device,GSAInode:grant.rootIdentity.inode};
 await fs.writeFile(path.join(contents,'Info.plist'),execFileSync('/usr/bin/plutil',['-convert','xml1','-o','-','-'],{input:JSON.stringify(info)}),{mode:0o600});
 execFileSync('/usr/bin/clang',['-x','c','-','-o',path.join(macos,'broker')],{input:'#include <stdio.h>\nint main(void){puts("{\\\"ok\\\":true}");return 0;}\n'});
 const ent=path.join(temp,'ent.plist');await fs.writeFile(ent,execFileSync('/usr/bin/plutil',['-convert','xml1','-o','-','-'],{input:JSON.stringify({'com.apple.security.app-sandbox':true,'com.apple.security.temporary-exception.files.absolute-path.read-write':[work+'/']})}),{mode:0o600});execFileSync('/usr/bin/codesign',['--force','--sign','-','--entitlements',ent,app],{stdio:'ignore'});
 async function secure(dir:string){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){await secure(p);await fs.chmod(p,0o700);}else await fs.chmod(p,e.name==='broker'?0o500:0o600);}}await secure(installation);
 const artifacts:Record<string,string>={};for(const n of ['Contents/MacOS/broker','Contents/Info.plist','Contents/_CodeSignature/CodeResources'])artifacts[n]=sha(await fs.readFile(path.join(app,n)));
 const key=Buffer.alloc(32,1),body=JSON.stringify({format:'gsa-scoped-files-v2',build:fixtureBuild(),evidence:null,hostRelease:os.release(),arch:process.arch,grants:[{id:'work',root:work,rootIdentity:grant.rootIdentity,role:'workspace',revision:grant.revision,artifacts,code_sha256:'0'.repeat(64),presign_sha256:'0'.repeat(64)}],checks:['native-read','create-exclusive','mkdir','copy-exclusive','symlink-denied','hardlink-denied','traversal-denied','read-cap','hash-conflict','root-identity','ancestor-relocation']});await fs.writeFile(path.join(installation,'proof-key'),key,{mode:0o600});await fs.writeFile(path.join(installation,'install.json'),JSON.stringify({body,hmac:createHmac('sha256',key).update(body).digest('hex')}),{mode:0o600});
 return {registry,installation,work,load:()=>loadMacScopedFiles(registry,installation)};
}
for(const layout of ['work-parent','installation-parent'] as const)test(`loader rejects physical installation overlap (${layout})`,{skip:process.platform!=='darwin'},async t=>{const f=await fixture(t,layout);await assert.rejects(f.load(),(e:any)=>e.code==='SECURITY_BLOCKED'&&/installation.*overlap/i.test(e.message));});
test('sibling installation remains usable', {skip:process.platform!=='darwin'},async t=>{const f=await fixture(t);const io=await f.load();await io.createExclusive({workspace_id:'work',path:'a.txt'},Buffer.from('x'));});
for(const role of ['workspace','reference'] as const)test(`new peer ${role} overlapping installation is rejected before dispatch`,{skip:process.platform!=='darwin'},async t=>{const f=await fixture(t),io=await f.load();await f.registry.enrollRolesTrusted([{id:'peer',root:f.installation,role}]);await assert.rejects(io.createExclusive({workspace_id:'work',path:'a.txt'},Buffer.from('x')),(e:any)=>e.code==='SECURITY_BLOCKED'&&/installation.*overlap/i.test(e.message));});
