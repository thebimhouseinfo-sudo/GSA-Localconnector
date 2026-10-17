#!/usr/bin/env node
// Compile, exercise, and atomically install the exact offline VM artifacts.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if(process.platform!=='darwin'||process.arch!=='arm64'||process.argv.slice(2).join(' ')!=='--install')throw Error('Usage on Apple Silicon: node scripts/install-native-vm.mjs --install');
const home=path.join(os.homedir(),'Library/Application Support/GSA-Localconnector');
const destination=path.join(home,'native-vm');
await fs.mkdir(home,{recursive:true,mode:0o700});
const st=await fs.lstat(home);
if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o777)!==0o700||await fs.realpath(home)!==home)throw Error('Unsafe installation parent');
try{await fs.lstat(destination);throw Error('Installation already exists; refusing overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}
const stage=await fs.mkdtemp(path.join(home,'.native-vm-stage-'));
let installed=false;
const sha=b=>createHash('sha256').update(b).digest('hex');
async function run(command,args,timeout=120000){
 return await new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:root,detached:true,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:os.homedir(),TMPDIR:os.tmpdir(),LANG:'C.UTF-8'}});
  let output='',size=0,failed=false,killTimer,closeTimer;
  const signal=sig=>{try{process.kill(-child.pid,sig);}catch(e){if(e.code!=='ESRCH')throw e;}};
  const abort=()=>{if(failed)return;failed=true;signal('SIGTERM');killTimer=setTimeout(()=>signal('SIGKILL'),20000);closeTimer=setTimeout(()=>{child.stdout.destroy();child.stderr.destroy();reject(Error(command+' shutdown deadline exceeded'));},28000);};
  const timer=setTimeout(abort,timeout);
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{size+=data.length;if(size>4*1024*1024)abort();else{output+=data;process.stdout.write(data);}});
  const cleanup=()=>{clearTimeout(timer);clearTimeout(killTimer);clearTimeout(closeTimer);};
  child.on('error',e=>{cleanup();reject(e);});child.on('close',code=>{cleanup();if(failed||code!==0)reject(Error(command+' failed: '+code));else resolve(output);});
 });
}
try{
 for(const dir of ['bin','scripts','native','native/macos-vm'])await fs.mkdir(path.join(stage,dir),{mode:0o700});
 for(const name of ['native/macos-vm/guest_worker.py','scripts/prepare-vm-worker-seed.py','scripts/test-vm-guest-worker.py']){
  await fs.copyFile(path.join(root,name),path.join(stage,name));await fs.chmod(path.join(stage,name),0o600);
 }
 await run('/usr/bin/swiftc',['-framework','Virtualization',path.join(root,'native/macos-vm/WorkerHost.swift'),'-o',path.join(stage,'bin/worker-host')]);
 await run('/usr/bin/codesign',['--force','--sign','-','--entitlements',path.join(root,'native/macos-vm/Virtualization.entitlements'),path.join(stage,'bin/worker-host')]);
 await run('/usr/bin/codesign',['--verify','--strict',path.join(stage,'bin/worker-host')]);
 await run('/usr/bin/swiftc',[path.join(root,'native/macos-vm/SourceCapture.swift'),'-o',path.join(stage,'bin/source-capture')]);
 for(const name of ['bin/worker-host','bin/source-capture'])await fs.chmod(path.join(stage,name),0o500);
 const artifacts={};for(const name of ['bin/worker-host','bin/source-capture','scripts/prepare-vm-worker-seed.py','native/macos-vm/guest_worker.py'])artifacts[name]=sha(await fs.readFile(path.join(stage,name)));
 const evidence=await run('/usr/bin/python3',['-u',path.join(root,'scripts/test-vm-worker-native.py'),'--run','--helpers-root',stage],360000);
 const lines=evidence.split('\n');const receipt=lines.filter(line=>line.startsWith('{')).map(line=>{try{return JSON.parse(line);}catch{return {};}}).find(item=>item.state==='NATIVE_WORKER_TESTS_PASSED');
 if(!receipt||!['positive_build','outside_denials','identity_dropped','source_protected','timeout','output_cap','clean_stop'].every(key=>receipt[key]===true)||!evidence.includes('GSA_BOOTSTRAP_TESTS_PASS'))throw Error('Incomplete native evidence');
 const pressure=await run('/usr/bin/python3',['-u',path.join(root,'scripts/test-vm-worker-native.py'),'--run','--backpressure','--helpers-root',stage],240000);
 if(!pressure.includes('"state": "NATIVE_BACKPRESSURE_PASSED"'))throw Error('Backpressure verification failed');
 for(const [name,digest] of Object.entries(artifacts))if(sha(await fs.readFile(path.join(stage,name)))!==digest)throw Error('Tested artifact changed');
 const body=JSON.stringify({format:'gsa-native-vm-v1',platform:'darwin',arch:'arm64',hostRelease:os.release(),imagePath:path.join(home,'images/ubuntu-24.04-arm64-efi-fallback-candidate.raw'),imageSHA256:'9aca11f8edb5474df457c073dbfe140b27aa31f22e46ab1405bed089c5d57666',imageBytes:3758096384,artifacts,checks:['allowed-build','outside-read','outside-write','nested-process','source-integrity','secret-exposure','network-denied','timeout','output-cap','cgroup-descendants','clean-stop']});
 const key=randomBytes(32);
 await fs.writeFile(path.join(stage,'native-proof-key'),key,{mode:0o600,flag:'wx'});
 await fs.writeFile(path.join(stage,'install.json'),JSON.stringify({body,hmac:createHmac('sha256',key).update(body).digest('hex')}),{mode:0o600,flag:'wx'});
 await fs.writeFile(path.join(stage,'native-verification.log'),evidence+'\n'+pressure,{mode:0o600,flag:'wx'});
 await fs.writeFile(path.join(stage,'source-provenance.json'),JSON.stringify(Object.fromEntries(await Promise.all(['native/macos-vm/WorkerHost.swift','native/macos-vm/SourceCapture.swift','scripts/test-vm-worker-native.py','scripts/test-vm-guest-worker.py'].map(async name=>[name,sha(await fs.readFile(path.join(root,name)))])))),{mode:0o600,flag:'wx'});
 await run('/usr/bin/python3',['-c','import ctypes,os,sys;lib=ctypes.CDLL(None,use_errno=True);result=lib.renamex_np(os.fsencode(sys.argv[1]),os.fsencode(sys.argv[2]),4);assert result==0,os.strerror(ctypes.get_errno())',stage,destination]);installed=true;
 console.log(JSON.stringify({state:'NATIVE_VM_INSTALLED',installation:destination,platform:'darwin-arm64'}));
}finally{if(!installed)await fs.rm(stage,{recursive:true,force:true});}
