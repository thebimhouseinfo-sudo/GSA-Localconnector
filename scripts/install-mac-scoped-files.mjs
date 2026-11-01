#!/usr/bin/env node
/** Private fixed-operation Mac file installer. Inspect never enrolls roots.
 * Publication requires a bounded real RELEASE fixture, not a list of check names.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {loadTrustedRegistry} from '../dist/src/local/grants.js';
import {identityDirectory} from '../dist/src/local/identity.js';
import {normalizedStrippedMacFileCode} from '../dist/src/hosts/macos-file-code.js';
import {requireMacFileEvidence,MAC_FILE_SIGNING_PROFILE} from '../dist/src/hosts/macos-file-evidence.js';
import {requireMacRecoveryQualification} from '../dist/src/hosts/macos-recovery-evidence.js';
import {FileTransactionStore} from '../dist/src/local/file-transaction-store.js';
export {requireMacFileEvidence};
import {assertMacFileInstallationSeparated} from '../dist/src/hosts/macos-scoped-files.js';
const here=path.dirname(fileURLToPath(import.meta.url)),source=path.resolve(here,'../native/macos-files/broker.swift');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const artifacts=['Contents/MacOS/broker','Contents/Info.plist','Contents/_CodeSignature/CodeResources'];
export const signingProfile=MAC_FILE_SIGNING_PROFILE;
const fail=message=>{throw Object.assign(Error(message),{code:'SECURITY_BLOCKED'});};
async function privateDirectory(directory){const s=await fs.lstat(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700||await fs.realpath(directory)!==directory)fail('Unsafe installation directory');}
async function readExactBounded(handle,size){
 const bytes=Buffer.alloc(size);let offset=0;
 while(offset<size){const result=await handle.read(bytes,offset,size-offset,offset);if(!result.bytesRead)fail('Protected file changed during read');offset+=result.bytesRead;}
 if((await handle.read(Buffer.alloc(1),0,1,offset)).bytesRead)fail('Protected file grew during read');
 return bytes;
}
async function run(executable,args,input='',maximum=65536){return new Promise((resolve,reject)=>{const child=spawn(executable,args,{shell:false,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:os.homedir(),LANG:'C',TMPDIR:'/private/tmp'},stdio:['pipe','pipe','pipe']});let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),error;const timer=setTimeout(()=>{error=Error('Installer command timed out');child.kill('SIGKILL');},60000);for(const [stream,isOut] of [[child.stdout,true],[child.stderr,false]])stream.on('data',bytes=>{const prior=isOut?stdout:stderr;if(prior.length+bytes.length>maximum){error=Error('Installer command output limit');child.kill('SIGKILL');}else if(isOut)stdout=Buffer.concat([stdout,bytes]);else stderr=Buffer.concat([stderr,bytes]);});child.on('error',e=>{error=e;});child.on('close',code=>{clearTimeout(timer);if(error||code!==0)reject(error??Error('Installer command failed: '+path.basename(executable)+' ('+code+')'));else resolve(stdout);});child.stdin.on('error',()=>{});child.stdin.end(input);});}
async function plist(value){return run('/usr/bin/plutil',['-convert','xml1','-o','-','-'],JSON.stringify(value));}
const roleOf=g=>g.role??(g.permissions.includes('write')?'workspace':'reference');
const snapshot=registry=>registry.list().map(g=>({id:g.id,root:g.canonicalRoot,role:roleOf(g),revision:g.revision,rootIdentity:g.rootIdentity,permissions:[...g.permissions].sort()})).sort((a,b)=>a.id.localeCompare(b.id));
export async function inspectMacScopedFiles(identityRoot=identityDirectory()){
 if(process.platform!=='darwin'||process.arch!=='arm64')fail('Apple Silicon macOS required');await privateDirectory(identityRoot);
 const registry=await loadTrustedRegistry(identityRoot),grants=snapshot(registry);if(!grants.length)fail('No explicitly configured trusted roots');
 return {state:'SCOPED_FILES_PLAN',identityRoot,installationRoot:path.join(identityRoot,'scoped-files'),grants,operations:['create_file','create_directory','copy_file'],recovery:false};
}
/** The Python process keeps the SAME kernel flock until the whole callback ends.
 * No owner session/token is read or rewritten; an active owner simply blocks us. */
export async function withStoppedMacConnector(identityRoot,operation){
 await privateDirectory(identityRoot);
 const code=`import os,sys,stat,fcntl,json,re,ctypes
root=sys.argv[1]; p=os.path.join(root,'server-owner.lock')
d=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW); ds=os.fstat(d)
f=os.open(p,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)
s=os.fstat(f); n=os.lstat(p)
if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o077 or s.st_nlink!=1 or (s.st_dev,s.st_ino)!=(n.st_dev,n.st_ino): sys.exit(78)
try: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError: sys.exit(75)
print('LOCKED',flush=True)
line=sys.stdin.buffer.readline(8193)
if not line: sys.exit(0)
try:
 if len(line)>8192 or not line.endswith(b'\\n'): raise ValueError('request')
 q=json.loads(line); keys={'command','stage','stageIdentity','oldIdentity'}
 if type(q)!=dict or set(q)!=keys or q['command']!='PUBLISH' or not isinstance(q['stage'],str) or not re.fullmatch(r'\\.scoped-files\\.stage-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',q['stage']): raise ValueError('request')
 def pin(v):
  if type(v)!=dict or set(v)!={'device','inode'} or any(not isinstance(v[k],str) or not re.fullmatch(r'[0-9]{1,32}',v[k]) for k in v): raise ValueError('pin')
  return (int(v['device']),int(v['inode']))
 def directory(name):
  x=os.stat(name,dir_fd=d,follow_symlinks=False)
  if not stat.S_ISDIR(x.st_mode) or x.st_uid!=os.getuid() or stat.S_IMODE(x.st_mode)!=0o700: raise ValueError('directory')
  return (x.st_dev,x.st_ino)
 new=pin(q['stageIdentity']); old=None if q['oldIdentity'] is None else pin(q['oldIdentity'])
 def check_root():
  current=os.lstat(root); lock=os.stat('server-owner.lock',dir_fd=d,follow_symlinks=False)
  held=os.fstat(f)
  if os.path.realpath(root)!=root or not stat.S_ISDIR(current.st_mode) or current.st_uid!=os.getuid() or stat.S_IMODE(current.st_mode)!=0o700 or (current.st_dev,current.st_ino)!=(ds.st_dev,ds.st_ino) or not stat.S_ISREG(lock.st_mode) or lock.st_uid!=os.getuid() or lock.st_mode&0o077 or lock.st_nlink!=1 or (lock.st_dev,lock.st_ino)!=(s.st_dev,s.st_ino) or (held.st_dev,held.st_ino)!=(s.st_dev,s.st_ino): raise ValueError('changed')
 check_root()
 if directory(q['stage'])!=new: raise ValueError('changed')
 try: live=directory('scoped-files')
 except FileNotFoundError: live=None
 if live!=old: raise ValueError('changed')
 lib=ctypes.CDLL(None,use_errno=True); fn=lib.renameatx_np; fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]; fn.restype=ctypes.c_int
 if fn(d,os.fsencode(q['stage']),d,b'scoped-files',2 if old else 4)!=0: raise OSError(ctypes.get_errno(),'renameatx_np')
 if directory('scoped-files')!=new or (old is not None and directory(q['stage'])!=old): raise ValueError('postcondition')
 check_root()
 os.fsync(d)
 print('{"ok":true}',flush=True)
except Exception:
 print('{"ok":false}',flush=True)
sys.stdin.buffer.read()
`;
 const child=spawn('/usr/bin/python3',['-c',code,identityRoot],{shell:false,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:os.homedir()}});
 let ready=false,closed=false,exitCode;const completion=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',value=>{closed=true;exitCode=value;resolve(value);});});
 child.stdin.on('error',()=>{});
 let output='',pending,used=false;
 const unknown=()=>Object.assign(Error('Publication outcome unknown'),{code:'RESULT_UNKNOWN'});
 child.stdout.on('data',data=>{output+=data;if(pending){if(output.length>4096){pending.reject(unknown());pending=null;}else if(output.includes('\n')){const reply=output;output='';const waiter=pending;pending=null;waiter.resolve(reply);}}});
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Owner fencing timeout'));},5000);const onData=()=>{if(output==='LOCKED\n'){output='';ready=true;clearTimeout(timer);child.stdout.off('data',onData);resolve();}else if(output.length>32){clearTimeout(timer);reject(Error('Invalid owner fencing response'));}};child.stdout.on('data',onData);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',()=>{clearTimeout(timer);if(!ready)reject(Error('Active connector or unsafe owner storage; stop connector first'));if(pending){pending.reject(unknown());pending=null;}});child.stderr.on('data',()=>{});});
  const publish=async(stage,stageIdentity,oldIdentity)=>{if(used||closed)throw unknown();used=true;const request=JSON.stringify({command:'PUBLISH',stage,stageIdentity,oldIdentity})+'\n';if(Buffer.byteLength(request)>8192)throw unknown();
   const reply=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending=null;child.kill('SIGKILL');reject(unknown());},5000);pending={resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};child.stdin.write(request,error=>{if(error&&pending){pending.reject(unknown());pending=null;}});});
   if(reply!=='{"ok":true}\n'||closed)throw unknown();};
  const result=await operation(()=>{if(closed){if(used)throw unknown();fail('Owner fence was lost before publication');}},publish);if(closed){if(used)throw unknown();fail('Owner fence was lost during publication');}return result;}
 finally{child.stdin.end();await completion;if(ready&&exitCode!==0){if(used)throw unknown();fail('Owner fence failed');}}
}
async function unsignedCodeDigest(binary,directory){
 const copy=path.join(directory,'.code-check-'+randomUUID());await fs.copyFile(binary,copy,fs.constants.COPYFILE_EXCL);await fs.chmod(copy,0o700);
 try{await run('/usr/bin/codesign',['--remove-signature',copy]);return sha(normalizedStrippedMacFileCode(await fs.readFile(copy)));}finally{await fs.unlink(copy);}
}
export async function buildMacFileRelease(directory){
 await privateDirectory(directory);const compiler=(await run('/usr/bin/xcrun',['--find','swiftc'])).toString().trim();if(!path.isAbsolute(compiler))fail('Compiler path unavailable');
 const sdkPath=(await run('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'])).toString().trim(),sdkVersion=(await run('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-version'])).toString().trim();if(!path.isAbsolute(sdkPath))fail('SDK path unavailable');
 const sdk={path:sdkPath,version:sdkVersion,settings_sha256:sha(await fs.readFile(path.join(sdkPath,'SDKSettings.json')))};
 const compilerVersion=(await run(compiler,['--version'])).toString().trim(),sourceBytes=await fs.readFile(source),binary=path.join(directory,'release-broker');
 const arguments_=['-O','-Xlinker','-reproducible'];await run('/usr/bin/xcrun',['--sdk','macosx','swiftc','-sdk',sdkPath,...arguments_,source,'-o',binary]);await fs.chmod(binary,0o500);
 const uuidOutput=(await run('/usr/bin/dwarfdump',['--uuid',binary])).toString().trim(),uuidMatch=/^UUID: ([A-F0-9-]{36}) \(arm64\) /.exec(uuidOutput);if(!uuidMatch)fail('Release UUID unavailable');
 return {binary,build:{uuid:uuidMatch[1],source_sha256:sha(sourceBytes),compiler_sha256:sha(await fs.readFile(compiler)),compiler_version:compilerVersion,driver:'xcrun-macosx-swiftc-v1',sdk,arguments:arguments_,release_sha256:sha(await fs.readFile(binary)),code_sha256:await unsignedCodeDigest(binary,directory),signing_profile:signingProfile,hostRelease:os.release(),arch:process.arch}};
}
/** Root-specific resigning changes signature bytes, but retains this exact release build. */
export async function buildMacScopedBundle(installation,grant,releaseBinary){
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(grant.id)||!['workspace','reference'].includes(grant.role)||!Number.isSafeInteger(grant.revision)||grant.revision<1)fail('Invalid selected grant');
 const directory=path.join(installation,grant.id),app=path.join(directory,'Broker.app'),contents=path.join(app,'Contents'),macos=path.join(contents,'MacOS');for(const p of [directory,app,contents,macos])await fs.mkdir(p,{mode:0o700});
 const binary=path.join(macos,'broker');await fs.copyFile(releaseBinary,binary,fs.constants.COPYFILE_EXCL);await fs.chmod(binary,0o500);const presignDigest=sha(await fs.readFile(binary));if(presignDigest!==sha(await fs.readFile(releaseBinary)))fail('Copied broker differs from staged release');
 const info={CFBundleExecutable:'broker',CFBundleIdentifier:'local.gsa.scoped.'+grant.id,CFBundleName:'Broker',CFBundlePackageType:'APPL',CFBundleVersion:'1',GSAWorkspaceID:grant.id,GSAWorkspaceRole:grant.role,GSAWorkspaceRoot:grant.root,GSARevision:grant.revision,GSADevice:grant.rootIdentity.device,GSAInode:grant.rootIdentity.inode};
 await fs.writeFile(path.join(contents,'Info.plist'),await plist(info),{mode:0o600,flag:'wx'});
 const entitlement='com.apple.security.temporary-exception.files.absolute-path.'+(grant.role==='reference'?'read-only':'read-write');const profile={'com.apple.security.app-sandbox':true,[entitlement]:[grant.root+'/']};const entitlements=path.join(directory,'entitlements.plist');await fs.writeFile(entitlements,await plist(profile),{mode:0o600,flag:'wx'});
 await run('/usr/bin/codesign',['--force','--sign','-','--entitlements',entitlements,app]);const signature=path.join(contents,'_CodeSignature');await fs.chmod(signature,0o700);await fs.chmod(path.join(signature,'CodeResources'),0o600);await run('/usr/bin/codesign',['--verify','--strict',app]);
 const signed=await run('/usr/bin/codesign',['--display','--entitlements',':-',app]);const observed=JSON.parse((await run('/usr/bin/plutil',['-convert','json','-o','-','-'],signed.toString())).toString());if(!isDeepStrictEqual(observed,profile))fail('Signed entitlement profile differs');
 const codeDigest=await unsignedCodeDigest(binary,installation),releaseDigest=await unsignedCodeDigest(releaseBinary,installation);if(codeDigest!==releaseDigest)fail('Signed broker differs from staged release code');
 const hashes={};for(const name of artifacts)hashes[name]=sha(await fs.readFile(path.join(app,name)));return {id:grant.id,root:grant.root,role:grant.role,rootIdentity:grant.rootIdentity,revision:grant.revision,presign_sha256:presignDigest,code_sha256:codeDigest,artifacts:hashes};
}
/** Re-sign only the immutable qualified recovery bytes for this working root. */
export async function buildMacRecoveryBundle(installation,grant,recoveryRoot,releaseBytes,qualified){
 grant=structuredClone(grant);qualified=structuredClone(qualified);
 if(!grant||grant.role!=='workspace'||!/^[a-zA-Z0-9][-_a-zA-Z0-9]{0,63}$/.test(grant.id)||!Number.isSafeInteger(grant.revision)||grant.revision<1||!(releaseBytes instanceof Uint8Array)||releaseBytes.byteLength>16*1024*1024||!qualified||!/^([a-f0-9]{64})$/.test(qualified.code_sha256)||sha(releaseBytes)!==qualified.release_sha256)fail('Invalid recovery release or grant');
 const bytes=Buffer.from(releaseBytes),identity=async p=>{const s=await fs.lstat(p,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(p)!==p)fail('Recovery root changed');return {device:String(s.dev),inode:String(s.ino)};};
 await privateDirectory(installation);await privateDirectory(recoveryRoot);const stagePin=await identity(installation),rootPin=await identity(recoveryRoot),workPin=await identity(grant.root);
 if(!isDeepStrictEqual(workPin,grant.rootIdentity)||workPin.device!==rootPin.device)fail('Recovery root identity changed');
 const pins=[];const pin=async p=>{await privateDirectory(p);pins.push({path:p,identity:await identity(p)});};
 const check=async()=>{await privateDirectory(installation);await privateDirectory(recoveryRoot);if(!isDeepStrictEqual(await identity(installation),stagePin)||!isDeepStrictEqual(await identity(recoveryRoot),rootPin)||!isDeepStrictEqual(await identity(grant.root),workPin))fail('Recovery root changed');for(const p of pins){await privateDirectory(p.path);if(!isDeepStrictEqual(await identity(p.path),p.identity))fail('Recovery bundle directory changed');}};
 const dir=path.join(installation,grant.id),app=path.join(dir,'RecoveryBroker.app'),contents=path.join(app,'Contents'),macos=path.join(contents,'MacOS');await pin(dir);
 for(const p of [app,contents,macos]){await check();await fs.mkdir(p,{mode:0o700});await pin(p);}
 const binary=path.join(macos,'recovery-broker');await fs.writeFile(binary,bytes,{mode:0o500,flag:'wx'});if(sha(await fs.readFile(binary))!==qualified.release_sha256)fail('Recovery release differs');
 const info={CFBundleExecutable:'recovery-broker',CFBundleIdentifier:'local.gsa.recovery.'+grant.id,CFBundleName:'RecoveryBroker',CFBundlePackageType:'APPL',CFBundleVersion:'1',GSARecoveryProtocol:'gsa-file-recovery-v1',GSAWorkspaceRoot:grant.root,GSARecoveryRoot:recoveryRoot,GSAWorkspaceID:grant.id,GSARevision:grant.revision,GSADevice:workPin.device,GSAInode:workPin.inode,GSARecoveryDevice:rootPin.device,GSARecoveryInode:rootPin.inode};
 await fs.writeFile(path.join(contents,'Info.plist'),await plist(info),{mode:0o600,flag:'wx'});await check();
 const right='com.apple.security.temporary-exception.files.absolute-path.read-write',profile={'com.apple.security.app-sandbox':true,[right]:[grant.root+'/',recoveryRoot+'/']},entitlements=path.join(dir,'recovery-entitlements.plist');
 await fs.writeFile(entitlements,await plist(profile),{mode:0o600,flag:'wx'});await check();
 await run('/usr/bin/codesign',['--force','--sign','-','--entitlements',entitlements,app]);await check();
 await fs.chmod(path.join(contents,'_CodeSignature'),0o700);await pin(path.join(contents,'_CodeSignature'));await fs.chmod(path.join(contents,'_CodeSignature/CodeResources'),0o600);await run('/usr/bin/codesign',['--verify','--strict',app]);
 const signed=await run('/usr/bin/codesign',['--display','--entitlements',':-',app]);const observed=JSON.parse((await run('/usr/bin/plutil',['-convert','json','-o','-','-'],signed.toString())).toString());
 if(!isDeepStrictEqual(observed,profile)||await unsignedCodeDigest(binary,installation)!==qualified.code_sha256)fail('Recovery signed code or profile differs');await check();
 const hashes={};for(const name of ['Contents/MacOS/recovery-broker','Contents/Info.plist','Contents/_CodeSignature/CodeResources'])hashes[name]=sha(await fs.readFile(path.join(app,name)));await check();
 return {root:recoveryRoot,rootIdentity:rootPin,artifacts:hashes,code_sha256:qualified.code_sha256};
}
/** Compare raw BASE inputs with the exact hashes carried by the accepted report. */
export function requireMacRecoveryBaseInputs(report,baseBuild,baseEvidence,baseBinary){
 const hashes=report?.sourceHashes;
 if(!hashes||![baseBuild,baseEvidence,baseBinary].every(bytes=>bytes instanceof Uint8Array)||
  sha(baseBuild)!==hashes.baseBuild||sha(baseEvidence)!==hashes.baseEvidence||sha(baseBinary)!==hashes.baseBinary)
  fail('Recovery archive BASE inputs differ from accepted qualification');
}
/** Validate physical root separation; ownership of existing captures is checked separately. */
export async function validateRecoveryRoot(registry,id,root,stage){
 const selected=registry.list(),grant=selected.find(item=>item.id===id);
 if(!grant||grant.role!=='workspace'||!grant.permissions.includes('write'))fail('Recovery root requires a working grant');
 const chain=async(directory,privateRoot=false)=>{
  if(!path.isAbsolute(directory)||path.normalize(directory)!==directory||directory==='/'||await fs.realpath(directory)!==directory)fail('Unsafe recovery root path');
  const parts=[];for(let p=directory;;p=path.dirname(p)){parts.unshift(p);if(p===path.dirname(p))break;}
  const result=[];for(const p of parts){const s=await fs.lstat(p,{bigint:true});
   if(!s.isDirectory()||s.isSymbolicLink())fail('Unsafe recovery root ancestry');
   if(privateRoot&&(![0n,BigInt(process.getuid())].includes(s.uid)||((s.mode&0o022n)!==0n&&!(s.uid===0n&&(s.mode&0o1000n)!==0n))))fail('Unsafe private recovery ancestry');
   if(privateRoot&&p===directory&&(s.uid!==BigInt(process.getuid())||(s.mode&0o777n)!==0o700n))fail('Unsafe recovery directory');
   result.push({device:String(s.dev),inode:String(s.ino)});
  }return result;
 };
 const same=(a,b)=>a.device===b.device&&a.inode===b.inode;
 const recovery=await chain(root,true),recoveryIdentity=recovery.at(-1),protectedRoots=[{path:stage,chain:await chain(stage,true)}],workRoots=[];
 const installation=path.join(path.dirname(stage),'scoped-files');let installationExists=true;try{protectedRoots.push({path:installation,chain:await chain(installation,true)});}catch(error){if(error.code!=='ENOENT')throw error;installationExists=false;}
 for(const item of selected){const work=await chain(item.canonicalRoot),workIdentity=work.at(-1);
  if(!same(workIdentity,item.rootIdentity))fail('Selected root changed');
  if(work.some(v=>same(v,recoveryIdentity))||recovery.some(v=>same(v,workIdentity)))fail('Recovery root overlaps selected root');
  workRoots.push({path:item.canonicalRoot,chain:work});
 }
 for(const protectedRoot of protectedRoots){const protectedIdentity=protectedRoot.chain.at(-1);
  if(protectedRoot.chain.some(v=>same(v,recoveryIdentity))||recovery.some(v=>same(v,protectedIdentity)))fail('Recovery root overlaps installation');
 }
 if(recoveryIdentity.device!==grant.rootIdentity.device)fail('Recovery root must be on the workspace volume');
 for(const item of workRoots)if(!isDeepStrictEqual(await chain(item.path),item.chain))fail('Selected root changed during validation');
 for(const item of protectedRoots)if(!isDeepStrictEqual(await chain(item.path,true),item.chain))fail('Installation changed during validation');
 if(!installationExists){try{await fs.lstat(installation);fail('Installation appeared during validation');}catch(error){if(error.code!=='ENOENT')throw error;}}
 const rechecked=await chain(root,true);if(!isDeepStrictEqual(rechecked,recovery)||!isDeepStrictEqual(registry.list(),selected))fail('Recovery roots changed during validation');
 return recoveryIdentity;
}
/** Reuse of an occupied recovery root requires the previous authenticated binding. */
export async function requireRecoveryRootOwnership(installation,grant,root,rootIdentity){
 grant=structuredClone(grant);rootIdentity=structuredClone(rootIdentity);
 await privateDirectory(installation);await privateDirectory(root);
 const installationPin=await fs.lstat(installation,{bigint:true}),rootPin=await fs.lstat(root,{bigint:true}),pins=[];
 const identity=s=>({device:String(s.dev),inode:String(s.ino)});
 if(!isDeepStrictEqual(identity(rootPin),rootIdentity))fail('Recovery root identity differs');
 const check=async()=>{await privateDirectory(installation);await privateDirectory(root);const a=await fs.lstat(installation,{bigint:true}),b=await fs.lstat(root,{bigint:true});if(a.dev!==installationPin.dev||a.ino!==installationPin.ino||b.dev!==rootPin.dev||b.ino!==rootPin.ino)fail('Recovery binding changed');};
 const read=async(name,max)=>{await check();const file=path.join(installation,name);let handle;
  try{handle=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const before=await handle.stat({bigint:true});
   if(!before.isFile()||before.uid!==BigInt(process.getuid())||(before.mode&0o777n)!==0o600n||before.nlink!==1n||before.size>BigInt(max))fail('Unsafe recovery proof');
   const bytes=await readExactBounded(handle,Number(before.size)),after=await handle.stat({bigint:true}),named=await fs.lstat(file,{bigint:true});
   if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.ctimeNs!==after.ctimeNs||before.mtimeNs!==after.mtimeNs||after.dev!==named.dev||after.ino!==named.ino||after.ctimeNs!==named.ctimeNs||after.mtimeNs!==named.mtimeNs||named.nlink!==1n)fail('Recovery proof changed');
   pins.push({file,stat:after});await check();return bytes;
  }finally{if(handle)await handle.close();}
 };
 const key=await read('proof-key',32);if(key.length!==32)fail('Unsafe recovery proof key');let envelope,proof;
 try{envelope=JSON.parse((await read('install.json',1024*1024)).toString('utf8'));
  if(typeof envelope.body!=='string'||typeof envelope.hmac!=='string'||!/^[a-f0-9]{64}$/.test(envelope.hmac)||!timingSafeEqual(createHmac('sha256',key).update(envelope.body).digest(),Buffer.from(envelope.hmac,'hex')))fail('Unauthenticated recovery proof');
  proof=JSON.parse(envelope.body);
 }catch(error){if(error.code==='SECURITY_BLOCKED')throw error;fail('Unsafe recovery proof');}
 if(proof.format!=='gsa-scoped-files-v2'||proof.hostRelease!==os.release()||proof.arch!==process.arch||!proof.build||proof.build.hostRelease!==proof.hostRelease||proof.build.arch!==proof.arch||typeof proof.recoveryQualification!=='string'||Buffer.byteLength(proof.recoveryQualification,'utf8')>512*1024||!Array.isArray(proof.grants))fail('Stale recovery proof');
 requireMacFileEvidence(proof.evidence,proof.build);const qualified=requireMacRecoveryQualification(Buffer.from(proof.recoveryQualification,'utf8'),proof.recoveryBuild);
 if(qualified.host_release!==os.release()||qualified.arch!==process.arch)fail('Stale recovery qualification');
 const bindings=proof.grants.filter(item=>item&&item.id===grant.id);if(bindings.length!==1)fail('Missing recovery binding');const binding=bindings[0],recovery=binding.recovery;
 if(binding.role!=='workspace'||binding.role!==grant.role||binding.root!==grant.root||binding.revision!==grant.revision||!isDeepStrictEqual(binding.rootIdentity,grant.rootIdentity)||!recovery||recovery.root!==root||!isDeepStrictEqual(recovery.rootIdentity,rootIdentity)||recovery.code_sha256!==qualified.code_sha256)fail('Recovery binding differs');
 for(const pin of pins){const s=await fs.lstat(pin.file,{bigint:true});if(s.dev!==pin.stat.dev||s.ino!==pin.stat.ino||s.size!==pin.stat.size||s.ctimeNs!==pin.stat.ctimeNs||s.mtimeNs!==pin.stat.mtimeNs||s.nlink!==1n)fail('Recovery proof changed');}
 await check();return true;
}
/** Prepare only selected workspace roots, retaining any existing captures. */
export async function prepareRecoveryRoots(registry,identityRoot,stage,mapping,assertFence){
 if(typeof assertFence!=='function'||!mapping||typeof mapping!=='object'||Array.isArray(mapping)||Object.getPrototypeOf(mapping)!==Object.prototype)fail('Invalid recovery root mapping');
 mapping=structuredClone(mapping);await privateDirectory(identityRoot);await privateDirectory(stage);assertFence();
 const selected=registry.list(),work=selected.filter(g=>g.role==='workspace'&&g.permissions.includes('write'));
 if(!work.length||Object.keys(mapping).some(id=>!work.some(g=>g.id===id))||Object.values(mapping).some(v=>typeof v!=='string'||!path.isAbsolute(v)))fail('Recovery mapping contains an invalid workspace');
 const parent=path.join(identityRoot,'file-recovery');
 const checkSelections=async()=>{assertFence();if(!isDeepStrictEqual(await assertMacFileInstallationSeparated(registry,identityRoot),selected))fail('Selected grants changed');assertFence();};
 await checkSelections();
 if(work.some(g=>!Object.hasOwn(mapping,g.id))){await checkSelections();try{await fs.mkdir(parent,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}await privateDirectory(parent);await checkSelections();}
 const stable=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
 const observe=async root=>{await privateDirectory(root);const before=await fs.lstat(root,{bigint:true}),iterator=await fs.opendir(root);let occupied;
  try{occupied=!!(await iterator.read());}finally{await iterator.close();}
  await privateDirectory(root);const after=await fs.lstat(root,{bigint:true});if(!stable(before,after))fail('Recovery root occupancy changed');return {occupied,stat:after};};
 const result=[];
 for(const grant of work){
  assertFence();if(!/^[a-zA-Z0-9][-_a-zA-Z0-9]{0,63}$/.test(grant.id)||!Number.isSafeInteger(grant.revision)||grant.revision<1)fail('Invalid recovery grant');
  const custom=Object.hasOwn(mapping,grant.id),root=custom?mapping[grant.id]:path.join(parent,`${grant.id}-r${grant.revision}`);
  if(!custom){await privateDirectory(parent);await checkSelections();try{await fs.mkdir(root,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}await checkSelections();}
  const rootIdentity=await validateRecoveryRoot(registry,grant.id,root,stage);
  for(const prior of result){
   if(root===prior.root||root.startsWith(prior.root+'/')||prior.root.startsWith(root+'/'))fail('Recovery roots overlap');
  }
  const observation=await observe(root),occupied=observation.occupied;
  if(occupied)await requireRecoveryRootOwnership(path.join(identityRoot,'scoped-files'),{id:grant.id,role:grant.role,root:grant.canonicalRoot,rootIdentity:grant.rootIdentity,revision:grant.revision},root,rootIdentity);
  assertFence();result.push({id:grant.id,root,rootIdentity,observation,grant:{id:grant.id,role:grant.role,root:grant.canonicalRoot,rootIdentity:grant.rootIdentity,revision:grant.revision}});
 }
 for(const item of result){const current=await validateRecoveryRoot(registry,item.id,item.root,stage);if(!isDeepStrictEqual(current,item.rootIdentity))fail('Recovery root changed during preparation');
  const observation=await observe(item.root);
  if(observation.occupied!==item.observation.occupied||!stable(observation.stat,item.observation.stat))fail('Recovery root occupancy changed');if(observation.occupied)await requireRecoveryRootOwnership(path.join(identityRoot,'scoped-files'),item.grant,item.root,item.rootIdentity);
  await privateDirectory(item.root);if(!stable(observation.stat,await fs.lstat(item.root,{bigint:true})))fail('Recovery root occupancy changed');
 }
 if(!isDeepStrictEqual(registry.list(),selected))fail('Selected grants changed');assertFence();return result.map(({id,root,rootIdentity})=>({id,root,rootIdentity}));
}
/** Stage protected journal history while the caller continuously holds the owner fence. */
export async function stageRecoveryJournal(live,stage,assertFence){
 if(typeof assertFence!=='function')fail('Owner fence required');
 await privateDirectory(stage);const stagePin=await fs.lstat(stage,{bigint:true});assertFence();
 const checkStage=async()=>{await privateDirectory(stage);const s=await fs.lstat(stage,{bigint:true});if(s.dev!==stagePin.dev||s.ino!==stagePin.ino)fail('Stage directory changed');assertFence();};
 const source=path.join(live,'file-transactions'),destination=path.join(stage,'file-transactions');
 let sourcePin;try{await privateDirectory(live);await privateDirectory(source);sourcePin=await fs.lstat(source,{bigint:true});}
 catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.mkdir(destination,{mode:0o700});
 await privateDirectory(destination);const destinationPin=await fs.lstat(destination,{bigint:true});
 const checkDestination=async()=>{await checkStage();await privateDirectory(destination);const s=await fs.lstat(destination,{bigint:true});if(s.dev!==destinationPin.dev||s.ino!==destinationPin.ino)fail('Staged journal directory changed');};
 if(!sourcePin){await checkDestination();try{await fs.lstat(source);fail('Journal appeared during staging');}catch(error){if(error.code!=='ENOENT')throw error;}assertFence();return;}
 const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
 const record=new RegExp('^('+uuid+')\\.json$'),marker=new RegExp('^(?:'+uuid+'\\.lock|\\.transaction-'+uuid+')$');
 const stable=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
 const checkDir=async()=>{assertFence();await checkDestination();await privateDirectory(live);await privateDirectory(source);const s=await fs.lstat(source,{bigint:true});if(s.dev!==sourcePin.dev||s.ino!==sourcePin.ino)fail('Journal directory changed');assertFence();};
 const store=new FileTransactionStore(source),seen=new Map();
 await checkDir();
 for await(const entry of await fs.opendir(source)){
  const name=entry.name,match=record.exec(name);if(!match&&!marker.test(name))fail('Unsafe journal entry name');
  await checkDir();const file=path.join(source,name);let input;
  try{
   input=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   const before=await input.stat({bigint:true});
   if(!before.isFile()||before.uid!==BigInt(process.getuid())||(before.mode&0o777n)!==0o600n||before.nlink!==1n||before.size>32768n)fail('Unsafe journal entry');
   const bytes=await readExactBounded(input,Number(before.size));
   if(name.endsWith('.lock')&&bytes.length!==0)fail('Unsafe journal lock marker');
   if(match)await store.load(match[1]);
   const after=await input.stat({bigint:true}),named=await fs.lstat(file,{bigint:true});
   if(!stable(before,after)||!stable(after,named)||named.nlink!==1n)fail('Journal entry changed');
   await checkDir();const output=await fs.open(path.join(destination,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   let staged;try{await output.writeFile(bytes);await output.sync();staged=await output.stat({bigint:true});}finally{await output.close();}
   const stagedName=await fs.lstat(path.join(destination,name),{bigint:true});
   if(!stable(staged,stagedName)||!stagedName.isFile()||stagedName.nlink!==1n||stagedName.uid!==BigInt(process.getuid())||(stagedName.mode&0o777n)!==0o600n)fail('Staged journal entry changed');
   seen.set(name,{stat:after,staged});await checkDestination();
  }finally{if(input)await input.close();}
 }
 await checkDir();let count=0;
 for await(const entry of await fs.opendir(source)){
  const saved=seen.get(entry.name);if(!saved)fail('Journal entries changed');
  const current=await fs.lstat(path.join(source,entry.name),{bigint:true});if(!stable(saved.stat,current)||current.nlink!==1n)fail('Journal entry changed');count++;
 }
 if(count!==seen.size)fail('Journal entries changed');await checkDir();
 count=0;for await(const entry of await fs.opendir(destination)){
  const saved=seen.get(entry.name);if(!saved)fail('Staged journal entries changed');
  const current=await fs.lstat(path.join(destination,entry.name),{bigint:true});
  if(!stable(saved.staged,current)||!current.isFile()||current.nlink!==1n)fail('Staged journal entry changed');count++;
 }
 if(count!==seen.size)fail('Staged journal entries changed');await checkDir();
 await checkDestination();const output=await fs.open(destination,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{const s=await output.stat({bigint:true});if(s.dev!==destinationPin.dev||s.ino!==destinationPin.ino)fail('Staged journal directory changed');await output.sync();}finally{await output.close();}await checkDestination();assertFence();
}
/** Read exact retained qualification bytes; this inspection grants no authority to install. */
export async function readMacRecoveryArchive(archiveRoot){
 if(typeof archiveRoot!=='string'||!path.isAbsolute(archiveRoot))fail('Unsafe recovery archive path');
 await privateDirectory(archiveRoot);const archiveStat=await fs.lstat(archiveRoot),pins=[];
 const checkArchive=async()=>{await privateDirectory(archiveRoot);const current=await fs.lstat(archiveRoot);if(current.dev!==archiveStat.dev||current.ino!==archiveStat.ino)fail('Recovery archive directory changed');};
 const read=async(name,max)=>{
  await checkArchive();
  const file=path.join(archiveRoot,name);let handle;
  try{
   handle=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   const before=await handle.stat();
   if(!before.isFile()||before.uid!==process.getuid()||(before.mode&0o077)||before.nlink!==1||before.size>max)fail('Unsafe recovery archive file');
   const bytes=await readExactBounded(handle,before.size),after=await handle.stat(),visible=await fs.lstat(file);
   if(bytes.length!==before.size||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||visible.isSymbolicLink()||visible.dev!==after.dev||visible.ino!==after.ino)fail('Recovery archive file changed');
   await checkArchive();pins.push({file,stat:after});return bytes;
  }catch(error){if(error.code==='SECURITY_BLOCKED')throw error;fail('Unsafe recovery archive file');}
  finally{if(handle)await handle.close();}
 };
 const report=await read('report.json',512*1024),productionBytes=await read('production-build.json',64*1024),recoveryRelease=await read('production-release-recovery',16*1024*1024);
 const baseBytes=await read('base-build.json',64*1024),baseEvidenceBytes=await read('base-evidence.json',1024*1024),baseRelease=await read('base-release-broker',16*1024*1024);
 let productionBuild,baseBuild,baseEvidence;
 try{productionBuild=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(productionBytes));baseBuild=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(baseBytes));baseEvidence=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(baseEvidenceBytes));}
 catch{fail('Invalid recovery archive metadata');}
 const qualification=requireMacRecoveryQualification(report,productionBuild);
 const acceptedReport=JSON.parse(report.toString("utf8"));requireMacRecoveryBaseInputs(acceptedReport,baseBytes,baseEvidenceBytes,baseRelease);
 requireMacFileEvidence(baseEvidence,baseBuild);
 if(qualification.host_release!==os.release()||qualification.arch!==process.arch||baseBuild.hostRelease!==os.release()||baseBuild.arch!==process.arch||sha(recoveryRelease)!==qualification.release_sha256||sha(baseRelease)!==baseBuild.release_sha256)fail('Recovery archive host or release differs');
 const recoverySource=path.resolve(here,'../native/macos-files/recovery-broker.swift');
 if(sha(await fs.readFile(recoverySource))!==qualification.source_sha256)fail('Recovery source differs from accepted qualification');
 for(const {file,stat} of pins){const visible=await fs.lstat(file);if(visible.isSymbolicLink()||visible.dev!==stat.dev||visible.ino!==stat.ino||visible.size!==stat.size||visible.mtimeMs!==stat.mtimeMs||visible.ctimeMs!==stat.ctimeMs)fail('Recovery archive changed during inspection');}
 await checkArchive();
 return {report,productionBuild,recoveryRelease,baseBuild,baseEvidence,baseRelease,qualification};
}
/** Refuse BASE-only replacement when live recovery or its history could be lost. */
export async function assertLegacyBaseSafe(identityRoot){
 await privateDirectory(identityRoot);
 const installation=path.join(identityRoot,'scoped-files');
 let original;try{original=await fs.lstat(installation);}catch(error){if(error.code==='ENOENT')return;throw error;}
 await privateDirectory(installation);
 const requireNoJournal=async()=>{try{await fs.lstat(path.join(installation,'file-transactions'));fail('Recovery journal exists; BASE replacement refused');}
  catch(error){if(error.code!=='ENOENT')throw error;}};
 await requireNoJournal();
 const read=async(name,max)=>{
  const file=path.join(installation,name);let handle;
  try{
   handle=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   const before=await handle.stat();
   if(!before.isFile()||before.uid!==process.getuid()||(before.mode&0o077)||before.nlink!==1||before.size>max)fail('Unsafe installation proof');
   const bytes=await readExactBounded(handle,before.size),after=await handle.stat(),visible=await fs.lstat(file);
   if(bytes.length!==before.size||after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||visible.dev!==after.dev||visible.ino!==after.ino||visible.isSymbolicLink())fail('Unsafe installation proof changed');
   return bytes;
  }catch(error){if(error.code==='SECURITY_BLOCKED')throw error;fail('Unsafe installation proof');}
  finally{if(handle)await handle.close();}
 };
 const key=await read('proof-key',32);if(key.length!==32)fail('Unsafe installation proof key');
 let envelope,proof;try{envelope=JSON.parse((await read('install.json',1024*1024)).toString());
  if(typeof envelope.body!=='string'||typeof envelope.hmac!=='string'||!/^[a-f0-9]{64}$/.test(envelope.hmac)||!timingSafeEqual(createHmac('sha256',key).update(envelope.body).digest(),Buffer.from(envelope.hmac,'hex')))fail('Unsafe installation proof authentication');
  proof=JSON.parse(envelope.body);
 }catch(error){if(error.code==='SECURITY_BLOCKED')throw error;fail('Unsafe installation proof');}
 if(!proof||proof.format!=='gsa-scoped-files-v2'||!Array.isArray(proof.grants))fail('Unsafe installation proof format');
 if(Object.hasOwn(proof,'recoveryQualification')||Object.hasOwn(proof,'recoveryBuild')||proof.grants.some(grant=>grant&&Object.hasOwn(grant,'recovery')))fail('Recovery installation exists; BASE replacement refused');
 if(proof.hostRelease!==os.release()||proof.arch!==process.arch||proof.build?.hostRelease!==proof.hostRelease||proof.build?.arch!==proof.arch)fail('Unsafe installation proof host');
 requireMacFileEvidence(proof.evidence,proof.build);
 const selected=snapshot(await loadTrustedRegistry(identityRoot));
 if(!selected.length||proof.grants.length!==selected.length)fail('Unsafe installation proof grants');
 const names=new Set(),digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 for(const binding of proof.grants){
  if(!binding||typeof binding.id!=='string'||names.has(binding.id)||typeof binding.root!=='string'||!binding.rootIdentity||
   !Number.isSafeInteger(binding.revision)||binding.revision<1||!['workspace','reference'].includes(binding.role)||
   binding.presign_sha256!==proof.build.release_sha256||binding.code_sha256!==proof.build.code_sha256||
   !binding.artifacts||Object.keys(binding.artifacts).length!==artifacts.length||!artifacts.every(name=>digest(binding.artifacts[name])))fail('Unsafe installation proof grant binding');
  names.add(binding.id);const current=selected.find(grant=>grant.id===binding.id);
  if(!current||current.root!==binding.root||current.role!==binding.role||current.revision!==binding.revision||
   !isDeepStrictEqual(current.rootIdentity,binding.rootIdentity))fail('Unsafe installation proof grant changed');
 }
 await requireNoJournal();await privateDirectory(installation);const visible=await fs.lstat(installation);
 if(visible.isSymbolicLink()||visible.dev!==original.dev||visible.ino!==original.ino)fail('Unsafe installation directory changed');
}
/** Stage is concrete and remains private/unpublished while native evidence is unresolved. */
export async function stageMacScopedFiles(identityRoot){
 const plan=await inspectMacScopedFiles(identityRoot),registry=await loadTrustedRegistry(identityRoot),stage=path.join(identityRoot,'.scoped-files.stage-'+randomUUID());await fs.mkdir(stage,{mode:0o700});
 await assertMacFileInstallationSeparated(registry,stage);
 const release=await buildMacFileRelease(stage),grants=[];await fs.writeFile(path.join(stage,'build.json'),JSON.stringify(release.build),{mode:0o600,flag:'wx'});for(const grant of plan.grants)grants.push(await buildMacScopedBundle(stage,grant,release.binary));
 if(!isDeepStrictEqual(snapshot(await loadTrustedRegistry(identityRoot)),plan.grants))fail('Selected grants changed while staging');
 const key=randomBytes(32),body=JSON.stringify({format:'gsa-scoped-files-v2',hostRelease:os.release(),arch:process.arch,grants,build:release.build,evidence:null});await fs.writeFile(path.join(stage,'proof-key'),key,{mode:0o600,flag:'wx'});await fs.writeFile(path.join(stage,'install.json'),JSON.stringify({body,hmac:createHmac('sha256',key).update(body).digest('hex')}),{mode:0o600,flag:'wx'});
 return {stage,build:release.build,releaseBinary:release.binary,grants,selected:plan.grants};
}
export async function applyMacScopedFiles(identityRoot,evidence){
 // Reject fabricated metadata before building or touching an existing installation.
 if(!evidence||evidence.format!=='gsa-scoped-files-native-evidence-v2')fail('Native fixture evidence required');
 return withStoppedMacConnector(identityRoot,async (assertFence,publish)=>{
  await assertLegacyBaseSafe(identityRoot);
  const staged=await stageMacScopedFiles(identityRoot);requireMacFileEvidence(evidence,staged.build);
  const current=await loadTrustedRegistry(identityRoot);if(!isDeepStrictEqual(snapshot(current),staged.selected))fail('Selected grants changed before publication');await assertMacFileInstallationSeparated(current,staged.stage);
  const installation=path.join(identityRoot,'scoped-files');try{await fs.lstat(installation);await assertMacFileInstallationSeparated(current,installation);}catch(e){if(e.code!=='ENOENT')throw e;}
  const key=await fs.readFile(path.join(staged.stage,'proof-key')),body=JSON.stringify({format:'gsa-scoped-files-v2',hostRelease:os.release(),arch:process.arch,grants:staged.grants,build:staged.build,evidence});await fs.writeFile(path.join(staged.stage,'install.json'),JSON.stringify({body,hmac:createHmac('sha256',key).update(body).digest('hex')}),{mode:0o600});
  if(!isDeepStrictEqual(snapshot(await loadTrustedRegistry(identityRoot)),staged.selected))fail('Selected grants changed at publication');await assertLegacyBaseSafe(identityRoot);assertFence();
  const identity=async p=>{const s=await fs.lstat(p,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink())fail('Unsafe publication directory');return {device:String(s.dev),inode:String(s.ino)};};
  const stageIdentity=await identity(staged.stage);let oldIdentity=null;try{oldIdentity=await identity(installation);}catch(e){if(e.code!=='ENOENT')throw e;}
  assertFence();await publish(path.basename(staged.stage),stageIdentity,oldIdentity);
  return {state:'SCOPED_FILES_INSTALLED_PARTIAL',installation,previous:oldIdentity?staged.stage:null,operations:['create_file','create_directory','copy_file'],recovery:false};
 });
}
async function main(){const args=process.argv.slice(2),mode=args.shift();let identityRoot=identityDirectory(),evidencePath;while(args.length){const flag=args.shift(),value=args.shift();if(!value)fail('Missing installer argument');if(flag==='--identity-root')identityRoot=value;else if(flag==='--evidence')evidencePath=value;else fail('Unknown installer argument');}process.umask(0o077);if(mode==='inspect'||mode==='--dry-run')console.log(JSON.stringify(await inspectMacScopedFiles(identityRoot)));else if(mode==='stage'){const staged=await withStoppedMacConnector(identityRoot,()=>stageMacScopedFiles(identityRoot));console.log(JSON.stringify({state:'SCOPED_FILES_STAGED_UNVERIFIED',...staged,buildMetadata:path.join(staged.stage,'build.json')}));}else if(mode==='apply'){if(!evidencePath)fail('Apply requires exact reviewed native fixture evidence');const s=await fs.lstat(evidencePath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077)||s.size>1024*1024)fail('Unsafe fixture evidence');console.log(JSON.stringify(await applyMacScopedFiles(identityRoot,JSON.parse(await fs.readFile(evidencePath,'utf8')))));}else fail('Usage: install-mac-scoped-files.mjs inspect|--dry-run|stage|apply [--identity-root PATH] [--evidence PATH]');}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
