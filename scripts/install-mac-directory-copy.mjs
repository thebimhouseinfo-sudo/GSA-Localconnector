#!/usr/bin/env node
/** Offline, host-qualified, exclusive native TreeReader installer.
 * Never update an active installation or a running connector. One-shot native
 * qualification is consumed as input; this script never recompiles its binary.
 */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {withStoppedMacConnector} from './install-mac-scoped-files.mjs';
import {loadTrustedRegistry} from '../dist/src/local/grants.js';
import {identityDirectory} from '../dist/src/local/identity.js';
import {normalizedStrippedMacFileCode} from '../dist/src/hosts/macos-file-code.js';
import {assertMacFileInstallationSeparated} from '../dist/src/hosts/macos-scoped-files.js';
import {requireMacDirectoryBuild,requireMacDirectoryEvidence} from '../dist/src/hosts/macos-directory-evidence.js';

const sha=v=>createHash('sha256').update(v).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code:'SECURITY_BLOCKED'});};
const privateDir=async dir=>{
 const s=await fs.lstat(dir);
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700||
    await fs.realpath(dir)!==dir)fail('UNSAFE_DIRECTORY');
};
async function protectedRead(file,max){
 if(!path.isAbsolute(file)||path.normalize(file)!==file||file.includes('\0')||max>16*1024*1024)fail('UNSAFE_READ');
 const before=await fs.lstat(file,{bigint:true});
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||
  before.uid!==BigInt(process.getuid())||(before.mode&0o077n)!==0n||
  before.size>BigInt(max))fail('UNSAFE_ARTIFACT');
 const f=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const opened=await f.stat({bigint:true});
  if(opened.dev!==before.dev||opened.ino!==before.ino)fail('ARTIFACT_CHANGED');
  const bytes=Buffer.alloc(Number(before.size));let offset=0;
  while(offset<bytes.length){const r=await f.read(bytes,offset,bytes.length-offset,offset);if(!r.bytesRead)fail('ARTIFACT_CHANGED');offset+=r.bytesRead;}
  const after=await f.stat({bigint:true}),named=await fs.lstat(file,{bigint:true});
  for(const st of [after,named])if(st.dev!==before.dev||st.ino!==before.ino||st.size!==before.size||st.ctimeNs!==before.ctimeNs||st.mtimeNs!==before.mtimeNs||st.nlink!==1n)fail('ARTIFACT_CHANGED');
  return bytes;
 }finally{await f.close();}
}
async function command(exe,args,input=''){
 if(!['/usr/bin/plutil','/usr/bin/codesign','/usr/bin/python3'].includes(exe))fail('COMMAND_DENIED');
 return new Promise((resolve,reject)=>{
  const child=spawn(exe,args,{shell:false,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'}});
  let out=Buffer.alloc(0),error=null,diagnostics=0;
  const timer=setTimeout(()=>{error=Error('COMMAND_TIMEOUT');child.kill('SIGKILL');},60000);
  child.stdout.on('data',b=>{if(out.length+b.length>1024*1024){error=Error('COMMAND_OUTPUT_LIMIT');child.kill('SIGKILL');}else out=Buffer.concat([out,b]);});
  child.stderr.on('data',b=>{diagnostics+=b.length;if(diagnostics>65536){error=Error('COMMAND_DIAGNOSTICS_LIMIT');child.kill('SIGKILL');}});
  child.on('error',e=>{error=e;});
  child.on('close',code=>{clearTimeout(timer);if(error||code!==0)reject(error??Error('COMMAND_FAILED '+path.basename(exe)));else resolve(out);});
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
const plist=async data=>command('/usr/bin/plutil',['-convert','xml1','-o','-','-'],JSON.stringify(data));
async function unsignedCodeDigest(binary,scratch){
 const temp=path.join(scratch,'.tree-code-'+randomUUID());
 await fs.copyFile(binary,temp,constants.COPYFILE_EXCL);await fs.chmod(temp,0o700);
 try{await command('/usr/bin/codesign',['--remove-signature',temp]);return sha(normalizedStrippedMacFileCode(await protectedRead(temp,16*1024*1024)));}
 finally{await fs.unlink(temp);}
}
async function signGrant(stage,g,candidate,build){
 const role=g.role??(g.permissions.includes('write')?'workspace':'reference');
 if(!['workspace','reference'].includes(role)||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(g.id))fail('INVALID_GRANT');
 const dir=path.join(stage,g.id),app=path.join(dir,'TreeReader.app'),contents=path.join(app,'Contents'),macos=path.join(contents,'MacOS');
 for(const p of [dir,app,contents,macos])await fs.mkdir(p,{mode:0o700});
 const binary=path.join(macos,'tree-broker');await fs.copyFile(candidate,binary,constants.COPYFILE_EXCL);await fs.chmod(binary,0o500);
 if(sha(await protectedRead(binary,16*1024*1024))!==build.release_sha256)fail('TREE_BINARY_CHANGED');
 const info={CFBundleExecutable:'tree-broker',CFBundleIdentifier:'local.gsa.directory.'+g.id,CFBundleName:'TreeReader',
  CFBundlePackageType:'APPL',CFBundleVersion:'1',GSAWorkspaceID:g.id,GSAWorkspaceRole:role,
  GSAWorkspaceRoot:g.canonicalRoot,GSARevision:g.revision,GSADevice:g.rootIdentity.device,GSAInode:g.rootIdentity.inode};
 await fs.writeFile(path.join(contents,'Info.plist'),await plist(info),{mode:0o600,flag:'wx'});
 const entitlements={'com.apple.security.app-sandbox':true,
  'com.apple.security.temporary-exception.files.absolute-path.read-only':[g.canonicalRoot+'/']};
 const entitlementFile=path.join(dir,'entitlements.plist');
 await fs.writeFile(entitlementFile,await plist(entitlements),{mode:0o600,flag:'wx'});
 await command('/usr/bin/codesign',['--force','--sign','-','--entitlements',entitlementFile,app]);
 await fs.chmod(path.join(contents,'_CodeSignature'),0o700);
 await fs.chmod(path.join(contents,'_CodeSignature/CodeResources'),0o600);
 await command('/usr/bin/codesign',['--verify','--strict',app]);
 const signed=await command('/usr/bin/codesign',['--display','--entitlements',':-',app]);
 const actual=JSON.parse((await command('/usr/bin/plutil',['-convert','json','-o','-','-'],signed.toString())).toString());
 if(!isDeepStrictEqual(actual,entitlements)||await unsignedCodeDigest(binary,stage)!==build.code_sha256)fail('SIGNED_TREE_MISMATCH');
 const artifacts={};
 for(const rel of ['Contents/MacOS/tree-broker','Contents/Info.plist','Contents/_CodeSignature/CodeResources'])
  artifacts[rel]=sha(await protectedRead(path.join(app,rel),16*1024*1024));
 return {id:g.id,root:g.canonicalRoot,rootIdentity:g.rootIdentity,revision:g.revision,role,
  artifacts,presign_sha256:build.release_sha256,code_sha256:build.code_sha256};
}
async function fsyncStage(dir){
 for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);const info=await fs.lstat(file);
  if(info.isSymbolicLink()||(!info.isDirectory()&&!info.isFile()))fail('UNSAFE_STAGE_ENTRY');
  if(info.isDirectory())await fsyncStage(file);
  else{const fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{await fd.sync();}finally{await fd.close();}}
 }
 const fd=await fs.open(dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{await fd.sync();}finally{await fd.close();}
}
const publishProgram=String.raw`
import os,sys,stat,ctypes,re
root,stage=sys.argv[1:3]
if not re.fullmatch(r'\.directory-copy\.stage-[0-9a-f-]{36}',stage):sys.exit(75)
fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
parent=os.fstat(fd)
if not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=os.getuid() or stat.S_IMODE(parent.st_mode)!=0o700:sys.exit(75)
current=os.stat(stage,dir_fd=fd,follow_symlinks=False)
if not stat.S_ISDIR(current.st_mode) or current.st_uid!=os.getuid() or stat.S_IMODE(current.st_mode)!=0o700:sys.exit(75)
try: os.stat('directory-copy',dir_fd=fd,follow_symlinks=False);sys.exit(75)
except FileNotFoundError:pass
lib=ctypes.CDLL(None,use_errno=True);fn=lib.renameatx_np
fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];fn.restype=ctypes.c_int
if fn(fd,os.fsencode(stage),fd,b'directory-copy',4)!=0:sys.exit(75)
published=os.stat('directory-copy',dir_fd=fd,follow_symlinks=False)
if (published.st_dev,published.st_ino)!=(current.st_dev,current.st_ino):sys.exit(75)
os.fsync(fd)
print('TREE_INSTALL_PUBLISHED')
`;

export async function applyQualifiedMacDirectory(identityRoot,archiveRoot){
 if(process.platform!=='darwin'||process.arch!=='arm64')fail('APPLE_SILICON_MAC_REQUIRED');
 if(!path.isAbsolute(identityRoot)||await fs.realpath(identityRoot)!==identityRoot||
    !path.isAbsolute(archiveRoot)||await fs.realpath(archiveRoot)!==archiveRoot)fail('NONCANONICAL_PATH');
 await privateDir(identityRoot);await privateDir(archiveRoot);
 return withStoppedMacConnector(identityRoot,async assertFence=>{
  const registry=await loadTrustedRegistry(identityRoot),selected=registry.list();
  if(!selected.length||selected.length>16)fail('NO_BOUND_ROOTS');
  await assertMacFileInstallationSeparated(registry,identityRoot);
  const existing=path.join(identityRoot,'directory-copy');
  try{await fs.lstat(existing);fail('TREE_INSTALL_ALREADY_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  const build=JSON.parse((await protectedRead(path.join(archiveRoot,'build.json'),1_048_576)).toString('utf8'));
  const evidenceBytes=await protectedRead(path.join(archiveRoot,'native-evidence.json'),1_048_576);
  const evidence=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(evidenceBytes));
  requireMacDirectoryBuild(build);requireMacDirectoryEvidence(evidence,build);
  if(build.hostRelease!==os.release()||build.arch!==process.arch)fail('QUALIFIED_HOST_MISMATCH');
  const candidate=path.join(archiveRoot,'candidate-tree-broker'),bytes=await protectedRead(candidate,16*1024*1024);
  if(sha(bytes)!==build.release_sha256)fail('TREE_RELEASE_HASH_MISMATCH');
  const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../native/macos-files/tree-broker.swift');
  if(sha(await fs.readFile(source))!==build.source_sha256)fail('TREE_SOURCE_CHANGED');
  const stage=path.join(identityRoot,'.directory-copy.stage-'+randomUUID());
  await fs.mkdir(stage,{mode:0o700});await assertMacFileInstallationSeparated(registry,stage);
  await fs.mkdir(path.join(stage,'copy-records'),{mode:0o700});
  const bindings=[];
  for(const grant of selected){assertFence();bindings.push(await signGrant(stage,grant,candidate,build));}
  const key=randomBytes(32),body=JSON.stringify({format:'gsa-directory-copy-installation-v1',
   hostRelease:os.release(),arch:process.arch,build,grants:bindings,
   evidence_file:'native-evidence.json',evidence_sha256:sha(evidenceBytes)});
  await fs.writeFile(path.join(stage,'native-evidence.json'),evidenceBytes,{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(stage,'proof-key'),key,{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(stage,'install.json'),JSON.stringify({body,hmac:createHmac('sha256',key).update(body).digest('hex')}),{flag:'wx',mode:0o600});
  await fsyncStage(stage);
  if(!isDeepStrictEqual(registry.list(),(await loadTrustedRegistry(identityRoot)).list()))fail('GRANTS_CHANGED');
  assertFence();
  const result=await command('/usr/bin/python3',['-I','-c',publishProgram,identityRoot,path.basename(stage)]);
  if(result.toString().trim()!=='TREE_INSTALL_PUBLISHED')fail('TREE_PUBLICATION_UNKNOWN');
  assertFence();
  return {state:'DIRECTORY_COPY_INSTALLED_NOT_ACTIVATED',grants:bindings.length,
   installation:path.join(identityRoot,'directory-copy'),build_sha256:sha(await protectedRead(path.join(archiveRoot,'build.json'),1_048_576))};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const argv=process.argv.slice(2);
 if(argv.length!==3||argv[0]!=='apply'||!path.isAbsolute(argv[1])||!path.isAbsolute(argv[2])){console.error('Usage: node scripts/install-mac-directory-copy.mjs apply /absolute/identity /absolute/qualified-archive');process.exitCode=1;}
 else applyQualifiedMacDirectory(argv[1],argv[2]).then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e.code==='RESULT_UNKNOWN'?'RESULT_UNKNOWN':e.message);process.exitCode=1;});
}
