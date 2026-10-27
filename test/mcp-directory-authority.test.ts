import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test,type TestContext} from 'node:test';
import {directoryManifestDigest,type DirectoryCapture,type DirectoryCopyRecord,type DirectoryEntry,type DirectoryManifest,type NativeDirectoryReader} from '../src/core/directory-copy.js';
import type {NativeScopedFiles,ScopedFileRef} from '../src/core/native-io.js';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import {ControlLeaseStore} from '../src/local/control-lease.js';
import {DirectoryCopyStore} from '../src/local/directory-copy-store.js';
import {enrollRolesTrustedBatch,loadTrustedRegistry,revokeTrusted} from '../src/local/grants.js';
import {authorizeMcpWorkspace,withMacDirectoryCopies} from '../src/mcp/runtime-bootstrap.js';
import {createReadOnlyTools,type ToolCall,type ToolResult} from '../src/mcp/server.js';
import {createMacDirectoryCopies} from '../src/hosts/macos-directory-copy.js';

const ids=['2e577d85-9ce1-4f08-a719-38b68745f2c1','2e577d85-9ce1-4f08-a719-38b68745f2c2','2e577d85-9ce1-4f08-a719-38b68745f2c3'];
const bytes=new TextEncoder().encode('captured');
const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const d=(p:string):DirectoryEntry=>({path:p,kind:'directory'});
const f=(p:string,value:Uint8Array):DirectoryEntry=>({path:p,kind:'file',size:value.byteLength,sha256:hash(value)});
function capture(entries:DirectoryEntry[],payloads:Array<{path:string;bytes:Uint8Array}>):DirectoryCapture{
 const manifest:DirectoryManifest={format:'gsa-directory-manifest-v1',entries,total_bytes:entries.reduce((n,e)=>n+(e.kind==='file'?e.size:0),0),sha256:directoryManifestDigest(entries)};
 return {manifest,files:payloads.map(file=>({path:file.path,bytes:new Uint8Array(file.bytes)})),observations:entries.map(entry=>({path:entry.path,kind:entry.kind,device:'1',inode:String(entry.path.length+2),size:entry.kind==='file'?entry.size:0,mtime_ns:'1',ctime_ns:'2'}))};
}
const sourceCapture=capture([d(''),d('empty'),f('note.txt',bytes)],[{path:'note.txt',bytes}]);
const refs={source:{workspace_id:'src',path:'.'},destination:{workspace_id:'dst',path:'copied'}};
const posixTest=(name:string,fn:(t:TestContext)=>void|Promise<void>)=>test(name,{skip:process.platform==='win32'?'POSIX protected authority storage; Windows ACL backend unverified':false},fn);
type Dispatch=(call:ToolCall)=>Promise<ToolResult>;
const body=(result:ToolResult)=>JSON.parse(result.content[0]!.text) as Record<string,any>;
const invoke=(dispatch:Dispatch,name:string,args:Record<string,unknown>,token?:string)=>dispatch({name,arguments:{...args,...(token?{control_token:token}:{})}});
const recordHash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');

async function fixture(t:TestContext,copyId:string){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-dir-authority-')));await fs.chmod(root,0o700);let retain=false;
 t.after(async()=>{if(!retain)await fs.rm(root,{recursive:true,force:true});});
 const reference=path.join(root,'reference'),work=path.join(root,'work'),identity=path.join(root,'identity'),journal=path.join(root,'journal');
 for(const child of [reference,work,identity,journal]){await fs.mkdir(child,{mode:0o700});await fs.chmod(child,0o700);}
 await enrollRolesTrustedBatch([{id:'src',root:reference,role:'reference'},{id:'dst',root:work,role:'workspace'}],identity);
 const registry=await loadTrustedRegistry(identity),controls=new ControlLeaseStore(identity),store=new DirectoryCopyStore(journal);
 const calls:string[]=[],captureEvents:string[]=[],directories=new Set<string>(),files=new Map<string,Uint8Array>();
 let hook:(()=>Promise<void>)|undefined,hookReached=0;
 const base:NativeScopedFiles={
  supportedOperations:['create_file'],
  read:async()=>{calls.push('forbidden:read');throw Error('unexpected base read');},
  createExclusive:async(ref,value)=>{const key=`${ref.workspace_id}:${ref.path}`;calls.push(`create:${key}`);if(directories.has(key)||files.has(key))throw Object.assign(Error('entry exists'),{code:'EEXIST'});files.set(key,new Uint8Array(value));},
  replaceIfHash:async()=>{calls.push('forbidden:replaceIfHash');throw Error('unexpected replace');},
  makeDirectory:async(ref)=>{const key=`${ref.workspace_id}:${ref.path}`;calls.push(`mkdir:${key}`);if(directories.has(key)||files.has(key))throw Object.assign(Error('entry exists'),{code:'EEXIST'});directories.add(key);},
  copyExclusive:async()=>{calls.push('forbidden:copyExclusive');throw Error('unexpected copy');},moveExclusive:async()=>{calls.push('forbidden:moveExclusive');throw Error('unexpected move');},trashIfHash:async()=>{calls.push('forbidden:trashIfHash');throw Error('unexpected trash');}
 };
 function destinationCapture(ref:ScopedFileRef):DirectoryCapture{
  if(ref.workspace_id!=='dst'||ref.path!=='copied')return sourceCapture;
  const rootKey='dst:copied';if(!directories.has(rootKey))throw Object.assign(Error('destination absent'),{code:'ENOENT'});
  const entries:DirectoryEntry[]=[];const payloads:Array<{path:string;bytes:Uint8Array}>=[];
  for(const key of directories){if(key===rootKey)entries.push(d(''));else if(key.startsWith(`${rootKey}/`))entries.push(d(key.slice(rootKey.length+1)));}
  for(const [key,value] of files){if(key.startsWith(`${rootKey}/`)){const p=key.slice(rootKey.length+1);entries.push(f(p,value));payloads.push({path:p,bytes:value});}}
  entries.sort((a,b)=>a.path.localeCompare(b.path));return capture(entries,payloads);
 }
 const reader:NativeDirectoryReader={capture:async ref=>{
  captureEvents.push(ref.workspace_id==='dst'?'destination':'source');
  if(ref.workspace_id==='dst'&&hook){const current=hook;hook=undefined;hookReached++;await current();}
  return ref.workspace_id==='dst'?destinationCapture(ref):sourceCapture;
 }};
 const authorize=(id:string,permission:'read'|'write'|'execute')=>authorizeMcpWorkspace(registry,id,identity,permission);
 const buildDispatcher=(newStore=new DirectoryCopyStore(journal))=>{
  const copies=createMacDirectoryCopies(registry,reader,base,newStore,authorize);
  const filesFacade=withMacDirectoryCopies(base,copies);
  const dispatch=createReadOnlyTools(registry,filesFacade,null,null,null,null,null,null,null,null,controls,{grantDirectory:identity});
  return dispatch as Dispatch;
 };
 return {root,reference,work,identity,journal,copyId,registry,controls,store,base,reader,calls,captureEvents,directories,files,buildDispatcher,setHook(fn:()=>Promise<void>){hook=fn;},get hookReached(){return hookReached;},preserve(){retain=true;}};
}

async function acquire(dispatch:Dispatch){
 const response=await invoke(dispatch,'acquire_control',{}),decoded=body(response);
 assert.equal(decoded.ok,true);assert.equal(typeof decoded.result.control_token,'string');assert.equal(typeof decoded.result.session_id,'string');
 return {token:decoded.result.control_token as string,session:decoded.result.session_id as string,revision:decoded.result.revision as number};
}
async function copyArgs(copyId:string){return {copy_id:copyId,source_workspace_id:refs.source.workspace_id,source_path:refs.source.path,destination_workspace_id:refs.destination.workspace_id,destination_path:refs.destination.path,expected_manifest_sha256:sourceCapture.manifest.sha256};}
function assertInterrupted(response:ToolResult){const decoded=body(response);assert.equal(response.isError,true);assert.equal(decoded.ok,false);assert.equal(decoded.code,'RESULT_UNKNOWN');assert.equal(decoded.result.status,'UNKNOWN');assert.equal(decoded.result.committed,false);assert.deepEqual(decoded.result.acknowledged,[{path:'',kind:'directory'}]);assert.equal(decoded.result.pending_path,null);assert.equal(decoded.result.readback,undefined);return decoded.result;}
async function assertRev3(x:Awaited<ReturnType<typeof fixture>>){const record=await new DirectoryCopyStore(x.journal).load(x.copyId);assert.equal(record.status,'PENDING');assert.equal(record.revision,3);assert.deepEqual(record.acknowledged,[{path:'',kind:'directory'}]);assert.equal(record.pending_path,null);return record;}
async function recordBytes(x:Awaited<ReturnType<typeof fixture>>){return fs.readFile(path.join(x.journal,`${x.copyId}.json`));}
function assertNoDisclosure(response:ToolResult,x:Awaited<ReturnType<typeof fixture>>,tokens:string[]){
 const text=response.content.map(item=>item.text).join('\n');assert.equal(text.includes(x.root),false,'public response included a fixture root');assert.equal(text.includes(x.identity),false,'public response included the identity root');assert.equal(text.includes('captured'),false,'public response included raw source bytes');assert.equal(text.includes(Buffer.from(bytes).toString('base64')),false,'public response included encoded source bytes');assert.equal(text.includes('base64'),false,'public response included a payload encoding');
 for(const token of tokens)assert.equal(text.includes(token),false,'public response included a controller credential');
}
function assertDenied(response:ToolResult,code:string,x:Awaited<ReturnType<typeof fixture>>,tokens:string[]){
 assertNoDisclosure(response,x,tokens);const decoded=body(response);assert.equal(response.isError,true);
 const grantDenial=code==='WORKSPACE_GRANT_REVOKED'||code==='WORKSPACE_GRANT_CHANGED';
 assert.deepEqual(Object.keys(decoded).sort(),grantDenial?['code','message','ok']:['code','ok']);
 assert.equal(decoded.ok,false);assert.equal(decoded.code,code);if(grantDenial)assert.equal(decoded.message,code);
 assert.equal(decoded.result,undefined);assert.equal(decoded.manifest,undefined);assert.equal(decoded.readback,undefined);
}
async function preserveFailure(x:Awaited<ReturnType<typeof fixture>>,bodyFn:()=>Promise<void>){try{await bodyFn();}catch(error){x.preserve();throw error;}}
function eventSummary(x:Awaited<ReturnType<typeof fixture>>){return {captures:x.captureEvents.length,namespace:[...x.calls],copyId:x.copyId};}

posixTest('released controller cannot continue directory copy after a new controller is acquired',async t=>{
 const x=await fixture(t,ids[0]!),dispatch=x.buildDispatcher(),controllerA=await acquire(dispatch);let controllerB:{token:string;session:string;revision:number}|undefined,hookError:unknown,recordHashAtRev3='';
 try{await preserveFailure(x,async()=>{
  const inspect=await invoke(dispatch,'inspect_directory',{workspace_id:'src',path:'.'},controllerA.token);assertNoDisclosure(inspect,x,[controllerA.token]);assert.deepEqual(body(inspect),{ok:true,result:sourceCapture.manifest});
  x.setHook(async()=>{try{const record=await assertRev3(x);recordHashAtRev3=hash(Buffer.from(JSON.stringify(record)));const released=await invoke(dispatch,'release_control',{},controllerA.token);assertNoDisclosure(released,x,[controllerA.token]);assert.equal(body(released).ok,true);controllerB=await acquire(dispatch);const current=await x.controls.require(controllerB.token);assert.equal(controllerB.session!==controllerA.session,true);assert.equal(current.session_id,controllerB.session);}catch(error){hookError=error;throw error;}});
  const initial=await invoke(dispatch,'copy_directory',await copyArgs(x.copyId),controllerA.token);assertNoDisclosure(initial,x,[controllerA.token]);assert.equal(hookError,undefined);assert.equal(x.hookReached,1);assertInterrupted(initial);
  const bytesBefore=await recordBytes(x),recordBefore=JSON.parse(bytesBefore.toString('utf8')) as DirectoryCopyRecord;assert.equal(recordBefore.revision,3);assert.equal(hash(Buffer.from(JSON.stringify(recordBefore))),recordHashAtRev3);
  assert.ok(controllerB);const controllerBToken=controllerB.token;
  const beforeUnauthorized={captures:x.captureEvents.length,calls:x.calls.length};
  assertDenied(await invoke(dispatch,'inspect_directory',{workspace_id:'src',path:'.'},controllerA.token),'SESSION_INVALID',x,[controllerA.token,controllerBToken]);
  assertDenied(await invoke(dispatch,'get_directory_copy',{copy_id:x.copyId},controllerA.token),'SESSION_INVALID',x,[controllerA.token,controllerBToken]);
  assertDenied(await invoke(dispatch,'copy_directory',await copyArgs(x.copyId),controllerA.token),'SESSION_INVALID',x,[controllerA.token,controllerBToken]);
  assert.equal(x.captureEvents.length,beforeUnauthorized.captures);assert.equal(x.calls.length,beforeUnauthorized.calls);
  const fresh= x.buildDispatcher(new DirectoryCopyStore(x.journal));
  const bytesBeforeGet=await recordBytes(x),get=await invoke(fresh,'get_directory_copy',{copy_id:x.copyId},controllerB.token);assertNoDisclosure(get,x,[controllerA.token,controllerB.token]);
  assert.equal(body(get).result.status,'UNKNOWN');assert.equal(body(get).result.readback.status,'DIFFERENT');assert.deepEqual(await recordBytes(x),bytesBeforeGet);
  const bytesBeforeDuplicate=await recordBytes(x),duplicate=await invoke(fresh,'copy_directory',await copyArgs(x.copyId),controllerB.token);assertNoDisclosure(duplicate,x,[controllerA.token,controllerB.token]);
  assert.equal(body(duplicate).result.status,'UNKNOWN');assert.equal(body(duplicate).result.readback.status,'DIFFERENT');assert.deepEqual(await recordBytes(x),bytesBeforeDuplicate);
  assert.deepEqual(x.captureEvents,['source','source','destination','destination','source','destination']);assert.deepEqual(x.calls,['mkdir:dst:copied']);assert.equal(x.calls.filter(call=>call.startsWith('create:')).length,0);assert.equal(x.calls.some(call=>/rollback|unlink|trash|remove|delete/i.test(call)),false);
  const final=JSON.parse((await recordBytes(x)).toString('utf8')) as DirectoryCopyRecord;assert.equal(final.revision,3);assert.equal(final.status,'PENDING');t.diagnostic(JSON.stringify({case:'controller-reacquire',record_sha256:recordHash(await recordBytes(x)),revision:final.revision,status:final.status,...eventSummary(x),controllerSessionsDiffer:controllerA.session!==controllerB.session}));
 });}finally{if(controllerB){try{const released=await invoke(dispatch,'release_control',{},controllerB.token);assertNoDisclosure(released,x,[controllerA.token,controllerB.token]);assert.equal(body(released).ok,true);}catch(error){x.preserve();throw error;}}}
});

posixTest('durable source revocation stops the next directory dispatch and blocks receipt disclosure',async t=>{
 const x=await fixture(t,ids[1]!),dispatch=x.buildDispatcher(),controller=await acquire(dispatch);let hookError:unknown,recordHashAtRev3='',durableRevoked=false;
 await preserveFailure(x,async()=>{
  const inspect=await invoke(dispatch,'inspect_directory',{workspace_id:'src',path:'.'},controller.token);assertNoDisclosure(inspect,x,[controller.token]);assert.equal(body(inspect).ok,true);
  x.setHook(async()=>{try{const record=await assertRev3(x);recordHashAtRev3=hash(Buffer.from(JSON.stringify(record)));await revokeTrusted('src',x.identity);const durable=await loadTrustedRegistry(x.identity);assert.equal(durable.get('src'),undefined);durableRevoked=true;}catch(error){hookError=error;throw error;}});
  const initial=await invoke(dispatch,'copy_directory',await copyArgs(x.copyId),controller.token);assertNoDisclosure(initial,x,[controller.token]);assert.equal(hookError,undefined);assert.equal(durableRevoked,true);assert.equal(x.hookReached,1);assertInterrupted(initial);
  const before=await recordBytes(x),record=JSON.parse(before.toString('utf8')) as DirectoryCopyRecord;assert.equal(record.revision,3);assert.equal(hash(Buffer.from(JSON.stringify(record))),recordHashAtRev3);
  const denied=async(target:Dispatch)=>{
   assertDenied(await invoke(target,'inspect_directory',{workspace_id:'src',path:'.'},controller.token),'WORKSPACE_GRANT_REVOKED',x,[controller.token]);
   assertDenied(await invoke(target,'get_directory_copy',{copy_id:x.copyId},controller.token),'WORKSPACE_GRANT_REVOKED',x,[controller.token]);
   assertDenied(await invoke(target,'copy_directory',await copyArgs(x.copyId),controller.token),'WORKSPACE_GRANT_REVOKED',x,[controller.token]);
  };
  await denied(dispatch);const fresh=x.buildDispatcher(new DirectoryCopyStore(x.journal));await denied(fresh);
  assert.deepEqual(x.captureEvents,['source','source','destination']);assert.deepEqual(x.calls,['mkdir:dst:copied']);assert.deepEqual(await recordBytes(x),before);
  assert.equal(x.calls.filter(call=>call.startsWith('create:')).length,0);assert.equal(x.calls.some(call=>/rollback|unlink|trash|remove|delete/i.test(call)),false);
  t.diagnostic(JSON.stringify({case:'durable-source-revocation',record_sha256:recordHash(before),revision:record.revision,status:record.status,...eventSummary(x),durableSourceRevoked:durableRevoked}));
 });
});

posixTest('new durable grant revision cannot authorize an old directory intent',async t=>{
 const x=await fixture(t,ids[2]!),dispatch=x.buildDispatcher(),controller=await acquire(dispatch),original=x.registry.requireGrant('dst','write');let hookError:unknown,recordHashAtRev3='',revisionAfter=0;
 await preserveFailure(x,async()=>{
  const inspect=await invoke(dispatch,'inspect_directory',{workspace_id:'src',path:'.'},controller.token);assertNoDisclosure(inspect,x,[controller.token]);assert.equal(body(inspect).ok,true);
  x.setHook(async()=>{try{const record=await assertRev3(x);recordHashAtRev3=hash(Buffer.from(JSON.stringify(record)));await revokeTrusted('dst',x.identity);await enrollRolesTrustedBatch([{id:'dst',root:x.work,role:'workspace'}],x.identity);const durable=await loadTrustedRegistry(x.identity),updated=durable.requireGrant('dst','write');assert.equal(updated.revision,original.revision+2);assert.deepEqual(updated.rootIdentity,original.rootIdentity);assert.equal(updated.canonicalRoot,original.canonicalRoot);assert.equal(updated.role,original.role);assert.deepEqual([...updated.permissions].sort(),[...original.permissions].sort());revisionAfter=updated.revision;}catch(error){hookError=error;throw error;}});
  const initial=await invoke(dispatch,'copy_directory',await copyArgs(x.copyId),controller.token);assertNoDisclosure(initial,x,[controller.token]);assert.equal(hookError,undefined);assert.equal(revisionAfter,original.revision+2);assert.equal(x.hookReached,1);assertInterrupted(initial);
  const before=await recordBytes(x),record=JSON.parse(before.toString('utf8')) as DirectoryCopyRecord;assert.equal(record.revision,3);assert.equal(hash(Buffer.from(JSON.stringify(record))),recordHashAtRev3);
  const denied=async(target:Dispatch)=>{
   assertDenied(await invoke(target,'inspect_directory',{workspace_id:'dst',path:'copied'},controller.token),'WORKSPACE_GRANT_CHANGED',x,[controller.token]);
   assertDenied(await invoke(target,'get_directory_copy',{copy_id:x.copyId},controller.token),'WORKSPACE_GRANT_CHANGED',x,[controller.token]);
   assertDenied(await invoke(target,'copy_directory',await copyArgs(x.copyId),controller.token),'WORKSPACE_GRANT_CHANGED',x,[controller.token]);
  };
  await denied(dispatch);const fresh=x.buildDispatcher(new DirectoryCopyStore(x.journal));await denied(fresh);
  assert.deepEqual(x.captureEvents,['source','source','destination']);assert.deepEqual(x.calls,['mkdir:dst:copied']);assert.deepEqual(await recordBytes(x),before);
  assert.equal(x.calls.filter(call=>call.startsWith('create:')).length,0);assert.equal(x.calls.some(call=>/rollback|unlink|trash|remove|delete/i.test(call)),false);
  t.diagnostic(JSON.stringify({case:'durable-destination-revision',record_sha256:recordHash(before),revision:record.revision,status:record.status,...eventSummary(x),grantRevisionBefore:original.revision,grantRevisionAfter:revisionAfter,sameRootAndPermissions:true}));
 });
});
