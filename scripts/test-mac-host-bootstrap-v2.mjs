#!/usr/bin/env node
// Test-only fixed feasibility variant. No production policy or capability changes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {reserveAttempt,createChildLifecycle} from './mac-recovery-probe-control.mjs';

const script=fileURLToPath(import.meta.url);
const slot=fileURLToPath(new URL('../docs/reports/.mac-host-bootstrap-v2.attempt.json',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const acknowledgement='--ack-reviewed-dev-null-variant';
const command=`node scripts/test-mac-host-bootstrap-v2.mjs --run ${acknowledgement}`;
const systems=['/System/Library','/usr/lib','/usr/libexec','/usr/bin','/usr/sbin','/bin','/sbin','/Library/Developer/CommandLineTools'];
export const HOST_PROFILE=[
 '(version 1)','(deny default)','(allow process-exec)','(allow process-fork)',
 '(allow file-write-data (literal "/dev/null"))',
 '(allow file-read-metadata file-read-data (literal "/"))',
 '(allow sysctl-read (sysctl-name "security.mac.lockdown_mode_state"))',
 '(allow sysctl-read (sysctl-name "kern.bootargs"))',
 '(allow file-read* (subpath (param "WORKSPACE"))',
 ...systems.map(p=>` (subpath "${p}")`),
 ' (literal "/dev/null") (literal "/dev/urandom"))',
 '(allow file-write* (subpath (param "WORKSPACE")))','(deny network*)'
].join('\n');
export async function getPlan(){return {
 state:'REQUIRES_PROFILE_REVIEW_AND_EXPLICIT_APPROVAL',nativeExecution:false,activation:false,
 profile:HOST_PROFILE,profile_sha256:hash(HOST_PROFILE),driver_sha256:hash(await fs.readFile(script)),
 maximumSandboxInvocations:12,perChildMs:5000,suiteMs:60000,combinedOutputBytes:16384,
 reservation:slot,command,rootExposure:'literal / read may reveal immediate root names; no descendant grant',
 sysctlExposure:['security.mac.lockdown_mode_state','kern.bootargs'],
 limits:'feasibility only; process domain, revocation and production safety remain unverified'
};}
export function buildCases(root,port){
 assert.match(root,/^\/private\/tmp\/gsa-host-bootstrap-[A-Za-z0-9_-]+$/);
 assert.ok(Number.isInteger(port)&&port>0&&port<=65535);
 const w=path.join(root,'workspace'),u=path.join(root,'outside'),r=path.join(root,'reference');
 const positive=(id,executable,args,expected)=>({id,kind:'positive',executable,args,expected});
 const negative=(id,executable,args,denialTarget)=>({id,kind:'negative',executable,args,denialTarget});
 return [
  positive('workspace-read','/bin/cat',[path.join(w,'allowed.txt')],'ALLOWED_MARKER'),
  positive('workspace-write','/bin/sh',['-c','printf owned > "$1"; /bin/cat "$1"','fixture',path.join(w,'created.txt')],'owned'),
  {id:'git-startup',kind:'version',executable:'/usr/bin/git',args:['--version']},
  positive('project-make','/usr/bin/make',['-f',path.join(w,'Makefile')],''),
  {id:'root-names',kind:'root-names',executable:'/bin/ls',args:['-1','/']},
  negative('outside-read','/bin/cat',[path.join(u,'world.txt')],path.join(u,'world.txt')),
  negative('nested-outside-read','/bin/sh',['-c','/bin/cat "$1"','fixture',path.join(u,'world.txt')],path.join(u,'world.txt')),
  negative('symlink-read','/bin/cat',[path.join(w,'outside-link')],path.join(w,'outside-link')),
  negative('outside-write','/bin/sh',['-c','printf escape > "$1"','fixture',path.join(u,'new.txt')],path.join(u,'new.txt')),
  negative('reference-write','/bin/sh',['-c','printf escape > "$1"','fixture',path.join(r,'new.txt')],path.join(r,'new.txt')),
  negative('reference-execute','/bin/sh',[path.join(r,'script.sh')],path.join(r,'script.sh')),
  negative('loopback-denied','/usr/bin/nc',['-G','1','-w','1','127.0.0.1',String(port)],'127.0.0.1')
 ];
}
export function assessResult(c,result){
 if(result.signal||result.failure||!Number.isInteger(result.code))throw Error('UNVERIFIED_CHILD_'+c.id);
 if(c.kind==='negative'){
  if(result.code===0||/OUTSIDE_MARKER|REFERENCE_MARKER/.test(result.stdout))throw Error('ESCAPE_'+c.id);
  if(!result.stderr.includes(c.denialTarget)||!/Operation not permitted|Permission denied/.test(result.stderr))throw Error('UNVERIFIED_DENIAL_'+c.id);
 }else{
  if(result.code!==0)throw Error('UNVERIFIED_POSITIVE_'+c.id);
  if(c.kind==='positive'&&result.stdout!==c.expected)throw Error('UNVERIFIED_BYTES_'+c.id);
  if(c.kind==='version'&&!/^git version [0-9]/.test(result.stdout))throw Error('UNVERIFIED_VERSION');
 }
}
export async function executeCases(cases,runner,verify){
 assert.equal(cases.length,12);const receipts=[];
 for(const c of cases){const result=await runner(c);assessResult(c,result);await verify(c,result);receipts.push({id:c.id,...result});}
 return receipts;
}
async function tree(root){
 const rows=[];
 async function visit(dir,relative=''){
  for(const name of (await fs.readdir(dir)).sort()){
   if(rows.length>=64)throw Error('TREE_LIMIT');
   const file=path.join(dir,name),s=await fs.lstat(file,{bigint:true}),row={path:relative+name,dev:String(s.dev),ino:String(s.ino),mode:String(s.mode)};
   assert.ok(s.isDirectory()||s.isFile());
   if(s.isFile()){assert.ok(s.size<=65536n);assert.equal(s.nlink,1n);row.sha256=hash(await fs.readFile(file));}
   rows.push(row);if(s.isDirectory())await visit(file,relative+name+'/');
  }
 }
 await visit(root);return rows;
}
export function createNativeRunner(workspace,report,lifecycle,deadline,{spawnImpl=spawn,timeoutMs=5000}={}){
 assert.ok(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=5000);
 return async c=>{
  lifecycle.assertIdle();
  if(Date.now()+6000>deadline)throw Error('SUITE_DEADLINE');
  report.started.push(c.id);
  const progress=await fs.open(path.join(report.root,'progress.json'),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);
  try{await progress.writeFile(JSON.stringify({started:report.started}));await progress.sync();}finally{await progress.close();}
  lifecycle.beforeLaunch();
  return new Promise((resolve,reject)=>{
   let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),failure,cleanupTimer,abortStarted=false;
   let child;
   try{child=spawnImpl('/usr/bin/sandbox-exec',['-p',HOST_PROFILE,'-D','WORKSPACE='+workspace,c.executable,...c.args],{
    cwd:workspace,shell:false,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:path.join(workspace,'home'),TMPDIR:path.join(workspace,'tmp'),LANG:'C',LC_ALL:'C',DEVELOPER_DIR:'/Library/Developer/CommandLineTools',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(workspace,'home','empty-config'),GIT_TERMINAL_PROMPT:'0'}
   });}catch(e){lifecycle.markCleanupUnverified();reject(e);return;}
   const abort=reason=>{
    if(abortStarted)return;abortStarted=true;failure??=reason;lifecycle.markCleanupUnverified();
    try{child.kill('SIGKILL');}catch{/* Deadline still records unverified cleanup. */}
    cleanupTimer=setTimeout(()=>reject(Error('CHILD_CLEANUP_UNVERIFIED')),1000);
   };
   const timer=setTimeout(()=>abort('CHILD_TIMEOUT'),timeoutMs);
   const append=(target,bytes)=>{if(stdout.length+stderr.length+bytes.length>16384)abort('OUTPUT_LIMIT');else if(target==='out')stdout=Buffer.concat([stdout,bytes]);else stderr=Buffer.concat([stderr,bytes]);};
   child.stdout.on('data',b=>append('out',b));child.stderr.on('data',b=>append('err',b));child.stdin.on('error',()=>{});
   child.on('error',()=>{failure='SPAWN_ERROR';});
   child.on('close',(code,signal)=>{clearTimeout(timer);clearTimeout(cleanupTimer);lifecycle.confirmClosed();resolve({pid:child.pid??null,code,signal,stdout:stdout.toString(),stderr:stderr.toString(),failure:failure??null});});
   child.stdin.end();
  });
 };
}
async function runOnce(){
 if(process.platform!=='darwin')throw Error('MAC_ONLY');
 const deadline=Date.now()+60000;
 await fs.lstat(slot).then(()=>{throw Error('ATTEMPT_ALREADY_CONSUMED');},e=>{if(e.code!=='ENOENT')throw e;});
 const tools=['/usr/bin/sandbox-exec','/bin/cat','/bin/sh','/usr/bin/git','/usr/bin/make','/bin/ls','/usr/bin/nc'];
 const resolved={};
 for(const p of [...systems,...tools]){
  const actual=await fs.realpath(p),s=await fs.lstat(actual,{bigint:true});assert.equal(actual,p,'SYSTEM_ALIAS_REQUIRES_REVIEW '+p);
  assert.equal(s.uid,0n);assert.equal(s.mode&0o022n,0n);resolved[p]={path:actual,device:String(s.dev),inode:String(s.ino)};
 }
 const root=await fs.realpath(await fs.mkdtemp('/private/tmp/gsa-host-bootstrap-'));await fs.chmod(root,0o700);
 const w=path.join(root,'workspace'),u=path.join(root,'outside'),r=path.join(root,'reference');
 for(const d of [w,u,r])await fs.mkdir(d,{mode:0o700});
 for(const d of ['home','tmp'])await fs.mkdir(path.join(w,d),{mode:0o700});
 await fs.writeFile(path.join(w,'allowed.txt'),'ALLOWED_MARKER',{mode:0o600,flag:'wx'});
 await fs.writeFile(path.join(w,'home/empty-config'),'',{mode:0o600,flag:'wx'});
 await fs.writeFile(path.join(w,'Makefile'),"all:\n\t@/bin/sh -c 'printf built > built.txt'\n",{mode:0o600,flag:'wx'});
 await fs.writeFile(path.join(u,'world.txt'),'OUTSIDE_MARKER',{mode:0o644,flag:'wx'});
 await fs.writeFile(path.join(r,'source.txt'),'REFERENCE_MARKER',{mode:0o644,flag:'wx'});
 await fs.writeFile(path.join(r,'script.sh'),'printf REFERENCE_MARKER\n',{mode:0o644,flag:'wx'});
 await fs.symlink(path.join(u,'world.txt'),path.join(w,'outside-link'));
 const baseline={outside:await tree(u),reference:await tree(r)};
 let connections=0;
 const listener=net.createServer(socket=>{connections++;socket.on('error',()=>{});socket.end();});
 await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
 const port=listener.address().port;
 try{
  await new Promise((resolve,reject)=>{
   const socket=net.connect({host:'127.0.0.1',port});
   const timer=setTimeout(()=>{socket.destroy();reject(Error('LISTENER_BASELINE_TIMEOUT'));},2000);
   socket.on('error',e=>{clearTimeout(timer);socket.destroy();reject(e);});
   socket.on('close',()=>{clearTimeout(timer);resolve();});socket.end();
  });
  assert.equal(connections,1);connections=0;
 }catch(e){listener.close();throw e;}
 const report={format:'gsa-host-bootstrap-feasibility-v2',state:'UNVERIFIED',activation:false,root,profile:HOST_PROFILE,profile_sha256:hash(HOST_PROFILE),driver_sha256:hash(await fs.readFile(script)),host:os.release(),resolved,baseline,started:[],receipts:[]};
 const lifecycle=createChildLifecycle(),cases=buildCases(root,port);
 try{
  await reserveAttempt(slot,{format:report.format,root,profile_sha256:report.profile_sha256,driver_sha256:report.driver_sha256,host:report.host,resolved,maximumSandboxInvocations:12,command});
  const run=createNativeRunner(w,report,lifecycle,deadline);
  await executeCases(cases,async c=>{
   const raw=await run(c);
   const saved=c.kind==='root-names'?{...raw,stdout:null,rootNames:{count:raw.stdout.split('\n').filter(Boolean).length,sha256:hash(raw.stdout)}}:raw;
   report.receipts.push({id:c.id,...saved});
   return raw;
  },async c=>{
   assert.deepEqual({outside:await tree(u),reference:await tree(r)},baseline);
   assert.equal(connections,0,'NETWORK_ESCAPE');
   if(c.id==='workspace-write')assert.equal(await fs.readFile(path.join(w,'created.txt'),'utf8'),'owned');
   if(c.id==='project-make')assert.equal(await fs.readFile(path.join(w,'built.txt'),'utf8'),'built');
  });
  await new Promise(resolve=>setTimeout(resolve,50));assert.equal(connections,0,'NETWORK_ESCAPE');
  lifecycle.assertIdle();report.state='PASS_BOUNDED_FEASIBILITY_ONLY';
 }catch(e){report.failure=String(e.message);throw e;}
 finally{
  report.childCleanupUnverified=lifecycle.cleanupUnverified;
  report.final={outside:await tree(u),reference:await tree(r),networkConnections:connections};
  if(JSON.stringify(report.final.outside)!==JSON.stringify(baseline.outside)||JSON.stringify(report.final.reference)!==JSON.stringify(baseline.reference))report.state='BLOCKING_OUTSIDE_CHANGE';
  listener.close();
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({state:report.state,result:path.join(root,'result.json'),started:report.started,activation:false}));
 }
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length===0||args.length===1&&args[0]==='--plan'){console.log(JSON.stringify(await getPlan()));return;}
 if(args.length!==2||args[0]!=='--run'||args[1]!==acknowledgement)throw Error('EXPLICIT_ACKNOWLEDGEMENT_REQUIRED');
 await runOnce();
}
if(process.argv[1]&&path.resolve(process.argv[1])===script)main().catch(e=>{console.error(e.message);process.exitCode=1;});
