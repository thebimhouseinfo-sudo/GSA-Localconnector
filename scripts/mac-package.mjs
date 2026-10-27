#!/usr/bin/env node
/** Private, versioned macOS distribution. No workspace, dependencies, or secrets are packaged. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');
export function directorySourceFiles(){return Object.freeze(['native/macos-files/tree-broker.swift']);}
export const label='com.gsa-localconnector.mac';
const home=os.homedir(),base=path.join(home,'Library/Application Support/GSA-Localconnector');
const plist=path.join(home,'Library/LaunchAgents',label+'.plist');
const target=`gui/${process.getuid?.()}/${label}`;
async function privateDir(p){await fs.mkdir(p,{recursive:true,mode:0o700});await verifiedDirectory(p);}
async function verifiedDirectory(p){const s=await fs.lstat(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700||await fs.realpath(p)!==p)throw Error('Unsafe private directory: '+p);return s;}
async function regular(p){const s=await fs.lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077)||await fs.realpath(p)!==p)throw Error('Unsafe private file: '+p);return s;}
async function run(command,args,{allowFailure=false}={}){return new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:home}});let out='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{if(out.length<65536)out+=b;});child.on('error',reject);child.on('close',code=>code===0||allowFailure?resolve({code,output:out}):reject(Error(command+' failed ('+code+'): '+out)));});}
async function files(dir,prefix='',checkPrivate=false){if(checkPrivate)await verifiedDirectory(dir);const found=[];for(const name of await fs.readdir(dir)){const rel=path.join(prefix,name),full=path.join(dir,name),s=await fs.lstat(full);if(s.isSymbolicLink())throw Error('Symlink forbidden: '+full);if(s.isDirectory())found.push(...await files(full,rel,checkPrivate));else if(s.isFile())found.push(rel);else throw Error('Special file forbidden');}return found.sort();}
export async function verify(root){await verifiedDirectory(root);await regular(path.join(root,'manifest.json'));const m=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));if(m.format!=='gsa-mac-runtime-v1'||!m.files||!m.files['dist/src/mcp/http-cli.js']||!m.files['scripts/macos-owner-launcher.py']||!m.files['bin/node'])throw Error('Invalid runtime manifest');if(Object.hasOwn(m.files,'dist/src/hosts/macos-directory-installation.js')&&directorySourceFiles().some(name=>!Object.hasOwn(m.files,name)))throw Error('Missing directory tree source in runtime manifest');const actual=await files(root,'',true);if(JSON.stringify(actual)!==JSON.stringify([...Object.keys(m.files),'manifest.json'].sort()))throw Error('Unexpected runtime files');for(const [name,digest] of Object.entries(m.files)){if(path.isAbsolute(name)||name.split(path.sep).includes('..')||!/^[a-f0-9]{64}$/.test(digest))throw Error('Invalid manifest path or digest');await regular(path.join(root,name));if(sha(await fs.readFile(path.join(root,name)))!==digest)throw Error('Runtime integrity failed: '+name);}return m;}
const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function launchPlist(root,ownerHome=home){return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(path.join(root,'bin/node'))}</string><string>${xml(path.join(root,'scripts/mac-package.mjs'))}</string><string>serve</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>10</integer><key>ProcessType</key><string>Background</string><key>Umask</key><integer>63</integer><key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string><key>HOME</key><string>${xml(ownerHome)}</string></dict></dict></plist>\n`;}
async function current(){await privateDir(base);await regular(path.join(base,'runtime-current.json'));const value=JSON.parse(await fs.readFile(path.join(base,'runtime-current.json'),'utf8'));if(!/^[a-f0-9-]{36}$/.test(value.id))throw Error('Invalid runtime pointer');const root=path.join(base,'runtimes',value.id);await verify(root);return root;}
async function publish(file,data){const temp=file+'.'+randomUUID();await fs.writeFile(temp,data,{mode:0o600,flag:'wx'});await fs.rename(temp,file);}
async function stopped(){const result=await run('/bin/launchctl',['print',target],{allowFailure:true});return result.code!==0;}
async function idle(){// Kernel ownership persists across server crashes while trusted workers remain.
const result=await run('/usr/bin/python3',['-c',"import os,fcntl,sys; p=sys.argv[1]; f=os.open(p,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)",path.join(base,'server-owner.lock')],{allowFailure:true});if(result.code!==0)throw Error('Active server or trusted worker; stop and wait before modifying installation');}
async function install(upgrade=false){await privateDir(base);await privateDir(path.join(base,'runtimes'));if(!await stopped())throw Error('Stop LaunchAgent before install/upgrade');await idle();let old;try{old=await current();if(!upgrade)throw Error('Runtime exists; use upgrade or repair');}catch(e){if(e.code!=='ENOENT')throw e;}const id=randomUUID(),root=path.join(base,'runtimes',id);await privateDir(root);try{const names=(await files(path.join(source,'dist/src'))).map(n=>path.join('dist/src',n)).filter(n=>n.endsWith('.js'));if(!names.includes('dist/src/mcp/http-cli.js'))throw Error('Run npm run build first');names.push('scripts/macos-owner-launcher.py','scripts/mac-package.mjs',...directorySourceFiles());const entries={};for(const name of names){await privateDir(path.dirname(path.join(root,name)));await fs.copyFile(path.join(source,name),path.join(root,name));await fs.chmod(path.join(root,name),0o600);entries[name]=sha(await fs.readFile(path.join(root,name)));}await privateDir(path.join(root,'bin'));await fs.copyFile(process.execPath,path.join(root,'bin/node'));await fs.chmod(path.join(root,'bin/node'),0o500);entries['bin/node']=sha(await fs.readFile(path.join(root,'bin/node')));await fs.writeFile(path.join(root,'package.json'),JSON.stringify({type:'module',private:true}),{mode:0o600,flag:'wx'});entries['package.json']=sha(await fs.readFile(path.join(root,'package.json')));await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({format:'gsa-mac-runtime-v1',id,createdAt:new Date().toISOString(),files:entries},null,2),{mode:0o600,flag:'wx'});await verify(root);await publish(path.join(base,'runtime-current.json'),JSON.stringify({id,previous:old?path.basename(old):null}));console.log(JSON.stringify({state:'MAC_RUNTIME_INSTALLED',root,previous:old??null}));}catch(e){await fs.rm(root,{recursive:true,force:true});throw e;}}
async function load(){const root=await current();await privateDir(path.join(base,'service-logs'));await fs.mkdir(path.dirname(plist),{recursive:true});try{await fs.lstat(plist);await regular(plist);const text=await fs.readFile(plist,'utf8');if(text!==launchPlist(root))throw Error('Refusing unverified shared LaunchAgent');}catch(e){if(e.code!=='ENOENT')throw e;}if(!await stopped())throw Error('Shared launch label already registered');await publish(plist,launchPlist(root));await run('/usr/bin/plutil',['-lint',plist]);await run('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,plist]);console.log(JSON.stringify({state:'MAC_SERVICE_LOADED',label}));}
async function serve(){await verify(source);await privateDir(base);const logdir=path.join(base,'service-logs');await privateDir(logdir);const log=path.join(logdir,'service.log');try{await regular(log);if((await fs.stat(log)).size>1024*1024)await fs.rename(log,log+'.previous');}catch(e){if(e.code!=='ENOENT')throw e;}let bytes=0,queue=Promise.resolve();const child=spawn(path.join(source,'bin/node'),[path.join(source,'dist/src/mcp/http-cli.js')],{stdio:['ignore','pipe','pipe'],env:{HOME:home,PATH:'/usr/bin:/bin:/usr/sbin:/sbin'}});for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{if(bytes>=1024*1024)return;const part=b.subarray(0,1024*1024-bytes);bytes+=part.length;queue=queue.then(()=>fs.appendFile(log,part,{mode:0o600}));});for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.on('close',async code=>{await queue;process.exitCode=code??1;});}

// launchctl list is already used by desktop lifecycle code. Fail closed on
// command errors or an unrecognized listing instead of treating failure as absence.
async function assertSharedLabelAbsent(runCommand){
 const result=await runCommand('/bin/launchctl',['list'],{allowFailure:true});
 const rows=typeof result.output==='string'?result.output.trim().split(/\r?\n/).map(row=>row.trim().split(/\s+/)):[];
 if(result.code!==0||rows.shift()?.join(' ')!=='PID Status Label'||rows.some(row=>row.length!==3||! /^(?:-|[1-9]\d*)$/.test(row[0])||! /^-?\d+$/.test(row[1])))throw Error('Shared launch label ownership ambiguous');
 if(rows.some(row=>row[2]===label))throw Error('Shared launch label is registered; ownership ambiguous');
}

// A shared label alone cannot prove that its live job belongs to legacy code.
export async function stopLegacy({runCommand=run}={}){
 await assertSharedLabelAbsent(runCommand);
}

// Legacy and desktop releases share a runtime collection and launch label. Never
// infer ownership from that label alone. An occupied label must be retired by its
// owning lifecycle before this uninstaller can remove an inactive legacy release.
export async function uninstallLegacy({home:ownerHome=home,runCommand=run}={}){
 const ownedBase=path.join(ownerHome,'Library/Application Support/GSA-Localconnector');
 const pointer=path.join(ownedBase,'runtime-current.json');
 const ownedPlist=path.join(ownerHome,'Library/LaunchAgents',label+'.plist');
 const stamp=info=>[info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs,info.mode,info.uid,info.nlink].join(':');
 await verifiedDirectory(ownedBase);await verifiedDirectory(path.join(ownedBase,'runtimes'));
 const pointerInfo=await regular(pointer);if(pointerInfo.size>16384)throw Error('Invalid legacy runtime pointer');
 const pointerBytes=await fs.readFile(pointer),value=JSON.parse(pointerBytes.toString('utf8'));
 if(!/^[a-f0-9-]{36}$/.test(value.id)||Object.keys(value).some(key=>!['id','previous'].includes(key)))throw Error('Invalid legacy runtime pointer');
 const root=path.join(ownedBase,'runtimes',value.id),manifest=await verify(root),rootInfo=await verifiedDirectory(root);
 if(manifest.id!==value.id||!Object.hasOwn(manifest.files,'scripts/mac-package.mjs'))throw Error('Legacy runtime ownership unverified');
 let plistInfo;
 try{
  plistInfo=await regular(ownedPlist);
  if(plistInfo.size>16384||await fs.readFile(ownedPlist,'utf8')!==launchPlist(root,ownerHome))throw Error('Shared LaunchAgent ownership unverified');
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const assertInactive=async()=>{
  await assertSharedLabelAbsent(runCommand);
  const script="import fcntl,os,stat,sys\ntry:\n f=os.open(sys.argv[1],os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK)\n s=os.fstat(f)\n if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_nlink!=1 or stat.S_IMODE(s.st_mode)!=0o600:sys.exit(75)\n fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept FileNotFoundError:pass\nexcept Exception:sys.exit(75)\n";
  if((await runCommand('/usr/bin/python3',['-I','-c',script,path.join(ownedBase,'server-owner.lock')],{allowFailure:true})).code!==0)throw Error('Active or unverified server owner; refusing legacy uninstall');
 };
 // All ownership checks precede even a possible deletion. Preserve every sibling
 // release, desktop pointer/configuration, owner lock and unrelated registration.
 await assertInactive();
 if(stamp(await regular(pointer))!==stamp(pointerInfo)||!pointerBytes.equals(await fs.readFile(pointer)))throw Error('Legacy pointer changed');
 await verify(root);
 if(plistInfo){
  if(stamp(await regular(ownedPlist))!==stamp(plistInfo)||await fs.readFile(ownedPlist,'utf8')!==launchPlist(root,ownerHome))throw Error('Shared LaunchAgent changed');
 }else if(await fs.lstat(ownedPlist).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw Error('Shared LaunchAgent appeared');
 await assertInactive();
 await verifiedDirectory(ownedBase);await verifiedDirectory(path.join(ownedBase,'runtimes'));
 if(stamp(await verifiedDirectory(root))!==stamp(rootInfo)||stamp(await regular(pointer))!==stamp(pointerInfo)||!pointerBytes.equals(await fs.readFile(pointer)))throw Error('Legacy runtime identity changed');
 if(plistInfo&&stamp(await regular(ownedPlist))!==stamp(plistInfo))throw Error('Shared LaunchAgent changed');
 if(plistInfo)await fs.unlink(ownedPlist);
 await fs.unlink(pointer);
 await fs.rm(root,{recursive:true});
 return {state:'MAC_RUNTIME_UNINSTALLED',preserved:'all other releases, desktop, native-vm, images, workspace grants, identity, logs and journals'};
}

async function main(){if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Apple Silicon macOS only');process.umask(0o077);const command=process.argv[2];if(command==='install'||command==='upgrade'||command==='repair')await install(command!=='install');else if(command==='start')await load();else if(command==='serve')await serve();else if(command==='stop'){await stopLegacy();console.log(JSON.stringify({state:'MAC_SERVICE_STOP_REQUESTED',label}));}else if(command==='doctor'){const root=await current(),service=await run('/bin/launchctl',['print',target],{allowFailure:true});console.log(JSON.stringify({state:'MAC_RUNTIME_VERIFIED',root,label,loaded:service.code===0,launchAgentExists:await fs.access(plist).then(()=>true,()=>false),nativeInstallationExists:await fs.access(path.join(base,'native-vm/install.json')).then(()=>true,()=>false)}));}else if(command==='uninstall'){console.log(JSON.stringify(await uninstallLegacy()));}else throw Error('Usage: node scripts/mac-package.mjs install|upgrade|repair|start|stop|doctor|uninstall');}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
