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
 try{await store.reconcileAfterOwnerFence(owner);}finally{
  if(previousFD===undefined)delete process.env.GSA_OWNER_LOCK_FD;else process.env.GSA_OWNER_LOCK_FD=previousFD;
  if(previousSession===undefined)delete process.env.GSA_OWNER_SESSION;else process.env.GSA_OWNER_SESSION=previousSession;
 }
 const observed=(await store.load(old.process_id))!;
 assert.equal(observed.stopped,true);assert.equal(observed.status.state,'UNKNOWN');assert.equal(observed.output_complete,false);assert.equal(observed.stdout,'evidence');
 assert.equal((await fs.readdir(root)).filter(n=>n.endsWith('.json')).length,count,'terminal evidence is retained');
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
