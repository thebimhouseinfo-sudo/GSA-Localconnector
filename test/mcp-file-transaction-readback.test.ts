import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test,type TestContext} from 'node:test';
import {createReadOnlyTools,toolDefinitions} from '../src/mcp/server.js';
import {controlledToolNames} from '../src/mcp/catalog.js';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import {ControlLeaseStore} from '../src/local/control-lease.js';
import {requireCurrentControl} from '../src/mcp/control-context.js';
import {type NativeScopedFiles} from '../src/core/native-io.js';
import {newFileTransaction,fileTransactionOutcome,type FileTransactionOutcome} from '../src/core/file-transactions.js';
import {FileTransactionStore} from '../src/local/file-transaction-store.js';
import {createMacFileRecovery} from '../src/hosts/macos-file-recovery.js';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const pending=newFileTransaction(id,{operation:'trash',source:{workspace_id:'work',path:'a.txt',revision:1,rootIdentity:{device:'1',inode:'2'}},destination:null,expected_sha256:'a'.repeat(64),after_sha256:null});
function outcome(status:FileTransactionOutcome['status']):FileTransactionOutcome{return fileTransactionOutcome({...pending,status,reason:status==='APPLIED'?'VERIFIED_READBACK':status==='CONFLICT'?'HASH_CONFLICT':'IO_UNCERTAIN',observations:{...pending.observations,captured:true,capturedIdentity:{device:'1',inode:'3'},source_absent:status==='APPLIED'?true:null},retained_handles:[other]});}
const decode=(r:{content:{text:string}[]})=>JSON.parse(r.content[0]!.text);
const posixTest=(name:string,fn:(t:TestContext)=>void|Promise<void>)=>test(name,{skip:process.platform==='win32'?'POSIX protected controller/store fixture; Windows ACL backend unverified':false},fn);
async function fixture(t:TestContext){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-mcp-readback-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let now=1000;const controls=new ControlLeaseStore(path.join(root,'control'),1000,()=>now);const token=(await controls.acquire()).control_token;
 const registry=new WorkspaceRegistry();const calls:string[]=[];
 const recovery={async replaceIfHash(){throw Error('mutation forbidden');},async trashIfHash(){throw Error('mutation forbidden');},async readTransaction(value:string){assert.equal(this,recovery);await requireCurrentControl();calls.push(value);return outcome('UNKNOWN');}};
 const forbidden=async()=>{throw Error('legacy mutation forbidden');};
 const files={supportedOperations:[],recoverableMutations:recovery,read:forbidden,createExclusive:forbidden,replaceIfHash:forbidden,makeDirectory:forbidden,copyExclusive:forbidden,moveExclusive:forbidden,trashIfHash:forbidden} as NativeScopedFiles;
 const make=(backend:NativeScopedFiles|null=files,store:ControlLeaseStore|null=controls)=>createReadOnlyTools(registry,backend,null,null,null,null,null,null,null,null,store);
 return {root,registry,controls,token,calls,recovery,files,make,expire:()=>{now=3000;},call:(args:Record<string,unknown>={transaction_id:id})=>make()({name:'get_file_transaction',arguments:{control_token:token,...args}})};
}
test('catalog exposes only controlled UUID inspection schema',()=>{
 const tool=toolDefinitions().find(t=>t.name==='get_file_transaction');assert(tool);assert(controlledToolNames.has(tool.name));assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(),['control_token','transaction_id']);assert.deepEqual([...tool.inputSchema.required].sort(),['control_token','transaction_id']);assert.equal(tool.inputSchema.additionalProperties,false);assert.equal((tool.inputSchema.properties as any).transaction_id.pattern,'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
});
posixTest('runtime rejects malformed IDs and every extra scope input',async t=>{const f=await fixture(t);for(const args of [{},{transaction_id:1},{transaction_id:'bad'},{transaction_id:id,workspace_id:'work'},{transaction_id:id,path:'a'},{transaction_id:id,root:'/tmp'},{transaction_id:id,recovery_root:'/tmp'}])assert.equal(decode(await f.call(args)).code,'INVALID_ARGUMENTS');assert.equal(f.calls.length,0);});
posixTest('capabilities enable readback separately from native writes',async t=>{const f=await fixture(t);for(const [backend,store,available] of [[f.files,f.controls,true],[null,f.controls,false],[{...f.files,recoverableMutations:{replaceIfHash:f.recovery.replaceIfHash,trashIfHash:f.recovery.trashIfHash}},f.controls,false],[f.files,null,false]] as const){const invoke=f.make(backend,store);const cap=decode(await invoke({name:'list_capabilities'})).result;assert.equal(cap.fileTransactionReadbackAvailable,available);assert.equal(cap.read.includes('get_file_transaction'),available);assert.equal(cap.blocked.includes('get_file_transaction'),!available);assert.equal(cap.hostFileWrites,false);assert.equal(decode(await invoke({name:'connector_status'})).result.fileTransactionReadbackAvailable,available);if(!available)assert.equal(decode(await invoke({name:'get_file_transaction',arguments:{transaction_id:id,...(store?{control_token:f.token}:{})}})).code,'SECURITY_BLOCKED');}assert.equal(f.calls.length,0);});
test('protected storage unavailable blocks truthful discovery and dispatch',async()=>{
 const original=process.getuid;let inspections=0;const token='test-controller-token';
 const controls={async require(value:string){assert.equal(value,token);return {session_id:'test-session',expires_at:2000,revision:1};}} as unknown as ControlLeaseStore;
 const forbidden=async()=>{throw Error('protected backend must not perform file IO');};
 const recovery={async replaceIfHash(){throw Error('protected backend must not mutate');},async trashIfHash(){throw Error('protected backend must not mutate');},async readTransaction(){inspections++;throw Error('protected backend must not inspect');}};
 const files:NativeScopedFiles={supportedOperations:[],recoverableMutations:recovery,read:forbidden,createExclusive:forbidden,replaceIfHash:forbidden,makeDirectory:forbidden,copyExclusive:forbidden,moveExclusive:forbidden,trashIfHash:forbidden};
 try{process.getuid=undefined as any;
  const invoke=createReadOnlyTools(new WorkspaceRegistry(),files,null,null,null,null,null,null,null,null,controls);
  const cap=decode(await invoke({name:'list_capabilities'})).result;assert.equal(cap.fileTransactionReadbackAvailable,false);assert(!cap.read.includes('get_file_transaction'));assert(cap.blocked.includes('get_file_transaction'));
  const result=await invoke({name:'get_file_transaction',arguments:{transaction_id:id,control_token:token}});assert.equal(decode(result).code,'SECURITY_BLOCKED');assert.equal(inspections,0);
 }finally{process.getuid=original;}
});
posixTest('missing wrong and expired controller tokens cannot inspect',async t=>{const f=await fixture(t);for(const args of [{transaction_id:id},{transaction_id:id,control_token:'wrong'}])assert.equal(decode(await f.make()({name:'get_file_transaction',arguments:args})).ok,false);f.expire();assert.equal(decode(await f.call()).ok,false);assert.equal(f.calls.length,0);});
for(const status of ['APPLIED','CONFLICT','UNKNOWN'] as const)posixTest(`${status} preserves full outcome and owning receiver without mutation`,async t=>{const f=await fixture(t);const value=outcome(status);f.recovery.readTransaction=async function(valueId){assert.equal(this,f.recovery);await requireCurrentControl();f.calls.push(valueId);return value;};const result=await f.call();const body=decode(result);assert.deepEqual(body.result,value);assert.equal(body.ok,status==='APPLIED');assert.equal(!!result.isError,status!=='APPLIED');if(status!=='APPLIED')assert.equal(body.code,status==='UNKNOWN'?'RESULT_UNKNOWN':'FILE_TRANSACTION_CONFLICT');assert.deepEqual(f.calls,[id]);});
posixTest('backend errors and unauthorized inspection disclose no invented metadata',async t=>{const f=await fixture(t);for(const code of ['FILE_TRANSACTION_NOT_FOUND','STORE_UNAVAILABLE','SESSION_INVALID']){f.recovery.readTransaction=async()=>{throw Object.assign(Error('denied'),{code});};const body=decode(await f.call());assert.equal(body.code,code);assert.equal(body.result,undefined);}});
posixTest('mismatched ID and invalid result shape never disclose backend metadata',async t=>{const f=await fixture(t);for(const value of [{...outcome('UNKNOWN'),transaction_id:other},{...outcome('UNKNOWN'),status:'PENDING'},{...outcome('UNKNOWN'),extra:'private'},{...outcome('UNKNOWN'),revision:99},{...outcome('APPLIED'),observations:{}}]){f.recovery.readTransaction=async()=>value as any;const body=decode(await f.call());assert.equal(body.ok,false);assert.equal(body.result,undefined);}});
posixTest('actual adapter reports missing journal IDs without native inspect or invented metadata',async t=>{
 const f=await fixture(t);const journal=path.join(f.root,'missing-journal');await fs.mkdir(journal,{mode:0o700});
 let authorizations=0,inspections=0;const store=new FileTransactionStore(journal);
 const adapter=createMacFileRecovery({registry:f.registry,store,authorize:async()=>{authorizations++;},invoke:async()=>{inspections++;throw Error('missing transaction must not inspect');}});
 const invoke=f.make({...f.files,recoverableMutations:adapter});const result=await invoke({name:'get_file_transaction',arguments:{control_token:f.token,transaction_id:id}});const body=decode(result);
 assert.equal(result.isError,true);assert.equal(body.code,'FILE_TRANSACTION_NOT_FOUND');assert.equal(body.result,undefined);assert.equal(authorizations,0);assert.equal(inspections,0);
});
posixTest('accepted adapter uses journal workspace and stale binding prevents native inspect',async t=>{
 const f=await fixture(t);const work=path.join(f.root,'work');await fs.mkdir(work);await f.registry.enrollRolesTrusted([{id:'work',root:work,role:'workspace'}]);const grant=f.registry.get('work')!;
 const store=new FileTransactionStore(path.join(f.root,'journal'));await store.create(id,{...pending.intent,source:{...pending.intent.source,rootIdentity:grant.rootIdentity,revision:grant.revision}});
 const authorized:string[]=[];let inspections=0;
 const adapter=createMacFileRecovery({registry:f.registry,store,authorize:async workspace=>{await requireCurrentControl();authorized.push(workspace);},invoke:async(ref,q)=>{inspections++;assert.deepEqual(ref,{workspace_id:'work',path:'a.txt'});assert.deepEqual(q,{protocol:'gsa-file-recovery-v1',operation:'inspect',transaction_id:id});throw Error('disposable transport unavailable');}});
 const invoke=f.make({...f.files,recoverableMutations:adapter});const call=()=>invoke({name:'get_file_transaction',arguments:{control_token:f.token,transaction_id:id}});const first=decode(await call());assert.equal(first.code,'RESULT_UNKNOWN');assert.equal(first.result.transaction_id,id);assert.deepEqual(authorized,['work']);assert.equal(inspections,1);
 f.registry.revoke('work');const stale=decode(await call());assert.equal(stale.code,'RESULT_UNKNOWN');assert.equal(stale.result.reason,'AUTHORIZATION_CHANGED');assert.equal(inspections,1);
});
