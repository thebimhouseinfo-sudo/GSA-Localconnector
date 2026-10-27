#!/usr/bin/env node
// Compile, exercise, and atomically install the exact offline VM artifacts.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const action=process.argv.slice(2).join(' ');
if(process.platform!=='darwin'||process.arch!=='arm64'||!['--install','--upgrade','--repair'].includes(action))throw Error('Usage on Apple Silicon: node scripts/install-native-vm.mjs --install|--upgrade|--repair');
const home=path.join(os.homedir(),'Library/Application Support/GSA-Localconnector');
const destination=path.join(home,'native-vm');
await fs.mkdir(home,{recursive:true,mode:0o700});
const st=await fs.lstat(home);
if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o777)!==0o700||await fs.realpath(home)!==home)throw Error('Unsafe installation parent');
// Hold the same kernel fence as the connector for the complete build/test/publish.
// No helper or server can start against a partially upgraded installation.
if(process.env.GSA_NATIVE_INSTALL_FENCE!=='3'){
 const code=await new Promise((resolve,reject)=>{
  const python=`import os,sys,fcntl,stat
p=sys.argv[1]; f=os.open(p,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
s=os.fstat(f)
assert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and s.st_mode&0o077==0, 'unsafe owner fence'
try: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError: sys.exit('Active connector or trusted worker; stop before native upgrade')
if f!=3: os.dup2(f,3); os.close(f)
os.set_inheritable(3,True)
os.execve(sys.argv[2],[sys.argv[2],sys.argv[3],sys.argv[4]],dict(os.environ,GSA_NATIVE_INSTALL_FENCE='3'))`;
  const child=spawn('/usr/bin/python3',['-c',python,path.join(home,'server-owner.lock'),process.execPath,fileURLToPath(import.meta.url),action],{stdio:'inherit',env:process.env});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
  child.on('error',reject);child.on('close',code=>resolve(code??1));
 });process.exit(code);
}
// A marker alone cannot bypass fencing: verify the inherited descriptor's inode.
await new Promise((resolve,reject)=>{const child=spawn('/usr/bin/python3',['-c',`import os,sys,fcntl,stat
a=os.fstat(3); b=os.lstat(sys.argv[1])
assert stat.S_ISREG(a.st_mode) and a.st_nlink==1 and a.st_uid==os.getuid() and a.st_mode&0o077==0
assert (a.st_dev,a.st_ino)==(b.st_dev,b.st_ino)
fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB)`,path.join(home,'server-owner.lock')],{stdio:['ignore','ignore','inherit',3]});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Native install fence invalid')));});
let existing=false;
try{const s=await fs.lstat(destination);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700)throw Error('Unsafe native installation');existing=true;if(action==='--install')throw Error('Installation already exists; use --upgrade or --repair');}catch(e){if(e.code!=='ENOENT')throw e;}

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
 // renamex_np RENAME_SWAP publishes the tested upgrade in one atomic operation;
 // the previous installation remains at stage until successful publication.
 await run('/usr/bin/python3',['-c','import ctypes,os,sys;lib=ctypes.CDLL(None,use_errno=True);result=lib.renamex_np(os.fsencode(sys.argv[1]),os.fsencode(sys.argv[2]),int(sys.argv[3]));assert result==0,os.strerror(ctypes.get_errno())',stage,destination,existing?'2':'4']);installed=true;
 if(existing)await fs.rm(stage,{recursive:true});
 console.log(JSON.stringify({state:'NATIVE_VM_INSTALLED',installation:destination,platform:'darwin-arm64'}));
}finally{if(!installed)await fs.rm(stage,{recursive:true,force:true});}
