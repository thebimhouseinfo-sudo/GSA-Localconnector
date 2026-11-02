import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProcessJournalStore} from '../src/local/process-store.js';
import {DurableProcessManager} from '../src/core/durable-process.js';
import type {ProcessJournalRecord} from '../src/core/process-journal.js';
const record=(owner=randomUUID()):ProcessJournalRecord=>({format:'gsa-process-v1',process_id:randomUUID(),workspace_id:'A',native_id:null,owner_session:owner,revision:1,status:{state:'SUCCEEDED',exit_code:0,started_at:'start',ended_at:'end'},stopped:true,stdout:'evidence',stderr:'',output_complete:true});
for(const count of [1001,10001])test(`startup and fenced reconciliation reach the oldest active record among ${count} journals`,{skip:process.platform==='win32',timeout:30000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-review-store-'));await fs.chmod(root,0o700);
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=new ProcessJournalStore(root),owner=randomUUID();
 const old={...record(),stopped:false,output_complete:false,status:{state:'RUNNING' as const,exit_code:null,started_at:'start',ended_at:null}};
 await store.create(old);await fs.utimes(path.join(root,old.process_id+'.json'),new Date(0),new Date(0));
 for(let i=0;i<count-1;i+=50)await Promise.all(Array.from({length:50},()=>{const r=record();return fs.writeFile(path.join(root,r.process_id+'.json'),JSON.stringify(r),{mode:0o600});}));
 const manager=new DurableProcessManager(null,16,{store,ownerSession:owner});await manager.initialize();
 assert.equal((await store.list()).length,1000,'display page remains bounded');
 const previousFD=process.env.GSA_OWNER_LOCK_FD,previousSession=process.env.GSA_OWNER_SESSION;
 process.env.GSA_OWNER_LOCK_FD='3';process.env.GSA_OWNER_SESSION=owner;
 try{
  await store.reconcileAfterOwnerFence(owner);
  const first=(await store.load(old.process_id))!;
  await store.reconcileAfterOwnerFence(owner);
  const second=(await store.load(old.process_id))!;
  assert.equal(second.revision,first.revision,'unverified old-owner records are not repeatedly rewritten');
  assert.equal(store.health().admission_blocked,true);
 }finally{
  if(previousFD===undefined)delete process.env.GSA_OWNER_LOCK_FD;else process.env.GSA_OWNER_LOCK_FD=previousFD;
  if(previousSession===undefined)delete process.env.GSA_OWNER_SESSION;else process.env.GSA_OWNER_SESSION=previousSession;
 }
 const observed=(await store.load(old.process_id))!;
 assert.equal(observed.stopped,false);assert.equal(observed.status.state,'UNKNOWN');assert.equal(observed.status.ended_at,null);assert.equal(observed.output_complete,false);assert.equal(observed.stdout,'evidence');
 assert.equal(store.health().admission_blocked,true,'old-owner physical stop remains unverified');
 const active=(await fs.readdir(root)).filter(n=>n.endsWith('.json')).length;
 const archived=await fs.readdir(path.join(root,'archive')).catch(()=>[]);
 assert.equal(active+archived.length,count,'all terminal evidence is retained across archival');assert.ok(active<=1001,'active metadata scan is bounded apart from unresolved work');
});
test('corrupt journals are reported and preserved while valid history remains available',{skip:process.platform==='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-review-corrupt-'));await fs.chmod(root,0o700);
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=new ProcessJournalStore(root),good=record(),badId=randomUUID(),file=path.join(root,badId+'.json');
 await store.create(good);await fs.writeFile(file,'{"format":',{mode:0o600});
 const diagnostics:string[]=[];t.mock.method(process.stderr,'write',(text:string)=>{diagnostics.push(String(text));return true;});
 await new DurableProcessManager(null,16,{store,ownerSession:randomUUID()}).initialize();
 assert.deepEqual(await store.list(),[good]);
 assert.ok(diagnostics.some(line=>line.includes('PROCESS_JOURNAL_UNREADABLE')&&line.includes(badId)));
 assert.equal(await fs.readFile(file,'utf8'),'{"format":');await assert.rejects(store.load(badId));
});
import {createReadOnlyTools} from '../src/mcp/server.js';
import {WorkspaceRegistry} from '../src/core/workspace.js';
test('a corrupt prior RUNNING intent degrades recovery and fences new command admission',{skip:process.platform==='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-r3-corrupt-'));await fs.chmod(root,0o700);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const badId=randomUUID(),file=path.join(root,badId+'.json');await fs.writeFile(file,'{"status":{"state":"RUNNING"},',{mode:0o600});
 const store=new ProcessJournalStore(root),persistence={store,ownerSession:randomUUID()},manager=new DurableProcessManager(null,16,persistence);
 let calls=0;const sandbox:any={verified:true,platform:'macos',policy_fingerprint:'fixture',execute:async()=>{calls++;return {exit_code:0,signal:null,stdout:'',stderr:'',cancelled:false,timed_out:false};}};
 await manager.initialize();
 await assert.rejects(manager.run({workspace_id:'A',executable:'/bin/true',argv:[],cwd_relative:'.',time_limit_ms:1000,max_output_bytes:1024,network_allowed:false},sandbox),/PROCESS_RECOVERY_DEGRADED/);
 assert.equal(calls,0);assert.equal(await fs.readFile(file,'utf8'),'{"status":{"state":"RUNNING"},');
 const invoke=createReadOnlyTools(new WorkspaceRegistry(),null,null,null,null,null,null,null,null,null,null,{processPersistence:persistence});
 const capability=JSON.parse((await invoke({name:'list_capabilities'})).content[0].text).result;
 assert.equal(capability.processRecovery.unreadable_records,1);assert.equal(capability.processRecovery.admission_blocked,true);assert.match(capability.restartRecovery,/degraded/i);
});
test('sealed terminal journals leave the active scan without losing history; UNKNOWN is retained',{skip:process.platform==='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-r3-archive-'));await fs.chmod(root,0o700);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=new ProcessJournalStore(root),old=record(),unknown={...record(),status:{state:'UNKNOWN' as const,exit_code:null,started_at:'start',ended_at:'end'}};
 await store.create(old);await store.create(unknown);
 await fs.utimes(path.join(root,old.process_id+'.json'),new Date(0),new Date(0));await fs.utimes(path.join(root,unknown.process_id+'.json'),new Date(0),new Date(0));
 for(let i=0;i<1000;i+=50)await Promise.all(Array.from({length:50},()=>{const r=record();return fs.writeFile(path.join(root,r.process_id+'.json'),JSON.stringify(r),{mode:0o600});}));
 await store.list();
 assert.equal((await fs.readdir(root)).filter(n=>n.endsWith('.json')).length,1001);
 assert.deepEqual(await store.load(old.process_id),old);assert.deepEqual(await store.load(unknown.process_id),unknown);
 assert.equal(await fs.readFile(path.join(root,unknown.process_id+'.json'),'utf8'),JSON.stringify(unknown)+'\n');
 await assert.rejects(store.save({...old,revision:2,stdout:'forged'},1),/PROCESS_TERMINAL_IMMUTABLE/);
 await assert.rejects(store.create({...old,stdout:'forged'}),(error:any)=>error.code==='EEXIST','archived IDs must remain exclusive');
});
test('a create paused after lookup cannot mask the same ID concurrently created and archived',{skip:process.platform==='win32',timeout:10000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-r3-archive-race-')));await fs.chmod(root,0o700);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const first=new ProcessJournalStore(root),second=new ProcessJournalStore(root),original=record(),replacement={...original,stdout:'new evidence'};
 for(let i=0;i<1000;i+=50)await Promise.all(Array.from({length:50},()=>{const r=record();return fs.writeFile(path.join(root,r.process_id+'.json'),JSON.stringify(r),{mode:0o600});}));
 const actualLoad=first.load.bind(first);let entered!:()=>void,release!:()=>void,paused=false;
 const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 t.mock.method(first,'load',async (id:string)=>{const value=await actualLoad(id);if(id===original.process_id&&!paused){paused=true;entered();await gate;}return value;});
 const pending=first.create(replacement);void pending.catch(()=>{});
 let secondResult:PromiseSettledResult<void>|undefined,firstResult:PromiseSettledResult<void>|undefined;
 try{
  await ready;[secondResult]=await Promise.allSettled([second.create(original)]);
  if(secondResult.status==='fulfilled'){
   await fs.utimes(path.join(root,original.process_id+'.json'),new Date(0),new Date(0));await second.list();
   assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'archive',original.process_id+'.json'),'utf8')),original,'second writer is archived before the paused create resumes');
  }
 }finally{release();[firstResult]=await Promise.allSettled([pending]);}
 const successes=[firstResult,secondResult].filter(result=>result?.status==='fulfilled');assert.equal(successes.length,1,'one ID has exactly one creator across active/archive namespaces');
 const winner=firstResult?.status==='fulfilled'?replacement:original;
 assert.deepEqual(await second.load(original.process_id),winner,'no later create masks the winning evidence');
 await fs.utimes(path.join(root,original.process_id+'.json'),new Date(0),new Date(0)).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
 await second.list();assert.deepEqual(await first.load(original.process_id),winner);
 await assert.rejects(second.create({...winner,stdout:'forged'}),(error:any)=>error.code==='EEXIST');
});
test('a leftover journal lock preserves uncertain work and degrades recovery without aborting diagnostics',{skip:process.platform==='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-r3-leftover-lock-'));await fs.chmod(root,0o700);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=new ProcessJournalStore(root),owner=randomUUID(),running={...record(),stopped:false,output_complete:false,status:{state:'RUNNING' as const,exit_code:null,started_at:'start',ended_at:null}},good=record();
 await store.create(running);await store.create(good);
 const lock=path.join(root,running.process_id+'.lock');await fs.writeFile(lock,'',{mode:0o600});const before=await fs.lstat(lock);
 const previousFD=process.env.GSA_OWNER_LOCK_FD,previousSession=process.env.GSA_OWNER_SESSION;
 process.env.GSA_OWNER_LOCK_FD='3';process.env.GSA_OWNER_SESSION=owner;
 t.after(()=>{if(previousFD===undefined)delete process.env.GSA_OWNER_LOCK_FD;else process.env.GSA_OWNER_LOCK_FD=previousFD;if(previousSession===undefined)delete process.env.GSA_OWNER_SESSION;else process.env.GSA_OWNER_SESSION=previousSession;});
 await assert.doesNotReject(store.reconcileAfterOwnerFence(owner));
 assert.deepEqual(await store.load(running.process_id),running);assert.deepEqual(await store.load(good.process_id),good);
 const after=await fs.lstat(lock);assert.equal(after.ino,before.ino);assert.equal(await fs.readFile(lock,'utf8'),'');
 const persistence={store,ownerSession:owner},manager=new DurableProcessManager(null,16,persistence);await manager.initialize();
 assert.equal(store.health().admission_blocked,true);
 let calls=0;const sandbox:any={verified:true,platform:'macos',policy_fingerprint:'fixture',execute:async()=>{calls++;throw Error('must not dispatch');}};
 await assert.rejects(manager.run({workspace_id:'A',executable:'/bin/true',argv:[],cwd_relative:'.',time_limit_ms:1000,max_output_bytes:1024,network_allowed:false},sandbox),/PROCESS_RECOVERY_DEGRADED/);assert.equal(calls,0);
 const invoke=createReadOnlyTools(new WorkspaceRegistry(),null,null,null,null,null,null,null,null,null,null,{processPersistence:persistence});
 const capability=JSON.parse((await invoke({name:'list_capabilities'})).content[0].text).result;
 assert.equal(capability.processRecovery.unresolved_records,1);assert.equal(capability.processRecovery.admission_blocked,true);assert.match(capability.restartRecovery,/degraded/i);
 // Only the test removes its own synthetic lock; production must never break it.
 await fs.unlink(lock);await store.reconcileAfterOwnerFence(owner);
 assert.equal(store.health().admission_blocked,false);assert.equal((await store.load(running.process_id))!.status.state,'UNKNOWN');
});
