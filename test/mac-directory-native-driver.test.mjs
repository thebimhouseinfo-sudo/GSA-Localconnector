import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {directoryManifestDigest,validateDirectoryCapture} from '../dist/src/core/directory-copy.js';
import * as readerDriver from '../scripts/test-mac-directory-copy-native.mjs';
const {accountRelocationLaunch,assertCaptureMatchesExpected,assertSyntheticRootCapture,captureBoundedStream,classifyRelocationResponse,createInvocationBudget,gateRelocationRequest,limits,parseAndRecordTreeResponse,parseTreeResponse,recordRelocationPhase,runAcknowledged,sendRequestAfterObserverReady,startObserverWatch,waitForChildClose,waitForChildSpawn,withOwnedDisposableCase}=readerDriver;

const sha=value=>createHash('sha256').update(value).digest('hex');
function assertNoRunEffects(report){
 assert.ok(report?.counts,'reader report must include invocation counts');
 for(const [name,count] of Object.entries(report.counts)){assert.equal(Number.isSafeInteger(count),true,`${name} count must be known`);assert.equal(count,0,`${name} count must remain zero`);}
 assert.deepEqual(report.native,[]);assert.deepEqual(report.receipts,[]);
}
function success(request){
 const bytes=Buffer.from('synthetic payload');
 const entries=[{path:'',kind:'directory'},{path:'empty',kind:'directory'},{path:'nested',kind:'directory'},{path:'nested/file.txt',kind:'file',size:bytes.length,sha256:sha(bytes)}];
 const binding={...request};delete binding.operation;
 return {ok:true,format:'gsa-directory-capture-response-v1',binding,capture:{manifest:{format:'gsa-directory-manifest-v1',entries,total_bytes:bytes.length,sha256:directoryManifestDigest(entries)},files:[{path:'nested/file.txt',base64:bytes.toString('base64')}],observations:entries.map((entry,index)=>({path:entry.path,kind:entry.kind,device:'1',inode:String(index+10),size:entry.kind==='file'?entry.size:0,mtime_ns:'1',ctime_ns:'2'}))}};
}
async function syntheticInvalidNameWriter(name,bytes,options){
 const buffer=Buffer.from(name),slash=buffer.lastIndexOf(0x2f),directory=buffer.subarray(0,slash);
 await fs.writeFile(path.join(directory.toString(),'synthetic-invalid-name'),bytes,options);
}
const request={operation:'capture_tree',workspace_id:'work',role:'workspace',root:'/private/stage/workspace',device:'1',inode:'10',revision:1,path:'parent'};

test('actual reader orchestration exposes a preflight seam before native effects',()=>{
 assert.equal(typeof readerDriver.runReaderOrchestration,'function',
  'the existing CLI path must expose its preparation/report orchestration for injected preflight tests');
});

test('public reader orchestration rejects caller-supplied authorization and mutable readiness',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reader-public-proxy-')),effects={reserve:0,command:0},fakeCapability=Symbol('untrusted native authorization');let report,passed=false;
 try{
  const options=new Proxy({stageRoot:root,writeInvalidName:syntheticInvalidNameWriter,
   nativeRunAuthorization:true,acknowledgement:'--ack-disposable-directory-v1',extraArgs:['--run-native'],
   onEvent:async(name,context)=>{if(name==='preflight-prepared')context.ready=true;},
   reserve:async()=>{effects.reserve++;throw Object.assign(Error('unexpected reservation'),{code:'TEST_RESERVE_REACHED'});},
   effects:{command:async()=>{effects.command++;throw Object.assign(Error('unexpected command'),{code:'TEST_COMMAND_REACHED'});}}
  },{get(target,key,receiver){if(typeof key==='symbol')return true;return Reflect.get(target,key,receiver);}});
  report=await readerDriver.runReaderOrchestration(options,fakeCapability);
  const persisted=JSON.parse(await fs.readFile(path.join(report.stage,'result.json'),'utf8'));
  assert.equal(persisted.failures.at(-1).error,'ACKNOWLEDGEMENT_REQUIRED');
  assert.equal(persisted.failures.at(-1).phase,'setup');assert.equal(persisted.state,'INCONCLUSIVE');
  assert.equal(persisted.fixturePreflight,'INCOMPLETE');assert.equal(persisted.readiness,'NOT_READY');
  assert.deepEqual(effects,{reserve:0,command:0});
  assertNoRunEffects(persisted);
  assert.equal(persisted.evidence,undefined);
  passed=true;
 }finally{if(passed)await fs.rm(root,{recursive:true,force:true});else console.error(`Preserved reader test stage: ${report?.stage??root}`);}
});

test('fresh import and --plan remain inert and preserve the original acknowledgement route',()=>{
 const driverPath=fileURLToPath(new URL('../scripts/test-mac-directory-copy-native.mjs',import.meta.url)),plan=readerDriver.getPlan(),reservation=plan.attemptReservation;
 const fingerprint=()=>{try{const stat=fsSync.lstatSync(reservation,{bigint:true});return {dev:String(stat.dev),ino:String(stat.ino),mode:stat.mode.toString(),size:String(stat.size),mtimeNs:String(stat.mtimeNs)};}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 const before=fingerprint(),imported=spawnSync(process.execPath,['--input-type=module','-e',`import ${JSON.stringify(pathToFileURL(driverPath).href)}`],{encoding:'utf8',timeout:5000});
 assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout,'');assert.equal(imported.stderr,'');assert.deepEqual(fingerprint(),before);
 const planned=spawnSync(process.execPath,[driverPath,'--plan'],{encoding:'utf8',timeout:5000});
 assert.equal(planned.status,0,planned.stderr);assert.equal(planned.stderr,'');const value=JSON.parse(planned.stdout);
 assert.equal(value.activation,false);assert.deepEqual(value.arguments,['-O','-Xlinker','-reproducible']);
 assert.equal(value.command,'node scripts/test-mac-directory-copy-native.mjs --run-native --ack-disposable-directory-v1');
 assert.deepEqual(fingerprint(),before);
});

test('reader orchestration persists EILSEQ preflight failure before every effect and cleans only its owned case',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reader-orchestration-')),outside=path.join(root,'outside'),source=path.join(outside,'source.bin'),canary=path.join(outside,'canary.bin');
 await fs.mkdir(outside);await fs.writeFile(source,Buffer.from('preexisting source bytes'));await fs.writeFile(canary,Buffer.from('preexisting canary bytes'));
 const before=await Promise.all([source,canary].map(async file=>({bytes:await fs.readFile(file),stat:await fs.lstat(file,{bigint:true})})));
  const events=[],effects={reserve:0,command:0};let ownedCase,report,passed=false;
 try{
  report=await readerDriver.runReaderOrchestration({stageRoot:root,
   onEvent:async(name,context)=>{events.push(name);if(name==='fixtures-created'){
    const dir=path.join(context.fixture.roots.workspace,'case-invalid-utf8');await fs.access(dir).then(()=>assert.fail('invalid-name case directory exists before its owned mkdir')) .catch(error=>{if(error.code!=='ENOENT')throw error;});
   }},
   writeInvalidName:async(name,bytes,options)=>{events.push('invalid-name-write');ownedCase=Buffer.from(name).subarray(0,Buffer.from(name).lastIndexOf(0x2f)).toString();
    await fs.access(ownedCase);const error=Object.assign(Error('injected filesystem EILSEQ at invalid-name creation'),{code:'EILSEQ'});throw error;},
   reserve:async()=>{effects.reserve++;throw Object.assign(Error('unexpected reservation'),{code:'TEST_RESERVE_REACHED'});},effects:{command:async()=>{effects.command++;throw Object.assign(Error('unexpected command'),{code:'TEST_COMMAND_REACHED'});}}
  });
  const persisted=JSON.parse(await fs.readFile(path.join(report.stage,'result.json'),'utf8'));
  assert.equal(persisted.failures[0].phase,'setup');assert.equal(persisted.failures[0].error,'EILSEQ');
  assert.equal(persisted.fixtureState,'UNVERIFIED_PLATFORM_FIXTURE');
  assert.equal(persisted.fixturePreflight,'INCOMPLETE');assert.equal(persisted.readiness,'NOT_READY');
  assert.equal(persisted.fifoFixture.state,'UNVERIFIED');assert.equal(persisted.mountFixture.state,'UNVERIFIED');
  assert.deepEqual(persisted.counts,{helperLaunches:0,signedBundles:0,observerInvocations:0,relocations:0});
  assert.deepEqual(effects,{reserve:0,command:0});
  assert.deepEqual(events,['fixtures-created','invalid-name-write','report-persisted']);
  assert.ok(ownedCase);await assert.rejects(fs.lstat(ownedCase),{code:'ENOENT'});
  for(const [index,file] of [source,canary].entries()){
   const after=await fs.lstat(file,{bigint:true});assert.deepEqual(await fs.readFile(file),before[index].bytes);
   assert.equal(after.dev,before[index].stat.dev);assert.equal(after.ino,before[index].stat.ino);
  }
  assert.equal(persisted.state,'INCONCLUSIVE');assert.equal(persisted.evidence,undefined);
  assertNoRunEffects(persisted);passed=true;
 }finally{if(passed)await fs.rm(root,{recursive:true,force:true});else console.error(`Preserved reader test stage: ${report?.stage??root}`);}
});

test('reader orchestration persists only observed relocation phases after failure',async()=>{
 const phases=[['stopConfirmed',1.25],['parentRelocated',2.5],['resumed',3.75],['responseObserved',4.125]];
 for(let cut=0;cut<phases.length;cut++){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reader-relocation-report-')),failure=Object.assign(Error(`synthetic failure after ${phases[cut][0]}`),{code:`SYNTHETIC_${phases[cut][0]}`});let reserveCalls=0,report,passed=false;
  try{
   report=await readerDriver.runReaderOrchestration({stageRoot:root,writeInvalidName:syntheticInvalidNameWriter,reserve:async()=>{reserveCalls++;throw Object.assign(Error('native phase blocked by synthetic test boundary'),{code:'TEST_NATIVE_PHASE_BLOCKED'});},phaseProducer:async(recordPhase,context)=>{
    for(let index=0;index<=cut;index++)recordPhase(phases[index][0],phases[index][1]);throw failure;
   }});
   const persisted=JSON.parse(await fs.readFile(path.join(report.stage,'result.json'),'utf8'));
   assert.deepEqual(persisted.observations.relocationTimeline,Object.fromEntries(phases.slice(0,cut+1)));
   assert.equal(persisted.failures.at(-1).error,failure.code);assert.equal(persisted.failures.at(-1).phase,'synthetic-observations');assert.equal(persisted.state,'INCONCLUSIVE');
   assert.equal(persisted.observationOrigin,'SYNTHETIC_TEST');assert.ok(persisted.unresolved.includes('Synthetic relocation phases verify report persistence only'));
   assert.equal(persisted.evidence,undefined);assert.equal(reserveCalls,0);
   assertNoRunEffects(persisted);passed=true;
  }finally{if(passed)await fs.rm(root,{recursive:true,force:true});else console.error(`Preserved reader test stage: ${report?.stage??root}`);}
 }
});

function retainedInputFixture(root,candidateBytes=Buffer.from('synthetic retained release bytes')){
 const candidate=path.join(root,'retained-candidate'),buildFile=path.join(root,'retained-build.json');
 const candidateSha256=sha(candidateBytes),build={uuid:'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',driver:'xcrun-macosx-swiftc-v1',sdk:{path:path.join(root,'SDK'),version:'synthetic',settings_sha256:'1'.repeat(64)},source_sha256:readerDriver.expectedSourceSha256,compiler_sha256:'2'.repeat(64),code_sha256:'3'.repeat(64),release_sha256:candidateSha256,compiler_version:'synthetic test fixture',arguments:['-O','-Xlinker','-reproducible'],signing_profile:'gsa-directory-tree-readonly-single-root-v1',hostRelease:'synthetic',arch:'arm64'};
 return fs.writeFile(candidate,candidateBytes,{mode:0o600}).then(()=>fs.writeFile(buildFile,Buffer.from(JSON.stringify(build)),{mode:0o600})).then(async()=>({candidate,build:buildFile,candidateSha256,buildSha256:sha(await fs.readFile(buildFile))}));
}

test('reader preflight verifies exclusive retained copies and records unavailable fixtures before blocking reserve',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reader-retained-copy-')),inputs=await retainedInputFixture(root),candidateInfo=await fs.lstat(inputs.candidate,{bigint:true}),buildInfo=await fs.lstat(inputs.build,{bigint:true}),events=[],effects={reserve:0,command:0};let prepared,report,passed=false;
 try{
  report=await readerDriver.runReaderOrchestration({stageRoot:root,inputs,writeInvalidName:syntheticInvalidNameWriter,
   onEvent:async(name,context)=>{events.push(name);if(name==='preflight-prepared'){
    prepared=context;
    const stagedCandidate=path.join(context.stage,'candidate-tree-broker'),stagedBuild=path.join(context.stage,'build.json');
    assert.deepEqual(await fs.readFile(stagedCandidate),await fs.readFile(inputs.candidate));assert.deepEqual(await fs.readFile(stagedBuild),await fs.readFile(inputs.build));
    assert.equal(sha(await fs.readFile(stagedCandidate)),inputs.candidateSha256);assert.equal(sha(await fs.readFile(stagedBuild)),inputs.buildSha256);
    const [candidateCopyInfo,buildCopyInfo]=await Promise.all([fs.lstat(stagedCandidate,{bigint:true}),fs.lstat(stagedBuild,{bigint:true})]);
    assert.notDeepEqual({dev:candidateCopyInfo.dev,ino:candidateCopyInfo.ino},{dev:candidateInfo.dev,ino:candidateInfo.ino});assert.notDeepEqual({dev:buildCopyInfo.dev,ino:buildCopyInfo.ino},{dev:buildInfo.dev,ino:buildInfo.ino});
    assert.equal(context.ready,false);assert.equal(context.report.fixturePreflight,'INCOMPLETE');assert.equal(context.report.readiness,'NOT_READY');
    assert.equal(context.report.fifoFixture.state,'UNVERIFIED');assert.equal(context.report.mountFixture.state,'UNVERIFIED');
   }},effects:{command:async()=>{effects.command++;throw Object.assign(Error('unexpected command'),{code:'TEST_COMMAND_REACHED'});}},
   reserve:async()=>{effects.reserve++;throw Object.assign(Error('reservation must remain blocked'),{code:'UNEXPECTED_RESERVATION'});}
  });
  assert.equal(prepared.ready,false);assert.equal(report.evidence,undefined);
  assert.deepEqual(events,['fixtures-created','preflight-prepared','report-persisted']);assert.deepEqual(effects,{reserve:0,command:0});
  assert.equal(report.fixturePreflight,'INCOMPLETE');assert.equal(report.readiness,'NOT_READY');
  assert.equal(report.fifoFixture.state,'UNVERIFIED');assert.equal(report.mountFixture.state,'UNVERIFIED');assert.equal(report.counts.signedBundles,0);assert.equal(report.counts.helperLaunches,0);
  assertNoRunEffects(report);passed=true;
 }finally{if(passed)await fs.rm(root,{recursive:true,force:true});else console.error(`Preserved reader test stage: ${report?.stage??root}`);}
});

test('reader preflight rejects a changed retained candidate pin before reservation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reader-retained-pin-')),inputs=await retainedInputFixture(root),events=[];let reserveCalls=0,report,passed=false;
 try{
  report=await readerDriver.runReaderOrchestration({stageRoot:root,inputs:{...inputs,candidateSha256:'0'.repeat(64)},writeInvalidName:syntheticInvalidNameWriter,onEvent:name=>events.push(name),reserve:async()=>{reserveCalls++;throw Object.assign(Error('unexpected reservation'),{code:'TEST_RESERVE_REACHED'});}});
  assert.equal(report.failures[0].phase,'setup');assert.equal(report.failures[0].error,'RETAINED_INPUT_HASH_MISMATCH');
  assert.equal(reserveCalls,0);assert.equal(report.evidence,undefined);assert.equal(report.mountFixture.state,'UNVERIFIED');
  assert.equal(report.fixturePreflight,'INCOMPLETE');assert.equal(report.readiness,'NOT_READY');
  assert.ok(events.includes('report-persisted'));assert.ok(!events.includes('preflight-prepared'));
  assertNoRunEffects(report);passed=true;
 }finally{if(passed)await fs.rm(root,{recursive:true,force:true});else console.error(`Preserved reader test stage: ${report?.stage??root}`);}
});

test('native fixture budget admits the finite plan and rejects every overrun',()=>{
 const budget=createInvocationBudget();
 for(let i=0;i<limits.helperLaunches;i++)budget.consume('helper');
 for(let i=0;i<limits.signedBundles;i++)budget.consume('bundle');
 for(let i=0;i<limits.observerInvocations;i++)budget.consume('observer');
 budget.consume('relocation');
 assert.deepEqual(budget.snapshot(),{helperLaunches:24,signedBundles:2,observerInvocations:3,relocations:1});
 for(const kind of ['helper','bundle','observer','relocation'])assert.throws(()=>budget.consume(kind),{code:'NATIVE_BUDGET_EXHAUSTED'});
});

test('one relocation process consumes exactly one relocation and helper slot',()=>{
 const budget=createInvocationBudget(),report={};
 assert.deepEqual(accountRelocationLaunch(budget,report),{helperLaunches:1,signedBundles:0,observerInvocations:0,relocations:1});
 assert.deepEqual(report.counts,budget.snapshot());
});

test('owned disposable setup failure cleans only its exact case directory and preserves canaries',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tree-case-')),outside=path.join(root,'outside'),canary=path.join(outside,'canary.txt'),target=path.join(root,'case-invalid-utf8'),bytes=Buffer.from('outside canary stays intact\n');
 await fs.mkdir(outside);await fs.writeFile(canary,bytes);
 try{
  const failure=Object.assign(Error('synthetic invalid-byte filename rejected by filesystem'),{code:'EILSEQ'});
  await assert.rejects(withOwnedDisposableCase(root,'case-invalid-utf8',async()=>{await fs.mkdir(target);throw failure;},async()=>{}),error=>error===failure);
  await assert.rejects(fs.lstat(target),{code:'ENOENT'});assert.deepEqual(await fs.readFile(canary),bytes);
  await assert.rejects(withOwnedDisposableCase(root,'../outside/canary.txt',async()=>canary,async()=>{}),{code:'DISPOSABLE_CASE_PATH_MISMATCH'});
  assert.deepEqual(await fs.readFile(canary),bytes);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('relocation timestamps persist in the report before proof eligibility',()=>{
 const report={observations:{}},timeline=[1.25,2.5,3.75];
 for(const [phase,value] of ['stopConfirmed','parentRelocated','resumed'].map((phase,index)=>[phase,timeline[index]]))recordRelocationPhase(report,phase,value);
 assert.deepEqual(report.observations.relocationTimeline,{stopConfirmed:1.25,parentRelocated:2.5,resumed:3.75});
 assert.throws(()=>recordRelocationPhase(report,'responseObserved',Infinity),{code:'RELOCATION_TIMELINE_INVALID'});
});

test('capture parser validates exact bound envelope and bounded UTF-8 JSON',()=>{
 const value=success(request),parsed=parseTreeResponse(Buffer.from(JSON.stringify(value)),request);
 assert.equal(parsed.capture.manifest.total_bytes,Buffer.byteLength('synthetic payload'));
 assert.doesNotThrow(()=>validateDirectoryCapture(value.capture));
 assert.throws(()=>parseTreeResponse(Buffer.from(JSON.stringify({...value,untrusted:'extra'})),request),{code:'NATIVE_SUCCESS_SHAPE'});
 assert.throws(()=>parseTreeResponse(Buffer.from([0xff]),request),{code:'NATIVE_RESPONSE_UTF8'});
 assert.throws(()=>parseTreeResponse(Buffer.alloc(limits.outputBytes+1),request),{code:'NATIVE_RESPONSE_LIMIT'});
});

test('raw request and malformed response are durably retained before parser rejection',async()=>{
 const stage=await fs.mkdtemp(path.join(os.tmpdir(),'tree-receipt-')),report={stage,receipts:[],receiptBytes:0,unresolved:[]},raw=Buffer.from('{malformed native response');
 try{await assert.rejects(parseAndRecordTreeResponse(report,raw,request,{pid:404,closed:true}),{code:'NATIVE_RESPONSE_JSON'});
  assert.equal(report.receipts.length,1);const record=report.receipts[0];
  assert.equal((await fs.readFile(path.join(stage,record.files.request))).toString(),JSON.stringify(request));
  assert.deepEqual(await fs.readFile(path.join(stage,record.files.response)),raw);
  assert.equal(Object.values(record).some(value=>Buffer.isBuffer(value)),false);assert.equal(Object.hasOwn(record,'response_base64'),false);
 }finally{await fs.rm(stage,{recursive:true,force:true});}
});

test('raw leaked response is retained before relocation classification',async()=>{
 const stage=await fs.mkdtemp(path.join(os.tmpdir(),'tree-leak-')),raw=Buffer.from(JSON.stringify(success(request))),report={stage,receipts:[],receiptBytes:0,unresolved:[]};
 try{const parsed=await parseAndRecordTreeResponse(report,raw,request,{pid:405,closed:true});
  assert.equal(classifyRelocationResponse(raw,request).classification,'BLOCKING_OUTSIDE_CONTENT');
  const receipt=report.receipts[0];assert.deepEqual(await fs.readFile(path.join(stage,receipt.files.request)),Buffer.from(JSON.stringify(request)));
  const retained=await fs.readFile(path.join(stage,receipt.files.response));assert.deepEqual(retained,raw);assert.ok(retained.includes(Buffer.from(Buffer.from('synthetic payload').toString('base64'))));
  assert.equal(parsed.capture.files.length,1);
 }finally{await fs.rm(stage,{recursive:true,force:true});}
});

test('reader positives must match explicit named directories and exact known payload bytes',()=>{
 const role='workspace',files=[{path:'nested/fixture.txt',bytes:Buffer.from(`synthetic tree content ${role}\n`)},{path:'nested/unicodé-ß.txt',bytes:Buffer.from('unicode fixture\n')}];
 const entries=[{path:'',kind:'directory'},{path:'empty',kind:'directory'},{path:'nested',kind:'directory'},...files.map(file=>({path:file.path,kind:'file',size:file.bytes.length,sha256:sha(file.bytes)}))];
 const binding={...request};delete binding.operation;
 const response={ok:true,format:'gsa-directory-capture-response-v1',binding,capture:{manifest:{format:'gsa-directory-manifest-v1',entries,total_bytes:files.reduce((n,file)=>n+file.bytes.length,0),sha256:directoryManifestDigest(entries)},files:files.map(file=>({path:file.path,base64:file.bytes.toString('base64')})),observations:entries.map((entry,index)=>({path:entry.path,kind:entry.kind,device:'1',inode:String(index+1),size:entry.kind==='file'?entry.size:0,mtime_ns:'1',ctime_ns:'2'}))}};
 const parsed=parseTreeResponse(Buffer.from(JSON.stringify(response)),request);
 assert.equal(assertSyntheticRootCapture(parsed,role),true);
 assert.throws(()=>assertSyntheticRootCapture(parsed,'reference'),{code:'EXPECTED_MANIFEST_MISMATCH'});
});

test('expected fixture comparison rejects valid self-consistent substitution and omission',()=>{
 const payload=Buffer.from('known fixture bytes'),entries=[{path:'',kind:'directory'},{path:'empty',kind:'directory'},{path:'nested',kind:'directory'},{path:'nested/file.txt',kind:'file',size:payload.length,sha256:sha(payload)}];
 const expectedFiles=[{path:'nested/file.txt',bytes:payload}];
 const built=(payloadBytes,manifestEntries=entries)=>{
  const actual=[...manifestEntries].map(entry=>entry.kind==='file'?{...entry,size:payloadBytes.length,sha256:sha(payloadBytes)}:entry);
  const files=actual.filter(entry=>entry.kind==='file').map(entry=>({path:entry.path,base64:payloadBytes.toString('base64')}));
  return parseTreeResponse(Buffer.from(JSON.stringify({ok:true,format:'gsa-directory-capture-response-v1',binding:(()=>{const x={...request};delete x.operation;return x;})(),capture:{manifest:{format:'gsa-directory-manifest-v1',entries:actual,total_bytes:files.length?payloadBytes.length:0,sha256:directoryManifestDigest(actual)},files,observations:actual.map((entry,index)=>({path:entry.path,kind:entry.kind,device:'1',inode:String(index+1),size:entry.kind==='file'?entry.size:0,mtime_ns:'1',ctime_ns:'2'}))}})),request);
 };
 assert.equal(assertCaptureMatchesExpected(built(payload),entries,expectedFiles),true);
 const substituted=Buffer.from('different but self-consistent');
 assert.throws(()=>assertCaptureMatchesExpected(built(substituted),entries,expectedFiles),{code:'EXPECTED_MANIFEST_MISMATCH'});
 assert.throws(()=>assertCaptureMatchesExpected(built(payload,entries.filter(entry=>entry.path!=='empty')),entries,expectedFiles),{code:'EXPECTED_MANIFEST_MISMATCH'});
});

function fakeChild({closeOnKill=false}={}){
 const child=new EventEmitter();child.pid=901;child.exitCode=null;child.signalCode=null;child.signals=[];child.detached=false;
 child.stdin={destroyed:false,destroy(){this.destroyed=true;},end(){this.ended=true;},unref(){}};
 child.stdout={destroyed:false,destroy(){this.destroyed=true;},unref(){}};child.stderr={destroyed:false,destroy(){this.destroyed=true;},unref(){}};
 child.kill=signal=>{child.signals.push(signal);if(closeOnKill&&signal==='SIGKILL'){child.signalCode=signal;queueMicrotask(()=>child.emit('close',null,signal));}return true;};child.unref=()=>{child.detached=true;};
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 return {child,closed};
}

test('bounded child cleanup escalates and reports unknown without claiming exit',async()=>{
 const closes=fakeChild({closeOnKill:true}),result=await waitForChildClose(closes.child,closes.closed,{timeoutMs:1,termGraceMs:1,killGraceMs:20});
 assert.equal(result.closed,true);assert.deepEqual(closes.child.signals,['SIGTERM','SIGKILL']);
 const stuck=fakeChild();
 await assert.rejects(waitForChildClose(stuck.child,stuck.closed,{timeoutMs:1,termGraceMs:1,killGraceMs:1}),{code:'CLEANUP_UNVERIFIED'});
 assert.deepEqual(stuck.child.signals,['SIGTERM','SIGKILL']);assert.equal(stuck.child.detached,true);assert.equal(stuck.child.exitCode,null);
 assert.equal(stuck.child.stdin.destroyed,true);assert.equal(stuck.child.stdout.destroyed,true);assert.equal(stuck.child.stderr.destroyed,true);
});

test('observer cleanup rejection settles ready and hit promises instead of leaving readiness pending',async()=>{
 const stage=await fs.mkdtemp(path.join(os.tmpdir(),'tree-observer-')),child=new EventEmitter();
 child.pid=907;child.exitCode=null;child.signalCode=null;child.stdin={destroy(){},unref(){}};child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=signal=>{child.signals??=[];child.signals.push(signal);return true;};child.unref=()=>{};
 const report={stage,receipts:[],receiptBytes:0,unresolved:[]},budget=createInvocationBudget();
 try{const watch=startObserverWatch(['watch','907',String(process.pid),'/private/fake','1:2','3','4','-'],budget,report,{spawnChild:()=>child,timeoutMs:1,termGraceMs:1,killGraceMs:1});
  await assert.rejects(watch.completion,{code:'CLEANUP_UNVERIFIED'});assert.equal(await watch.ready,undefined);
  await assert.rejects(watch.hit,{code:'CLEANUP_UNVERIFIED'});assert.deepEqual(child.signals,['SIGTERM','SIGKILL']);
 }finally{await fs.rm(stage,{recursive:true,force:true});}
});

test('owned relocation spawn failure is consumed and routed to failure cleanup',async()=>{
 const child=new EventEmitter(),error=Object.assign(Error('synthetic spawn denial'),{code:'EACCES'});let routed;
 const started=waitForChildSpawn(child,value=>{routed=value;});queueMicrotask(()=>child.emit('error',error));
 await assert.rejects(started,value=>value===error);assert.equal(routed,error);assert.equal(child.listenerCount('error'),0);assert.equal(child.listenerCount('spawn'),0);
});

test('shared stream collector keeps exact bounded partial stdout and signals overflow once',()=>{
 const stream=new PassThrough(),exceeded=[];const capture=captureBoundedStream(stream,4,()=>exceeded.push('limit'));
 stream.write(Buffer.from('abc'));stream.write(Buffer.from('def'));stream.end();
 assert.equal(capture.bytes.toString(),'abcd');assert.equal(capture.observedBytes,6);assert.equal(capture.truncated,true);assert.deepEqual(exceeded,['limit']);
});

test('relocation request is withheld until exact observer readiness',async()=>{
 const stream={calls:[],end(value){this.calls.push(value);}},bytes=Buffer.from(JSON.stringify(request));
 await assert.rejects(sendRequestAfterObserverReady(Promise.resolve(undefined),stream,bytes),{code:'OBSERVER_READY_MISSING'});
 await assert.rejects(sendRequestAfterObserverReady(Promise.reject(Object.assign(Error('observer exited early'),{code:'OBSERVER_EXIT'})),stream,bytes),{code:'OBSERVER_EXIT'});
 await assert.rejects(sendRequestAfterObserverReady(Promise.resolve({pid:1}),stream,bytes,()=>false),{code:'OBSERVER_READY_MISMATCH'});
 assert.deepEqual(stream.calls,[]);
 const ready={pid:901};assert.equal(await sendRequestAfterObserverReady(Promise.resolve(ready),stream,bytes,value=>value.pid===901),ready);
 assert.deepEqual(stream.calls,[bytes]);
});

test('early observer hit rejection is handled before waiting for readiness',async()=>{
 const stream={calls:[],end(value){this.calls.push(value);}},bytes=Buffer.from('must not dispatch');let unhandled=false;
 const onUnhandled=()=>{unhandled=true;};process.once('unhandledRejection',onUnhandled);
 const gate=gateRelocationRequest(Promise.resolve(undefined),Promise.reject(Object.assign(Error('observer failed before ready'),{code:'OBSERVER_EXIT'})),stream,bytes);
 await assert.rejects(gate,{code:'OBSERVER_READY_MISSING'});
 await new Promise(resolve=>setImmediate(resolve));process.removeListener('unhandledRejection',onUnhandled);
 assert.equal(unhandled,false);assert.deepEqual(stream.calls,[]);
});

test('relocation classifier distinguishes exact denial, leaked synthetic bytes and malformed responses',()=>{
 const denied=Buffer.from(JSON.stringify({ok:false,error:'PATH_OUTSIDE_SCOPE'}));
 assert.deepEqual(classifyRelocationResponse(denied,request),{classification:'OBSERVED_DENIAL',error:'PATH_OUTSIDE_SCOPE'});
 assert.deepEqual(classifyRelocationResponse(Buffer.from(JSON.stringify(success(request))),request),{classification:'BLOCKING_OUTSIDE_CONTENT',bytes:Buffer.byteLength('synthetic payload')});
 assert.equal(classifyRelocationResponse(Buffer.from('{bad'),request).classification,'INCONCLUSIVE');
});

test('native execution gate is inert without both opt-in flags and on slot refusal',async()=>{
 let reservations=0,runs=0;
 await assert.rejects(runAcknowledged([],{platform:'darwin',arch:'arm64',reserve:async()=>reservations++,run:async()=>runs++}),{code:'ACKNOWLEDGEMENT_REQUIRED'});
 await assert.rejects(runAcknowledged(['--run-native','--ack-disposable-directory-v1'],{platform:'darwin',arch:'arm64',reserve:async()=>{reservations++;throw Object.assign(Error('slot already consumed'),{code:'EEXIST'});},run:async()=>runs++}),{code:'EEXIST'});
 assert.equal(reservations,1);assert.equal(runs,0);
 const result=await runAcknowledged(['--run-native','--ack-disposable-directory-v1'],{platform:'darwin',arch:'arm64',reserve:async()=>reservations++,run:async()=>{runs++;return 'injected transport only';}});
 assert.equal(result,'injected transport only');assert.equal(reservations,2);assert.equal(runs,1);
 await assert.rejects(runAcknowledged(['--run-native','--ack-disposable-directory-v1'],{platform:'linux',arch:'arm64',reserve:async()=>reservations++,run:async()=>runs++}),{code:'APPLE_SILICON_MAC_REQUIRED'});
 assert.equal(runs,1);
});
