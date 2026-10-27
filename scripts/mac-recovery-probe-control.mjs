#!/usr/bin/env node
// Import-safe controls shared by the one-slot Mac recovery probe harness.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';

const ownUid=()=>process.getuid?.();
const failure=(code,message)=>Object.assign(Error(message),{code});
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const sameIdentity=(a,b)=>a?.device===b?.device&&a?.inode===b?.inode;
const validIdentity=value=>exactKeys(value,['device','inode'])&&
 typeof value.device==='string'&&/^\d{1,32}$/.test(value.device)&&
 typeof value.inode==='string'&&/^\d{1,32}$/.test(value.inode);
const validFileIdentity=value=>value&&typeof value==='object'&&validIdentity({device:value.device,inode:value.inode});
const sameProcess=(a,b)=>exactKeys(a,['pid','startTime'])&&exactKeys(b,['pid','startTime'])&&
 Number.isSafeInteger(a.pid)&&typeof a.startTime==='string'&&a.startTime.length>0&&a.startTime.length<=128&&
 a.pid===b.pid&&a.startTime===b.startTime;

/** Cleanup uncertainty is permanent for this fixture, including after late close. */
export function createChildLifecycle(){
 let active=false,uncertain=false;
 const assertIdle=()=>{
  if(uncertain||active)throw failure('OWNED_CHILD_CLEANUP_UNVERIFIED','OWNED_CHILD_CLEANUP_UNVERIFIED');
 };
 return Object.freeze({
  assertIdle,
  beforeLaunch(){assertIdle();active=true;},
  confirmClosed(){active=false;},
  markCleanupUnverified(){uncertain=true;},
  get cleanupUnverified(){return uncertain;}
 });
}

async function verifyReservationParent(parent){
 if(!path.isAbsolute(parent)||path.resolve(parent)!==parent)throw failure('PROBE_UNSAFE_PARENT','reservation parent must be an absolute canonical directory');
 const uid=ownUid();if(uid===undefined)throw failure('PROBE_UNSAFE_PARENT','current uid is unavailable');
 if(await fs.realpath(parent)!==parent)throw failure('PROBE_UNSAFE_PARENT','reservation parent is not canonical');
 const components=parent.split(path.sep).filter(Boolean);let current=path.parse(parent).root;
 for(let index=0;index<=components.length;index++){
  const info=await fs.lstat(current);
  if(info.isSymbolicLink()||!info.isDirectory())throw failure('PROBE_UNSAFE_PARENT','reservation ancestry contains a symlink or non-directory');
  const isFinal=index===components.length;
  if(isFinal){
   if(info.uid!==uid||(info.mode&0o022)!==0)throw failure('PROBE_UNSAFE_PARENT','reservation parent must be user-owned and not writable by group or others');
  }else if((info.mode&0o022)!==0&&!(info.uid===0&&(info.mode&0o1000)!==0)){
   throw failure('PROBE_UNSAFE_PARENT','reservation ancestry has an unsafe writable directory');
  }
  if(index<components.length)current=path.join(current,components[index]);
 }
}

/** Atomically consume a durable attempt slot. Existing reservations are never reused. */
export async function reserveAttempt(file,metadata){
 if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file)throw failure('PROBE_INVALID_RESERVATION_PATH','reservation path must be absolute and normalized');
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw failure('PROBE_INVALID_RESERVATION','reservation metadata must be an object');
 const parent=path.dirname(file);await verifyReservationParent(parent);
 const bytes=Buffer.from(JSON.stringify(metadata)+'\n','utf8');
 const flags=constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0);
 const handle=await fs.open(file,flags,0o600);
 try{
  const info=await handle.stat();
  if(!info.isFile()||info.nlink!==1||info.uid!==ownUid()||(info.mode&0o777)!==0o600)throw failure('PROBE_UNSAFE_RESERVATION','new reservation file did not retain private owner-only identity');
  await handle.writeFile(bytes);await handle.sync();
 }finally{await handle.close();}
 // Do not unlink a partial reservation after a failure: ambiguity consumes the slot.
 const directory=await fs.open(parent,constants.O_RDONLY);
 try{await directory.sync();}finally{await directory.close();}
 return JSON.parse(bytes.toString('utf8'));
}

/** At most one replacement and one later read-only inspection. */
export function createInvocationBudget(){
 let replace=0,inspect=0;
 return Object.freeze({
  consume(operation){
   if(operation==='replace'){
    if(replace!==0)throw failure('PROBE_BUDGET_EXHAUSTED','the single mutation invocation is already consumed');
    replace=1;return replace;
   }
   if(operation==='inspect'){
    if(replace!==1)throw failure('PROBE_ORDER_INVALID','read-only inspection requires a prior mutation invocation');
    if(inspect!==0)throw failure('PROBE_BUDGET_EXHAUSTED','the single read-only inspection is already consumed');
    inspect=1;return inspect;
   }
   throw failure('PROBE_OPERATION_FORBIDDEN','only one replace and one inspect are allowed');
  }
 });
}

/** Parse the independent libproc observer's strict machine receipt, never its legacy HIT line. */
export function parseObserverHit(text,expected){
 let value;try{value=JSON.parse(text);}catch{throw failure('PROBE_OBSERVATION_INVALID','observer output is not JSON');}
 if(!exactKeys(value,['format','pid','processIdentity','fd','parentIdentity','stop','confirmation'])||
    value.format!=='libproc-owned-pid-fd-v1'||!Number.isSafeInteger(value.pid)||value.pid<1||
    !Number.isSafeInteger(value.fd)||value.fd<0||!validIdentity(value.parentIdentity))
  throw failure('PROBE_OBSERVATION_INVALID','observer receipt has an invalid top-level shape');
 if(!expected||!Number.isSafeInteger(expected.pid)||!validIdentity({device:expected.device,inode:expected.inode})||
    !sameProcess(value.processIdentity,expected.processIdentity)||value.pid!==expected.pid||
    value.processIdentity.pid!==expected.pid||!sameIdentity(value.parentIdentity,{device:expected.device,inode:expected.inode}))
  throw failure('PROBE_OBSERVATION_MISMATCH','observer receipt does not identify the expected owned process and parent inode');
 const stop=value.stop,confirmation=value.confirmation;
 if(!exactKeys(stop,['pid','processIdentity','signal','state'])||stop.pid!==expected.pid||
    !sameProcess(stop.processIdentity,expected.processIdentity)||stop.signal!=='SIGSTOP'||
    typeof stop.state!=='string'||!/^T/.test(stop.state))
  throw failure('PROBE_STOP_UNCONFIRMED','observer did not prove SIGSTOP on the same process identity');
 if(!exactKeys(confirmation,['pid','processIdentity','fd','parentIdentity'])||confirmation.pid!==expected.pid||
    !sameProcess(confirmation.processIdentity,expected.processIdentity)||confirmation.fd!==value.fd||
    !validIdentity(confirmation.parentIdentity)||!sameIdentity(confirmation.parentIdentity,{device:expected.device,inode:expected.inode}))
  throw failure('PROBE_FD_UNCONFIRMED','independent confirmation did not prove the same parent FD inode');
 return Object.freeze({pid:value.pid,processIdentity:Object.freeze({...value.processIdentity}),fd:value.fd,parentIdentity:Object.freeze({...value.parentIdentity})});
}

/** Relocation is eligible only when the held namespace and durable capture state are unchanged. */
export function checkEligibility(input){
 const reasons=[];
 if(!input||typeof input!=='object')return {eligible:false,reasons:['invalid input']};
 const {original,observed,capturedExists,stopped,processMatches,fdMatches}=input;
 if(!original||original.exists!==true||!validFileIdentity(original)||typeof original.sha256!=='string'||!/^[a-f0-9]{64}$/.test(original.sha256))reasons.push('original source identity or hash is invalid');
 if(!observed||observed.exists!==true||!validFileIdentity(observed)||typeof observed.sha256!=='string'||!/^[a-f0-9]{64}$/.test(observed.sha256))reasons.push('source is absent or its observed identity/hash is invalid');
 if(original&&observed&&validFileIdentity(original)&&validFileIdentity(observed)&&!sameIdentity(original,observed))reasons.push('source inode changed before relocation');
 if(original&&observed&&original.sha256!==observed.sha256)reasons.push('source bytes changed before relocation');
 if(capturedExists!==false)reasons.push('recovery capture already exists or is unverified');
 if(stopped!==true)reasons.push('SIGSTOP state is not confirmed');
 if(processMatches!==true)reasons.push('owned process identity is not confirmed');
 if(fdMatches!==true)reasons.push('held parent FD identity is not confirmed');
 return {eligible:reasons.length===0,reasons};
}
