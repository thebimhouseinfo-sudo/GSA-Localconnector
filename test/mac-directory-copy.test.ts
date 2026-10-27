import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {directoryManifestDigest,type DirectoryCapture,type DirectoryEntry,type DirectoryManifest,type NativeDirectoryReader,type DirectoryCopyRecord,type DirectoryCopyStoreApi} from '../src/core/directory-copy.js';
import type {NativeScopedFiles,ScopedFileRef} from '../src/core/native-io.js';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import {createMacDirectoryCopies} from '../src/hosts/macos-directory-copy.js';
import {DirectoryCopyStore} from '../src/local/directory-copy-store.js';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const uuid='6c3cdce6-0d6d-4be5-93e9-c711ae66a009';
const d=(p:string):DirectoryEntry=>({path:p,kind:'directory'});
const f=(p:string,b:Uint8Array):DirectoryEntry=>({path:p,kind:'file',size:b.length,sha256:hash(b)});
function capture(entries:DirectoryEntry[],payloads:Array<{path:string;bytes:Uint8Array}>):DirectoryCapture {
 const manifest:DirectoryManifest={format:'gsa-directory-manifest-v1',entries,total_bytes:entries.reduce((n,e)=>n+(e.kind==='file'?e.size:0),0),sha256:directoryManifestDigest(entries)};
 return {manifest,files:payloads.map(x=>({path:x.path,bytes:new Uint8Array(x.bytes)})),observations:entries.map(e=>({path:e.path,kind:e.kind,device:'1',inode:String(e.path.length+2),size:e.kind==='file'?e.size:0,mtime_ns:'1',ctime_ns:'2'}))};
}
const simple=capture([d(''),d('empty'),f('note.txt',new TextEncoder().encode('captured'))],[{path:'note.txt',bytes:new TextEncoder().encode('captured')}]);
async function fixture(t:any, sourceRole:'reference'|'workspace'='reference', makeCapture: (ref:ScopedFileRef)=>Promise<DirectoryCapture>=async()=>simple) {
 const parent=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'gsa-dir-copy-'));await fs.chmod(parent,0o700);let retain=false;t.after(async()=>{if(!retain)await fs.rm(parent,{recursive:true,force:true});});
 const source=path.join(parent,'source'),destination=path.join(parent,'destination'),other=path.join(parent,'other'),protectedRoot=path.join(parent,'protected');
 for(const p of [source,destination,other,protectedRoot]){await fs.mkdir(p,{mode:0o700});await fs.chmod(p,0o700);}
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:'src',root:source,role:sourceRole},{id:'dst',root:destination,role:'workspace'},{id:'other',root:other,role:'workspace'}]);
 const calls:string[]=[];const files=new Map<string,Uint8Array>();const dirs=new Set<string>();
 let makeDirectoryImpl=async(ref:ScopedFileRef)=>{const key=`${ref.workspace_id}:${ref.path}`;calls.push(`mkdir:${key}`);if(dirs.has(key)||files.has(key))throw Object.assign(Error('ALREADY_EXISTS_OR_DENIED'),{code:'ALREADY_EXISTS_OR_DENIED'});dirs.add(key);};
 let createImpl=async(ref:ScopedFileRef,bytes:Uint8Array)=>{const key=`${ref.workspace_id}:${ref.path}`;calls.push(`create:${key}`);if(files.has(key)||dirs.has(key))throw Object.assign(Error('ALREADY_EXISTS_OR_DENIED'),{code:'ALREADY_EXISTS_OR_DENIED'});files.set(key,new Uint8Array(bytes));};
 const forbidden=async()=>{throw Error('unexpected base operation');};
 const base:NativeScopedFiles={read:forbidden,createExclusive:(r,b)=>createImpl(r,b),replaceIfHash:forbidden,makeDirectory:r=>makeDirectoryImpl(r),copyExclusive:forbidden,moveExclusive:forbidden,trashIfHash:forbidden};
 const reader:NativeDirectoryReader={capture:async ref=>{calls.push(`capture:${ref.workspace_id}:${ref.path}`);return makeCapture(ref);}};
 const store=new DirectoryCopyStore(protectedRoot);
 const copies=createMacDirectoryCopies(registry,reader,base,store,async()=>{});
 return {parent,source,destination,other,protectedRoot,registry,calls,files,dirs,base,reader,store,copies,preserve(){retain=true;},setMkdir(fn:typeof makeDirectoryImpl){makeDirectoryImpl=fn;},setCreate(fn:typeof createImpl){createImpl=fn;}};
}
const refs={source:{workspace_id:'src',path:'.'},destination:{workspace_id:'dst',path:'copied'}};

test('copies a selected reference root into another workspace child; preserves nested and empty directories',async t=>{
 const x=await fixture(t);const result=await x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);
 assert.equal(result.status,'APPLIED');assert.equal(result.committed,false);
 assert.deepEqual(x.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:')),[
  'mkdir:dst:copied','mkdir:dst:copied/empty','create:dst:copied/note.txt']);
 assert.deepEqual(x.files.get('dst:copied/note.txt'),new TextEncoder().encode('captured'));
});

test('copies a selected workspace root and nested source into a different workspace',async t=>{
 const nested=capture([d(''),d('empty'),d('nested'),f('nested/a',new Uint8Array([7]))],[{path:'nested/a',bytes:new Uint8Array([7])}]);
 const x=await fixture(t,'workspace',async()=>nested);
 const result=await x.copies.copy(uuid,{workspace_id:'src',path:'nested'},{workspace_id:'dst',path:'copy'},nested.manifest.sha256);
 assert.equal(result.status,'APPLIED');assert.ok(x.dirs.has('dst:copy/empty'));
});

test('hash mismatch and lexical overlap reject before persistent intent or namespace calls',async t=>{
 const x=await fixture(t);
 await assert.rejects(x.copies.copy(uuid,refs.source,refs.destination,'0'.repeat(64)));
 assert.deepEqual(x.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:')),[]);
 const insideSource={workspace_id:'dst',path:'copy'},insideDest={workspace_id:'dst',path:'copy/child'};
 await assert.rejects(x.copies.copy('8248f289-cbf3-49a4-9152-dcc084a56067',insideSource,insideDest,simple.manifest.sha256));
 assert.deepEqual(x.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:')),[]);
});

test('unsafe capture and oversized serialized intent reject before first mkdir',async t=>{
 const malformed={...simple,manifest:{...simple.manifest,entries:[d(''),d('../outside')]}} as DirectoryCapture;
 const x=await fixture(t,'reference',async()=>malformed);
 await assert.rejects(x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256));
 assert.deepEqual(x.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:')),[]);
 const hugeEntries:DirectoryEntry[]=[d(''),...Array.from({length:180},(_,i)=>d(`d${String(i).padStart(4,'0')}-${'x'.repeat(2874)}`))];
 const huge=capture(hugeEntries,[]);
 const y=await fixture(t,'reference',async()=>huge);
 await assert.rejects(y.copies.copy('9cce03f2-7aed-45bb-a536-c57c90db2ac3',refs.source,refs.destination,huge.manifest.sha256),/budget|limit|size/i);
 assert.deepEqual(y.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:')),[]);
});

test('destination root collision preserves the existing entry and makes no child calls',async t=>{
 const x=await fixture(t);x.dirs.add('dst:copied');
 const result=await x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);
 assert.equal(result.status,'UNKNOWN');assert.equal(x.dirs.has('dst:copied'),true);
 assert.deepEqual(x.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:')),['mkdir:dst:copied']);
});

test('an explicit EEXIST fake collision is a known CONFLICT with no child calls',async t=>{
 const x=await fixture(t);x.setMkdir(async ref=>{x.calls.push(`mkdir:${ref.workspace_id}:${ref.path}`);throw Object.assign(Error('EEXIST'),{code:'EEXIST'});});
 const result=await x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);
 assert.equal(result.status,'CONFLICT');assert.equal(x.dirs.has('dst:copied'),false);
 assert.deepEqual(x.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:')),['mkdir:dst:copied']);
});

test('observed destination directory replacement stops later entries and reports UNKNOWN',async t=>{
 const root=capture([d('')],[]),nested=capture([d(''),d('empty')],[]);
 let destinationRead=0;
 const x=await fixture(t,'reference',async ref=>{
  if(ref.workspace_id==='src')return simple;
  const first=destinationRead++===0,result=first?root:nested;
  return {...result,observations:result.observations.map(o=>({...o,inode:first?'22':'23'}))};
 });
 const result=await x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);
 assert.equal(result.status,'UNKNOWN');assert.match(result.reason,/identity replacement/i);
 assert.deepEqual(x.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:')),['mkdir:dst:copied','mkdir:dst:copied/empty']);
});

test('grant revocation after root mkdir stops child effects and leaves uncertainty',async t=>{
 const x=await fixture(t);let revoked=false;
 x.setMkdir(async ref=>{const key=`${ref.workspace_id}:${ref.path}`;x.calls.push(`mkdir:${key}`);x.dirs.add(key);if(ref.path==='copied'&&!revoked){revoked=true;await x.registry.revoke('src');}});
 const result=await x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);
 assert.equal(result.status,'UNKNOWN');assert.equal(x.dirs.has('dst:copied'),true);
 assert.deepEqual(x.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:')),['mkdir:dst:copied']);
});

test('physical source root replacement during the last pre-write authorization stops before mkdir',async t=>{
 const x=await fixture(t);let phase='capture',swapped=false;
 const store:DirectoryCopyStoreApi={
  rootDirectory:x.store.rootDirectory,
  create:(id,intent)=>x.store.create(id,intent),
  beginEntry:async(id,revision,p)=>{const record=await x.store.beginEntry(id,revision,p);if(p==='')phase='after-durable-root-begin';return record;},
  acknowledgeEntry:(id,revision,p,kind)=>x.store.acknowledgeEntry(id,revision,p,kind),
  finish:(id,revision,status,reason)=>x.store.finish(id,revision,status,reason),
  load:id=>x.store.load(id)
 };
 const authorize=async(workspaceId:string,permission:string)=>{
  if(phase==='after-durable-root-begin'&&workspaceId==='src'&&permission==='read'){
   await fs.rename(x.source,`${x.source}-old`);await fs.mkdir(x.source,{mode:0o700});await fs.chmod(x.source,0o700);swapped=true;phase='authorization-returned';
  }
 };
 const copies=createMacDirectoryCopies(x.registry,x.reader,x.base,store,authorize);
 const result=await copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);
 assert.equal(swapped,true);assert.equal(phase,'authorization-returned');assert.equal(result.status,'UNKNOWN');
 assert.deepEqual(x.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:')),[]);
});

test('native create that effects then throws returns UNKNOWN and never cleans up or retries',async t=>{
 const x=await fixture(t);let threw=false;
 x.setCreate(async(ref,bytes)=>{const key=`${ref.workspace_id}:${ref.path}`;x.calls.push(`create:${key}`);x.files.set(key,new Uint8Array(bytes));if(!threw){threw=true;throw Error('ack lost');}});
 const first=await x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);
 assert.equal(first.status,'UNKNOWN');assert.equal(x.files.has('dst:copied/note.txt'),true);
 const again=await x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);
 assert.equal(again.status,'UNKNOWN');assert.equal(x.calls.filter(c=>c.startsWith('create:')).length,1);
 assert.equal(x.calls.some(c=>/unlink|trash|remove|rollback/i.test(c)),false);
});

test('same ID concurrent calls schedule one write; changed intent rejects',async t=>{
 const x=await fixture(t);let release!:()=>void;let started!:()=>void;const gate=new Promise<void>(r=>release=r),begun=new Promise<void>(r=>started=r);
 x.setMkdir(async ref=>{const key=`${ref.workspace_id}:${ref.path}`;x.calls.push(`mkdir:${key}`);x.dirs.add(key);if(ref.path==='copied'){started();await gate;}});
 const first=x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);await begun;
 const duplicate=x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);release();
 const [a,b]=await Promise.allSettled([first,duplicate]);assert.equal(x.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:')).length,3);
 assert.equal(a.status,'fulfilled');assert.ok(['UNKNOWN','APPLIED'].includes(a.value.status));
 if(b.status==='fulfilled')assert.equal(b.value.status,'UNKNOWN');else assert.equal((b.reason as {code?:string}).code,'DIRECTORY_COPY_LOCKED');
 await assert.rejects(x.copies.copy(uuid,refs.source,{workspace_id:'dst',path:'other-copy'},simple.manifest.sha256),/intent|different/i);
});

test('store acknowledgement failure after native effect stops later writes',async t=>{
 const x=await fixture(t);const proxy=new Proxy(x.store as DirectoryCopyStoreApi,{get(target,key,receiver){if(key==='acknowledgeEntry')return async()=>{throw Object.assign(Error('store fsync failed'),{code:'RESULT_UNKNOWN'});};return Reflect.get(target,key,receiver);}});
 const copies=createMacDirectoryCopies(x.registry,x.reader,x.base,proxy,async()=>{});
 const result=await copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);
 assert.equal(result.status,'UNKNOWN');assert.equal(x.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:')).length,1);
});

test('readCopy and restarted coordinator expose pending work as UNKNOWN without replay',async t=>{
 const x=await fixture(t);const source=x.registry.requireGrant('src','read'),destination=x.registry.requireGrant('dst','write');
 const record=await x.store.create(uuid,{source:{workspace_id:source.id,path:'.',canonical_root:source.canonicalRoot,role:'reference',revision:source.revision,rootIdentity:source.rootIdentity,permissions:source.permissions},destination:{workspace_id:destination.id,path:'copied',canonical_root:destination.canonicalRoot,role:'workspace',revision:destination.revision,rootIdentity:destination.rootIdentity,permissions:destination.permissions},expected_manifest_sha256:simple.manifest.sha256,manifest:simple.manifest});
 assert.equal(record.record.status,'PENDING');
 const resumed=createMacDirectoryCopies(x.registry,x.reader,x.base,x.store,async()=>{});
 const read=await resumed.readCopy(uuid);assert.equal(read.status,'UNKNOWN');
 const terminal=await x.store.finish(uuid,1,'UNKNOWN','interrupted before effects');assert.equal(terminal.status,'UNKNOWN');
 const afterMatch=await resumed.readCopy(uuid);assert.equal(afterMatch.status,'UNKNOWN');assert.equal(afterMatch.readback?.status,'MATCH');
 assert.equal((await x.store.load(uuid)).status,'UNKNOWN');
 assert.deepEqual(x.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:')),[]);
});

function effectCapture(x:Awaited<ReturnType<typeof fixture>>,ref:ScopedFileRef):DirectoryCapture {
 if(ref.workspace_id!=='dst'||ref.path!=='copied')return simple;
 const root='dst:copied';if(!x.dirs.has(root))throw Object.assign(Error('destination absent'),{code:'ENOENT'});
 const entries:DirectoryEntry[]=[];const payloads:Array<{path:string;bytes:Uint8Array}>=[];
 for(const key of x.dirs){if(key===root)entries.push(d(''));else if(key.startsWith(`${root}/`))entries.push(d(key.slice(root.length+1)));}
 for(const [key,bytes] of x.files){if(key.startsWith(`${root}/`)){const p=key.slice(root.length+1);entries.push(f(p,bytes));payloads.push({path:p,bytes});}}
 entries.sort((a,b)=>a.path.localeCompare(b.path));return capture(entries,payloads);
}

async function injectAfterRecordPublish(t:any,x:Awaited<ReturnType<typeof fixture>>,revision:number,status:'PENDING'|'APPLIED'='PENDING'){
 const id=uuid,target=path.join(x.protectedRoot,`${id}.json`),lock=path.join(x.protectedRoot,`${id}.lock`),realOpen=fs.open.bind(fs),realLink=fs.link.bind(fs),realRename=fs.rename.bind(fs),realReadFile=fs.readFile.bind(fs);
 let armed=false,injected=false;const events:string[]=[];const owned:any[]=[];
 const failure=Object.assign(new Error(`injected journal directory sync at revision ${revision}`),{code:'EIO'});
 const openMock=t.mock.method(fs,'open',async function(file:any,...args:any[]){
  const opened=await realOpen(file,...args);
  const openedPath=path.resolve(String(file)),isDirectory=openedPath===x.protectedRoot,isOwned=isDirectory||openedPath===lock||openedPath===target||(path.dirname(openedPath)===x.protectedRoot&&path.basename(openedPath).startsWith('.transaction-'));
  if(isOwned){const state:any={handle:opened,realClose:opened.close.bind(opened),closeCalls:0,closeReturned:false};owned.push(state);if(isDirectory){const realSync=opened.sync.bind(opened);state.syncMock=t.mock.method(opened,'sync',async()=>{events.push('directory-sync');if(armed&&!injected){injected=true;events.push(`inject:revision-${revision}`);throw failure;}return realSync();});}state.closeMock=t.mock.method(opened,'close',async()=>{state.closeCalls++;const result=await state.realClose();state.closeReturned=true;return result;});}
  return opened;
 });
 const inspect=async()=>{const record=JSON.parse(await realReadFile(target,'utf8'));events.push(`published:${record.revision}:${record.status}`);if(record.revision===revision&&record.status===status)armed=true;};
 const linkMock=t.mock.method(fs,'link',async function(source:any,destination:any){const result=await realLink(source,destination);if(path.resolve(String(destination))===target){events.push('real-link');await inspect();}return result;});
 const renameMock=t.mock.method(fs,'rename',async function(source:any,destination:any){const result=await realRename(source,destination);if(path.resolve(String(destination))===target){events.push('real-rename');await inspect();}return result;});
 return {failure,events,get injected(){return injected;},async finish(preserve:()=>void){linkMock.mock.restore();renameMock.mock.restore();openMock.mock.restore();for(const state of owned){state.syncMock?.mock.restore();state.closeMock.mock.restore();}const missing=owned.filter(state=>state.closeCalls!==1||!state.closeReturned);if(missing.length){preserve();let cleanupError:any;for(const state of missing){try{await state.realClose();}catch(error){if((error as NodeJS.ErrnoException).code==='EBADF'&&state.closeCalls>0)continue;cleanupError??=error;}}if(cleanupError)throw cleanupError;throw new Error(`DirectoryCopyStore did not successfully close all ${owned.length} exact owned handles`);}}};
}

async function useEffectCapture(x:Awaited<ReturnType<typeof fixture>>){x.reader.capture=async ref=>{x.calls.push(`capture:${ref.workspace_id}:${ref.path}`);return effectCapture(x,ref);};}
const namespaceCalls=(x:Awaited<ReturnType<typeof fixture>>)=>x.calls.filter(c=>c.startsWith('mkdir:')||c.startsWith('create:'));
async function diskRecord(x:Awaited<ReturnType<typeof fixture>>):Promise<DirectoryCopyRecord>{return JSON.parse(await fs.readFile(path.join(x.protectedRoot,`${uuid}.json`),'utf8')) as DirectoryCopyRecord;}
async function assertPublishCleanup(x:Awaited<ReturnType<typeof fixture>>){
 const record=await fs.lstat(path.join(x.protectedRoot,`${uuid}.json`));assert.equal(record.nlink,1);
 assert.deepEqual((await fs.readdir(x.protectedRoot)).filter(n=>n.startsWith('.transaction-')),[]);
 await assert.rejects(fs.lstat(path.join(x.protectedRoot,`${uuid}.lock`)),{code:'ENOENT'});
}
async function preserveAssertionFailure(x:Awaited<ReturnType<typeof fixture>>,body:()=>Promise<void>|void){try{await body();}catch(error){x.preserve();throw error;}}

test('initial publish directory-sync EIO rejects UNKNOWN and restart never replays absent destination',async t=>{
 const x=await fixture(t);await useEffectCapture(x);const injection=await injectAfterRecordPublish(t,x,1);
 let error:any;try{await x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);}catch(e){error=e;}await injection.finish(x.preserve);
 await preserveAssertionFailure(x,async()=>{assert.equal(error?.code,'RESULT_UNKNOWN');assert.equal(injection.injected,true);assert.ok(injection.events.includes('real-link'));assert.ok(injection.events.includes('inject:revision-1'));assert.deepEqual(namespaceCalls(x),[]);
 const first=await diskRecord(x);assert.equal(first.revision,1);assert.equal(first.status,'PENDING');assert.deepEqual(first.acknowledged,[]);assert.equal(first.pending_path,null);
 await assertPublishCleanup(x);
 const freshStore=new DirectoryCopyStore(x.protectedRoot),fresh=createMacDirectoryCopies(x.registry,x.reader,x.base,freshStore,async()=>{});
 const before=await fs.readFile(path.join(x.protectedRoot,`${uuid}.json`));
 const read=await fresh.readCopy(uuid);assert.equal(read.status,'UNKNOWN');assert.equal(read.readback?.status,'ABSENT');
 const afterRead=await fs.readFile(path.join(x.protectedRoot,`${uuid}.json`));assert.deepEqual(afterRead,before);
 const duplicate=await fresh.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);assert.equal(duplicate.status,'UNKNOWN');assert.equal(duplicate.readback?.status,'ABSENT');assert.deepEqual(namespaceCalls(x),[]);
 const afterDuplicate=await fs.readFile(path.join(x.protectedRoot,`${uuid}.json`));assert.deepEqual(afterDuplicate,before);const unchanged=JSON.parse(afterDuplicate.toString('utf8')) as DirectoryCopyRecord;assert.equal(unchanged.revision,1);assert.equal(unchanged.status,'PENDING');});
});

test('root begin rename directory-sync EIO preserves pending revision and restart never replays',async t=>{
 const x=await fixture(t);await useEffectCapture(x);const injection=await injectAfterRecordPublish(t,x,2);let result:any;
 try{result=await x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);}catch(error){result=error;}await injection.finish(x.preserve);
 await preserveAssertionFailure(x,async()=>{
 assert.equal(injection.injected,true);assert.ok(injection.events.includes('real-rename'));assert.ok(injection.events.includes('inject:revision-2'));assert.equal(result.status,'UNKNOWN');assert.deepEqual(namespaceCalls(x),[]);
 await assertPublishCleanup(x);
 const before=await fs.readFile(path.join(x.protectedRoot,`${uuid}.json`));const record=JSON.parse(before.toString('utf8')) as DirectoryCopyRecord;assert.equal(record.revision,2);assert.equal(record.status,'PENDING');assert.equal(record.pending_path,'');assert.deepEqual(record.acknowledged,[]);
 const freshStore=new DirectoryCopyStore(x.protectedRoot),fresh=createMacDirectoryCopies(x.registry,x.reader,x.base,freshStore,async()=>{});
 assert.equal((await fresh.readCopy(uuid)).status,'UNKNOWN');assert.equal((await fresh.copy(uuid,refs.source,refs.destination,simple.manifest.sha256)).status,'UNKNOWN');assert.deepEqual(namespaceCalls(x),[]);
 assert.deepEqual(await fs.readFile(path.join(x.protectedRoot,`${uuid}.json`)),before);});
});

test('root acknowledgement rename directory-sync EIO keeps actual rev3 and never replays root mkdir',async t=>{
 const x=await fixture(t);await useEffectCapture(x);const injection=await injectAfterRecordPublish(t,x,3);let result:any;
 try{result=await x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);}catch(error){result=error;}await injection.finish(x.preserve);
 await preserveAssertionFailure(x,async()=>{
 assert.equal(injection.injected,true);assert.ok(injection.events.includes('real-rename'));assert.ok(injection.events.includes('inject:revision-3'));assert.equal(result.status,'UNKNOWN');assert.deepEqual(namespaceCalls(x),['mkdir:dst:copied']);
 await assertPublishCleanup(x);
 const before=await fs.readFile(path.join(x.protectedRoot,`${uuid}.json`),'utf8'),record=JSON.parse(before) as DirectoryCopyRecord;
 assert.equal(record.revision,3);assert.equal(record.status,'PENDING');assert.deepEqual(record.acknowledged,[{path:'',kind:'directory'}]);assert.equal(record.pending_path,null);
 assert.deepEqual({reportedAcknowledged:result.acknowledged,reportedPending:result.pending_path},{reportedAcknowledged:[],reportedPending:''});
 const freshStore=new DirectoryCopyStore(x.protectedRoot),fresh=createMacDirectoryCopies(x.registry,x.reader,x.base,freshStore,async()=>{});
 assert.equal((await fresh.readCopy(uuid)).status,'UNKNOWN');assert.equal((await fresh.readCopy(uuid)).readback?.status,'DIFFERENT');assert.equal((await fresh.copy(uuid,refs.source,refs.destination,simple.manifest.sha256)).status,'UNKNOWN');assert.deepEqual(namespaceCalls(x),['mkdir:dst:copied']);
 assert.equal(await fs.readFile(path.join(x.protectedRoot,`${uuid}.json`),'utf8'),before);});
});

test('APPLIED finish rename directory-sync EIO leaves truthful terminal state and duplicate does not replay',async t=>{
 const x=await fixture(t);await useEffectCapture(x);const injection=await injectAfterRecordPublish(t,x,8,'APPLIED');let result:any;
 try{result=await x.copies.copy(uuid,refs.source,refs.destination,simple.manifest.sha256);}catch(error){result=error;}await injection.finish(x.preserve);
 await preserveAssertionFailure(x,async()=>{
 assert.equal(injection.injected,true);assert.ok(injection.events.includes('real-rename'));assert.ok(injection.events.includes('inject:revision-8'));assert.equal(result.status,'UNKNOWN');
 await assertPublishCleanup(x);
 const expected=['mkdir:dst:copied','mkdir:dst:copied/empty','create:dst:copied/note.txt'];assert.deepEqual(namespaceCalls(x),expected);
 const before=await fs.readFile(path.join(x.protectedRoot,`${uuid}.json`),'utf8'),record=JSON.parse(before) as DirectoryCopyRecord;
 assert.equal(record.revision,8);assert.equal(record.status,'APPLIED');assert.equal(record.pending_path,null);assert.equal(record.acknowledged.length,3);
 const freshStore=new DirectoryCopyStore(x.protectedRoot),fresh=createMacDirectoryCopies(x.registry,x.reader,x.base,freshStore,async()=>{});
 assert.equal((await fresh.readCopy(uuid)).status,'APPLIED');assert.equal((await fresh.readCopy(uuid)).readback?.status,'MATCH');assert.equal((await fresh.copy(uuid,refs.source,refs.destination,simple.manifest.sha256)).status,'APPLIED');
 assert.deepEqual(namespaceCalls(x),expected);assert.equal(await fs.readFile(path.join(x.protectedRoot,`${uuid}.json`),'utf8'),before);});
});
