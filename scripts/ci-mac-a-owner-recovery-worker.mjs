#!/usr/bin/env node
// CI-only: real production FileTransactionStore/createMacFileRecovery,
// signed native Swift broker and an inherited actual FD3 Mac owner lease.
// The coordinator executes one mutation, loses its reply, then inspects only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyMacOwner} from '../dist/src/local/mac-owner.js';
import {WorkspaceRegistry} from '../dist/src/core/workspace.js';
import {FileTransactionStore} from '../dist/src/local/file-transaction-store.js';
import {createMacFileRecovery} from '../dist/src/hosts/macos-file-recovery.js';

const root=process.env.GSA_CI_A_ROOT;
if(process.platform!=='darwin'||process.arch!=='arm64'||!root||!root.startsWith('/private/tmp/gsa-ci-a-owner-')||
   await fs.realpath(root)!==root)throw Error('OWNER_FIXTURE_ROOT_INVALID');
const identity=path.join(root,'identity'),work=path.join(root,'work');
const owner=await verifyMacOwner(identity);
assert.equal(owner.lockFD,3);
const registry=new WorkspaceRegistry();
await registry.enrollRolesTrusted([{id:'work',root:work,role:'workspace'}]);
const g=registry.requireGrant('work','write');
assert.equal(g.revision,1,'signed disposable binding must match exact grant revision');
const sha=value=>createHash('sha256').update(value).digest('hex');
const binary=path.join(root,'RecoveryBroker.app','Contents','MacOS','recovery-broker');
const journal=new FileTransactionStore(path.join(root,'file-transactions'));
const ref={workspace_id:'work',path:'item'};
const file=path.join(work,'item');
const recorded=[],operations=[];
let dropReply=true;
async function executeNative(request){
 const child=spawn(binary,[],{shell:false,
  stdio:['pipe','pipe','pipe',3],
  env:{PATH:'/usr/bin:/bin',LANG:'C',HOME:'/var/empty',TMPDIR:'/private/tmp'}});
 const pid=child.pid;
 if(!Number.isSafeInteger(pid)||pid<=1){child.kill('SIGKILL');throw Error('OWNED_HELPER_PID_UNKNOWN');}
 recorded.push(pid);
 await fs.writeFile(path.join(root,'owned-child-pids.json'),JSON.stringify(recorded),{mode:0o600});
 return new Promise((resolve,reject)=>{
  let stdout='',stderr='',failure=null;
  const timer=setTimeout(()=>{failure=Error('OWNED_HELPER_TIMEOUT');child.kill('SIGKILL');},20000);
  child.stdout.on('data',part=>{stdout+=part;if(Buffer.byteLength(stdout)>32768){failure=Error('OWNED_OUTPUT_LIMIT');child.kill('SIGKILL');}});
  child.stderr.on('data',part=>{stderr+=part;if(Buffer.byteLength(stderr)>65536){failure=Error('OWNED_DIAGNOSTIC_LIMIT');child.kill('SIGKILL');}});
  child.on('error',error=>{failure=error;});
  child.on('close',(code,signal)=>{
   clearTimeout(timer);
   if(failure||code!==0||signal)return reject(failure??Error('OWNED_HELPER_FAILED '+String(code)));
   // The exact directly owned process has been waited/reaped by Node.
   try{process.kill(pid,0);return reject(Error('OWNED_HELPER_STILL_PRESENT'));}catch(error){
    if(error.code!=='ESRCH')return reject(Error('OWNED_HELPER_STOP_UNVERIFIED'));
   }
   try{resolve(JSON.parse(stdout));}catch(error){reject(error);}
  });
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify(request));
 });
}
const io=createMacFileRecovery({
 registry,journal,store:journal,
 authorize:async id=>{registry.requireGrant(id,'write');},
 invoke:async(_ref,request)=>{
  operations.push(request.operation);
  const receipt=await executeNative(request);
  if(request.operation==='replace'&&dropReply){dropReply=false;throw Error('INTENTIONALLY_DROPPED_NATIVE_ACK');}
  return receipt;
 }
});
await fs.writeFile(file,'before',{mode:0o600,flag:'wx'});
const outcome=await io.replaceIfHash(ref,Buffer.from('after'),sha('before'));
assert.equal(outcome.status,'UNKNOWN','lost native acknowledgment must not invent success');
assert.equal((await journal.load(outcome.transaction_id)).status,'UNKNOWN','durable journal retains unknown');
assert.equal(await fs.readFile(file,'utf8'),'after','actual native broker published one file');
assert.equal(await fs.readFile(path.join(root,'recovery',outcome.transaction_id,'captured'),'utf8'),'before');
const readback=await io.readTransaction(outcome.transaction_id);
assert.equal(readback.status,'APPLIED','signed native inspect reconciles lost acknowledgment');
assert.equal((await journal.load(outcome.transaction_id)).status,'APPLIED','explicit journal readback committed');
assert.deepEqual(operations,['replace','inspect'],'no mutation replay on explicit inspect');
assert.equal((await io.readTransaction(outcome.transaction_id)).status,'APPLIED');
assert.deepEqual(operations,['replace','inspect'],'terminal readback must not call native again');
assert.equal(await fs.readFile(file,'utf8'),'after');
assert.equal(await fs.readFile(path.join(root,'outside'),'utf8'),'canary');
assert.ok(recorded.length===2&&new Set(recorded).size===2);
console.log(JSON.stringify({gate:'C-A-owner-native-coordinator',state:'PASS',ownerSession:owner.session,
 directOwnedPids:recorded,operations,journalReadback:readback.status,installedOnUserMac:false,
 limits:'Direct owned-helper closure and one native coordinator; independent checked-installation descendant qualification remains separate'}));
