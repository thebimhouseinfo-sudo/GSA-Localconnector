import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import {ProcessJournalStore} from '../src/local/process-store.js';
import {createReadOnlyTools} from '../src/mcp/server.js';
import {DurableProcessManager} from '../src/core/durable-process.js';
const decode=(r:any)=>JSON.parse(r.content[0].text);
const request={workspace_id:'A',executable:'/bin/tool',argv:['argument'],cwd_relative:'.',time_limit_ms:30000,max_output_bytes:65536,network_allowed:false} as const;
const receipt={exit_code:0,signal:null,stdout:'command π',stderr:'warning',cancelled:false,timed_out:false,artifacts:[]};
async function fixture(t:any,execute:any){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-command-history-'));await fs.chmod(root,0o700);
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const registry=new WorkspaceRegistry();
 for(const id of ['A','B']){const p=path.join(root,id);await fs.mkdir(p);await registry.enrollTrusted(id,p,['read','execute']);}
 const store=new ProcessJournalStore(path.join(root,'runs')),persistence={store,ownerSession:randomUUID()};
 const sandbox:any={verified:true,platform:'macos',policy_fingerprint:'fake-only',execute};
 const invoke=createReadOnlyTools(registry,null,sandbox,null,null,null,null,null,null,null,null,{processPersistence:persistence});
 return {root,store,persistence,sandbox,registry,invoke};
}
test('run_command keeps its full receipt and is visible after dispatcher restart without backend',{skip:process.platform==='win32'},async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return receipt;});
 const run=decode(await f.invoke({name:'run_command',arguments:{workspace_id:'A',command:'/bin/tool',args:['argument']}}));
 assert.equal(run.ok,true);assert.deepEqual(run.result.receipt,receipt);assert.equal(calls,1);
 const id=run.result.process_id;
 const list=decode(await f.invoke({name:'list_processes',arguments:{workspace_id:'A'}}));
 assert.ok(list.result.some((r:any)=>r.process_id===id),'synchronous command must be listed');
 const bytes=await fs.readFile(path.join(f.root,'runs',id+'.json'));
 const restarted=createReadOnlyTools(f.registry,null,null,null,null,null,null,null,null,null,null,{processPersistence:{...f.persistence,ownerSession:randomUUID()}});
 const status=decode(await restarted({name:'process_status',arguments:{workspace_id:'A',process_id:id}}));
 assert.equal(status.result.state,'SUCCEEDED');assert.equal(status.result.stopped,true);
 const output=decode(await restarted({name:'process_output',arguments:{workspace_id:'A',process_id:id}}));
 assert.equal(output.result.stdout,receipt.stdout);assert.equal(output.result.stderr,receipt.stderr);assert.equal(output.result.complete,true);
 assert.deepEqual(await fs.readFile(path.join(f.root,'runs',id+'.json')),bytes);assert.equal(calls,1);
 assert.equal(decode(await restarted({name:'process_status',arguments:{workspace_id:'B',process_id:id}})).ok,false);
});
test('failed pre-effect journal creation cannot execute a command',{skip:process.platform==='win32'},async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return receipt;});
 f.store.create=async()=>{throw Error('INJECTED_CREATE_FAILURE');};
 const run=decode(await f.invoke({name:'run_command',arguments:{workspace_id:'A',command:'/bin/tool',args:[]}}));
 assert.equal(run.ok,false);assert.equal(calls,0);
});
test('uncertain execution persists UNKNOWN incomplete and never replays',{skip:process.platform==='win32'},async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;throw Error('lost native receipt');});
 const result=decode(await f.invoke({name:'run_command',arguments:{workspace_id:'A',command:'/bin/tool',args:[]}}));
 assert.equal(result.ok,true);assert.equal(result.result.state,'UNKNOWN');assert.equal(calls,1);
 const record=await f.store.load(result.result.process_id);assert.ok(record);assert.equal(record.status.state,'UNKNOWN');assert.equal(record.stopped,false);assert.equal(record.output_complete,false);
});
test('live command cancellation ACK does not claim termination or call the controller',{skip:process.platform==='win32'},async t=>{
 let complete!:(r:any)=>void;let entered!:()=>void;const ready=new Promise<void>(r=>entered=r);
 const f=await fixture(t,()=>{entered();return new Promise(r=>complete=r);});
 const cancelled:string[]=[];f.sandbox.cancel=async(id:string)=>{cancelled.push(id);return true;};
 const controller:any={verified:true,platform:'macos',policy_fingerprint:'fake-only',stop:async()=>{throw Error('WRONG_CONTROLLER');},status:async()=>{throw Error('WRONG_CONTROLLER');}};
 const manager=new DurableProcessManager(controller,16,f.persistence);
 const run=(manager as any).run(request,f.sandbox);await ready;
 const rows=await manager.list('A');assert.equal(rows.length,1);
 const id=rows[0].process_id,ack=await manager.stop('A',id);
 assert.equal(ack.stopped,false);assert.deepEqual(cancelled,[id]);
 assert.equal((await manager.status('A',id)).state,'RUNNING');
 complete(receipt);await run;assert.equal((await manager.status('A',id)).stopped,true);
});
test('post-effect save failure keeps UNKNOWN unconfirmed ownership and never executes twice',{skip:process.platform==='win32'},async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return receipt;});
 const save=f.store.save.bind(f.store);let saves=0;
 f.store.save=async(...args)=>{if(++saves>=2)throw Error('INJECTED_FINAL_SAVE_FAILURE');return save(...args);};
 const manager=new DurableProcessManager(null,16,f.persistence);
 await assert.rejects((manager as any).run(request,f.sandbox),/INJECTED_FINAL_SAVE_FAILURE/);
 const [row]=await manager.list('A');assert.ok(row);const status=await manager.status('A',row.process_id);
 assert.equal(status.state,'UNKNOWN');assert.equal(status.stopped,false);assert.equal(calls,1);
 const record=await f.store.load(row.process_id);assert.ok(record);assert.equal(record.stopped,false);assert.equal(record.output_complete,false);
});
test('four-command quota is reserved before slow journal writes; arguments are snapshotted',{skip:process.platform==='win32'},async t=>{
 const seen:any[]=[];const f=await fixture(t,async(r:any)=>{seen.push(r);return receipt;});
 const original=f.store.create.bind(f.store);let unblock!:()=>void;const gate=new Promise<void>(r=>unblock=r);
 let count=0,entered!:()=>void;const allEntered=new Promise<void>(r=>entered=r);
 f.store.create=async r=>{if(++count===4)entered();await gate;return original(r);};
 const manager=new DurableProcessManager(null,16,f.persistence);await manager.initialize();
 const mutable={...request,argv:['original']};const calls=[(manager as any).run(mutable,f.sandbox),...Array.from({length:3},()=>(manager as any).run(request,f.sandbox))];
 await allEntered;mutable.argv[0]='changed';
 await assert.rejects((manager as any).run(request,f.sandbox),e=>(e as any).code==='PROCESS_LIMIT');
 assert.equal(seen.length,0);unblock();await Promise.all(calls);
 assert.equal(seen.length,4);assert.ok(seen.some(r=>r.argv[0]==='original'));assert.ok(!seen.some(r=>r.argv[0]==='changed'));
});
test('a signalled receipt is preserved as UNKNOWN with incomplete output, never a confirmed stop',{skip:process.platform==='win32'},async t=>{
 const output={...receipt,exit_code:null,signal:'SIGTERM'};const f=await fixture(t,async()=>output);
 const result=decode(await f.invoke({name:'run_command',arguments:{workspace_id:'A',command:'/bin/tool',args:[]}}));
 assert.equal(result.result.state,'UNKNOWN');assert.deepEqual(result.result.receipt,output);
 const record=await f.store.load(result.result.process_id);assert.ok(record);assert.equal(record.stopped,false);assert.equal(record.output_complete,false);assert.equal(record.stdout,receipt.stdout);
 const controller:any={verified:true,status:async()=>{throw Error('must not query null native ID');},stop:async()=>{throw Error('must not stop null native ID');}};
 const restarted=new DurableProcessManager(controller,16,f.persistence);
 assert.equal((await restarted.status('A',record.process_id)).state,'UNKNOWN');
 await assert.rejects(restarted.stop('A',record.process_id),e=>(e as any).code==='PROCESS_NOT_FOUND');
});
test('RUNNING pre-effect save failure cannot execute even after intent creation',{skip:process.platform==='win32'},async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return receipt;});
 f.store.save=async()=>{throw Error('INJECTED_RUNNING_SAVE_FAILURE');};
 const result=decode(await f.invoke({name:'run_command',arguments:{workspace_id:'A',command:'/bin/tool',args:[]}}));
 assert.equal(result.ok,false);assert.equal(calls,0);assert.equal((await f.store.list()).length,1);
});
test('completed synchronous stop is an idempotent confirmed no-op without a native controller',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,async()=>receipt);f.sandbox.cancel=async()=>{throw Error('finished command must not be cancelled again');};
 const manager=new DurableProcessManager(null,16,f.persistence);
 const record=await (manager as any).run(request,f.sandbox);
 assert.deepEqual(await manager.stop('A',record.process_id),{stopped:true,state:'SUCCEEDED'});
});
test('a receipt that seals during cancel is reported as confirmed, not as an unconfirmed ACK',{skip:process.platform==='win32'},async t=>{
 let finish!:(r:any)=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r);
 const f=await fixture(t,()=>{entered();return new Promise(r=>finish=r);});
 const manager=new DurableProcessManager(null,16,f.persistence);
 const run=(manager as any).run(request,f.sandbox);await ready;
 f.sandbox.cancel=async()=>{finish(receipt);await run;return true;};
 const [row]=await manager.list('A');
 const result=await manager.stop('A',row.process_id);assert.equal(result.stopped,true);assert.equal(result.state,'SUCCEEDED');
});
test('sandbox-only start_process returns before completion and uses the same persisted history and stop ID',{skip:process.platform==='win32',timeout:3000},async t=>{
 let finish!:(r:any)=>void;const f=await fixture(t,()=>new Promise(r=>finish=r));
 const cancelled:string[]=[];f.sandbox.cancel=async(id:string)=>{cancelled.push(id);return true;};
 const started=decode(await f.invoke({name:'start_process',arguments:{workspace_id:'A',command:'/bin/tool',args:[]}}));
 assert.equal(started.ok,true);const id=started.result.process_id;
 assert.ok(await f.store.load(id),'start acknowledgement must follow durable intent');
 const listed=decode(await f.invoke({name:'list_processes',arguments:{workspace_id:'A'}}));assert.ok(listed.result.some((r:any)=>r.process_id===id));
 const active=decode(await f.invoke({name:'process_status',arguments:{workspace_id:'A',process_id:id}}));assert.equal(active.result.state,'RUNNING');
 const stopped=decode(await f.invoke({name:'stop_process',arguments:{workspace_id:'A',process_id:id}}));assert.equal(stopped.ok,true);assert.equal(stopped.result.stopped,false);assert.deepEqual(cancelled,[id]);
 finish(receipt);
 for(let i=0;i<100;i++){const status=decode(await f.invoke({name:'process_status',arguments:{workspace_id:'A',process_id:id}}));if(status.result.stopped)break;await new Promise(r=>setTimeout(r,5));}
 const record=await f.store.load(id);
 assert.equal(record?.status.state,'SUCCEEDED');assert.equal(record?.output_complete,true);
 assert.equal(decode(await f.invoke({name:'process_output',arguments:{workspace_id:'A',process_id:id}})).result.stdout,receipt.stdout);
});
test('sandbox-only start_process never executes when its durable intent cannot be created',{skip:process.platform==='win32'},async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return receipt;});f.store.create=async()=>{throw Error('NO_DURABLE_INTENT');};
 const started=decode(await f.invoke({name:'start_process',arguments:{workspace_id:'A',command:'/bin/tool',args:[]}}));assert.equal(started.ok,false);assert.equal(calls,0);
});
test('persisted background starts and foreground commands share their four-command capacity',{skip:process.platform==='win32',timeout:3000},async t=>{
 const finish:Array<(r:any)=>void>=[];const f=await fixture(t,()=>new Promise(r=>finish.push(r)));
 const manager=new DurableProcessManager(null,16,f.persistence);
 const starts=await Promise.all(Array.from({length:4},()=>manager.startCommand(request,f.sandbox)));
 assert.equal(finish.length,4);await assert.rejects(manager.run(request,f.sandbox),e=>(e as any).code==='PROCESS_LIMIT');
 for(const done of finish)done(receipt);
 for(let i=0;i<100;i++){if((await Promise.all(starts.map(s=>manager.status('A',s.process_id)))).every(s=>s.stopped))break;await new Promise(r=>setTimeout(r,5));}
 assert.ok((await Promise.all(starts.map(s=>manager.status('A',s.process_id)))).every(s=>s.stopped));
});
test('background final-save failure retains UNKNOWN ownership after acknowledgement',{skip:process.platform==='win32'},async t=>{
 let finish!:(r:any)=>void,failed!:()=>void;const failure=new Promise<void>(r=>failed=r);
 const f=await fixture(t,()=>new Promise(r=>finish=r)),save=f.store.save.bind(f.store);let saves=0;
 f.store.save=async(...args)=>{if(++saves>=2){failed();throw Error('ASYNC_FINAL_SAVE_FAILURE');}return save(...args);};
 const manager=new DurableProcessManager(null,16,f.persistence),started=await manager.startCommand(request,f.sandbox);
 finish(receipt);await failure;await new Promise(r=>setImmediate(r));
 const status=await manager.status('A',started.process_id);assert.equal(status.state,'UNKNOWN');assert.equal(status.stopped,false);
 assert.equal((await f.store.load(started.process_id))?.stopped,false);
 const output=await manager.output('A',started.process_id);assert.ok('complete' in output);assert.equal(output.complete,false);
});
