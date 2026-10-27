import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {assertDirectoryCopyIntentBudget,directoryManifestDigest,type DirectoryCopyIntent,type DirectoryManifest} from '../src/core/directory-copy.js';
import {DirectoryCopyStore} from '../src/local/directory-copy-store.js';

const id='6c3cdce6-0d6d-4be5-93e9-c711ae66a009';
const manifest:DirectoryManifest={format:'gsa-directory-manifest-v1',entries:[{path:'',kind:'directory'},{path:'empty',kind:'directory'}],total_bytes:0,sha256:directoryManifestDigest([{path:'',kind:'directory'},{path:'empty',kind:'directory'}])};
async function fixture(t:any){const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'gsa-dir-store-'));await fs.chmod(root,0o700);let retain=false;t.after(async()=>{if(!retain)await fs.rm(root,{recursive:true,force:true});});const protectedRoot=path.join(root,'store');await fs.mkdir(protectedRoot,{mode:0o700});await fs.chmod(protectedRoot,0o700);const store=new DirectoryCopyStore(protectedRoot);const intent:DirectoryCopyIntent={source:{workspace_id:'src',path:'.',canonical_root:path.join(root,'source'),role:'reference',revision:1,rootIdentity:{device:'1',inode:'2'},permissions:['read']},destination:{workspace_id:'dst',path:'copy',canonical_root:path.join(root,'destination'),role:'workspace',revision:1,rootIdentity:{device:'1',inode:'3'},permissions:['read','write','execute']},expected_manifest_sha256:manifest.sha256,manifest};return {root,protectedRoot,store,intent,preserve(){retain=true;}};}

test('intent budget accepts ordinary records and rejects oversized maximal envelope',async t=>{
 const x=await fixture(t);assert.doesNotThrow(()=>assertDirectoryCopyIntentBudget(x.intent));
 const entries=[{path:'',kind:'directory' as const},...Array.from({length:180},(_,i)=>({path:`d${String(i).padStart(4,'0')}-${'x'.repeat(2874)}`,kind:'directory' as const}))];
 const largeManifest:DirectoryManifest={format:'gsa-directory-manifest-v1',entries,total_bytes:0,sha256:directoryManifestDigest(entries)};
 const huge:DirectoryCopyIntent={...x.intent,expected_manifest_sha256:largeManifest.sha256,manifest:largeManifest};
 assert.throws(()=>assertDirectoryCopyIntentBudget(huge),/budget|limit|size/i);
});

test('fresh create is the only created result and identical duplicate preserves record',async t=>{
 const x=await fixture(t);const first=await x.store.create(id,x.intent);assert.equal(first.created,true);assert.equal(first.record.revision,1);assert.equal(first.record.status,'PENDING');
 const duplicate=await x.store.create(id,x.intent);assert.equal(duplicate.created,false);assert.deepEqual(duplicate.record,first.record);
});

test('changed intent and invalid path/record fail closed',async t=>{
 const x=await fixture(t);await x.store.create(id,x.intent);
 await assert.rejects(x.store.create(id,{...x.intent,destination:{...x.intent.destination,path:'different'}}),/intent|conflict/i);
 await assert.rejects(x.store.beginEntry(id,1,'../outside'),/path|invalid/i);
});

test('revision sequence, finite schedule, immutable terminal state and independent clones',async t=>{
 const x=await fixture(t);const created=await x.store.create(id,x.intent);assert.ok(Object.isFrozen(created.record));assert.ok(Object.isFrozen(created.record.intent));
 const begin=await x.store.beginEntry(id,1,'');assert.equal(begin.revision,2);assert.equal(begin.pending_path,'');
 await assert.rejects(x.store.acknowledgeEntry(id,2,'','file'),/kind|schedule|invalid/i);
 const ack=await x.store.acknowledgeEntry(id,2,'','directory');assert.equal(ack.revision,3);
 await assert.rejects(x.store.beginEntry(id,2,'empty'),/revision/i);
 const begin2=await x.store.beginEntry(id,3,'empty');const ack2=await x.store.acknowledgeEntry(id,4,'empty','directory');
 const done=await x.store.finish(id,5,'APPLIED','verified by final observation');assert.equal(done.revision,6);
 await assert.rejects(x.store.beginEntry(id,6,'anything'),/terminal/i);
 const loaded=await x.store.load(id);assert.equal(loaded.status,'APPLIED');assert.equal(loaded.revision,6);assert.equal(begin2.pending_path,'empty');assert.equal(ack2.acknowledged.length,2);
});

test('stale revision, non-prefix acknowledgement and incomplete APPLIED are rejected',async t=>{
 const x=await fixture(t);await x.store.create(id,x.intent);
 await assert.rejects(x.store.beginEntry(id,0,''),/revision/i);
 await assert.rejects(x.store.acknowledgeEntry(id,1,'','directory'),/pending|sequence|invalid/i);
 await assert.rejects(x.store.finish(id,1,'APPLIED','premature'),/complete|pending|invalid/i);
});

test('unknown records reject and replaced protected root is detected',async t=>{
 const x=await fixture(t);await assert.rejects(x.store.load(id),/not found|unknown/i);
 const replacement=path.join(x.root,'replacement');await fs.mkdir(replacement,{mode:0o700});await fs.chmod(replacement,0o700);
 await fs.rename(x.protectedRoot,path.join(x.root,'old-store'));await fs.rename(replacement,x.protectedRoot);
 await assert.rejects(x.store.create(id,x.intent),/store|root|identity|unsafe|changed/i);
});

test('existing stale lock is retained and blocks mutation',async t=>{
 const x=await fixture(t);const lock=path.join(x.protectedRoot,id+'.lock');const handle=await fs.open(lock,'wx',0o600);await handle.close();
 await assert.rejects(x.store.create(id,x.intent),/locked|lock|unknown/i);
 assert.equal((await fs.lstat(lock)).isFile(),true);
});

test('symlinked and hard-linked protected records are rejected',async t=>{
 const x=await fixture(t);await x.store.create(id,x.intent);const record=path.join(x.protectedRoot,id+'.json');
 const alias=path.join(x.protectedRoot,'record-alias');await fs.link(record,alias);
 await assert.rejects(x.store.load(id),/unsafe|record/i);
 await fs.unlink(alias);const displaced=path.join(x.protectedRoot,'record-original');await fs.rename(record,displaced);
 await fs.symlink(displaced,record);
 await assert.rejects(x.store.load(id));
});

async function injectLockDescriptorStatFailure(t:any,lock:string,closeFailure?:NodeJS.ErrnoException){
 const realOpen=fs.open.bind(fs);let handle:any,lockIdentity:any;let closeCalls=0,closeReturned=false;
 const statError=Object.assign(new Error('injected owned lock descriptor stat failure'),{code:'EIO'});
 const openMock=t.mock.method(fs,'open',async function(file:any,...args:any[]){
  const opened=await realOpen(file,...args);
  if(path.resolve(String(file))===lock){
   handle=opened;
   const named=await fs.lstat(lock,{bigint:true});lockIdentity={dev:named.dev,ino:named.ino,nlink:named.nlink};
   t.mock.method(handle,'stat',async()=>{throw statError;});
   const realClose=handle.close.bind(handle);
   t.mock.method(handle,'close',async()=>{closeCalls++;if(closeFailure)throw closeFailure;const result=await realClose();closeReturned=true;return result;});
  }
  return opened;
 });
 return {statError,get handle(){return handle;},get lockIdentity(){return lockIdentity;},get closeCalls(){return closeCalls;},get closeReturned(){return closeReturned;},restore:async()=>{
  openMock.mock.restore();
  if(handle){
   handle.stat?.mock?.restore?.();handle.close?.mock?.restore?.();
   try{await handle.close();}catch(error){if((error as NodeJS.ErrnoException).code!=='EBADF')throw error;}
  }
 }};
}

test('create closes its exclusively opened lock descriptor when the initial descriptor stat fails',async t=>{
 const copyId='6c3cdce6-0d6d-4be5-93e9-c711ae66a00a',x=await fixture(t),lock=path.join(x.protectedRoot,copyId+'.lock'),record=path.join(x.protectedRoot,copyId+'.json'),failure=await injectLockDescriptorStatFailure(t,lock);
 let observedError:any,retained:any,after:any,subsequentError:any;
 try{
  try{await x.store.create(copyId,x.intent);}catch(error){observedError=error;}
  await assert.rejects(fs.lstat(record),{code:'ENOENT'});
  retained=await fs.lstat(lock,{bigint:true});
 }finally{await failure.restore();}
 try{await x.store.create(copyId,x.intent);}catch(error){subsequentError=error;}
 after=await fs.lstat(lock,{bigint:true});
 await assert.rejects(fs.lstat(record),{code:'ENOENT'});
 assert.deepEqual({sameStatError:observedError===failure.statError,closeCalls:failure.closeCalls,closeReturned:failure.closeReturned,retained:retained?.isFile()&&retained.dev===failure.lockIdentity.dev&&retained.ino===failure.lockIdentity.ino&&retained.nlink===1n,subsequentCode:subsequentError?.code,identityUnchanged:after.dev===failure.lockIdentity.dev&&after.ino===failure.lockIdentity.ino&&after.nlink===1n},
  {sameStatError:true,closeCalls:1,closeReturned:true,retained:true,subsequentCode:'DIRECTORY_COPY_LOCKED',identityUnchanged:true});
});

test('create reports RESULT_UNKNOWN and retains the lock when descriptor stat and close fail',async t=>{
 const copyId='6c3cdce6-0d6d-4be5-93e9-c711ae66a00b',x=await fixture(t),lock=path.join(x.protectedRoot,copyId+'.lock'),record=path.join(x.protectedRoot,copyId+'.json'),closeError=Object.assign(new Error('injected owned lock descriptor close failure'),{code:'EIO'}),failure=await injectLockDescriptorStatFailure(t,lock,closeError);
 let observedError:any,retained:any,after:any,subsequentError:any;
 try{
  try{await x.store.create(copyId,x.intent);}catch(error){observedError=error;}
  await assert.rejects(fs.lstat(record),{code:'ENOENT'});
  retained=await fs.lstat(lock,{bigint:true});
 }finally{await failure.restore();}
 try{await x.store.create(copyId,x.intent);}catch(error){subsequentError=error;}
 after=await fs.lstat(lock,{bigint:true});
 await assert.rejects(fs.lstat(record),{code:'ENOENT'});
 assert.deepEqual({errorCode:observedError?.code,closeCalls:failure.closeCalls,closeReturned:failure.closeReturned,retained:retained?.isFile()&&retained.dev===failure.lockIdentity.dev&&retained.ino===failure.lockIdentity.ino&&retained.nlink===1n,subsequentCode:subsequentError?.code,identityUnchanged:after.dev===failure.lockIdentity.dev&&after.ino===failure.lockIdentity.ino&&after.nlink===1n},
  {errorCode:'RESULT_UNKNOWN',closeCalls:1,closeReturned:false,retained:true,subsequentCode:'DIRECTORY_COPY_LOCKED',identityUnchanged:true});
});

async function injectOwnedSyncFailure(t:any,root:string,lock:string,target:(file:string)=>boolean,phase:string){
 const realOpen=fs.open.bind(fs);let injected=false;const events:string[]=[];const owned:any[]=[];
 const failure=Object.assign(new Error(`injected ${phase} sync failure`),{code:'EIO'});
 const openMock=t.mock.method(fs,'open',async function(file:any,...args:any[]){
  const opened=await realOpen(file,...args);
  const openedPath=path.resolve(String(file)),ownedPath=openedPath===root||openedPath===lock||openedPath===lock.replace(/\.lock$/,'.json')||(path.dirname(openedPath)===root&&path.basename(openedPath).startsWith('.transaction-'));
  if(ownedPath){
   const state:any={handle:opened,realClose:opened.close.bind(opened),closeCalls:0,closeReturned:false};owned.push(state);if(target(openedPath))events.push(`open:${phase}`);
   if(target(openedPath)){
    const realSync=opened.sync.bind(opened);
    t.mock.method(opened,'sync',async()=>{events.push(`sync:${phase}`);if(!injected){injected=true;events.push(`inject:${phase}`);throw failure;}return realSync();});
   }
   state.closeMock=t.mock.method(opened,'close',async()=>{state.closeCalls++;const result=await state.realClose();state.closeReturned=true;return result;});
   if(target(openedPath)&&phase==='temp'){
    const realWrite=opened.writeFile.bind(opened);
    t.mock.method(opened,'writeFile',async(data:any,options?:any)=>{const result=await realWrite(data,options);events.push('temp-bytes-written');return result;});
   }
  }
  return opened;
 });
 return {failure,events,get injected(){return injected;},async finish(preserve:()=>void){openMock.mock.restore();for(const state of owned){state.handle.sync?.mock?.restore?.();state.handle.writeFile?.mock?.restore?.();state.closeMock.mock.restore();}const missing=owned.filter(state=>state.closeCalls!==1||!state.closeReturned);if(missing.length){preserve();let cleanupError:any;for(const state of missing){try{await state.realClose();}catch(error){if((error as NodeJS.ErrnoException).code==='EBADF'&&state.closeCalls>0)continue;cleanupError??=error;}}if(cleanupError)throw cleanupError;throw new Error(`SUT did not successfully close all ${owned.length} owned descriptors in ${phase} test`);}}};
}

async function preserveAssertionFailure(x:Awaited<ReturnType<typeof fixture>>,body:()=>Promise<void>|void){try{await body();}catch(error){x.preserve();throw error;}}

test('initial lock descriptor sync EIO preserves the error and publishes no transaction',async t=>{
 const copyId='6c3cdce6-0d6d-4be5-93e9-c711ae66a00c',x=await fixture(t),lock=path.join(x.protectedRoot,copyId+'.lock'),record=path.join(x.protectedRoot,copyId+'.json');
 const failure=await injectOwnedSyncFailure(t,x.protectedRoot,lock,file=>file===lock,'lock');let observed:any;
 try{await x.store.create(copyId,x.intent);}catch(error){observed=error;}finally{await failure.finish(x.preserve);}
 await preserveAssertionFailure(x,async()=>{assert.equal(observed,failure.failure);assert.equal(failure.injected,true);assert.deepEqual(failure.events,['open:lock','sync:lock','inject:lock']);
 await assert.rejects(fs.lstat(lock),{code:'ENOENT'});await assert.rejects(fs.lstat(record),{code:'ENOENT'});
 assert.deepEqual((await fs.readdir(x.protectedRoot)).filter(name=>name.startsWith('.transaction-')),[]);
 const retry=await new DirectoryCopyStore(x.protectedRoot).create(copyId,x.intent);assert.equal(retry.created,true);assert.equal(retry.record.revision,1);});
});

test('initial publication temp sync EIO follows a real write then cleans only its temp',async t=>{
 const copyId='6c3cdce6-0d6d-4be5-93e9-c711ae66a00d',x=await fixture(t),record=path.join(x.protectedRoot,copyId+'.json');
 const failure=await injectOwnedSyncFailure(t,x.protectedRoot,path.join(x.protectedRoot,`${copyId}.lock`),file=>path.dirname(file)===x.protectedRoot&&path.basename(file).startsWith('.transaction-'),'temp');let observed:any;
 try{await x.store.create(copyId,x.intent);}catch(error){observed=error;}finally{await failure.finish(x.preserve);}
 await preserveAssertionFailure(x,async()=>{assert.equal(observed,failure.failure);assert.equal(failure.injected,true);assert.deepEqual(failure.events,['open:temp','temp-bytes-written','sync:temp','inject:temp']);
 await assert.rejects(fs.lstat(record),{code:'ENOENT'});assert.deepEqual((await fs.readdir(x.protectedRoot)).filter(name=>name.startsWith('.transaction-')),[]);
 assert.deepEqual((await fs.readdir(x.protectedRoot)).filter(name=>name===`${copyId}.lock`),[]);
 const retry=await new DirectoryCopyStore(x.protectedRoot).create(copyId,x.intent);assert.equal(retry.created,true);assert.equal(retry.record.revision,1);});
});
