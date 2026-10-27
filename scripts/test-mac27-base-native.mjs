#!/usr/bin/env node
/** Preparation checkpoint. This file grants no native allowance. All native
 * authority is private to the CLI, behind the explicit source-review hold.
 * Raw direct receipts and public API observations have different provenance. */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const script=fileURLToPath(import.meta.url),root=path.resolve(path.dirname(script),'..');
const candidate='/private/tmp/gsa-scoped-rebind-candidate-06kL5o/.scoped-files.stage-b69b43c9-d184-46a6-9b01-6baa2a550c89';
const slot=path.join(root,'docs/reports/.mac27-base-native-v1.attempt.json');
const observer=path.join(root,'native/macos-files/test-tree-broker.py');
const ownerLauncher=path.join(root,'scripts/macos-owner-launcher.py');
const planFile=path.join(root,'docs/plans/2026-10-25-MAC27-BASE-NATIVE-ACCEPTANCE.md');
const authority=Object.freeze({});
// Changing this hold is a future reviewed source change, never an environment,
// injected callback, extra argv, or test-option bypass. Preparation is the only
// currently authorized action. The exact ACK alone cannot replenish allowances.
const SOURCE_REVIEW_COMPLETE=false;
const signingProfile='gsa-scoped-files-adhoc-single-root-v1';
const hashes=Object.freeze({release:'3c540b7f5e151ad74c313c758aa12b1f249524db8a367b8692b5f33e24c00aea',code:'6327855b5793d3a66ab2f937c2cc16f89ec7d24303ff524889c80fd15a9abf74',source:'865042b5a685f3af271394e8f65aee799b87844dd8623db1d610741661ebdc50',compiler:'cf81104bf554eef05e28a8bb5285c763f1323b4511b944d755d8bdd6cb8db717',sdk:'7b93ad7e534cc4b31c6a4e39d19b5e0288acf2168c2649479a796d1cb51939fb'});
const caps=Object.freeze({broker:12,sign:3,tool:80,observer:3,owner:1,total:99,relocation:1,signals:8});
const bound=Object.freeze({runMs:180000,childMs:15000,watchMs:5500,termMs:500,killMs:1200,requestBytes:12*1024*1024,responseBytes:12*1024*1024,diagnosticBytes:65536,observerBytes:4096,receiptBytes:32*1024*1024});
const artifactNames=Object.freeze(['Contents/MacOS/broker','Contents/Info.plist','Contents/_CodeSignature/CodeResources']);
const phases=Object.freeze(['stopConfirmed','targetAbsentBeforeMove','parentRelocated','outsideTargetAbsentBeforeResume','resumed','outsideTargetObservedAfterResume']);
const sha=b=>createHash('sha256').update(b).digest('hex');
const failure=(code,message=code)=>Object.assign(Error(message),{code});
const demand=(ok,code='BINDING_MISMATCH')=>{if(!ok)throw failure(code);};
const identity=s=>({device:String(s.dev),inode:String(s.ino)});
const now=()=>performance.now();

export function getPlan(){return {status:SOURCE_REVIEW_COMPLETE?'REVIEWED':'NOT_READY',nativeExecution:SOURCE_REVIEW_COMPLETE,activation:false,retainedStage:true,releaseCompiles:0,candidate,hashes:{...hashes},attemptReservation:slot,caps:{...caps},bounds:{...bound},schedule:{qualifyingBrokers:7,publicBrokers:5,bundles:3,revisions:[1,2,3],validationToolsDerived:63,validationToolsReserved:80,totalChildrenReserved:99,observerModes:['identity','watch','confirm'],diagnostics:['artifactMismatch','staleGrant'],publicOperations:['makeDirectory','createExclusive','read','copyExclusive']},acknowledgement:['--run-native','--ack-mac27-base-one-pass'],hold:SOURCE_REVIEW_COMPLETE?'REVIEWED_SOURCE: a new attempt still requires explicit human authorization; ACK never replenishes a consumed slot':'PREPARATION_AND_REVIEW_ONLY: source review and explicit new native authorization pending',unresolvedReadiness:SOURCE_REVIEW_COMPLETE?[]:['SOURCE_REVIEW_AND_NATIVE_AUTHORIZATION_PENDING','PRIVATE_COMMAND_SIGNAL_BOUND_UNVERIFIED'],signalAccounting:{managedCap:8,ownerAllocation:2,workerAllocation:6,internalPrivateCommands:'UNVERIFIED: repeated abort signals are not globally bounded by frozen production source; any future admission must explicitly approve managed-only accounting'},provenance:{direct:'original request/stdout/stderr persisted before JSON parsing',public:'API resolution and independent readback; internal raw bytes unavailable'},timeline:[...phases]};}

export function parseArguments(argv){
 if(!Array.isArray(argv))throw failure('ARGUMENTS');
 if(argv.length===0||argv.length===1&&argv[0]==='--plan')return 'plan';
 if(argv.length===2&&argv[0]==='--run-native'&&argv[1]==='--ack-mac27-base-one-pass')return 'native';
 throw failure('ACKNOWLEDGEMENT_REQUIRED','Use --plan; native syntax must be exact and carries no authorization by itself');
}

/** Pure counter. A phase's entire hidden finite command bound is reserved before
 * entering the unmodified public module; unused reservations are never refunded. */
export function createBudget({signalLimit=caps.signals,childLimit=caps.total}={}){
 demand(Number.isSafeInteger(signalLimit)&&signalLimit>=0&&signalLimit<=caps.signals&&Number.isSafeInteger(childLimit)&&childLimit>=0&&childLimit<=caps.total,'BUDGET_ARGUMENT');
 const used=Object.fromEntries(Object.keys(caps).map(k=>[k,0]));let unknown=false;
 return Object.freeze({
  reserve(request){
   if(unknown)throw failure('CLEANUP_UNVERIFIED');
   demand(request&&typeof request==='object'&&!Array.isArray(request),'BUDGET_ARGUMENT');
   const next={...used};let children=0;
   for(const [kind,count] of Object.entries(request)){
    demand(Object.hasOwn(caps,kind)&&kind!=='total'&&Number.isSafeInteger(count)&&count>=0,'BUDGET_ARGUMENT');
    next[kind]+=count;if(['broker','sign','tool','observer','owner'].includes(kind))children+=count;
   }
   next.total+=children;
   for(const kind of Object.keys(caps))if(next[kind]>(kind==='signals'?signalLimit:kind==='total'?childLimit:caps[kind]))throw failure('BUDGET_EXHAUSTED',kind);
   Object.assign(used,next);return Object.freeze({...used});
  },
  snapshot(){return Object.freeze({...used});},
  markUnknown(){unknown=true;},
  get unknown(){return unknown;}
 });
}

export function recordPhase(timeline,name,value){
 const index=Object.keys(timeline).length;
 demand(phases[index]===name&&Number.isFinite(value)&&value>=0&&(index===0||value>timeline[phases[index-1]]),'RELOCATION_TIMELINE_INVALID');
 timeline[name]=value;return timeline;
}

/** Source adapter for test-tree-broker.py, not the older recovery hit schema. */
export function parseObserverReceipt(value,expected,kind){
 demand(value&&typeof value==='object'&&!Array.isArray(value),'OBSERVER_JSON');
 for(const key of ['pid','parentPid','startTime'])demand(value[key]===expected[key],'OBSERVER_IDENTITY');
 demand(Number.isSafeInteger(value.pid)&&value.pid>1&&Number.isSafeInteger(value.parentPid)&&value.parentPid>1&&/^\d+:\d+$/.test(value.startTime),'OBSERVER_IDENTITY');
 if(kind==='ready'){
  demand(value.event==='WATCH_READY'&&value.device===expected.device&&value.inode===expected.inode,'OBSERVER_READY');
 }else{
  demand(value.executable===expected.executable&&Number.isSafeInteger(value.status),'OBSERVER_IDENTITY');
  if(kind==='watch'||kind==='stop')demand((kind==='watch'||value.status===4)&&value.signal==='SIGSTOP'&&/^T/.test(value.state)&&Number.isSafeInteger(value.fd)&&value.fd>=0&&value.device===expected.device&&value.inode===expected.inode&&(expected.fd===undefined||value.fd===expected.fd),'OBSERVER_STOP');
  else demand(kind==='identity','OBSERVER_KIND');
 }
 return value;
}


export function denialError(error){
 const code=typeof error?.code==='string'?error.code:'',message=String(error?.message??error);
 return {code,message,error:code||message};
}
export function assertDeadline(deadlineAt,current=Date.now()){
 demand(Number.isFinite(deadlineAt)&&Number.isFinite(current)&&current<deadlineAt,'DEADLINE');return deadlineAt-current;
}
export function systemInputInfo(info,uid=process.getuid()){
 demand(info&&info.isFile()&&info.nlink===1&&[0,uid].includes(info.uid)&&(info.mode&0o022)===0,'INPUT_UNSAFE');return true;
}
export async function claimWorkerEntry(stage,binding){
 demand(path.isAbsolute(stage)&&await fs.realpath(stage)===stage,'WORKER_STAGE');
 const info=await fs.lstat(stage);demand(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===process.getuid()&&(info.mode&0o777)===0o700,'WORKER_OWNER');
 demand(binding?.stage===stage&&/^[a-f0-9]{64}$/.test(binding.driverSha256)&&/^[a-f0-9]{64}$/.test(binding.inputSha256),'WORKER_RESERVATION');
 const handle=await fs.open(path.join(stage,'worker-entry.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await handle.writeFile(JSON.stringify(binding));await handle.sync();}finally{await handle.close();}
 const directory=await fs.open(stage,constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
 return Object.freeze({...binding});
}
export function recordBlocking(report,kind,detail){
 report.state='BLOCKING';report.blocking??=[];report.blocking.push({...detail,kind});return report;
}
export function classifyCanary(before,afterSha){return {...before,after_sha256:afterSha,changed:afterSha!==before.before_sha256};}
export function mergeRunState(owner,worker){
 const uncertainty=[owner?.state,worker?.state].some(s=>s==='CLEANUP_UNVERIFIED'||s==='UNKNOWN')||owner?.cleanupState==='UNVERIFIED'||worker?.cleanupState==='UNVERIFIED';
 const blocking=owner?.state==='BLOCKING'||worker?.state==='BLOCKING';
 const counts={};for(const [kind,cap] of Object.entries(caps)){
  const a=owner?.counts?.[kind]??0,b=worker?.counts?.[kind]??0;
  demand(Number.isSafeInteger(a)&&a>=0&&Number.isSafeInteger(b)&&b>=0,'BUDGET_ARGUMENT');
  counts[kind]=a+b;demand(counts[kind]<=cap,'BUDGET_EXHAUSTED');
 }

 return {state:blocking?'BLOCKING':uncertainty?'CLEANUP_UNVERIFIED':owner?.state==='INCONCLUSIVE'?'INCONCLUSIVE':worker?.state??owner?.state??'INCONCLUSIVE',cleanupState:uncertainty?'UNVERIFIED':'CLOSED',counts,unresolved:[...(owner?.unresolved??[]),...(worker?.unresolved??[])],blocking:[...(owner?.blocking??[]),...(worker?.blocking??[])]};
}
export function reserveReceiptBytes(report,additions,cap=bound.receiptBytes){
 demand(Number.isSafeInteger(additions)&&additions>=0&&Number.isSafeInteger(cap)&&cap>=0,'RECEIPT_ARGUMENT');
 const current=Math.max(report.receiptBytes??0,report.reservedReceiptBytes??0);
 demand(Number.isSafeInteger(current)&&current>=0&&current+additions<=cap,'RECEIPT_BUDGET_EXHAUSTED');
 report.reservedReceiptBytes=current+additions;return report.reservedReceiptBytes;
}
export function receiptRoot(stage,role){
 demand(typeof stage==='string'&&path.isAbsolute(stage)&&path.normalize(stage)===stage&&!stage.includes('\0')&&['owner','worker'].includes(role),'RECEIPT_NAMESPACE');
 return path.join(stage,'receipts',role);
}
export function createObserverLines(expected){
 const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,pending='',records=0,failed;
 return Object.freeze({
  push(chunk){
   if(failed)throw failed;
   try{
    bytes+=Buffer.byteLength(chunk);demand(bytes<=bound.observerBytes,'OBSERVER_OUTPUT_LIMIT');pending+=decoder.decode(chunk,{stream:true});const events=[];
    let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);demand(records<2&&line.length>0,'OBSERVER_RECORD_ORDER');const value=JSON.parse(line);parseObserverReceipt(value,expected,records===0?'ready':'watch');records++;events.push(value);}
    return events;
   }catch(error){failed=error;throw error;}
  },
  finish(){if(failed)throw failed;pending+=decoder.decode();demand(records===2&&pending==='','OBSERVER_RECEIPT_MISSING');return true;}
 });
}
/** Observes only a caller-supplied owned child; this helper cannot launch one. */
export async function observeOwnedClosure(child,closed,options,budget,report){
 const {waitForChildClose}=await import('./test-mac-directory-copy-native.mjs');
 try{
  const result=await waitForChildClose(child,closed,options);
  if(options?.owner===true&&result.timedOut){budget.markUnknown();report.cleanupState='UNVERIFIED';if(report.state!=='BLOCKING')report.state='CLEANUP_UNVERIFIED';}
  return result;
 }catch(error){budget.markUnknown();report.cleanupState='UNVERIFIED';if(report.state!=='BLOCKING')report.state='CLEANUP_UNVERIFIED';throw error;}
}
let activeDeadline;
function effect(){if(activeDeadline!==undefined)assertDeadline(activeDeadline);}

export function parsePersistedReply(raw,receipt){
 demand(receipt?.persisted===true&&receipt.closed===true&&receipt.truncated===false&&receipt.exitCode===0,'RAW_RECEIPT_REQUIRED');
 const bytes=Buffer.from(raw);demand(bytes.length>0&&bytes.length<=bound.responseBytes,'REPLY_LIMIT');
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 demand(value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.ok==='boolean','REPLY_SCHEMA');return value;
}

export function assertPreflight(value){
 demand(value?.platform==='darwin'&&value.arch==='arm64'&&value.hostRelease==='27.0.0','HOST_MISMATCH');
 demand(value.reviewed===true,'NOT_READY');
 demand(value.release===hashes.release&&value.code===hashes.code&&value.source===hashes.source&&value.runtimeFrozen===true,'BINDING_MISMATCH');
}

/** Exported entry deliberately ignores its argument without reading properties.
 * Test objects and Proxy callbacks never obtain private native authority. */
export async function runPreparation(){throw failure('PRIVATE_CLI_ONLY');}

async function regularRead(file,max,{system=false,afterDeadline=false}={}){
 if(!afterDeadline)effect();
 demand(path.isAbsolute(file)&&await fs.realpath(file)===file,'INPUT_CANONICAL');
 const before=await fs.lstat(file);demand(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&(system?[0,process.getuid()].includes(before.uid):before.uid===process.getuid())&&before.size<=max,'INPUT_UNSAFE');
 if(system)systemInputInfo(before);
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const opened=await handle.stat();demand(opened.dev===before.dev&&opened.ino===before.ino,'INPUT_CHANGED');
  const bytes=Buffer.alloc(before.size+1);let count=0;
  while(count<bytes.length){const read=await handle.read(bytes,count,bytes.length-count,count);if(!read.bytesRead)break;count+=read.bytesRead;}
  const after=await handle.stat();demand(count===before.size&&after.ctimeMs===before.ctimeMs&&after.mtimeMs===before.mtimeMs,'INPUT_CHANGED');return bytes.subarray(0,count);
 }finally{await handle.close();}
}

async function privateWrite(file,bytes){effect();await fs.writeFile(file,bytes,{mode:0o600,flag:'wx'});}
async function privateDir(dir){effect();await fs.mkdir(dir,{mode:0o700});}
async function fileHash(file,afterDeadline=false){return sha(await regularRead(file,16*1024*1024,{afterDeadline}));}
async function absent(file){try{await fs.lstat(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
async function checkpoint(ctx){
 const data=JSON.stringify({...ctx.report,receiptTail:undefined,counts:ctx.report.mergedCounts??ctx.budget.snapshot()},null,2);
 const file=path.join(ctx.stage,ctx.reportFile??'report.json');await fs.writeFile(file,data,{mode:0o600});
 const handle=await fs.open(file,'r');try{await handle.sync();}finally{await handle.close();}
}

/** Every owned child, including a failed spawn, gets a launch reservation first.
 * waitForChildClose observes actual close; any unresolved closure sticks forever.
 * No retry, compile, shell, process scan or cleanup deletion exists here. */
async function transport(ctx,kind,executable,args,input=Buffer.alloc(0),options={}){
 effect();ctx.budget.reserve({[kind]:1});demand(now()<ctx.deadline,'DEADLINE');
 const request=Buffer.from(input);demand(request.length<=bound.requestBytes,'REQUEST_LIMIT');
 const {captureBoundedStream}=ctx.shared;
 let aborted,abortResolve;const abortPromise=new Promise(r=>abortResolve=r);
 const child=spawn(executable,args,{shell:false,env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp',...options.env},stdio:options.ownerFD?['pipe','pipe','pipe',3]:['pipe','pipe','pipe']});
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 const abort=reason=>{aborted??=failure(reason);abortResolve();};
 child.on('error',error=>{aborted??=error;abortResolve();});child.stdin?.on('error',()=>{});
 const stdout=captureBoundedStream(child.stdout,kind==='broker'?bound.responseBytes:kind==='observer'?bound.observerBytes:65536,()=>abort('OUTPUT_LIMIT'));
 const stderr=captureBoundedStream(child.stderr,bound.diagnosticBytes,()=>abort('DIAGNOSTIC_LIMIT'));
 let streamQueue=Promise.resolve(),streamBytes=0;
 if(options.onChunk)child.stdout.on('data',chunk=>{
  streamBytes+=chunk.length;if(streamBytes>bound.observerBytes||aborted){const error=failure('OBSERVER_OUTPUT_LIMIT');aborted??=error;abortResolve();options.onFailure?.(error);return;}
  streamQueue=streamQueue.then(()=>options.onChunk(Buffer.from(chunk))).catch(error=>{aborted??=error;abortResolve();options.onFailure?.(error);});
 });
 const safeChild={get exitCode(){return child.exitCode;},get signalCode(){return child.signalCode;},kill(signal){ctx.budget.reserve({signals:1});return child.kill(signal);},unref:()=>child.unref(),stdin:child.stdin,stdout:child.stdout,stderr:child.stderr};
 const completion=(async()=>{
  let result;
  try{result=await observeOwnedClosure(safeChild,closed,{owner:kind==='owner',timeoutMs:Math.max(1,Math.min(options.timeoutMs??bound.childMs,ctx.deadline-now()-bound.termMs-bound.killMs)),abortPromise,termGraceMs:bound.termMs,killGraceMs:bound.killMs},ctx.budget,ctx.report);}
  catch(error){ctx.budget.markUnknown();if(ctx.report.state!=='BLOCKING')ctx.report.state='CLEANUP_UNVERIFIED';await receipt(false,null,error);throw error;}
  await streamQueue;const record=await receipt(true,result.code,aborted);if(aborted)throw aborted;
  if(result.timedOut){
   // Closing the outer exec owner cannot prove closure of public module children
   // whose handles are private. Preserve permanent uncertainty on this path.
   if(kind==='owner'){ctx.budget.markUnknown();if(ctx.report.state!=='BLOCKING')ctx.report.state='CLEANUP_UNVERIFIED';ctx.report.cleanupState='UNVERIFIED';}
   throw failure('CHILD_TIMEOUT');
  }
  demand(result.code===0,'CHILD_EXIT');return {raw:stdout.bytes,receipt:record,child,result};
 })();completion.catch(()=>{});
 async function receipt(didClose,exitCode,error){
  const record={kind,executable,args,birthIdentity:'NOT_OBSERVED_EXCEPT_RELOCATION',pid:child.pid??null,parentPid:process.pid,closed:didClose,exitCode,truncated:stdout.truncated||stderr.truncated,error:error?String(error.code??error.message):undefined,request,response:stdout.bytes,stderr:stderr.bytes};
  await rawReceipt(ctx,record);await checkpoint(ctx);return {...record,persisted:true};
 }
 if(options.held)return {child,completion,stdout,stderr,send:()=>child.stdin.end(request),abort};
 child.stdin?.end(request);return completion;
}

async function rawReceipt(ctx,value){
 const total=Buffer.byteLength(value.request??[])+Buffer.byteLength(value.response??[])+Buffer.byteLength(value.stderr??[]);
 reserveReceiptBytes(ctx.report,total,ctx.receiptLimit??bound.receiptBytes);
 await ctx.shared.appendReceipt(ctx.report,value);
}

async function command(ctx,kind,file,args,input=''){return (await transport(ctx,kind,file,args,Buffer.from(input))).raw;}
async function importRuntime(relative){return import(pathToFileURL(path.join(root,'dist/src',relative)).href);}

async function freezeRuntime(){
 const files=[];
 async function walk(directory){effect();for(const name of (await fs.readdir(directory)).sort()){
  const file=path.join(directory,name),st=await fs.lstat(file);demand(!st.isSymbolicLink(),'RUNTIME_SYMLINK');
  if(st.isDirectory())await walk(file);else if(st.isFile()&&name.endsWith('.js'))files.push({path:path.relative(path.join(root,'dist/src'),file),sha256:await fileHash(file)});
 }}
 await walk(path.join(root,'dist/src'));demand(files.length>0&&files.length<2000,'RUNTIME_GRAPH');return files;
}
async function unchangedRuntime(ctx){demand(isDeepStrictEqual(await freezeRuntime(),ctx.runtime),'RUNTIME_CHANGED');for(const [key,name] of [['lifecycle','test-mac-directory-copy-native.mjs'],['controls','mac-recovery-probe-control.mjs']])demand(await fileHash(path.join(root,'scripts',name))===ctx.report.sourceHashes[key],'HELPER_CHANGED');}

async function filesystemPreflight(){
 const buildBytes=await regularRead(path.join(candidate,'build.json'),65536),binary=await regularRead(path.join(candidate,'release-broker'),16*1024*1024),build=JSON.parse(buildBytes.toString('utf8'));
 demand(sha(binary)===hashes.release&&build.release_sha256===hashes.release&&build.code_sha256===hashes.code&&build.source_sha256===hashes.source&&build.hostRelease==='27.0.0'&&build.arch==='arm64'&&build.compiler_sha256===hashes.compiler&&build.sdk.settings_sha256===hashes.sdk&&build.uuid==='FDA52F34-6BE1-31B0-A0DC-C581C1121517'&&build.signing_profile===signingProfile&&isDeepStrictEqual(build.arguments,['-O','-Xlinker','-reproducible']),'CANDIDATE_BINDING');
 demand(await fileHash(path.join(root,'native/macos-files/broker.swift'))===hashes.source,'SOURCE_CHANGED');
 demand(sha(await regularRead(await fs.realpath(path.join(build.sdk.path,'SDKSettings.json')),1024*1024,{system:true}))===hashes.sdk,'SDK_CHANGED');
 const compiler='/Library/Developer/CommandLineTools/usr/bin/swiftc';
 // Compiler paths can be symlinks. Canonicalize only this declared tool input.
 demand(sha(await regularRead(await fs.realpath(compiler),256*1024*1024,{system:true}))===hashes.compiler,'COMPILER_CHANGED');
 const runtime=await freezeRuntime();
 const sourceHashes={driver:await fileHash(script),plan:await fileHash(planFile),observer:await fileHash(observer),owner:await fileHash(ownerLauncher),lifecycle:await fileHash(path.join(root,'scripts/test-mac-directory-copy-native.mjs')),controls:await fileHash(path.join(root,'scripts/mac-recovery-probe-control.mjs')),build:sha(buildBytes),runtime:sha(JSON.stringify(runtime))};
 demand(await absent(slot),'ATTEMPT_CONSUMED');
 return {build,binary,buildBytes,runtime,sourceHashes};
}

async function bundle(ctx,installation,grant){
 const directory=path.join(installation,grant.id),app=path.join(directory,'Broker.app'),contents=path.join(app,'Contents'),macos=path.join(contents,'MacOS');
 for(const dir of [directory,app,contents,macos])await privateDir(dir);
 const binary=path.join(macos,'broker');effect();await fs.copyFile(path.join(ctx.stage,'release-broker'),binary,constants.COPYFILE_EXCL);effect();await fs.chmod(binary,0o500);demand(await fileHash(binary)===hashes.release,'COPY_HASH');
 const info={CFBundleExecutable:'broker',CFBundleIdentifier:'local.gsa.scoped.'+grant.id,CFBundleName:'Broker',CFBundlePackageType:'APPL',CFBundleVersion:'1',GSAWorkspaceID:grant.id,GSAWorkspaceRole:grant.role,GSAWorkspaceRoot:grant.root,GSARevision:grant.revision,GSADevice:grant.rootIdentity.device,GSAInode:grant.rootIdentity.inode};
 const infoBytes=await command(ctx,'tool','/usr/bin/plutil',['-convert','xml1','-o','-','-'],JSON.stringify(info));await privateWrite(path.join(contents,'Info.plist'),infoBytes);
 const right='com.apple.security.temporary-exception.files.absolute-path.'+(grant.role==='reference'?'read-only':'read-write');
 const entitlements={'com.apple.security.app-sandbox':true,[right]:[grant.root+'/']},entitlementFile=path.join(directory,'entitlements.plist');
 await privateWrite(entitlementFile,await command(ctx,'tool','/usr/bin/plutil',['-convert','xml1','-o','-','-'],JSON.stringify(entitlements)));
 await command(ctx,'sign','/usr/bin/codesign',['--force','--sign','-','--entitlements',entitlementFile,app]);
 effect();await fs.chmod(path.join(contents,'_CodeSignature'),0o700);effect();await fs.chmod(path.join(contents,'_CodeSignature/CodeResources'),0o600);
 await command(ctx,'tool','/usr/bin/codesign',['--verify','--strict',app]);
 const signed=await command(ctx,'tool','/usr/bin/codesign',['--display','--entitlements',':-',app]);
 demand(isDeepStrictEqual(JSON.parse((await command(ctx,'tool','/usr/bin/plutil',['-convert','json','-o','-','-'],signed)).toString()),entitlements),'ENTITLEMENTS');
 // Sixth nonsigning command per bundle: remove only this owned scratch signature.
 const scratch=path.join(directory,'code-check');effect();await fs.copyFile(binary,scratch,constants.COPYFILE_EXCL);effect();await fs.chmod(scratch,0o700);
 await command(ctx,'tool','/usr/bin/codesign',['--remove-signature',scratch]);
 const {normalizedStrippedMacFileCode}=await importRuntime('hosts/macos-file-code.js');demand(sha(normalizedStrippedMacFileCode(await regularRead(scratch,16*1024*1024)))===hashes.code,'CODE_CHANGED');
 const artifacts={};for(const name of artifactNames)artifacts[name]=await fileHash(path.join(app,name));
 return {...grant,artifacts,presign_sha256:hashes.release,code_sha256:hashes.code};
}

function request(grant,operation,relative,extra={}){return {operation,workspace_id:grant.id,role:grant.role,root:grant.root,device:grant.rootIdentity.device,inode:grant.rootIdentity.inode,revision:grant.revision,path:relative,...extra};}
async function direct(ctx,grant,operation,relative,extra={}){
 const q=request(grant,operation,relative,extra),bytes=Buffer.from(JSON.stringify(q));
 const result=await transport(ctx,'broker',path.join(ctx.installation,grant.id,'Broker.app/Contents/MacOS/broker'),[],bytes,{ownerFD:true});
 return {request:q,response:parsePersistedReply(result.raw,result.receipt)};
}
async function envelope(installation,build,grants,evidence,key){
 const body=JSON.stringify({format:'gsa-scoped-files-v2',hostRelease:build.hostRelease,arch:build.arch,grants,build,evidence});
 await privateWrite(path.join(installation,'proof-key'),key);
 await privateWrite(path.join(installation,'install.json'),JSON.stringify({body,hmac:createHmac('sha256',key).update(body).digest('hex')}));
}
async function canaries(ctx){
 const values=[];for(const before of ctx.report.canaries){
  let observed;try{observed=classifyCanary(before,await fileHash(before.path,true));}catch(error){
   observed={...before,after_sha256:null,changed:null,error:String(error.code??error.message)};
   try{
    const info=await fs.lstat(before.path);const after={exists:true,isFile:info.isFile(),isSymbolicLink:info.isSymbolicLink(),nlink:info.nlink,mode:info.mode&0o777,identity:identity(info)};
    observed.after=after;
    if(!after.isFile||after.isSymbolicLink||after.nlink!==1){observed.changed=true;observed.change='CANARY_TYPE_CHANGED';}
   }catch(infoError){if(infoError.code==='ENOENT'){observed.after={exists:false};observed.changed=true;observed.change='CANARY_MISSING';}else observed.observationError=String(infoError.code??infoError.message);}
  }
  values.push(observed);
 }
 ctx.report.canaryChecks??=[];ctx.report.canaryChecks.push({phase:ctx.report.phase,at:now(),values});
 const changed=values.filter(value=>value.changed===true);if(changed.length){recordBlocking(ctx.report,'CANARY_CHANGED',{values:changed});await checkpoint(ctx);throw failure('CANARY_CHANGED');}
 if(values.some(value=>value.changed===null)){await checkpoint(ctx);throw failure('CANARY_UNVERIFIED');}
 return values;
}

async function positives(ctx,work,ref){
 const o=ctx.report.observations,content=Buffer.from('workspace-native-create-read'),reference=Buffer.from('reference-copy-source');
 o.create=await direct(ctx,work,'create','created.bin',{base64:content.toString('base64')});demand(o.create.response.ok===true,'CREATE_FAILED');
 Object.assign(o.create,{expected_sha256:sha(content),readback_sha256:await fileHash(path.join(work.root,'created.bin'))});demand(o.create.expected_sha256===o.create.readback_sha256,'CREATE_READBACK');
 o.read=await direct(ctx,work,'read','created.bin',{maxBytes:1024});o.read.expected_sha256=sha(content);demand(o.read.response.ok===true&&o.read.response.sha256===sha(content)&&o.read.response.base64===content.toString('base64'),'READ_FAILED');
 o.mkdir=await direct(ctx,work,'mkdir','created-dir');o.mkdir.isDirectory=(await fs.lstat(path.join(work.root,'created-dir'))).isDirectory();demand(o.mkdir.response.ok===true&&o.mkdir.isDirectory,'MKDIR_FAILED');
 o.referenceRead=await direct(ctx,ref,'read','source.bin',{maxBytes:1024});o.referenceRead.expected_sha256=sha(reference);demand(o.referenceRead.response.ok===true&&o.referenceRead.response.sha256===sha(reference)&&o.referenceRead.response.base64===reference.toString('base64'),'REF_READ_FAILED');
 o.copy=await direct(ctx,work,'create','copied.bin',{base64:o.referenceRead.response.base64});Object.assign(o.copy,{sourceRequest:o.referenceRead.request,expected_sha256:sha(reference),readback_sha256:await fileHash(path.join(work.root,'copied.bin'))});demand(o.copy.response.ok===true&&o.copy.expected_sha256===o.copy.readback_sha256,'COPY_READBACK');
 const before=await fileHash(path.join(work.root,'collision.bin'));o.collision=await direct(ctx,work,'create','collision.bin',{base64:content.toString('base64')});Object.assign(o.collision,{error:o.collision.response.error,before_sha256:before,after_sha256:await fileHash(path.join(work.root,'collision.bin'))});demand(o.collision.response.ok===false&&['DESTINATION_EXISTS','ALREADY_EXISTS_OR_DENIED'].includes(o.collision.error)&&o.collision.before_sha256===o.collision.after_sha256,'COLLISION_FAILED');
 await canaries(ctx);await checkpoint(ctx);
}

async function privateCandidate(ctx,registry,options){
 const runtime=path.join(ctx.stage,'runtime');await privateDir(runtime);
 for(const entry of ctx.runtime){const destination=path.join(runtime,entry.path);effect();await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});effect();await fs.copyFile(path.join(root,'dist/src',entry.path),destination,constants.COPYFILE_EXCL);effect();await fs.chmod(destination,0o600);demand(await fileHash(destination)===entry.sha256,'RUNTIME_COPY');}
 const target=path.join(runtime,'hosts/macos-scoped-files.js'),original=await regularRead(target,1024*1024);
 const bridge='\nexport async function mac27DiagnosticCandidate(registry, root, options) { return constructMacScopedFiles(registry, root, options, true); }\n';
 effect();await fs.appendFile(target,bridge);const copied=await regularRead(target,1024*1024);
 demand(copied.equals(Buffer.concat([original,Buffer.from(bridge)])),'BRIDGE_DIFF');
 // package.json is confined to this disposable copied graph, preserving ESM.
 await privateWrite(path.join(runtime,'package.json'),' {"type":"module"}\n');
 ctx.report.bridge={original_sha256:sha(original),copy_sha256:sha(copied),diff:{operation:'append',bytes:bridge},dependencies:ctx.runtime};
 await unchangedRuntime(ctx);ctx.budget.reserve({tool:10});await checkpoint(ctx);
 effect();return (await import(pathToFileURL(target).href)).mac27DiagnosticCandidate(registry,ctx.installation,options);
}

async function diagnostics(ctx,work,ref){
 const {loadTrustedRegistry,revokeTrusted,enrollRolesTrustedBatch}=await importRuntime('local/grants.js');
 const {ControlLeaseStore}=await importRuntime('local/control-lease.js');const {withControlToken}=await importRuntime('mcp/control-context.js');const {authorizeMcpWorkspace}=await importRuntime('mcp/runtime-bootstrap.js');
 const registry=await loadTrustedRegistry(ctx.identity),store=new ControlLeaseStore(ctx.identity),lease=await store.acquire();
 const authorize=(id,permission)=>authorizeMcpWorkspace(registry,id,ctx.identity,permission),io=await privateCandidate(ctx,registry,{ownerLockFD:3,authorize});
 const call=fn=>withControlToken(store,lease.control_token,fn),bytes=Buffer.from('must-not-write');
 async function denial(name,grant,relative,action){
  const before=ctx.budget.snapshot();let thrown;
  try{effect();await call(action);}catch(error){thrown=denialError(error);}
  const record={request:request(grant,'create',relative,{base64:bytes.toString('base64')}),error:thrown?(thrown.code||thrown.message):undefined,thrown,absent:await absent(path.join(grant.root,relative)),admission:'DIAGNOSTIC_PRIVATE_CANDIDATE',before,after:ctx.budget.snapshot(),rawInternalReceipts:'UNAVAILABLE_PUBLIC_API'};
  ctx.report.observations[name]=record;await checkpoint(ctx);demand(thrown&&record.absent&&isDeepStrictEqual(record.before,record.after),'DIAGNOSTIC_DENIAL');return record;
 }
 try{
  // Reference destination is a zero-launch permission denial at the real API.
  await denial('referenceDestination',ref,'denied.bin',()=>io.createExclusive({workspace_id:ref.id,path:'denied.bin'},bytes));
  const app=path.join(ctx.installation,work.id,'Broker.app'),info=path.join(app,'Contents/Info.plist'),saved=await regularRead(info,65536),mode=(await fs.lstat(info)).mode&0o777;
  const before={};for(const name of artifactNames)before[name]=await fileHash(path.join(app,name));
  try{
   effect();await fs.writeFile(info,Buffer.concat([saved,Buffer.from('\n<!-- owned artifact mismatch -->\n')]));
   await denial('artifactMismatch',work,'mismatch.bin',()=>io.createExclusive({workspace_id:work.id,path:'mismatch.bin'},bytes));
  }finally{
   effect();await fs.writeFile(info,saved,{mode});effect();await fs.chmod(info,mode);
   const after={};for(const name of artifactNames)after[name]=await fileHash(path.join(app,name));
   demand(isDeepStrictEqual(before,after)&&(await regularRead(info,65536)).equals(saved),'ARTIFACT_RESTORE_FAILED');
   ctx.report.artifactRestore={before,after,exactBytes:true,mode};
  }
  effect();await revokeTrusted(work.id,ctx.identity);
  const revoked=JSON.parse((await regularRead(path.join(ctx.identity,'trusted-workspaces.json'),1024*1024)).toString());
  demand(revoked.find(g=>g.id===work.id)?.revision===2&&revoked.find(g=>g.id===work.id)?.revoked===true,'REVOCATION_HISTORY');
  await denial('staleGrant',work,'stale.bin',()=>io.createExclusive({workspace_id:work.id,path:'stale.bin'},bytes));
  effect();const enrolled=await enrollRolesTrustedBatch([{id:work.id,root:work.root,role:'workspace'}],ctx.identity),current=enrolled[0].grant;
  demand(current.revision===3&&isDeepStrictEqual(current.rootIdentity,work.rootIdentity),'REENROLL_HISTORY');
  ctx.report.revisionHistory=[{revision:1,role:'workspace',binding:work},{revision:2,revoked:true},{revision:3,binding:current}];
  await canaries(ctx);return {...work,revision:3};
 }finally{await store.release(lease.control_token);}
}

async function relocation(ctx,work){
 const parentPath=path.join(work.root,'held-parent'),relocatedPath=path.join(ctx.stage,'outside/relocated-parent'),target=path.join(parentPath,'target.bin'),outsideTarget=path.join(relocatedPath,'target.bin');
 const parentIdentity=identity(await fs.lstat(parentPath,{bigint:true})),payload=Buffer.alloc(8*1024*1024,90),q=request(work,'create','held-parent/target.bin',{base64:payload.toString('base64')}),raw=Buffer.from(JSON.stringify(q));
 demand(await absent(target)&&await absent(relocatedPath),'RELOCATION_SETUP');
 const binary=path.join(ctx.installation,work.id,'Broker.app/Contents/MacOS/broker');
 const held=await transport(ctx,'broker',binary,[],raw,{ownerFD:true,held:true});let stopped=false,resumed=false,proof,watch;
 const timeline={};const tick=name=>recordPhase(timeline,name,now());
 try{
  // Native child waits on stdin, so exact PID identity precedes the single watch.
  const idRun=await transport(ctx,'observer','/usr/bin/python3',[observer,'identity',String(held.child.pid),String(process.pid),binary]);
  const id=JSON.parse(idRun.raw.toString()),expected={pid:held.child.pid,parentPid:process.pid,startTime:id.startTime,executable:binary,...parentIdentity};parseObserverReceipt(id,expected,'identity');
  ctx.report.relocationProcess=id;
  ctx.budget.reserve({signals:1}); // one possible SIGSTOP performed by observer
  const lines=createObserverLines(expected);let readyResolve,readyReject;
  const readyPromise=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});readyPromise.catch(()=>{});
  watch=await transport(ctx,'observer','/usr/bin/python3',[observer,'watch',String(held.child.pid),String(process.pid),binary,id.startTime,parentIdentity.device,parentIdentity.inode,'-'],Buffer.alloc(0),{held:true,timeoutMs:bound.watchMs,
   async onChunk(chunk){
    demand(chunk.length<=bound.observerBytes,'OBSERVER_OUTPUT_LIMIT');
    await rawReceipt(ctx,{kind:'observer-watch-chunk',pid:held.child.pid,request:Buffer.alloc(0),response:chunk,stderr:Buffer.alloc(0)});
    for(const value of lines.push(chunk)){if(value.event==='WATCH_READY')readyResolve(value);}
   },onFailure:readyReject});
  watch.send();watch.completion.then(()=>readyReject(failure('OBSERVER_READY_MISSING')),readyReject);
  const ready=await readyPromise;parseObserverReceipt(ready,expected,'ready');held.send();
  const watched=await watch.completion;lines.finish();
  const watchRecords=new TextDecoder('utf-8',{fatal:true}).decode(watched.raw).trimEnd().split('\n');
  const hit=parseObserverReceipt(JSON.parse(watchRecords[1]),expected,'watch');stopped=true;
  const confirmed=await transport(ctx,'observer','/usr/bin/python3',[observer,'confirm',String(held.child.pid),String(process.pid),binary,id.startTime,parentIdentity.device,parentIdentity.inode,String(hit.fd)]);
  proof=parseObserverReceipt(JSON.parse(confirmed.raw.toString()),{...expected,fd:hit.fd},'stop');tick('stopConfirmed');
  demand(await absent(target),'TARGET_ALREADY_EXISTS');tick('targetAbsentBeforeMove');
  effect();ctx.budget.reserve({relocation:1});await fs.rename(parentPath,relocatedPath);const relocatedIdentity=identity(await fs.lstat(relocatedPath,{bigint:true}));demand(isDeepStrictEqual(parentIdentity,relocatedIdentity),'PARENT_CHANGED');tick('parentRelocated');
  demand(await absent(outsideTarget),'OUTSIDE_TARGET_EXISTS');tick('outsideTargetAbsentBeforeResume');
  // proof is from an independent confirm while the exact owned child is stopped.
  demand(held.child.pid===proof.pid&&held.child.exitCode===null&&held.child.signalCode===null,'PROCESS_CHANGED');ctx.budget.reserve({signals:1});demand(held.child.kill('SIGCONT'),'RESUME_FAILED');resumed=true;tick('resumed');
  const result=await held.completion,response=parsePersistedReply(result.raw,result.receipt);
  const outsideAbsent=await absent(outsideTarget);
  ctx.report.observations.interiorRelocation={status:outsideAbsent?'PENDING':'BLOCKING',parentPath,relocatedPath,parentIdentity,relocatedIdentity,pid:proof.pid,fd:proof.fd,response,targetOutsideAfter:{path:outsideTarget,exists:!outsideAbsent},timeline};
  if(!outsideAbsent){recordBlocking(ctx.report,'OUTSIDE_MUTATION',{path:outsideTarget,exists:true,response,timeline});await checkpoint(ctx);throw failure('OUTSIDE_MUTATION');}
  await canaries(ctx);tick('outsideTargetObservedAfterResume');
  demand(response.ok===false&&['ALREADY_EXISTS_OR_DENIED','PATH_OR_ACCESS_DENIED','SECURITY_BLOCKED','ROOT_UNVERIFIED'].includes(response.error),'RELOCATION_RESPONSE');
  const metadata={};for(const name of ['operation','workspace_id','role','root','device','inode','revision','path'])metadata[name]=q[name];
  ctx.report.observations.interiorRelocation={status:'OBSERVED',observation_method:'libproc-owned-pid-fd-v1',request:{...metadata,payload_ref:'interiorRelocation.payload'},payload:{encoding:'repeat-byte-v1',byte:90,length:payload.length,sha256:sha(payload)},request_bytes:raw.length,request_sha256:sha(raw),parentPath,relocatedPath,parentIdentity,relocatedIdentity,pid:proof.pid,fd:proof.fd,stopped:true,resumed:true,response,outsideTargetAbsent:true,targetBeforeMove:{path:target,exists:false},targetOutsideBefore:{path:outsideTarget,exists:false},targetOutsideAfter:{path:outsideTarget,exists:false},stopConfirmation:{pid:proof.pid,signal:proof.signal,state:proof.state,fd:proof.fd,parentIdentity},timeline};
  await checkpoint(ctx);
 }catch(error){
  ctx.report.observations.interiorRelocation={...ctx.report.observations.interiorRelocation,status:ctx.report.state==='BLOCKING'?'BLOCKING':'INCONCLUSIVE',reason:String(error.code??error.message),timeline};
  // Ambiguous STOP cannot authorize a guessed resume or PID scan.
  if(stopped&&!resumed&&proof&&held.child.pid===proof.pid&&held.child.exitCode===null&&held.child.signalCode===null){ctx.budget.reserve({signals:1});held.child.kill('SIGCONT');}
  held.abort('RELOCATION_ABORT');try{await held.completion;}catch(closeError){if(closeError.code==='CLEANUP_UNVERIFIED')ctx.budget.markUnknown();}
  if(watch)try{await watch.completion;}catch(closeError){if(closeError.code==='CLEANUP_UNVERIFIED')ctx.budget.markUnknown();}
  try{if(!await absent(outsideTarget)){recordBlocking(ctx.report,'OUTSIDE_MUTATION',{path:outsideTarget,exists:true,timeline,reason:String(error.code??error.message)});ctx.report.observations.interiorRelocation.status='BLOCKING';}}catch(observationError){ctx.report.unresolved.push('outside readback: '+String(observationError.code??observationError.message));}
  try{await canaries(ctx);}catch{}
  await checkpoint(ctx);throw error;
 }
}

async function strictJourney(ctx,evidence,work,reference){
 await unchangedRuntime(ctx);
 const {requireMacFileBuild,requireMacFileEvidence}=await importRuntime('hosts/macos-file-evidence.js');requireMacFileBuild(ctx.build);requireMacFileEvidence(evidence,ctx.build);
 await privateWrite(path.join(ctx.stage,'native-evidence.json'),JSON.stringify(evidence,null,2));
 const installation=path.join(ctx.stage,'strict-installation');await privateDir(installation);
 const newWork=await bundle(ctx,installation,work);
 // Reference has unchanged revision and signature; copy its already signed tree.
 effect();await fs.cp(path.join(ctx.installation,reference.id),path.join(installation,reference.id),{recursive:true,errorOnExist:true,force:false,dereference:false});
 for(const name of artifactNames)demand(await fileHash(path.join(installation,reference.id,'Broker.app',name))===reference.artifacts[name],'REFERENCE_SIGNATURE_CHANGED');
 await envelope(installation,ctx.build,[newWork,reference],evidence,randomBytes(32));
 const {loadTrustedRegistry}=await importRuntime('local/grants.js'),{ControlLeaseStore}=await importRuntime('local/control-lease.js'),{withControlToken}=await importRuntime('mcp/control-context.js'),{authorizeMcpWorkspace}=await importRuntime('mcp/runtime-bootstrap.js');
 const registry=await loadTrustedRegistry(ctx.identity),store=new ControlLeaseStore(ctx.identity),lease=await store.acquire();
 try{
  ctx.budget.reserve({tool:10});await checkpoint(ctx);await unchangedRuntime(ctx);
  // Only ORIGINAL production public module; candidate bridge is not imported.
  const {loadMacScopedFiles}=await importRuntime('hosts/macos-scoped-files.js');effect();const io=await loadMacScopedFiles(registry,installation,{ownerLockFD:3,authorize:(id,permission)=>authorizeMcpWorkspace(registry,id,ctx.identity,permission)});
  ctx.report.public={admission:'ORIGINAL_PUBLIC_LOADER',installation,bindings:[newWork,reference],operations:[],rawInternalReceipts:'UNAVAILABLE: public API exposes neither stdout nor stderr; no raw claim'};
  async function invoke(name,brokers,operation,readback){
   await unchangedRuntime(ctx);ctx.budget.reserve({broker:brokers,tool:brokers*5});await checkpoint(ctx);
   let result;try{effect();result=await withControlToken(store,lease.control_token,operation);}catch(error){ctx.report.public.operations.push({name,resolution:'REJECTED',code:String(error.code??''),message:String(error.message)});throw error;}
   const observed=await readback(result);ctx.report.public.operations.push({name,resolution:'FULFILLED',readback:observed});await canaries(ctx);await checkpoint(ctx);return result;
  }
  const ref={workspace_id:work.id,path:'strict/create.bin'},content=Buffer.from('strict-loader-create-read');
  await invoke('makeDirectory',1,()=>io.makeDirectory({workspace_id:work.id,path:'strict'}),async()=>{demand((await fs.lstat(path.join(work.root,'strict'))).isDirectory(),'PUBLIC_MKDIR');return {isDirectory:true};});
  await invoke('createExclusive',1,()=>io.createExclusive(ref,content),async()=>{const digest=await fileHash(path.join(work.root,ref.path));demand(digest===sha(content),'PUBLIC_CREATE');return {sha256:digest};});
  await invoke('read',1,()=>io.read(ref,1024),async result=>{demand(Buffer.from(result.bytes).equals(content)&&result.sha256===sha(content),'PUBLIC_READ');return {sha256:result.sha256};});
  const wanted=ctx.report.observations.referenceRead.expected_sha256;
  await invoke('copyExclusive',2,()=>io.copyExclusive({workspace_id:reference.id,path:'source.bin'},{workspace_id:work.id,path:'strict/copied.bin'},wanted),async()=>{const digest=await fileHash(path.join(work.root,'strict/copied.bin'));demand(digest===wanted,'PUBLIC_COPY');return {sha256:digest};});
  await unchangedRuntime(ctx);ctx.report.state='STRICT_PUBLIC_BASE_OBSERVED';
 }finally{await store.release(lease.control_token);}
}

async function worker(ctx,token){
 demand(token===authority,'PRIVATE_CLI_ONLY');
 const {enrollRolesTrustedBatch}=await importRuntime('local/grants.js');
 const selections=[{id:'mac27-base-workspace',root:path.join(ctx.stage,'workspace'),role:'workspace'},{id:'mac27-base-reference',root:path.join(ctx.stage,'reference'),role:'reference'}];
 effect();const enrolled=await enrollRolesTrustedBatch(selections,ctx.identity);const grants=enrolled.map(row=>({id:row.id,root:row.root,role:row.grant.role,revision:row.grant.revision,rootIdentity:row.grant.rootIdentity}));demand(grants.every(g=>g.revision===1),'INITIAL_REVISION');
 const work=await bundle(ctx,ctx.installation,grants[0]),reference=await bundle(ctx,ctx.installation,grants[1]);
 await envelope(ctx.installation,ctx.build,[work,reference],null,randomBytes(32));
 ctx.report.originalBindings=[work,reference];ctx.report.phase='direct-qualification';await canaries(ctx);await positives(ctx,work,reference);
 ctx.report.phase='held-parent';await relocation(ctx,work);
 ctx.report.phase='diagnostic-admission';const workRev3=await diagnostics(ctx,work,reference);
 const evidence={format:'gsa-scoped-files-native-evidence-v2',signing_profile:signingProfile,build:ctx.build,fixture:{stage:ctx.stage,stageIdentity:identity(await fs.lstat(ctx.stage,{bigint:true})),hostRelease:ctx.build.hostRelease,arch:ctx.build.arch,owner_fd:3,roots:[work,reference]},observations:{...ctx.report.observations,outsideCanaries:(await canaries(ctx)).filter(c=>!c.path.startsWith(work.root+'/'))},unresolved:[]};
 ctx.report.phase='strict-public';await strictJourney(ctx,evidence,workRev3,reference);await checkpoint(ctx);
}

/** Outer private entry. An env selector alone never authorizes worker entry: the
 * fixed reservation, driver hash, stage ownership and FD3 owner record must bind.
 * The owner launcher execs Node, so its one process slot is retained throughout. */
async function nativeMain(token){
 demand(token===authority,'PRIVATE_CLI_ONLY');demand(SOURCE_REVIEW_COMPLETE,'NOT_READY');
 // One clock begins at admitted entry, before preflight or any fixture effect.
 const startedAt=Date.now(),startedMono=now(),deadlineAt=startedAt+bound.runMs;activeDeadline=deadlineAt;
 const preflight=await filesystemPreflight();effect();assertPreflight({platform:process.platform,arch:process.arch,hostRelease:os.release(),reviewed:SOURCE_REVIEW_COMPLETE,release:preflight.build.release_sha256,code:preflight.build.code_sha256,source:preflight.build.source_sha256,runtimeFrozen:true});
 // Choose a path and immutable input in memory before the durable reservation.
 // Creating the stage only happens after reservation; there is no slot rewrite.
 const stage='/private/tmp/gsa-mac27-base-'+randomBytes(12).toString('hex');
 const canaryRecords=[{path:path.join(stage,'outside/canary.bin'),before_sha256:sha('outside-preserved')},{path:path.join(stage,'workspace/neighbor.bin'),before_sha256:sha('neighbor-preserved')}];
 const report={format:'gsa-mac27-base-driver-v1',state:'STARTED',stage,phase:'owner-start',unresolved:[],receipts:[],receiptRoot:receiptRoot(stage,'owner'),canaries:canaryRecords,observations:{},runtime:preflight.runtime,sourceHashes:preflight.sourceHashes,activation:false,signalAccounting:{managedCap:8,ownerAllocation:2,workerAllocation:6,internalPrivateCommands:'UNVERIFIED'}};
 // Each process begins receipt index 0001. Bind distinct private namespaces in
 // both report objects before freezing the worker-input digest and reservation.
 const inputReport={...report,receipts:[],receiptRoot:receiptRoot(stage,'worker'),unresolved:[],observations:{}};
 const inputBytes=Buffer.from(JSON.stringify({stage,build:preflight.build,runtime:preflight.runtime,sourceHashes:preflight.sourceHashes,report:inputReport,startedAt,deadlineAt}));
 const {reserveAttempt}=await import('./mac-recovery-probe-control.mjs');effect();
 await reserveAttempt(slot,{format:'gsa-mac27-base-once-v1',at:new Date(startedAt).toISOString(),stage,inputSha256:sha(inputBytes),startedAt,deadlineAt,hashes:preflight.sourceHashes,build:preflight.build,caps,bounds:bound,activation:false});
 await privateDir(stage);demand(await fs.realpath(stage)===stage,'STAGE_CANONICAL');
 for(const name of ['workspace','reference','outside','identity','installation','receipts','receipts/owner','receipts/worker'])await privateDir(path.join(stage,name));
 await privateDir(path.join(stage,'workspace/held-parent'));
 await privateWrite(path.join(stage,'reference/source.bin'),'reference-copy-source');await privateWrite(path.join(stage,'workspace/collision.bin'),'preserve-this');
 await privateWrite(path.join(stage,'outside/canary.bin'),'outside-preserved');await privateWrite(path.join(stage,'workspace/neighbor.bin'),'neighbor-preserved');
 await privateWrite(path.join(stage,'release-broker'),preflight.binary);effect();await fs.chmod(path.join(stage,'release-broker'),0o500);demand(await fileHash(path.join(stage,'release-broker'))===hashes.release,'COPIED_RELEASE_CHANGED');
 await privateWrite(path.join(stage,'build.json'),preflight.buildBytes);await privateWrite(path.join(stage,'worker-input.json'),inputBytes);
 const shared=await import('./test-mac-directory-copy-native.mjs');const ctx={stage,report,reportFile:'owner-report.json',budget:createBudget({signalLimit:2,childLimit:1}),receiptLimit:128*1024,deadline:startedMono+bound.runMs,shared};
 let workerReport;
 try{
  await transport(ctx,'owner','/usr/bin/python3',[ownerLauncher,'--identity',path.join(stage,'identity'),'--node',await fs.realpath(process.execPath),'--entry',script],Buffer.alloc(0),{timeoutMs:assertDeadline(deadlineAt)-bound.termMs-bound.killMs,env:{GSA_MAC27_PREP_WORKER_STAGE:stage}});
  workerReport=JSON.parse((await regularRead(path.join(stage,'report.json'),1024*1024,{afterDeadline:true})).toString());
  const merged=mergeRunState({...report,counts:ctx.budget.snapshot()},workerReport);Object.assign(report,merged,{mergedCounts:merged.counts});await checkpoint(ctx);
  console.log(JSON.stringify({state:merged.state,stage,activation:false}));
 }catch(error){
  try{workerReport=JSON.parse((await regularRead(path.join(stage,'report.json'),1024*1024,{afterDeadline:true})).toString());}catch{ctx.budget.markUnknown();}
  report.state=report.state==='BLOCKING'?'BLOCKING':ctx.budget.unknown?'CLEANUP_UNVERIFIED':'INCONCLUSIVE';if(ctx.budget.unknown)report.cleanupState='UNVERIFIED';
  report.unresolved.push(String(error.code??error.message));const merged=mergeRunState({...report,counts:ctx.budget.snapshot()},workerReport);Object.assign(report,merged,{mergedCounts:merged.counts});await checkpoint(ctx);throw error;
 }
}

async function workerMain(stage,token){
 demand(token===authority&&SOURCE_REVIEW_COMPLETE,'NOT_READY');
 demand(typeof stage==='string'&&/^\/private\/tmp\/gsa-mac27-base-[A-Za-z0-9]+$/.test(stage)&&await fs.realpath(stage)===stage,'WORKER_STAGE');
 const s=await fs.lstat(stage);demand(s.uid===process.getuid()&&s.isDirectory()&&(s.mode&0o777)===0o700,'WORKER_OWNER');
 const inputBytes=await regularRead(path.join(stage,'worker-input.json'),1024*1024),input=JSON.parse(inputBytes.toString()),reservation=JSON.parse((await regularRead(slot,1024*1024)).toString());
 demand(input.stage===stage&&reservation.stage===stage&&reservation.inputSha256===sha(inputBytes)&&reservation.hashes.driver===await fileHash(script)&&isDeepStrictEqual(input.sourceHashes,reservation.hashes)&&isDeepStrictEqual(input.build,reservation.build)&&isDeepStrictEqual(reservation.caps,caps)&&reservation.startedAt===input.startedAt&&reservation.deadlineAt===input.deadlineAt,'WORKER_RESERVATION');
 demand(process.env.GSA_OWNER_LOCK_FD==='3'&&process.env.GSA_OWNER_IDENTITY===path.join(stage,'identity'),'OWNER_FD');
 const fd=await new Promise((resolve,reject)=>{import('node:fs').then(mod=>mod.fstat(3,(error,value)=>error?reject(error):resolve(value)));});
 const lock=await fs.lstat(path.join(stage,'identity/server-owner.lock'));demand(fd.dev===lock.dev&&fd.ino===lock.ino,'OWNER_LOCK_IDENTITY');
 const owner=JSON.parse((await regularRead(path.join(stage,'identity/server-owner.lock'),4096)).toString());demand(owner.pid===process.pid&&owner.session===process.env.GSA_OWNER_SESSION,'OWNER_SESSION');
 demand(Number.isFinite(input.startedAt)&&input.deadlineAt-input.startedAt===bound.runMs,'WORKER_DEADLINE');
 const remaining=assertDeadline(input.deadlineAt);demand(remaining<=bound.runMs,'WORKER_DEADLINE');activeDeadline=input.deadlineAt;effect();
 await claimWorkerEntry(stage,{stage,driverSha256:reservation.hashes.driver,inputSha256:sha(inputBytes)});
 const shared=await import('./test-mac-directory-copy-native.mjs'),budget=createBudget({signalLimit:6,childLimit:98});
 const ctx={stage,identity:path.join(stage,'identity'),installation:path.join(stage,'installation'),build:input.build,runtime:input.runtime,report:input.report,budget,shared,receiptLimit:bound.receiptBytes-128*1024,deadline:now()+remaining};
 try{await unchangedRuntime(ctx);await worker(ctx,authority);}catch(error){ctx.report.state=ctx.report.state==='BLOCKING'?'BLOCKING':budget.unknown?'CLEANUP_UNVERIFIED':'INCONCLUSIVE';if(budget.unknown)ctx.report.cleanupState='UNVERIFIED';ctx.report.unresolved.push(String(error.code??error.message));await checkpoint(ctx);throw error;}
}

async function main(){
 // This selector is inert while the source hold is closed. It cannot bypass ACK,
 // reservation, reviewed source binding or actual inherited owner identity.
 if(process.env.GSA_MAC27_PREP_WORKER_STAGE!==undefined){demand(process.argv.length===2,'ARGUMENTS');return workerMain(process.env.GSA_MAC27_PREP_WORKER_STAGE,authority);}
 const mode=parseArguments(process.argv.slice(2));if(mode==='plan'){console.log(JSON.stringify(getPlan()));return;}
 return nativeMain(authority);
}
if(process.argv[1]&&path.resolve(process.argv[1])===script)main().catch(error=>{console.error(JSON.stringify({state:error.code==='NOT_READY'?'NOT_READY':'UNVERIFIED',code:error.code??'ERROR',message:error.message,activation:false}));process.exitCode=1;});
