import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {
 getPlan,parseArguments,createBudget,recordPhase,parseObserverReceipt,
 parsePersistedReply,assertPreflight,runPreparation,denialError,
 assertDeadline,claimWorkerEntry,mergeRunState,createObserverLines,
 classifyCanary,recordBlocking,systemInputInfo,observeOwnedClosure,
 reserveReceiptBytes,receiptRoot
} from '../scripts/test-mac27-base-native.mjs';
import {appendReceipt} from '../scripts/test-mac-directory-copy-native.mjs';

const expected={pid:12,parentPid:10,startTime:'123:4',executable:'/private/tmp/x',device:'1',inode:'2'};
const ready={event:'WATCH_READY',pid:12,parentPid:10,startTime:'123:4',device:'1',inode:'2'};
const hit={pid:12,parentPid:10,startTime:'123:4',executable:'/private/tmp/x',status:1,fd:8,device:'1',inode:'2',signal:'SIGSTOP',state:'T (stopped)'};
const stopped={...hit,status:4};

test('plan and exact acknowledgement preserve preparation-only hold and a reconciled cap',()=>{
 const p=getPlan();assert.equal(p.nativeExecution,false);assert.equal(p.status,'NOT_READY');
 assert.equal(p.caps.total,99);assert.equal(p.schedule.totalChildrenReserved,99);
 assert.equal(p.signalAccounting.managedCap,8);assert.match(p.signalAccounting.internalPrivateCommands,/UNVERIFIED/);
 assert.equal(p.releaseCompiles,0);assert.equal(p.retainedStage,true);
 assert.deepEqual(parseArguments([]),'plan');assert.deepEqual(parseArguments(['--plan']),'plan');
 assert.deepEqual(p.acknowledgement, ['--run-native','--ack-mac27-base-one-pass']);
 assert.equal(parseArguments(p.acknowledgement),'native');
 for(const args of [['--run-native'],['--plan','extra'],[...p.acknowledgement,'extra'],[...p.acknowledgement].reverse()])assert.throws(()=>parseArguments(args));
});

test('injected preparation arguments are inert and the source hold stays closed',async()=>{
 let effects=0;const proxy=new Proxy({},{get(){effects++;throw Error('injected property read');}});
 await assert.rejects(runPreparation(proxy),{code:'PRIVATE_CLI_ONLY'});assert.equal(effects,0);
 const source=await fs.readFile(fileURLToPath(new URL('../scripts/test-mac27-base-native.mjs',import.meta.url)),'utf8');
 assert.match(source,/SOURCE_REVIEW_COMPLETE\s*=\s*false/);
 assert.doesNotMatch(source,/export\s+(?:async\s+)?function\s+(?:nativeMain|workerMain|worker)\b/);
});

test('budget reservations are atomic and signal limit cannot be widened',()=>{
 const b=createBudget({signalLimit:8});b.reserve({broker:7,sign:3,tool:80,observer:3,owner:1});
 assert.equal(b.snapshot().total,94);b.reserve({broker:5});assert.equal(b.snapshot().total,99);
 assert.throws(()=>b.reserve({broker:1}),{code:'BUDGET_EXHAUSTED'});
 const before=b.snapshot();assert.throws(()=>b.reserve({signals:9}));assert.deepEqual(b.snapshot(),before);
 assert.throws(()=>createBudget({signalLimit:9}));
 b.markUnknown();assert.throws(()=>b.reserve({signals:1}),{code:'CLEANUP_UNVERIFIED'});
});

test('owner and worker reports merge without losing sticky uncertainty or signal counts',()=>{
 const owner={state:'CLEANUP_UNVERIFIED',counts:{signals:2,total:1},unresolved:['owner-close-unknown']};
 const worker={state:'BLOCKING',counts:{signals:3,total:98},unresolved:['outside-canary-mutated']};
 const result=mergeRunState(owner,worker);
 assert.equal(result.state,'BLOCKING');assert.equal(result.cleanupState,'UNVERIFIED');
 assert.equal(result.counts.signals,5);assert.equal(result.counts.total,99);
 assert.deepEqual(result.unresolved,['owner-close-unknown','outside-canary-mutated']);
 assert.throws(()=>mergeRunState(owner,{...worker,counts:{signals:7,total:99}}),{code:'BUDGET_EXHAUSTED'});
});

test('observer distinguishes pre-stop watch hit from independently stopped confirmation',()=>{
 assert.equal(parseObserverReceipt(ready,expected,'ready').event,'WATCH_READY');
 assert.equal(parseObserverReceipt(hit,expected,'watch').status,1);
 assert.equal(parseObserverReceipt(stopped,{...expected,fd:8},'stop').status,4);
 for(const mutation of [{pid:13},{startTime:'123:5'},{executable:'/other'},{fd:-1},{inode:'3'}])
  assert.throws(()=>parseObserverReceipt({...hit,...mutation},expected,'watch'));
 assert.throws(()=>parseObserverReceipt({...stopped,status:1},{...expected,fd:8},'stop'));
});

test('observer line parser accepts the actual ready then pre-stop records and rejects malformed streams',()=>{
 const parser=createObserverLines(expected),bytes=Buffer.from(`${JSON.stringify(ready)}\n${JSON.stringify(hit)}\n`);
 const events=[];for(const byte of bytes)events.push(...parser.push(Buffer.from([byte])));
 assert.deepEqual(events.map(e=>e.event??'WATCH_HIT'),['WATCH_READY','WATCH_HIT']);
 assert.equal(parser.finish(),true);
 for(const input of [Buffer.from('{bad}\n'),Buffer.from([0xff,0x0a]),Buffer.from(`${JSON.stringify(ready)}\n${JSON.stringify(ready)}\n`)]){
  const broken=createObserverLines(expected);assert.throws(()=>broken.push(input));
 }
 const oversized=createObserverLines(expected);assert.throws(()=>oversized.push(Buffer.alloc(4097,0x20)));
 const partial=createObserverLines(expected);partial.push(Buffer.from(JSON.stringify(ready)));assert.throws(()=>partial.finish());
});

test('raw receipt bytes reserve atomically against one hard cap',()=>{
 const report={receiptBytes:20};assert.equal(reserveReceiptBytes(report,5,30),25);
 const prior=report.reservedReceiptBytes;assert.throws(()=>reserveReceiptBytes(report,6,30),{code:'RECEIPT_BUDGET_EXHAUSTED'});
 assert.equal(report.reservedReceiptBytes,prior);
 assert.throws(()=>reserveReceiptBytes(report,-1,30),{code:'RECEIPT_ARGUMENT'});
});

test('owner and worker persist real raw receipts into separate filesystem namespaces',async t=>{
 const stage=await fs.mkdtemp(path.join(os.tmpdir(),'mac27-receipt-test-'));await fs.chmod(stage,0o700);
 t.after(()=>fs.rm(stage,{recursive:true,force:true}));
 const driver=await fs.readFile(fileURLToPath(new URL('../scripts/test-mac27-base-native.mjs',import.meta.url)),'utf8');
 assert.match(driver,/receiptRoot:receiptRoot\(stage,'owner'\)/);assert.match(driver,/receiptRoot:receiptRoot\(stage,'worker'\)/);
 const ownerRoot=receiptRoot(stage,'owner'),workerRoot=receiptRoot(stage,'worker');
 assert.notEqual(ownerRoot,workerRoot);assert.throws(()=>receiptRoot(stage,'other'),{code:'RECEIPT_NAMESPACE'});
 const owner={stage,receiptRoot:ownerRoot,receipts:[]},worker={stage,receiptRoot:workerRoot,receipts:[]};
 for(const [report,label] of [[owner,'owner'],[worker,'worker']])await appendReceipt(report,{kind:'guard-receipt',request:Buffer.from(`${label}-request`),response:Buffer.from(`${label}-response`),stderr:Buffer.alloc(0)});
 assert.equal(owner.receipts.length,1);assert.equal(worker.receipts.length,1);
 const files=[owner.receipts[0].files.request,owner.receipts[0].files.response,worker.receipts[0].files.request,worker.receipts[0].files.response].map(name=>path.join(stage,name));
 assert.equal(new Set(files).size,files.length);assert.deepEqual(await fs.readFile(files[0]),Buffer.from('owner-request'));
 assert.deepEqual(await fs.readFile(files[1]),Buffer.from('owner-response'));
 assert.deepEqual(await fs.readFile(files[2]),Buffer.from('worker-request'));
 assert.deepEqual(await fs.readFile(files[3]),Buffer.from('worker-response'));
});

test('owned closure waits for actual close; timeout retains sticky UNKNOWN if close never arrives',async()=>{
 const cleanBudget=createBudget(),cleanReport={state:'RUNNING'};
 const clean=new class extends EventEmitter{exitCode=0;signalCode=null;pid=41;kill(){throw Error('closed child must not be signalled');}unref(){}}();
 const cleanResult=await observeOwnedClosure(clean,Promise.resolve({code:0,signal:null}),{owner:true,timeoutMs:5,termGraceMs:1,killGraceMs:1},cleanBudget,cleanReport);
 assert.equal(cleanResult.closed,true);assert.equal(cleanResult.timedOut,undefined);assert.equal(cleanBudget.unknown,false);assert.equal(cleanReport.cleanupState,undefined);
 const budget=createBudget(),report={state:'RUNNING'};
 class Child extends EventEmitter{
  exitCode=null;signalCode=null;pid=42;
  constructor(closeOnTerm){super();this.closeOnTerm=closeOnTerm;}
  kill(signal){budget.reserve({signals:1});if(signal==='SIGTERM'&&this.closeOnTerm){this.signalCode=signal;this.emit('close',null,signal);}return true;}
  unref(){}
 }
 const child=new Child(true),closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 const result=await observeOwnedClosure(child,closed,{owner:true,timeoutMs:1,termGraceMs:5,killGraceMs:5},budget,report);
 assert.equal(result.closed,true);assert.equal(result.timedOut,true);assert.equal(report.cleanupState,'UNVERIFIED');assert.equal(budget.unknown,true);
 const unknownBudget=createBudget(),unknownReport={state:'RUNNING'};
 const stuck=new class extends EventEmitter{exitCode=null;signalCode=null;pid=43;kill(signal){unknownBudget.reserve({signals:1});return true;}unref(){}}();
 const never=new Promise(()=>{});
 await assert.rejects(observeOwnedClosure(stuck,never,{owner:false,timeoutMs:1,termGraceMs:1,killGraceMs:1},unknownBudget,unknownReport),{code:'CLEANUP_UNVERIFIED'});
 assert.equal(unknownBudget.unknown,true);assert.equal(unknownReport.cleanupState,'UNVERIFIED');
});

test('revocation denial preserves the exact production error without inventing a code',()=>{
 const error=Error('WORKSPACE_GRANT_REVOKED');assert.deepEqual(denialError(error),{code:'',message:'WORKSPACE_GRANT_REVOKED',error:'WORKSPACE_GRANT_REVOKED'});
 const coded=Object.assign(Error('revoked'),{code:'WORKSPACE_GRANT_REVOKED'});
 assert.deepEqual(denialError(coded),{code:'WORKSPACE_GRANT_REVOKED',message:'revoked',error:'WORKSPACE_GRANT_REVOKED'});
});

test('deadline is finite and shared across entry and worker; late work is rejected',()=>{
 assert.equal(assertDeadline(200,199),1);assert.throws(()=>assertDeadline(200,200),{code:'DEADLINE'});
 for(const value of [NaN,Infinity,-1])assert.throws(()=>assertDeadline(value,0),{code:'DEADLINE'});
});

test('worker entry consumes one private O_EXCL claim bound to the same input',async t=>{
 const stage=await fs.mkdtemp(path.join(os.tmpdir(),'mac27-claim-test-'));await fs.chmod(stage,0o700);
 t.after(()=>fs.rm(stage,{recursive:true,force:true}));
 const binding={stage:await fs.realpath(stage),driverSha256:'a'.repeat(64),inputSha256:'b'.repeat(64)};
 const claimed=await claimWorkerEntry(binding.stage,binding);assert.deepEqual(claimed,binding);
 await assert.rejects(claimWorkerEntry(binding.stage,binding),{code:'EEXIST'});
 await assert.rejects(claimWorkerEntry(binding.stage,{...binding,stage:path.join(binding.stage,'other')}),{code:'WORKER_RESERVATION'});
 const stat=await fs.lstat(path.join(stage,'worker-entry.json'));
 assert.equal(stat.isFile(),true);assert.equal(stat.nlink,1);assert.equal(stat.mode&0o777,0o600);
});

test('canary classification retains exact before and after evidence',()=>{
 const before={path:'/private/tmp/stage/outside/canary.bin',before_sha256:'a'.repeat(64)};
 assert.deepEqual(classifyCanary(before,'a'.repeat(64)),{path:before.path,before_sha256:before.before_sha256,after_sha256:before.before_sha256,changed:false});
 const changed=classifyCanary(before,'b'.repeat(64));assert.equal(changed.changed,true);assert.equal(changed.after_sha256,'b'.repeat(64));
});

test('outside mutation remains BLOCKING with the raw observation through outer merges',()=>{
 const report={state:'OBSERVED',unresolved:[]};recordBlocking(report,'OUTSIDE_MUTATION',{path:'/private/tmp/outside/file',before:'a'.repeat(64),after:'b'.repeat(64)});
 assert.equal(report.state,'BLOCKING');assert.equal(report.blocking[0].after,'b'.repeat(64));
 const merged=mergeRunState({state:'INCONCLUSIVE',counts:{signals:0,total:0},unresolved:[]},{...report,counts:{signals:0,total:0}});
 assert.equal(merged.state,'BLOCKING');assert.equal(merged.blocking[0].after,'b'.repeat(64));
});

test('system tool inputs allow immutable root ownership but reject writable, linked or special files',()=>{
 assert.equal(systemInputInfo({uid:0,isFile:()=>true,nlink:1,mode:0o100755},501),true);
 assert.equal(systemInputInfo({uid:501,isFile:()=>true,nlink:1,mode:0o100755},501),true);
 for(const st of [{uid:0,isFile:()=>true,nlink:2,mode:0o100755},{uid:0,isFile:()=>true,nlink:1,mode:0o100777},{uid:0,isFile:()=>false,nlink:1,mode:0o100755}])assert.throws(()=>systemInputInfo(st,501),{code:'INPUT_UNSAFE'});
});

test('persisted reply parser requires closed, complete, single JSON response',()=>{
 const receipt={persisted:true,closed:true,truncated:false,exitCode:0};
 assert.deepEqual(parsePersistedReply(Buffer.from('{"ok":true}'),receipt),{ok:true});
 for(const changed of [{persisted:false},{closed:false},{truncated:true},{exitCode:1}])assert.throws(()=>parsePersistedReply(Buffer.from('{"ok":true}'),{...receipt,...changed}));
 assert.throws(()=>parsePersistedReply(Buffer.from('{"ok":'),receipt));assert.throws(()=>parsePersistedReply(Buffer.from('{"ok":true}\n{"ok":true}'),receipt));
});

test('six-phase timeline rejects missing order, duplicates, NaN and equal times',()=>{
 const timeline={},names=['stopConfirmed','targetAbsentBeforeMove','parentRelocated','outsideTargetAbsentBeforeResume','resumed','outsideTargetObservedAfterResume'];
 assert.throws(()=>recordPhase(timeline,names[1],1));for(let i=0;i<names.length;i++)recordPhase(timeline,names[i],i+1);
 assert.deepEqual(Object.keys(timeline),names);assert.throws(()=>recordPhase(timeline,names[0],7));assert.throws(()=>recordPhase({},names[0],NaN));
 const t={};recordPhase(t,names[0],1);assert.throws(()=>recordPhase(t,names[1],1));
});

test('preflight fails closed before native effects when review, host or pins differ',()=>{
 assert.throws(()=>assertPreflight({platform:'darwin',arch:'arm64',hostRelease:'27.0.0',reviewed:false}),{code:'NOT_READY'});
 assert.throws(()=>assertPreflight({platform:'linux',arch:'arm64',hostRelease:'27.0.0',reviewed:true}),{code:'HOST_MISMATCH'});
});

test('preparation source exposes no executable worker authority from imports or test helpers',async()=>{
 const source=await fs.readFile(fileURLToPath(new URL('../scripts/test-mac27-base-native.mjs',import.meta.url)),'utf8');
 assert.match(source,/SOURCE_REVIEW_COMPLETE\s*=\s*false/);
 const envAssignment=/process\.env\.[A-Z_]+\s*=(?!=)/;
 assert.equal(envAssignment.test("process.env.X==='3'"),false);
 assert.equal(envAssignment.test("process.env.X='3'"),true);
 assert.doesNotMatch(source,/execFileSync|spawnSync/);assert.doesNotMatch(source,envAssignment);
 assert.doesNotMatch(source,/export\s+(?:async\s+)?function\s+(?:nativeMain|workerMain|worker)\b/);
});
