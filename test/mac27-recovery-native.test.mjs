import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {
  assertDeadline, assertFrozenInputs, assertNativeAdmission, assertPreparedSetup, assertStoppedCapture, classifyRelocation,
  createBudget, createObserverLines, evaluateCaptureGate, generateDiagnosticSource, getCommandGraph, getPlan,
  mergeRunState, observeOwnedClosure, parseArguments, reserveReceiptBytes, reserveOneShot, claimWorkerEntry,
  validateObserverEvent, validateScheduledCall, validateWorkerBinding,
} from '../scripts/test-mac27-recovery-native.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash='a'.repeat(64);
const caps={broker:17,sign:4,compile:2,observer:6,owner:1,tool:128,total:158,relocation:1,signals:12};
const validSetup=()=>({hostRelease:'27.0.0',arch:'arm64',driverSha256:hash,candidateSourceSha256:hash,compiledGraphSha256:hash,ownerLauncherSha256:hash,observerSha256:hash,baseEvidenceSha256:hash,baseReleaseSha256:hash,baseCodeSha256:hash,baseUnchanged:true,recipeValidated:true,wrappersValidated:true,ownerVerified:true,signingProfile:'gsa-recovery-adhoc-two-root-v1',brokerCalls:17,explicitSpawnUpperBound:158});
const expected={capturedIdentity:{device:'42',inode:'99'},heldIdentity:{device:'52',inode:'92'},fd:8,pid:700,parentPid:2,startTime:'100:200',executable:'/private/tmp/recovery-broker'};
const capturedObservation=()=>({captured:{present:true,device:'42',inode:'99'},pid:700,parentPid:2,startTime:'100:200',executable:'/private/tmp/recovery-broker',fd:8,fdDevice:'52',fdInode:'92'});
const observerExpected={pid:700,parentPid:2,startTime:'100:200',executable:'/private/tmp/recovery-broker',heldIdentity:{device:'52',inode:'92'},capturedIdentity:{device:'42',inode:'99'},fd:8,phase:'capture'};
const readyEvent=()=>({event:'WATCH_READY',pid:700,parentPid:2,startTime:'100:200',device:'52',inode:'92'});
const watchEvent=()=>({event:'STOP_SENT',pid:700,parentPid:2,startTime:'100:200',executable:'/private/tmp/recovery-broker',status:3,fd:8,device:'52',inode:'92',fdDevice:'52',fdInode:'92',signal:'SIGSTOP',phase:'capture',iteration:4,elapsedMs:230,captured:{present:true,device:'42',inode:'99'}});

test('import is held false and exposes the fixed schedule without activating native execution',()=>{
  const plan=getPlan();
  assert.equal(plan.status,'NOT_READY'); assert.equal(plan.nativeExecution,false); assert.equal(plan.activation,false);
  assert.equal(plan.implementationStatus,'IMPLEMENTED_UNVERIFIED');
  assert.equal(plan.implementationComplete,false); assert.equal(plan.sourceReviewComplete,false);
  assert.equal(plan.brokerCalls,17); assert.equal(plan.attemptReservation.endsWith('.mac27-recovery-native-v1.attempt.json'),true);
  assert.deepEqual(plan.caps,caps); assert.equal(plan.bounds.runMs,180000); assert.equal(plan.bounds.watchMs,5500); assert.equal(plan.bounds.watchIterations,2000); assert.equal(plan.bounds.watchStops,1);
  assert.equal(plan.schedule.reduce((n,row)=>n+row.calls.length,0),17);
  assert.deepEqual(plan.unimplemented,[]);
  assert(plan.unresolved.includes('EXPLICIT_NEW_NATIVE_AUTHORIZATION_PENDING'));
});

test('arguments select a plan by default and reject incomplete or altered native acknowledgements',()=>{
  assert.equal(parseArguments([]),'plan'); assert.equal(parseArguments(['--plan']),'plan');
  assert.equal(parseArguments(['--run-native','--ack-mac27-recovery-one-pass']),'native');
  for(const args of [['--run-native'],['--ack-mac27-recovery-one-pass'],['--run-native','--ack-other'],['--plan','--run-native'],['--run-native','--ack-mac27-recovery-one-pass','extra']])
    assert.throws(()=>parseArguments(args),e=>e.code==='ACKNOWLEDGEMENT_REQUIRED');
  assert.equal(getPlan().nativeExecution,false);
});

test('budget reserves each resource before use and a failed multi-counter reservation is atomic',()=>{
  const budget=createBudget();
  assert.equal(budget.snapshot().total,0);
  budget.reserve({broker:17,sign:4,compile:2,observer:6,owner:1,tool:128,relocation:1,signals:12});
  assert.equal(budget.snapshot().total,158);
  const before={...budget.snapshot()};
  for(const req of [{broker:1},{signals:1},{tool:1},{mystery:1},{total:1},{broker:-1}])
    assert.throws(()=>budget.reserve(req));
  assert.deepEqual({...budget.snapshot()},before);
});

test('budget exhaustion and unknown cleanup permanently reject further reservations',()=>{
  const budget=createBudget(); budget.reserve({broker:17});
  assert.throws(()=>budget.reserve({broker:1}),e=>e.code==='BUDGET_EXHAUSTED');
  budget.markUnknown(); assert.equal(budget.unknown,true);
  assert.throws(()=>budget.reserve({inspect:1}),e=>e.code==='CLEANUP_UNVERIFIED');
});

test('budget configuration may narrow but never expand process, signal or owner hard caps',()=>{
  const budget=createBudget({childLimit:2,signalLimit:1,ownerLimit:0});
  budget.reserve({broker:2});
  assert.throws(()=>budget.reserve({broker:1}),e=>e.code==='BUDGET_EXHAUSTED');
  assert.throws(()=>budget.reserve({signals:2}),e=>e.code==='BUDGET_EXHAUSTED');
  assert.throws(()=>budget.reserve({owner:1}),e=>e.code==='BUDGET_EXHAUSTED');
  for(const limits of [{childLimit:159},{signalLimit:13},{ownerLimit:2},{childLimit:-1},{signalLimit:1.5}])
    assert.throws(()=>createBudget(limits),e=>e.code==='BUDGET_ARGUMENT');
});

test('deadline accepts only finite work strictly before its monotonic bound',()=>{
  assert.equal(assertDeadline(100,99),1);
  for(const [deadline,now] of [[100,100],[100,101],[Infinity,1],[10,NaN]])
    assert.throws(()=>assertDeadline(deadline,now),e=>e.code==='DEADLINE');
});

test('diagnostic source copy performs exactly one labeled substitution and disclaims kernel failure',async()=>{
  const source=await fs.readFile(path.join(repo,'native/macos-files/recovery-broker.swift'),'utf8');
  const diagnostic=generateDiagnosticSource(source);
  assert.equal(diagnostic.substitutions,1); assert.equal(diagnostic.provenance,'DIAGNOSTIC_ONLY');
  assert.equal(diagnostic.actualKernelFailure,false); assert.equal(diagnostic.productionSourceSha256,hashText(source));
  assert.notEqual(diagnostic.diagnosticSourceSha256,diagnostic.productionSourceSha256);
  assert.equal((diagnostic.source.match(/DIAGNOSTIC_ONLY/g)??[]).length,1);
  assert(source.includes('fsync(fd)==0 && fsync(tx)==0'));
  assert.throws(()=>generateDiagnosticSource(source.replace('fsync(fd)==0 && fsync(tx)==0','altered branch')),e=>e.code==='DIAGNOSTIC_SUBSTITUTION');
});
function hashText(value){return createHash('sha256').update(value).digest('hex');}

test('capture gate rejects a matching source FD before the captured name exists',()=>{
  const beforeCapture={...capturedObservation(),captured:{present:false,device:'42',inode:'99'}};
  const result=evaluateCaptureGate(beforeCapture,expected);
  assert.equal(result.eligible,false); assert.equal(result.reason,'CAPTURE_NAME_UNVERIFIED');
});

test('capture gate requires exact captured identity and owned process identity',()=>{
  assert.equal(evaluateCaptureGate(capturedObservation(),expected).eligible,true);
  for(const change of [
    o=>{o.captured.inode='100';},o=>{o.pid++;},o=>{o.parentPid++;},
    o=>{o.startTime='100:201';},o=>{o.executable='/tmp/other';},
    o=>{o.fd=-1;},o=>{o.fdInode='100';},
  ]){
    const observation=capturedObservation(); change(observation);
    assert.equal(evaluateCaptureGate(observation,expected).eligible,false);
  }
});

test('capture gate rejects missing and malformed identities without signaling eligibility',()=>{
  assert.deepEqual(evaluateCaptureGate(null,expected),{eligible:false,reason:'MISSING_OBSERVATION'});
  for(const change of [o=>{o.startTime='stale';},o=>{o.executable='relative/path';},o=>{o.pid=1;}]){
    const observation=capturedObservation(); change(observation);
    assert.equal(evaluateCaptureGate(observation,expected).eligible,false);
  }
});

test('STOP phase requires source absence, staged replacement and exact staged identity',()=>{
  const stagedIdentity={device:'42',inode:'101'};
  const expectedWithStage={...expected,stagedIdentity};
  const observed={...capturedObservation(),freshCaptured:{present:true,...expected.capturedIdentity},state:'T',sourceAbsent:true,staged:{present:true,...stagedIdentity}};
  assert.equal(assertStoppedCapture(observed,expectedWithStage),true);
  for(const mutate of [o=>{o.state='R';},o=>{o.sourceAbsent=false;},o=>{o.staged.present=false;},o=>{o.staged.inode='102';}]){
    const candidate={...observed,captured:{...observed.captured},staged:{...observed.staged}}; mutate(candidate);
    assert.throws(()=>assertStoppedCapture(candidate,expectedWithStage));
  }
});

test('relocation classification reports only the actual denied phase',()=>{
  const base={phaseVerified:true,denied:true,canariesUnchanged:true};
  assert.deepEqual(classifyRelocation({...base,phase:'pre-capture-read'}),{state:'OBSERVED_DENIAL',phase:'pre-capture-read',exercisedSyscalls:[]});
  for(const phase of ['capture','publication','restoration'])
    assert.deepEqual(classifyRelocation({...base,phase}),{state:'OBSERVED_DENIAL',phase,exercisedSyscalls:[phase]});
  assert.equal(classifyRelocation({...base,phase:'publication',phaseVerified:false}).state,'INCONCLUSIVE');
  assert.equal(classifyRelocation({...base,phase:'capture',canariesUnchanged:undefined}).state,'INCONCLUSIVE');
  assert.equal(classifyRelocation({...base,phase:'capture',canariesUnchanged:false}).state,'BLOCKING');
  assert.equal(classifyRelocation({...base,phase:'capture',outsideChanged:true}).state,'BLOCKING');
});

test('setup requires pinned host, artifacts, full fixture recipes, observer and exact call graph',()=>{
  assert.equal(assertPreparedSetup(validSetup()),true);
  for(const mutate of [
    s=>{s.hostRelease='26.0.0';},s=>{s.arch='x86_64';},s=>{s.candidateSourceSha256='bad';},
    s=>{s.baseUnchanged=false;},s=>{s.recipeValidated=false;},s=>{s.wrappersValidated=false;},
    s=>{s.ownerVerified=false;},s=>{s.signingProfile='single-root';},s=>{s.brokerCalls=16;},
    s=>{s.explicitSpawnUpperBound=157;},
  ]){const setup=validSetup(); mutate(setup); assert.throws(()=>assertPreparedSetup(setup));}
});

test('receipt budget reserves bytes atomically and refuses overflow',()=>{
  const report={}; assert.equal(reserveReceiptBytes(report,1024),1024);
  assert.equal(reserveReceiptBytes(report,64*1024*1024-1024),64*1024*1024);
  assert.throws(()=>reserveReceiptBytes(report,1),e=>e.code==='RECEIPT_BUDGET_EXHAUSTED');
  assert.equal(report.reservedReceiptBytes,64*1024*1024);
});

test('owner and worker merge makes BLOCKING take priority and preserves bounded counts',()=>{
  assert.deepEqual(mergeRunState({state:'APPLIED',counts:{broker:1,total:1}},{state:'UNKNOWN',counts:{broker:1,total:1}}),{
    state:'CLEANUP_UNVERIFIED',cleanupState:'UNVERIFIED',counts:{broker:2,sign:0,compile:0,observer:0,owner:0,tool:0,total:2,relocation:0,signals:0},unresolved:[],
  });
  assert.equal(mergeRunState({state:'BLOCKING',counts:{total:0}},{state:'CLEANUP_UNVERIFIED',counts:{total:0}}).state,'BLOCKING');
  assert.throws(()=>mergeRunState({counts:{broker:17,total:17}},{counts:{broker:1,total:1}}),e=>e.code==='BUDGET_EXHAUSTED');
});

test('merged persisted child counters must agree with their reported total',()=>{
  const result=mergeRunState(
    {counts:{broker:2,sign:1,total:3}},
    {counts:{tool:1,total:1}},
  );
  assert.equal(result.counts.total,4);
  assert.throws(()=>mergeRunState({counts:{broker:2,total:0}},{counts:{total:0}}),e=>e.code==='COUNT_TOTAL_MISMATCH');
  assert.throws(()=>mergeRunState({counts:{broker:1,total:2}},{counts:{total:0}}),e=>e.code==='COUNT_TOTAL_MISMATCH');
});

test('receipt byte reservations reject malformed prior state without changing it',()=>{
  for(const prior of [-1,1.5,Number.MAX_SAFE_INTEGER+1,'0',null]){
    const report={reservedReceiptBytes:prior};
    assert.throws(()=>reserveReceiptBytes(report,1),e=>e.code==='RECEIPT_BUDGET_EXHAUSTED');
    assert.equal(report.reservedReceiptBytes,prior);
  }
  const report={reservedReceiptBytes:64*1024*1024-8};
  assert.throws(()=>reserveReceiptBytes(report,9),e=>e.code==='RECEIPT_BUDGET_EXHAUSTED');
  assert.equal(report.reservedReceiptBytes,64*1024*1024-8);
});

test('receipt partitions enforce independent owner and worker byte ceilings',()=>{
  const owner={}; assert.equal(reserveReceiptBytes(owner,128*1024,128*1024),128*1024);
  assert.throws(()=>reserveReceiptBytes(owner,1,128*1024),e=>e.code==='RECEIPT_BUDGET_EXHAUSTED');
  const worker={}; assert.equal(reserveReceiptBytes(worker,64*1024*1024-128*1024,64*1024*1024-128*1024),64*1024*1024-128*1024);
  assert.throws(()=>reserveReceiptBytes(worker,1,64*1024*1024-128*1024),e=>e.code==='RECEIPT_BUDGET_EXHAUSTED');
  assert.throws(()=>reserveReceiptBytes({},1,64*1024*1024+1),e=>e.code==='RECEIPT_BUDGET_EXHAUSTED');
});

test('capture gate treats absent, mismatched and reused descriptors as ineligible',()=>{
  for(const observation of [
    {...capturedObservation(),captured:{present:false,device:'42',inode:'99'}},
    {...capturedObservation(),captured:{present:true,device:'42',inode:'99'},fd:9},
    {...capturedObservation(),fdDevice:'52',fdInode:'93'},
    {...capturedObservation(),fdDevice:'bad',fdInode:'92'},
  ]) assert.equal(evaluateCaptureGate(observation,expected).eligible,false);
});

test('observer accepts ready then post-capture STOP only with pinned owner, FD, phase and bounds',()=>{
  assert.equal(validateObserverEvent(readyEvent(),observerExpected,'ready').event,'WATCH_READY');
  const valid=watchEvent(); assert.equal(validateObserverEvent(valid,observerExpected,'watch').event,'STOP_SENT');
  for(const mutate of [
    e=>{e.pid++;},e=>{e.parentPid++;},e=>{e.startTime='100:201';},
    e=>{e.executable='/private/tmp/replaced-process';},e=>{e.fd++;},
    e=>{e.fdInode='93';},e=>{e.phase='parent';},e=>{e.iteration=2001;},
    e=>{e.elapsedMs=5501;},e=>{e.captured.present=false;},
  ]){const event=watchEvent();mutate(event);assert.throws(()=>validateObserverEvent(event,observerExpected,'watch'));}
  assert.throws(()=>validateObserverEvent(watchEvent(),{...observerExpected,phase:'parent'},'watch'));
});

test('observer confirmation requires authoritative stopped status after the signal',()=>{
  const confirm={...watchEvent(),event:'STOP_CONFIRMED',status:4,state:'T'};
  assert.equal(validateObserverEvent(confirm,observerExpected,'confirm').state,'T');
  for(const mutate of [e=>{e.status=3;},e=>{e.state='R';},e=>{e.state='';},e=>{e.pid++;}]){
    const value={...confirm};mutate(value);assert.throws(()=>validateObserverEvent(value,observerExpected,'confirm'));
  }
});

test('owner command graph matches the enumerated spawn ceiling and discloses private descendants',()=>{
  const graph=getCommandGraph();
  assert.equal(graph.explicitDerived,graph.broker+graph.sign+graph.compile+graph.observer+graph.owner+graph.tool.derived);
  assert.equal(graph.explicitUpperBound,158); assert.equal(graph.tool.derived,105); assert.equal(graph.tool.derived<=graph.tool.reserved, true);
  assert.equal(graph.compilerPrivateDescendants,'UNVERIFIED');
  assert.equal(graph.partition.owner.children+graph.partition.worker.children,graph.explicitUpperBound);
  assert.equal(graph.partition.owner.signals+graph.partition.worker.signals,12);
});

test('owner worker entry binds one stage, reservation, inputs, source/runtime build and fixed deadline',()=>{
  const stage='/private/tmp/gsa-mac27-recovery-0123456789abcdef01234567',hash='a'.repeat(64);
  const sourceHashes={driver:hash,candidate:'b'.repeat(64)},runtime=[{path:'core.js',sha256:'c'.repeat(64)}],build={release:'d'.repeat(64)};
  const input={stage,sourceHashes,runtime,build,startedAt:1000,deadlineAt:181000,node:'/usr/bin/node',nodeSha256:'e'.repeat(64)};
  const reservation={format:'gsa-mac27-recovery-once-v1',activation:false,stage,inputSha256:'f'.repeat(64),sourceHashes,runtime,build,caps,bounds:{runMs:180000,watchMs:5500,watchIterations:2000,watchStops:1,requestBytes:12*1024*1024,responseBytes:1024*1024,diagnosticBytes:65536,observerBytes:4096,receiptBytes:64*1024*1024},startedAt:1000,deadlineAt:181000};
  const current={stage,inputSha256:reservation.inputSha256,driverSha256:hash,node:'/usr/bin/node',nodeSha256:input.nodeSha256};
  assert.equal(validateWorkerBinding(input,reservation,current),true);
  for(const mutate of [
    (i,r,c)=>{i.stage='/private/tmp/other';},(i,r,c)=>{r.inputSha256='0'.repeat(64);},
    (i,r,c)=>{c.driverSha256='1'.repeat(64);},(i,r,c)=>{i.runtime=[{path:'changed.js',sha256:'c'.repeat(64)}];},
    (i,r,c)=>{r.caps={...caps,total:157};},(i,r,c)=>{i.deadlineAt=181001;},
    (i,r,c)=>{c.nodeSha256='2'.repeat(64);},(i,r,c)=>{r.sourceHashes={...sourceHashes,driver:'3'.repeat(64)};},
    (i,r,c)=>{r.format='unknown';},(i,r,c)=>{r.activation=true;},
  ]){
    const i=structuredClone(input),r=structuredClone(reservation),c={...current};mutate(i,r,c);
    assert.throws(()=>validateWorkerBinding(i,r,c));
  }
});

test('frozen source and runtime input bindings reject drift before native dispatch',()=>{
  const current={sourceHashes:{driver:'a'.repeat(64),source:'b'.repeat(64)},runtime:[{path:'core.js',sha256:'c'.repeat(64)}]};
  assert.equal(assertFrozenInputs(current,structuredClone(current)),true);
  assert.throws(()=>assertFrozenInputs({...current,sourceHashes:{...current.sourceHashes,source:'d'.repeat(64)}},current),e=>e.code==='FROZEN_INPUT_CHANGED');
  assert.throws(()=>assertFrozenInputs({...current,runtime:[{path:'core.js',sha256:'e'.repeat(64)}]},current),e=>e.code==='FROZEN_INPUT_CHANGED');
});

test('native admission requires completed setup and exact flattened 17-call schedule',()=>{
  const calls=[
    ['replace','production',false],['replace','production',false],['inspect','production',false],
    ['trash','production',false],['replace','production',false],['replace','production',true],
    ['inspect','production',false],['inspect','production',false],['inspect','production',false],
    ['replace','production',false],['inspect','production',false],['replace','production',false],
    ['inspect','production',false],['replace','production',false],['inspect','production',false],
    ['replace','diagnostic',false],['inspect','diagnostic',false],
  ];
  assert.equal(calls.length,17);
  calls.forEach(([operation,variant,direct],index)=>assert.equal(validateScheduledCall(index,{operation,variant,direct}),true));
  assert.throws(()=>assertNativeAdmission({},0,{operation:'replace',variant:'production'}),e=>e.code==='SETUP_BEFORE_NATIVE');
  assert.equal(assertNativeAdmission({setupComplete:true},0,{operation:'replace',variant:'production'}),true);
  assert.throws(()=>validateScheduledCall(5,{operation:'replace',variant:'production',direct:false}),e=>e.code==='NATIVE_SCHEDULE_MISMATCH');
  assert.throws(()=>validateScheduledCall(15,{operation:'replace',variant:'production',direct:false}),e=>e.code==='NATIVE_SCHEDULE_MISMATCH');
  assert.throws(()=>validateScheduledCall(16,{operation:'inspect',variant:'production'}),e=>e.code==='NATIVE_SCHEDULE_MISMATCH');
  assert.throws(()=>validateScheduledCall(17,{operation:'inspect',variant:'diagnostic'}),e=>e.code==='NATIVE_SCHEDULE_MISMATCH');
});

test('one-shot reservation and worker-entry primitives are exclusive in private disposable directories',async()=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-recovery-guard-'));
  const parent=await fs.realpath(temporary);
  try{
    const slot=path.join(parent,'attempt.json'),payload={attempt:'fixed',source:'a'.repeat(64)};
    await reserveOneShot(slot,payload);
    assert.deepEqual(JSON.parse(await fs.readFile(slot,'utf8')),payload);
    await assert.rejects(()=>reserveOneShot(slot,{attempt:'replay'}));
    assert.deepEqual(JSON.parse(await fs.readFile(slot,'utf8')),payload);
    const stage=path.join(parent,'worker-stage');await fs.mkdir(stage,{mode:0o700});await fs.chmod(stage,0o700);
    const binding={stage,inputSha256:'b'.repeat(64),driverSha256:'c'.repeat(64)};
    assert.equal(await claimWorkerEntry(stage,binding),true);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(stage,'worker-entry.json'),'utf8')),binding);
    await assert.rejects(()=>claimWorkerEntry(stage,binding));
    await assert.rejects(()=>claimWorkerEntry(parent,binding));
  } finally {await fs.rm(parent,{recursive:true,force:true});}
});

test('owned child closure uses inert handles and makes owner timeout cleanup sticky unknown',async()=>{
  const settled=await observeOwnedClosure({exitCode:0,signalCode:null,kill(){}},Promise.resolve({code:0,signal:null}),{timeoutMs:100},createBudget(),{});
  assert.equal(settled.closed,true);assert.equal(settled.code,0);
  let finish;const closed=new Promise(resolve=>{finish=resolve;});
  const child={exitCode:null,signalCode:null,kill(signal){this.exitCode=0;finish({code:0,signal});}};
  const budget=createBudget(),report={state:'RUNNING',cleanupState:'VERIFIED'};
  const timed=await observeOwnedClosure(child,closed,{owner:true,timeoutMs:2,termGraceMs:10,killGraceMs:10},budget,report);
  assert.equal(timed.timedOut,true);assert.equal(report.state,'CLEANUP_UNVERIFIED');assert.equal(report.cleanupState,'UNVERIFIED');
  assert.equal(budget.unknown,true);assert.throws(()=>budget.reserve({owner:1}),e=>e.code==='CLEANUP_UNVERIFIED');
});

test('observer output accepts exactly ready then watch, bounded UTF-8 records, and rejects replay/order drift',()=>{
  const parser=createObserverLines(observerExpected),ready=JSON.stringify(readyEvent())+'\n',watch=JSON.stringify(watchEvent())+'\n';
  assert.deepEqual(parser.push(Buffer.from(ready)),[readyEvent()]);
  assert.deepEqual(parser.push(Buffer.from(watch)),[watchEvent()]);
  assert.equal(parser.finish(),true);
  for(const chunks of [
    [Buffer.from(watch+ready)],
    [Buffer.from(ready+watch+watch)],
    [Buffer.from([0xff])],
    [Buffer.from(ready.slice(0,-1))],
  ]){
    const parser=createObserverLines(observerExpected);assert.throws(()=>{for(const chunk of chunks)parser.push(chunk);parser.finish();});
  }
  const oversized=createObserverLines(observerExpected);
  assert.throws(()=>oversized.push(Buffer.alloc(4097,0x61)),e=>e.code==='OBSERVER_OUTPUT_LIMIT');
});

// These public helpers carry data only; the privileged native transport stays private.
test('owner verification transport inherits FD3 and only the owner environment',async()=>{
 const driver=await import('../scripts/test-mac27-recovery-native.mjs');
 assert.equal(typeof driver.buildTransportOptions,'function','transport option boundary is missing');
 const environment={GSA_OWNER_LOCK_FD:'3',GSA_OWNER_SESSION:'11111111-1111-4111-8111-111111111111',GSA_OWNER_IDENTITY:'/private/tmp/owner',UNRELATED:'must-not-leak'};
 const options=driver.buildTransportOptions({ownerFD:true},environment);
 assert.deepEqual(options.stdio,['pipe','pipe','pipe',3]);
 assert.equal(options.env.GSA_OWNER_LOCK_FD,'3');assert.equal(options.env.GSA_OWNER_SESSION,environment.GSA_OWNER_SESSION);
 assert.equal(options.env.GSA_OWNER_IDENTITY,undefined);assert.equal(options.env.UNRELATED,undefined);
 const ordinary=driver.buildTransportOptions({},environment);
 assert.deepEqual(ordinary.stdio,['pipe','pipe','pipe']);assert.equal(ordinary.env.GSA_OWNER_SESSION,undefined);
 assert.throws(()=>driver.buildTransportOptions({ownerFD:true},{GSA_OWNER_LOCK_FD:'3'}),/OWNER_BINDING/);
});

test('post-STOP captured identity must be fresh even if observer proof had the old identity',()=>{
 const stagedIdentity={device:'42',inode:'101'},expectedWithStage={...expected,stagedIdentity};
 const proof={...capturedObservation(),state:'T',sourceAbsent:true,staged:{present:true,...stagedIdentity}};
 assert.throws(()=>assertStoppedCapture({...proof,freshCaptured:{present:true,device:'42',inode:'100'}},expectedWithStage),/CAPTURE_GATE|CAPTURE_IDENTITY/);
 assert.throws(()=>assertStoppedCapture({...proof,freshCaptured:{present:false}},expectedWithStage),/CAPTURE_GATE|CAPTURE_IDENTITY/);
});

test('staging classification requires matching SIGXFSZ receipt and nonempty staged bytes',async()=>{
 const driver=await import('../scripts/test-mac27-recovery-native.mjs');
 assert.equal(typeof driver.assertStagingEvidence,'function','staging evidence boundary is missing');
 const request=Buffer.from('{"operation":"replace","transaction_id":"t"}');
 const record={variant:'production',transaction_id:'t',operation:'replace',mode:'staging',exitCode:null,signal:'SIGXFSZ',rawReceiptIndex:1,expectedInterruption:true};
 const receipt={kind:'broker',closed:true,truncated:false,exitCode:null,signal:'SIGXFSZ',files:{request:{sha256:hashText(request)}}};
 const call={variant:'production',transaction_id:'t',operation:'replace',requestSha256:hashText(request)};
 const base={record,receipt,call,transactionId:'t',stagedBytes:4096};
 assert.equal(driver.assertStagingEvidence(base),true);
 for(const changes of [{stagedBytes:0},{stagedBytes:4097},{record:{...record,signal:'SIGTERM'}},{receipt:{...receipt,signal:'SIGTERM'}},{receipt:{...receipt,truncated:undefined}},{transactionId:'other'},{call:{...call,requestSha256:hash}}])
  assert.throws(()=>driver.assertStagingEvidence({...base,...changes}));
});

test('lost acknowledgement requires the retained matching raw APPLIED reply',async()=>{
 const driver=await import('../scripts/test-mac27-recovery-native.mjs');
 assert.equal(typeof driver.assertLostAckEvidence,'function','lost acknowledgement evidence boundary is missing');
 const request=Buffer.from('{"operation":"replace","transaction_id":"t"}'),raw=Buffer.from('{"ok":true,"status":"APPLIED","transaction_id":"t"}');
 const record={variant:'production',transaction_id:'t',operation:'replace',mode:'lost-ack',exitCode:0,signal:null,rawReceiptIndex:1,deliberatelyDroppedAcknowledgement:true,reply:JSON.parse(raw.toString())};
 const receipt={kind:'broker',closed:true,truncated:false,exitCode:0,signal:null,files:{request:{sha256:hashText(request)},response:{sha256:hashText(raw)}}};
 const call={variant:'production',transaction_id:'t',operation:'replace',requestSha256:hashText(request)};
 const base={record,receipt,call,transactionId:'t',raw};
 assert.equal(driver.assertLostAckEvidence(base),true);
 for(const changes of [{record:{...record,deliberatelyDroppedAcknowledgement:false}},{raw:Buffer.from('{}')},{transactionId:'other'},{receipt:{...receipt,closed:false}},{call:{...call,requestSha256:hash}}])
  assert.throws(()=>driver.assertLostAckEvidence({...base,...changes}));
});

test('observer stream persists bounded raw bytes before invoking the parser',async()=>{
 const driver=await import('../scripts/test-mac27-recovery-native.mjs');
 assert.equal(typeof driver.createDurableObserverStream,'function','durable observer stream boundary is missing');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-observer-stream-')),file=path.join(temporary,'raw');let calls=0;
 try{
  const stream=driver.createDurableObserverStream({maxBytes:8,write:async bytes=>{const handle=await fs.open(file,'a',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}},onChunk:async bytes=>{calls++;assert.equal((await fs.readFile(file)).subarray(-bytes.length).toString(),bytes.toString());}});
  await stream.push(Buffer.from('abc'));await stream.push(Buffer.from('de'));await stream.finish();assert.equal(calls,2);
  await assert.rejects(stream.push(Buffer.from('1234')),/OBSERVER_OUTPUT_LIMIT/);assert.equal(calls,2);
  const failed=driver.createDurableObserverStream({write:async()=>{throw Error('WRITE_FAILED');},onChunk:()=>{calls++;}});
  await assert.rejects(failed.push(Buffer.from('x')),/WRITE_FAILED/);assert.equal(calls,2);
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
});


test('observer overflow prevents an in-flight durable write from publishing an event',async()=>{
 const driver=await import('../scripts/test-mac27-recovery-native.mjs');let release,entered,calls=0;
 const wait=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const stream=driver.createDurableObserverStream({maxBytes:3,write:async()=>{entered();await wait;},onChunk:()=>{calls++;}});
 const first=stream.push(Buffer.from('abc'));void first.catch(()=>{});await started;
 const overflow=stream.push(Buffer.from('x'));const denied=assert.rejects(overflow,/OBSERVER_OUTPUT_LIMIT/);
 release();await denied;await assert.rejects(first,/OBSERVER_OUTPUT_LIMIT/);assert.equal(calls,0);
});

test('observer raw stream remains ordered and attributed on disk before each split-JSON callback',async()=>{
 const driver=await import('../scripts/test-mac27-recovery-native.mjs');
 assert.equal(typeof driver.createObserverReceiptWriter,'function','ordered observer receipt writer is missing');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-observer-receipt-')),directory=await fs.realpath(temporary);
 const streamId='11111111-1111-4111-8111-111111111111',request=Buffer.from('request-bytes');
 const attribution={streamId,role:'worker',phase:'post-capture-interruption',kind:'observer',pid:700,parentPid:2,executable:'/usr/bin/python3',args:['watch','700'],request};
 const expectedBytes=Buffer.from(JSON.stringify(readyEvent())+'\n'+JSON.stringify(watchEvent())+'\n');
 const chunks=[expectedBytes.subarray(0,7),expectedBytes.subarray(7,expectedBytes.length-5),expectedBytes.subarray(expectedBytes.length-5)];
 let reserved=0,seen=0;const events=[];const parser=createObserverLines(observerExpected);
 try{
  const writer=await driver.createObserverReceiptWriter({directory,...attribution,reserve:n=>{reserved+=n;}});
  const stream=driver.createDurableObserverStream({write:bytes=>writer.write(bytes),onChunk:async bytes=>{
   seen++;
   const names=await fs.readdir(directory),prefix=`observer-stream-${streamId}`;
   const manifest=JSON.parse(await fs.readFile(path.join(directory,`${prefix}-manifest.json`),'utf8'));
   assert.equal(manifest.stream_id,streamId);assert.equal(manifest.role,'worker');assert.equal(manifest.phase,attribution.phase);
   assert.equal(manifest.pid,700);assert.equal(manifest.parent_pid,2);assert.equal(manifest.executable,attribution.executable);assert.deepEqual(manifest.args,attribution.args);
   assert.equal(manifest.request.sha256,hashText(request));assert.deepEqual(await fs.readFile(path.join(directory,manifest.request.file)),request);
   const descriptors=names.filter(name=>name.startsWith(prefix+'-chunk-')&&/\d{6}\.json$/.test(name)).sort();
   assert.equal(descriptors.length,seen);
   const restored=[];
   for(let i=0;i<descriptors.length;i++){
    const descriptor=JSON.parse(await fs.readFile(path.join(directory,descriptors[i]),'utf8'));
    assert.equal(descriptor.stream_id,streamId);assert.equal(descriptor.index,i+1);
    const data=await fs.readFile(path.join(directory,descriptor.file));assert.equal(descriptor.bytes,data.length);assert.equal(descriptor.sha256,hashText(data));restored.push(data);
   }
   assert.deepEqual(Buffer.concat(restored),Buffer.concat(chunks.slice(0,seen)));
   events.push(...parser.push(bytes));
  }});
  for(const chunk of chunks)await stream.push(chunk);
  await stream.finish();assert.equal(parser.finish(),true);assert.deepEqual(events,[readyEvent(),watchEvent()]);assert.ok(reserved>=expectedBytes.length+request.length);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});


test('observer cancellation suppresses an event while durable write is pending',async()=>{
 const driver=await import('../scripts/test-mac27-recovery-native.mjs');let release,entered,calls=0;
 const wait=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const stream=driver.createDurableObserverStream({write:async()=>{entered();await wait;},onChunk:()=>{calls++;}});
 assert.equal(typeof stream.cancel,'function','stream cancellation boundary is missing');
 const first=stream.push(Buffer.from('ready'));void first.catch(()=>{});await started;
 stream.cancel(Error('CLEANUP_UNVERIFIED'));release();
 await assert.rejects(first,/CLEANUP_UNVERIFIED/);assert.equal(calls,0);
});

test('failed or timed-out observer close cancels queued events before draining writes',async()=>{
 const driver=await import('../scripts/test-mac27-recovery-native.mjs');
 assert.equal(typeof driver.guardObserverClose,'function','observer close guard is missing');
 for(const [result,options,reason] of [
  [{closed:true,code:2,signal:null},{},/CHILD_EXIT/],
  [{closed:true,code:0,signal:null,timedOut:true},{},/CHILD_TIMEOUT/],
  [{closed:true,code:0,signal:null},{rejected:Error('BAD_OBSERVER')},/BAD_OBSERVER/]
 ]){
  let release,entered,calls=0;const wait=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  const stream=driver.createDurableObserverStream({write:async()=>{entered();await wait;},onChunk:()=>{calls++;}});
  const pending=stream.push(Buffer.from('ready'));void pending.catch(()=>{});await started;
  assert.equal(driver.guardObserverClose(stream,result,options),true);
  release();await assert.rejects(pending,reason);await assert.rejects(stream.finish(),reason);assert.equal(calls,0);
 }
 let called=0;const clean=driver.createDurableObserverStream({write:async()=>{},onChunk:()=>{called++;}});
 assert.equal(driver.guardObserverClose(clean,{closed:true,code:0,signal:null},{}),false);
 await clean.push(Buffer.from('ready'));await clean.finish();assert.equal(called,1);
});

test('known abort suppresses a queued observer event before child close',async()=>{
 const driver=await import('../scripts/test-mac27-recovery-native.mjs');let release,entered,calls=0;
 const wait=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),controller=new AbortController();
 const stream=driver.createDurableObserverStream({signal:controller.signal,write:async()=>{entered();await wait;},onChunk:()=>{calls++;}});
 const pending=stream.push(Buffer.from('ready'));void pending.catch(()=>{});await started;
 controller.abort(Error('OUTPUT_LIMIT'));release();
 await assert.rejects(pending,/OUTPUT_LIMIT/);await assert.rejects(stream.finish(),/OUTPUT_LIMIT/);assert.equal(calls,0);
});
