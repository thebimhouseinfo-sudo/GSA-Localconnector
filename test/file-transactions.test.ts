import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {FileTransactionError,newFileTransaction,transitionFileTransaction,reconcileFileTransaction,fileTransactionOutcome,validateFileTransactionRecord,type FileTransactionIntent,type FileTransactionObservations,type FileTransactionReadback} from "../src/core/file-transactions.js";
import {FileTransactionStore} from "../src/local/file-transaction-store.js";

const ID="11111111-1111-4111-8111-111111111111";
const HANDLE="22222222-2222-4222-8222-222222222222";
const HASH="a".repeat(64);
const ref=(workspace_id="workspace",file="file.txt")=>({workspace_id,path:file,revision:1,rootIdentity:{device:"1",inode:"2"}});
const intent=(overrides:Record<string,unknown>={})=>({operation:"replace",source:ref(),destination:null,expected_sha256:HASH,after_sha256:"b".repeat(64),...overrides}) as FileTransactionIntent;
const unknown=(observations:FileTransactionObservations|null=null,retained_handles:string[]=[],reason:"INTERRUPTED"|"IO_UNCERTAIN"="IO_UNCERTAIN"):FileTransactionReadback=>({status:"UNKNOWN",observations:observations??{captured:null,published:null,source_absent:null,destination_present:null,source_sha256:null,destination_sha256:null,capturedIdentity:null,publishedIdentity:null},retained_handles,reason});
const applied=(changes:Record<string,unknown>={})=>({status:"APPLIED",reason:"VERIFIED_READBACK",observations:{captured:true,published:true,source_absent:false,destination_present:true,source_sha256:HASH,destination_sha256:"b".repeat(64),capturedIdentity:{device:"1",inode:"10"},publishedIdentity:{device:"1",inode:"11"}},retained_handles:[HANDLE],...changes}) as unknown as FileTransactionReadback;
const code=(expected:string)=>(error:unknown)=>error instanceof FileTransactionError&&error.code===expected;

async function storeFixture(t:any){
 const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-file-transactions-test-")));
 const root=path.join(temp,"journal");
 t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 return {temp,root,store:new FileTransactionStore(root)};
}

test("intent validation rejects malformed IDs, secrets, extra fields, hashes and traversal",()=>{
 assert.throws(()=>newFileTransaction("not-a-uuid",intent()),code("INVALID_FILE_TRANSACTION"));
 assert.throws(()=>newFileTransaction(ID,{...intent(),runtime_key:"secret"} as any),code("INVALID_FILE_TRANSACTION"));
 assert.throws(()=>newFileTransaction(ID,intent({expected_sha256:"not-a-hash"})),code("INVALID_FILE_TRANSACTION"));
 assert.throws(()=>newFileTransaction(ID,intent({source:ref("workspace","../outside")})),(error:any)=>error.code==="PATH_OUTSIDE_SCOPE");
 assert.throws(()=>newFileTransaction(ID,intent({source:{...ref(),api_key:"secret"}} as any)),code("INVALID_FILE_TRANSACTION"));
});

test("new intent clones and freezes caller data",()=>{
 const original:any=intent(),created=newFileTransaction(ID,original);
 original.source.path="changed.txt";original.expected_sha256="c".repeat(64);
 assert.equal(created.intent.source.path,"file.txt");assert.equal(created.intent.expected_sha256,HASH);
 assert.ok(Object.isFrozen(created));assert.ok(Object.isFrozen(created.intent));assert.ok(Object.isFrozen(created.intent.source.rootIdentity));
 assert.throws(()=>{(created.intent.source as any).path="mutated.txt";});
});

test("durable pending transaction reconciles to UNKNOWN without replay",async t=>{
 const {store}=await storeFixture(t),pending=await store.create(ID,intent());
 assert.equal(pending.status,"PENDING");
 const stopped=await store.reconcile(ID,pending.revision);
 assert.equal(stopped.status,"UNKNOWN");assert.equal(stopped.reason,"INTERRUPTED");
 await assert.rejects(store.update(ID,stopped.revision,applied()),code("FILE_TRANSACTION_READBACK_REQUIRED"));
 assert.equal((await store.load(ID)).status,"UNKNOWN");
});

test("UNKNOWN cannot regress to PENDING even through untyped readback input",()=>{
 const pending=newFileTransaction(ID,intent()),stopped=reconcileFileTransaction(pending);
 const regression:any={status:"PENDING",observations:pending.observations,retained_handles:[],reason:"INTENT_DURABLE"};
 assert.throws(()=>transitionFileTransaction(stopped,regression,stopped.revision,true),code("INVALID_FILE_TRANSACTION"));
});

test("only explicit complete readback can establish APPLIED",()=>{
 const pending=newFileTransaction(ID,intent());
 assert.throws(()=>transitionFileTransaction(pending,applied(),pending.revision),code("FILE_TRANSACTION_READBACK_REQUIRED"));
 const result=transitionFileTransaction(pending,applied(),pending.revision,true);
 assert.equal(result.status,"APPLIED");assert.equal(result.reason,"VERIFIED_READBACK");
 assert.equal(fileTransactionOutcome(result).status,"APPLIED");
});

test("incomplete or contradictory APPLIED observations are rejected",()=>{
 const pending=newFileTransaction(ID,intent());
 const missingIdentity=applied({observations:{captured:true,published:true,source_absent:false,destination_present:true,source_sha256:HASH,destination_sha256:"b".repeat(64),capturedIdentity:null,publishedIdentity:{device:"1",inode:"11"}}});
 assert.throws(()=>transitionFileTransaction(pending,missingIdentity,pending.revision,true),code("INVALID_FILE_TRANSACTION"));
 const wrongHash=applied({observations:{...applied().observations,destination_sha256:HASH}});
 assert.throws(()=>transitionFileTransaction(pending,wrongHash,pending.revision,true),code("INVALID_FILE_TRANSACTION"));
});

test("terminal APPLIED and CONFLICT observations are immutable",()=>{
 const pending=newFileTransaction(ID,intent()),done=transitionFileTransaction(pending,applied(),pending.revision,true);
 assert.throws(()=>transitionFileTransaction(done,unknown(),done.revision,true),code("FILE_TRANSACTION_TERMINAL"));
 const conflict=transitionFileTransaction(pending,{status:"CONFLICT",observations:pending.observations,retained_handles:[],reason:"HASH_CONFLICT"},pending.revision);
 assert.throws(()=>transitionFileTransaction(conflict,unknown(),conflict.revision,true),code("FILE_TRANSACTION_TERMINAL"));
});

test("retained handles and observed captured effects cannot be dropped",()=>{
 const pending=newFileTransaction(ID,intent()),obs:FileTransactionObservations={captured:true,published:false,source_absent:false,destination_present:false,source_sha256:HASH,destination_sha256:null,capturedIdentity:{device:"1",inode:"10"},publishedIdentity:null};
 const captured=transitionFileTransaction(pending,unknown(obs,[HANDLE]),pending.revision);
 assert.throws(()=>transitionFileTransaction(captured,unknown(obs,[]),captured.revision,true),code("INVALID_FILE_TRANSACTION"));
 const dropped={...obs,captured:null,capturedIdentity:null};
 assert.throws(()=>transitionFileTransaction(captured,unknown(dropped,[HANDLE]),captured.revision,true),code("INVALID_FILE_TRANSACTION"));
});

test("durable store is injected at a caller-selected temporary root",async t=>{
 const {root,store}=await storeFixture(t),record=await store.create(ID,intent());
 assert.equal(record.status,"PENDING");assert.equal(path.dirname(path.join(root,ID+".json")),root);
 assert.equal(await fs.stat(path.join(root,ID+".json")).then(s=>s.isFile()),true);
 assert.notEqual(root,path.join(os.homedir(),".gsa"));
});

test("duplicate intent IDs are idempotent and different intent conflicts",async t=>{
 const {store}=await storeFixture(t),first=await store.create(ID,intent()),same=await store.create(ID,intent());
 assert.equal(same.revision,first.revision);assert.equal(same.status,"PENDING");
 await assert.rejects(store.create(ID,intent({after_sha256:"c".repeat(64)})),code("FILE_TRANSACTION_INTENT_CONFLICT"));
 assert.equal((await store.load(ID)).intent.after_sha256,"b".repeat(64));
});

test("two store instances enforce revision checks and never break a live lock",async t=>{
 const {root,store:first}=await storeFixture(t),second=new FileTransactionStore(root),pending=await first.create(ID,intent());
 const lock=path.join(root,ID+".lock");await fs.writeFile(lock,"held by another writer",{mode:0o600,flag:"wx"});
 await assert.rejects(second.update(ID,pending.revision,unknown()),code("FILE_TRANSACTION_LOCKED"));
 assert.equal(await fs.readFile(lock,"utf8"),"held by another writer");await fs.unlink(lock);
 const updated=await first.update(ID,pending.revision,unknown());assert.equal(updated.revision,2);
 await assert.rejects(second.update(ID,pending.revision,unknown()),code("FILE_TRANSACTION_REVISION_CONFLICT"));
 assert.equal((await second.load(ID)).revision,2);
});

test("journal rejects corrupt records and unsafe record permissions",async t=>{
 const {root,store}=await storeFixture(t),record=await store.create(ID,intent()),file=path.join(root,ID+".json");
 await fs.writeFile(file,"{broken",{mode:0o600});
 await assert.rejects(store.load(ID),code("INVALID_FILE_TRANSACTION"));
 await fs.writeFile(file,JSON.stringify(record),{mode:0o600});await fs.chmod(file,0o644);
 await assert.rejects(store.load(ID),code("UNSAFE_FILE_TRANSACTION_RECORD"));
});

test("journal rejects malformed UTF-8 instead of replacing bytes in an intent",async()=>{
 const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-journal-utf8-"))),root=path.join(temp,"journal"),store=new FileTransactionStore(root);let passed=false;
 try{
  await store.create(ID,intent());const file=path.join(root,ID+".json"),encoded=await fs.readFile(file),offset=encoded.indexOf(Buffer.from("file.txt"));
  assert.ok(offset>=0);encoded[offset]=0xff;await fs.writeFile(file,encoded,{mode:0o600});
  await assert.rejects(store.load(ID),code("INVALID_FILE_TRANSACTION"));
  assert.deepEqual(await fs.readFile(file),encoded,"rejection must not rewrite a corrupt journal");passed=true;
 }finally{if(passed)await fs.rm(temp,{recursive:true,force:true});else console.error(`Preserved UTF-8 journal fixture: ${temp}`);}
});

test("journal rejects symlink and hardlink record aliases",async t=>{
 const {root,store,temp}=await storeFixture(t),record=await store.create(ID,intent()),file=path.join(root,ID+".json"),outside=path.join(temp,"outside.json");
 await fs.rename(file,outside);await fs.symlink(outside,file);
 await assert.rejects(store.load(ID));
 await fs.unlink(file);await fs.link(outside,file);
 await assert.rejects(store.load(ID),code("UNSAFE_FILE_TRANSACTION_RECORD"));
});

test("journal rejects unsafe root permissions",async t=>{
 const {root,store}=await storeFixture(t);await fs.mkdir(root,{mode:0o700});await fs.chmod(root,0o755);
 await assert.rejects(store.load(ID),code("UNSAFE_FILE_TRANSACTION_STORE"));
});

test("outcomes are unavailable for PENDING and returned immutable for terminal records",()=>{
 const pending=newFileTransaction(ID,intent());
 assert.throws(()=>fileTransactionOutcome(pending),code("FILE_TRANSACTION_PENDING"));
 const result=transitionFileTransaction(pending,applied(),pending.revision,true),outcome=fileTransactionOutcome(result);
 assert.ok(Object.isFrozen(outcome));assert.ok(Object.isFrozen(outcome.observations));
 assert.throws(()=>{(outcome.retained_handles as any).push(ID);});
});

async function injectFileLockDescriptorStatFailure(t:any,lock:string,closeFailure?:NodeJS.ErrnoException){
 const realOpen=fs.open.bind(fs);let handle:any,lockIdentity:any;let closeCalls=0,closeReturned=false,restored=false;
 const statError=Object.assign(new Error("injected owned file-transaction lock stat failure"),{code:"EIO"});
 const openMock=t.mock.method(fs,"open",async function(file:any,...args:any[]){
  const opened=await realOpen(file,...args);
  if(path.resolve(String(file))===lock){
   handle=opened;
   const named=await fs.lstat(lock,{bigint:true});lockIdentity={dev:named.dev,ino:named.ino,nlink:named.nlink};
   t.mock.method(handle,"stat",async()=>{throw statError;});
   const realClose=handle.close.bind(handle);
   t.mock.method(handle,"close",async()=>{closeCalls++;if(closeFailure)throw closeFailure;const result=await realClose();closeReturned=true;return result;});
  }
  return opened;
 });
 return {statError,get lockIdentity(){return lockIdentity;},get closeCalls(){return closeCalls;},get closeReturned(){return closeReturned;},get restored(){return restored;},restore:async()=>{
  if(restored)return;restored=true;
  openMock.mock.restore();
  if(handle){
   handle.stat?.mock?.restore?.();handle.close?.mock?.restore?.();
   try{await handle.close();}catch(error){if((error as NodeJS.ErrnoException).code!=="EBADF")throw error;}
  }
 }};
}

async function fileLockFailureFixture(id:string){
 const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-file-lock-failure-"))),root=path.join(temp,"journal");
 return {temp,root,lock:path.join(root,id+".lock"),record:path.join(root,id+".json"),store:new FileTransactionStore(root)};
}

test("file transaction create closes its exclusively opened lock descriptor when initial stat fails",async t=>{
 const transactionId="33333333-3333-4333-8333-333333333333",x=await fileLockFailureFixture(transactionId),failure=await injectFileLockDescriptorStatFailure(t,x.lock);
 let observedError:any,retained:any,after:any,subsequentError:any,passed=false;
 try{
  try{await x.store.create(transactionId,intent());}catch(error){observedError=error;}
  await assert.rejects(fs.lstat(x.record),{code:"ENOENT"});retained=await fs.lstat(x.lock,{bigint:true});
  await failure.restore();
  try{await x.store.create(transactionId,intent());}catch(error){subsequentError=error;}
  await assert.rejects(fs.lstat(x.record),{code:"ENOENT"});after=await fs.lstat(x.lock,{bigint:true});
  assert.deepEqual({sameStatError:observedError===failure.statError,closeCalls:failure.closeCalls,closeReturned:failure.closeReturned,retained:retained.isFile()&&retained.dev===failure.lockIdentity.dev&&retained.ino===failure.lockIdentity.ino&&retained.nlink===1n,subsequentCode:subsequentError?.code,identityUnchanged:after.dev===failure.lockIdentity.dev&&after.ino===failure.lockIdentity.ino&&after.nlink===1n},
   {sameStatError:true,closeCalls:1,closeReturned:true,retained:true,subsequentCode:"FILE_TRANSACTION_LOCKED",identityUnchanged:true});
  passed=true;
 }finally{
  try{if(!failure.restored)await failure.restore();}catch(error){console.error(`Preserved file-transaction test fixture: ${x.temp}`);throw error;}
  if(passed)await fs.rm(x.temp,{recursive:true,force:true});else console.error(`Preserved file-transaction test fixture: ${x.temp}`);
 }
});

test("file transaction create reports RESULT_UNKNOWN when initial stat and close fail",async t=>{
 const transactionId="44444444-4444-4444-8444-444444444444",x=await fileLockFailureFixture(transactionId),closeError=Object.assign(new Error("injected file-transaction lock close failure"),{code:"EIO"}),failure=await injectFileLockDescriptorStatFailure(t,x.lock,closeError);
 let observedError:any,retained:any,after:any,subsequentError:any,passed=false;
 try{
  try{await x.store.create(transactionId,intent());}catch(error){observedError=error;}
  await assert.rejects(fs.lstat(x.record),{code:"ENOENT"});retained=await fs.lstat(x.lock,{bigint:true});
  await failure.restore();
  try{await x.store.create(transactionId,intent());}catch(error){subsequentError=error;}
  await assert.rejects(fs.lstat(x.record),{code:"ENOENT"});after=await fs.lstat(x.lock,{bigint:true});
  assert.deepEqual({errorCode:observedError?.code,closeCalls:failure.closeCalls,closeReturned:failure.closeReturned,retained:retained.isFile()&&retained.dev===failure.lockIdentity.dev&&retained.ino===failure.lockIdentity.ino&&retained.nlink===1n,subsequentCode:subsequentError?.code,identityUnchanged:after.dev===failure.lockIdentity.dev&&after.ino===failure.lockIdentity.ino&&after.nlink===1n},
   {errorCode:"RESULT_UNKNOWN",closeCalls:1,closeReturned:false,retained:true,subsequentCode:"FILE_TRANSACTION_LOCKED",identityUnchanged:true});
  passed=true;
 }finally{
  try{if(!failure.restored)await failure.restore();}catch(error){console.error(`Preserved file-transaction test fixture: ${x.temp}`);throw error;}
  if(passed)await fs.rm(x.temp,{recursive:true,force:true});else console.error(`Preserved file-transaction test fixture: ${x.temp}`);
 }
});
