#!/usr/bin/env node
// Finite, opt-in TreeReader evidence collection. Import/--plan is inert.
// This collects reader observations only; it does not install or activate a plugin.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {directoryManifestDigest,validateDirectoryCapture} from '../dist/src/core/directory-copy.js';
import {normalizedStrippedMacFileCode} from '../dist/src/hosts/macos-file-code.js';
import {requireMacDirectoryBuild,requireMacDirectoryEvidence} from '../dist/src/hosts/macos-directory-evidence.js';
import {reserveAttempt} from './mac-recovery-probe-control.mjs';

export const limits=Object.freeze({helperLaunches:24,signedBundles:2,observerInvocations:3,relocations:1,helperMs:20000,commandMs:60000,outputBytes:12_582_912,diagnosticBytes:65536,compilerBytes:268_435_456,receiptBytes:335_544_320});
export const protocol='gsa-directory-capture-response-v1';
export const expectedSourceSha256='b63fa083b40bc23e0863f401c8aff917b8b2e4ecf2d1739c0e9e5bd255ab352d';
export const signingProfile='gsa-directory-tree-readonly-single-root-v1';
const here=path.dirname(fileURLToPath(import.meta.url));
const source=path.resolve(here,'../native/macos-files/tree-broker.swift');
const observer=path.resolve(here,'../native/macos-files/test-tree-broker.py');
const script=fileURLToPath(import.meta.url);
const reservation=path.resolve(here,'../docs/reports/.mac-directory-native-v1.attempt.json');
// Scope guard for this driver, not an OS security boundary. Only the private CLI path receives this value.
const nativeRunAuthorization=Symbol('acknowledged-reader-cli');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=(code,message=code)=>Object.assign(Error(message),{code});

export function createInvocationBudget(){
 let helpers=0,bundles=0,observers=0,relocations=0;
 return Object.freeze({
  consume(kind){
   const state={helper:['helpers',limits.helperLaunches],bundle:['bundles',limits.signedBundles],observer:['observers',limits.observerInvocations],relocation:['relocations',limits.relocations]}[kind];
   if(!state)throw fail('NATIVE_SCOPE_INVALID');const [key,max]=state;
   if(({helpers,bundles,observers,relocations})[key]>=max)throw fail('NATIVE_BUDGET_EXHAUSTED',`${kind} budget exhausted`);
   if(kind==='helper')helpers++;else if(kind==='bundle')bundles++;else if(kind==='observer')observers++;else relocations++;
   return this.snapshot();
  },
  snapshot(){return Object.freeze({helperLaunches:helpers,signedBundles:bundles,observerInvocations:observers,relocations});}
 });
}
export function accountRelocationLaunch(budget,report){
 budget.consume('relocation');budget.consume('helper');report.counts=budget.snapshot();return report.counts;
}

export function parseTreeResponse(raw,request){
 const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
 if(bytes.length>limits.outputBytes)throw fail('NATIVE_RESPONSE_LIMIT');
 const text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes))throw fail('NATIVE_RESPONSE_UTF8');
 let value;try{value=JSON.parse(text);}catch{throw fail('NATIVE_RESPONSE_JSON');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw fail('NATIVE_RESPONSE_SHAPE');
 if(value.ok===false){if(!exact(value,['ok','error'])||typeof value.error!=='string'||!/^[A-Z_]{1,64}$/.test(value.error))throw fail('NATIVE_DENIAL_SHAPE');return Object.freeze({value,error:value.error});}
 if(!exact(value,['ok','format','binding','capture'])||value.ok!==true||value.format!==protocol)throw fail('NATIVE_SUCCESS_SHAPE');
 const expected={...request};delete expected.operation;
 if(JSON.stringify(Object.keys(value.binding??{}).sort())!==JSON.stringify(Object.keys(expected).sort())||Object.keys(expected).some(key=>value.binding[key]!==expected[key]))throw fail('NATIVE_BINDING_MISMATCH');
 const capture=validateDirectoryCapture(value.capture);
 return Object.freeze({value,capture});
}

export function classifyRelocationResponse(raw,request){
 let result;try{result=parseTreeResponse(raw,request);}catch(error){return Object.freeze({classification:'INCONCLUSIVE',reason:error.code??'INVALID_RESPONSE'});}
 if(result.error&&['PATH_OUTSIDE_SCOPE','PATH_OR_ACCESS_DENIED','ROOT_UNVERIFIED','CONCURRENT_CHANGE','UNSAFE_DIRECTORY'].includes(result.error))return Object.freeze({classification:'OBSERVED_DENIAL',error:result.error});
 if(result.capture?.files.some(file=>file.bytes.length>0))return Object.freeze({classification:'BLOCKING_OUTSIDE_CONTENT',bytes:result.capture.files.reduce((n,file)=>n+file.bytes.length,0)});
 return Object.freeze({classification:'INCONCLUSIVE',reason:result.error??'No denial or content observed'});
}

export async function runAcknowledged(argv,{platform=process.platform,arch=process.arch,reserve=async()=>{},run=async()=>{}}={}){
 if(!Array.isArray(argv)||argv.length!==2||argv[0]!=='--run-native'||argv[1]!=='--ack-disposable-directory-v1')throw fail('ACKNOWLEDGEMENT_REQUIRED');
 if(platform!=='darwin'||arch!=='arm64')throw fail('APPLE_SILICON_MAC_REQUIRED');
 await reserve();return run();
}

export function assertCaptureMatchesExpected(parsed,expectedEntries,expectedFiles){
 const capture=parsed?.capture;if(!capture)throw fail('EXPECTED_CAPTURE_MISSING');
 const entries=[...expectedEntries].sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
 if(!isDeepStrictEqual(capture.manifest.entries,entries))throw fail('EXPECTED_MANIFEST_MISMATCH');
 const total=expectedFiles.reduce((n,item)=>n+item.bytes.length,0);
 if(capture.manifest.total_bytes!==total||capture.manifest.sha256!==directoryManifestDigest(entries))throw fail('EXPECTED_MANIFEST_MISMATCH');
 const files=[...expectedFiles].sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
 if(capture.files.length!==files.length||files.some((item,index)=>capture.files[index]?.path!==item.path||!Buffer.from(capture.files[index].bytes).equals(Buffer.from(item.bytes))))throw fail('EXPECTED_PAYLOAD_MISMATCH');
 return true;
}
export function assertSyntheticRootCapture(parsed,role){
 const files=[{path:'nested/fixture.txt',bytes:Buffer.from(`synthetic tree content ${role}\n`)},{path:'nested/unicodé-ß.txt',bytes:Buffer.from('unicode fixture\n')}];
 const entries=[{path:'',kind:'directory'},{path:'empty',kind:'directory'},{path:'nested',kind:'directory'},...files.map(file=>({path:file.path,kind:'file',size:file.bytes.length,sha256:sha(file.bytes)}))];
 return assertCaptureMatchesExpected(parsed,entries,files);
}

export async function sendRequestAfterObserverReady(readyPromise,stdin,request,validate=()=>true){
 const ready=await readyPromise;
 if(!ready)throw fail('OBSERVER_READY_MISSING');
 if(!validate(ready))throw fail('OBSERVER_READY_MISMATCH');
 stdin.end(request);return ready;
}
export async function gateRelocationRequest(readyPromise,hitPromise,stdin,request,validate=()=>true){
 const hit=Promise.resolve(hitPromise);hit.catch(()=>{});
 const ready=await sendRequestAfterObserverReady(readyPromise,stdin,request,validate);
 return {ready,hit};
}

function timed(promise,ms,value){let timer;return Promise.race([promise,new Promise(resolve=>timer=setTimeout(()=>resolve(value),ms))]).finally(()=>clearTimeout(timer));}
export async function waitForChildClose(child,closed,{timeoutMs=limits.commandMs,abortPromise,termGraceMs=500,killGraceMs=1200}={}){
 const trigger=await timed(Promise.race([closed.then(value=>({closed:value})),...(abortPromise?[abortPromise.then(()=>({aborted:true}))]:[])]),timeoutMs,{timeout:true});
 if(trigger.closed)return {closed:true,...trigger.closed};
 const timedOut=!!trigger.timeout;
 try{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');}catch{}
 let result=await timed(closed,termGraceMs,undefined);if(result)return {closed:true,...result,timedOut};
 try{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}catch{}
 result=await timed(closed,killGraceMs,undefined);if(result)return {closed:true,...result,timedOut};
 detachUnverifiedChild(child);
 const error=fail('CLEANUP_UNVERIFIED','Owned process did not emit close after bounded TERM/KILL');error.pid=child.pid??null;error.signalRequested='SIGKILL';throw error;
}
export function captureBoundedStream(stream,max,onExceeded=()=>{}){
 const chunks=[];let total=0,exceeded=false;
 stream?.on('data',chunk=>{const bytes=Buffer.from(chunk),room=Math.max(0,max-total);if(room)chunks.push(bytes.subarray(0,room));total+=bytes.length;if(total>max&&!exceeded){exceeded=true;onExceeded();}});
 return {get bytes(){return Buffer.concat(chunks);},get observedBytes(){return total;},get truncated(){return exceeded;}};
}
export function detachUnverifiedChild(child){
 for(const stream of [child.stdin,child.stdout,child.stderr]){try{stream?.destroy?.();stream?.unref?.();}catch{}}
 try{child.unref?.();}catch{}
}

export async function appendReceipt(report,receipt){
 const prior=report.receiptTail??Promise.resolve();
 const task=prior.then(async()=>{
 const request=Buffer.from(receipt.request??[]),response=Buffer.from(receipt.response??[]),stderr=Buffer.from(receipt.stderr??[]),size=request.length+response.length+stderr.length;
 report.receiptBytes=(report.receiptBytes??0)+size;
 if(report.receiptBytes>limits.receiptBytes){report.unresolved??=[];report.unresolved.push('raw receipt budget exhausted; evidence incomplete');throw fail('RECEIPT_BUDGET_EXHAUSTED');}
 const {request:_request,response:_response,stderr:_stderr,...metadata}=receipt;
 report.receipts??=[];
 const index=String(report.receipts.length+1).padStart(4,'0'),receiptRoot=report.receiptRoot??(report.stage?path.join(report.stage,'receipts'):undefined),paths={};
 if(receiptRoot){await fs.mkdir(receiptRoot,{recursive:true,mode:0o700});const files={request,response,stderr};for(const [name,bytes] of Object.entries(files)){const file=path.join(receiptRoot,`${index}-${name}.bin`);await fs.writeFile(file,bytes,{mode:0o600,flag:'wx'});paths[name]=path.relative(report.stage??receiptRoot,file);}}
 else throw fail('RECEIPT_STORAGE_UNAVAILABLE');
 report.receipts.push({...metadata,files:paths,request_bytes:request.length,response_bytes:response.length,stderr_bytes:stderr.length,request_sha256:sha(request),response_sha256:sha(response),stderr_sha256:sha(stderr)});
 });
 report.receiptTail=task;await task;
}
export async function parseAndRecordTreeResponse(report,raw,request,receipt={}){
 await appendReceipt(report,{kind:'tree-helper',...receipt,request:Buffer.from(JSON.stringify(request)),response:Buffer.from(raw),stderr:receipt.stderr??Buffer.alloc(0)});
 return parseTreeResponse(raw,request);
}
export async function withOwnedDisposableCase(root,relative,setup,work){
 const owned=/^case-[a-z0-9-]+$/.test(relative)?path.join(root,relative):undefined;
 try{
  const location=await setup();
  if(location!==undefined&&location!==owned)throw fail('DISPOSABLE_CASE_PATH_MISMATCH');
  return await work(location);
 }finally{if(owned)await fs.rm(owned,{recursive:true,force:true});}
}
export function recordRelocationPhase(report,phase,value){
 if(!['stopConfirmed','parentRelocated','resumed','responseObserved'].includes(phase)||typeof value!=='number'||!Number.isFinite(value)||value<0)throw fail('RELOCATION_TIMELINE_INVALID');
 report.observations??={};report.observations.relocationTimeline??={};report.observations.relocationTimeline[phase]=value;return report.observations.relocationTimeline;
}

export function getPlan(){return Object.freeze({status:'READY_FOR_INDEPENDENT_DRIVER_REVIEW',nativeExecution:false,activation:false,source,expected_source_sha256:expectedSourceSha256,arguments:['-O','-Xlinker','-reproducible'],signingProfile,limits:{...limits},cases:['workspace/reference capture including nested/empty/Unicode','symlink/hardlink/FIFO/invalid-UTF8 denial','depth/entry/aggregate-byte at and above limits','stale revision','ungranted traversal','invalid operation','one release-artifact directory relocation observation'],attemptReservation:reservation,command:'node scripts/test-mac-directory-copy-native.mjs --run-native --ack-disposable-directory-v1'});}

async function runBounded(executable,args,input='',maximum=65536,timeoutMs=limits.commandMs,stdio=['pipe','pipe','pipe'],{report,kind='command',request:receiptRequest,envOverrides={}}={}){
 let failure,abortResolve;const abortPromise=new Promise(resolve=>abortResolve=resolve);
 const requestBytes=receiptRequest===undefined?Buffer.from(input):Buffer.from(receiptRequest);
 let child;try{child=spawn(executable,args,{shell:false,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp',...envOverrides},stdio});}catch(error){throw error;}
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 const abort=reason=>{if(failure)return;failure=fail(reason);abortResolve();try{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');}catch{}};
 const stdout=captureBoundedStream(child.stdout,maximum,()=>abort('COMMAND_OUTPUT_LIMIT')),stderr=captureBoundedStream(child.stderr,limits.diagnosticBytes,()=>abort('COMMAND_DIAGNOSTIC_LIMIT'));
 child.on('error',error=>{failure=error;abortResolve();});child.stdin?.on('error',()=>{});child.stdin?.end(input);
 let completion;try{completion=await waitForChildClose(child,closed,{timeoutMs,abortPromise});}catch(error){error.partial={stdout:stdout.bytes,stderr:stderr.bytes};if(report)await appendReceipt(report,{kind,pid:child.pid??null,request:requestBytes,response:stdout.bytes,stderr:stderr.bytes,closed:false,truncated:stdout.truncated||stderr.truncated});throw error;}
 const out=stdout.bytes,err=stderr.bytes;
 if(report)await appendReceipt(report,{kind,pid:child.pid??null,request:requestBytes,response:out,stderr:err,closed:true,partial:!!failure,truncated:stdout.truncated||stderr.truncated,observed_stdout_bytes:stdout.observedBytes,observed_stderr_bytes:stderr.observedBytes,exitCode:completion.code,signal:completion.signal});
 if(completion.timedOut&&!failure)failure=fail('COMMAND_TIMEOUT');
 if(failure){failure.partial={stdout:out,stderr:err};throw failure;}
 if(completion.code!==0)throw Object.assign(fail('COMMAND_FAILED',`${path.basename(executable)} exited ${completion.code??completion.signal}: ${err.toString('utf8').slice(0,512)}`),{partial:{stdout:out,stderr:err}});
 return out;
}

export function waitForChildSpawn(child,onError=()=>{},timeoutMs=limits.commandMs){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(fail('CHILD_SPAWN_TIMEOUT'));},timeoutMs);
  const cleanup=()=>{clearTimeout(timer);child.removeListener('spawn',onSpawn);child.removeListener('error',onFailure);};
  const onSpawn=()=>{cleanup();resolve();};
  const onFailure=error=>{cleanup();try{onError(error);}finally{reject(error);}};
  child.once('spawn',onSpawn);child.once('error',onFailure);
 });
}

export function startObserverWatch(args,budget,report,{spawnChild=spawn,timeoutMs=5500,termGraceMs=500,killGraceMs=1200}={}){
 budget.consume('observer');report.counts=budget.snapshot();
 const child=spawnChild('/usr/bin/python3',[observer,...args],{shell:false,env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'},stdio:['ignore','pipe','pipe']});
 let bytes=0,diagnostics=0,pending='',failure,readyResolve,readySeen=false,hitValue,hitSeen=false,abortResolve,queue=Promise.resolve();const ready=new Promise(resolve=>readyResolve=resolve),abortPromise=new Promise(resolve=>abortResolve=resolve);
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 const completion=waitForChildClose(child,closed,{timeoutMs,abortPromise,termGraceMs,killGraceMs}).then(async value=>{try{await queue;}catch(error){failure??=error;}if(value.timedOut&&!failure)failure=fail('OBSERVER_TIMEOUT');return value;}).catch(error=>{failure??=error;if(!readySeen)readyResolve(undefined);throw error;});completion.catch(()=>{});
 const hit=completion.then(({code,signal})=>{if(!readySeen)readyResolve(undefined);if(failure)throw failure;if(code!==0)throw fail('OBSERVER_EXIT',`observer exited ${code??signal}`);if(!hitSeen)throw fail('OBSERVER_RECEIPT_MISSING');return hitValue;});hit.catch(()=>{});
 const stop=reason=>{if(failure)return;failure=fail(reason);abortResolve();try{child.kill('SIGTERM');}catch{}};
 child.stdout.on('data',chunk=>{queue=queue.then(async()=>{await appendReceipt(report,{kind:'observer-watch-stdout',request:Buffer.from(JSON.stringify(args)),response:chunk,stderr:Buffer.alloc(0),pid:child.pid??null});bytes+=chunk.length;if(bytes>4096){stop('OBSERVER_OUTPUT_LIMIT');if(!readySeen)readyResolve(undefined);return;}pending+=chunk.toString('utf8');let newline;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);let value;try{value=JSON.parse(line);}catch{stop('OBSERVER_JSON');if(!readySeen)readyResolve(undefined);return;}if(value.event==='WATCH_READY'){readySeen=true;readyResolve(value);}else{hitSeen=true;hitValue=value;}}}).catch(error=>{failure=error;abortResolve();readyResolve(undefined);});});
 child.stderr.on('data',chunk=>{queue=queue.then(async()=>{await appendReceipt(report,{kind:'observer-watch-stderr',request:Buffer.from(JSON.stringify(args)),response:Buffer.alloc(0),stderr:chunk,pid:child.pid??null});diagnostics+=chunk.length;if(diagnostics>limits.diagnosticBytes){stop('OBSERVER_DIAGNOSTIC_LIMIT');if(!readySeen)readyResolve(undefined);}}).catch(error=>{failure=error;abortResolve();readyResolve(undefined);});});child.on('error',error=>{failure=error;abortResolve();readyResolve(undefined);});
 return {child,ready,hit,completion};
}

function xml(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');}
function plist(value){const rows=Object.entries(value).map(([key,item])=>`<key>${xml(key)}</key>${typeof item==='boolean'?`<${item?'true':'false'}/>`:typeof item==='number'?`<integer>${item}</integer>`:Array.isArray(item)?`<array>${item.map(x=>`<string>${xml(x)}</string>`).join('')}</array>`:`<string>${xml(item)}</string>`}`).join('');return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${rows}</dict></plist>\n`;}
function ident(stat){return {device:String(stat.dev),inode:String(stat.ino)};}
async function privateDirectory(directory){const info=await fs.lstat(directory);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid()||(info.mode&0o777)!==0o700||await fs.realpath(directory)!==directory)throw fail('FIXTURE_DIRECTORY_UNSAFE');}
async function privateFile(file,bytes,mode=0o600){await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,bytes,{mode,flag:'wx'});}
async function protectedRead(file,max){const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.uid!==process.getuid()||(before.mode&0o077)!==0||before.size>max)throw fail('FIXTURE_FILE_UNSAFE');const handle=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const opened=await handle.stat();if(opened.dev!==before.dev||opened.ino!==before.ino)throw fail('FIXTURE_FILE_CHANGED');const bytes=await handle.readFile();const after=await handle.stat();if(bytes.length!==before.size||after.ctimeMs!==before.ctimeMs||after.mtimeMs!==before.mtimeMs)throw fail('FIXTURE_FILE_CHANGED');return bytes;}finally{await handle.close();}}
async function boundedRegularRead(file,max){const real=await fs.realpath(file),info=await fs.lstat(real);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>max)throw fail('BUILD_INPUT_UNSAFE');const bytes=await fs.readFile(real);if(bytes.length!==info.size)throw fail('BUILD_INPUT_CHANGED');return bytes;}
async function fileRecord(file){const stat=await fs.lstat(file,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n)throw fail('CANARY_UNSAFE');return {...ident(stat),sha256:sha(await fs.readFile(file))};}
async function treeSnapshot(root){const rows=[];async function walk(dir,rel=''){for(const name of (await fs.readdir(dir)).sort()){const file=path.join(dir,name),relative=rel?`${rel}/${name}`:name,stat=await fs.lstat(file,{bigint:true});if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))throw fail('SOURCE_TREE_UNSAFE');if(stat.isDirectory()){rows.push({path:relative,kind:'directory',...ident(stat)});await walk(file,relative);}else rows.push({path:relative,kind:'file',...ident(stat),sha256:sha(await fs.readFile(file))});}}await walk(root);return rows;}
async function createFixtures(stage){
 const roots={workspace:path.join(stage,'roots/workspace'),reference:path.join(stage,'roots/reference')},destination=path.join(stage,'destination'),outside=path.join(stage,'outside');
 for(const dir of [path.dirname(roots.workspace),roots.workspace,roots.reference,destination,outside])await fs.mkdir(dir,{recursive:true,mode:0o700});
 for(const root of Object.values(roots)){
  await fs.mkdir(path.join(root,'empty'),{mode:0o700});await fs.mkdir(path.join(root,'nested'),{mode:0o700});
  await privateFile(path.join(root,'nested','fixture.txt'),Buffer.from(`synthetic tree content ${path.basename(root)}\n`));
  await privateFile(path.join(root,'nested','unicodé-ß.txt'),Buffer.from('unicode fixture\n'));
 }
 const canaries=[path.join(outside,'canary.txt'),path.join(destination,'canary.txt')];
 for(const file of canaries)await privateFile(file,Buffer.from(`disposable canary:${path.basename(path.dirname(file))}\n`));
 return {roots,destination,outside,canaries};
}

async function buildRelease(stage,budget,report,runCommand=runBounded){
 await privateDirectory(stage);const compiler=(await runCommand('/usr/bin/xcrun',['--find','swiftc'])).toString('utf8').trim();if(!path.isAbsolute(compiler))throw fail('COMPILER_PATH_INVALID');
 const sdkPath=(await runCommand('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'])).toString('utf8').trim(),sdkVersion=(await runCommand('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-version'])).toString('utf8').trim();if(!path.isAbsolute(sdkPath))throw fail('SDK_PATH_INVALID');
 const compilerVersion=(await runCommand(compiler,['--version'])).toString('utf8').trim(),sourceBytes=await boundedRegularRead(source,1024*1024);if(sha(sourceBytes)!==expectedSourceSha256)throw fail('TREE_SOURCE_PIN_MISMATCH');
 const sdk={path:sdkPath,version:sdkVersion,settings_sha256:sha(await boundedRegularRead(path.join(sdkPath,'SDKSettings.json'),16*1024*1024))};
 const binary=path.join(stage,'candidate-tree-broker'),arguments_=['-O','-Xlinker','-reproducible'],compilerEnvironment={HOME:path.join(stage,'compiler-home'),TMPDIR:path.join(stage,'compiler-tmp'),CLANG_MODULE_CACHE_PATH:path.join(stage,'compiler-cache/clang'),SWIFT_MODULECACHE_PATH:path.join(stage,'compiler-cache/swift')};
 for(const directory of [compilerEnvironment.HOME,compilerEnvironment.TMPDIR,compilerEnvironment.CLANG_MODULE_CACHE_PATH,compilerEnvironment.SWIFT_MODULECACHE_PATH]){await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.chmod(directory,0o700);await privateDirectory(directory);}
 report.compilerEnvironment=compilerEnvironment;
 await runCommand('/usr/bin/xcrun',['--sdk','macosx','swiftc','-sdk',sdkPath,...arguments_,source,'-o',binary],'',1024*1024,limits.commandMs,['pipe','pipe','pipe'],{envOverrides:compilerEnvironment});await fs.chmod(binary,0o500);
 const uuidText=(await runCommand('/usr/bin/dwarfdump',['--uuid',binary])).toString('utf8').trim(),match=/^UUID: ([A-F0-9-]{36}) \(arm64\) /.exec(uuidText);if(!match)throw fail('RELEASE_UUID_INVALID');
 const checkPath=path.join(stage,'.unsigned-code-check');await fs.copyFile(binary,checkPath,fs.constants.COPYFILE_EXCL);await fs.chmod(checkPath,0o700);await runCommand('/usr/bin/codesign',['--remove-signature',checkPath]);const code_sha256=sha(normalizedStrippedMacFileCode(await fs.readFile(checkPath)));await fs.unlink(checkPath);
 const build={uuid:match[1],driver:'xcrun-macosx-swiftc-v1',sdk,source_sha256:sha(sourceBytes),compiler_sha256:sha(await boundedRegularRead(compiler,limits.compilerBytes)),code_sha256,release_sha256:sha(await protectedRead(binary,16*1024*1024)),compiler_version:compilerVersion,arguments:arguments_,signing_profile:signingProfile,hostRelease:os.release(),arch:process.arch};
 requireMacDirectoryBuild(build);await privateFile(path.join(stage,'build.json'),Buffer.from(JSON.stringify(build,null,2)));return {binary,build,compiler};
}

async function signRootBundle(stage,rootInfo,release,budget,runCommand=runBounded){
 budget.consume('bundle');const bundleDir=path.join(stage,'bundles',rootInfo.id),app=path.join(bundleDir,'TreeReader.app'),contents=path.join(app,'Contents'),macos=path.join(contents,'MacOS');
 for(const dir of [path.dirname(bundleDir),bundleDir,app,contents,macos])await fs.mkdir(dir,{recursive:true,mode:0o700});
 const binary=path.join(macos,'tree-broker');await fs.copyFile(release.binary,binary,fs.constants.COPYFILE_EXCL);await fs.chmod(binary,0o500);
 const info={CFBundleExecutable:'tree-broker',CFBundleIdentifier:`local.gsa.directory.${rootInfo.id}`,CFBundleName:'TreeReader',CFBundlePackageType:'APPL',CFBundleVersion:'1',GSAWorkspaceID:rootInfo.id,GSAWorkspaceRole:rootInfo.role,GSAWorkspaceRoot:rootInfo.root,GSARevision:rootInfo.revision,GSADevice:rootInfo.rootIdentity.device,GSAInode:rootInfo.rootIdentity.inode};
 const infoFile=path.join(contents,'Info.plist');await privateFile(infoFile,Buffer.from(plist(info)));
 const entitlement={'com.apple.security.app-sandbox':true,'com.apple.security.temporary-exception.files.absolute-path.read-only':[rootInfo.root+'/']},entitlementFile=path.join(bundleDir,'entitlements.plist');await privateFile(entitlementFile,Buffer.from(plist(entitlement)));
 await runCommand('/usr/bin/codesign',['--force','--sign','-','--entitlements',entitlementFile,app]);await runCommand('/usr/bin/codesign',['--verify','--strict',app]);
 const signed=(await runCommand('/usr/bin/codesign',['--display','--entitlements',':-',app])).toString('utf8'),observed=JSON.parse((await runCommand('/usr/bin/plutil',['-convert','json','-o','-','-'],signed)).toString('utf8'));
 if(!isDeepStrictEqual(observed,entitlement))throw fail('SIGNED_ENTITLEMENTS_MISMATCH');
 const signatureDir=path.join(contents,'_CodeSignature');await fs.chmod(signatureDir,0o700);await fs.chmod(path.join(signatureDir,'CodeResources'),0o600);await runCommand('/usr/bin/codesign',['--verify','--strict',app]);
 const artifacts={};for(const name of ['Contents/MacOS/tree-broker','Contents/Info.plist','Contents/_CodeSignature/CodeResources'])artifacts[name]=sha(await protectedRead(path.join(app,name),16*1024*1024));
 return {binary,app,binding:{...rootInfo,artifacts,presign_sha256:release.build.release_sha256,code_sha256:release.build.code_sha256}};
}

function requestFor(binding,relative='.',operation='capture_tree',revision=binding.revision){return {operation,workspace_id:binding.id,role:binding.role,root:binding.root,device:binding.rootIdentity.device,inode:binding.rootIdentity.inode,revision,path:relative};}
function bindingEqual(response,request){const expected={...request};delete expected.operation;return response&&JSON.stringify(Object.keys(response).sort())===JSON.stringify(Object.keys(expected).sort())&&Object.keys(expected).every(key=>response[key]===expected[key]);}
function responseExpectation(parsed,kind,code){if(kind==='capture')return !parsed.error&&parsed.capture;if(kind==='deny')return parsed.error===code;return false;}

async function mainHelper(binary,request,ownerHandle,budget,report){
 budget.consume('helper');report.counts=budget.snapshot();const rawInput=Buffer.from(JSON.stringify(request));if(rawInput.length>65536)throw fail('REQUEST_LIMIT');
 const launched=Date.now();let child,failure,abortResolve;
 const abortPromise=new Promise(resolve=>abortResolve=resolve);
 try{child=spawn(binary,[],{shell:false,env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'},stdio:['pipe','pipe','pipe',ownerHandle.fd]});}catch(error){throw error;}
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 const stop=reason=>{if(failure)return;failure=fail(reason);abortResolve();try{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');}catch{}};
 const stdout=captureBoundedStream(child.stdout,limits.outputBytes,()=>stop('HELPER_OUTPUT_LIMIT')),stderr=captureBoundedStream(child.stderr,limits.diagnosticBytes,()=>stop('HELPER_DIAGNOSTIC_LIMIT'));
 child.on('error',error=>{failure=error;abortResolve();});child.stdin.on('error',()=>{});child.stdin.end(rawInput);
 let completion;try{completion=await waitForChildClose(child,closed,{timeoutMs:limits.helperMs,abortPromise});}
 catch(error){const out=stdout.bytes,err=stderr.bytes;await appendReceipt(report,{kind:'tree-helper',operation:request.operation,path:request.path,pid:child.pid??null,request:rawInput,response:out,stderr:err,closed:false,partial:true,truncated:stdout.truncated||stderr.truncated,observed_stdout_bytes:stdout.observedBytes,observed_stderr_bytes:stderr.observedBytes});report.native.push({operation:request.operation,path:request.path,pid:child.pid??null,closed:false,elapsed_ms:Date.now()-launched,request_sha256:sha(rawInput),response_sha256:sha(out),stderr_sha256:sha(err)});throw error;}
 const out=stdout.bytes,err=stderr.bytes;
 if(completion.timedOut&&!failure)failure=fail('HELPER_TIMEOUT');
 const nativeRecord={operation:request.operation,path:request.path,pid:child.pid??null,exitCode:completion.code,signal:completion.signal,closed:true,elapsed_ms:Date.now()-launched,request_sha256:sha(rawInput),response_sha256:sha(out),stderr_sha256:sha(err),truncated:stdout.truncated||stderr.truncated};report.native.push(nativeRecord);
 if(failure){await appendReceipt(report,{kind:'tree-helper',...nativeRecord,request:rawInput,response:out,stderr:err,closed:true,partial:true,observed_stdout_bytes:stdout.observedBytes,observed_stderr_bytes:stderr.observedBytes});throw failure;}
 if(completion.code!==0){await appendReceipt(report,{kind:'tree-helper',...nativeRecord,request:rawInput,response:out,stderr:err,closed:true,partial:true,observed_stdout_bytes:stdout.observedBytes,observed_stderr_bytes:stderr.observedBytes});throw fail('HELPER_EXIT',`helper exited ${completion.code??completion.signal}`);}
 const parsed=await parseAndRecordTreeResponse(report,out,request,{...nativeRecord,stderr:err,observed_stdout_bytes:stdout.observedBytes,observed_stderr_bytes:stderr.observedBytes});return {raw:out,parsed};
}

async function invoke(binary,binding,relative,ownerHandle,budget,report,{operation='capture_tree',revision=binding.revision,expectKind,expectCode}={}){
 const request=requestFor(binding,relative,operation,revision);const {raw,parsed}=await mainHelper(binary,request,ownerHandle,budget,report);
 if(expectKind&&!responseExpectation(parsed,expectKind,expectCode))throw fail('NATIVE_RESULT_UNEXPECTED',`${relative}: expected ${expectCode??expectKind}, got ${parsed.error??'success'}`);
 if(!parsed.error&&!bindingEqual(parsed.value.binding,request))throw fail('NATIVE_BINDING_MISMATCH');
 return {request,response:parsed.value,raw:raw.toString('utf8'),parsed};
}

async function temporaryTree(root,name,fn){const dir=path.join(root,name);await fs.mkdir(dir,{mode:0o700});try{return await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
async function createLimitCase(root,{depth=0,entries=0,bytes=0}={}){
 const area=path.join(root,`limit-${randomUUID()}`);await fs.mkdir(area,{mode:0o700});
 if(depth){let current=area;for(let i=1;i<=depth;i++){current=path.join(current,`d${i}`);await fs.mkdir(current,{mode:0o700});}}
 for(let i=0;i<entries;i++)await fs.mkdir(path.join(area,`entry-${String(i).padStart(4,'0')}`),{mode:0o700});
 if(bytes)await privateFile(path.join(area,'payload.bin'),Buffer.alloc(bytes,0x5a));
 return area;
}
function expectedLimitCapture({depth=0,entries=0,bytes=0}){
 const expectedEntries=[{path:'',kind:'directory'}],expectedFiles=[];
 if(depth){const parts=[];for(let i=1;i<=depth;i++){parts.push(`d${i}`);expectedEntries.push({path:parts.join('/'),kind:'directory'});}}
 for(let i=0;i<entries;i++)expectedEntries.push({path:`entry-${String(i).padStart(4,'0')}`,kind:'directory'});
 if(bytes){const payload=Buffer.alloc(bytes,0x5a);expectedFiles.push({path:'payload.bin',bytes:payload});expectedEntries.push({path:'payload.bin',kind:'file',size:payload.length,sha256:sha(payload)});}
 return {entries:expectedEntries,files:expectedFiles};
}

function sameRows(a,b){return JSON.stringify(a)===JSON.stringify(b);}
export async function prepareReaderRun(context,{inputs,writeInvalidName=fs.writeFile,onEvent=()=>{}}={}){
 const {stage,report}=context;
 context.fixture=await createFixtures(stage);context.roots=[];
 for(const [role,root] of Object.entries(context.fixture.roots)){const stat=await fs.stat(root,{bigint:true});context.roots.push({id:role,role,root,rootIdentity:ident(stat),revision:1});}
 context.sourceBefore=await Promise.all(context.roots.map(root=>treeSnapshot(root.root)));
 context.canariesBefore=await Promise.all(context.fixture.canaries.map(async file=>({path:file,...await fileRecord(file)})));
 report.sourceBefore=context.sourceBefore;report.canariesBefore=context.canariesBefore;
 await privateFile(path.join(stage,'baseline.json'),Buffer.from(JSON.stringify({sourceBefore:context.sourceBefore,canariesBefore:context.canariesBefore},null,2)));report.baseline='baseline.json';
 await onEvent('fixtures-created',context);
 const root=context.fixture.roots.workspace;
 // All filesystem-only probes precede compilation, signing, processes and reservation.
 // Probe names are owned only after exclusive mkdir, so collision never removes a prior entry.
 const probe=async(name,setup)=>{const dir=path.join(root,name);await fs.mkdir(dir,{mode:0o700});try{await setup(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}};
 await probe('case-invalid-utf8',async dir=>{const name=Buffer.concat([Buffer.from(path.join(dir,'invalid-')),Buffer.from([0xff])]);await writeInvalidName(name,Buffer.from('synthetic invalid UTF-8 filename'),{mode:0o600,flag:'wx'});});
 await probe('case-symlink',dir=>fs.symlink(context.fixture.canaries[0],path.join(dir,'link')));
 await probe('case-hardlink',async dir=>{await privateFile(path.join(dir,'a'),Buffer.from('hardlink fixture'));await fs.link(path.join(dir,'a'),path.join(dir,'b'));});
 for(const model of [{depth:16},{depth:17},{entries:1023},{entries:1024},{bytes:8*1024*1024},{bytes:8*1024*1024+1}]){let area;try{area=await createLimitCase(root,model);}finally{if(area)await fs.rm(area,{recursive:true,force:true});}}
 await probe('case-relocation',async dir=>{const held=path.join(dir,'held'),moved=path.join(dir,'moved');await fs.mkdir(held,{mode:0o700});await privateFile(path.join(held,'payload.bin'),Buffer.alloc(8*1024*1024,0x52));await fs.rename(held,moved);});
 if(inputs){
  const candidateBytes=await boundedRegularRead(inputs.candidate,16*1024*1024),buildBytes=await boundedRegularRead(inputs.build,1024*1024);
  if(sha(candidateBytes)!==inputs.candidateSha256||sha(buildBytes)!==inputs.buildSha256)throw fail('RETAINED_INPUT_HASH_MISMATCH');
  const build=JSON.parse(buildBytes.toString('utf8'));requireMacDirectoryBuild(build);
  if(build.release_sha256!==inputs.candidateSha256||build.source_sha256!==expectedSourceSha256)throw fail('RETAINED_BUILD_MISMATCH');
  const binary=path.join(stage,'candidate-tree-broker'),buildPath=path.join(stage,'build.json');
  await fs.copyFile(inputs.candidate,binary,fs.constants.COPYFILE_EXCL);await fs.copyFile(inputs.build,buildPath,fs.constants.COPYFILE_EXCL);
  if(sha(await boundedRegularRead(binary,16*1024*1024))!==inputs.candidateSha256||sha(await boundedRegularRead(buildPath,1024*1024))!==inputs.buildSha256)throw fail('RETAINED_INPUT_CHANGED');
  await fs.chmod(binary,0o500);await fs.chmod(buildPath,0o600);context.release={binary,build};
 }
 report.fixturePreflight='INCOMPLETE';report.readiness='NOT_READY';context.ready=false;
 await onEvent('preflight-prepared',context);return context;
}

export async function runReaderOrchestration(options={}){
 return runReaderPipeline(options);
}

async function runReaderPipeline(options={},authorization){
 const {stageRoot='/private/tmp',reserve=async()=>{},onEvent=()=>{}}=options;
 const sourceBytes=await boundedRegularRead(source,1024*1024);if(sha(sourceBytes)!==expectedSourceSha256)throw fail('TREE_SOURCE_PIN_MISMATCH');
 const stage=await fs.realpath(await fs.mkdtemp(path.join(stageRoot,'gsa-directory-native-')));await fs.chmod(stage,0o700);await privateDirectory(stage);
 const report={format:'gsa-directory-native-preparation-v1',state:'INCONCLUSIVE',activation:false,stage,source_sha256:sha(sourceBytes),started_at:new Date().toISOString(),limits:{...limits},counts:{helperLaunches:0,signedBundles:0,observerInvocations:0,relocations:0},cases:[],native:[],receipts:[],receiptBytes:0,unresolved:[],failures:[],fifoFixture:{state:'UNVERIFIED',reason:'Node has no filesystem-only FIFO creation API; no process is authorized during fixture preflight'},mountFixture:{state:'UNVERIFIED',reason:'No disposable mount/device fixture is configured'},readiness:'NOT_READY',fixturePreflight:'INCOMPLETE',observations:{relocationTimeline:{}}};
 const context={stage,report,budget:createInvocationBudget(),ready:false};context.recordPhase=(name,value)=>recordRelocationPhase(report,name,value);let phase='setup';
 try{
  await prepareReaderRun(context,options);
  if(options.phaseProducer){phase='synthetic-observations';report.observationOrigin='SYNTHETIC_TEST';report.unresolved.push('Synthetic relocation phases verify report persistence only');await options.phaseProducer(context.recordPhase,context);}
  else if(!context.ready){report.unresolved.push('Fixture preflight incomplete: FIFO and mount/device capability remain UNVERIFIED');}
  else{if(authorization!==nativeRunAuthorization)throw fail('ACKNOWLEDGEMENT_REQUIRED');phase='reservation';await reserve(context);phase='native';await runNative(context,options);}
 }
 catch(error){const code=error.code??error.message;report.failures.push({phase,error:code,message:error.message});report.unresolved.push(`${phase}: ${code}`);report.state=code==='BLOCKING_OUTSIDE_CONTENT'?'BLOCKING':'INCONCLUSIVE';if(phase==='setup')report.fixtureState='UNVERIFIED_PLATFORM_FIXTURE';if(code==='CLEANUP_UNVERIFIED')report.cleanupState='UNVERIFIED';}
 finally{
  const {fixture,roots,sourceBefore,canariesBefore}=context;
  if(sourceBefore&&canariesBefore){
   if(report.cleanupState==='UNVERIFIED'){report.sourceAfterState='UNVERIFIED';report.canariesAfterState='UNVERIFIED';report.unresolved.push('source/canary after-state unavailable because process cleanup is uncertain');}
   else try{report.sourceAfter=await Promise.all(roots.map(root=>treeSnapshot(root.root)));report.canariesAfter=await Promise.all(fixture.canaries.map(async file=>({path:file,...await fileRecord(file)})));report.sourceAfterState='OBSERVED';report.canariesAfterState='OBSERVED';if(!sameRows(sourceBefore,report.sourceAfter)&&!report.unresolved.includes('fixture source tree changed'))report.unresolved.push('fixture source tree changed');if(!sameRows(canariesBefore,report.canariesAfter)&&!report.unresolved.includes('outside canary changed'))report.unresolved.push('outside canary changed');}
   catch(error){report.sourceAfterState='UNVERIFIED';report.canariesAfterState='UNVERIFIED';report.unresolved.push(`source/canary after-state unavailable: ${error.code??error.message}`);}
  }
  if(context.ownerHandle)await context.ownerHandle.close().catch(()=>{});
  report.counts=context.budget.snapshot();report.completed_at=new Date().toISOString();
  await privateFile(path.join(stage,'result.json'),Buffer.from(JSON.stringify(report,null,2)));
  await onEvent('report-persisted',context);
 }
 return report;
}

async function runNative(context,options={}){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw fail('APPLE_SILICON_MAC_REQUIRED');
 const {stage,report,fixture,roots,budget,sourceBefore,canariesBefore}=context;let sourceAfter,canariesAfter;
 const command=options.effects?.command??runBounded;
 const ownerHandle=context.ownerHandle=await fs.open(path.join(stage,'fixture-owner.lock'),fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR,0o600);
  const release=context.release??await buildRelease(stage,budget,report,command);report.build=release.build;if(release.compiler)report.compilerPath=await fs.realpath(release.compiler);
  const signed=[];for(const root of roots){signed.push(await signRootBundle(stage,root,release,budget,command));report.counts.signedBundles=budget.snapshot().signedBundles;}
  const byRole=Object.fromEntries(signed.map(item=>[item.binding.role,item]));
  const observations=report.observations;report.relocationTimeline=observations.relocationTimeline;
  const recordCase=async(name,work)=>{try{const value=await work();report.cases.push({name,state:'OBSERVED',...value});return value;}catch(error){const code=error.code??error.message,state=code==='BLOCKING_OUTSIDE_CONTENT'?'BLOCKING':'INCONCLUSIVE';report.cases.push({name,state,error:code});report.failures.push({name,error:code});report.unresolved.push(`${name}: ${code}`);if(state==='BLOCKING')report.state='BLOCKING';if(state==='BLOCKING'||code==='CLEANUP_UNVERIFIED'||code==='RECEIPT_BUDGET_EXHAUSTED')throw error;return undefined;}finally{report.counts=budget.snapshot();}};
  const positive=async(role)=>recordCase(`${role}Capture`,async()=>{const result=await invoke(byRole[role].binary,byRole[role].binding,'.',ownerHandle,budget,report,{expectKind:'capture'});assertSyntheticRootCapture(result.parsed,role);observations[`${role}Capture`]={request:result.request,response:result.response};return {manifest_sha256:result.parsed.capture.manifest.sha256,entries:result.parsed.capture.manifest.entries.length,total_bytes:result.parsed.capture.manifest.total_bytes};});
  await positive('workspace');await positive('reference');
  const workspace=byRole.workspace;
  async function deny(name,relative,setup,code,operation='capture_tree',revision=workspace.binding.revision){return recordCase(name,async()=>withOwnedDisposableCase(workspace.binding.root,relative,setup,async()=>{const result=await invoke(workspace.binary,workspace.binding,relative,ownerHandle,budget,report,{operation,revision,expectKind:'deny',expectCode:code});observations[name]={request:result.request,response:result.response};return {code:result.parsed.error};}));}
  await deny('unsafeSymlink','case-symlink',async()=>{const dir=path.join(workspace.binding.root,'case-symlink');await fs.mkdir(dir,{mode:0o700});await fs.symlink(path.join(fixture.outside,'canary.txt'),path.join(dir,'link'));return dir;},'UNSAFE_FILE_TYPE');
  await deny('unsafeHardlink','case-hardlink',async()=>{const dir=path.join(workspace.binding.root,'case-hardlink');await fs.mkdir(dir,{mode:0o700});await fs.writeFile(path.join(dir,'a'),Buffer.from('hardlink fixture'),{mode:0o600,flag:'wx'});await fs.link(path.join(dir,'a'),path.join(dir,'b'));return dir;},'UNSAFE_FILE_TYPE');
  await deny('unsafeSpecial','case-fifo',async()=>{const dir=path.join(workspace.binding.root,'case-fifo');await fs.mkdir(dir,{mode:0o700});await runBounded('/usr/bin/mkfifo',[path.join(dir,'pipe')]);return dir;},'UNSAFE_FILE_TYPE');
  await deny('invalidUtf8Name','case-invalid-utf8',async()=>{const dir=path.join(workspace.binding.root,'case-invalid-utf8');await fs.mkdir(dir,{mode:0o700});const raw=Buffer.from(path.join(dir,'invalid-'), 'utf8'),name=Buffer.concat([raw,Buffer.from([0xff])]);await fs.writeFile(name,Buffer.from('synthetic invalid UTF-8 filename'),{mode:0o600,flag:'wx'});return dir;},'UNSUPPORTED_NAME');
  await deny('staleBinding','.',async()=>undefined,'GRANT_BINDING_MISMATCH','capture_tree',workspace.binding.revision+1);
  await deny('ungrantedPath','../outside/canary.txt',async()=>undefined,'PATH_OUTSIDE_SCOPE');
  await deny('invalidWriteRequest','.',async()=>undefined,'INVALID_REQUEST','create');
  const limitCases=[];
  for(const [name,n,expected] of [['depthAt',16,true],['depthPlusOne',17,false]]){const model={depth:n},area=await createLimitCase(workspace.binding.root,model),target=path.basename(area);await recordCase(name,async()=>{try{const result=await invoke(workspace.binary,workspace.binding,target,ownerHandle,budget,report,expected?{expectKind:'capture'}:{expectKind:'deny',expectCode:'DEPTH_LIMIT_EXCEEDED'});if(expected){const wanted=expectedLimitCapture(model);assertCaptureMatchesExpected(result.parsed,wanted.entries,wanted.files);}limitCases.push({name,request:result.request,response:result.response,state:'OBSERVED'});return {state:'OBSERVED',depth:n};}finally{await fs.rm(area,{recursive:true,force:true});}});}
  for(const [name,n,expected] of [['entriesAt',1023,true],['entriesPlusOne',1024,false]]){const model={entries:n},area=await createLimitCase(workspace.binding.root,model),target=path.basename(area);await recordCase(name,async()=>{try{const result=await invoke(workspace.binary,workspace.binding,target,ownerHandle,budget,report,expected?{expectKind:'capture'}:{expectKind:'deny',expectCode:'ENTRY_LIMIT_EXCEEDED'});if(expected){const wanted=expectedLimitCapture(model);assertCaptureMatchesExpected(result.parsed,wanted.entries,wanted.files);}limitCases.push({name,request:result.request,response:result.response,state:'OBSERVED'});return {state:'OBSERVED',children:n};}finally{await fs.rm(area,{recursive:true,force:true});}});}
  for(const [name,n,expected] of [['bytesAt',8*1024*1024,true],['bytesPlusOne',8*1024*1024+1,false]]){const model={bytes:n},area=await createLimitCase(workspace.binding.root,model),target=path.basename(area);await recordCase(name,async()=>{try{const result=await invoke(workspace.binary,workspace.binding,target,ownerHandle,budget,report,expected?{expectKind:'capture'}:{expectKind:'deny',expectCode:'BYTE_LIMIT_EXCEEDED'});if(expected){const wanted=expectedLimitCapture(model);assertCaptureMatchesExpected(result.parsed,wanted.entries,wanted.files);}limitCases.push({name,request:result.request,response:result.response,state:'OBSERVED'});return {state:'OBSERVED',bytes:n};}finally{await fs.rm(area,{recursive:true,force:true});}});}
  if(limitCases.find(item=>item.name==='bytesPlusOne'))observations.overLimit={request:limitCases.find(item=>item.name==='bytesPlusOne').request,response:limitCases.find(item=>item.name==='bytesPlusOne').response};
  let relocation;
  await recordCase('relocation',async()=>{
   accountRelocationLaunch(budget,report);const held=path.join(workspace.binding.root,'relocation','held');await fs.mkdir(held,{recursive:true,mode:0o700});await privateFile(path.join(held,'payload.bin'),Buffer.alloc(8*1024*1024,0x52));
   const targetStat=await fs.stat(held,{bigint:true}),targetIdentity=ident(targetStat),request=requestFor(workspace.binding,'relocation/held');const rawInput=Buffer.from(JSON.stringify(request));
   let child,failure,closed,watch,watchAttempted=false,watchProof,identityProof,requestSent=false,abortResolve,receiptRecorded=false;
   const abortPromise=new Promise(resolve=>abortResolve=resolve);
   const observerCall=async args=>{budget.consume('observer');report.counts=budget.snapshot();return runBounded('/usr/bin/python3',[observer,...args],'',4096,5000,['pipe','pipe','pipe'],{report,kind:`observer-${args[0]}`,request:Buffer.from(JSON.stringify(args))});};
   const sameOwned=value=>value&&identityProof&&value.pid===identityProof.pid&&value.parentPid===process.pid&&value.startTime===identityProof.startTime&&value.executable===identityProof.executable&&value.executable===awaitRealExecutable;
   let awaitRealExecutable;
   try{awaitRealExecutable=await fs.realpath(workspace.binary);child=spawn(workspace.binary,[],{shell:false,env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'},stdio:['pipe','pipe','pipe',ownerHandle.fd]});}catch(error){throw error;}
   closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
   const stop=reason=>{if(failure)return;failure=fail(reason);abortResolve();try{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');}catch{}};
   const stdout=captureBoundedStream(child.stdout,limits.outputBytes,()=>stop('HELPER_OUTPUT_LIMIT')),stderr=captureBoundedStream(child.stderr,limits.diagnosticBytes,()=>stop('HELPER_DIAGNOSTIC_LIMIT'));
   child.stdin?.on('error',()=>{});
   try{
    try{await waitForChildSpawn(child,error=>{failure=error;abortResolve();});}catch(error){if(error.code==='CHILD_SPAWN_TIMEOUT'){failure=error;abortResolve();}throw error;}
    identityProof=JSON.parse((await observerCall(['identity',String(child.pid),String(process.pid),workspace.binary])).toString('utf8'));
    report.relocationIdentity=identityProof;
    if(!sameOwned(identityProof))throw fail('HELPER_PROCESS_IDENTITY_MISMATCH');
    watchAttempted=true;watch=startObserverWatch(['watch',String(child.pid),String(process.pid),workspace.binary,identityProof.startTime,targetIdentity.device,targetIdentity.inode,'-'],budget,report);
    const gated=await gateRelocationRequest(watch.ready,watch.hit,child.stdin,rawInput,value=>value.pid===child.pid&&value.parentPid===process.pid&&value.startTime===identityProof.startTime&&value.device===targetIdentity.device&&value.inode===targetIdentity.inode);requestSent=true;report.relocationObserverReady=gated.ready;
    const watched=await gated.hit;
    if(watched.pid!==identityProof.pid||watched.startTime!==identityProof.startTime||watched.parentPid!==process.pid||watched.executable!==awaitRealExecutable||watched.device!==targetIdentity.device||watched.inode!==targetIdentity.inode||watched.signal!=='SIGSTOP'||!watched.state.startsWith('T'))throw fail('RELOCATION_STOP_UNCONFIRMED');
    watchProof=watched;report.relocationStop=watched;
    const stopAt=Number(process.hrtime.bigint())/1e6;context.recordPhase('stopConfirmed',stopAt);const relocatedPath=path.join(fixture.outside,'relocated-held');await fs.rename(held,relocatedPath);const moveAt=Number(process.hrtime.bigint())/1e6;context.recordPhase('parentRelocated',moveAt);const moved=await fs.stat(relocatedPath,{bigint:true}),relocatedIdentity=ident(moved);
    const confirmed=JSON.parse((await observerCall(['confirm',String(child.pid),String(process.pid),workspace.binary,identityProof.startTime,targetIdentity.device,targetIdentity.inode,String(watched.fd)])).toString('utf8'));report.relocationStopConfirmation=confirmed;
    if(confirmed.pid!==watched.pid||confirmed.startTime!==watched.startTime||confirmed.parentPid!==process.pid||confirmed.executable!==awaitRealExecutable||confirmed.fd!==watched.fd||confirmed.device!==targetIdentity.device||confirmed.inode!==targetIdentity.inode||!confirmed.state.startsWith('T')||!isDeepStrictEqual(relocatedIdentity,targetIdentity))throw fail('RELOCATION_FD_CONFIRMATION_FAILED');
    if(!child.kill('SIGCONT'))throw fail('OWNED_RESUME_FAILED');const resumedAt=Number(process.hrtime.bigint())/1e6;context.recordPhase('resumed',resumedAt);const result=await waitForChildClose(child,closed,{timeoutMs:limits.helperMs,abortPromise});if(result.timedOut&&!failure)failure=fail('HELPER_TIMEOUT');if(failure)throw failure;if(result.code!==0)throw fail('HELPER_EXIT');
    const out=stdout.bytes,err=stderr.bytes,rawReceipt={kind:'tree-relocation',operation:request.operation,path:request.path,pid:child.pid,request_sent:requestSent,closed:true,exitCode:result.code,signal:result.signal,request:rawInput,response:out,stderr:err,truncated:stdout.truncated||stderr.truncated,observed_stdout_bytes:stdout.observedBytes,observed_stderr_bytes:stderr.observedBytes};await appendReceipt(report,rawReceipt);receiptRecorded=true;report.native.push({operation:request.operation,path:request.path,pid:child.pid,exitCode:result.code,signal:result.signal,closed:true,request_sent:requestSent,request_sha256:sha(rawInput),response_sha256:sha(out),stderr_sha256:sha(err)});
    const after=Number(process.hrtime.bigint())/1e6;context.recordPhase('responseObserved',after);const parsed=parseTreeResponse(out,request),classification=classifyRelocationResponse(out,request);
    relocation={request,pid:child.pid,fd:watched.fd,parentIdentity:targetIdentity,relocatedIdentity,parentPath:held,relocatedPath,stopConfirmation:{pid:watched.pid,signal:'SIGSTOP',state:watched.state,fd:watched.fd,parentIdentity:targetIdentity},timeline:{stopConfirmed:stopAt,parentRelocated:moveAt,resumed:resumedAt,responseObserved:after},response:parsed.value,outside_content_returned:classification.classification==='BLOCKING_OUTSIDE_CONTENT'};
    observations.relocation=relocation;report.relocation_classification=classification;
    await fs.rmdir(path.dirname(held)).catch(()=>{});
    if(classification.classification!=='OBSERVED_DENIAL')throw fail(classification.classification==='BLOCKING_OUTSIDE_CONTENT'?'BLOCKING_OUTSIDE_CONTENT':'RELOCATION_UNVERIFIED');
    return {classification:classification.classification,fd:watched.fd,relocatedPath};
 }catch(error){
    if(child){
     if(!requestSent)child.stdin.destroy();
     if(!receiptRecorded){const out=stdout.bytes,err=stderr.bytes;await appendReceipt(report,{kind:'tree-relocation',operation:request.operation,path:request.path,pid:child.pid??null,request_sent:requestSent,closed:child.exitCode!==null||child.signalCode!==null,partial:true,request:rawInput,response:out,stderr:err,truncated:stdout.truncated||stderr.truncated,observed_stdout_bytes:stdout.observedBytes,observed_stderr_bytes:stderr.observedBytes});receiptRecorded=true;report.native.push({operation:request.operation,path:request.path,pid:child.pid??null,request_sent:requestSent,closed:child.exitCode!==null||child.signalCode!==null,request_sha256:sha(rawInput),response_sha256:sha(out),stderr_sha256:sha(err)});}
    }
    throw error;
   }finally{
    let cleanupFailure;
    if(watch?.child&&watch.child.exitCode===null&&watch.child.signalCode===null){try{watch.child.kill('SIGTERM');await watch.completion;}catch(error){report.unresolved.push(`observer cleanup: ${error.code??error.message}`);if(error.code==='CLEANUP_UNVERIFIED'){report.cleanupState='UNVERIFIED';cleanupFailure=error;}}}
    let safeToSignal=false;
    if(child&&child.exitCode===null&&child.signalCode===null&&watchAttempted){
     if(budget.snapshot().observerInvocations<limits.observerInvocations){
      try{const current=JSON.parse((await observerCall(['identity',String(child.pid),String(process.pid),workspace.binary])).toString('utf8'));if(sameOwned(current)){safeToSignal=true;if(current.status===4)child.kill('SIGCONT');}}
      catch{report.unresolved.push('observer cleanup identity could not be confirmed');}
     }else if(watchProof&&watchProof.pid===child.pid&&watchProof.parentPid===process.pid&&watchProof.startTime===identityProof?.startTime&&watchProof.executable===awaitRealExecutable){safeToSignal=true;child.kill('SIGCONT');}
     if(!safeToSignal){report.unresolved.push('observer cleanup identity remains uncertain');report.cleanupState='UNVERIFIED';cleanupFailure??=fail('CLEANUP_UNVERIFIED','Owned helper identity could not be reconfirmed');}
    }
    if(child&&child.exitCode===null&&child.signalCode===null){
     if(!requestSent)child.stdin.destroy();
     if(safeToSignal){try{await waitForChildClose(child,closed,{timeoutMs:1000,abortPromise:Promise.resolve()});}catch(error){report.unresolved.push('owned helper cleanup remains unverified');report.cleanupState='UNVERIFIED';cleanupFailure??=error;}}
     else{const observed=await timed(closed,1000,undefined);if(!observed){report.unresolved.push('owned helper identity/exit remains unverified');report.cleanupState='UNVERIFIED';cleanupFailure??=fail('CLEANUP_UNVERIFIED','Helper exit could not be verified; no further signal sent');detachUnverifiedChild(child);}}
    }
    if(cleanupFailure)throw cleanupFailure;
   }
  });
  report.counts=budget.snapshot();
  sourceAfter=await Promise.all(roots.map(root=>treeSnapshot(root.root)));canariesAfter=await Promise.all(fixture.canaries.map(async file=>({path:file,...await fileRecord(file)})));
  report.sourceAfter=sourceAfter;report.canariesAfter=canariesAfter;report.sourceAfterState='OBSERVED';report.canariesAfterState='OBSERVED';
  if(!sameRows(sourceBefore,sourceAfter))report.unresolved.push('fixture source tree changed');
  if(canariesBefore.some((item,index)=>item.sha256!==canariesAfter[index]?.sha256||item.device!==canariesAfter[index]?.device||item.inode!==canariesAfter[index]?.inode))report.unresolved.push('outside canary changed');
  if(observations.workspaceCapture&&observations.referenceCapture&&observations.unsafeSymlink&&observations.unsafeHardlink&&observations.unsafeSpecial&&observations.overLimit&&observations.staleBinding&&observations.ungrantedPath&&observations.invalidWriteRequest&&observations.relocation&&report.unresolved.length===0){
   const stageIdentity=ident(await fs.stat(stage,{bigint:true})),evidenceObservations=Object.fromEntries(['workspaceCapture','referenceCapture','unsafeSymlink','unsafeHardlink','unsafeSpecial','overLimit','staleBinding','ungrantedPath','invalidWriteRequest','relocation'].map(name=>[name,observations[name]])),evidence={format:'gsa-directory-tree-native-evidence-v1',build:release.build,fixture:{stage,stageIdentity,hostRelease:release.build.hostRelease,arch:release.build.arch,owner_fd:3,roots:signed.map(item=>item.binding),outsideCanaries:canariesBefore.map((item,index)=>({path:item.path,before_sha256:item.sha256,after_sha256:canariesAfter[index].sha256}))},observations:evidenceObservations,unresolved:[]};
   requireMacDirectoryEvidence(evidence,release.build);await privateFile(path.join(stage,'native-evidence.json'),Buffer.from(JSON.stringify(evidence,null,2)));report.evidence='native-evidence.json';report.state='TREE_NATIVE_CAPTURE_SUITE_OBSERVED';
  }else if(!report.unresolved.length)report.unresolved.push('native evidence is incomplete');
  report.counts=budget.snapshot();report.completed_at=new Date().toISOString();
 return report;
}

async function main(){const argv=process.argv.slice(2);if(argv.length===0||argv.length===1&&argv[0]==='--plan'){console.log(JSON.stringify(getPlan()));return;}const report=await runAcknowledged(argv,{run:()=>runReaderPipeline({reserve:async()=>reserveAttempt(reservation,{format:'gsa-directory-native-once-v1',source_sha256:sha(await boundedRegularRead(source,1024*1024)),driver_sha256:sha(await boundedRegularRead(script,1024*1024)),observer_sha256:sha(await boundedRegularRead(observer,1024*1024)),limits,at:new Date().toISOString(),activation:false})},nativeRunAuthorization)});console.log(JSON.stringify({state:report.state,stage:report.stage,counts:report.counts,activation:false,unresolved:report.unresolved.length,receipts:report.receipts?.length??0}));if(report?.state!=='TREE_NATIVE_CAPTURE_SUITE_OBSERVED')process.exitCode=report?.state==='BLOCKING'?2:1;}
if(process.argv[1]&&path.resolve(process.argv[1])===script)main().catch(error=>{console.error(error.code??error.message);process.exitCode=1;});
