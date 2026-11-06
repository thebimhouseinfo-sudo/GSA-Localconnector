import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {enrollRolesTrustedBatch,revokeTrusted} from '../src/local/grants.js';
import {loadTrustedRegistry} from '../src/local/grants.js';
import {FileTransactionStore} from '../src/local/file-transaction-store.js';
import {createHash,createHmac} from 'node:crypto';
import {normalizedStrippedMacFileCode} from '../src/hosts/macos-file-code.js';
import {loadCheckedMacRecoveryInstallation} from '../src/hosts/macos-recovery-installation.js';
import {receiptSample} from './helpers/mac-file-evidence-fixture.js';
const moduleUrl=pathToFileURL(path.resolve('scripts/install-mac-scoped-files.mjs')).href;
async function writeFixtureBaseProof(identity:string,live:string){
 const entry=(await loadTrustedRegistry(identity)).list()[0]!,evidence=receiptSample(os.release(),process.arch),key=Buffer.alloc(32,23);
 const grant={...evidence.fixture.roots[0],id:entry.id,root:entry.canonicalRoot,rootIdentity:entry.rootIdentity,role:entry.role,revision:entry.revision};
 const body=JSON.stringify({format:'gsa-scoped-files-v2',hostRelease:os.release(),arch:process.arch,grants:[grant],build:evidence.build,evidence});
 await fs.writeFile(path.join(live,'proof-key'),key,{mode:0o600});await fs.writeFile(path.join(live,'install.json'),JSON.stringify({body,hmac:createHmac('sha256',key).update(body).digest('hex')}),{mode:0o600});return {key,body};
}
test('recovery install refuses missing qualification before changing the existing installation',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=path.join(f.temp,'archive'),live=path.join(f.identity,'scoped-files');
 await fs.mkdir(archive,{mode:0o700});await fs.mkdir(live,{mode:0o700});await fs.writeFile(path.join(live,'keep'),'existing',{mode:0o600});
 await writeFixtureBaseProof(f.identity,live);
 const original=await fs.lstat(live,{bigint:true});
 await assert.rejects(installer.applyMacScopedRecovery(f.identity,archive,{}),/Unsafe recovery archive file/);
 const current=await fs.lstat(live,{bigint:true});assert.equal(current.dev,original.dev);assert.equal(current.ino,original.ino);
 assert.equal(await fs.readFile(path.join(live,'keep'),'utf8'),'existing');
 assert.deepEqual((await fs.readdir(f.identity)).filter(name=>name.startsWith('.scoped-files.stage-')),[]);
});
test('recovery install detects prior proof key changes while reading the manifest',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=path.join(f.temp,'archive'),live=path.join(f.identity,'scoped-files');
 await fs.mkdir(archive,{mode:0o700});await fs.mkdir(live,{mode:0o700});await writeFixtureBaseProof(f.identity,live);
 const proofKey=path.join(live,'proof-key'),manifest=path.join(live,'install.json');
 const open=fs.open.bind(fs);let injected=false;
 (fs as any).open=async (...args:any[])=>{if(args[0]===manifest&&!injected){await fs.writeFile(proofKey,Buffer.alloc(32,24));injected=true;}return (open as any)(...args);};
 try{await assert.rejects(installer.applyMacScopedRecovery(f.identity,archive,{}),/Previous installation proof changed/);assert.equal(injected,true);}
 finally{(fs as any).open=open;}
});
test('recovery install refuses an authenticated but structurally invalid previous grant before staging',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=path.join(f.temp,'archive'),live=path.join(f.identity,'scoped-files');await fs.mkdir(archive,{mode:0o700});await fs.mkdir(live,{mode:0o700});
 const {key,body}=await writeFixtureBaseProof(f.identity,live),proof=JSON.parse(body);proof.grants[0].rootIdentity={device:'invalid',inode:'2'};
 const changed=JSON.stringify(proof);await fs.writeFile(path.join(live,'install.json'),JSON.stringify({body:changed,hmac:createHmac('sha256',key).update(changed).digest('hex')}),{mode:0o600});
 await assert.rejects(installer.applyMacScopedRecovery(f.identity,archive,{}),/Invalid previous installation binding/);
 assert.deepEqual((await fs.readdir(f.identity)).filter(name=>name.startsWith('.scoped-files.stage-')),[]);
});
async function retainedArchive(t:any,temp:string){
 if(os.release()!=='27.0.0'){t.skip('Retained qualification applies only to its recorded host release');return null;}
 const archive=path.join(temp,'archive');await fs.mkdir(archive,{mode:0o700});
 const recovery=path.resolve('docs/reports/2026-10-28-mac27-recovery-native-archive'),base=path.resolve('docs/reports/2026-10-26-mac27-native-archive');
 const sources:Record<string,string>={'report.json':path.join(recovery,'report.json'),'production-build.json':path.join(recovery,'production-build.json'),'production-release-recovery':path.join(recovery,'production-release-recovery'),'base-release-broker':path.join(recovery,'base-release-broker'),'base-build.json':path.join(base,'build.json'),'base-evidence.json':path.join(base,'native-evidence.json')};
 try{for(const source of Object.values(sources))await fs.access(source);}catch{t.skip('Retained qualification archive not available locally');return null;}
 for(const [name,source] of Object.entries(sources)){await fs.copyFile(source,path.join(archive,name));await fs.chmod(path.join(archive,name),0o600);}
 return archive;
}
test('qualified recovery installer publishes only into a disposable identity root',{skip:process.platform!=='darwin'||process.arch!=='arm64',timeout:30000},async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=await retainedArchive(t,f.temp);if(!archive)return;
 const result=await installer.applyMacScopedRecovery(f.identity,archive,{});
 assert.equal(result.state,'SCOPED_FILES_RECOVERY_INSTALLED_NOT_ACTIVATED');assert.equal(result.previous,null);
 const installed=path.join(f.identity,'scoped-files');assert.equal(result.installation,installed);assert.equal((await fs.stat(path.join(installed,'work/RecoveryBroker.app/Contents/MacOS/recovery-broker'))).isFile(),true);
 assert.deepEqual(await fs.readdir(path.join(installed,'file-transactions')),[]);
 // Synthetic owner/IO injection: actual candidate signatures and manifest are checked,
 // but the injected FD marker is not evidence of a live owner or plugin activation.
 const registry=await loadTrustedRegistry(f.identity);
 const checked=await loadCheckedMacRecoveryInstallation(registry,installed,{
  ownerLockFD:3,authorize:async()=>{},
  protectedRead:async(file,max)=>{const bytes=await fs.readFile(file);assert.ok(bytes.length<=max);return bytes;},
  protectedDirectory:async(directory)=>{const s=await fs.lstat(directory);assert.ok(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o700);},
  normalizedCodeSha256:async(binary)=>{const copy=path.join(f.temp,'normalize-copy');await fs.copyFile(binary,copy,fs.constants.COPYFILE_EXCL);await fs.chmod(copy,0o700);try{execFileSync('/usr/bin/codesign',['--remove-signature',copy],{stdio:'ignore'});return createHash('sha256').update(normalizedStrippedMacFileCode(await fs.readFile(copy))).digest('hex');}finally{await fs.unlink(copy);}},
  command:async(executable,args,input,max)=>{assert.ok(['/usr/bin/codesign','/usr/bin/plutil'].includes(executable));const output=execFileSync(executable,args,{input,stdio:['pipe','pipe','ignore']});assert.ok(output.length<=max);return output;}
 });
 assert.equal(typeof checked.replaceIfHash,'function');assert.equal(typeof checked.trashIfHash,'function');
});
test('apply-recovery CLI uses a selected disposable identity and qualification archive',{skip:process.platform!=='darwin'||process.arch!=='arm64',timeout:30000},async t=>{
 const f=await fixture(t),archive=await retainedArchive(t,f.temp);if(!archive)return;
 const result=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,[path.resolve('scripts/install-mac-scoped-files.mjs'),'apply-recovery','--identity-root',f.identity,'--qualification-archive',archive],{env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:f.temp,TMPDIR:'/private/tmp'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
 });
 assert.equal(result.code,0,result.stderr);assert.equal(JSON.parse(result.stdout).state,'SCOPED_FILES_RECOVERY_INSTALLED_NOT_ACTIVATED');assert.equal((await fs.stat(path.join(f.identity,'scoped-files/work/RecoveryBroker.app'))).isDirectory(),true);
});
test('qualified recovery upgrade retains prior journal and capture bytes',{skip:process.platform!=='darwin'||process.arch!=='arm64',timeout:30000},async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=await retainedArchive(t,f.temp);if(!archive)return;
 await installer.applyMacScopedRecovery(f.identity,archive,{});
 const live=path.join(f.identity,'scoped-files'),root=path.join(f.identity,'file-recovery','work-r1'),journal=path.join(live,'file-transactions'),id='33333333-3333-4333-8333-333333333333';
 await fs.writeFile(path.join(root,'capture'),'retained',{mode:0o600});const store=new FileTransactionStore(journal);
 const pending=await store.create(id,{operation:'replace',source:{workspace_id:'work',path:'file.txt',revision:1,rootIdentity:{device:'1',inode:'2'}},destination:null,expected_sha256:'a'.repeat(64),after_sha256:'b'.repeat(64)});
 await store.reconcile(id,pending.revision);await fs.writeFile(path.join(journal,id+'.lock'),'',{mode:0o600});const oldBytes=await fs.readFile(path.join(journal,id+'.json'));
 const result=await installer.applyMacScopedRecovery(f.identity,archive,{});assert.equal(result.state,'SCOPED_FILES_RECOVERY_INSTALLED_NOT_ACTIVATED');assert.ok(result.previous);
 assert.deepEqual(await fs.readFile(path.join(live,'file-transactions',id+'.json')),oldBytes);assert.deepEqual(await fs.readFile(path.join(result.previous,'file-transactions',id+'.json')),oldBytes);
 assert.equal(await fs.readFile(path.join(root,'capture'),'utf8'),'retained');assert.equal((await new FileTransactionStore(path.join(live,'file-transactions')).load(id)).status,'UNKNOWN');
});
test('recovery upgrade keeps earlier captures when the workspace revision changes',{skip:process.platform!=='darwin'||process.arch!=='arm64',timeout:30000},async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=await retainedArchive(t,f.temp);if(!archive)return;
 await installer.applyMacScopedRecovery(f.identity,archive,{});const oldRecovery=path.join(f.identity,'file-recovery','work-r1');await fs.writeFile(path.join(oldRecovery,'capture'),'old capture',{mode:0o600});
 const next=path.join(f.temp,'next-workspace');await fs.mkdir(next,{mode:0o700});await enrollRolesTrustedBatch([{id:'work',root:next,role:'workspace'}],f.identity);
 const revision=(await loadTrustedRegistry(f.identity)).list().find(g=>g.id==='work')!.revision;
 const result=await installer.applyMacScopedRecovery(f.identity,archive,{});
 assert.ok(result.previous);assert.equal(await fs.readFile(path.join(oldRecovery,'capture'),'utf8'),'old capture');
 const nextRecovery=path.join(f.identity,'file-recovery',`work-r${revision}`);assert.notEqual(nextRecovery,oldRecovery);assert.deepEqual(await fs.readdir(nextRecovery),[]);
});
test('recovery installation creates a read-only BASE binding for reference roots',{skip:process.platform!=='darwin'||process.arch!=='arm64',timeout:30000},async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=await retainedArchive(t,f.temp);if(!archive)return;
 const reference=path.join(f.temp,'reference');await fs.mkdir(reference,{mode:0o700});await enrollRolesTrustedBatch([{id:'ref',root:reference,role:'reference'}],f.identity);
 const result=await installer.applyMacScopedRecovery(f.identity,archive,{}),envelope=JSON.parse(await fs.readFile(path.join(result.installation,'install.json'),'utf8')),proof=JSON.parse(envelope.body);
 const ref=proof.grants.find((item:any)=>item.id==='ref'),work=proof.grants.find((item:any)=>item.id==='work');
 assert.equal(ref.role,'reference');assert.equal(Object.hasOwn(ref,'recovery'),false);assert.ok(work.recovery);
 assert.equal((await fs.stat(path.join(result.installation,'ref/Broker.app'))).isDirectory(),true);await assert.rejects(fs.lstat(path.join(result.installation,'ref/RecoveryBroker.app')),{code:'ENOENT'});
});
// Observes only the detached process group created by spawn. It cannot prove
// descendants which leave the group/session are stopped.
function appendBoundedFixtureBytes(chunks:Buffer[],used:number,bytes:Buffer,cap:number):{used:number;overflow:boolean}{
 const remaining=Math.max(0,cap-used),accepted=Math.min(bytes.length,remaining);
 if(accepted)chunks.push(Buffer.from(bytes.subarray(0,accepted)));
 return {used:used+accepted,overflow:bytes.length>remaining};
}
test('fixture output buffer retains only capped bytes after repeated overflow',()=>{
 const chunks:Buffer[]=[];let used=0,overflows=0;
 for(const bytes of [Buffer.alloc(65000,0x61),Buffer.alloc(2000,0x62),Buffer.alloc(500000,0x63)]){
  const result=appendBoundedFixtureBytes(chunks,used,bytes,65536);used=result.used;if(result.overflow)overflows++;
 }
 assert.equal(used,65536);assert.equal(Buffer.concat(chunks).length,65536);
 assert.equal(chunks.length,2);assert.equal(overflows,2);
});

async function observeOwnedFixtureGroup(child:ReturnType<typeof spawn>,retainedPath:string,limits={termMs:15000,killMs:18000,endMs:21000},onStopped=()=>{}):Promise<{code:number|null;stdout:string;stderr:string}>{
 const group=child.pid;if(!group)throw Error(`Fixture group identity missing; retained ${retainedPath}`);
 let closed=false,firstError:Error|undefined;
 const stdoutChunks:Buffer[]=[],stderrChunks:Buffer[]=[];let stdoutBytes=0,stderrBytes=0;
 const groupAlive=()=>{try{process.kill(-group,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH';}};
 const signal=(name:NodeJS.Signals)=>{try{process.kill(-group,name);}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')firstError??=e as Error;}};
 const append=(chunks:Buffer[],used:number,bytes:Buffer,label:string)=>{
  const next=appendBoundedFixtureBytes(chunks,used,bytes,65536);
  if(next.overflow){firstError??=Error(`Fixture ${label} limit`);signal('SIGTERM');}
  return next.used;
 };
 child.stdout?.on('data',(bytes:Buffer)=>{stdoutBytes=append(stdoutChunks,stdoutBytes,bytes,'stdout');});
 child.stderr?.on('data',(bytes:Buffer)=>{stderrBytes=append(stderrChunks,stderrBytes,bytes,'stderr');});
 child.on('error',error=>{firstError??=error;});
 child.on('close',()=>{closed=true;});
 const started=Date.now(),delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
 let sentTerm=false,sentKill=false;
 while(Date.now()-started<limits.endMs){
  const age=Date.now()-started;
  if(age>=limits.termMs&&!sentTerm){sentTerm=true;firstError??=Error('Fixture deadline exceeded');signal('SIGTERM');}
  if(age>=limits.killMs&&!sentKill){sentKill=true;signal('SIGKILL');}
  if(closed&&!groupAlive()){
   // This proves only that the original group disappeared, not that escaped
   // descendants stopped. The caller must supply separate ownership evidence.
   onStopped();
   if(firstError)throw firstError;
   return {code:child.exitCode,stdout:Buffer.concat(stdoutChunks,stdoutBytes).toString('utf8'),stderr:Buffer.concat(stderrChunks,stderrBytes).toString('utf8')};
  }
  await delay(25);
 }
 throw Error(`Fixture group stop unverified; retained ${retainedPath}`);
}

test('owned fixture monitor waits for child in group after launcher exit',{skip:process.platform!=='darwin'},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-group-monitor-'));
 // The launcher exits quickly, leaving a child in the same process group.
 const launcher=spawn(process.execPath,['-e',`const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setTimeout(()=>{},1200)'],{stdio:'ignore'}).unref();`],{detached:true,stdio:['ignore','pipe','pipe']});
 let confirmed=false;
 try{
  const started=Date.now();
  const result=await observeOwnedFixtureGroup(launcher,root,{termMs:3000,killMs:3500,endMs:4500},()=>{confirmed=true;});
  assert.equal(result.code,0);
  assert.equal(confirmed,true);
  assert.ok(Date.now()-started>=500,'monitor returned before descendant lifetime');
 }finally{
  // Failed observation must retain evidence; this test never touches an unrelated group.
  if(confirmed)await fs.rm(root,{recursive:true,force:true});
 }
});
test('owned fixture monitor enforces deadline after launcher exit',{skip:process.platform!=='darwin'},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-group-timeout-'));
 const launcher=spawn(process.execPath,['-e',`const {spawn}=require('node:child_process');spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'}).unref();`],{detached:true,stdio:['ignore','pipe','pipe']});
 let confirmed=false;
 try{
  await assert.rejects(observeOwnedFixtureGroup(launcher,root,{termMs:500,killMs:900,endMs:3000},()=>{confirmed=true;}),/deadline exceeded/);
  assert.equal(confirmed,true,'owned group must be physically absent before cleanup');
 }finally{
  if(confirmed)await fs.rm(root,{recursive:true,force:true});
 }
});
test('detached descendant can outlive the original group (bounded observation only)',{skip:process.platform!=='darwin'},async()=>{
 const marker=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-escape-observation-'));
 const pidFile=path.join(marker,'escaped.pid'),doneFile=path.join(marker,'escaped.done');
 // Both processes are disposable. The detached child self-terminates and writes
 // completion evidence; the parent never sends signals to its new group.
 const childScript=`const {spawn}=require('node:child_process');const fs=require('node:fs');const p=spawn(process.execPath,['-e','setTimeout(()=>{require("node:fs").writeFileSync(process.argv[1],"done")},1800)',process.argv[2]],{detached:true,stdio:'ignore'});fs.writeFileSync(process.argv[1],String(p.pid));p.unref();`;
 const launcher=spawn(process.execPath,['-e',childScript,pidFile,doneFile],{detached:true,stdio:['ignore','pipe','pipe']});
 let observed=false,completed=false,escaped:number|undefined,absent=false;
 try{
  const result=await observeOwnedFixtureGroup(launcher,marker,{termMs:2500,killMs:3000,endMs:3500});
  assert.equal(result.code,0);observed=true;
  escaped=Number(await fs.readFile(pidFile,'utf8'));
  assert.ok(Number.isSafeInteger(escaped)&&escaped>0);
  assert.doesNotThrow(()=>process.kill(escaped!,0));
 }finally{
  // A completion marker alone is insufficient: confirm the escaped PID is
  // absent before cleanup. Uncertainty keeps the disposable evidence.
  for(let i=0;i<200;i++){
   if(await fs.access(doneFile).then(()=>true,()=>false))completed=true;
   if(completed&&escaped){try{process.kill(escaped,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH'){absent=true;break;}}}
   await new Promise(r=>setTimeout(r,25));
  }
  if(observed&&completed&&absent)await fs.rm(marker,{recursive:true,force:true});
 }
 assert.equal(completed&&absent,true,'detached fixture child must finish and disappear');
});
// NOTE: the live native-owner fixture still needs independent evidence that
// broker descendants cannot escape group/session before full-tree cleanup
// can be certified. Group absence alone is NOT that evidence.

test('installed qualified broker handles mutation and dropped reply with a real disposable owner',{skip:'BLOCKED: full descendant cleanup proof not established; manual qualification required',timeout:30000},async t=>{
 const cleanupGuard={safe:true};const f=await fixture(t,cleanupGuard),installer=await import(moduleUrl),archive=await retainedArchive(t,f.temp);if(!archive)return;
 await installer.applyMacScopedRecovery(f.identity,archive,{});const canary=path.join(f.temp,'outside-canary');await fs.writeFile(canary,'unchanged');
 cleanupGuard.safe=false;
 const child=spawn('/usr/bin/python3',[path.resolve('scripts/macos-owner-launcher.py'),'--identity',f.identity,'--node',process.execPath,'--entry',path.resolve('test/helpers/mac-recovery-installed-fixture.mjs')],{env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:f.temp,TMPDIR:path.dirname(f.temp),GSA_FIXTURE_IDENTITY:f.identity,GSA_FIXTURE_WORKSPACE:f.workspace,GSA_FIXTURE_SCRATCH:f.temp},detached:true,stdio:['ignore','pipe','pipe']});
 const result=await observeOwnedFixtureGroup(child,f.temp);
 assert.equal(result.code,0,result.stderr);const actual=JSON.parse(result.stdout);assert.equal(actual.dropped,'UNKNOWN');assert.equal(actual.readback,'APPLIED');assert.equal(actual.trash,'APPLIED');
 assert.equal(await fs.readFile(canary,'utf8'),'unchanged');
 // All subprocess spawns are recorded by the actual fixture before execution.
 // Verify each recorded PID is physically gone, even if it escaped the
 // original process group. Never signal an unknown or recycled PID.
 const recorded=JSON.parse(await fs.readFile(path.join(f.temp,'owned-child-pids.json'),'utf8'));
 assert.ok(Array.isArray(recorded)&&recorded.length>=2,'missing owned-child inventory');
 assert.equal(new Set(recorded).size,recorded.length,'duplicate owned-child PID');
 for(const pid of recorded){
  assert.ok(Number.isSafeInteger(pid)&&pid>0,'invalid owned-child PID');
  let stopped=false;
  try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')stopped=true;else throw error;}
  assert.ok(stopped,`owned fixture PID ${pid} remains observable; retain fixture`);
 }
 // Scoped fixture contract: the child awaits close of each broker invocation,
 // the launcher/fixture exited successfully, and the original group is absent.
 // This does NOT certify unrelated or session-escaping descendants. If any
 // assertion fails, preserve the disposable root for investigation.
 cleanupGuard.safe=true;
});
test('recovery installation refuses a grant revoked while building the candidate',{skip:process.platform!=='darwin'||process.arch!=='arm64',timeout:30000},async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=await retainedArchive(t,f.temp);if(!archive)return;
 const write=fs.writeFile.bind(fs);let injected=false;
 (fs as any).writeFile=async (...args:any[])=>{const result=await (write as any)(...args);if(!injected&&String(args[0]).includes('.scoped-files.stage-')&&String(args[0]).endsWith('/install.json')){injected=true;await revokeTrusted('work',f.identity);}return result;};
 try{await assert.rejects(installer.applyMacScopedRecovery(f.identity,archive,{}));assert.equal(injected,true);await assert.rejects(fs.lstat(path.join(f.identity,'scoped-files')),{code:'ENOENT'});}
 finally{(fs as any).writeFile=write;}
});
test('recovery installation refuses a grant revoked during final journal verification',{skip:process.platform!=='darwin'||process.arch!=='arm64',timeout:30000},async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=await retainedArchive(t,f.temp);if(!archive)return;
 const write=fs.writeFile.bind(fs),open=fs.open.bind(fs),lstat=fs.lstat.bind(fs);let manifestWritten=false,lastRegistryRead=false,injected=false;
 (fs as any).writeFile=async (...args:any[])=>{const result=await (write as any)(...args);if(String(args[0]).includes('.scoped-files.stage-')&&String(args[0]).endsWith('/install.json'))manifestWritten=true;return result;};
 (fs as any).open=async (...args:any[])=>{const handle=await (open as any)(...args);if(manifestWritten&&args[0]===path.join(f.identity,'trusted-workspaces.json'))lastRegistryRead=true;return handle;};
 (fs as any).lstat=async (...args:any[])=>{if(lastRegistryRead&&!injected&&String(args[0]).includes('.scoped-files.stage-')&&String(args[0]).endsWith('/file-transactions')){injected=true;await revokeTrusted('work',f.identity);}return (lstat as any)(...args);};
 try{await assert.rejects(installer.applyMacScopedRecovery(f.identity,archive,{}));assert.equal(injected,true);await assert.rejects(fs.lstat(path.join(f.identity,'scoped-files')),{code:'ENOENT'});}
 finally{(fs as any).writeFile=write;(fs as any).open=open;(fs as any).lstat=lstat;}
});
test('recovery installation detects a prior proof re-signed with a changed key',{skip:process.platform!=='darwin'||process.arch!=='arm64',timeout:30000},async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=await retainedArchive(t,f.temp);if(!archive)return;
 const live=path.join(f.identity,'scoped-files');await fs.mkdir(live,{mode:0o700});const {body}=await writeFixtureBaseProof(f.identity,live),old=await fs.lstat(live,{bigint:true}),write=fs.writeFile.bind(fs);let injected=false;
 (fs as any).writeFile=async (...args:any[])=>{const result=await (write as any)(...args);if(!injected&&String(args[0]).includes('.scoped-files.stage-')&&String(args[0]).endsWith('/install.json')){
  injected=true;const replacement=Buffer.alloc(32,25);await write(path.join(live,'proof-key'),replacement);await write(path.join(live,'install.json'),JSON.stringify({body,hmac:createHmac('sha256',replacement).update(body).digest('hex')}));}
  return result;};
 try{await assert.rejects(installer.applyMacScopedRecovery(f.identity,archive,{}),/Previous installation proof changed/);assert.equal(injected,true);const current=await fs.lstat(live,{bigint:true});assert.equal(current.ino,old.ino);assert.equal(current.dev,old.dev);}
 finally{(fs as any).writeFile=write;}
});
test('recovery installation rejects an artifact changed during candidate sync',{skip:process.platform!=='darwin'||process.arch!=='arm64',timeout:30000},async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=await retainedArchive(t,f.temp);if(!archive)return;
 const open=fs.open.bind(fs);let injected=false;
 (fs as any).open=async (...args:any[])=>{const handle=await (open as any)(...args);if(!injected&&String(args[0]).includes('/RecoveryBroker.app/Contents/Info.plist')){const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();await fs.appendFile(String(args[0]),'changed');injected=true;};}return handle;};
 try{await assert.rejects(installer.applyMacScopedRecovery(f.identity,archive,{}));assert.equal(injected,true);await assert.rejects(fs.lstat(path.join(f.identity,'scoped-files')),{code:'ENOENT'});}
 finally{(fs as any).open=open;}
});
test('recovery installation rejects a candidate proof changed before sync',{skip:process.platform!=='darwin'||process.arch!=='arm64',timeout:30000},async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=await retainedArchive(t,f.temp);if(!archive)return;
 const open=fs.open.bind(fs);let injected=false;
 (fs as any).open=async (...args:any[])=>{if(!injected&&String(args[0]).includes('.scoped-files.stage-')&&String(args[0]).endsWith('/install.json')){injected=true;await fs.writeFile(String(args[0]),'{}');}return (open as any)(...args);};
 try{await assert.rejects(installer.applyMacScopedRecovery(f.identity,archive,{}));assert.equal(injected,true);await assert.rejects(fs.lstat(path.join(f.identity,'scoped-files')),{code:'ENOENT'});}
 finally{(fs as any).open=open;}
});
test('recovery installation detects a proof key changed during final candidate validation',{skip:process.platform!=='darwin'||process.arch!=='arm64',timeout:30000},async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=await retainedArchive(t,f.temp);if(!archive)return;
 const open=fs.open.bind(fs);let baseReads=0,injected=false;
 (fs as any).open=async (...args:any[])=>{const file=String(args[0]);if(file.includes('.scoped-files.stage-')&&file.endsWith('/Broker.app/Contents/MacOS/broker')&&++baseReads===2){const stage=file.slice(0,file.indexOf('/work/Broker.app/'));await fs.writeFile(path.join(stage,'proof-key'),Buffer.alloc(32,27));injected=true;}return (open as any)(...args);};
 try{await assert.rejects(installer.applyMacScopedRecovery(f.identity,archive,{}));assert.equal(injected,true);await assert.rejects(fs.lstat(path.join(f.identity,'scoped-files')),{code:'ENOENT'});}
 finally{(fs as any).open=open;}
});
test('synthetic lost publication acknowledgment retains both installation generations',{skip:process.platform!=='darwin'||process.arch!=='arm64',timeout:30000},async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),archive=await retainedArchive(t,f.temp);if(!archive)return;
 await installer.applyMacScopedRecovery(f.identity,archive,{});const live=path.join(f.identity,'scoped-files'),old=await fs.lstat(live,{bigint:true});
 const root=path.join(f.identity,'file-recovery','work-r1');await fs.writeFile(path.join(root,'capture'),'retained',{mode:0o600});
 let code=await fs.readFile(path.resolve('scripts/install-mac-scoped-files.mjs'),'utf8');
 const inject='if(reply!==',here='const here=path.dirname(fileURLToPath(import.meta.url)),source=',guard='if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))';
 for(const marker of [inject,here,guard])assert.equal(code.split(marker).length,2,`test-only boundary changed: ${marker}`);
 code=code.replace(inject,'throw unknown();if(reply!==').replace(here,`const here=${JSON.stringify(path.resolve('scripts'))},source=`).replace(guard,'if(false)');
 const origin=pathToFileURL(path.resolve('scripts/install-mac-scoped-files.mjs')).href;
 code=code.replace(/from (["'])(\.[^"']+)\1/g,(_match,quote,relative)=>`from ${quote}${new URL(relative,origin).href}${quote}`);
 const synthetic=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 await assert.rejects(synthetic.applyMacScopedRecovery(f.identity,archive,{}),(error:any)=>error.code==='RESULT_UNKNOWN');
 const stages=(await fs.readdir(f.identity)).filter(name=>name.startsWith('.scoped-files.stage-'));assert.equal(stages.length,1);
 const previous=await fs.lstat(path.join(f.identity,stages[0]!),{bigint:true}),current=await fs.lstat(live,{bigint:true});
 assert.equal(previous.dev,old.dev);assert.equal(previous.ino,old.ino);assert.notEqual(current.ino,old.ino);assert.equal(await fs.readFile(path.join(root,'capture'),'utf8'),'retained');
});
test('recovery staging preserves validated journal records and lock markers byte for byte',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files'),stage=path.join(f.identity,'.scoped-files.stage-12345678-1234-4123-8123-123456789abc'),journal=path.join(live,'file-transactions');
 await fs.mkdir(live,{mode:0o700});await fs.mkdir(stage,{mode:0o700});
 const id='11111111-1111-4111-8111-111111111111',store=new FileTransactionStore(journal);
 await store.create(id,{operation:'replace',source:{workspace_id:'work',path:'file.txt',revision:1,rootIdentity:{device:'1',inode:'2'}},destination:null,expected_sha256:'a'.repeat(64),after_sha256:'b'.repeat(64)});
 await fs.writeFile(path.join(journal,id+'.lock'),'',{mode:0o600});
 await installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.stageRecoveryJournal(live,stage,check));
 for(const name of [id+'.json',id+'.lock'])assert.deepEqual(await fs.readFile(path.join(stage,'file-transactions',name)),await fs.readFile(path.join(journal,name)));
 assert.equal((await new FileTransactionStore(path.join(stage,'file-transactions')).load(id)).status,'PENDING');
});
test('recovery staging refuses unsafe journal entries and preserves the live evidence',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files'),journal=path.join(live,'file-transactions');
 await fs.mkdir(live,{mode:0o700});await fs.mkdir(journal,{mode:0o700});
 const cases=[['11111111-1111-4111-8111-111111111111.json','corrupt'],['unexpected','evidence']];
 for(const [index,[name,value]] of cases.entries()){
  const file=path.join(journal,name!);await fs.writeFile(file,value!,{mode:0o600});const stage=path.join(f.identity,`.scoped-files.stage-${index}`);await fs.mkdir(stage,{mode:0o700});
  await assert.rejects(installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.stageRecoveryJournal(live,stage,check)));
  assert.equal(await fs.readFile(file,'utf8'),value);await fs.unlink(file);
 }
 const outside=path.join(f.temp,'outside');await fs.writeFile(outside,'untouched');const alias=path.join(journal,'11111111-1111-4111-8111-111111111111.lock');await fs.symlink(outside,alias);
 const stage=path.join(f.identity,'.scoped-files.stage-link');await fs.mkdir(stage,{mode:0o700});
 await assert.rejects(installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.stageRecoveryJournal(live,stage,check)));
 assert.equal(await fs.readFile(outside,'utf8'),'untouched');assert.equal((await fs.lstat(alias)).isSymbolicLink(),true);
});
test('recovery staging creates an empty journal only when history is absent',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files'),stage=path.join(f.identity,'.scoped-files.stage-empty');await fs.mkdir(stage,{mode:0o700});
 await installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.stageRecoveryJournal(live,stage,check));
 assert.deepEqual(await fs.readdir(path.join(stage,'file-transactions')),[]);
});
test('recovery staging refuses a journal appearing while an empty stage is created',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files'),stage=path.join(f.identity,'.scoped-files.stage-race');await fs.mkdir(live,{mode:0o700});await fs.mkdir(stage,{mode:0o700});
 const mkdir=fs.mkdir.bind(fs);let injected=false;
 (fs as any).mkdir=async (...args:any[])=>{const value=await (mkdir as any)(...args);if(args[0]===path.join(stage,'file-transactions')){injected=true;await mkdir(path.join(live,'file-transactions'),{mode:0o700});}return value;};
 try{await assert.rejects(installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.stageRecoveryJournal(live,stage,check)));assert.equal(injected,true);}
 finally{(fs as any).mkdir=mkdir;}
});
test('recovery staging detects replacement of the destination journal',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files'),stage=path.join(f.identity,'.scoped-files.stage-swap'),source=path.join(live,'file-transactions'),destination=path.join(stage,'file-transactions');
 await fs.mkdir(live,{mode:0o700});await fs.mkdir(source,{mode:0o700});await fs.mkdir(stage,{mode:0o700});
 const id='11111111-1111-4111-8111-111111111111';await fs.writeFile(path.join(source,id+'.lock'),'',{mode:0o600});
 const open=fs.open.bind(fs);let injected=false;
 (fs as any).open=async (...args:any[])=>{const handle=await (open as any)(...args);if(args[0]===path.join(destination,id+'.lock')){const close=handle.close.bind(handle);handle.close=async()=>{await close();await fs.rename(destination,destination+'-old');await fs.mkdir(destination,{mode:0o700});injected=true;};}return handle;};
 try{await assert.rejects(installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.stageRecoveryJournal(live,stage,check)));assert.equal(injected,true);assert.equal(await fs.readFile(path.join(source,id+'.lock'),'utf8'),'');}
 finally{(fs as any).open=open;}
});
test('recovery staging detects removal of a staged record before completion',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files'),stage=path.join(f.identity,'.scoped-files.stage-remove'),source=path.join(live,'file-transactions'),destination=path.join(stage,'file-transactions');
 await fs.mkdir(live,{mode:0o700});await fs.mkdir(source,{mode:0o700});await fs.mkdir(stage,{mode:0o700});
 const id='11111111-1111-4111-8111-111111111111',name=id+'.lock';await fs.writeFile(path.join(source,name),'',{mode:0o600});
 const open=fs.open.bind(fs);let injected=false;
 (fs as any).open=async (...args:any[])=>{const handle=await (open as any)(...args);if(args[0]===path.join(destination,name)){const close=handle.close.bind(handle);handle.close=async()=>{await close();await fs.unlink(path.join(destination,name));injected=true;};}return handle;};
 try{await assert.rejects(installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.stageRecoveryJournal(live,stage,check)));assert.equal(injected,true);}
 finally{(fs as any).open=open;}
});
test('recovery journal evidence is revalidated immediately before publication',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files'),stage=path.join(f.identity,'.scoped-files.stage-recheck'),source=path.join(live,'file-transactions');
 await fs.mkdir(live,{mode:0o700});await fs.mkdir(source,{mode:0o700});await fs.mkdir(stage,{mode:0o700});
 const name='11111111-1111-4111-8111-111111111111.lock';await fs.writeFile(path.join(source,name),'',{mode:0o600});
 await installer.withStoppedMacConnector(f.identity,async(check:any)=>{
  const verify=await installer.stageRecoveryJournal(live,stage,check);await verify();
  await fs.writeFile(path.join(source,'22222222-2222-4222-8222-222222222222.lock'),'');await assert.rejects(verify());
 });
 assert.equal(await fs.readFile(path.join(source,name),'utf8'),'');
});
test('revalidation refuses staged journal tampering after preparation',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files'),stage=path.join(f.identity,'.scoped-files.stage-recheck'),source=path.join(live,'file-transactions');
 await fs.mkdir(live,{mode:0o700});await fs.mkdir(source,{mode:0o700});await fs.mkdir(stage,{mode:0o700});const name='11111111-1111-4111-8111-111111111111.lock';await fs.writeFile(path.join(source,name),'',{mode:0o600});
 await installer.withStoppedMacConnector(f.identity,async(check:any)=>{const verify=await installer.stageRecoveryJournal(live,stage,check);await fs.unlink(path.join(stage,'file-transactions',name));await assert.rejects(verify());});
});
test('recovery journal staging detects an entry added during final destination enumeration',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files'),stage=path.join(f.identity,'.scoped-files.stage-final-race'),source=path.join(live,'file-transactions'),destination=path.join(stage,'file-transactions');
 await fs.mkdir(live,{mode:0o700});await fs.mkdir(source,{mode:0o700});await fs.mkdir(stage,{mode:0o700});await fs.writeFile(path.join(source,'11111111-1111-4111-8111-111111111111.lock'),'',{mode:0o600});
 const opendir=fs.opendir.bind(fs),lstat=fs.lstat.bind(fs);let injected=false,observedDestination=false;
 (fs as any).opendir=async (...args:any[])=>{const dir=await (opendir as any)(...args);if(args[0]===destination)observedDestination=true;return dir;};
 (fs as any).lstat=async (...args:any[])=>{const result=await (lstat as any)(...args);if(args[0]===source&&args[1]?.bigint&&observedDestination&&!injected){await fs.writeFile(path.join(destination,'22222222-2222-4222-8222-222222222222.lock'),'');injected=true;}return result;};
 try{await assert.rejects(installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.stageRecoveryJournal(live,stage,check)));assert.equal(injected,true);}
 finally{(fs as any).opendir=opendir;(fs as any).lstat=lstat;}
});
test('empty recovery journal revalidation rejects source appearing during destination read',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files'),stage=path.join(f.identity,'.scoped-files.stage-empty-race'),destination=path.join(stage,'file-transactions');
 await fs.mkdir(live,{mode:0o700});await fs.mkdir(stage,{mode:0o700});const opendir=fs.opendir.bind(fs);let injected=false;
 (fs as any).opendir=async (...args:any[])=>{const dir=await (opendir as any)(...args);if(args[0]===destination&&!injected){const close=dir.close.bind(dir);dir.close=async()=>{await close();await fs.mkdir(path.join(live,'file-transactions'),{mode:0o700});injected=true;};}return dir;};
 try{await assert.rejects(installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.stageRecoveryJournal(live,stage,check)));assert.equal(injected,true);}
 finally{(fs as any).opendir=opendir;}
});
async function fixture(t:any,cleanupGuard?:{safe:boolean}){const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-scoped-installer-')));t.after(async()=>{if(cleanupGuard&&!cleanupGuard.safe)throw Error(`Fixture cleanup blocked: owned process group not confirmed stopped; retained ${temp}`);await fs.rm(temp,{recursive:true,force:true});});const identity=path.join(temp,'identity'),workspace=path.join(temp,'workspace');await fs.mkdir(workspace,{mode:0o700});await enrollRolesTrustedBatch([{id:'work',root:workspace,role:'workspace'}],identity);return {identity,workspace,temp};}
test('recovery root validation accepts a private same-volume root and rejects overlap',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),registry=await loadTrustedRegistry(f.identity),root=path.join(f.temp,'recovery'),stage=path.join(f.identity,'.scoped-files.stage-test');
 await fs.mkdir(root,{mode:0o700});await fs.mkdir(stage,{mode:0o700});
 const result=await installer.validateRecoveryRoot(registry,'work',root,stage);const stat=await fs.stat(root,{bigint:true});
 assert.deepEqual(result,{device:String(stat.dev),inode:String(stat.ino)});
 await assert.rejects(installer.validateRecoveryRoot(registry,'work',f.workspace,stage));
 await assert.rejects(installer.validateRecoveryRoot(registry,'work',f.identity,stage));
 const link=path.join(f.temp,'alias');await fs.symlink(root,link);await assert.rejects(installer.validateRecoveryRoot(registry,'work',link,stage));
});
test('recovery root validation rejects selected root replacement during validation',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),registry=await loadTrustedRegistry(f.identity),root=path.join(f.temp,'recovery'),stage=path.join(f.identity,'.scoped-files.stage-test');
 await fs.mkdir(root,{mode:0o700});await fs.mkdir(stage,{mode:0o700});const lstat=fs.lstat.bind(fs);let injected=false;
 (fs as any).lstat=async (...args:any[])=>{const result=await (lstat as any)(...args);if(args[0]===f.workspace&&!injected){injected=true;await fs.rename(f.workspace,f.workspace+'-old');await fs.mkdir(f.workspace,{mode:0o700});}return result;};
 try{await assert.rejects(installer.validateRecoveryRoot(registry,'work',root,stage));assert.equal(injected,true);}
 finally{(fs as any).lstat=lstat;}
});
test('recovery bundle binds qualified binary and both selected root identities',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),registry=await loadTrustedRegistry(f.identity),entry=registry.list()[0]!,stage=path.join(f.identity,'.scoped-files.stage-test'),recovery=path.join(f.temp,'recovery');
 await fs.mkdir(stage,{mode:0o700});await fs.mkdir(path.join(stage,'work'),{mode:0o700});await fs.mkdir(recovery,{mode:0o700});
 const source=path.join(f.temp,'fixture.c'),binary=path.join(f.temp,'release'),stripped=path.join(f.temp,'stripped');await fs.writeFile(source,'int main(void) { return 0; }\n');
 execFileSync('/usr/bin/xcrun',['clang',source,'-o',binary]);await fs.copyFile(binary,stripped);execFileSync('/usr/bin/codesign',['--remove-signature',stripped],{stdio:'ignore'});
 const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
 const qualified={release_sha256:hash(await fs.readFile(binary)),code_sha256:hash(normalizedStrippedMacFileCode(await fs.readFile(stripped)))};
 const grant={id:entry.id,role:entry.role,root:entry.canonicalRoot,rootIdentity:entry.rootIdentity,revision:entry.revision};
 const result=await installer.buildMacRecoveryBundle(stage,grant,recovery,await fs.readFile(binary),qualified);
 const r=await fs.stat(recovery,{bigint:true});assert.equal(result.code_sha256,qualified.code_sha256);assert.deepEqual(result.rootIdentity,{device:String(r.dev),inode:String(r.ino)});
 assert.equal(Object.keys(result.artifacts).length,3);assert.equal(result.artifacts['Contents/MacOS/recovery-broker'],hash(await fs.readFile(path.join(stage,'work/RecoveryBroker.app/Contents/MacOS/recovery-broker'))));
});
test('recovery bundle refuses an altered release or reference grant before creating artifacts',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),registry=await loadTrustedRegistry(f.identity),entry=registry.list()[0]!,stage=path.join(f.identity,'.scoped-files.stage-test'),recovery=path.join(f.temp,'recovery');
 await fs.mkdir(stage,{mode:0o700});await fs.mkdir(path.join(stage,'work'),{mode:0o700});await fs.mkdir(recovery,{mode:0o700});
 const grant={id:entry.id,role:entry.role,root:entry.canonicalRoot,rootIdentity:entry.rootIdentity,revision:entry.revision},qualified={release_sha256:'a'.repeat(64),code_sha256:'b'.repeat(64)};
 await assert.rejects(installer.buildMacRecoveryBundle(stage,grant,recovery,Buffer.from('changed'),qualified));
 await assert.rejects(installer.buildMacRecoveryBundle(stage,{...grant,role:'reference'},recovery,Buffer.from('changed'),qualified));
 assert.deepEqual(await fs.readdir(path.join(stage,'work')),[]);
});
test('recovery bundle refuses a workspace replacement before signing',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),registry=await loadTrustedRegistry(f.identity),entry=registry.list()[0]!,stage=path.join(f.identity,'.scoped-files.stage-test'),recovery=path.join(f.temp,'recovery');
 await fs.mkdir(stage,{mode:0o700});await fs.mkdir(path.join(stage,'work'),{mode:0o700});await fs.mkdir(recovery,{mode:0o700});
 const grant={id:entry.id,role:entry.role,root:entry.canonicalRoot,rootIdentity:entry.rootIdentity,revision:entry.revision},bytes=Buffer.from('synthetic'),qualified={release_sha256:createHash('sha256').update(bytes).digest('hex'),code_sha256:'b'.repeat(64)};
 const write=fs.writeFile.bind(fs);let injected=false;
 (fs as any).writeFile=async (...args:any[])=>{const result=await (write as any)(...args);if(String(args[0]).endsWith('/Contents/MacOS/recovery-broker')){injected=true;await fs.rename(f.workspace,f.workspace+'-old');await fs.mkdir(f.workspace,{mode:0o700});}return result;};
 try{await assert.rejects(installer.buildMacRecoveryBundle(stage,grant,recovery,bytes,qualified));assert.equal(injected,true);await assert.rejects(fs.stat(path.join(stage,'work/RecoveryBroker.app/Contents/_CodeSignature')),{code:'ENOENT'});}
 finally{(fs as any).writeFile=write;}
});
test('nonempty recovery roots require a matching authenticated existing binding',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),registry=await loadTrustedRegistry(f.identity),entry=registry.list()[0]!,root=path.join(f.temp,'recovery'),live=path.join(f.identity,'scoped-files');
 await fs.mkdir(root,{mode:0o700});await fs.writeFile(path.join(root,'capture'),'retained');await fs.mkdir(live,{mode:0o700});
 const stat=await fs.stat(root,{bigint:true}),rootIdentity={device:String(stat.dev),inode:String(stat.ino)},grant={id:entry.id,role:entry.role,root:entry.canonicalRoot,rootIdentity:entry.rootIdentity,revision:entry.revision};
 const qualification=await fs.readFile(new URL('../../test/fixtures/mac27-recovery-qualification.json',import.meta.url),'utf8'),recoveryBuild=JSON.parse(qualification).builds.production;
 if(recoveryBuild.hostRelease!==os.release()||recoveryBuild.arch!==process.arch){t.skip('Mac27 recovery qualification is host-bound; cannot replay on this runner');return;}
 const evidence=receiptSample(os.release(),process.arch),key=Buffer.alloc(32,19);
 const proof:any={format:'gsa-scoped-files-v2',hostRelease:os.release(),arch:process.arch,build:evidence.build,evidence,recoveryQualification:qualification,recoveryBuild,grants:[{...grant,recovery:{root,rootIdentity,code_sha256:recoveryBuild.code_sha256}}]};
 await fs.writeFile(path.join(live,'proof-key'),key,{mode:0o600});const save=async()=>{const body=JSON.stringify(proof);await fs.writeFile(path.join(live,'install.json'),JSON.stringify({body,hmac:createHmac('sha256',key).update(body).digest('hex')}),{mode:0o600});};
 await save();await installer.requireRecoveryRootOwnership(live,grant,root,rootIdentity);
 proof.grants[0].revision++;await save();await assert.rejects(installer.requireRecoveryRootOwnership(live,grant,root,rootIdentity));
 proof.grants[0].revision--;proof.grants[0].recovery.rootIdentity={...rootIdentity,inode:'0'};await save();await assert.rejects(installer.requireRecoveryRootOwnership(live,grant,root,rootIdentity));
 proof.grants[0].recovery.rootIdentity={...rootIdentity};await save();const envelope=JSON.parse(await fs.readFile(path.join(live,'install.json'),'utf8'));envelope.hmac='0'.repeat(64);await fs.writeFile(path.join(live,'install.json'),JSON.stringify(envelope),{mode:0o600});
 await assert.rejects(installer.requireRecoveryRootOwnership(live,grant,root,rootIdentity));
 assert.equal(await fs.readFile(path.join(root,'capture'),'utf8'),'retained');
});
test('recovery root preparation uses the current workspace revision and refuses unbound occupied roots',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),registry=await loadTrustedRegistry(f.identity),stage=path.join(f.identity,'.scoped-files.stage-test');await fs.mkdir(stage,{mode:0o700});
 const selected=registry.list()[0]!;let prepared:any;
 await installer.withStoppedMacConnector(f.identity,async(check:any)=>{prepared=await installer.prepareRecoveryRoots(registry,f.identity,stage,{},check);});
 assert.equal(prepared.length,1);assert.equal(prepared[0].root,path.join(f.identity,'file-recovery',`work-r${selected.revision}`));assert.deepEqual(await fs.readdir(prepared[0].root),[]);
 await fs.writeFile(path.join(prepared[0].root,'capture'),'retained');
 await assert.rejects(installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.prepareRecoveryRoots(registry,f.identity,stage,{},check)));
 assert.equal(await fs.readFile(path.join(prepared[0].root,'capture'),'utf8'),'retained');
 await assert.rejects(installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.prepareRecoveryRoots(registry,f.identity,stage,{unknown:f.workspace},check)));
});
test('recovery root preparation detects captures appearing after an empty observation',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),registry=await loadTrustedRegistry(f.identity),stage=path.join(f.identity,'.scoped-files.stage-test'),root=path.join(f.temp,'recovery');await fs.mkdir(stage,{mode:0o700});await fs.mkdir(root,{mode:0o700});
 const opendir=fs.opendir.bind(fs);let injected=false;
 (fs as any).opendir=async (...args:any[])=>{const dir=await (opendir as any)(...args);if(args[0]===root&&!injected){const close=dir.close.bind(dir);dir.close=async()=>{await close();await fs.writeFile(path.join(root,'capture'),'new evidence');injected=true;};}return dir;};
 try{await assert.rejects(installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.prepareRecoveryRoots(registry,f.identity,stage,{work:root},check)));assert.equal(injected,true);assert.equal(await fs.readFile(path.join(root,'capture'),'utf8'),'new evidence');}
 finally{(fs as any).opendir=opendir;}
});
test('recovery root preparation detects a capture created during the final occupancy check',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),registry=await loadTrustedRegistry(f.identity),stage=path.join(f.identity,'.scoped-files.stage-test'),root=path.join(f.temp,'recovery');await fs.mkdir(stage,{mode:0o700});await fs.mkdir(root,{mode:0o700});
 const opendir=fs.opendir.bind(fs);let closes=0,injected=false;
 (fs as any).opendir=async (...args:any[])=>{const dir=await (opendir as any)(...args);if(args[0]===root){const close=dir.close.bind(dir);dir.close=async()=>{await close();if(++closes===2){await fs.writeFile(path.join(root,'capture'),'new evidence');injected=true;}};}return dir;};
 try{await assert.rejects(installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.prepareRecoveryRoots(registry,f.identity,stage,{work:root},check)));assert.equal(injected,true);}
 finally{(fs as any).opendir=opendir;}
});
test('recovery root preparation rejects overlapping recovery roots across workspaces',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),stage=path.join(f.identity,'.scoped-files.stage-test'),peer=path.join(f.temp,'peer'),root=path.join(f.temp,'recovery'),nested=path.join(root,'nested');
 await fs.mkdir(stage,{mode:0o700});await fs.mkdir(peer,{mode:0o700});await fs.mkdir(root,{mode:0o700});await fs.mkdir(nested,{mode:0o700});
 await enrollRolesTrustedBatch([{id:'peer',root:peer,role:'workspace'}],f.identity);const registry=await loadTrustedRegistry(f.identity);
 await assert.rejects(installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.prepareRecoveryRoots(registry,f.identity,stage,{work:root,peer:nested},check)));
});
test('recovery root preparation rejects a stale moved workspace before creating its default root',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),registry=await loadTrustedRegistry(f.identity),stage=path.join(f.identity,'.scoped-files.stage-test'),parent=path.join(f.identity,'file-recovery');await fs.mkdir(stage,{mode:0o700});
 await fs.rename(f.workspace,parent);await fs.mkdir(f.workspace,{mode:0o700});
 await assert.rejects(installer.withStoppedMacConnector(f.identity,async(check:any)=>installer.prepareRecoveryRoots(registry,f.identity,stage,{},check)));
 assert.deepEqual(await fs.readdir(parent),[]);
});
test('installer inspect uses selected durable roots and does not create an installation',async t=>{const f=await fixture(t);const installer=await import(moduleUrl);const before=(await fs.readdir(f.identity)).sort();const report=await installer.inspectMacScopedFiles(f.identity);assert.equal(report.state,'SCOPED_FILES_PLAN');assert.equal(report.grants.length,1);assert.equal(report.grants[0].id,'work');assert.equal(report.grants[0].root,f.workspace);assert.deepEqual((await fs.readdir(f.identity)).sort(),before);});
test('installer holds owner fencing throughout the supplied publication operation',async t=>{const f=await fixture(t);const installer=await import(moduleUrl);let attempted=false;await installer.withStoppedMacConnector(f.identity,async()=>{const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn('/usr/bin/python3',['-c','import os,fcntl,sys\nf=os.open(sys.argv[1],os.O_RDWR|os.O_NOFOLLOW)\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(75)\nsys.exit(0)',path.join(f.identity,'server-owner.lock')],{stdio:'ignore'});child.on('error',reject);child.on('close',resolve);});assert.equal(code,75);attempted=true;});assert(attempted);});
test('the flock owner atomically publishes one pinned staged directory and retains the old tree',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),stage=path.join(f.identity,'.scoped-files.stage-12345678-1234-4123-8123-123456789abc'),live=path.join(f.identity,'scoped-files');
 await fs.mkdir(stage,{mode:0o700});await fs.mkdir(live,{mode:0o700});await fs.writeFile(path.join(stage,'new'),'new');await fs.writeFile(path.join(live,'old'),'old');
 const pin=async(p:string)=>{const s=await fs.lstat(p,{bigint:true});return {device:String(s.dev),inode:String(s.ino)};};
 const staged=await pin(stage),old=await pin(live);
 await installer.withStoppedMacConnector(f.identity,async(_check:any,publish:any)=>{
  await publish(path.basename(stage),staged,old);
  assert.deepEqual(await pin(live),staged);assert.deepEqual(await pin(stage),old);
  const locked=await new Promise<number|null>((resolve,reject)=>{const child=spawn('/usr/bin/python3',['-c','import os,fcntl,sys\nf=os.open(sys.argv[1],os.O_RDWR|os.O_NOFOLLOW)\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(75)\nsys.exit(0)',path.join(f.identity,'server-owner.lock')],{stdio:'ignore'});child.on('error',reject);child.on('close',resolve);});
  assert.equal(locked,75,'owner must retain flock after the publication acknowledgment');
  await assert.rejects(publish(path.basename(stage),old,staged));
 });
 assert.equal(await fs.readFile(path.join(live,'new'),'utf8'),'new');assert.equal(await fs.readFile(path.join(stage,'old'),'utf8'),'old');
});
test('publication rejects a stale stage pin without changing either directory',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),stage=path.join(f.identity,'.scoped-files.stage-12345678-1234-4123-8123-123456789abc'),live=path.join(f.identity,'scoped-files');
 await fs.mkdir(stage,{mode:0o700});await fs.mkdir(live,{mode:0o700});await fs.writeFile(path.join(live,'old'),'old');
 const s=await fs.lstat(live,{bigint:true}),old={device:String(s.dev),inode:String(s.ino)};
 await installer.withStoppedMacConnector(f.identity,async(_check:any,publish:any)=>{
  await assert.rejects(publish(path.basename(stage),{device:'0',inode:'0'},old),(e:any)=>e.code==='RESULT_UNKNOWN');
 });
 assert.equal(await fs.readFile(path.join(live,'old'),'utf8'),'old');assert.equal((await fs.stat(stage)).isDirectory(),true);
});
test('the owner publishes a first installation without replacing an existing name',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),stage=path.join(f.identity,'.scoped-files.stage-12345678-1234-4123-8123-123456789abc');
 await fs.mkdir(stage,{mode:0o700});const s=await fs.stat(stage,{bigint:true});
 await installer.withStoppedMacConnector(f.identity,async(_check:any,publish:any)=>publish(path.basename(stage),{device:String(s.dev),inode:String(s.ino)},null));
 const current=await fs.stat(path.join(f.identity,'scoped-files'),{bigint:true});assert.equal(current.ino,s.ino);assert.equal(current.dev,s.dev);
});
test('loss of the owner after publication never reports success',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),stage=path.join(f.identity,'.scoped-files.stage-12345678-1234-4123-8123-123456789abc');
 await fs.mkdir(stage,{mode:0o700});const s=await fs.stat(stage,{bigint:true});
 await assert.rejects(installer.withStoppedMacConnector(f.identity,async(_check:any,publish:any)=>{
  await publish(path.basename(stage),{device:String(s.dev),inode:String(s.ino)},null);
  const rows=execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n');
  const matches=rows.map(line=>/^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(m=>m&&Number(m[2])===process.pid&&m[3]!.endsWith(f.identity));
  assert.equal(matches.length,1);process.kill(Number(matches[0]![1]),'SIGKILL');
  await new Promise(resolve=>setTimeout(resolve,100));
 }),(e:any)=>e.code==='RESULT_UNKNOWN');
 assert.equal((await fs.stat(path.join(f.identity,'scoped-files'))).isDirectory(),true);
});
test('loss of the stopped owner before publication cannot move the stage',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),stage=path.join(f.identity,'.scoped-files.stage-12345678-1234-4123-8123-123456789abc');
 await fs.mkdir(stage,{mode:0o700});const s=await fs.stat(stage,{bigint:true});
 await assert.rejects(installer.withStoppedMacConnector(f.identity,async(_check:any,publish:any)=>{
  const rows=execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n');
  const matches=rows.map(line=>/^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(m=>m&&Number(m[2])===process.pid&&m[3]!.endsWith(f.identity));
  assert.equal(matches.length,1);const pid=Number(matches[0]![1]);process.kill(pid,'SIGSTOP');
  const result=publish(path.basename(stage),{device:String(s.dev),inode:String(s.ino)},null);process.kill(pid,'SIGKILL');await result;
 }),(e:any)=>e.code==='RESULT_UNKNOWN');
 assert.equal((await fs.stat(stage)).isDirectory(),true);await assert.rejects(fs.stat(path.join(f.identity,'scoped-files')),{code:'ENOENT'});
});
test('publication refuses a relocated identity parent reached through a symlink',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),stage=path.join(f.identity,'.scoped-files.stage-12345678-1234-4123-8123-123456789abc'),moved=f.temp+'-moved';
 await fs.mkdir(stage,{mode:0o700});const s=await fs.stat(stage,{bigint:true});
 try{
  await installer.withStoppedMacConnector(f.identity,async(_check:any,publish:any)=>{
   await fs.rename(f.temp,moved);await fs.symlink(moved,f.temp);
   await assert.rejects(publish(path.basename(stage),{device:String(s.dev),inode:String(s.ino)},null),(e:any)=>e.code==='RESULT_UNKNOWN');
  });
  await assert.rejects(fs.stat(path.join(f.identity,'scoped-files')),{code:'ENOENT'});assert.equal((await fs.stat(stage)).isDirectory(),true);
 }finally{await fs.unlink(f.temp);await fs.rename(moved,f.temp);}
});
test('publication refuses fabricated check strings and preserves previous installation',async t=>{const f=await fixture(t);const installer=await import(moduleUrl);const old=path.join(f.identity,'scoped-files');await fs.mkdir(old,{mode:0o700});await fs.writeFile(path.join(old,'keep'),'previous',{mode:0o600});await assert.rejects(installer.applyMacScopedFiles(f.identity,{checks:['native-read','ancestor-relocation'],verified:true}),/evidence|fixture|containment/i);assert.equal(await fs.readFile(path.join(old,'keep'),'utf8'),'previous');});
test('publication rejects a fully populated legacy PASS-label proof without raw observations',async()=>{const installer=await import(moduleUrl);const build={};assert.throws(()=>installer.requireMacFileEvidence({format:'gsa-scoped-files-native-evidence-v1',build,signing_profile:installer.signingProfile,fixture:{roots:[{},{}]},release:{installedJourney:'PASS',interiorRelocation:'PASS',outsideCanaries:'PASS'},instrumented:{kind:'DIAGNOSTIC_ONLY'},unresolved:[]},build),/evidence|fixture|containment/i);});
test('legacy installer refuses an existing recovery journal before any publication',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files'),journal=path.join(live,'file-transactions');
 await fs.mkdir(live,{mode:0o700});await fs.mkdir(journal,{mode:0o700});await fs.writeFile(path.join(journal,'retained'), 'fixture',{mode:0o600});
 const before=await fs.readFile(path.join(journal,'retained'));
 assert.equal(typeof installer.assertLegacyBaseSafe,'function');
 await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/recovery|journal/i);
 assert.deepEqual(await fs.readFile(path.join(journal,'retained')),before);
});
test('legacy installer refuses an unverified live installation rather than downgrading it',async t=>{
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files');
 await fs.mkdir(live,{mode:0o700});await fs.writeFile(path.join(live,'install.json'),'not-a-proof',{mode:0o600});
 assert.equal(typeof installer.assertLegacyBaseSafe,'function');
 await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/unsafe|proof|installation/i);
 assert.equal(await fs.readFile(path.join(live,'install.json'),'utf8'),'not-a-proof');
});
test('legacy installation guard accepts valid BASE proof but refuses recovery proof',async t=>{
 const {createHmac}=await import('node:crypto'),{receiptSample}=await import('./helpers/mac-file-evidence-fixture.js');
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files');await fs.mkdir(live,{mode:0o700});
 const {loadTrustedRegistry}=await import('../src/local/grants.js');const grant=(await loadTrustedRegistry(f.identity)).list()[0]!;
 const key=Buffer.alloc(32,12),evidence=receiptSample(os.release(),process.arch),proof:any={format:'gsa-scoped-files-v2',hostRelease:evidence.build.hostRelease,arch:evidence.build.arch,build:evidence.build,evidence,grants:[{...evidence.fixture.roots[0],id:grant.id,root:grant.canonicalRoot,rootIdentity:grant.rootIdentity,role:grant.role,revision:grant.revision}]};
 await fs.writeFile(path.join(live,'proof-key'),key,{mode:0o600});
 const writeProof=async()=>{const body=JSON.stringify(proof),hmac=createHmac('sha256',key).update(body).digest('hex');await fs.writeFile(path.join(live,'install.json'),JSON.stringify({body,hmac}),{mode:0o600});};
 await writeProof();assert.equal(typeof installer.assertLegacyBaseSafe,'function');await installer.assertLegacyBaseSafe(f.identity);
 proof.recoveryQualification='fixture';await writeProof();await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/recovery/i);
 delete proof.recoveryQualification;proof.grants[0].recovery={};await writeProof();await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/recovery/i);
 delete proof.grants[0].recovery;const original=proof.grants;proof.hostRelease='different-host';await writeProof();await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/unsafe|proof|installation/i);
 proof.hostRelease=os.release();proof.grants=[null];await writeProof();await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/unsafe|proof|installation/i);
 proof.grants=original;proof.grants[0].root='/different-root';await writeProof();await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/unsafe|proof|installation/i);
});
test('legacy guard rechecks a journal created while it reads the proof',async t=>{
 const {createHmac}=await import('node:crypto'),{receiptSample}=await import('./helpers/mac-file-evidence-fixture.js'),{loadTrustedRegistry}=await import('../src/local/grants.js');
 const f=await fixture(t),installer=await import(moduleUrl),live=path.join(f.identity,'scoped-files');await fs.mkdir(live,{mode:0o700});
 const grant=(await loadTrustedRegistry(f.identity)).list()[0]!,key=Buffer.alloc(32,12),evidence=receiptSample(os.release(),process.arch);
 const proof={format:'gsa-scoped-files-v2',hostRelease:os.release(),arch:process.arch,build:evidence.build,evidence,grants:[{...evidence.fixture.roots[0],id:grant.id,root:grant.canonicalRoot,rootIdentity:grant.rootIdentity,role:grant.role,revision:grant.revision}]};
 const body=JSON.stringify(proof),hmac=createHmac('sha256',key).update(body).digest('hex');await fs.writeFile(path.join(live,'proof-key'),key,{mode:0o600});await fs.writeFile(path.join(live,'install.json'),JSON.stringify({body,hmac}),{mode:0o600});
 const open=fs.open;let injected=false;
 (fs as any).open=async (...args:any[])=>{if(!injected&&args[0]===path.join(live,'proof-key')){injected=true;await fs.mkdir(path.join(live,'file-transactions'),{mode:0o700});}return (open as any)(...args);};
 try{await assert.rejects(installer.assertLegacyBaseSafe(f.identity),/journal/i);assert.equal(injected,true);}
 finally{(fs as any).open=open;}
});
