#!/usr/bin/env node
/** Private fixed-operation Mac file installer. Inspect never enrolls roots.
 * Publication requires a bounded real RELEASE fixture, not a list of check names.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {loadTrustedRegistry} from '../dist/src/local/grants.js';
import {identityDirectory} from '../dist/src/local/identity.js';
import {normalizedStrippedMacFileCode} from '../dist/src/hosts/macos-file-code.js';
import {requireMacFileEvidence,MAC_FILE_SIGNING_PROFILE} from '../dist/src/hosts/macos-file-evidence.js';
export {requireMacFileEvidence};
import {assertMacFileInstallationSeparated} from '../dist/src/hosts/macos-scoped-files.js';
const here=path.dirname(fileURLToPath(import.meta.url)),source=path.resolve(here,'../native/macos-files/broker.swift');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const artifacts=['Contents/MacOS/broker','Contents/Info.plist','Contents/_CodeSignature/CodeResources'];
export const signingProfile=MAC_FILE_SIGNING_PROFILE;
const fail=message=>{throw Object.assign(Error(message),{code:'SECURITY_BLOCKED'});};
async function privateDirectory(directory){const s=await fs.lstat(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700||await fs.realpath(directory)!==directory)fail('Unsafe installation directory');}
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
 const code='import os,sys,stat,fcntl\np=sys.argv[1]\nf=os.open(p,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)\ns=os.fstat(f);n=os.lstat(p)\nif not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o077 or s.st_nlink!=1 or (s.st_dev,s.st_ino)!=(n.st_dev,n.st_ino): sys.exit(78)\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(75)\nprint("LOCKED",flush=True)\nsys.stdin.buffer.read()\n';
 const child=spawn('/usr/bin/python3',['-c',code,path.join(identityRoot,'server-owner.lock')],{shell:false,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:os.homedir()}});
 let ready=false,closed=false,exitCode;const completion=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',value=>{closed=true;exitCode=value;resolve(value);});});
 try{await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Owner fencing timeout'));},5000);child.stdout.on('data',data=>{output+=data;if(output==='LOCKED\n'){ready=true;clearTimeout(timer);resolve();}else if(output.length>32){clearTimeout(timer);reject(Error('Invalid owner fencing response'));}});child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',()=>{clearTimeout(timer);if(!ready)reject(Error('Active connector or unsafe owner storage; stop connector first'));});child.stderr.on('data',()=>{});});const result=await operation(()=>{if(closed)fail('Owner fence was lost before publication');});if(closed)fail('Owner fence was lost during publication');return result;}
 finally{child.stdin.end();await completion;if(ready&&exitCode!==0)fail('Owner fence failed');}
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
 return withStoppedMacConnector(identityRoot,async assertFence=>{
  const staged=await stageMacScopedFiles(identityRoot);requireMacFileEvidence(evidence,staged.build);
  const current=await loadTrustedRegistry(identityRoot);if(!isDeepStrictEqual(snapshot(current),staged.selected))fail('Selected grants changed before publication');await assertMacFileInstallationSeparated(current,staged.stage);
  const installation=path.join(identityRoot,'scoped-files');try{await fs.lstat(installation);await assertMacFileInstallationSeparated(current,installation);}catch(e){if(e.code!=='ENOENT')throw e;}
  const key=await fs.readFile(path.join(staged.stage,'proof-key')),body=JSON.stringify({format:'gsa-scoped-files-v2',hostRelease:os.release(),arch:process.arch,grants:staged.grants,build:staged.build,evidence});await fs.writeFile(path.join(staged.stage,'install.json'),JSON.stringify({body,hmac:createHmac('sha256',key).update(body).digest('hex')}),{mode:0o600});
  if(!isDeepStrictEqual(snapshot(await loadTrustedRegistry(identityRoot)),staged.selected))fail('Selected grants changed at publication');assertFence();
  const previous=path.join(identityRoot,'scoped-files.previous-'+randomUUID());let moved=false;try{await fs.rename(installation,previous);moved=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  try{assertFence();await fs.rename(staged.stage,installation);}catch(e){if(moved)await fs.rename(previous,installation);throw e;}
  const parent=await fs.open(identityRoot,'r');try{await parent.sync();}finally{await parent.close();}
  return {state:'SCOPED_FILES_INSTALLED_PARTIAL',installation,previous:moved?previous:null,operations:['create_file','create_directory','copy_file'],recovery:false};
 });
}
async function main(){const args=process.argv.slice(2),mode=args.shift();let identityRoot=identityDirectory(),evidencePath;while(args.length){const flag=args.shift(),value=args.shift();if(!value)fail('Missing installer argument');if(flag==='--identity-root')identityRoot=value;else if(flag==='--evidence')evidencePath=value;else fail('Unknown installer argument');}process.umask(0o077);if(mode==='inspect'||mode==='--dry-run')console.log(JSON.stringify(await inspectMacScopedFiles(identityRoot)));else if(mode==='stage'){const staged=await withStoppedMacConnector(identityRoot,()=>stageMacScopedFiles(identityRoot));console.log(JSON.stringify({state:'SCOPED_FILES_STAGED_UNVERIFIED',...staged,buildMetadata:path.join(staged.stage,'build.json')}));}else if(mode==='apply'){if(!evidencePath)fail('Apply requires exact reviewed native fixture evidence');const s=await fs.lstat(evidencePath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077)||s.size>1024*1024)fail('Unsafe fixture evidence');console.log(JSON.stringify(await applyMacScopedFiles(identityRoot,JSON.parse(await fs.readFile(evidencePath,'utf8')))));}else fail('Usage: install-mac-scoped-files.mjs inspect|--dry-run|stage|apply [--identity-root PATH] [--evidence PATH]');}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
