#!/usr/bin/env node
/** SOURCE PREPARATION ONLY. Native orchestration is implemented but unexecuted.
 * Pure guards do not certify signatures, ownership, containment or recovery.
 * Neither exact argv nor a new date replenishes an existing attempt slot. */
import path from 'node:path';
import fs from 'node:fs/promises';
import {constants,fstat} from 'node:fs';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {captureBoundedStream,waitForChildClose} from './test-mac-directory-copy-native.mjs';

const script=fileURLToPath(import.meta.url);
const root=path.resolve(path.dirname(script),'..');
const SOURCE_REVIEW_COMPLETE=false;
const IMPLEMENTATION_COMPLETE=false;
const caps=Object.freeze({broker:17,sign:4,compile:2,observer:6,owner:1,tool:128,total:158,relocation:1,signals:12});
const bounds=Object.freeze({runMs:180000,watchMs:5500,watchIterations:2000,watchStops:1,requestBytes:12*1024*1024,responseBytes:1024*1024,diagnosticBytes:65536,observerBytes:4096,receiptBytes:64*1024*1024});
const schedule=Object.freeze([
 {name:'normal-replace',calls:['replace'],provenance:'PRODUCTION_ROUNDTRIP'},
 {name:'lost-acknowledgement',calls:['replace','inspect'],provenance:'TRANSPORT_FAULT'},
 {name:'normal-trash',calls:['trash'],provenance:'PRODUCTION_ROUNDTRIP'},
 {name:'wrong-expected-hash',calls:['replace'],provenance:'PRODUCTION_CONFLICT'},
 {name:'existing-transaction-id',calls:['replace'],provenance:'DIRECT_NATIVE_DUPLICATE'},
 {name:'staged-only',calls:['inspect'],provenance:'STRUCTURAL_READBACK_ONLY'},
 {name:'captured-without-final',calls:['inspect'],provenance:'STRUCTURAL_READBACK_ONLY'},
 {name:'published-without-final',calls:['inspect'],provenance:'STRUCTURAL_READBACK_ONLY'},
 {name:'held-parent-relocation',calls:['replace','inspect'],provenance:'OBSERVED_BOUNDARY_PHASE'},
 {name:'staging-interruption',calls:['replace','inspect'],provenance:'WRITE_INTERRUPTION'},
 {name:'post-capture-interruption',calls:['replace','inspect'],provenance:'OBSERVED_PROCESS_INTERRUPTION'},
 {name:'diagnostic-sync-error',calls:['replace','inspect'],provenance:'DIAGNOSTIC_ONLY'}
].map(item=>Object.freeze({...item,calls:Object.freeze(item.calls)})));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const failure=(code)=>Object.assign(Error(code),{code});
const demand=(value,code)=>{if(!value)throw failure(code);};
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sameIdentity=(a,b)=>a&&b&&typeof a.device==='string'&&typeof a.inode==='string'&&a.device===b.device&&a.inode===b.inode&&/^\d+$/.test(a.device)&&/^\d+$/.test(a.inode);

export function getPlan(){
 return {status:SOURCE_REVIEW_COMPLETE&&IMPLEMENTATION_COMPLETE?'REVIEWED':'NOT_READY',nativeExecution:SOURCE_REVIEW_COMPLETE&&IMPLEMENTATION_COMPLETE,activation:false,implementationComplete:IMPLEMENTATION_COMPLETE,sourceReviewComplete:SOURCE_REVIEW_COMPLETE,
  attemptReservation:path.join(root,'docs/reports/.mac27-recovery-native-v1.attempt.json'),caps:{...caps},bounds:{...bounds},
  schedule:schedule.map(item=>({...item,calls:[...item.calls]})),brokerCalls:schedule.reduce((n,item)=>n+item.calls.length,0),
  acknowledgement:['--run-native','--ack-mac27-recovery-one-pass'],
  unresolved:['INDEPENDENT_SOURCE_REVIEW_PENDING','GUARD_EXECUTION_PENDING','EXPLICIT_NEW_NATIVE_AUTHORIZATION_PENDING'],
  implementationStatus:'IMPLEMENTED_UNVERIFIED',unimplemented:[],commandGraph:getCommandGraph(),
  signalAccounting:{managedCap:caps.signals,compilerPrivateDescendants:'UNVERIFIED'},retainedStage:true};
}

export function parseArguments(argv){
 demand(Array.isArray(argv),'ARGUMENTS');
 if(argv.length===0||argv.length===1&&argv[0]==='--plan')return 'plan';
 if(argv.length===2&&argv[0]==='--run-native'&&argv[1]==='--ack-mac27-recovery-one-pass')return 'native';
 throw failure('ACKNOWLEDGEMENT_REQUIRED');
}

/** Atomic, monotonic reservations. Failed reservations consume nothing. */
export function createBudget({childLimit=caps.total,signalLimit=caps.signals,ownerLimit=caps.owner}={}){
 demand(Number.isSafeInteger(childLimit)&&childLimit>=0&&childLimit<=caps.total&&Number.isSafeInteger(signalLimit)&&signalLimit>=0&&signalLimit<=caps.signals&&Number.isSafeInteger(ownerLimit)&&ownerLimit>=0&&ownerLimit<=caps.owner,'BUDGET_ARGUMENT');
 const used=Object.fromEntries(Object.keys(caps).map(key=>[key,0]));let unknown=false;
 return Object.freeze({
  reserve(request){
   demand(!unknown,'CLEANUP_UNVERIFIED');
   demand(request&&typeof request==='object'&&!Array.isArray(request),'BUDGET_ARGUMENT');
   const next={...used};let children=0;
   for(const [kind,count] of Object.entries(request)){
    demand(Object.hasOwn(caps,kind)&&kind!=='total'&&Number.isSafeInteger(count)&&count>=0,'BUDGET_ARGUMENT');
    next[kind]+=count;if(['broker','sign','compile','observer','owner','tool'].includes(kind))children+=count;
   }
   next.total+=children;
   for(const [kind,cap] of Object.entries(caps))demand(next[kind]<=(kind==='total'?childLimit:kind==='signals'?signalLimit:kind==='owner'?ownerLimit:cap),'BUDGET_EXHAUSTED');
   Object.assign(used,next);return Object.freeze({...used});
  },
  snapshot:()=>Object.freeze({...used}),markUnknown(){unknown=true;},get unknown(){return unknown;}
 });
}

export function assertDeadline(deadline,current){
 demand(Number.isFinite(deadline)&&Number.isFinite(current)&&current<deadline,'DEADLINE');return deadline-current;
}

/** One checked source-copy substitution; never modifies the production file.
 * This simulates a branch error, not a real kernel fsync failure. */
export function generateDiagnosticSource(source){
 demand(typeof source==='string'&&Buffer.byteLength(source)<=256*1024,'DIAGNOSTIC_SOURCE');
 const anchor='  retained=true;observations["captured"]=true\n  try check(fsync(fd)==0 && fsync(tx)==0,"IO_UNCERTAIN")';
 demand(source.split(anchor).length===2,'DIAGNOSTIC_SUBSTITUTION');
 const replacement='  retained=true;observations["captured"]=true\n  try check(false,"IO_UNCERTAIN") // DIAGNOSTIC_ONLY: simulated post-capture sync error';
 const bytes=source.replace(anchor,replacement);
 return Object.freeze({source:bytes,productionSourceSha256:sha(source),diagnosticSourceSha256:sha(bytes),substitutions:1,provenance:'DIAGNOSTIC_ONLY',actualKernelFailure:false});
}

/** A matching source FD before capture is explicitly ineligible to signal. */
export function evaluateCaptureGate(observation,expected){
 if(!observation||!expected)return Object.freeze({eligible:false,reason:'MISSING_OBSERVATION'});
 const captured=observation.captured;
 if(captured?.present!==true||!sameIdentity(captured,expected.capturedIdentity))return Object.freeze({eligible:false,reason:'CAPTURE_NAME_UNVERIFIED'});
 const owned=Number.isSafeInteger(expected.pid)&&expected.pid>1&&Number.isSafeInteger(expected.parentPid)&&expected.parentPid>1&&/^\d+:\d+$/.test(expected.startTime)&&typeof expected.executable==='string'&&path.isAbsolute(expected.executable)&&['pid','parentPid','startTime','executable'].every(key=>observation[key]===expected[key]);
 if(!owned||!Number.isSafeInteger(observation.fd)||observation.fd<0||(expected.fd!==undefined&&observation.fd!==expected.fd)||!sameIdentity({device:observation.fdDevice,inode:observation.fdInode},expected.heldIdentity))return Object.freeze({eligible:false,reason:'OWNED_FD_UNVERIFIED'});
 return Object.freeze({eligible:true,reason:'CAPTURE_NAME_AND_OWNED_FD_OBSERVED'});
}

export function assertStoppedCapture(observation,expected){
 demand(evaluateCaptureGate(observation,expected).eligible,'CAPTURE_GATE');
 demand(typeof observation.state==='string'&&/^T/.test(observation.state)&&observation.sourceAbsent===true&&observation.staged?.present===true&&sameIdentity(observation.staged,expected.stagedIdentity),'STOPPED_CAPTURE_PHASE');
 return true;
}

export function validateObserverEvent(value,expected,kind){
 demand(value&&typeof value==='object'&&!Array.isArray(value),'OBSERVER_JSON');
 demand(['pid','parentPid','startTime'].every(key=>value[key]===expected[key])&&Number.isSafeInteger(value.pid)&&value.pid>1&&Number.isSafeInteger(value.parentPid)&&value.parentPid>1&&/^\d+:\d+$/.test(value.startTime),'OBSERVER_IDENTITY');
 if(kind==='ready'){demand(value.event==='WATCH_READY'&&sameIdentity(value,expected.heldIdentity),'OBSERVER_READY');return value;}
 demand(value.executable===expected.executable&&Number.isSafeInteger(value.status),'OBSERVER_IDENTITY');
 if(kind==='identity')return value;
 demand(Number.isSafeInteger(value.fd)&&value.fd>=0&&sameIdentity(value,expected.heldIdentity)&&(expected.fd===undefined||value.fd===expected.fd)&&value.signal==='SIGSTOP','OBSERVER_FD');
 if(kind==='confirm'){demand(value.status===4&&/^T/.test(value.state),'OBSERVER_STOP');return value;}
 demand(kind==='watch'&&value.event==='STOP_SENT'&&value.phase===expected.phase&&Number.isSafeInteger(value.iteration)&&value.iteration>=1&&value.iteration<=bounds.watchIterations&&Number.isFinite(value.elapsedMs)&&value.elapsedMs>=0&&value.elapsedMs<=bounds.watchMs,'OBSERVER_WATCH');
 if(expected.phase==='capture')demand(evaluateCaptureGate(value,expected).eligible,'CAPTURE_GATE');return value;
}

export function createObserverLines(expected){
 const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,pending='',count=0;
 return Object.freeze({push(chunk){bytes+=chunk.length;demand(bytes<=bounds.observerBytes,'OBSERVER_OUTPUT_LIMIT');pending+=decoder.decode(chunk,{stream:true});const events=[];let end;while((end=pending.indexOf('\n'))>=0){demand(count<2,'OBSERVER_RECORD_ORDER');const line=pending.slice(0,end);pending=pending.slice(end+1);const value=validateObserverEvent(JSON.parse(line),expected,count===0?'ready':'watch');count++;events.push(value);}return events;},finish(){pending+=decoder.decode();demand(count===2&&pending==='','OBSERVER_RECEIPT_MISSING');return true;}});
}

export function assertFrozenInputs(current,pinned){
 demand(current&&pinned&&isDeepStrictEqual(current.sourceHashes,pinned.sourceHashes)&&isDeepStrictEqual(current.runtime,pinned.runtime),'FROZEN_INPUT_CHANGED');return true;
}

export function validateScheduledCall(index,call){
 const ordered=schedule.flatMap(row=>row.calls.map(operation=>({operation,variant:row.name==='diagnostic-sync-error'?'diagnostic':'production',direct:row.name==='existing-transaction-id'})));
 demand(Number.isSafeInteger(index)&&index>=0&&index<ordered.length&&call&&isDeepStrictEqual({operation:call.operation,variant:call.variant,direct:call.direct===true},ordered[index]),'NATIVE_SCHEDULE_MISMATCH');return true;
}

export function assertNativeAdmission(setup,index,call){demand(setup?.setupComplete===true,'SETUP_BEFORE_NATIVE');return validateScheduledCall(index,call);}

/** Local filesystem primitive only, never an execution/admission capability.
 * The private CLI alone chooses the fixed native slot. Tests use their own dirs. */
export async function reserveOneShot(file,payload){
 demand(typeof file==='string'&&path.isAbsolute(file)&&path.normalize(file)===file&&await fs.realpath(path.dirname(file))===path.dirname(file),'ATTEMPT_PARENT');
 await durableWrite(file,JSON.stringify(payload));
}

export async function claimWorkerEntry(stage,binding){
 await privateDirectory(stage);demand(binding?.stage===stage&&digest(binding.inputSha256)&&digest(binding.driverSha256),'WORKER_RESERVATION');
 await durableWrite(path.join(stage,'worker-entry.json'),JSON.stringify(binding));return true;
}

/** Operates only on a supplied owned handle. Tests can supply inert fake handles;
 * no spawn, PID lookup or native CLI authority is exposed by this helper. */
export async function observeOwnedClosure(child,closed,options,budget,report){
 try{const result=await waitForChildClose(child,closed,options);if(options?.owner===true&&result.timedOut){budget.markUnknown();report.cleanupState='UNVERIFIED';if(report.state!=='BLOCKING')report.state='CLEANUP_UNVERIFIED';}return result;}
 catch(error){budget.markUnknown();report.cleanupState='UNVERIFIED';if(report.state!=='BLOCKING')report.state='CLEANUP_UNVERIFIED';throw error;}
}

export function classifyRelocation(observation){
 if(observation?.outsideChanged===true||observation?.canariesUnchanged===false)return {state:'BLOCKING',phase:observation.phase??'unverified',exercisedSyscalls:[]};
 const phases=['pre-capture-read','capture','publication','restoration'];
 if(observation?.phaseVerified!==true||observation?.denied!==true||observation?.canariesUnchanged!==true||!phases.includes(observation.phase))return {state:'INCONCLUSIVE',phase:'unverified',exercisedSyscalls:[]};
 return {state:'OBSERVED_DENIAL',phase:observation.phase,exercisedSyscalls:observation.phase==='pre-capture-read'?[]:[observation.phase]};
}

/** Structural setup guard only. Real filesystem/signature checks remain TODO. */
export function assertPreparedSetup(setup){
 demand(setup&&setup.hostRelease==='27.0.0'&&setup.arch==='arm64','HOST_BINDING');
 for(const key of ['driverSha256','candidateSourceSha256','compiledGraphSha256','ownerLauncherSha256','observerSha256','baseEvidenceSha256','baseReleaseSha256','baseCodeSha256'])demand(digest(setup[key]),'INPUT_HASH');
 demand(setup.baseUnchanged===true&&setup.recipeValidated===true&&setup.wrappersValidated===true&&setup.ownerVerified===true&&setup.signingProfile==='gsa-recovery-adhoc-two-root-v1','SETUP_UNVERIFIED');
 demand(setup.brokerCalls===17&&setup.explicitSpawnUpperBound===158,'CALL_GRAPH');return true;
}

export function reserveReceiptBytes(report,bytes,cap=bounds.receiptBytes){
 const used=Object.hasOwn(report,'reservedReceiptBytes')?report.reservedReceiptBytes:0;
 demand(Number.isSafeInteger(cap)&&cap>=0&&cap<=bounds.receiptBytes&&Number.isSafeInteger(used)&&used>=0&&Number.isSafeInteger(bytes)&&bytes>=0&&used+bytes<=cap,'RECEIPT_BUDGET_EXHAUSTED');
 report.reservedReceiptBytes=used+bytes;return report.reservedReceiptBytes;
}

export function mergeRunState(owner,worker){
 const blocking=[owner,worker].some(value=>value?.state==='BLOCKING');
 const uncertain=[owner,worker].some(value=>['UNKNOWN','CLEANUP_UNVERIFIED'].includes(value?.state)||value?.cleanupState==='UNVERIFIED');
 const kinds=['broker','sign','compile','observer','owner','tool'];
 for(const value of [owner,worker])if(value?.counts){const computed=kinds.reduce((n,key)=>n+(value.counts[key]??0),0);demand(value.counts.total===computed,'COUNT_TOTAL_MISMATCH');}
 const counts={};for(const [kind,cap] of Object.entries(caps)){const a=owner?.counts?.[kind]??0,b=worker?.counts?.[kind]??0;demand(Number.isSafeInteger(a)&&a>=0&&Number.isSafeInteger(b)&&b>=0&&a+b<=cap,'BUDGET_EXHAUSTED');counts[kind]=a+b;}
 return {state:blocking?'BLOCKING':uncertain?'CLEANUP_UNVERIFIED':'INCONCLUSIVE',cleanupState:'UNVERIFIED',counts,unresolved:[...(owner?.unresolved??[]),...(worker?.unresolved??[])]};
}

const authority=Object.freeze({});
const baseCandidate='/private/tmp/gsa-scoped-rebind-candidate-06kL5o/.scoped-files.stage-b69b43c9-d184-46a6-9b01-6baa2a550c89';
const archive=path.join(root,'docs/reports/2026-10-26-mac27-native-archive');
const ownerLauncher=path.join(root,'scripts/macos-owner-launcher.py');
const observer=path.join(root,'scripts/mac27-recovery-observer.py');
const baseObserver=path.join(root,'native/macos-files/test-tree-broker.py');
const sourceFile=path.join(root,'native/macos-files/recovery-broker.swift');
const planFile=path.join(root,'docs/plans/2026-10-27-MAC27-RECOVERY-QUALIFICATION.md');
const slot=path.join(root,'docs/reports/.mac27-recovery-native-v1.attempt.json');
const basePins=Object.freeze({release:'3c540b7f5e151ad74c313c758aa12b1f249524db8a367b8692b5f33e24c00aea',code:'6327855b5793d3a66ab2f937c2cc16f89ec7d24303ff524889c80fd15a9abf74',source:'865042b5a685f3af271394e8f65aee799b87844dd8623db1d610741661ebdc50',build:'56f59a539612b350f320a89c638d7be706831820b5b5bc6139abeaefafe55bbe',evidence:'ef553e11a40f4db5b7483d762371b629c6f2079101fdd45cdd5916c0053b0bad'});
const recoveryProfile='gsa-recovery-adhoc-two-root-v1';
const baseArtifacts=['Contents/MacOS/broker','Contents/Info.plist','Contents/_CodeSignature/CodeResources'];
const recoveryArtifacts=['Contents/MacOS/recovery-broker','Contents/Info.plist','Contents/_CodeSignature/CodeResources'];
const monotonic=()=>performance.now();
const ident=s=>({device:String(s.dev),inode:String(s.ino)});
let wallDeadline;
function effect(ctx){if(wallDeadline!==undefined)assertDeadline(wallDeadline,Date.now());if(ctx)assertDeadline(ctx.deadline,monotonic());}
async function boundedRead(file,max,{system=false,afterDeadline=false}={}){
 if(!afterDeadline)effect();
 demand(path.isAbsolute(file)&&await fs.realpath(file)===file,'INPUT_CANONICAL');
 const before=await fs.lstat(file);demand(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&before.size>=0&&before.size<=max&&(system?[0,process.getuid()].includes(before.uid):before.uid===process.getuid())&&(before.mode&0o022)===0,'INPUT_UNSAFE');
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const opened=await handle.stat();demand(opened.dev===before.dev&&opened.ino===before.ino,'INPUT_CHANGED');const bytes=Buffer.alloc(before.size+1);let used=0;while(used<bytes.length){const read=await handle.read(bytes,used,bytes.length-used,used);if(!read.bytesRead)break;used+=read.bytesRead;}const after=await handle.stat();demand(used===before.size&&after.ctimeMs===before.ctimeMs&&after.mtimeMs===before.mtimeMs,'INPUT_CHANGED');return bytes.subarray(0,used);}finally{await handle.close();}
}
async function syncDirectory(dir){const fd=await fs.open(dir,constants.O_RDONLY);try{await fd.sync();}finally{await fd.close();}}
async function durableWrite(file,bytes,exclusive=true){const fd=await fs.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW|(exclusive?constants.O_EXCL:constants.O_TRUNC),0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}await syncDirectory(path.dirname(file));}
async function privateDir(dir){effect();await fs.mkdir(dir,{mode:0o700});}
async function privateDirectory(dir){const st=await fs.lstat(dir);demand(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o777)===0o700&&await fs.realpath(dir)===dir,'PRIVATE_DIRECTORY');}
async function absent(file){try{await fs.lstat(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
async function hashFile(file,afterDeadline=false){return sha(await boundedRead(file,16*1024*1024,{afterDeadline}));}
async function runtimeImport(relative){return import(pathToFileURL(path.join(root,'dist/src',relative)).href);}
async function runtimeGraph(){const rows=[];async function walk(dir){for(const name of (await fs.readdir(dir)).sort()){const file=path.join(dir,name),s=await fs.lstat(file);demand(!s.isSymbolicLink(),'RUNTIME_SYMLINK');if(s.isDirectory())await walk(file);else if(s.isFile()&&name.endsWith('.js'))rows.push({path:path.relative(path.join(root,'dist/src'),file),sha256:await hashFile(file)});}}await walk(path.join(root,'dist/src'));demand(rows.length>0&&rows.length<2000,'RUNTIME_GRAPH');return rows;}
async function sourceInputs(){
 const files={driver:script,plan:planFile,observer,baseObserver,owner:ownerLauncher,lifecycle:path.join(root,'scripts/test-mac-directory-copy-native.mjs'),control:path.join(root,'scripts/mac-recovery-probe-control.mjs'),candidate:sourceFile,baseSource:path.join(root,'native/macos-files/broker.swift'),baseBuild:path.join(archive,'build.json'),baseEvidence:path.join(archive,'native-evidence.json'),baseBinary:path.join(baseCandidate,'release-broker')};
 const hashes={};for(const [key,file] of Object.entries(files))hashes[key]=await hashFile(file);
 return hashes;
}
async function freezePreflight(){
 demand(process.platform==='darwin'&&process.arch==='arm64'&&os.release()==='27.0.0','HOST_BINDING');
 const buildBytes=await boundedRead(path.join(archive,'build.json'),65536),evidenceBytes=await boundedRead(path.join(archive,'native-evidence.json'),1024*1024);demand(sha(buildBytes)===basePins.build&&sha(evidenceBytes)===basePins.evidence,'BASE_ARCHIVE_CHANGED');const build=JSON.parse(buildBytes.toString()),evidence=JSON.parse(evidenceBytes.toString());
 const binary=await boundedRead(path.join(baseCandidate,'release-broker'),16*1024*1024),source=await boundedRead(sourceFile,256*1024),diagnostic=generateDiagnosticSource(source.toString());
 const validators=await runtimeImport('hosts/macos-file-evidence.js');validators.requireMacFileEvidence(evidence,build);
 demand(build.hostRelease===os.release()&&build.arch===process.arch&&build.release_sha256===basePins.release&&build.code_sha256===basePins.code&&build.source_sha256===basePins.source&&sha(binary)===basePins.release&&await hashFile(path.join(root,'native/macos-files/broker.swift'))===basePins.source,'BASE_CHANGED');
 const sourceHashes=await sourceInputs(),runtime=await runtimeGraph();
 demand(await absent(slot),'ATTEMPT_CONSUMED');
 return {build,evidence,baseBinarySha256:sha(binary),sourceHashes,runtime,diagnostic:{productionSourceSha256:diagnostic.productionSourceSha256,diagnosticSourceSha256:diagnostic.diagnosticSourceSha256}};
}
async function unchanged(ctx){effect(ctx);assertFrozenInputs({sourceHashes:await sourceInputs(),runtime:await runtimeGraph()},ctx.input);}
async function checkpoint(ctx){await durableWrite(path.join(ctx.stage,ctx.role==='owner'?'owner-report.json':'report.json'),JSON.stringify({...ctx.report,receiptTail:undefined,counts:ctx.report.mergedCounts??ctx.budget.snapshot()},null,2),false);}
async function persistReceipt(ctx,record){
 const bytes=['request','response','stderr'].reduce((n,key)=>n+Buffer.byteLength(record[key]??[]),0);reserveReceiptBytes(ctx.report,bytes,ctx.receiptLimit);
 const prior=ctx.report.receiptTail??Promise.resolve();
 const task=prior.then(async()=>{const index=String(ctx.report.receipts.length+1).padStart(4,'0'),files={};for(const key of ['request','response','stderr']){const value=Buffer.from(record[key]??[]),file=path.join(ctx.stage,'receipts',ctx.role,`${index}-${key}.bin`);await durableWrite(file,value);files[key]={path:path.relative(ctx.stage,file),bytes:value.length,sha256:sha(value)};}const {request,response,stderr,...meta}=record;ctx.report.receipts.push({...meta,files});});ctx.report.receiptTail=task;await task;
}
/** Fixed owned handles only. Native authority never escapes this private module. */
async function transport(ctx,kind,executable,args,input=Buffer.alloc(0),options={}){
 effect(ctx);demand(ctx.deadline-monotonic()>1700,'DEADLINE');ctx.budget.reserve({[kind]:1});const request=Buffer.from(input);demand(request.length<=bounds.requestBytes,'REQUEST_LIMIT');
 await checkpoint(ctx);
 let rejected,abortResolve;const abortPromise=new Promise(resolve=>abortResolve=resolve),abort=code=>{rejected??=failure(code);abortResolve();};
 const child=spawn(executable,args,{shell:false,env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp',...options.env},stdio:options.ownerFD?['pipe','pipe','pipe',3]:['pipe','pipe','pipe']});
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));child.on('error',error=>{rejected??=error;abortResolve();});child.stdin.on('error',()=>{});
 const stdout=captureBoundedStream(child.stdout,kind==='broker'?bounds.responseBytes:kind==='observer'?bounds.observerBytes:65536,()=>abort('OUTPUT_LIMIT'));
 const stderr=captureBoundedStream(child.stderr,bounds.diagnosticBytes,()=>abort('DIAGNOSTIC_LIMIT'));
 let streamTail=Promise.resolve();if(options.onChunk)child.stdout.on('data',chunk=>{streamTail=streamTail.then(()=>options.onChunk(Buffer.from(chunk))).catch(error=>{rejected??=error;abortResolve();options.onFailure?.(error);});});
 const safe={get exitCode(){return child.exitCode;},get signalCode(){return child.signalCode;},kill(signal){ctx.budget.reserve({signals:1});return child.kill(signal);},unref:()=>child.unref(),stdin:child.stdin,stdout:child.stdout,stderr:child.stderr};
 const completion=(async()=>{let result;try{result=await observeOwnedClosure(safe,closed,{owner:kind==='owner',timeoutMs:Math.max(1,Math.min(options.timeoutMs??15000,ctx.deadline-monotonic()-1700)),abortPromise,termGraceMs:500,killGraceMs:1200},ctx.budget,ctx.report);}catch(error){ctx.budget.markUnknown();ctx.report.cleanupState='UNVERIFIED';await persistReceipt(ctx,{kind,executable,args,pid:child.pid??null,closed:false,error:String(error.code??error.message),request,response:stdout.bytes,stderr:stderr.bytes});throw error;}
  await streamTail;const record={kind,executable,args,pid:child.pid??null,parentPid:process.pid,closed:true,exitCode:result.code,signal:result.signal,truncated:stdout.truncated||stderr.truncated,request,response:stdout.bytes,stderr:stderr.bytes};await persistReceipt(ctx,record);await checkpoint(ctx);
  if(rejected)throw rejected;if(result.timedOut){if(kind==='owner'){ctx.budget.markUnknown();ctx.report.cleanupState='UNVERIFIED';}throw failure('CHILD_TIMEOUT');}
  if(!options.allowFailure)demand(result.code===0&&!record.truncated,'CHILD_EXIT');return {raw:stdout.bytes,receipt:record,result};})();completion.catch(()=>{});
 if(options.held)return {child,completion,send:()=>child.stdin.end(request),abort};child.stdin.end(request);return completion;
}
async function command(ctx,kind,exe,args,input=''){return (await transport(ctx,kind,exe,args,Buffer.from(input))).raw;}
function parseReply(result){demand(result.receipt.closed===true&&result.receipt.truncated===false&&result.receipt.exitCode===0,'RAW_REPLY_REQUIRED');const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result.raw));demand(value&&typeof value.ok==='boolean','REPLY_SCHEMA');return value;}
function reportRequest(q){const {base64,...fields}=q;return base64===undefined?fields:{...fields,payload:{encoding:'raw-receipt-only',bytes:Buffer.from(base64,'base64').length,sha256:sha(Buffer.from(base64,'base64'))}};}
async function codeDigest(ctx,binary,dir){const copy=path.join(dir,'.code-'+randomUUID());effect(ctx);await fs.copyFile(binary,copy,constants.COPYFILE_EXCL);await fs.chmod(copy,0o700);await command(ctx,'tool','/usr/bin/codesign',['--remove-signature',copy]);const {normalizedStrippedMacFileCode}=await runtimeImport('hosts/macos-file-code.js');return sha(normalizedStrippedMacFileCode(await boundedRead(copy,16*1024*1024)));}
async function compilerInputs(ctx){
 const compiler=(await command(ctx,'tool','/usr/bin/xcrun',['--find','swiftc'])).toString().trim(),sdkPath=(await command(ctx,'tool','/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'])).toString().trim(),sdkVersion=(await command(ctx,'tool','/usr/bin/xcrun',['--sdk','macosx','--show-sdk-version'])).toString().trim();
 demand(path.isAbsolute(compiler)&&path.isAbsolute(sdkPath)&&sdkVersion.length>0,'COMPILER_INPUTS');
 return {compiler,compiler_sha256:sha(await boundedRead(await fs.realpath(compiler),256*1024*1024,{system:true})),compiler_version:(await command(ctx,'tool',compiler,['--version'])).toString().trim(),sdk:{path:sdkPath,version:sdkVersion,settings_sha256:sha(await boundedRead(await fs.realpath(path.join(sdkPath,'SDKSettings.json')),1024*1024,{system:true}))}};
}
async function compileRecovery(ctx,compiler,variant){
 const dir=path.join(ctx.stage,variant);await privateDir(dir);const source=await boundedRead(sourceFile,256*1024),bytes=variant==='production'?source:Buffer.from(generateDiagnosticSource(source.toString()).source),file=path.join(dir,'recovery-broker.swift'),binary=path.join(dir,'release-recovery');
 await durableWrite(file,bytes);const args=['-O','-Xlinker','-reproducible'],compileSource=variant==='production'?sourceFile:file;await command(ctx,'compile','/usr/bin/xcrun',['--sdk','macosx','swiftc','-sdk',compiler.sdk.path,...args,compileSource,'-o',binary]);await fs.chmod(binary,0o500);demand(await hashFile(sourceFile)===sha(source),'COMPILED_SOURCE_CHANGED');
 const match=/^UUID: ([A-F0-9-]{36}) \(arm64\) /.exec((await command(ctx,'tool','/usr/bin/dwarfdump',['--uuid',binary])).toString().trim());demand(match,'RECOVERY_UUID');
 const build={...compiler,uuid:match[1],source_sha256:sha(bytes),production_source_sha256:sha(source),source_path:compileSource,arguments:args,driver:'xcrun-macosx-swiftc-v1',release_sha256:await hashFile(binary),code_sha256:await codeDigest(ctx,binary,dir),hostRelease:os.release(),arch:process.arch,signing_profile:recoveryProfile,provenance:variant==='production'?'PRODUCTION':'DIAGNOSTIC_ONLY'};await durableWrite(path.join(dir,'build.json'),JSON.stringify(build));return {binary,build};
}
async function signedBundle(ctx,installation,grant,release,recoveryRoot){
 const recovery=!!recoveryRoot,name=recovery?'RecoveryBroker':'Broker',executable=recovery?'recovery-broker':'broker',dir=path.join(installation,grant.id),app=path.join(dir,name+'.app'),contents=path.join(app,'Contents'),macos=path.join(contents,'MacOS');
 if(await absent(dir))await privateDir(dir);for(const d of [app,contents,macos])await privateDir(d);
 const binary=path.join(macos,executable);effect(ctx);await fs.copyFile(release.binary,binary,constants.COPYFILE_EXCL);await fs.chmod(binary,0o500);demand(await hashFile(binary)===release.build.release_sha256,'RELEASE_COPY');
 const recoveryIdentity=recovery?ident(await fs.lstat(recoveryRoot,{bigint:true})):undefined;
 const info={CFBundleExecutable:executable,CFBundleIdentifier:'local.gsa.mac27.'+(recovery?'recovery.':'base.')+grant.id,CFBundleName:name,CFBundlePackageType:'APPL',CFBundleVersion:'1',GSAWorkspaceID:grant.id,GSAWorkspaceRoot:grant.root,GSARevision:grant.revision,GSADevice:grant.rootIdentity.device,GSAInode:grant.rootIdentity.inode,...(recovery?{GSARecoveryProtocol:'gsa-file-recovery-v1',GSARecoveryRoot:recoveryRoot,GSARecoveryDevice:recoveryIdentity.device,GSARecoveryInode:recoveryIdentity.inode}:{GSAWorkspaceRole:grant.role})};
 await durableWrite(path.join(contents,'Info.plist'),await command(ctx,'tool','/usr/bin/plutil',['-convert','xml1','-o','-','-'],JSON.stringify(info)));
 const right='com.apple.security.temporary-exception.files.absolute-path.'+(recovery||grant.role==='workspace'?'read-write':'read-only'),profile={'com.apple.security.app-sandbox':true,[right]:recovery?[grant.root+'/',recoveryRoot+'/']:[grant.root+'/']},ent=path.join(dir,name+'-entitlements.plist');
 await durableWrite(ent,await command(ctx,'tool','/usr/bin/plutil',['-convert','xml1','-o','-','-'],JSON.stringify(profile)));
 await command(ctx,'sign','/usr/bin/codesign',['--force','--sign','-','--entitlements',ent,app]);await fs.chmod(path.join(contents,'_CodeSignature'),0o700);await fs.chmod(path.join(contents,'_CodeSignature/CodeResources'),0o600);
 await command(ctx,'tool','/usr/bin/codesign',['--verify','--strict',app]);const signed=await command(ctx,'tool','/usr/bin/codesign',['--display','--entitlements',':-',app]);demand(isDeepStrictEqual(JSON.parse((await command(ctx,'tool','/usr/bin/plutil',['-convert','json','-o','-','-'],signed)).toString()),profile),'SIGNED_PROFILE');
 demand(await codeDigest(ctx,binary,dir)===release.build.code_sha256,'SIGNED_CODE');const artifacts={};for(const file of recovery?recoveryArtifacts:baseArtifacts)artifacts[file]=await hashFile(path.join(app,file));
 return recovery?{root:recoveryRoot,rootIdentity:recoveryIdentity,artifacts}:{...grant,artifacts,presign_sha256:release.build.release_sha256,code_sha256:release.build.code_sha256};
}

async function envelope(installation,input,grants){
 const key=randomBytes(32),body=JSON.stringify({format:'gsa-scoped-files-v2',hostRelease:os.release(),arch:process.arch,build:input.build,evidence:input.evidence,grants});
 await durableWrite(path.join(installation,'proof-key'),key);await durableWrite(path.join(installation,'install.json'),JSON.stringify({body,hmac:createHmac('sha256',key).update(body).digest('hex')}));
}
async function copyBaseBindings(ctx,from,to,grants){
 for(const grant of grants){const source=path.join(from,grant.id,'Broker.app'),destination=path.join(to,grant.id,'Broker.app');await privateDir(path.dirname(destination));await privateDir(destination);for(const dir of ['Contents','Contents/MacOS','Contents/_CodeSignature'])await privateDir(path.join(destination,dir));for(const file of baseArtifacts){effect(ctx);await fs.copyFile(path.join(source,file),path.join(destination,file),constants.COPYFILE_EXCL);await fs.chmod(path.join(destination,file),file.endsWith('/broker')?0o500:0o600);demand(await hashFile(path.join(destination,file))===grant.artifacts[file],'BASE_COPY_CHANGED');}}
}
async function checkCanaries(ctx){
 const values=[];for(const before of ctx.report.canaries){let after;try{after=await hashFile(before.path,true);}catch(error){ctx.report.state='BLOCKING';ctx.report.blocking??=[];ctx.report.blocking.push({kind:'CANARY_UNAVAILABLE',path:before.path,error:String(error.code??error.message)});await checkpoint(ctx);throw error;}const row={...before,after_sha256:after,changed:before.before_sha256!==after};values.push(row);if(row.changed){ctx.report.state='BLOCKING';ctx.report.blocking??=[];ctx.report.blocking.push({kind:'CANARY_CHANGED',...row});await checkpoint(ctx);throw failure('CANARY_CHANGED');}}
 ctx.report.canaryChecks.push({phase:ctx.report.phase,at:monotonic(),values});await checkpoint(ctx);return values;
}
async function sameFiles(paths){const rows={};for(const file of paths){if(await absent(file)){rows[file]={exists:false};continue;}const st=await fs.lstat(file,{bigint:true});demand(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1n,'OBSERVATION_TYPE');rows[file]={exists:true,identity:ident(st),mode:Number(st.mode&0o777n),sha256:await hashFile(file)};}return rows;}
async function observerIdentity(ctx,child,binary){const result=await transport(ctx,'observer','/usr/bin/python3',[observer,'identity',String(child.pid),String(process.pid),binary]);const value=JSON.parse(result.raw.toString());demand(value.pid===child.pid&&value.parentPid===process.pid&&value.executable===binary&&/^\d+:\d+$/.test(value.startTime),'OBSERVER_IDENTITY');return value;}
async function confirmStopped(ctx,expected){const result=await transport(ctx,'observer','/usr/bin/python3',[observer,'confirm',String(expected.pid),String(expected.parentPid),expected.executable,expected.startTime,expected.heldIdentity.device,expected.heldIdentity.inode,String(expected.fd)]);return validateObserverEvent(JSON.parse(result.raw.toString()),expected,'confirm');}
function ownedSignal(ctx,held,expected,signal){effect(ctx);demand(held.child.pid===expected.pid&&held.child.exitCode===null&&held.child.signalCode===null,'OWNED_PROCESS_CHANGED');ctx.budget.reserve({signals:1});demand(held.child.kill(signal),'SIGNAL_FAILED');}
async function observedMutation(ctx,binary,request,mode){
 const q=JSON.parse(request.toString()),source=path.join(ctx.work.root,q.path),parent=path.dirname(source),heldIdentity=ident(await fs.lstat(parent,{bigint:true})),original=await boundedRead(source,8*1024*1024),capturedIdentity=ident(await fs.lstat(source,{bigint:true})),tx=path.join(ctx.recovery,q.transaction_id),capture=path.join(tx,'captured');
 const held=await transport(ctx,'broker',binary,[],request,{ownerFD:true,held:true,allowFailure:mode==='post-capture'});let proof,stopped=false,resumed=false,watch;const timeline={};
 try{
  const identity=await observerIdentity(ctx,held.child,binary),expected={...identity,heldIdentity,capturedIdentity,phase:mode==='post-capture'?'capture':'parent'};
  let readyResolve,readyReject,hitResolve,hitReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;}),hit=new Promise((resolve,reject)=>{hitResolve=resolve;hitReject=reject;});ready.catch(()=>{});hit.catch(()=>{});
  const parser=createObserverLines(expected);ctx.budget.reserve({signals:1});
  watch=await transport(ctx,'observer','/usr/bin/python3',[observer,'watch',String(identity.pid),String(process.pid),binary,identity.startTime,heldIdentity.device,heldIdentity.inode,expected.phase,capture,capturedIdentity.device,capturedIdentity.inode,'-'],Buffer.alloc(0),{held:true,timeoutMs:6500,onChunk:chunk=>{for(const event of parser.push(chunk)){if(event.event==='WATCH_READY')readyResolve(event);else hitResolve(event);}},onFailure:error=>{readyReject(error);hitReject(error);}});
  watch.completion.catch(error=>{readyReject(error);hitReject(error);});watch.send();await ready;held.send();proof=await hit;stopped=true;timeline.stopSent=monotonic();await watch.completion;parser.finish();expected.fd=proof.fd;
  const confirm=await confirmStopped(ctx,expected);timeline.stopConfirmed=monotonic();demand(confirm.pid===held.child.pid,'STOPPED_PID');
  if(mode==='relocation'){
   demand(await hashFile(source)===sha(original)&&await absent(capture),'PRE_RELOCATION_EFFECT');const outside=path.join(ctx.stage,'outside','relocated-'+q.transaction_id);timeline.originalConfirmed=monotonic();effect(ctx);ctx.budget.reserve({relocation:1});await fs.rename(parent,outside);timeline.parentRelocated=monotonic();demand(sameIdentity(ident(await fs.lstat(outside,{bigint:true})),heldIdentity)&&await absent(parent),'RELOCATION_IDENTITY');const outsideSource=path.join(outside,path.basename(source));demand(await hashFile(outsideSource)===sha(original)&&await absent(capture),'RELOCATION_PRE_RESUME');timeline.outsideConfirmed=monotonic();ownedSignal(ctx,held,expected,'SIGCONT');resumed=true;timeline.resumed=monotonic();const result=await held.completion,reply=parseReply(result);timeline.responseObserved=monotonic();
   const outsideChanged=await hashFile(outsideSource)!==sha(original)||!sameIdentity(ident(await fs.lstat(outsideSource,{bigint:true})),capturedIdentity)||!(await absent(capture))||['captured','published','restored_exclusively'].some(key=>reply.observations?.[key]===true);const phase=reply.reason==='ENTRY_UNAVAILABLE'?'pre-capture-read':'unverified';const observation={request:reportRequest(q),response:reply,phase,phaseVerified:phase!=='unverified',denied:reply.status==='UNKNOWN'||reply.status==='CONFLICT',canariesUnchanged:true,outsideChanged,stop:confirm,parentIdentity:heldIdentity,capturedIdentity,relocatedPath:outside,timeline};ctx.report.observations.heldParent=observation;
   const classification=classifyRelocation(observation);observation.classification=classification;if(classification.state==='BLOCKING'){ctx.report.state='BLOCKING';throw failure('OUTSIDE_EFFECT');}demand(classification.state==='OBSERVED_DENIAL','RELOCATION_PHASE_UNVERIFIED');await checkCanaries(ctx);return result;
  }
  const captured=await boundedRead(capture,8*1024*1024),staged=await boundedRead(path.join(tx,'staged'),8*1024*1024),stagedIdentity=ident(await fs.lstat(path.join(tx,'staged'),{bigint:true}));
  assertStoppedCapture({...proof,state:confirm.state,sourceAbsent:await absent(source),staged:{present:true,...stagedIdentity}}, {...expected,stagedIdentity});demand(sha(captured)===sha(original)&&sha(staged)===sha(Buffer.from(q.base64,'base64')),'STOPPED_CAPTURE_BYTES');timeline.namespaceConfirmed=monotonic();
  ownedSignal(ctx,held,expected,'SIGTERM');timeline.terminationRequested=monotonic();ownedSignal(ctx,held,expected,'SIGCONT');resumed=true;timeline.resumed=monotonic();const result=await held.completion;demand(result.result.signal==='SIGTERM'||result.result.code!==0,'EXPECTED_PROCESS_INTERRUPTION');ctx.report.observations.postCapture={request:reportRequest(q),stop:confirm,capturedIdentity,stagedIdentity,timeline,sourceAbsent:true,classification:'OBSERVED_PROCESS_INTERRUPTION'};return result;
 }finally{
  if(stopped&&!resumed&&proof&&held.child.exitCode===null&&held.child.signalCode===null){try{ownedSignal(ctx,held,{pid:proof.pid},'SIGCONT');}catch{ctx.budget.markUnknown();}}
  if(!resumed){held.abort('OBSERVATION_INCONCLUSIVE');try{await held.completion;}catch{};}
  if(watch)try{await watch.completion;}catch{}
 }
}
async function makeAdapter(ctx,registry,installation,variant){
 const {loadCheckedMacRecoveryInstallation}=await runtimeImport('hosts/macos-recovery-installation.js');
 const binary=path.join(installation,ctx.work.id,'RecoveryBroker.app/Contents/MacOS/recovery-broker');
 const io={ownerLockFD:3,authorize:ctx.authorize,protectedRead:async(file,max)=>{const s=await fs.lstat(file);demand(s.uid===process.getuid()&&(s.mode&0o077)===0,'PRIVATE_FILE');return boundedRead(file,max);},protectedDirectory:privateDirectory,command:async(exe,args,input,max,fd)=>{
  if(exe==='/usr/bin/codesign'||exe==='/usr/bin/plutil')return command(ctx,'tool',exe,args,input);
  demand(exe===binary&&args.length===0&&fd===3,'FIXED_NATIVE_TRANSPORT');await unchanged(ctx);const request=Buffer.from(input),q=JSON.parse(input);assertNativeAdmission(ctx.report,ctx.report.nativeSequence.length,{operation:q.operation,variant,direct:false});ctx.report.nativeSequence.push({variant,operation:q.operation,direct:false});ctx.nativeCalls.push({variant,operation:q.operation,transaction_id:q.transaction_id,requestSha256:sha(request)});ctx.requests.set(q.transaction_id,{binary,request});const mode=ctx.mode;ctx.mode=null;
  let result;
  if(mode==='relocation'||mode==='post-capture')result=await observedMutation(ctx,binary,request,mode);
  else if(mode==='staging')result=await transport(ctx,'broker','/usr/bin/python3',[path.join(ctx.stage,'rlimit-exec.py'),binary],request,{ownerFD:true,allowFailure:true});
  else result=await transport(ctx,'broker',binary,[],request,{ownerFD:true});
  const record={variant,transaction_id:q.transaction_id,operation:q.operation,mode:mode??'ordinary',exitCode:result.result.code,signal:result.result.signal,rawReceiptIndex:ctx.report.receipts.length};ctx.report.nativeResults.push(record);
  if(mode==='staging'||mode==='post-capture'){demand(result.result.code!==0||result.result.signal,'EXPECTED_INTERRUPTION');record.expectedInterruption=true;throw failure('EXPECTED_INTERRUPTION_ACK_LOSS');}
  const reply=parseReply(result);record.reply=reply;if(mode==='lost-ack'){demand(reply.status==='APPLIED','LOST_ACK_NOT_APPLIED');record.deliberatelyDroppedAcknowledgement=true;throw failure('DELIBERATE_ACK_LOSS');}return result.raw;
 }};
 return loadCheckedMacRecoveryInstallation(registry,installation,io);
}
async function constructed(ctx,adapter,store,kind){
 const id=randomUUID(),relative='constructed-'+kind+'.txt',source=path.join(ctx.work.root,relative),old=Buffer.from('constructed-original-'+kind),replacement=Buffer.from('constructed-replacement-'+kind),tx=path.join(ctx.recovery,id);
 await durableWrite(source,old);await privateDir(tx);const intent={protocol:'gsa-file-recovery-v1',transaction_id:id,operation:'replace',workspace_id:ctx.work.id,revision:ctx.work.revision,path:relative,expected_sha256:sha(old),after_sha256:sha(replacement)};
 await store.create(id,{operation:'replace',source:{workspace_id:ctx.work.id,path:relative,revision:ctx.work.revision,rootIdentity:ctx.work.rootIdentity},destination:null,expected_sha256:sha(old),after_sha256:sha(replacement)});await durableWrite(path.join(tx,'intent.json'),JSON.stringify(intent));
 if(kind!=='staged-only'){effect(ctx);await fs.rename(source,path.join(tx,'captured'));await syncDirectory(tx);await syncDirectory(ctx.work.root);}
 if(kind==='published-without-final')await durableWrite(source,replacement);else await durableWrite(path.join(tx,'staged'),replacement);
 const files=[source,path.join(tx,'intent.json'),path.join(tx,'captured'),path.join(tx,'staged')],before=await sameFiles(files),names=(await fs.readdir(tx)).sort(),prior=ctx.nativeCalls.length,out=await ctx.call(()=>adapter.readTransaction(id));
 demand(out.status==='UNKNOWN'&&out.observations.captured===(kind!=='staged-only')&&out.observations.published===null,'CONSTRUCTED_READBACK');demand(isDeepStrictEqual(await sameFiles(files),before)&&isDeepStrictEqual((await fs.readdir(tx)).sort(),names),'INSPECT_CHANGED_ARTIFACTS');demand(ctx.nativeCalls.length===prior+1&&ctx.nativeCalls.at(-1).operation==='inspect','READBACK_REPLAY');return {status:out.status,classification:'STRUCTURAL_READBACK_ONLY',transaction_id:id,before};
}
async function exercise(ctx,adapter,diagnosticAdapter,store){
 const observations=ctx.report.observations,ref=relative=>({workspace_id:ctx.work.id,path:relative});
 async function setup(name,bytes=Buffer.from('old-'+name)){await durableWrite(path.join(ctx.work.root,name),bytes);return bytes;}
 async function replace(name,replacement,old,mode){ctx.mode=mode??null;return ctx.call(()=>adapter.replaceIfHash(ref(name),replacement,sha(old)));}
 ctx.report.phase='normal-replace';const normalOld=await setup('normal.txt'),normalNew=Buffer.from('new-normal'),normalBefore=ident(await fs.lstat(path.join(ctx.work.root,'normal.txt'),{bigint:true}));const normal=await replace('normal.txt',normalNew,normalOld);demand(normal.status==='APPLIED'&&await hashFile(path.join(ctx.work.root,'normal.txt'))===sha(normalNew),'NORMAL_REPLACE');const normalCapture=path.join(ctx.recovery,normal.transaction_id,'captured'),normalPublished=ident(await fs.lstat(path.join(ctx.work.root,'normal.txt'),{bigint:true}));demand(await hashFile(normalCapture)===sha(normalOld)&&sameIdentity(ident(await fs.lstat(normalCapture,{bigint:true})),normalBefore)&&sameIdentity(normal.observations.capturedIdentity,normalBefore)&&sameIdentity(normal.observations.publishedIdentity,normalPublished)&&!sameIdentity(normalBefore,normalPublished),'NORMAL_CAPTURE');const normalJournal=JSON.parse((await boundedRead(path.join(ctx.installation,'file-transactions',normal.transaction_id+'.json'),65536)).toString());demand(normalJournal.status==='APPLIED'&&normalJournal.intent.expected_sha256===sha(normalOld)&&normalJournal.intent.after_sha256===sha(normalNew),'NORMAL_DURABLE_JOURNAL');observations.normal={outcome:normal,captured_sha256:await hashFile(normalCapture),sourceIdentityBefore:normalBefore,publishedIdentityAfter:normalPublished,journalStatus:normalJournal.status};await checkCanaries(ctx);
 ctx.report.phase='lost-ack';const ackOld=await setup('lost-ack.txt'),ack=await replace('lost-ack.txt',Buffer.from('new-ack'),ackOld,'lost-ack');demand(ack.status==='UNKNOWN','ACK_NOT_UNKNOWN');const beforeAck=ctx.nativeCalls.length,ackRead=await ctx.call(()=>adapter.readTransaction(ack.transaction_id));demand(ackRead.status==='APPLIED'&&ctx.nativeCalls.length===beforeAck+1&&ctx.nativeCalls.at(-1).operation==='inspect','ACK_RECONCILIATION');observations.lostAck={unknown:ack,readback:ackRead};await checkCanaries(ctx);
 ctx.report.phase='normal-trash';const trashOld=await setup('trash.txt'),trashBefore=ident(await fs.lstat(path.join(ctx.work.root,'trash.txt'),{bigint:true})),trash=await ctx.call(()=>adapter.trashIfHash(ref('trash.txt'),sha(trashOld)));demand(trash.status==='APPLIED'&&await absent(path.join(ctx.work.root,'trash.txt'))&&await hashFile(path.join(ctx.recovery,trash.transaction_id,'captured'))===sha(trashOld)&&sameIdentity(ident(await fs.lstat(path.join(ctx.recovery,trash.transaction_id,'captured'),{bigint:true})),trashBefore)&&sameIdentity(trash.observations.capturedIdentity,trashBefore),'NORMAL_TRASH');observations.trash={outcome:trash,sourceIdentityBefore:trashBefore};await checkCanaries(ctx);
 ctx.report.phase='hash-conflict';const conflictOld=await setup('conflict.txt'),conflict=await ctx.call(()=>adapter.replaceIfHash(ref('conflict.txt'),Buffer.from('must-not-publish'),'0'.repeat(64)));demand(conflict.status==='CONFLICT'&&conflict.reason==='HASH_CONFLICT'&&await hashFile(path.join(ctx.work.root,'conflict.txt'))===sha(conflictOld)&&await absent(path.join(ctx.recovery,conflict.transaction_id,'captured')),'HASH_CONFLICT');observations.hashConflict=conflict;
 ctx.report.phase='duplicate-id';const duplicate=ctx.requests.get(normal.transaction_id),duplicatePaths=[path.join(ctx.work.root,'normal.txt'),normalCapture],beforeDuplicate=await sameFiles(duplicatePaths);await ctx.call(()=>ctx.authorize(ctx.work.id));await unchanged(ctx);assertNativeAdmission(ctx.report,ctx.report.nativeSequence.length,{operation:'replace',variant:'production',direct:true});ctx.report.nativeSequence.push({operation:'replace',variant:'production',direct:true});const duplicateResult=await transport(ctx,'broker',duplicate.binary,[],duplicate.request,{ownerFD:true}),duplicateReply=parseReply(duplicateResult);demand(duplicateReply.ok===false&&duplicateReply.error==='TRANSACTION_EXISTS_OR_DENIED'&&isDeepStrictEqual(await sameFiles(duplicatePaths),beforeDuplicate),'DUPLICATE_REPLAY');observations.duplicate={classification:'DIRECT_NATIVE_DUPLICATE',response:duplicateReply};
 for(const kind of ['staged-only','captured-without-final','published-without-final']){ctx.report.phase=kind;observations[kind]=await constructed(ctx,adapter,store,kind);await checkCanaries(ctx);}
 ctx.report.phase='held-parent-relocation';const relocationOld=Buffer.from('relocation-original');await durableWrite(path.join(ctx.work.root,'relocation/item.txt'),relocationOld);const relocated=await replace('relocation/item.txt',Buffer.alloc(8*1024*1024,90),relocationOld,'relocation');demand(relocated.status==='UNKNOWN','RELOCATION_OUTCOME');const relRead=await ctx.call(()=>adapter.readTransaction(relocated.transaction_id));demand(relRead.status==='UNKNOWN','RELOCATION_READBACK');observations.heldParent.adapter=relocated;observations.heldParent.readback=relRead;await checkCanaries(ctx);
 ctx.report.phase='staging-interruption';const stageOld=await setup('staging.txt'),stage=await replace('staging.txt',Buffer.alloc(8*1024*1024,90),stageOld,'staging');demand(stage.status==='UNKNOWN'&&await hashFile(path.join(ctx.work.root,'staging.txt'))===sha(stageOld),'STAGING_INTERRUPTION');const stageTx=path.join(ctx.recovery,stage.transaction_id),stageIntent=JSON.parse((await boundedRead(path.join(stageTx,'intent.json'),32768)).toString());demand(stageIntent.transaction_id===stage.transaction_id&&await absent(path.join(stageTx,'captured')),'STAGING_EFFECT');const stageRead=await ctx.call(()=>adapter.readTransaction(stage.transaction_id));demand(stageRead.status==='UNKNOWN'&&stageRead.observations.captured===false,'STAGING_READBACK');observations.staging={outcome:stage,readback:stageRead,classification:'WRITE_INTERRUPTION'};await checkCanaries(ctx);
 ctx.report.phase='post-capture-interruption';const crashOld=Buffer.alloc(8*1024*1024,65);await durableWrite(path.join(ctx.work.root,'post-capture/item.txt'),crashOld);const crash=await replace('post-capture/item.txt',Buffer.from('new-after-capture'),crashOld,'post-capture');demand(crash.status==='UNKNOWN','CRASH_OUTCOME');const crashRead=await ctx.call(()=>adapter.readTransaction(crash.transaction_id));demand(crashRead.status==='UNKNOWN'&&crashRead.observations.captured===true&&await hashFile(path.join(ctx.recovery,crash.transaction_id,'captured'))===sha(crashOld),'CRASH_READBACK');Object.assign(observations.postCapture,{outcome:crash,readback:crashRead});await checkCanaries(ctx);
 ctx.report.phase='diagnostic-sync-error';const diagOld=await setup('diagnostic.txt'),diag=await ctx.call(()=>diagnosticAdapter.replaceIfHash(ref('diagnostic.txt'),Buffer.from('diagnostic-new'),sha(diagOld)));demand(diag.status==='UNKNOWN'&&await hashFile(path.join(ctx.diagnosticRecovery,diag.transaction_id,'captured'))===sha(diagOld)&&await absent(path.join(ctx.work.root,'diagnostic.txt')),'DIAGNOSTIC_CAPTURE');const diagRead=await ctx.call(()=>diagnosticAdapter.readTransaction(diag.transaction_id));demand(diagRead.status==='UNKNOWN'&&diagRead.observations.captured===true,'DIAGNOSTIC_READBACK');observations.diagnostic={outcome:diag,readback:diagRead,classification:'DIAGNOSTIC_ONLY',actualKernelFsyncFailure:false};await checkCanaries(ctx);
 demand(!ctx.budget.unknown&&ctx.budget.snapshot().broker===17&&ctx.nativeCalls.length===16&&ctx.report.nativeSequence.length===17,'BROKER_SCHEDULE');ctx.report.state='RECOVERY_SEQUENCE_OBSERVED';ctx.report.phase='finished';ctx.report.nativeCalls=ctx.nativeCalls;ctx.report.cleanupState='CLOSED_EXPLICIT_HANDLES_ONLY';await checkpoint(ctx);
}

export function validateWorkerBinding(input,reservation,current){
 demand(input&&reservation&&current&&typeof input.stage==='string'&&/^\/private\/tmp\/gsa-mac27-recovery-[a-f0-9]{24}$/.test(input.stage),'WORKER_STAGE');
 demand(input.stage===reservation.stage&&input.stage===current.stage&&reservation.inputSha256===current.inputSha256&&digest(current.inputSha256)&&reservation.sourceHashes?.driver===current.driverSha256,'WORKER_RESERVATION');
 demand(digest(current.driverSha256)&&reservation.format==='gsa-mac27-recovery-once-v1'&&reservation.activation===false,'WORKER_RESERVATION');
 demand(isDeepStrictEqual(input.sourceHashes,reservation.sourceHashes)&&isDeepStrictEqual(input.runtime,reservation.runtime)&&isDeepStrictEqual(input.build,reservation.build)&&isDeepStrictEqual(reservation.caps,caps)&&isDeepStrictEqual(reservation.bounds,bounds),'WORKER_RESERVATION');
 demand(Number.isFinite(input.startedAt)&&input.startedAt===reservation.startedAt&&input.deadlineAt===reservation.deadlineAt&&input.deadlineAt-input.startedAt===bounds.runMs,'WORKER_DEADLINE');
 demand(input.node===current.node&&input.nodeSha256===current.nodeSha256&&digest(current.nodeSha256),'NODE_CHANGED');return true;
}

export function getCommandGraph(){
 return {broker:17,sign:4,compile:2,observer:6,owner:1,tool:{compilerMetadata:4,releaseUuidAndNormalization:4,signedBundleValidation:24,ownerVerification:1,recoveryLoaderValidation:72,derived:105,reserved:128},explicitDerived:135,explicitUpperBound:158,compilerPrivateDescendants:'UNVERIFIED',partition:{owner:{children:1,signals:2,receiptBytes:128*1024},worker:{children:157,owner:0,signals:10,receiptBytes:bounds.receiptBytes-128*1024}}};
}

async function prepareWorker(ctx){
 const {enrollRolesTrustedBatch,loadTrustedRegistry}=await runtimeImport('local/grants.js');
 const rows=await enrollRolesTrustedBatch([{id:'mac27-recovery-work',root:path.join(ctx.stage,'workspace'),role:'workspace'},{id:'mac27-recovery-reference',root:path.join(ctx.stage,'reference'),role:'reference'}],ctx.identity);
 const grants=rows.map(row=>({id:row.id,root:row.root,role:row.grant.role,revision:row.grant.revision,rootIdentity:{...row.grant.rootIdentity}}));demand(grants.every(g=>g.revision===1),'GRANT_REVISION');ctx.work=grants[0];
 const baseRelease={binary:path.join(ctx.stage,'release-broker'),build:ctx.input.build};
 const workBase=await signedBundle(ctx,ctx.installation,grants[0],baseRelease),referenceBase=await signedBundle(ctx,ctx.installation,grants[1],baseRelease);
 const compiler=await compilerInputs(ctx),production=await compileRecovery(ctx,compiler,'production'),diagnostic=await compileRecovery(ctx,compiler,'diagnostic');
 demand(production.build.source_sha256===ctx.input.sourceHashes.candidate&&diagnostic.build.source_sha256===ctx.input.diagnostic.diagnosticSourceSha256,'RECOVERY_SOURCE_CHANGED');
 workBase.recovery=await signedBundle(ctx,ctx.installation,grants[0],production,ctx.recovery);
 await copyBaseBindings(ctx,ctx.installation,ctx.diagnosticInstallation,[workBase,referenceBase]);
 const diagnosticWork={...workBase,recovery:await signedBundle(ctx,ctx.diagnosticInstallation,grants[0],diagnostic,ctx.diagnosticRecovery)};
 await envelope(ctx.installation,ctx.input,[workBase,referenceBase]);await envelope(ctx.diagnosticInstallation,ctx.input,[diagnosticWork,referenceBase]);
 ctx.report.builds={production:production.build,diagnostic:diagnostic.build};ctx.report.bindings={production:[workBase,referenceBase],diagnostic:[diagnosticWork,referenceBase]};
 // This wrapper path and byte recipe are fixed, validated and durable before
 // any broker is spawned; it cannot execute a shell or caller-selected path.
 const wrapper='import os,resource,signal,sys\nif len(sys.argv)!=2 or not os.path.isabs(sys.argv[1]): raise ValueError("BINARY_ARGUMENT")\nresource.setrlimit(resource.RLIMIT_CORE,(0,0))\nresource.setrlimit(resource.RLIMIT_FSIZE,(4096,4096))\nsignal.signal(signal.SIGXFSZ,signal.SIG_DFL)\nos.execv(sys.argv[1],[sys.argv[1]])\n';
 await durableWrite(path.join(ctx.stage,'rlimit-exec.py'),wrapper);
 const registry=await loadTrustedRegistry(ctx.identity),{ControlLeaseStore}=await runtimeImport('local/control-lease.js'),{withControlToken}=await runtimeImport('mcp/control-context.js'),{authorizeMcpWorkspace}=await runtimeImport('mcp/runtime-bootstrap.js');
 const control=new ControlLeaseStore(ctx.identity),lease=await control.acquire();ctx.call=fn=>withControlToken(control,lease.control_token,fn);ctx.authorize=id=>authorizeMcpWorkspace(registry,id,ctx.identity,'write');
 try{
  const ownerProof=JSON.parse((await command(ctx,'tool','/usr/bin/python3',[ownerLauncher,'--identity',ctx.identity,'--verify'])).toString());demand(ownerProof.format==='gsa-owner-v1'&&ownerProof.session===process.env.GSA_OWNER_SESSION,'OWNER_VERIFY');
  const adapter=await makeAdapter(ctx,registry,ctx.installation,'production'),diagnosticAdapter=await makeAdapter(ctx,registry,ctx.diagnosticInstallation,'diagnostic'),{FileTransactionStore}=await runtimeImport('local/file-transaction-store.js'),store=new FileTransactionStore(path.join(ctx.installation,'file-transactions'));
  assertPreparedSetup({hostRelease:os.release(),arch:process.arch,driverSha256:ctx.input.sourceHashes.driver,candidateSourceSha256:ctx.input.sourceHashes.candidate,compiledGraphSha256:sha(JSON.stringify(ctx.input.runtime)),ownerLauncherSha256:ctx.input.sourceHashes.owner,observerSha256:ctx.input.sourceHashes.observer,baseEvidenceSha256:sha(JSON.stringify(ctx.input.evidence)),baseReleaseSha256:basePins.release,baseCodeSha256:basePins.code,baseUnchanged:await hashFile(baseRelease.binary)===basePins.release,recipeValidated:schedule.reduce((n,row)=>n+row.calls.length,0)===17,wrappersValidated:(await boundedRead(path.join(ctx.stage,'rlimit-exec.py'),4096)).toString()===wrapper,ownerVerified:true,signingProfile:recoveryProfile,brokerCalls:17,explicitSpawnUpperBound:158});
  await unchanged(ctx);ctx.report.setupComplete=true;await checkpoint(ctx);await exercise(ctx,adapter,diagnosticAdapter,store);
 }finally{
  // Opaque control credentials remain only in this closure; never serialize.
  await control.release(lease.control_token);let invalidated=false;try{await control.require(lease.control_token);}catch(error){if(error.code==='SESSION_INVALID')invalidated=true;else throw error;}demand(invalidated,'CONTROL_RELEASE_UNVERIFIED');ctx.report.controlReleased=true;lease.control_token=null;ctx.call=undefined;ctx.authorize=undefined;
 }
}

async function nativeMain(token){
 demand(token===authority&&SOURCE_REVIEW_COMPLETE&&IMPLEMENTATION_COMPLETE,'SOURCE_PREPARATION_INCOMPLETE');
 const startedAt=Date.now(),startedMono=monotonic(),deadlineAt=startedAt+bounds.runMs;wallDeadline=deadlineAt;const input=await freezePreflight();
 const stage='/private/tmp/gsa-mac27-recovery-'+randomBytes(12).toString('hex'),node=await fs.realpath(process.execPath),nodeSha256=sha(await boundedRead(node,256*1024*1024,{system:true}));
 const canaries=[['workspace/neighbor.bin','workspace-neighbor'],['reference/canary.bin','reference-preserved'],['outside/canary.bin','outside-preserved'],['recovery/canary.bin','recovery-neighbor'],['diagnostic-recovery/canary.bin','diagnostic-neighbor']].map(([relative,content])=>({path:path.join(stage,relative),before_sha256:sha(content)}));
 const baseReport={format:'gsa-mac27-recovery-driver-v1',state:'STARTED',stage,phase:'preparing',activation:false,unresolved:[],receipts:[],observations:{},nativeResults:[],nativeSequence:[],canaryChecks:[],canaries,sourceHashes:input.sourceHashes,commandGraph:getCommandGraph(),compilerPrivateDescendants:'UNVERIFIED',cleanupState:'UNVERIFIED'};
 const workerReport={...baseReport,receipts:[],unresolved:[],observations:{},nativeResults:[],canaryChecks:[]};
 const inputValue={...input,stage,node,nodeSha256,startedAt,deadlineAt,report:workerReport},inputBytes=Buffer.from(JSON.stringify(inputValue));
 demand(await fs.realpath(path.dirname(slot))===path.dirname(slot),'ATTEMPT_PARENT');effect();
 await reserveOneShot(slot,{format:'gsa-mac27-recovery-once-v1',stage,startedAt,deadlineAt,inputSha256:sha(inputBytes),sourceHashes:input.sourceHashes,runtime:input.runtime,build:input.build,caps,bounds,activation:false});
 await privateDir(stage);demand(await fs.realpath(stage)===stage,'STAGE_CANONICAL');
 for(const dir of ['workspace','workspace/relocation','workspace/post-capture','reference','outside','identity','installation','diagnostic-installation','recovery','diagnostic-recovery','receipts','receipts/owner','receipts/worker'])await privateDir(path.join(stage,dir));
 for(const [index,content] of ['workspace-neighbor','reference-preserved','outside-preserved','recovery-neighbor','diagnostic-neighbor'].entries())await durableWrite(canaries[index].path,content);
 await durableWrite(path.join(stage,'release-broker'),await boundedRead(path.join(baseCandidate,'release-broker'),16*1024*1024));await fs.chmod(path.join(stage,'release-broker'),0o500);demand(await hashFile(path.join(stage,'release-broker'))===basePins.release,'BASE_COPY_CHANGED');await durableWrite(path.join(stage,'worker-input.json'),inputBytes);
 const ctx={stage,role:'owner',input:inputValue,report:baseReport,budget:createBudget({childLimit:1,signalLimit:2,ownerLimit:1}),deadline:startedMono+bounds.runMs,receiptLimit:128*1024};let workerReportValue;
 try{
  await transport(ctx,'owner','/usr/bin/python3',[ownerLauncher,'--identity',path.join(stage,'identity'),'--node',node,'--entry',script],Buffer.alloc(0),{timeoutMs:assertDeadline(deadlineAt,Date.now())-1700,env:{GSA_MAC27_RECOVERY_WORKER_STAGE:stage}});
  workerReportValue=JSON.parse((await boundedRead(path.join(stage,'report.json'),4*1024*1024,{afterDeadline:true})).toString());const merged=mergeRunState({...ctx.report,counts:ctx.budget.snapshot()},workerReportValue);
  demand(merged.state!=='BLOCKING'&&workerReportValue.state==='RECOVERY_SEQUENCE_OBSERVED'&&workerReportValue.controlReleased===true,'WORKER_NOT_QUALIFIED');ctx.report.worker=workerReportValue;ctx.report.state=workerReportValue.state;ctx.report.mergedCounts=merged.counts;ctx.report.cleanupState=workerReportValue.cleanupState;await checkpoint(ctx);process.stdout.write(JSON.stringify({state:ctx.report.state,stage,activation:false})+'\n');
 }catch(error){
  try{workerReportValue=JSON.parse((await boundedRead(path.join(stage,'report.json'),4*1024*1024,{afterDeadline:true})).toString());}catch{ctx.budget.markUnknown();}
  const merged=mergeRunState({...ctx.report,counts:ctx.budget.snapshot()},workerReportValue);ctx.report.state=merged.state==='BLOCKING'?'BLOCKING':ctx.budget.unknown?'CLEANUP_UNVERIFIED':'INCONCLUSIVE';ctx.report.worker=workerReportValue;ctx.report.mergedCounts=merged.counts;ctx.report.unresolved.push(String(error.code??error.message));await checkpoint(ctx);throw error;
 }
}

async function workerMain(stage,token){
 demand(token===authority&&SOURCE_REVIEW_COMPLETE&&IMPLEMENTATION_COMPLETE,'SOURCE_PREPARATION_INCOMPLETE');demand(typeof stage==='string'&&/^\/private\/tmp\/gsa-mac27-recovery-[a-f0-9]{24}$/.test(stage),'WORKER_STAGE');await privateDirectory(stage);
 const bytes=await boundedRead(path.join(stage,'worker-input.json'),2*1024*1024),input=JSON.parse(bytes.toString()),reservation=JSON.parse((await boundedRead(slot,1024*1024)).toString()),node=await fs.realpath(process.execPath),nodeSha256=sha(await boundedRead(node,256*1024*1024,{system:true}));
 validateWorkerBinding(input,reservation,{stage,inputSha256:sha(bytes),driverSha256:await hashFile(script),node,nodeSha256});wallDeadline=input.deadlineAt;const remaining=assertDeadline(input.deadlineAt,Date.now());demand(remaining<=bounds.runMs,'WORKER_DEADLINE');
 demand(process.env.GSA_OWNER_LOCK_FD==='3'&&process.env.GSA_OWNER_IDENTITY===path.join(stage,'identity'),'OWNER_FD');const fd=await new Promise((resolve,reject)=>fstat(3,(error,value)=>error?reject(error):resolve(value))),named=await fs.lstat(path.join(stage,'identity/server-owner.lock'));demand(fd.dev===named.dev&&fd.ino===named.ino,'OWNER_LOCK_IDENTITY');const owner=JSON.parse((await boundedRead(path.join(stage,'identity/server-owner.lock'),4096)).toString());demand(owner.pid===process.pid&&owner.session===process.env.GSA_OWNER_SESSION,'OWNER_SESSION');
 await claimWorkerEntry(stage,{stage,inputSha256:sha(bytes),driverSha256:input.sourceHashes.driver});
 const ctx={stage,role:'worker',identity:path.join(stage,'identity'),installation:path.join(stage,'installation'),diagnosticInstallation:path.join(stage,'diagnostic-installation'),recovery:path.join(stage,'recovery'),diagnosticRecovery:path.join(stage,'diagnostic-recovery'),input,report:input.report,budget:createBudget({childLimit:157,signalLimit:10,ownerLimit:0}),deadline:monotonic()+remaining,receiptLimit:bounds.receiptBytes-128*1024,nativeCalls:[],requests:new Map(),mode:null};
 try{await unchanged(ctx);await prepareWorker(ctx);await checkpoint(ctx);}catch(error){ctx.report.state=ctx.report.state==='BLOCKING'?'BLOCKING':ctx.budget.unknown?'CLEANUP_UNVERIFIED':'INCONCLUSIVE';ctx.report.unresolved.push(String(error.code??error.message));ctx.report.nativeCalls=ctx.nativeCalls;await checkpoint(ctx);throw error;}
}

async function main(){
 if(process.env.GSA_MAC27_RECOVERY_WORKER_STAGE!==undefined){demand(process.argv.length===2,'ARGUMENTS');return workerMain(process.env.GSA_MAC27_RECOVERY_WORKER_STAGE,authority);}
 const mode=parseArguments(process.argv.slice(2));
 if(mode==='plan'){process.stdout.write(JSON.stringify(getPlan(),null,2)+'\n');return;}
 return nativeMain(authority);
}
if(process.argv[1]&&path.resolve(process.argv[1])===script)main().catch(error=>{process.stderr.write(String(error.code??error.message)+'\n');process.exitCode=1;});
