import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {getPlan,recordTree,validateReceipt} from '../scripts/test-mac-recovery-retained-inspect.mjs';

const script=fileURLToPath(new URL('../scripts/test-mac-recovery-retained-inspect.mjs',import.meta.url));
const intentFixture=fileURLToPath(new URL('./fixtures/mac-recovery-parent-receipt-intent.json',import.meta.url));
const reservation=fileURLToPath(new URL('../docs/reports/.recovery-parent-probe-20261023/readback.json',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function privateTemp(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-retained-inspect-test-'));
 await fs.chmod(root,0o700);return fs.realpath(root);
}
async function reservationState(){
 try{return {exists:true,bytes:await fs.readFile(reservation)};}
 catch(error){if(error.code==='ENOENT')return {exists:false};throw error;}
}

test('import and plan/default/invalid CLI paths do not launch native work or consume the readback slot',async()=>{
 const before=await reservationState();
 const plan=await getPlan();
 assert.equal(plan.nativeExecution,false);assert.equal(plan.approvalRequired,true);
 assert.equal(plan.status,'REQUIRES_REVIEW_AND_NEW_READONLY_APPROVAL');
 assert.equal(plan.mutationInvocations,0);assert.equal(plan.relocations,0);assert.equal(plan.replays,0);
 assert.equal(plan.inspectInvocations,1,'this is the proposed future inspect budget, not an invocation');
 assert.equal(plan.driver_sha256,'cfa15e39bce70899ffa7481d5bb7c9f339b9108631450fd8c73b070ae63c9293');
 assert.equal(plan.driver_sha256,sha(await fs.readFile(script)));
 for(const args of [[],['--plan']]){
  const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).nativeExecution,false);
 }
 for(const args of [['--unknown'],['--run-one','--ack-new-readonly-approval-typo']]){
  const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);assert.match(result.stderr,/INVALID_ARGUMENTS_OR_ACKNOWLEDGEMENT/);
 }
 assert.deepEqual(await reservationState(),before,'import, plan and invalid arguments must leave the fixed slot unchanged');
});

test('receipt validator accepts the archived receipt intent and exact retained-inspect outcome only',async()=>{
 // This standalone validator fixture is extracted from the archived mutation
 // receipt. Its canonical digest is pinned here so the unit test requires neither
 // an ignored report nor a lost journal, and cannot silently accept changed data.
 // It does not reconstruct or attest the lost native journal file.
 const fixtureIntent=JSON.parse(await fs.readFile(intentFixture,'utf8'));
 assert.equal(sha(Buffer.from(JSON.stringify(fixtureIntent))),'b6cb0d11b1ff0c46da8c37e1ced9e3fc72ee7da51f81f0be7d3adee261c94f6f');
 const transaction=fixtureIntent.transaction_id;
 const receipt={ok:true,protocol:'gsa-file-recovery-v1',transaction_id:transaction,status:'UNKNOWN',
  intent:fixtureIntent,observations:{captured:false},retained_handles:[],reason:'PATH_OUTSIDE_SCOPE'};
 assert.equal(validateReceipt(receipt,fixtureIntent),true);
 const invalid=[
  {...receipt,reason:'IO_UNCERTAIN'},
  {...receipt,status:'APPLIED'},
  {...receipt,observations:{captured:true}},
  {...receipt,retained_handles:[transaction]},
  {...receipt,extra:true},
  {...receipt,intent:{...fixtureIntent,path:'different/path'}},
  {...receipt,observations:{captured:false,source_absent:true}},
 ];
 for(const changed of invalid)assert.throws(()=>validateReceipt(changed,fixtureIntent));
});

test('recordTree is deterministic, read-only, and returns sorted bounded metadata',async()=>{
 const root=await privateTemp();
 try{
  await fs.mkdir(path.join(root,'sub'),{mode:0o700});
  await fs.writeFile(path.join(root,'z.txt'),'z',{mode:0o600});
  await fs.writeFile(path.join(root,'sub','a.txt'),'alpha',{mode:0o600});
  const beforeBytes=await fs.readFile(path.join(root,'sub','a.txt'));
  const beforeStat=await fs.stat(path.join(root,'sub','a.txt'));
  const first=await recordTree(root),second=await recordTree(root);
  assert.deepEqual(second,first);
  assert.deepEqual(first.map(row=>row.path),['.','sub','sub/a.txt','z.txt']);
  assert.equal(first.find(row=>row.path==='sub/a.txt').sha256,sha(Buffer.from('alpha')));
  assert.deepEqual(await fs.readFile(path.join(root,'sub','a.txt')),beforeBytes);
  const afterStat=await fs.stat(path.join(root,'sub','a.txt'));
  assert.equal(afterStat.ino,beforeStat.ino);assert.equal(afterStat.mtimeMs,beforeStat.mtimeMs);assert.equal(afterStat.ctimeMs,beforeStat.ctimeMs);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('recordTree rejects symlinks and trees exceeding its entry bound',async()=>{
 const root=await privateTemp();
 try{
  await fs.writeFile(path.join(root,'target'),'safe',{mode:0o600});
  await fs.symlink(path.join(root,'target'),path.join(root,'link'));
  await assert.rejects(recordTree(root),/UNSAFE_TREE_ENTRY/);
  await fs.unlink(path.join(root,'link'));
  for(let i=0;i<128;i++)await fs.writeFile(path.join(root,`entry-${String(i).padStart(3,'0')}`),'x',{mode:0o600});
  await assert.rejects(recordTree(root),/TREE_LIMIT/);
  assert.equal((await fs.readdir(root)).length,129,'tree recording must not alter entries on limit failure');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
