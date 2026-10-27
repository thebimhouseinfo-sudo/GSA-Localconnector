import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import os from 'node:os';

const execute=promisify(execFile),entry=fileURLToPath(new URL('../scripts/test-mac-recovery-parent-probe.mjs',import.meta.url));
const reservation=fileURLToPath(new URL('../docs/reports/.recovery-parent-probe-20261023/attempt.json',import.meta.url));
const existing=async()=>fs.readFile(reservation).then(b=>b.toString('base64'),e=>{if(e.code==='ENOENT')return null;throw e;});

test('adapter UNKNOWN after unconfirmed cleanup cannot start inspect, even after late close',async t=>{
 const {createChildLifecycle}=await import('../scripts/mac-recovery-probe-control.mjs');
 const {inspectSettled}=await import('../scripts/test-mac-recovery-parent-probe.mjs');
 const {WorkspaceRegistry}=await import('../dist/src/core/workspace.js');
 const {FileTransactionStore}=await import('../dist/src/local/file-transaction-store.js');
 const {createMacFileRecovery}=await import('../dist/src/hosts/macos-file-recovery.js');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-probe-lifecycle-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const work=path.join(root,'work');await fs.mkdir(work,{mode:0o700});
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:'work',root:work,role:'workspace'}]);
 for(const uncertain of [true,false]){
  const lifecycle=createChildLifecycle(),calls=[];
  const adapter=createMacFileRecovery({registry,store:new FileTransactionStore(path.join(root,String(uncertain))),authorize:async()=>{},invoke:async(ref,q)=>{
   lifecycle.beforeLaunch();calls.push(q.operation);
   if(q.operation==='replace'){
    if(uncertain)lifecycle.markCleanupUnverified();else lifecycle.confirmClosed();
    throw Error(uncertain?'OWNED_CHILD_CLEANUP_UNVERIFIED':'TEST_ONLY_ACKNOWLEDGEMENT_DROPPED');
   }
   lifecycle.confirmClosed();throw Error('synthetic read-only response loss');
  }});
  const out=await adapter.replaceIfHash({workspace_id:'work',path:'item'},Buffer.from('new'),'a'.repeat(64));
  assert.equal(out.status,'UNKNOWN');
  if(uncertain){
   await assert.rejects(inspectSettled(adapter,lifecycle,out.transaction_id),/OWNED_CHILD_CLEANUP_UNVERIFIED/);
   lifecycle.confirmClosed();
   await assert.rejects(inspectSettled(adapter,lifecycle,out.transaction_id),/OWNED_CHILD_CLEANUP_UNVERIFIED/);
   assert.deepEqual(calls,['replace']);
  }else{
   await inspectSettled(adapter,lifecycle,out.transaction_id);
   assert.deepEqual(calls,['replace','inspect']);
  }
 }
});

test('receipt certification rejects malformed or mismatched native outcomes',async()=>{
 const {validateReceipt}=await import(new URL('../scripts/test-mac-recovery-parent-probe.mjs',import.meta.url));
 const request={protocol:'gsa-file-recovery-v1',transaction_id:'tx',operation:'replace',workspace_id:'work',revision:1,path:'held/item',expected_sha256:'a'.repeat(64),base64:Buffer.from('new').toString('base64')};
 const {base64,...intent}=request;intent.after_sha256=createHash('sha256').update('new').digest('hex');
 const receipt={ok:true,protocol:request.protocol,transaction_id:'tx',status:'UNKNOWN',intent,observations:{captured:false},retained_handles:[],reason:'IO_UNCERTAIN'};
 assert.equal(validateReceipt(receipt,request),true);
 assert.equal(validateReceipt({...receipt,transaction_id:'other'},request),false);
 assert.equal(validateReceipt({...receipt,observations:{captured:'false'}},request),false);
 assert.equal(validateReceipt({...receipt,intent:{...intent,after_sha256:'b'.repeat(64)}},request),false);
 assert.equal(validateReceipt({ok:false},request),false);
});

test('cached readback and restored outside capture cannot certify containment',async()=>{
 const {classifyObservation}=await import(new URL('../scripts/test-mac-recovery-parent-probe.mjs',import.meta.url));
 const event={relocated:true,preserved:true,unchanged:true,captured:false,reportedEffect:false,nativeInspectExecuted:true,inspectDidNotMutate:true,receiptsValid:true};
 assert.equal(classifyObservation(event),'OBSERVED_OUTSIDE_PRESERVED');
 assert.equal(classifyObservation({...event,nativeInspectExecuted:false}),'UNVERIFIED_NATIVE_INSPECT_NOT_EXECUTED');
 assert.equal(classifyObservation({...event,reportedEffect:true}),'BLOCKING_OUTSIDE_EFFECT');
 assert.equal(classifyObservation({...event,relocated:false}),'INCONCLUSIVE');
 assert.equal(classifyObservation({...event,relocated:false,unchanged:false}),'BLOCKING_OUTSIDE_EFFECT');
 assert.equal(classifyObservation({...event,receiptsValid:false}),'UNVERIFIED_NATIVE_RECEIPT');
});

test('default probe command reports its bounds without consuming an attempt',async()=>{
 const before=await existing(),{stdout}=await execute(process.execPath,[entry]);
 const plan=JSON.parse(stdout);
 assert.equal(plan.nativeExecution,false);assert.equal(plan.approvalRequired,true);
 assert.equal(plan.mutationInvocations,1);assert.equal(plan.inspectInvocations,1);
 assert.equal(plan.attemptReservation,reservation);assert.equal(await existing(),before);
});
test('run request without explicit acknowledgement refuses before reservation or native setup',async()=>{
 const before=await existing();
 await assert.rejects(execute(process.execPath,[entry,'--run-one']),e=>e.code===1&&e.stderr.includes('ACKNOWLEDGEMENT_REQUIRED'));
 assert.equal(await existing(),before);
});
test('importing the harness exposes the plan without running its command',async()=>{
 const before=await existing(),{getPlan}=await import(new URL('../scripts/test-mac-recovery-parent-probe.mjs',import.meta.url));
 const plan=await getPlan();assert.equal(plan.nativeExecution,false);
 assert.equal(path.isAbsolute(plan.attemptReservation),true);assert.match(plan.source_sha256,/^[a-f0-9]{64}$/);
 assert.equal(await existing(),before);
});
