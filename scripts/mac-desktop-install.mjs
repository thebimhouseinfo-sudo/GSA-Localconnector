export function directorySourceFiles(){return Object.freeze(['native/macos-files/tree-broker.swift']);}
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createMacPrivateFile} from './mac-desktop-private-file.mjs';
import {createReleaseManifest,verifyReleaseManifest} from './desktop-release.mjs';
import {inspectPlatform} from './desktop-platform-check.mjs';
import {renderLaunchAgentPlist,ensureLogin} from './mac-desktop-adapter.mjs';
import {buildDesktopIcons} from './build-desktop-icons.mjs';
import {describeUiIntent,selectCompatibleUi,copyVerifiedUi,recordBuiltUi,verifyRecordedUi} from './mac-desktop-ui.mjs';
import {parseLoginJob,retireInactiveLoginJob} from './mac-desktop-login.mjs';

// Both successful readiness states belong to the stage being activated.
export function isStageReady(status,installationId){return status?.installationId===installationId&&['RUNNING','SETUP_REQUIRED'].includes(status.state);}
const execute=promisify(execFile),label='com.gsa-localconnector.mac';
const fail=code=>Object.assign(new Error(code),{code});
const missing=error=>error?.code==='ENOENT'||error?.code==='FILE_MISSING';
async function checkedRelease(options){const files=options.manifest?.files;if(files&&Object.hasOwn(files,'dist/src/hosts/macos-directory-installation.js')&&directorySourceFiles().some(name=>!Object.hasOwn(files,name)))throw fail('RELEASE_INVALID');return verifyReleaseManifest(options);}
async function exists(file){try{await fs.lstat(file);return true;}catch(e){if(missing(e))return false;throw e;}}
async function directory(file,mode=0o700){
 await fs.mkdir(file,{recursive:true,mode});const s=await fs.lstat(file);
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||await fs.realpath(file)!==file||(mode===0o700&&(s.mode&0o777)!==0o700))throw fail('INSTALL_DIRECTORY_UNSAFE');
}
async function files(root,prefix=''){
 const output=[];for(const name of await fs.readdir(path.join(root,prefix))){
  const rel=prefix?`${prefix}/${name}`:name;const s=await fs.lstat(path.join(root,rel));
  if(s.isSymbolicLink())throw fail('RELEASE_INVALID');
  if(s.isDirectory())output.push(...await files(root,rel));else if(s.isFile()&&s.nlink===1)output.push(rel);else throw fail('RELEASE_INVALID');
 }return output;
}
async function copy(source,destination,mode=0o400){await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.copyFile(source,destination,fs.constants.COPYFILE_EXCL);await fs.chmod(destination,mode);}

export async function createMacInstaller({home=os.homedir(),sourceRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url))),clientPath,envPath:requestedEnvPath,registerLogin=true}={}){
 if(!path.isAbsolute(home)||!path.isAbsolute(sourceRoot)||await fs.realpath(home)!==home)throw fail('INSTALL_ARGUMENTS_INVALID');
 const installRoot=path.join(home,'Library/Application Support/GSA-Localconnector');
 const desktop=path.join(installRoot,'desktop'),pointer=path.join(desktop,'runtime-current.json'),configPath=path.join(desktop,'config.json');
 const appPath=path.join(home,'Applications/GSA Local Connector.app');
 const plistPath=path.join(home,'Library/LaunchAgents',`${label}.plist`);
 const envPath=requestedEnvPath??path.join(desktop,'.env');
 const client=clientPath??path.join(sourceRoot,'bin/tunnel-client');
 const environment={HOME:home,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',...(process.env.TMPDIR?{TMPDIR:process.env.TMPDIR}:{})};
 const privateFile=createMacPrivateFile();let current={state:'EMPTY'},stage,installGuard;
 async function readJSON(file){return JSON.parse((await privateFile.readVerified(file)).bytes.toString('utf8'));}
 async function write(file,value){let identity=null;try{identity=(await privateFile.readVerified(file)).identity;}catch(e){if(!missing(e))throw e;}return privateFile.replaceVerified(file,Buffer.from(JSON.stringify(value,null,2)),identity);}
 async function command(cmd,args){return execute(cmd,args,{env:environment,maxBuffer:1024*1024});}
 async function loginJob(){
  if(!registerLogin)return 'ABSENT';
  try{return parseLoginJob((await command('/bin/launchctl',['list'])).stdout,label);}catch{return 'UNKNOWN';}
 }
 async function loaded(){return ['ACTIVE','UNKNOWN'].includes(await loginJob());}
 async function retireInactive(){
  return retireInactiveLoginJob({query:loginJob,verifyOwned:async()=>{
   if(current.state!=='VALID'||!await exists(plistPath))throw fail('AGENT_COLLISION');
   await verifyOwnedAgent();
  },ownerBusy,bootout:()=>command('/bin/launchctl',['bootout',`gui/${process.getuid()}/${label}`])});
 }
 async function verifyOwnedAgent(){
  if(!await exists(plistPath))return;
  const info=await fs.lstat(plistPath);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.uid!==process.getuid()||(info.mode&0o022)||info.size>16384)throw fail('AGENT_COLLISION');
  const observedLabel=await command('/usr/bin/plutil',['-extract','Label','raw','-o','-',plistPath]);
  const observedProgram=await command('/usr/bin/plutil',['-extract','ProgramArguments.0','raw','-o','-',plistPath]);
  if(observedLabel.stdout.trim()!==label||observedProgram.stdout.trim()!==path.join(appPath,'Contents/MacOS/GSA Local Connector'))throw fail('AGENT_COLLISION');
 }
 async function ownerBusy(){
  const script=`import fcntl,os,stat,sys\nfor p in sys.argv[1:]:\n try:\n  f=os.open(p,os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK)\n  s=os.fstat(f)\n  if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_nlink!=1:sys.exit(75)\n  fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\n  os.close(f)\n except FileNotFoundError:pass\n except Exception:sys.exit(75)\n`;
  try{await command('/usr/bin/python3',['-I','-c',script,path.join(installRoot,'server-owner.lock'),path.join(desktop,'desktop-owner.lock')]);return false;}catch{return true;}
 }
 async function acquireInstall(){
  if(installGuard)return true;
  await directory(installRoot);await directory(desktop);
  const script=`import fcntl,os,stat,sys\ntry:\n f=os.open(sys.argv[1],os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)\n s=os.fstat(f)\n if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_nlink!=1 or stat.S_IMODE(s.st_mode)!=0o600:sys.exit(75)\n fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\n print('LOCKED',flush=True)\n sys.stdin.buffer.read()\nexcept Exception:sys.exit(75)\n`;
  const child=spawn('/usr/bin/python3',['-I','-c',script,path.join(desktop,'install.lock')],{env:environment,stdio:['pipe','pipe','ignore']});
  const acquired=await new Promise(resolve=>{
   let done=false,buffer='';const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
   const timer=setTimeout(()=>finish(false),3000);
   child.on('error',()=>finish(false));child.on('close',()=>finish(false));child.stdin.on('error',()=>finish(false));
   child.stdout.on('data',bytes=>{buffer+=bytes;if(buffer.includes('LOCKED\n'))finish(true);else if(buffer.length>64)finish(false);});
  });
  if(acquired){installGuard=child;return true;}child.stdin.end();return false;
 }
 async function inspectCurrent({action='install'}={}){
  if(action!=='doctor'&&!await acquireInstall())return {state:'UNKNOWN_ACTIVE'};
  if(await loaded()||await ownerBusy())return {state:'UNKNOWN_ACTIVE'};
  let value;
  try{value=await readJSON(pointer);}catch(e){
   if(!missing(e))return {state:'STALE_POINTER'};
   if(await exists(appPath)||registerLogin&&await exists(plistPath))return {state:'UNKNOWN_ACTIVE'};
   current={state:'EMPTY'};return current;
  }
  try{
   if(!/^[a-f0-9-]{36}$/.test(value.id)||value.runtimeRoot!==path.join(installRoot,'runtimes',value.id)||value.appPath!==appPath||typeof value.envPath!=='string'||!path.isAbsolute(value.envPath))throw fail('CURRENT_INVALID');
   const manifest=JSON.parse(await fs.readFile(path.join(value.runtimeRoot,'manifest.json'),'utf8'));await checkedRelease({releaseRoot:value.runtimeRoot,manifest});
   if(await exists(appPath)){
    const link=await fs.lstat(appPath);if(!link.isSymbolicLink()||link.uid!==process.getuid()||await fs.readlink(appPath)!==path.join(value.runtimeRoot,'GSA Local Connector.app'))throw fail('CURRENT_INVALID');
   }else if(!['update','repair'].includes(action))throw fail('CURRENT_INVALID');
   const metadata=await readJSON(configPath);if(metadata.runtimeRoot!==value.runtimeRoot||metadata.envPath!==value.envPath)throw fail('CURRENT_INVALID');
   if(registerLogin)await verifyOwnedAgent();
   current={...value,state:'VALID',metadata};return current;
  }catch{return {state:'STALE_POINTER'};}
 }
 async function inspectHost(){
  const tools={node:process.versions.node},observations=[['swiftc','/usr/bin/swiftc',['--version']],['python3','/usr/bin/python3',['--version']]];
  for(const [name,exe,args]of observations)try{const r=await command(exe,args);tools[name]=`${r.stdout} ${r.stderr}`.match(/\b\d+\.\d+(?:\.\d+)?\b/)?.[0]??false;}catch{tools[name]=false;}
  tools.iconutil=await exists('/usr/bin/iconutil');let help='';try{const observed=await command(client,['run','--help']);help=`${observed.stdout}\n${observed.stderr}`;tools.tunnelClient=true;}catch{tools.tunnelClient=false;}
  return {...inspectPlatform({platform:process.platform,arch:process.arch,tools,clientHelp:help,nativeEvidence:null}),tools};
 }
 async function replaceAlias(target){
  await directory(path.dirname(appPath),0o755);
  if(await exists(appPath)){
   const s=await fs.lstat(appPath);
   if(!s.isSymbolicLink()||s.uid!==process.getuid()||current.state!=='VALID'||await fs.readlink(appPath)!==path.join(current.runtimeRoot,'GSA Local Connector.app'))throw fail('APP_COLLISION');
  }
  const temp=`${appPath}.${randomUUID()}`;await fs.symlink(target,temp);
  try{await fs.rename(temp,appPath);}catch(e){await fs.unlink(temp);throw e;}
 }
 const adapter={
  inspectHost,inspectCurrent,
  async releaseInstall(){
   if(!installGuard)return;const guard=installGuard;installGuard=null;
   if(guard.exitCode!==null)return;
   await new Promise(resolve=>{guard.once('close',resolve);guard.stdin.end();});
  },
  async resolveEnvPath(selected){if(!path.isAbsolute(selected))throw fail('CONFIG_PATH_INVALID');return {path:selected};},
  async buildStage(context){
   await directory(installRoot);await directory(desktop);await directory(path.join(installRoot,'runtimes'));
   const id=randomUUID(),stageRoot=path.join(installRoot,'runtimes',`.staging-${id}`),runtimeRoot=path.join(installRoot,'runtimes',id);
   await directory(stageRoot);stage={id,stageRoot,runtimeRoot,version:'0.1.0',envPath:context.envPath,previous:current,appPath};
   try{
    console.log('Building and verifying GSA Local Connector…');
    await command(process.execPath,[path.join(sourceRoot,'node_modules/typescript/bin/tsc'),'-p',path.join(sourceRoot,'tsconfig.json')]);
    for(const rel of await files(path.join(sourceRoot,'dist/src')))await copy(path.join(sourceRoot,'dist/src',rel),path.join(stageRoot,'dist/src',rel));
    for(const name of ['desktop-config.mjs','desktop-health.mjs','mac-desktop-private-file.mjs','desktop-supervisor.mjs','mac-desktop-adapter.mjs','desktop-release.mjs','macos-owner-launcher.py'])await copy(path.join(sourceRoot,'scripts',name),path.join(stageRoot,'scripts',name));
    for(const name of directorySourceFiles())await copy(path.join(sourceRoot,name),path.join(stageRoot,name));
    await copy(process.execPath,path.join(stageRoot,'bin/node'),0o500);await copy(client,path.join(stageRoot,'bin/tunnel-client'),0o500);
    await fs.writeFile(path.join(stageRoot,'package.json'),'{"type":"module","private":true}',{mode:0o400,flag:'wx'});
    const intent=await describeUiIntent({sourceRoot,configPath});
    const selection=await selectCompatibleUi({installRoot,currentRelease:current,intent});
    const bundle=path.join(stageRoot,'GSA Local Connector.app');let ui;
    if(selection.decision==='reuse'){
     ui=await copyVerifiedUi({selection,destinationBundle:bundle,command});
    }else{
     if(selection.reason==='UI_INTENT_CHANGED')console.log('The app interface changed; macOS may ask for folder access again.');
     const executable=path.join(bundle,'Contents/MacOS/GSA Local Connector'),resources=path.join(bundle,'Contents/Resources');
     await directory(resources);await directory(path.dirname(executable));
     await command('/usr/bin/swiftc',['-target','arm64-apple-macos13.0',path.join(sourceRoot,'native/macos-desktop/App.swift'),'-o',executable]);await fs.chmod(executable,0o500);
     await copy(path.join(sourceRoot,'native/macos-desktop/Info.plist'),path.join(bundle,'Contents/Info.plist'));
     await fs.writeFile(path.join(resources,'desktop-config-path.txt'),configPath,{mode:0o400,flag:'wx'});
     const iconsRoot=path.join(stageRoot,'.icons'),icons=await buildDesktopIcons({outputRoot:iconsRoot});
     await copy(icons.icns,path.join(resources,'GSAConnector.icns'));await copy(path.join(sourceRoot,'assets/desktop/LICENSE'),path.join(resources,'Icon-LICENSE.txt'));
     await fs.rm(iconsRoot,{recursive:true,force:true});
     await command('/usr/bin/codesign',['--force','--sign','-','--timestamp=none',bundle]);
     ui=await recordBuiltUi({bundle,intent,command,buildMetadata:{compilerVersion:context.host?.tools?.swiftc??null}});
    }
    if((await describeUiIntent({sourceRoot,configPath})).fingerprint!==intent.fingerprint)throw fail('UI_INTENT_CHANGED_DURING_BUILD');
    // This record is outside the immutable signed app and sealed by the normal
    // complete runtime manifest. Adoption origin is never rewritten as a build.
    await fs.writeFile(path.join(stageRoot,'ui-provenance.json'),JSON.stringify(ui,null,2),{mode:0o400,flag:'wx'});
    stage.uiIdentity={origin:ui.origin,cdhash:ui.artifact.identity.cdhash,reused:selection.decision==='reuse'};
    const manifest=await createReleaseManifest({sourceRoot:stageRoot,platform:'darwin',arch:'arm64',version:stage.version,allowedFiles:await files(stageRoot)});
    await fs.writeFile(path.join(stageRoot,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o400,flag:'wx'});
    return stage;
   }catch(e){await fs.rm(stageRoot,{recursive:true,force:true});throw e;}
  },
  async verifyStage(value){const manifest=JSON.parse(await fs.readFile(path.join(value.stageRoot,'manifest.json'),'utf8'));await checkedRelease({releaseRoot:value.stageRoot,manifest});await verifyRecordedUi({releaseRoot:value.stageRoot,command});return true;},
  async activateStage(value){
   if(await loaded()||await ownerBusy())throw fail('OWNER_ACTIVE');
   await retireInactive();
   await fs.rename(value.stageRoot,value.runtimeRoot);value.moved=true;
   await replaceAlias(path.join(value.runtimeRoot,'GSA Local Connector.app'));value.alias=true;
   await write(configPath,{runtimeRoot:value.runtimeRoot,envPath:value.envPath,installationId:value.id});
   await write(path.join(desktop,'status.json'),{installationId:value.id,state:'STARTING',connection:'UNKNOWN'});
   await write(pointer,{id:value.id,runtimeRoot:value.runtimeRoot,version:value.version,envPath:value.envPath,appPath,loginPreference:current.loginPreference??true});
  },
  async ensureLogin(options){
   stage.loginPreference=ensureLogin(options);await write(pointer,{...(await readJSON(pointer)),loginPreference:stage.loginPreference});
   if(!registerLogin)return;
   if(!stage.loginPreference)return;
   await directory(path.dirname(plistPath),0o755);
   if(await exists(plistPath)){
    if(current.state!=='VALID')throw fail('AGENT_COLLISION');
    await verifyOwnedAgent();
    stage.previousPlist=await fs.readFile(plistPath);
   }
   const temp=`${plistPath}.${randomUUID()}`;await fs.writeFile(temp,renderLaunchAgentPlist({label,appPath,configPath}),{mode:0o600,flag:'wx'});
   await command('/usr/bin/plutil',['-lint',temp]);await fs.rename(temp,plistPath);stage.plistWritten=true;
  },
  async startApp(){
   if(registerLogin&&stage.loginPreference){await command('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,plistPath]);stage.bootstrapped=true;}
   else{
    const child=spawn(path.join(appPath,'Contents/MacOS/GSA Local Connector'),[],{env:environment,detached:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});stage.appPid=child.pid;child.unref();
    await write(pointer,{...(await readJSON(pointer)),appPid:child.pid});
   }
   const until=Date.now()+15000;while(Date.now()<until){
    try{const s=await readJSON(path.join(desktop,'status.json'));if(isStageReady(s,stage.id))return true;if(s.state==='FAILED')return false;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
   }return false;
  },
  async rollbackStage(value){
   if(!value.moved&&!value.alias&&!value.plistWritten)return;
   if(await ownerBusy())throw fail('ROLLBACK_NEEDS_STOP');
   if(value.bootstrapped)await command('/bin/launchctl',['bootout',`gui/${process.getuid()}/${label}`]);
   if(value.appPid)throw fail('ROLLBACK_NEEDS_STOP');
   if(value.alias){
    if(!await exists(appPath)||await fs.readlink(appPath)!==path.join(value.runtimeRoot,'GSA Local Connector.app'))throw fail('APP_COLLISION');
    if(value.previous.state==='VALID'){const temp=`${appPath}.${randomUUID()}`;await fs.symlink(path.join(value.previous.runtimeRoot,'GSA Local Connector.app'),temp);await fs.rename(temp,appPath);}
    else await fs.unlink(appPath);
   }
   for(const file of [configPath,pointer]){
    let observed;try{observed=await readJSON(file);}catch(e){if(missing(e))continue;throw e;}
    if(observed.runtimeRoot!==value.runtimeRoot)continue;
    if(value.previous.state==='VALID'){
     const {state,metadata,...saved}=value.previous;await write(file,file===configPath?metadata:saved);
    }else await fs.unlink(file);
   }
   if(value.plistWritten){if(value.previousPlist)await fs.writeFile(plistPath,value.previousPlist,{mode:0o600});else await fs.unlink(plistPath);}
  },
  async discardStage(value){if(!value.moved)await fs.rm(value.stageRoot,{recursive:true,force:true});},
  async stopOwned(){if(await loaded()||await ownerBusy())return {stopped:false};await retireInactive();return {stopped:true};},
  async removeManaged(value){
   if(value.state!=='VALID')throw fail('CURRENT_INVALID');
   if(registerLogin)await verifyOwnedAgent();
   const alias=await fs.lstat(appPath);
   if(!alias.isSymbolicLink()||alias.uid!==process.getuid()||await fs.readlink(appPath)!==path.join(value.runtimeRoot,'GSA Local Connector.app')||!value.runtimeRoot.startsWith(path.join(installRoot,'runtimes')+path.sep))throw fail('APP_COLLISION');
   await fs.unlink(appPath);if(registerLogin&&await exists(plistPath))await fs.unlink(plistPath);
   await fs.unlink(pointer);await fs.unlink(configPath);
   await fs.rm(value.runtimeRoot,{recursive:true,force:true});
  }
 };
 return {platformAdapter:adapter,sourceRoot,installRoot,envPath};
}
