import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,createHmac} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test,type TestContext} from 'node:test';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import {loadMacScopedFiles as loadProductionMacScopedFiles} from '../src/hosts/macos-scoped-files.js';
import {loadMacScopedFilesCandidate as loadMacScopedFiles,fixtureBuild} from './helpers/mac-scoped-candidate.js';
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const sandbox='com.apple.security.app-sandbox',rw='com.apple.security.temporary-exception.files.absolute-path.read-write',ro='com.apple.security.temporary-exception.files.absolute-path.read-only';
type Options={role?:'workspace'|'reference';info?:Record<string,unknown>;entitlements?:Record<string,unknown>;unsigned?:boolean;boundRole?:string;extraEntitlement?:unknown;referenceWritable?:boolean};
async function fixture(t:TestContext,options:Options={}){
 const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-base-contract-')));t.after(()=>fs.rm(temp,{recursive:true,force:true}));const root=path.join(temp,'work'),installation=path.join(temp,'installation');await fs.mkdir(root,{mode:0o700});await fs.mkdir(installation,{mode:0o700});
 const registry=new WorkspaceRegistry();const role=options.role??'workspace';await registry.enrollRolesTrusted([{id:'work',root,role}]);const grant=registry.get('work')!;
 const app=path.join(installation,'work','Broker.app'),contents=path.join(app,'Contents'),macos=path.join(contents,'MacOS');await fs.mkdir(macos,{recursive:true,mode:0o700});
 const info={CFBundleExecutable:'broker',CFBundleIdentifier:'local.gsa.contract.work',CFBundleName:'Broker',CFBundlePackageType:'APPL',CFBundleVersion:'1',GSAWorkspaceID:'work',GSAWorkspaceRole:role,GSARevision:grant.revision,GSAWorkspaceRoot:root,GSADevice:grant.rootIdentity.device,GSAInode:grant.rootIdentity.inode,...options.info};
 const plist=execFileSync('/usr/bin/plutil',['-convert','xml1','-o','-','-'],{input:JSON.stringify(info)});await fs.writeFile(path.join(contents,'Info.plist'),plist,{mode:0o600});
 // Signed C fixture observes adapter request only; it proves no Swift confinement.
 const output=JSON.stringify({ok:true,base64:'b2s=',sha256:sha('ok')});
 const source=`#include <stdio.h>\n#include <string.h>\nint main(void){char b[65536];size_t n=fread(b,1,sizeof(b)-1,stdin);b[n]=0;if(!strstr(b,"\\\"workspace_id\\\":\\\"work\\\"")||!strstr(b,"\\\"role\\\":\\\"${role}\\\"")){puts("{\\\"ok\\\":false,\\\"error\\\":\\\"MISSING_BINDING\\\"}");return 0;}puts(${JSON.stringify(output)});return 0;}\n`;
 const binary=path.join(macos,'broker');execFileSync('/usr/bin/clang',['-x','c','-','-o',binary],{input:source});await fs.chmod(binary,0o700);
 const entitlements=options.entitlements??{[sandbox]:true,[role==='reference'&&!options.referenceWritable?ro:rw]:[root+'/'],...(options.extraEntitlement===undefined?{}:{'com.apple.security.network.client':options.extraEntitlement})};const entFile=path.join(temp,'entitlements.plist');await fs.writeFile(entFile,execFileSync('/usr/bin/plutil',['-convert','xml1','-o','-','-'],{input:JSON.stringify(entitlements)}),{mode:0o600});
 if(!options.unsigned)execFileSync('/usr/bin/codesign',['--force','--sign','-','--entitlements',entFile,app],{stdio:'ignore'});
 else{await fs.mkdir(path.join(contents,'_CodeSignature'),{mode:0o700});await fs.writeFile(path.join(contents,'_CodeSignature/CodeResources'),'unsigned',{mode:0o600});}
 async function privateTree(directory:string){for(const e of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,e.name);if(e.isDirectory()){await privateTree(file);await fs.chmod(file,0o700);}else await fs.chmod(file,e.name==='broker'?0o700:0o600);}}
 await privateTree(installation);
 const artifacts:Record<string,string>={};for(const name of ['Contents/MacOS/broker','Contents/Info.plist','Contents/_CodeSignature/CodeResources'])artifacts[name]=sha(await fs.readFile(path.join(app,name)));
 const proof={format:'gsa-scoped-files-v2',build:fixtureBuild(),evidence:null,hostRelease:os.release(),arch:process.arch,grants:[{id:'work',role:options.boundRole??role,root,rootIdentity:grant.rootIdentity,revision:grant.revision,artifacts,code_sha256:'0'.repeat(64),presign_sha256:'0'.repeat(64)}],checks:['native-read','create-exclusive','mkdir','copy-exclusive','symlink-denied','hardlink-denied','traversal-denied','read-cap','hash-conflict','root-identity','ancestor-relocation']};
 const key=Buffer.alloc(32,1),body=JSON.stringify(proof);await fs.writeFile(path.join(installation,'proof-key'),key,{mode:0o600});await fs.writeFile(path.join(installation,'install.json'),JSON.stringify({body,hmac:createHmac('sha256',key).update(body).digest('hex')}),{mode:0o600});
 return {registry,installation,root,app,load:()=>loadMacScopedFiles(registry,installation)};
}
for(const role of ['workspace','reference'] as const)test(`${role} signed binding loads and request carries ID and role`,{skip:process.platform!=='darwin'},async t=>{const f=await fixture(t,{role});const io=await f.load();assert.deepEqual((await io.read({workspace_id:'work',path:'a.txt'},2)).bytes,Buffer.from('ok'));if(role==='reference')await assert.rejects(io.createExclusive({workspace_id:'work',path:'new.txt'},Buffer.from('x')),(e:any)=>e.code==='PERMISSION_DENIED');assert.deepEqual(io.supportedOperations,['create_file','create_directory','copy_file']);});
for(const [label,info] of [['ID',{GSAWorkspaceID:'other'}],['role',{GSAWorkspaceRole:'reference'}],['revision',{GSARevision:2}],['root',{GSAWorkspaceRoot:'/private/tmp/other'}],['identity',{GSAInode:'0'}]] as const)test(`loader rejects signed wrong ${label} binding before dispatch`,{skip:process.platform!=='darwin'},async t=>{const f=await fixture(t,{info});await assert.rejects(f.load(),(e:any)=>e.code==='SECURITY_BLOCKED');});
test('loader rejects mismatched manifest role', {skip:process.platform!=='darwin'},async t=>{const f=await fixture(t,{boundRole:'reference'});await assert.rejects(f.load(),(e:any)=>e.code==='SECURITY_BLOCKED');});
test('loader rejects unsigned bundle despite matching artifact hashes', {skip:process.platform!=='darwin'},async t=>{const f=await fixture(t,{unsigned:true});await assert.rejects(f.load());});
for(const extra of [false,true])test(`loader rejects extra entitlement even when ${extra}`,{skip:process.platform!=='darwin'},async t=>{const f=await fixture(t,{extraEntitlement:extra});await assert.rejects(f.load(),(e:any)=>e.code==='SECURITY_BLOCKED');});
test('loader rejects read-write reference entitlement', {skip:process.platform!=='darwin'},async t=>{const f=await fixture(t,{role:'reference',referenceWritable:true});await assert.rejects(f.load(),(e:any)=>e.code==='SECURITY_BLOCKED');});

test('public loader refuses incomplete candidate evidence', {skip:process.platform!=='darwin'},async t=>{const f=await fixture(t);await assert.rejects(loadProductionMacScopedFiles(f.registry,f.installation),(e:any)=>e.code==='SECURITY_BLOCKED'&&/evidence/.test(e.message));});
