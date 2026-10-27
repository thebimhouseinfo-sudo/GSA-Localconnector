import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import {ProcessJournalStore} from '../src/local/process-store.js';
import {ProcessAdmission,ProcessManager,observeProcessStop,type WorkspaceProcessStop} from '../src/core/process-manager.js';
import {enrollRolesTrustedBatch} from '../src/local/grants.js';
import {createReadOnlyTools} from '../src/mcp/server.js';

const decode=(r:any)=>JSON.parse(r.content[0].text);
const receipt={exit_code:0,signal:null,stdout:'captured output',stderr:'',cancelled:false,timed_out:false,artifacts:[]};
const factory=createReadOnlyTools as unknown as (...args:any[])=>((call:any)=>Promise<any>);

async function cleanup(root:string,store:ProcessJournalStore):Promise<void>{
 let previous='',stable=0;
 for(let attempt=0;attempt<50&&stable<3;attempt++){
  await new Promise(resolve=>setTimeout(resolve,10));
  const rows=await store.list().catch(()=>[]);
  const current=JSON.stringify(rows.map(row=>[row.process_id,row.revision,row.status.state,row.stopped,row.output_complete]).sort());
  stable=current===previous?stable+1:0;previous=current;
 }
 // Let any journal continuation scheduled by the final read finish before removal.
 await new Promise<void>(resolve=>setImmediate(resolve));
 await fs.rm(root,{recursive:true,force:true});
}

async function fixture(t:any,controller:any=null,beforeDispatcher?:(store:ProcessJournalStore,A:string,B:string)=>Promise<void>,customAId?:string){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-process-revocation-'));
 await fs.chmod(root,0o700);
 const a=path.join(root,'a'),b=path.join(root,'b');
 await Promise.all([a,b].map(p=>fs.mkdir(p,{mode:0o700})));
 const registry=new WorkspaceRegistry(),store=new ProcessJournalStore(path.join(root,'runs'));
 t.after(()=>cleanup(root,store));
 const persistence={store,ownerSession:randomUUID()};
 let execute:(request:any)=>Promise<any>=async()=>receipt;
 const cancelled:string[]=[];
 const sandbox:any={verified:true,platform:'macos',policy_fingerprint:'fake-only',
  execute:(request:any)=>execute(request),
  cancel:async(id:string,workspace:string)=>{cancelled.push(`${workspace}:${id}`);return true;}};
 const identity=path.join(root,'identity');
 if(customAId)await enrollRolesTrustedBatch([{id:customAId,root:a,role:'workspace'}],identity);
 const bind=factory(registry,null,sandbox,null,null,null,null,null,null,null,null,{grantDirectory:identity});
 const bindCall=async(name:string,args:Record<string,unknown>={})=>decode(await bind({name,arguments:args}));
 const bound=await bindCall('bind_workspaces',{roots:[{path:a,role:'workspace'},{path:b,role:'workspace'}]});
 assert.equal(bound.ok,true,JSON.stringify(bound));
 const A=bound.result[0].workspace_id;
 const B=bound.result[1].workspace_id;
 await beforeDispatcher?.(store,A,B);
 const invoke=factory(registry,null,sandbox,null,null,null,controller,null,null,null,null,{grantDirectory:identity,processPersistence:persistence});
 const call=async(name:string,args:Record<string,unknown>={})=>decode(await invoke({name,arguments:args}));
 return {root,rootA:a,registry,store,persistence,sandbox,cancelled,call,setExecute:(fn:(request:any)=>Promise<any>)=>execute=fn,A,B};
}

test('unbind fences a command reserved in the journal before backend execution',async t=>{
 const f=await fixture(t);
 let release!:()=>void,entered!:()=>void,executions=0;
 const creating=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
 const create=f.store.create.bind(f.store);
 f.store.create=async record=>{entered();await gate;return create(record);};
 f.setExecute(async()=>{executions++;return receipt;});
 const starting=f.call('start_process',{workspace_id:f.A,command:'/fake/tool',args:[]});
 await creating;
 const unbinding=f.call('unbind_workspace',{workspace_id:f.A});
 // Let revoke start while the journal reservation is pending, then release it.
 setTimeout(release,10);
 const revoked=await unbinding;
 await starting;
 assert.equal(revoked.ok,true,JSON.stringify(revoked));
 assert.equal(revoked.result.revoked,true);
 assert.equal(executions,0,'a fenced reservation must never reach sandbox.execute');
 assert.deepEqual(revoked.result.managed_processes.state,'STOPPED');
});

test('unbind requests cancellation of a running command but reports ACK as unconfirmed',async t=>{
 const f=await fixture(t);
 let finish!:(value:any)=>void,entered!:()=>void;
 const running=new Promise<void>(resolve=>entered=resolve);
 f.setExecute(()=>{entered();return new Promise(resolve=>finish=resolve);});
 const started=await f.call('start_process',{workspace_id:f.A,command:'/fake/tool',args:[]});
 assert.equal(started.ok,true,JSON.stringify(started));
 await running;
 const stopped=await f.call('unbind_workspace',{workspace_id:f.A});
 assert.equal(stopped.ok,true,JSON.stringify(stopped));
 assert.equal(stopped.result.managed_processes.state,'UNKNOWN');
 assert.equal(stopped.result.managed_processes.outcomes.length,1);
 assert.equal(stopped.result.managed_processes.outcomes[0].process_id,started.result.process_id);
 assert.equal(stopped.result.managed_processes.outcomes[0].stopped,false);
 assert.deepEqual(f.cancelled,[`${f.A}:${started.result.process_id}`]);
 finish(receipt);
});

test('unbind isolates the selected workspace and keeps other workspace work controllable',async t=>{
 const f=await fixture(t);
 const pending=new Map<string,(value:any)=>void>();
 f.setExecute((request:any)=>new Promise(resolve=>pending.set(request.workspace_id,resolve)));
 const a=await f.call('start_process',{workspace_id:f.A,command:'/fake/tool',args:[]});
 const b=await f.call('start_process',{workspace_id:f.B,command:'/fake/tool',args:[]});
 assert.equal(a.ok,true);assert.equal(b.ok,true);
 const result=await f.call('unbind_workspace',{workspace_id:f.A});
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.deepEqual(f.cancelled.map(x=>x.split(':')[0]),[f.A]);
 assert.equal((await f.call('process_status',{workspace_id:f.B,process_id:b.result.process_id})).ok,true);
 assert.equal((await f.call('stop_process',{workspace_id:f.A,process_id:a.result.process_id})).ok,false,
  'public stop authorization remains revoked after internal unbind cancellation');
 pending.get(f.A)!(receipt);pending.get(f.B)!(receipt);
});

test('late native start acknowledgement is stopped once by its captured identity and never replayed',async t=>{
 let acknowledge!:(value:any)=>void,entered!:()=>void,starts=0;
 const waiting=new Promise<void>(resolve=>entered=resolve),stopIds:string[]=[];
 const controller:any={verified:true,platform:'macos',policy_fingerprint:'fake-only',
  start:async()=>{starts++;entered();return new Promise(resolve=>acknowledge=resolve);},
  stop:async(id:string)=>{stopIds.push(id);return {stopped:true,state:'CANCELLED'};},
  status:async()=>({state:'CANCELLED',exit_code:null,started_at:'start',ended_at:'end',stopped:true}),
  output:async()=>({stdout:'',stderr:'',next_cursor:null})};
 const f=await fixture(t,controller);
 const starting=f.call('start_process',{workspace_id:f.A,command:'/fake/native',args:[]});
 await waiting;
 const revoking=f.call('unbind_workspace',{workspace_id:f.A});
 setTimeout(()=>acknowledge({native_id:'native-owned-once'}),10);
 const revoked=await revoking,started=await starting;
 assert.equal(revoked.ok,true,JSON.stringify(revoked));
 assert.equal(starts,1,'revocation must never replay native.start');
 assert.deepEqual(stopIds,['native-owned-once'],'late acknowledgement must be stopped once using its captured native ID');
 assert.equal(started.ok,false,'a post-fence native acknowledgement must not be returned as usable authority');
});

test('unbind never queries or stops a previous-owner historical native identity',async t=>{
 const processId=randomUUID(),owner=randomUUID(),calls:string[]=[];
 const historical={format:'gsa-process-v1',process_id:processId,workspace_id:'',native_id:'prior-owner-native-id',owner_session:owner,revision:1,
  status:{state:'UNKNOWN',exit_code:null,started_at:'historical',ended_at:null},stopped:false,stdout:'saved bytes',stderr:'',output_complete:false};
 const controller:any={verified:true,platform:'macos',policy_fingerprint:'fake-only',
  start:async()=>{throw Error('historical identity must not start');},
  stop:async(id:string)=>{calls.push(`stop:${id}`);return {stopped:true,state:'CANCELLED'};},
  status:async(id:string)=>{calls.push(`status:${id}`);return {state:'RUNNING',exit_code:null,started_at:'start',ended_at:null};},
  output:async(id:string)=>{calls.push(`output:${id}`);return {stdout:'',stderr:'',next_cursor:null};}};
 const f=await fixture(t,controller,async(store,A)=>{
  historical.workspace_id=A;
  await store.create(historical as any);
 });
 const before=await fs.readFile(path.join(f.root,'runs',processId+'.json'));
 const revoked=await f.call('unbind_workspace',{workspace_id:f.A});
 assert.equal(revoked.ok,true,JSON.stringify(revoked));
 assert.deepEqual(calls,[],'prior-owner native IDs are read-only evidence');
 assert.deepEqual(await fs.readFile(path.join(f.root,'runs',processId+'.json')),before,'historical bytes remain unchanged');
});

test('rebinding the same workspace ID cannot reopen command admission with an unconfirmed old command',async t=>{
 const f=await fixture(t);
 let finish!:(value:any)=>void,entered!:()=>void,executions=0;
 const running=new Promise<void>(resolve=>entered=resolve);
 f.setExecute(()=>{executions++;entered();return new Promise(resolve=>finish=resolve);});
 const first=await f.call('start_process',{workspace_id:f.A,command:'/fake/tool',args:[]});
 assert.equal(first.ok,true);await running;
 const revoked=await f.call('unbind_workspace',{workspace_id:f.A});
 assert.equal(revoked.ok,true,JSON.stringify(revoked));
 const rebound=await f.call('bind_workspaces',{roots:[{path:path.join(f.root,'a'),role:'workspace'}]});
 const second=await f.call('start_process',{workspace_id:f.A,command:'/fake/tool',args:[]});
 assert.equal(rebound.ok===false||second.ok===false,true,'rebind or start must report the unresolved old process');
 assert.equal(executions,1,'a fresh grant must not admit work while the old entry remains unconfirmed');
 finish(receipt);
});

test('a cancellation error preserves durable revocation and reports unknown process outcome',async t=>{
 const f=await fixture(t);
 let finish!:(value:any)=>void,entered!:()=>void;
 const running=new Promise<void>(resolve=>entered=resolve);
 f.setExecute(()=>{entered();return new Promise(resolve=>finish=resolve);});
 const started=await f.call('start_process',{workspace_id:f.A,command:'/fake/tool',args:[]});
 await running;
 f.sandbox.cancel=async()=>{throw Error('fake cancel transport failure');};
 const revoked=await f.call('unbind_workspace',{workspace_id:f.A});
 assert.equal(revoked.ok,true,JSON.stringify(revoked));
 assert.equal(revoked.result.revoked,true,'durable revocation survives cancellation failure');
 assert.equal(revoked.result.managed_processes.state,'UNKNOWN');
 assert.equal(revoked.result.managed_processes.outcomes[0].stopped,false);
 const record=await f.store.load(started.result.process_id);
 assert.equal(record?.stopped,false);assert.equal(record?.output_complete,false);
 finish(receipt);
});

test('a native stop error keeps the journal entry unconfirmed after durable unbind',async t=>{
 const stopIds:string[]=[];
 const controller:any={verified:true,platform:'macos',policy_fingerprint:'fake-only',
  start:async()=>({native_id:'native-stop-error'}),
  stop:async(id:string)=>{stopIds.push(id);throw Error('fake native stop failure');},
  status:async()=>({state:'RUNNING',exit_code:null,started_at:'start',ended_at:null}),
  output:async()=>({stdout:'',stderr:'',next_cursor:null})};
 const f=await fixture(t,controller);
 const started=await f.call('start_process',{workspace_id:f.A,command:'/fake/native',args:[]});
 assert.equal(started.ok,true,JSON.stringify(started));
 const revoked=await f.call('unbind_workspace',{workspace_id:f.A});
 assert.equal(revoked.ok,true,JSON.stringify(revoked));
 assert.deepEqual(stopIds,['native-stop-error']);
 assert.equal(revoked.result.managed_processes.state,'UNKNOWN');
 assert.equal(revoked.result.managed_processes.outcomes[0].stopped,false);
 const record=await f.store.load(started.result.process_id);
 assert.equal(record?.stopped,false);assert.equal(record?.output_complete,false);
});

test('custom-ID revocation still fences the same physical root after rebind assigns a new ID',async t=>{
 const f=await fixture(t,undefined,undefined,'custom-stable-workspace');
 assert.equal(f.A,'custom-stable-workspace');
 let finish!:(value:any)=>void,entered!:()=>void,executions=0;
 const running=new Promise<void>(resolve=>entered=resolve);
 f.setExecute(()=>{executions++;entered();return new Promise(resolve=>finish=resolve);});
 const first=await f.call('start_process',{workspace_id:f.A,command:'/fake/tool',args:[]});
 assert.equal(first.ok,true);await running;
 const revoked=await f.call('unbind_workspace',{workspace_id:f.A});
 assert.equal(revoked.ok,true,JSON.stringify(revoked));
 const rebound=await f.call('bind_workspaces',{roots:[{path:f.rootA,role:'workspace'}]});
 assert.equal(rebound.ok,true,JSON.stringify(rebound));
 const replacementId=rebound.result[0].workspace_id;
 assert.notEqual(replacementId,f.A,'the protected store no longer lists the revoked custom ID');
 const second=await f.call('start_process',{workspace_id:replacementId,command:'/fake/tool',args:[]});
 assert.equal(second.ok,false,'the unresolved root fence must survive an ID change');
 assert.equal(executions,1,'new identity for the same physical root must not reach sandbox.execute');
 finish(receipt);
});

test('native start rejection after a possible effect remains UNKNOWN and cannot be resumed',async t=>{
 let rejectStart!:(error:Error)=>void,entered!:()=>void,starts=0;
 const startingNative=new Promise<void>(resolve=>entered=resolve);
 const controller:any={verified:true,platform:'macos',policy_fingerprint:'fake-only',
  start:async()=>{starts++;entered();return new Promise((_resolve,reject)=>rejectStart=reject);},
  stop:async()=>{throw Error('no native ID was acknowledged');},
  status:async()=>{throw Error('no native ID was acknowledged');},
  output:async()=>{throw Error('no native ID was acknowledged');}};
 const f=await fixture(t,controller,undefined,'custom-uncertain-workspace');
 const first=f.call('start_process',{workspace_id:f.A,command:'/fake/native',args:[]});
 await startingNative;
 const revoking=f.call('unbind_workspace',{workspace_id:f.A});
 setTimeout(()=>rejectStart(Error('transport lost after possible spawn')),10);
 const revoked=await revoking;
 await first;
 assert.equal(revoked.ok,true,JSON.stringify(revoked));
 const [record]=await f.store.list();
 assert.ok(record,'uncertain native start keeps its durable reservation');
 assert.equal(record.status.state,'UNKNOWN');
 assert.equal(record.stopped,false,'a rejected start does not prove that no native effect occurred');
 assert.equal(record.output_complete,false);
 const rebound=await f.call('bind_workspaces',{roots:[{path:f.rootA,role:'workspace'}]});
 const replacementId=rebound.result?.[0]?.workspace_id;
 assert.equal(typeof replacementId,'string');
 await f.call('start_process',{workspace_id:replacementId,command:'/fake/native',args:[]});
 assert.equal(starts,1,'same-root rebind cannot resume admission after an uncertain start');
});

test('failed revoke publication leaves command admission fenced',async t=>{
 const f=await fixture(t);
 let executions=0;f.setExecute(async()=>{executions++;return receipt;});
 const lock=path.join(f.root,'identity','.trusted-workspaces.lock');
 await fs.writeFile(lock,'held',{mode:0o600});
 const failed=await f.call('unbind_workspace',{workspace_id:f.A});
 assert.equal(failed.ok,false,'the test lock prevents grant publication');
 await fs.unlink(lock);
 const afterFailure=await f.call('start_process',{workspace_id:f.A,command:'/fake/tool',args:[]});
 assert.equal(afterFailure.ok,false,'publication failure must retain the synchronous admission fence');
 assert.equal(executions,0);
});

test('repeated confirmed unbind retries observation without replaying start',async t=>{
 const f=await fixture(t);
 let finish!:(value:any)=>void,entered!:()=>void,executions=0;
 const running=new Promise<void>(resolve=>entered=resolve);
 f.setExecute(()=>{executions++;entered();return new Promise(resolve=>finish=resolve);});
 const started=await f.call('start_process',{workspace_id:f.A,command:'/fake/tool',args:[]});
 assert.equal(started.ok,true);await running;
 const first=await f.call('unbind_workspace',{workspace_id:f.A});
 const second=await f.call('unbind_workspace',{workspace_id:f.A});
 assert.equal(first.ok,true,JSON.stringify(first));
 assert.equal(second.ok,true,'a confirmed revoke continuation can repeat stop observation');
 assert.equal(second.result.revoked,true);
 assert.equal(executions,1,'repeated unbind may observe/cancel owned work but never restart it');
 finish(receipt);
});

test('confirmed completion permits a later explicit rebind and new start',async t=>{
 const f=await fixture(t);
 let executions=0;f.setExecute(async()=>{executions++;return receipt;});
 const first=await f.call('start_process',{workspace_id:f.A,command:'/fake/tool',args:[]});
 assert.equal(first.ok,true);
 let status:any;
 for(let i=0;i<50;i++){
  status=await f.call('process_status',{workspace_id:f.A,process_id:first.result.process_id});
  if(status.result?.stopped)break;
  await new Promise(resolve=>setTimeout(resolve,2));
 }
 assert.equal(status.result?.stopped,true,'test requires the final command receipt before revocation');
 const revoked=await f.call('unbind_workspace',{workspace_id:f.A});
 assert.equal(revoked.ok,true,JSON.stringify(revoked));
 assert.equal(revoked.result.managed_processes.state,'STOPPED');
 const rebound=await f.call('bind_workspaces',{roots:[{path:f.rootA,role:'workspace'}]});
 assert.equal(rebound.ok,true,JSON.stringify(rebound));
 const second=await f.call('start_process',{workspace_id:rebound.result[0].workspace_id,command:'/fake/tool',args:[]});
 assert.equal(second.ok,true,JSON.stringify(second));
 assert.equal(executions,2);
});

test('old root fence survives both path replacement and moving the same physical root',async t=>{
 const f=await fixture(t,undefined,undefined,'custom-root-identity');
 let finish!:(value:any)=>void,entered!:()=>void,executions=0;
 const running=new Promise<void>(resolve=>entered=resolve);
 f.setExecute(()=>{executions++;entered();return new Promise(resolve=>finish=resolve);});
 const started=await f.call('start_process',{workspace_id:f.A,command:'/fake/tool',args:[]});
 assert.equal(started.ok,true);await running;
 const revoked=await f.call('unbind_workspace',{workspace_id:f.A});
 assert.equal(revoked.ok,true,JSON.stringify(revoked));
 const moved=path.join(f.root,'moved-original-root');
 await fs.rename(f.rootA,moved);
 await fs.mkdir(f.rootA,{mode:0o700});
 const rebound=await f.call('bind_workspaces',{roots:[{path:f.rootA,role:'workspace'},{path:moved,role:'workspace'}]});
 assert.equal(rebound.ok,true,JSON.stringify(rebound));
 assert.equal(rebound.result.length,2);
 for(const item of rebound.result){
  const attempt=await f.call('start_process',{workspace_id:item.workspace_id,command:'/fake/tool',args:[]});
  assert.equal(attempt.ok,false,'same canonical path or same device/inode must retain the old fence');
 }
 assert.equal(executions,1);
 finish(receipt);
});

test('missing sandbox cancel hook remains UNKNOWN after durable revocation',async t=>{
 const f=await fixture(t);
 let finish!:(value:any)=>void,entered!:()=>void;
 const running=new Promise<void>(resolve=>entered=resolve);
 f.setExecute(()=>{entered();return new Promise(resolve=>finish=resolve);});
 const started=await f.call('start_process',{workspace_id:f.A,command:'/fake/tool',args:[]});
 await running;f.sandbox.cancel=undefined;
 const revoked=await f.call('unbind_workspace',{workspace_id:f.A});
 assert.equal(revoked.ok,true,JSON.stringify(revoked));
 assert.equal(revoked.result.managed_processes.state,'UNKNOWN');
 assert.equal(revoked.result.managed_processes.outcomes[0].stopped,false);
 const record=await f.store.load(started.result.process_id);
 assert.equal(record?.stopped,false);assert.equal(record?.output_complete,false);
 finish(receipt);
});

test('final journal save failure keeps unbind observation unknown and output incomplete',async t=>{
 const f=await fixture(t);
 let finish!:(value:any)=>void,entered!:()=>void;
 const running=new Promise<void>(resolve=>entered=resolve);
 f.setExecute(()=>{entered();return new Promise(resolve=>finish=resolve);});
 const started=await f.call('start_process',{workspace_id:f.A,command:'/fake/tool',args:[]});
 await running;
 const originalSave=f.store.save.bind(f.store);
 f.store.save=async()=>{throw Error('injected final journal save failure');};
 finish(receipt);
 await new Promise(resolve=>setImmediate(resolve));
 const before=await f.store.load(started.result.process_id);
 assert.equal(before?.stopped,false);
 const revoked=await f.call('unbind_workspace',{workspace_id:f.A});
 assert.equal(revoked.ok,true,JSON.stringify(revoked));
 assert.equal(revoked.result.managed_processes.state,'UNKNOWN');
 assert.equal(revoked.result.managed_processes.outcomes[0].stopped,false);
 assert.equal((await f.store.load(started.result.process_id))?.output_complete,false);
 f.store.save=originalSave;
});

test('transient ProcessManager keeps ACK unconfirmed until receipt, then permits explicit resume',async()=>{
 let finish!:(value:any)=>void,executions=0;
 const sandbox:any={verified:true,execute:async()=>{executions++;return executions===1?new Promise(resolve=>finish=resolve):receipt;},
  cancel:async()=>true};
 const manager=new ProcessManager(sandbox);
 const request={workspace_id:'transient',executable:'/fake/tool',argv:[],cwd_relative:'.',time_limit_ms:30000,max_output_bytes:65536,network_allowed:false};
 const running=manager.run(request);
 const [record]=manager.list('transient');assert.ok(record);
 manager.fenceWorkspace('transient');
 const observed=await manager.stopWorkspace('transient');
 assert.equal(observed.state,'UNKNOWN');
 assert.equal(observed.outcomes[0]?.stopped,false,'cancel ACK is not a terminal receipt');
 assert.throws(()=>manager.start(request),/fenced/,'admission stays closed while the running record is uncertain');
 finish(receipt);await running;
 assert.equal(manager.resumeWorkspace('transient'),true,'a confirmed terminal receipt permits explicit resume');
 const next=manager.start(request);
 assert.equal(next.workspace_id,'transient');
 assert.equal(executions,2);
});

test('bounded stop observation returns UNKNOWN at timeout while late bookkeeping continues',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let complete!:()=>void,state:WorkspaceProcessStop['state']='UNKNOWN',pending=1;
 const work=new Promise<void>(resolve=>complete=()=>{state='STOPPED';pending=0;resolve();});
 const snapshot=()=>({state,pending_starts:pending,outcomes:[]}) satisfies WorkspaceProcessStop;
 const observed=observeProcessStop(work,snapshot);
 t.mock.timers.tick(15000);
 const timedOut=await observed;
 assert.equal(timedOut.state,'UNKNOWN');
 assert.equal(timedOut.pending_starts,1);
 assert.equal(state,'UNKNOWN','timeout must not mark background work complete');
 complete();await work;
 assert.equal(state,'STOPPED','background bookkeeping remains able to finish after observation timeout');
});

test('finishing an old admission token twice does not erase a newer pending start',()=>{
 const admission=new ProcessAdmission(),first=admission.begin('workspace');
 first.finish();
 const second=admission.begin('workspace');
 first.finish();
 assert.equal(admission.count('workspace'),1,'the old token must not delete the newer token set');
 second.check();second.finish();
 assert.equal(admission.count('workspace'),0);
});
