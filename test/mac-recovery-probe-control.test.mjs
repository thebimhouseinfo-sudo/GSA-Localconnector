import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {reserveAttempt,createInvocationBudget,parseObserverHit,checkEligibility} from '../scripts/mac-recovery-probe-control.mjs';

async function privateTemp(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-recovery-control-'));
 await fs.chmod(root,0o700);
 return fs.realpath(root);
}
const sameIdentity={device:'42',inode:'9102'};
function observation(overrides={}){
 const processIdentity={pid:314,startTime:'2026-10-23T02:01:03.000Z'};
 return {
  format:'libproc-owned-pid-fd-v1',pid:314,processIdentity,fd:8,parentIdentity:sameIdentity,
  stop:{pid:314,processIdentity,signal:'SIGSTOP',state:'T'},
  confirmation:{pid:314,processIdentity,fd:8,parentIdentity:sameIdentity},
  ...overrides
 };
}

test('attempt reservation is exclusive, durable, and never reused',async()=>{
 const root=await privateTemp(),file=path.join(root,'attempt.json');
 try{
  const metadata={historicalAttempts:5,attemptIndex:6,mutation:'replace'};
  assert.deepEqual(await reserveAttempt(file,metadata),metadata);
  const stat=await fs.lstat(file);assert.equal(stat.isFile(),true);assert.equal(stat.nlink,1);assert.equal(stat.mode&0o777,0o600);
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),metadata);
  await assert.rejects(reserveAttempt(file,{...metadata,attemptIndex:7}),{code:'EEXIST'});
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),metadata,'a later invocation cannot overwrite the consumed slot');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('reservation rejects unsafe or symlinked parents before creating the slot',async()=>{
 const root=await privateTemp(),unsafe=path.join(root,'unsafe'),target=path.join(unsafe,'attempt.json'),linked=path.join(root,'linked');
 try{
  await fs.mkdir(unsafe,{mode:0o777});await fs.chmod(unsafe,0o777);
  await assert.rejects(reserveAttempt(target,{attemptIndex:6}),{code:'PROBE_UNSAFE_PARENT'});
  await fs.symlink(root,linked);
  await assert.rejects(reserveAttempt(path.join(linked,'attempt.json'),{attemptIndex:6}),/symlink|canonical|unsafe/i);
  await assert.rejects(fs.lstat(target),{code:'ENOENT'});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('invocation budget permits one replace and one later inspect, never replay',()=>{
 const budget=createInvocationBudget();
 assert.equal(budget.consume('replace'),1);
 assert.equal(budget.consume('inspect'),1);
 assert.throws(()=>budget.consume('replace'),{code:'PROBE_BUDGET_EXHAUSTED'});
 assert.throws(()=>budget.consume('inspect'),{code:'PROBE_BUDGET_EXHAUSTED'});
 assert.throws(()=>createInvocationBudget().consume('inspect'),{code:'PROBE_ORDER_INVALID'});
 assert.throws(()=>createInvocationBudget().consume('trash'),{code:'PROBE_OPERATION_FORBIDDEN'});
});

test('observer parser requires exact owned pid, stable process tuple, fd and stopped proof',()=>{
 const processIdentity={pid:314,startTime:'2026-10-23T02:01:03.000Z'};
 const expected={pid:314,...sameIdentity,processIdentity};
 const parsed=parseObserverHit(JSON.stringify(observation()),expected);
 assert.deepEqual(parsed,{pid:314,processIdentity:{pid:314,startTime:'2026-10-23T02:01:03.000Z'},fd:8,parentIdentity:sameIdentity});
 assert.throws(()=>parseObserverHit('HIT 8 1 42 9102 stop=0',expected),/observation|JSON|format/i);
 assert.throws(()=>parseObserverHit(JSON.stringify(observation({pid:315})),expected),{code:'PROBE_OBSERVATION_MISMATCH'});
 assert.throws(()=>parseObserverHit(JSON.stringify(observation({confirmation:{...observation().confirmation,fd:9}})),expected),/fd|confirm/i);
 const badFdIdentity=observation();badFdIdentity.confirmation.parentIdentity={device:'42',inode:'9103'};
 assert.throws(()=>parseObserverHit(JSON.stringify(badFdIdentity),expected),/identity|inode|confirm/i);
 assert.throws(()=>parseObserverHit(JSON.stringify(observation({stop:{...observation().stop,state:'S'}})),expected),/stop|state/i);
});

test('relocation eligibility requires unchanged source, no capture, exact stop and same owned fd',()=>{
 const input={
  original:{exists:true,...sameIdentity,sha256:'a'.repeat(64)},
  observed:{exists:true,...sameIdentity,sha256:'a'.repeat(64)},
  capturedExists:false,stopped:true,processMatches:true,fdMatches:true
 };
 assert.deepEqual(checkEligibility(input),{eligible:true,reasons:[]});
 for(const [key,value] of [
  ['capturedExists',true],['stopped',false],['processMatches',false],['fdMatches',false],
  ['observed',{exists:false,...sameIdentity,sha256:'a'.repeat(64)}],
  ['observed',{exists:true,device:'42',inode:'9103',sha256:'a'.repeat(64)}],
  ['observed',{exists:true,...sameIdentity,sha256:'b'.repeat(64)}]
 ]){
  const result=checkEligibility({...input,[key]:value});assert.equal(result.eligible,false,`must refuse relocation when ${key} is unsafe`);assert.ok(result.reasons.length>0);
 }
});
