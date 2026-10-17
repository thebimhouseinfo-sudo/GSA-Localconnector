import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawn,type ChildProcess} from "node:child_process";
import {fileURLToPath} from "node:url";
import {CiJournalStore} from "../src/local/ci-store.js";
import {createQueuedRun,transitionRun} from "../src/core/ci-journal.js";
import {enrollReadOnly} from "../src/local/grants.js";
import {ControlLeaseStore} from "../src/local/control-lease.js";
const launcher=fileURLToPath(new URL("../../scripts/macos-owner-launcher.py",import.meta.url));
const sourceLauncher=path.resolve("scripts/macos-owner-launcher.py");
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test("kernel owner lock fences another server and inherited workers after parent crash",{skip:process.platform!=="darwin",timeout:20000},async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-owner-")));
 const identity=path.join(root,"identity"),entry=path.join(root,"entry.mjs"),pidFile=path.join(root,"child-pid");
 await fs.mkdir(identity,{mode:0o700});
 await fs.writeFile(entry,`import fs from 'node:fs';import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:['ignore','ignore','ignore',3]});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));process.stdout.write(process.env.GSA_OWNER_SESSION+'\\n');setTimeout(()=>{},30000);`);
 const start=()=>spawn('/usr/bin/python3',[sourceLauncher,'--identity',identity,'--node',process.execPath,'--entry',entry],{stdio:['ignore','pipe','pipe']});
 const waitExit=(child:ChildProcess)=>new Promise<number|null>(resolve=>child.once('exit',code=>resolve(code)));
 const waitReady=(child:ChildProcess)=>new Promise<string>((resolve,reject)=>{
  let output="",diagnostic="";
  const cleanup=()=>{clearTimeout(timer);child.stdout!.off('data',data);child.stderr!.off('data',stderr);child.off('exit',exited);child.off('error',failed);};
  const failed=(error:Error)=>{cleanup();reject(error);};
  const exited=()=>failed(Error(`owner fixture exited before readiness: ${child.exitCode}; ${diagnostic}`));
  const stderr=(chunk:Buffer)=>{diagnostic=(diagnostic+chunk.toString()).slice(-4096);};
  const data=(chunk:Buffer)=>{output+=chunk.toString();const end=output.indexOf('\n');if(end>=0){cleanup();resolve(output.slice(0,end));}};
  const timer=setTimeout(()=>failed(Error(`owner fixture readiness timeout; ${diagnostic}`)),10000);
  child.stdout!.on('data',data);child.stderr!.on('data',stderr);child.once('exit',exited);child.once('error',failed);
 });
 const first=start();let grandchild:number|undefined;
 try{
  assert.match(await waitReady(first),/^[a-f0-9-]{36}$/);
  grandchild=Number(await fs.readFile(pidFile,'utf8'));
  const second=start();assert.equal(await waitExit(second),75);
  first.kill('SIGKILL');await waitExit(first);
  const third=start();assert.equal(await waitExit(third),75,'worker inherited FD must retain fencing after parent dies');
  process.kill(grandchild,'SIGKILL');grandchild=undefined;
  await sleep(50);
  await fs.writeFile(entry,"process.exit(0)");
  const fourth=start();assert.equal(await waitExit(fourth),0,'kernel releases lock after last owned descriptor closes');
  assert.equal((await fs.stat(path.join(identity,'server-owner.lock'))).mode&0o777,0o600);
 }finally{first.kill('SIGKILL');if(grandchild){try{process.kill(grandchild,'SIGKILL');}catch{}}await fs.rm(root,{recursive:true,force:true});}
});
test("a fenced production restart marks interrupted CI unknown and invalidates old control",{skip:process.platform!=="darwin"},async()=>{
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-owner-restart-")));
 const identity=path.join(home,"Library/Application Support/GSA-Localconnector"),project=path.join(home,"project");await fs.mkdir(project);
 await enrollReadOnly("fixture",project,identity);
 const journal=new CiJournalStore(path.join(identity,"ci-runs")),queued=createQueuedRun("fixture","build","a".repeat(64));
 await journal.save(queued,null);const preparing=transitionRun(queued,"PREPARING",1);await journal.save(preparing,1);await journal.save(transitionRun(preparing,"RUNNING",2),2);
 const old=await new ControlLeaseStore(identity).acquire();
 // Crash immediately after exclusive file creation, before owner metadata write.
 await fs.writeFile(path.join(identity,'control-lease.lock'),'',{mode:0o600});
 await fs.writeFile(path.join(identity,'ci-runs',queued.run_id+'.json.lock'),'',{mode:0o600});
 const cli=spawn(process.execPath,[path.resolve("dist/src/mcp/cli.js")],{env:{...process.env,HOME:home},stdio:["pipe","pipe","pipe"]});
 cli.stderr.resume();let buffer="",sequence=0;const pending=new Map<number,(value:any)=>void>();
 cli.stdout.on('data',data=>{buffer+=data;let index:number;while((index=buffer.indexOf('\n'))>=0){const frame=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);pending.get(frame.id)?.(frame);pending.delete(frame.id);}});
 const call=(name:string,args:object={})=>new Promise<any>((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('owner recovery MCP timeout')),5000);pending.set(id,value=>{clearTimeout(timer);resolve(JSON.parse(value.result.content[0].text));});cli.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\n');});
 try{
  const recovered=await call('ci_status',{workspace_id:'fixture',run_id:queued.run_id});assert.equal(recovered.result.state,'UNKNOWN');
  const stale=await call('renew_control',{control_token:old.control_token});assert.equal(stale.code,'SESSION_INVALID');
  const fresh=await call('acquire_control');assert.equal(fresh.ok,true);assert(fresh.result.revision>old.revision);
  assert.equal((await journal.load(queued.run_id)).revision,4);
 }finally{cli.stdin.end();await new Promise<void>(resolve=>{cli.once('exit',()=>resolve());setTimeout(()=>{cli.kill('SIGTERM');resolve();},2000).unref();});await fs.rm(home,{recursive:true,force:true});}
});
