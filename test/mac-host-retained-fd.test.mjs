import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {createChildLifecycle} from '../scripts/mac-recovery-probe-control.mjs';
const exec=promisify(execFile),entry=new URL('../scripts/test-mac-host-retained-fd.mjs',import.meta.url);
const slot=new URL('../docs/reports/.mac-host-retained-fd-v1.attempt.json',import.meta.url);
const readSlot=()=>fs.readFile(slot).then(b=>b.toString('base64'),e=>{if(e.code==='ENOENT')return null;throw e;});
test('retained-FD plan/import/default never consumes the exclusive slot',async()=>{
 const before=await readSlot(),m=await import('../scripts/test-mac-host-retained-fd.mjs');
 const p=await m.getPlan();assert.equal(p.nativeExecution,false);assert.equal(p.maximumSandboxInvocations,1);assert.equal(p.maximumRenames,1);
 assert.equal(JSON.parse((await exec(process.execPath,[entry.pathname])).stdout).nativeExecution,false);
 await assert.rejects(exec(process.execPath,[entry.pathname,'--run']),e=>e.stderr.includes('EXPLICIT_ACKNOWLEDGEMENT_REQUIRED'));
 assert.equal(await readSlot(),before);
});
test('observer failure closes input without G and cannot keep the parent waiting on an unconfirmed leaf',async()=>{
 const {createProbeTransport,cleanupLeaf}=await import('../scripts/test-mac-host-retained-fd.mjs');
 for(const exitsOnEof of [true,false]){
  const child=new EventEmitter();child.pid=42;child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  let signals=0,unrefs=0,input='';child.kill=()=>{signals++;};child.unref=()=>{unrefs++;};child.stdin.on('data',b=>input+=b.toString());
  if(exitsOnEof)child.stdin.once('finish',()=>queueMicrotask(()=>child.emit('close',66,null)));
  const lifecycle=createChildLifecycle(),transport=createProbeTransport({argv:[],cwd:'/fixture',env:{},lifecycle,timeoutMs:100,spawnImpl:()=>child});
  transport.dispose();
  const result=await cleanupLeaf(transport,lifecycle,async()=>{throw Error('OBSERVER_UNAVAILABLE');},{waitMs:10});
  assert.equal(input,'');assert.equal(child.stdin.writableEnded,true);assert.equal(signals,0);assert.equal(lifecycle.cleanupUnverified,true);
  assert.equal(transport.closed,exitsOnEof);assert.equal(unrefs,exitsOnEof?0:1);assert.equal(result.detachedUnconfirmed,!exitsOnEof);
  if(!exitsOnEof){assert.equal(child.stdout.destroyed,true);assert.equal(child.stderr.destroyed,true);}
 }
});
test('real probe transport forbids late release after timeout/output/error even after child close',async()=>{
 const {createProbeTransport}=await import('../scripts/test-mac-host-retained-fd.mjs');
 for(const scenario of ['timeout','output','error']){
  const child=new EventEmitter();child.pid=42;child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  const lifecycle=createChildLifecycle();let options;
  const transport=createProbeTransport({argv:['-p','fixed'],cwd:'/fixture',env:{PATH:'/usr/bin:/bin'},lifecycle,timeoutMs:10,spawnImpl:(exe,args,o)=>{assert.equal(exe,'/usr/bin/sandbox-exec');options=o;return child;}});
  const rejected=Promise.all([assert.rejects(transport.ready),assert.rejects(transport.done)]);
  if(scenario==='output')child.stdout.write('x'.repeat(16385));if(scenario==='error')child.emit('error',Error('synthetic'));
  await rejected;assert.throws(()=>transport.release(),/CHILD_NO_LONGER_ELIGIBLE/);
  if(scenario==='output')assert.equal(Buffer.byteLength(transport.snapshot().stdout),16384,'retain the bounded raw prefix even if the child never closes');
  child.emit('close',1,null);assert.equal(lifecycle.cleanupUnverified,true);assert.throws(()=>transport.release(),/CHILD_NO_LONGER_ELIGIBLE/);
  assert.deepEqual(options.stdio,['pipe','pipe','pipe']);assert.equal(options.shell,false);transport.dispose();
 }
});
test('later inspection failures cannot downgrade a proven authority gap or changed canary',async()=>{
 const {recordFailure}=await import('../scripts/test-mac-host-retained-fd.mjs');
 for(const state of ['RETAINED_FD_AUTHORITY_SURVIVES','BLOCKING_CANARY_CHANGED']){
  const report={state,authoritySurvives:state==='RETAINED_FD_AUTHORITY_SURVIVES'};recordFailure(report,'failure',Error('late inspection error'));
  assert.equal(report.state,state);assert.equal(report.failure,'late inspection error');
 }
 const report={state:'PASS_RETAINED_FD_READ_DENIED_ONLY'};recordFailure(report,'failure',Error('late error'));assert.equal(report.state,'UNVERIFIED');
});
test('retained read success is an authority gap; only clean attributable EPERM/EACCES is bounded denial',async()=>{
 const {classifyRead}=await import('../scripts/test-mac-host-retained-fd.mjs');
 assert.equal(classifyRead({type:'read',n:3,errno:0,hex:'616263'},0,null),'RETAINED_FD_AUTHORITY_SURVIVES');
 for(const errno of [1,13])assert.equal(classifyRead({type:'read',n:-1,errno,hex:''},77,null),'PASS_RETAINED_FD_READ_DENIED_ONLY');
 assert.throws(()=>classifyRead({type:'read',n:-1,errno:9,hex:''},77,null),/UNVERIFIED/);
 assert.throws(()=>classifyRead({type:'read',n:0,errno:0,hex:''},0,null),/UNVERIFIED/);
 assert.throws(()=>classifyRead({type:'read',n:3,errno:0,hex:'616263'},null,'SIGABRT'),/UNVERIFIED/);
});
test('relocation is observed before release and readiness identities must match',async()=>{
 const {relocateAndRelease}=await import('../scripts/test-mac-host-retained-fd.mjs');
 const events=[],expected={pid:42,fd:3,dev:'1',ino:'2'};
 await relocateAndRelease(expected,expected,{verify:async()=>events.push('verify'),rename:async()=>events.push('rename'),confirm:async()=>events.push('confirm'),release:()=>events.push('release')});
 assert.deepEqual(events,['verify','rename','confirm','release']);
 events.length=0;
 await assert.rejects(relocateAndRelease({...expected,ino:'9'},expected,{verify:async()=>events.push('bad')}),/READY_IDENTITY/);
 assert.deepEqual(events,[]);
 await assert.rejects(relocateAndRelease(expected,expected,{verify:async()=>{},rename:async()=>events.push('rename'),confirm:async()=>{throw Error('changed');},release:()=>events.push('release')}),/changed/);
 assert.deepEqual(events,['rename']);
});
