import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import {directoryManifestDigest} from '../../src/core/directory-copy.js';
import type {DirectoryTreeBuild,DirectoryTreeBinding} from '../../src/hosts/macos-directory-evidence.js';

export const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
// Resolve the packaged source beside the compiled runtime tree. Tests provide
// synthetic protected bytes through DirectoryInstallationIO; they never read
// or alter the repository's Swift source as a fixture.
const sourcePath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../native/macos-files/tree-broker.swift');
const source=Buffer.from('synthetic protected tree-broker source fixture\n');
function machO(){const b=Buffer.alloc(144);b.writeUInt32LE(0xfeedfacf,0);b.writeUInt32LE(0x100000c,4);b.writeUInt32LE(2,12);b.writeUInt32LE(2,16);b.writeUInt32LE(96,20);b.writeUInt32LE(0x19,32);b.writeUInt32LE(72,36);b.write('__LINKEDIT',40);b.writeBigUInt64LE(0x8000n,64);b.writeBigUInt64LE(128n,72);b.writeBigUInt64LE(16n,80);b.writeUInt32LE(0x1b,104);b.writeUInt32LE(24,108);b.fill(1,112,128);b.fill(65,128);return b;}
export const machOFixture=machO;
function capture(rootIdentity:{device:string;inode:string}){
 const bytes=Buffer.from('tree fixture');const entries=[{path:'',kind:'directory' as const},{path:'empty',kind:'directory' as const},{path:'nested',kind:'directory' as const},{path:'nested/a.txt',kind:'file' as const,size:bytes.length,sha256:sha(bytes)}];
 return {manifest:{format:'gsa-directory-manifest-v1' as const,entries,total_bytes:bytes.length,sha256:directoryManifestDigest(entries)},files:[{path:'nested/a.txt',base64:bytes.toString('base64')}],observations:entries.map((entry,index)=>({path:entry.path,device:rootIdentity.device,inode:index===0?rootIdentity.inode:String(index+20),kind:entry.kind,size:entry.kind==='file'?entry.size:0,mtime_ns:'1',ctime_ns:'2'}))};
}
export async function directoryEvidenceFixture(){
 const code=machO(),build:DirectoryTreeBuild={uuid:'00000000-0000-0000-0000-000000000000',source_sha256:sha(source),compiler_sha256:'1'.repeat(64),driver:'xcrun-macosx-swiftc-v1',sdk:{path:'/synthetic/SDK',version:'schema-fixture',settings_sha256:'2'.repeat(64)},compiler_version:'synthetic evidence schema fixture',release_sha256:sha(code),code_sha256:'3'.repeat(64),arguments:['-O','-Xlinker','-reproducible'],signing_profile:'gsa-directory-tree-readonly-single-root-v1',hostRelease:'schema-fixture',arch:'arm64'};
 const artifacts={'Contents/MacOS/tree-broker':build.release_sha256,'Contents/Info.plist':'4'.repeat(64),'Contents/_CodeSignature/CodeResources':'5'.repeat(64)};
 const roots:DirectoryTreeBinding[]=['workspace','reference'].map((role,index)=>({id:role,role:role as 'workspace'|'reference',root:`/private/fixture/${role}`,rootIdentity:{device:'1',inode:String(index+10)},revision:1,artifacts,presign_sha256:build.release_sha256,code_sha256:build.code_sha256}));
 const request=(root:DirectoryTreeBinding,pathValue:string)=>({operation:'capture_tree',workspace_id:root.id,role:root.role,root:root.root,device:root.rootIdentity.device,inode:root.rootIdentity.inode,revision:root.revision,path:pathValue});
 const success=(root:DirectoryTreeBinding,pathValue:string)=>({request:request(root,pathValue),response:{ok:true,format:'gsa-directory-capture-response-v1',binding:{workspace_id:root.id,role:root.role,root:root.root,device:root.rootIdentity.device,inode:root.rootIdentity.inode,revision:root.revision,path:pathValue},capture:capture(root.rootIdentity)}});
 const failure=(root:DirectoryTreeBinding,error:string,pathValue='.')=>({request:request(root,pathValue),response:{ok:false,error}});
 const workspace=roots[0]!,reference=roots[1]!;
 const relocationRequest=request(workspace,'parent');
 const evidence={format:'gsa-directory-tree-native-evidence-v1',build,fixture:{stage:'/private/fixture',stageIdentity:{device:'1',inode:'7'},hostRelease:build.hostRelease,arch:build.arch,owner_fd:3,roots,outsideCanaries:[{path:'/private/fixture/outside/canary',before_sha256:'6'.repeat(64),after_sha256:'6'.repeat(64)}]},observations:{
  workspaceCapture:success(workspace,'.'),referenceCapture:success(reference,'.'),unsafeSymlink:failure(workspace,'UNSAFE_FILE_TYPE'),unsafeHardlink:failure(workspace,'UNSAFE_FILE_TYPE'),unsafeSpecial:failure(workspace,'UNSAFE_FILE_TYPE'),overLimit:failure(workspace,'ENTRY_LIMIT_EXCEEDED'),staleBinding:failure({...workspace,revision:2},'GRANT_BINDING_MISMATCH'),ungrantedPath:failure(workspace,'PATH_OUTSIDE_SCOPE','../../outside/secret'),invalidWriteRequest:{request:{...request(workspace,'file'),operation:'create'},response:{ok:false,error:'INVALID_OPERATION'}},
  relocation:{request:relocationRequest,pid:123,fd:5,parentIdentity:{device:'1',inode:'22'},relocatedIdentity:{device:'1',inode:'22'},parentPath:'/private/fixture/workspace/parent',relocatedPath:'/private/fixture/outside/parent',stopConfirmation:{pid:123,signal:'SIGSTOP',state:'T',fd:5,parentIdentity:{device:'1',inode:'22'}},timeline:{stopConfirmed:1,parentRelocated:2,resumed:3,responseObserved:4},response:{ok:false,error:'PATH_OUTSIDE_SCOPE'},outside_content_returned:false}
 },unresolved:[]};
 return {build,evidence,roots,code,source,sourcePath};
}

export async function writeInstallationFixture(root:string,registry:any){
 const initial=await directoryEvidenceFixture();const build:any={...initial.build,sdk:{...initial.build.sdk},arguments:[...initial.build.arguments]},evidence:any=structuredClone(initial.evidence);evidence.build=build;const {roots,code,source,sourcePath}=initial;const grant=registry.list()[0];
 const installRoot=path.join(root,'identity','directory-copy');await fs.mkdir(path.join(installRoot,'copy-records'),{recursive:true,mode:0o700});
 await fs.writeFile(path.join(installRoot,'proof-key'),Buffer.alloc(32,9),{mode:0o600});
 const id=grant.id,app=path.join(installRoot,id,'TreeReader.app'),contents=path.join(app,'Contents');
 await fs.mkdir(path.join(contents,'MacOS'),{recursive:true,mode:0o700});await fs.mkdir(path.join(contents,'_CodeSignature'),{mode:0o700});
 const info={CFBundleExecutable:'tree-broker',GSAWorkspaceID:id,GSAWorkspaceRole:grant.role,GSAWorkspaceRoot:grant.canonicalRoot,GSARevision:grant.revision,GSADevice:grant.rootIdentity.device,GSAInode:grant.rootIdentity.inode};
 const entitlements={'com.apple.security.app-sandbox':true,'com.apple.security.temporary-exception.files.absolute-path.read-only':[grant.canonicalRoot+'/']};
 await fs.writeFile(path.join(contents,'Info.plist'),JSON.stringify(info),{mode:0o600});await fs.writeFile(path.join(contents,'_CodeSignature/CodeResources'),'synthetic CodeResources',{mode:0o600});await fs.writeFile(path.join(contents,'MacOS/tree-broker'),code,{mode:0o500});
 const {normalizedStrippedMacFileCode}=await import('../../src/hosts/macos-file-code.js');build.code_sha256=sha(normalizedStrippedMacFileCode(code));
 const binding:DirectoryTreeBinding={id,root:grant.canonicalRoot,rootIdentity:grant.rootIdentity,revision:grant.revision,role:grant.role,artifacts:{'Contents/MacOS/tree-broker':sha(code),'Contents/Info.plist':sha(JSON.stringify(info)),'Contents/_CodeSignature/CodeResources':sha('synthetic CodeResources')},presign_sha256:build.release_sha256,code_sha256:build.code_sha256};
 build.hostRelease=(await import('node:os')).default.release();build.arch=process.arch as 'arm64';(evidence as any).fixture.hostRelease=build.hostRelease;(evidence as any).fixture.arch=build.arch;
 for(const fixtureRoot of (evidence as any).fixture.roots){fixtureRoot.code_sha256=build.code_sha256;fixtureRoot.presign_sha256=build.release_sha256;fixtureRoot.artifacts={...binding.artifacts};}
 (evidence as any).build=build;
 const evidenceBytes=Buffer.from(JSON.stringify(evidence));await fs.writeFile(path.join(installRoot,'native-evidence.json'),evidenceBytes,{mode:0o600});
 const proof={format:'gsa-directory-copy-installation-v1',hostRelease:build.hostRelease,arch:build.arch,build,grants:[binding],evidence_file:'native-evidence.json',evidence_sha256:sha(evidenceBytes)};
 const body=JSON.stringify(proof),key=Buffer.alloc(32,9);await fs.writeFile(path.join(installRoot,'install.json'),JSON.stringify({body,hmac:(await import('node:crypto')).createHmac('sha256',key).update(body).digest('hex')}),{mode:0o600});
 async function privateTree(directory:string):Promise<void>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory()){await privateTree(file);await fs.chmod(file,0o700);}else await fs.chmod(file,entry.name==='tree-broker'?0o500:0o600);}}
 await privateTree(installRoot);
 const io={protectedRead:async(file:string,max:number)=>{if(file===sourcePath){if(source.length>max)throw Error('unsafe synthetic source');return Buffer.from(source);}const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.uid!==process.getuid?.()||(st.mode&0o077)!==0||st.size>max)throw Error('unsafe fixture file');const handle=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const opened=await handle.stat();if(opened.dev!==st.dev||opened.ino!==st.ino)throw Error('fixture changed');return await handle.readFile();}finally{await handle.close();}},protectedDirectory:async(dir:string)=>{const st=await fs.lstat(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o777)!==0o700||await fs.realpath(dir)!==dir)throw Error('unsafe fixture directory');},command:async(executable:string,args:string[],input:string)=>{
  if(executable==='/usr/bin/codesign')return Buffer.from(args.includes('--display')?JSON.stringify(entitlements):'');
  if(executable==='/usr/bin/plutil')return Buffer.from(input);
  throw Error(`unexpected synthetic command ${executable}`);
 }};
 return {installRoot,app,build,evidence,proof,binding,info,entitlements,io,sourcePath,source,roots,writeProof:async()=>{const body=JSON.stringify(proof);await fs.writeFile(path.join(installRoot,'install.json'),JSON.stringify({body,hmac:(await import('node:crypto')).createHmac('sha256',key).update(body).digest('hex')}),{mode:0o600});},tamperEvidence:async()=>fs.writeFile(path.join(installRoot,'native-evidence.json'),'{}',{mode:0o600})};
}
