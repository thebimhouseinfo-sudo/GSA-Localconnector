import {test as nodeTest} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import {ProcessJournalStore} from '../src/local/process-store.js';
import type {ProcessJournalRecord} from '../src/core/process-journal.js';
import {ControlLeaseStore} from '../src/local/control-lease.js';
import {createReadOnlyTools,toolDefinitions} from '../src/mcp/server.js';

type ProcessPersistence={store:ProcessJournalStore;ownerSession:string};
const test=(name:string,fn:(t:any)=>void|Promise<void>)=>nodeTest(name,{skip:process.platform==='win32'?'POSIX ProcessJournalStore/ControlLease mode semantics; Windows ACL backend unverified':false},fn);
const factory=createReadOnlyTools as unknown as (...args:any[])=>((call:any)=>Promise<any>);
const decode=(value:any)=>JSON.parse(value.content[0].text);
const uuid=()=>randomUUID();

async function fixture(nativeProcesses:any=null){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-mcp-process-history-'));
 await fs.chmod(root,0o700);
 const workA=path.join(root,'work-a'),workB=path.join(root,'work-b'),readOnly=path.join(root,'read-only');
 await Promise.all([workA,workB,readOnly].map(dir=>fs.mkdir(dir,{mode:0o700})));
 const registry=new WorkspaceRegistry();
 await registry.enrollTrusted('A',workA,['read','execute']);
 await registry.enrollTrusted('B',workB,['read','execute']);
 await registry.enrollTrusted('R',readOnly,['read']);
 const store=new ProcessJournalStore(path.join(root,'process-runs'));
 const ownerSession=uuid(),priorOwner=uuid(),terminalId=uuid(),unknownId=uuid();
 const terminal:ProcessJournalRecord={format:'gsa-process-v1',process_id:terminalId,workspace_id:'A',native_id:'old-native-terminal',owner_session:priorOwner,revision:3,
  status:{state:'SUCCEEDED',exit_code:0,started_at:'start-terminal',ended_at:'end-terminal'},stopped:true,stdout:'done π',stderr:'warning',output_complete:true};
 // This fixture models the already-reconciled durable UNKNOWN record. It does not fake
 // owner environment variables or call owner-fence reconciliation itself.
 const unknown:ProcessJournalRecord={format:'gsa-process-v1',process_id:unknownId,workspace_id:'A',native_id:'old-native-active',owner_session:priorOwner,revision:2,
  status:{state:'UNKNOWN',exit_code:null,started_at:'start-active',ended_at:'fenced-end'},stopped:true,stdout:'partial π',stderr:'partial warning',output_complete:false};
 await store.create(terminal);await store.create(unknown);
 const terminalBytes=await fs.readFile(path.join(root,'process-runs',terminalId+'.json'));
 const unknownBytes=await fs.readFile(path.join(root,'process-runs',unknownId+'.json'));
 const controls=new ControlLeaseStore(path.join(root,'controls'));
 const lease=await controls.acquire();
 const persistence:ProcessPersistence={store,ownerSession};
 const invoke=factory(registry,null,null,null,null,null,nativeProcesses,null,null,null,controls,{processPersistence:persistence});
 return {root,registry,store,controls,lease,invoke,terminal,unknown,terminalBytes,unknownBytes,ownerSession};
}

test('MCP lists persisted process history when the current native backend is absent',async t=>{
 const f=await fixture();t.after(async()=>fs.rm(f.root,{recursive:true,force:true}));
 const list=decode(await f.invoke({name:'list_processes',arguments:{workspace_id:'A'}}));
 assert.equal(list.ok,true);assert.deepEqual(new Set(list.result.map((x:any)=>x.process_id)),new Set([f.terminal.process_id,f.unknown.process_id]));
});

test('MCP reads sealed terminal status with no current native backend',async t=>{
 const f=await fixture();t.after(async()=>fs.rm(f.root,{recursive:true,force:true}));
 const terminalStatus=decode(await f.invoke({name:'process_status',arguments:{workspace_id:'A',process_id:f.terminal.process_id}}));
 assert.equal(terminalStatus.ok,true,JSON.stringify(terminalStatus));
 assert.equal(terminalStatus.result.state,'SUCCEEDED');assert.equal(terminalStatus.result.stopped,true);
 assert.deepEqual(await fs.readFile(path.join(f.root,'process-runs',f.terminal.process_id+'.json')),f.terminalBytes,'terminal history must remain byte-for-byte sealed');
});

test('MCP reads sealed terminal output with no current native backend',async t=>{
 const f=await fixture();t.after(async()=>fs.rm(f.root,{recursive:true,force:true}));
 const terminalOutput=decode(await f.invoke({name:'process_output',arguments:{workspace_id:'A',process_id:f.terminal.process_id}}));
 assert.equal(terminalOutput.ok,true,JSON.stringify(terminalOutput));
 assert.equal(terminalOutput.result.stdout,'done π');assert.equal(terminalOutput.result.stderr,'warning');assert.equal(terminalOutput.result.complete,true);
 assert.deepEqual(await fs.readFile(path.join(f.root,'process-runs',f.terminal.process_id+'.json')),f.terminalBytes,'terminal history must remain byte-for-byte sealed');
});

test('MCP reads prior-owner reconciled UNKNOWN status with no current backend',async t=>{
 const f=await fixture();t.after(async()=>fs.rm(f.root,{recursive:true,force:true}));
 const unknownStatus=decode(await f.invoke({name:'process_status',arguments:{workspace_id:'A',process_id:f.unknown.process_id}}));
 assert.equal(unknownStatus.ok,true,JSON.stringify(unknownStatus));
 assert.equal(unknownStatus.result.state,'UNKNOWN');assert.equal(unknownStatus.result.stopped,true);
 assert.deepEqual(await fs.readFile(path.join(f.root,'process-runs',f.unknown.process_id+'.json')),f.unknownBytes,'historical UNKNOWN state must not be rewritten by reads');
});

test('MCP returns partial output for prior-owner reconciled UNKNOWN records with no current backend',async t=>{
 const f=await fixture();t.after(async()=>fs.rm(f.root,{recursive:true,force:true}));
 const unknownOutput=decode(await f.invoke({name:'process_output',arguments:{workspace_id:'A',process_id:f.unknown.process_id}}));
 assert.equal(unknownOutput.ok,true,JSON.stringify(unknownOutput));
 assert.equal(unknownOutput.result.stdout,'partial π');assert.equal(unknownOutput.result.stderr,'partial warning');assert.equal(unknownOutput.result.complete,false);
 assert.deepEqual(await fs.readFile(path.join(f.root,'process-runs',f.unknown.process_id+'.json')),f.unknownBytes,'historical UNKNOWN state must not be rewritten by reads');
});

test('history capability is separate from execution and advertises persisted process and command history',async t=>{
 const f=await fixture();t.after(async()=>fs.rm(f.root,{recursive:true,force:true}));
 const capabilities=decode(await f.invoke({name:'list_capabilities',arguments:{}})).result;
 assert.equal(capabilities.processHistory,'persisted-start_process-and-run_command');
 assert.equal(capabilities.processHistoryLimit,1000);assert.equal(capabilities.processJournalLimit,10000);
 assert.ok(capabilities.read.includes('list_processes'));
 assert.ok(capabilities.read.includes('process_status'));
 assert.ok(capabilities.read.includes('process_output'));
 for(const name of ['run_command','start_process','stop_process','list_processes','process_status','process_output'])assert.ok(!capabilities.execution.includes(name),`${name} must not be advertised as executable without a native backend`);
 assert.ok(capabilities.blocked.includes('start_process'));assert.ok(capabilities.blocked.includes('stop_process'));
 assert.notEqual(capabilities.restartRecovery,'ci-journal-reconciled; async-process-journal-reconciled; native-tree-recovery-not-certified','direct history availability must not claim owner-fence reconciliation');
});

test('persisted dispatcher waits for process journal hydration before answering capabilities',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-process-history-delayed-'));await fs.chmod(root,0o700);
 t.after(async()=>fs.rm(root,{recursive:true,force:true}));
 const registry=new WorkspaceRegistry(),ownerSession=uuid();
 let markStarted!:()=>void,finish!: (records:ProcessJournalRecord[])=>void;
 const started=new Promise<void>(resolve=>{markStarted=resolve;});
 const delayedStore={list:()=>{markStarted();return new Promise<ProcessJournalRecord[]>(resolve=>{finish=resolve;});},load:async()=>null,create:async()=>{},save:async()=>{}};
 const invoke=factory(registry,null,null,null,null,null,null,null,null,null,null,{processPersistence:{store:delayedStore,ownerSession}});
 const response=invoke({name:'list_capabilities',arguments:{}});
 await started;
 let answered=false;void response.then(()=>{answered=true;});
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(answered,false,'capability response cannot race the initial history read');
 finish([]);
 const capabilities=decode(await response).result;
 assert.equal(capabilities.processHistory,'persisted-start_process-and-run_command');
});

test('unsafe process journal blocks MCP responses instead of being ignored',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-process-history-corrupt-'));await fs.chmod(root,0o700);
 t.after(async()=>fs.rm(root,{recursive:true,force:true}));
 const records=path.join(root,'process-runs');await fs.mkdir(records,{mode:0o700});
 await fs.writeFile(path.join(records,uuid()+'.json'),'{}\n', {mode:0o600});
 const store=new ProcessJournalStore(records),registry=new WorkspaceRegistry();
 const invoke=factory(registry,null,null,null,null,null,null,null,null,null,null,{processPersistence:{store,ownerSession:uuid()}});
 const response=await invoke({name:'list_capabilities',arguments:{}});
 assert.equal(response.isError,true,'failed journal initialization must not be swallowed');
 assert.equal(decode(response).code,'PROCESS_JOURNAL_UNSAFE');
});

test('old unfinished owner entry outside the 1000-record page stays UNKNOWN and cannot query or stop its old native ID',async t=>{
 const calls:string[]=[];
 const native={verified:true,platform:'macos',policy_fingerprint:'unit-routing-only',
  start:async()=>{throw Error('history must never start a process');},
  status:async(id:string)=>{calls.push('status:'+id);throw Error('must not query old native identity');},
  output:async(id:string)=>{calls.push('output:'+id);throw Error('must not query old native identity');},
  stop:async(id:string)=>{calls.push('stop:'+id);throw Error('must not stop old native identity');}};
 const f=await fixture(native);t.after(async()=>fs.rm(f.root,{recursive:true,force:true}));
 const oldId=uuid(),oldNative='old-native-outside-page';
 const oldRecord:ProcessJournalRecord={format:'gsa-process-v1',process_id:oldId,workspace_id:'A',native_id:oldNative,owner_session:uuid(),revision:1,
  status:{state:'RUNNING',exit_code:null,started_at:'old-start',ended_at:null},stopped:false,stdout:'partial π',stderr:'partial warning',output_complete:false};
 await f.store.create(oldRecord);
 const oldFile=path.join(f.root,'process-runs',oldId+'.json');await fs.utimes(oldFile,new Date(0),new Date(0));
 for(let i=0;i<998;i++){
  const id=uuid();
  await f.store.create({format:'gsa-process-v1',process_id:id,workspace_id:'A',native_id:'terminal-'+i,owner_session:f.ownerSession,revision:1,
   status:{state:'SUCCEEDED',exit_code:0,started_at:'start-'+i,ended_at:'end-'+i},stopped:true,stdout:'',stderr:'',output_complete:true});
 }
 const page=await f.store.list();assert.equal(page.length,1000);assert.ok(!page.some(record=>record.process_id===oldId),'fixture must place the unfinished record beyond startup hydration');
 const status=decode(await f.invoke({name:'process_status',arguments:{workspace_id:'A',process_id:oldId}}));
 assert.equal(status.ok,true,JSON.stringify(status));assert.equal(status.result.state,'UNKNOWN');assert.equal(status.result.stopped,false);assert.equal(status.result.ended_at,null);
 const output=decode(await f.invoke({name:'process_output',arguments:{workspace_id:'A',process_id:oldId}}));
 assert.equal(output.ok,true,JSON.stringify(output));assert.equal(output.result.stdout,'partial π');assert.equal(output.result.stderr,'partial warning');assert.equal(output.result.complete,false);
 const stop=decode(await f.invoke({name:'stop_process',arguments:{workspace_id:'A',process_id:oldId,control_token:f.lease.control_token}}));
 assert.equal(stop.ok,false);assert.equal(stop.code,'PROCESS_NOT_FOUND');assert.deepEqual(calls,[],'no status/output/stop request may use the old native ID');
 assert.deepEqual(await f.store.load(oldId),oldRecord,'an unverified old active identity must not be rewritten or inferred terminated');
});

test('execute grants and current control remain required; cross-workspace history and old native IDs cannot be controlled',async t=>{
 const f=await fixture();t.after(async()=>fs.rm(f.root,{recursive:true,force:true}));
 for(const name of ['process_status','process_output']){
  const args={workspace_id:'B',process_id:f.terminal.process_id};
  assert.equal((await f.invoke({name,arguments:args})).isError,true,'another granted workspace cannot read this process');
  const ungranted={...args,workspace_id:'R'};
  assert.equal((await f.invoke({name,arguments:ungranted})).isError,true,'read-only grant cannot access process history');
 }
 assert.equal((await f.invoke({name:'list_processes',arguments:{workspace_id:'R'}})).isError,true,'listing process history requires execute permission');
 for(const name of ['start_process','stop_process']){
  const args=name==='start_process'?{workspace_id:'A',command:'must-not-run',args:[]}:{workspace_id:'A',process_id:f.terminal.process_id};
  assert.equal(decode(await f.invoke({name,arguments:args})).code,'SESSION_INVALID','control token is required before process control');
  const controlled={...args,control_token:f.lease.control_token};
  const denied=decode(await f.invoke({name,arguments:controlled}));
  assert.equal(denied.code,'SECURITY_BLOCKED','missing current backend must keep start and stop blocked');
 }
 for(const name of ['start_process','stop_process']){
  const definition=toolDefinitions().find((entry:any)=>entry.name===name)!;
  assert.ok(definition.inputSchema.required.includes('control_token'));
 }
 assert.deepEqual(await fs.readFile(path.join(f.root,'process-runs',f.terminal.process_id+'.json')),f.terminalBytes);
 assert.deepEqual(await fs.readFile(path.join(f.root,'process-runs',f.unknown.process_id+'.json')),f.unknownBytes);
});
