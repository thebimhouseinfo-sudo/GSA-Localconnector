import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {FileTransactionStore} from '../src/local/file-transaction-store.js';

async function fixture(t:any){
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'gsa-txn-log-'));
 await fs.chmod(root,0o700);
 t.after(async()=>{await fs.rm(root,{recursive:true,force:true});});
 const store=new FileTransactionStore(path.join(root,'journal'));
 const add=async(workspace_id:string)=>{
  const id=randomUUID();
  await store.create(id,{operation:'trash',source:{workspace_id,path:'item.txt',revision:1,rootIdentity:{device:'1',inode:'2'}},destination:null,expected_sha256:'a'.repeat(64),after_sha256:null});
  return id;
 };
 return {root,store,add};
}
test('operation log reads only current workspace records from the existing journal',async t=>{
 const x=await fixture(t),one=await x.add('work-a'),two=await x.add('work-b');
 const calls:string[]=[];
 const result=await x.store.listWorkspace('work-a',async id=>{calls.push(id);});
 assert.deepEqual(result.map(r=>r.transaction_id),[one]);
 assert.equal(result[0]?.status,'PENDING');
 assert.ok(calls.length>=2&&calls.every(id=>id==='work-a'));
 assert.equal(Object.isFrozen(result),true);
 assert.ok(!result.some(r=>r.transaction_id===two));
});
test('operation log rechecks read authorization after listing and denies revoked grant',async t=>{
 const x=await fixture(t);await x.add('work-a');
 let checks=0;
 await assert.rejects(x.store.listWorkspace('work-a',async()=>{if(++checks>=2)throw Object.assign(Error('revoked'),{code:'PERMISSION_DENIED'});}),/revoked/);
 assert.ok(checks>=2);
});
test('operation log honors strict bounds and never creates a parallel journal',async t=>{
 const x=await fixture(t);await x.add('work-a');await x.add('work-a');
 assert.equal((await x.store.listWorkspace('work-a',async()=>{},1)).length,1);
 for(const limit of [0,101,1.5])await assert.rejects(x.store.listWorkspace('work-a',async()=>{},limit));
 await assert.rejects(x.store.listWorkspace('bad/root',async()=>{},1));
 assert.equal((await fs.readdir(path.join(x.root,'journal'))).filter(name=>name.endsWith('.json')).length,2);
});
test('operation log refuses invalid existing records instead of hiding corruption',async t=>{
 const x=await fixture(t);await x.add('work-a');
 const invalid=randomUUID();await fs.writeFile(path.join(x.root,'journal',invalid+'.json'),'{}\n',{mode:0o600});
 await assert.rejects(x.store.listWorkspace('work-a',async()=>{}));
});
