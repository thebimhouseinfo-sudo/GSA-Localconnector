/** Finite native platform fixture preflight, scoped to a fresh disposable
 * GitHub macOS runner. No production root or user files are touched.
 * The caller MUST retain the native driver's private acknowledgement gate.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
const fail=(code)=>Object.assign(Error(code),{code});
const MAX_LOG=16384;
export async function boundedTool(exe,args,{timeout=30000}={}){
 if(!exe.startsWith('/usr/bin/')||!['/usr/bin/mkfifo','/usr/bin/hdiutil'].includes(exe)||args.some(a=>typeof a!=='string'||a.includes('\0')))throw fail('PLATFORM_PREFLIGHT_COMMAND_DENIED');
 return await new Promise((resolve,reject)=>{
  const child=spawn(exe,args,{shell:false,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:os.homedir(),LANG:'C',TMPDIR:'/private/tmp'},stdio:['ignore','pipe','pipe']});
  let out='',err='',failure;
  const timer=setTimeout(()=>{failure=fail('PLATFORM_PREFLIGHT_TIMEOUT');child.kill('SIGTERM');},timeout);
  for(const [stream,isErr] of [[child.stdout,false],[child.stderr,true]]){
   stream.on('data',chunk=>{let value=isErr?err:out;value+=chunk.toString('utf8');if(value.length>MAX_LOG){failure=fail('PLATFORM_PREFLIGHT_OUTPUT_LIMIT');child.kill('SIGTERM');}else if(isErr)err=value;else out=value;});
  }
  child.once('error',error=>{failure=error;});
  child.once('close',code=>{clearTimeout(timer);if(failure||code!==0){
   // Diagnostics are from two fixed system executables and fixed verbs only.
   // Never echo arguments (they can contain host-specific temporary paths).
   const tool=exe.endsWith('/mkfifo')?'MKFIFO':'HDIUTIL';
   const verb=tool==='MKFIFO'?'CREATE':({'create':'CREATE','attach':'ATTACH','detach':'DETACH'}[args[0]]??'UNKNOWN');
   const rejected=failure??fail('PLATFORM_PREFLIGHT_'+tool+'_'+verb+'_EXIT_'+String(code));
   // Only bounded system utility diagnostics, with absolute paths redacted.
   rejected.detail=(err||out).slice(0,640).replace(/\\/[^\\s\"']+/g,'[PATH]').replace(/[\\r\\n]+/g,' ').slice(0,320);
   reject(rejected);
  }else resolve({stdout:out,stderr:err});});
 });
}
export async function inspectPlatformFixtures(stage,workspace,{command=boundedTool}={}){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw fail('APPLE_SILICON_MAC_REQUIRED');
 // No arbitrary path selection: workspace must be an immediate owned child of the private stage.
 const stagePath=await fs.realpath(stage),workspacePath=await fs.realpath(workspace);
 if(stagePath!==stage||workspacePath!==path.join(stagePath,'roots','workspace'))throw fail('PLATFORM_PREFLIGHT_SCOPE_INVALID');
 const stageStat=await fs.lstat(stage,{bigint:true}),workspaceStat=await fs.lstat(workspace,{bigint:true});
 for(const st of [stageStat,workspaceStat])if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==BigInt(process.getuid())||(st.mode&0o077n)!==0n)throw fail('PLATFORM_PREFLIGHT_SCOPE_UNSAFE');
 const fifo=path.join(workspace,'case-platform-fifo'),image=path.join(stage,'platform-disk-image.dmg'),mountpoint=path.join(stage,'platform-mount');
 const outcome={fifoFixture:{state:'UNVERIFIED'},mountFixture:{state:'UNVERIFIED'}};
 let attached=false,cleanupConfirmed=true;
 try{
  await command('/usr/bin/mkfifo',[fifo]);const f=await fs.lstat(fifo);
  if(!f.isFIFO()||f.isSymbolicLink()||f.nlink!==1)throw fail('FIFO_FIXTURE_INVALID');
  outcome.fifoFixture={state:'VERIFIED',kind:'fifo'};
  await fs.unlink(fifo);
  await fs.mkdir(mountpoint,{mode:0o700});
  await command('/usr/bin/hdiutil',['create','-size','64m','-fs','HFS+','-volname','GSA-Tree-Disposable','-format','UDRW','-o',image],{timeout:60000});
  await command('/usr/bin/hdiutil',['attach','-nobrowse','-mountpoint',mountpoint,image],{timeout:60000});
  attached=true;
  const mount=await fs.stat(mountpoint,{bigint:true});
  if(!mount.isDirectory()||mount.dev===stageStat.dev)throw fail('DEVICE_FIXTURE_NOT_DISTINCT');
  outcome.mountFixture={state:'VERIFIED',kind:'mounted-disposable-volume',differentDevice:true};
 }finally{
  if(attached){
   try{await command('/usr/bin/hdiutil',['detach',mountpoint],{timeout:60000});attached=false;}
   catch{cleanupConfirmed=false;}
  }
  if(!attached){
   for(const p of [fifo,image,mountpoint]){
    try{const st=await fs.lstat(p);if(st.isDirectory())await fs.rmdir(p);else await fs.unlink(p);}
    catch(error){if(error.code!=='ENOENT')cleanupConfirmed=false;}
   }
  }
  if(!cleanupConfirmed)throw fail('PLATFORM_FIXTURE_CLEANUP_UNVERIFIED');
 }
 return Object.freeze(outcome);
}
