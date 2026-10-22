import path from 'node:path';
import {fileURLToPath} from 'node:url';
export {createReleaseManifest,verifyReleaseManifest} from './desktop-release.mjs';

const actions=new Set(['install','update','repair','doctor','uninstall']);
export async function runInstall({action='install',platformAdapter:adapter,sourceRoot,installRoot,envPath}){
 let stage,activated=false;const result=(state,reason)=>({state,...(reason?{reason}:{}),installRoot});
 try{
  if(!actions.has(action)||![sourceRoot,installRoot,envPath].every(x=>typeof x==='string'&&path.isAbsolute(x)))return result('FAILED','ARGUMENTS_INVALID');
  const host=await adapter.inspectHost();
  if(host?.ready===false||!['darwin','win32'].includes(host?.platform)||Object.values(host.tools??{}).some(x=>x===false))return result('FAILED','HOST_NOT_READY');
  const current=await adapter.inspectCurrent({action});
  if(!['EMPTY','VALID'].includes(current?.state))return result('FAILED','CURRENT_UNSAFE');
  if(action==='doctor')return result('VERIFIED');
  if(action==='uninstall'){
   if(current.state==='EMPTY')return result('UNINSTALLED');
   const stopped=await adapter.stopOwned(current);if(stopped?.stopped!==true)return result('FAILED','OWNED_WORK_ACTIVE');
   await adapter.removeManaged(current);return result('UNINSTALLED');
  }
  const saved=await adapter.resolveEnvPath(current.envPath??envPath,current);
  stage=await adapter.buildStage({sourceRoot,installRoot,envPath:saved.path,current,host});
  if(await adapter.verifyStage(stage)!==true)return result('FAILED','STAGE_INVALID');
  activated=true;await adapter.activateStage(stage);
  await adapter.ensureLogin({firstInstall:current.state==='EMPTY',existingPreference:current.loginPreference??null});
  if(await adapter.startApp(stage)!==true){await adapter.rollbackStage(stage);activated=false;return result('FAILED','APP_START_FAILED');}
  return {...result('INSTALLED'),version:stage.version,envPath:saved.path};
 }catch{
  if(activated)try{await adapter.rollbackStage(stage);}catch{return result('FAILED','ROLLBACK_FAILED');}
  return result('FAILED','INSTALL_FAILED');
 }finally{
  if(stage)await adapter.discardStage?.(stage).catch(()=>{});
  await adapter.releaseInstall?.().catch(()=>{});
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),action=args[0]&&!args[0].startsWith('--')?args.shift():'install';
 let envPath;
 if(args[0]==='--env-path'&&args.length===2&&path.isAbsolute(args[1])){envPath=args[1];args.length=0;}
 if(args.length||(!actions.has(action)&&action!=='setup')){console.error('Usage: bash install.sh [install|setup|update|repair|doctor|uninstall] [--env-path /absolute/path/.env]');process.exitCode=1;}
 else if(process.platform!=='darwin'||process.arch!=='arm64'){console.error('This delivery supports Apple Silicon macOS. Windows native delivery is pending its host tests.');process.exitCode=1;}
 else{
  try{
   if(['setup','install','update','repair'].includes(action)){
    const {resolveTerminalTarget,setupTerminal}=await import('./desktop-terminal-setup.mjs');
    envPath=await resolveTerminalTarget({requestedEnvPath:envPath});
    const setup=await setupTerminal({envPath,replace:action==='setup'});
    if(action==='setup')console.log('Configuration saved privately. It applies on the next app start/login. A running connector keeps its current configuration.');
    else if(setup.state==='SAVED')console.log('Configuration saved privately.');
   }
   if(action!=='setup'){
    const {createMacInstaller}=await import('./mac-desktop-install.mjs');
    const options=await createMacInstaller({envPath});
    const result=await runInstall({action,...options});
    console.log(JSON.stringify(result));if(result.state==='FAILED')process.exitCode=1;
   }
  }catch(error){
   const codes=new Set(['SETUP_REQUIRES_TTY','SETUP_CANCELLED','SETUP_INPUT_FAILED','CONFIG_INVALID','CONFIG_PATH_INVALID','CONFIG_PATH_CONFLICT','FILE_UNSAFE','FILE_MISSING','FILE_BUSY','FILE_STALE','FILE_TOO_LARGE','PRIVATE_FILE_UNAVAILABLE']);
   console.error(`Setup failed: ${codes.has(error?.code)?error.code:'SETUP_FAILED'}`);process.exitCode=1;
  }
 }
}
