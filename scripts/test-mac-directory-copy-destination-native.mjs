#!/usr/bin/env node
// Finite destination-only native evidence. Import and --plan are inert.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {WorkspaceRegistry} from '../dist/src/core/workspace.js';
import {createMacDirectoryCopies} from '../dist/src/hosts/macos-directory-copy.js';
import {DirectoryCopyStore} from '../dist/src/local/directory-copy-store.js';
import {directoryManifestDigest} from '../dist/src/core/directory-copy.js';
import {normalizedStrippedMacFileCode} from '../dist/src/hosts/macos-file-code.js';
import {appendReceipt,assertCaptureMatchesExpected,captureBoundedStream,parseTreeResponse,waitForChildClose} from './test-mac-directory-copy-native.mjs';
import {reserveAttempt} from './mac-recovery-probe-control.mjs';

export const limits=Object.freeze({treeCalls:30,baseCalls:16,bundles:4,baseCompiles:1,commandMs:60000,helperMs:20000,treeOutputBytes:12_582_912,baseOutputBytes:65536,diagnosticBytes:65536,receiptBytes:125_829_120,compilerBytes:268_435_456});
export const sourceTreeSha256='b63fa083b40bc23e0863f401c8aff917b8b2e4ecf2d1739c0e9e5bd255ab352d';
export const sourceBaseSha256='865042b5a685f3af271394e8f65aee799b87844dd8623db1d610741661ebdc50';
export const treeReleaseSha256='560e35152d7fb0f2aca10c38cd10c61b690a31a406c7e3269cfb33962b1ffd62';
export const treeCodeSha256='1245d201ddc251b091cbaf9edd676683f59a3e36bf09143e212516fd1cf47e12';
export const protocol='gsa-directory-capture-response-v1';
const sha=value=>createHash('sha256').update(value).digest('hex'),fail=(code,message=code)=>Object.assign(Error(message),{code});
const fixturePayload=Buffer.from('destination-only fixture payload\n');
const fixtureExpectedFiles=[{path:'nested/payload.txt',bytes:fixturePayload}];
const fixtureExpectedEntries=[{path:'',kind:'directory'},{path:'empty',kind:'directory'},{path:'nested',kind:'directory'},{path:'nested/payload.txt',kind:'file',size:fixturePayload.length,sha256:sha(fixturePayload)}];
export function assertExpectedFixtureCapture(parsed){return assertCaptureMatchesExpected(parsed,fixtureExpectedEntries,fixtureExpectedFiles);}
const here=path.dirname(fileURLToPath(import.meta.url)),script=fileURLToPath(import.meta.url);
const treeSource=path.resolve(here,'../native/macos-files/tree-broker.swift'),baseSource=path.resolve(here,'../native/macos-files/broker.swift');
const preservedTreeBinary='/private/tmp/gsa-directory-native-kkes26/candidate-tree-broker',preservedTreeBuild='/private/tmp/gsa-directory-native-kkes26/build.json';
const reservation=path.resolve(here,'../docs/reports/.mac-directory-destination-v1.attempt.json');
const uid=()=>process.getuid?.();

export function createBudget(){let tree=0,base=0,bundles=0,compiles=0;return Object.freeze({
 consume(kind){const pairs={tree:['tree',limits.treeCalls],base:['base',limits.baseCalls],bundle:['bundles',limits.bundles],baseCompile:['compiles',limits.baseCompiles]},p=pairs[kind];if(!p)throw fail('DESTINATION_SCOPE_INVALID');const [key,max]=p,current={tree,base,bundles,compiles}[key];if(current>=max)throw fail('DESTINATION_BUDGET_EXHAUSTED',`${kind} budget exhausted`);if(kind==='tree')tree++;else if(kind==='base')base++;else if(kind==='bundle')bundles++;else compiles++;return this.snapshot();},
 snapshot(){return Object.freeze({treeCalls:tree,baseCalls:base,signedBundles:bundles,baseCompiles:compiles,treeCompiles:0,observers:0,relocations:0});}
});}
export async function runAcknowledged(argv,{platform=process.platform,arch=process.arch,reserve=async()=>{},run=async()=>{}}={}){
 if(!Array.isArray(argv)||argv.length!==2||argv[0]!=='--run-native'||argv[1]!=='--ack-disposable-destination-v1')throw fail('ACKNOWLEDGEMENT_REQUIRED');
 if(platform!=='darwin'||arch!=='arm64')throw fail('APPLE_SILICON_MAC_REQUIRED');await reserve();return run();
}
export function parseBaseResponse(raw,request){
 const bytes=Buffer.from(raw),text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))throw fail('BASE_RESPONSE_UTF8');let value;try{value=JSON.parse(text);}catch{throw fail('BASE_RESPONSE_JSON');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw fail('BASE_RESPONSE_SHAPE');
 if(value.ok===true){if(!isDeepStrictEqual(Object.keys(value).sort(),['ok']))throw fail('BASE_SUCCESS_SHAPE');return value;}
 if(value.ok===false&&typeof value.error==='string'&&/^[A-Z_]{1,64}$/.test(value.error)&&isDeepStrictEqual(Object.keys(value).sort(),['error','ok']))throw Object.assign(Error(value.error),{code:value.error,request});
 throw fail('BASE_DENIAL_SHAPE');
}
export function noteLostAcknowledgement(error){return Object.assign(Error('Synthetic client acknowledgement loss after successful native create'),{code:'CLIENT_ACK_LOST',cause:error});}
export function ensureUnknownSticky(outcome){if(outcome?.status!=='UNKNOWN')throw fail('UNKNOWN_NOT_PRESERVED');return outcome;}
async function saveReceipt(report,receipt){const bytes=['request','response','stderr'].reduce((n,k)=>n+Buffer.byteLength(receipt[k]??[]),0);if((report.receiptBytes??0)+bytes>limits.receiptBytes)throw fail('DESTINATION_RECEIPT_BUDGET_EXHAUSTED');await appendReceipt(report,receipt);}

export function getPlan(){return Object.freeze({status:'READY_FOR_INDEPENDENT_DRIVER_REVIEW',nativeExecution:false,activation:false,limits:{...limits},reuse:{treeBinary:preservedTreeBinary,treeReleaseSha256,treeCodeSha256,treeSourceSha256:sourceTreeSha256},baseSource,arguments:['-O','-Xlinker','-reproducible'],attemptReservation:reservation,cases:['reference-to-workspace APPLIED exact structure/bytes','workspace-to-workspace APPLIED exact structure/bytes','duplicate and restarted readback without replay','ambiguous existing destination remains UNKNOWN','lost acknowledgement remains UNKNOWN despite matching readback; duplicate does not replay'],command:'node scripts/test-mac-directory-copy-destination-native.mjs --run-native --ack-disposable-destination-v1'});}

export function serializePlist(value){const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');const rows=Object.entries(value).map(([k,v])=>`<key>${esc(k)}</key>${typeof v==='boolean'?`<${v?'true':'false'}/>`:typeof v==='number'?`<integer>${v}</integer>`:Array.isArray(v)?`<array>${v.map(item=>`<string>${esc(item)}</string>`).join('')}</array>`:`<string>${esc(v)}</string>`}`).join('');return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${rows}</dict></plist>\n`;}
async function privateDir(dir){await fs.mkdir(dir,{recursive:true,mode:0o700});await fs.chmod(dir,0o700);const s=await fs.lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid()||(s.mode&0o777)!==0o700||await fs.realpath(dir)!==dir)throw fail('STAGE_UNSAFE');}
async function privateWrite(file,bytes){await fs.writeFile(file,bytes,{mode:0o600,flag:'wx'});}
async function command(exe,args,input='',max=65536,timeoutMs=limits.commandMs,envExtra={}){
 const child=spawn(exe,args,{shell:false,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp',...envExtra},stdio:['pipe','pipe','pipe']});
 let failure,abortResolve;const abort=new Promise(resolve=>abortResolve=resolve),closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 const stop=code=>{if(failure)return;failure=fail(code);abortResolve();try{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');}catch{}};
 const stdout=captureBoundedStream(child.stdout,max,()=>stop('COMMAND_OUTPUT_LIMIT')),stderr=captureBoundedStream(child.stderr,limits.diagnosticBytes,()=>stop('COMMAND_DIAGNOSTIC_LIMIT'));
 child.on('error',error=>{failure=error;abortResolve();});child.stdin.on('error',()=>{});child.stdin.end(input);
 let closedInfo;try{closedInfo=await waitForChildClose(child,closed,{timeoutMs,abortPromise:abort});}catch(error){error.partial={stdout:stdout.bytes,stderr:stderr.bytes};throw error;}
 if(closedInfo.timedOut&&!failure)failure=fail('COMMAND_TIMEOUT');if(failure)throw Object.assign(failure,{partial:{stdout:stdout.bytes,stderr:stderr.bytes}});
 if(closedInfo.code!==0)throw Object.assign(fail('COMMAND_FAILED',`${path.basename(exe)} exited ${closedInfo.code??closedInfo.signal}`),{partial:{stdout:stdout.bytes,stderr:stderr.bytes}});return stdout.bytes;
}
async function nativeCommand(exe,args,input,max,kind,budget,report,ownerFD){
 budget.consume(kind);report.counts=budget.snapshot();const raw=Buffer.from(input),seq=(report.receipts?.length??0)+1;let child,failure,abortResolve;
 const abort=new Promise(resolve=>abortResolve=resolve);try{child=spawn(exe,args,{shell:false,env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'},stdio:['pipe','pipe','pipe',ownerFD]});}catch(error){await saveReceipt(report,{kind:`${kind}-spawn-error`,request:raw,response:Buffer.alloc(0),stderr:Buffer.from(String(error)),closed:true});throw error;}
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal}))),stop=reason=>{failure??=fail(reason);abortResolve();try{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');}catch{}};
 const stdout=captureBoundedStream(child.stdout,max,()=>stop('NATIVE_OUTPUT_LIMIT')),stderr=captureBoundedStream(child.stderr,limits.diagnosticBytes,()=>stop('NATIVE_DIAGNOSTIC_LIMIT'));
 child.on('error',error=>{failure=error;abortResolve();});child.stdin.on('error',()=>{});child.stdin.end(input);let state;
 try{state=await waitForChildClose(child,closed,{timeoutMs:limits.helperMs,abortPromise:abort});}catch(error){await saveReceipt(report,{kind,pid:child.pid??null,request:raw,response:stdout.bytes,stderr:stderr.bytes,closed:false,partial:true});throw error;}
 const out=stdout.bytes,err=stderr.bytes;await saveReceipt(report,{kind,pid:child.pid??null,request:raw,response:out,stderr:err,closed:true,partial:!!failure,exitCode:state.code,signal:state.signal,receiptSequence:seq});
 if(state.timedOut&&!failure)failure=fail('NATIVE_HELPER_TIMEOUT');if(failure)throw failure;if(state.code!==0)throw fail('NATIVE_HELPER_EXIT');return out;
}
function rootIdentity(stat){return {device:String(stat.dev),inode:String(stat.ino)};}
async function enroll(stage){
 const roots={reference:path.join(stage,'roots/reference'),workspace:path.join(stage,'roots/workspace'),destination:path.join(stage,'roots/destination')};
 for(const root of Object.values(roots))await privateDir(root);
 const nested=async root=>{await privateDir(path.join(root,'empty'));await privateDir(path.join(root,'nested'));await privateWrite(path.join(root,'nested','payload.txt'),Buffer.from('destination-only fixture payload\n'));};
 await nested(roots.reference);await privateDir(path.join(roots.workspace,'from'));await nested(path.join(roots.workspace,'from'));
 const canaries=[path.join(stage,'outside/canary.txt'),path.join(stage,'destination-canary.txt')];for(const file of canaries){await privateDir(path.dirname(file));await privateWrite(file,Buffer.from(`outside:${path.basename(path.dirname(file))}\n`));}
 return {roots,canaries};
}
async function digestFile(file){return sha(await fs.readFile(file));}
 async function signBundle(stage,kind,binary,grant,write,budget){
 budget.consume('bundle');const app=path.join(stage,`bundles/${kind}-${grant.id}.app`),contents=path.join(app,'Contents'),macos=path.join(contents,'MacOS');for(const d of [path.dirname(app),app,contents,macos])await privateDir(d);
 const executable=path.join(macos,kind==='tree'?'tree-broker':'broker');await fs.copyFile(binary,executable,fs.constants.COPYFILE_EXCL);await fs.chmod(executable,0o500);
 const info={CFBundleExecutable:path.basename(executable),CFBundleIdentifier:`local.gsa.destination.${kind}.${grant.id}`,CFBundleName:kind==='tree'?'TreeReader':'ScopedFiles',CFBundlePackageType:'APPL',CFBundleVersion:'1',GSAWorkspaceID:grant.id,GSAWorkspaceRole:grant.role,GSAWorkspaceRoot:grant.canonicalRoot,GSARevision:grant.revision,GSADevice:grant.rootIdentity.device,GSAInode:grant.rootIdentity.inode};
 await privateWrite(path.join(contents,'Info.plist'),Buffer.from(serializePlist(info)));
 const key=`com.apple.security.temporary-exception.files.absolute-path.${grant.role==='reference'?'read-only':write?'read-write':'read-only'}`,entitlements={'com.apple.security.app-sandbox':true,[key]:[grant.canonicalRoot+'/']},entFile=path.join(stage,`entitlements-${kind}-${grant.id}.plist`);await privateWrite(entFile,Buffer.from(serializePlist(entitlements)));
 await command('/usr/bin/codesign',['--force','--sign','-','--entitlements',entFile,app]);await command('/usr/bin/codesign',['--verify','--strict',app]);
 const entitlementOutput=(await command('/usr/bin/codesign',['--display','--entitlements',':-',app])).toString('utf8');const json=(await command('/usr/bin/plutil',['-convert','json','-o','-','-'],entitlementOutput)).toString('utf8');if(!isDeepStrictEqual(JSON.parse(json),entitlements))throw fail('SIGNED_ENTITLEMENTS_MISMATCH');
 const unsignedCheck=path.join(stage,`normalized-${kind}-${grant.id}`);await fs.copyFile(executable,unsignedCheck);await fs.chmod(unsignedCheck,0o700);await command('/usr/bin/codesign',['--remove-signature',unsignedCheck]);const normalizedCodeSha256=sha(normalizedStrippedMacFileCode(await fs.readFile(unsignedCheck)));await fs.unlink(unsignedCheck);if(kind==='tree'&&normalizedCodeSha256!==treeCodeSha256)throw fail('SIGNED_TREE_CODE_MISMATCH');
 const artifacts={};for(const file of [`Contents/MacOS/${path.basename(executable)}`,'Contents/Info.plist','Contents/_CodeSignature/CodeResources'])artifacts[file]=await digestFile(path.join(app,file));
 artifacts.normalized_code_sha256=normalizedCodeSha256;
 return {app,binary:executable,grant,artifacts};
}
async function compileBase(stage,report,budget){
 budget.consume('baseCompile');report.counts=budget.snapshot();const compiler=(await command('/usr/bin/xcrun',['--find','swiftc'])).toString('utf8').trim(),sdk=(await command('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'])).toString('utf8').trim(),version=(await command('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-version'])).toString('utf8').trim();
 if(sha(await fs.readFile(baseSource))!==sourceBaseSha256)throw fail('BASE_SOURCE_PIN_MISMATCH');
 const env={HOME:path.join(stage,'compiler-home'),TMPDIR:path.join(stage,'compiler-tmp'),CLANG_MODULE_CACHE_PATH:path.join(stage,'cache/clang'),SWIFT_MODULECACHE_PATH:path.join(stage,'cache/swift')};for(const d of Object.values(env))await privateDir(d);report.compilerEnvironment=env;
 const output=path.join(stage,'candidate-base-broker');await command('/usr/bin/xcrun',['--sdk','macosx','swiftc','-sdk',sdk,'-O','-Xlinker','-reproducible',baseSource,'-o',output],'',1024*1024,limits.commandMs,env);await fs.chmod(output,0o500);
 const uuidText=(await command('/usr/bin/dwarfdump',['--uuid',output])).toString('utf8').trim(),m=/^UUID: ([A-F0-9-]{36}) \(arm64\) /.exec(uuidText);if(!m)throw fail('BASE_RELEASE_UUID_INVALID');
 const check=path.join(stage,'base-code-check');await fs.copyFile(output,check);await fs.chmod(check,0o700);await command('/usr/bin/codesign',['--remove-signature',check]);const code=sha(normalizedStrippedMacFileCode(await fs.readFile(check)));await fs.unlink(check);
 const build={uuid:m[1],source_sha256:sourceBaseSha256,compiler_sha256:sha(await fs.readFile(await fs.realpath(compiler))),compiler_version:(await command(compiler,['--version'])).toString('utf8').trim(),sdk:{path:sdk,version,settings_sha256:sha(await fs.readFile(path.join(sdk,'SDKSettings.json')))},arguments:['-O','-Xlinker','-reproducible'],release_sha256:sha(await fs.readFile(output)),code_sha256:code,hostRelease:os.release(),arch:process.arch};report.baseBuild=build;await privateWrite(path.join(stage,'base-build.json'),Buffer.from(JSON.stringify(build,null,2)));return output;
}
async function prepareTreeCandidate(stage,report){
 const meta=JSON.parse(await fs.readFile(preservedTreeBuild,'utf8')),original=await fs.readFile(preservedTreeBinary);
 if(meta.release_sha256!==treeReleaseSha256||meta.code_sha256!==treeCodeSha256||meta.source_sha256!==sourceTreeSha256||sha(original)!==treeReleaseSha256)throw fail('PRESERVED_TREE_ARTIFACT_MISMATCH');
 const unsigned=path.join(stage,'preserved-tree-unsigned');await fs.copyFile(preservedTreeBinary,unsigned,fs.constants.COPYFILE_EXCL);await fs.chmod(unsigned,0o700);await command('/usr/bin/codesign',['--remove-signature',unsigned]);
 const codeSha256=sha(normalizedStrippedMacFileCode(await fs.readFile(unsigned)));if(codeSha256!==treeCodeSha256)throw fail('PRESERVED_TREE_CODE_MISMATCH');await fs.chmod(unsigned,0o500);
 report.reusedTree={original_path:preservedTreeBinary,original_release_sha256:sha(original),build_metadata:meta,signature_removed_copy:unsigned,unsigned_release_sha256:sha(await fs.readFile(unsigned)),normalized_code_sha256:codeSha256};return unsigned;
}
async function treeCall(binding,pathValue,ownerFD,budget,report,bindings){
 const request={operation:'capture_tree',workspace_id:binding.id,role:binding.role,root:binding.canonicalRoot,device:binding.rootIdentity.device,inode:binding.rootIdentity.inode,revision:binding.revision,path:pathValue};
 const raw=Buffer.from(JSON.stringify(request));const response=await nativeCommand(bindings[binding.id].binary,[],raw,limits.treeOutputBytes,'tree',budget,report,ownerFD);const parsed=parseTreeResponse(response,request);if(binding.id==='reference'&&pathValue==='.'||binding.id==='workspace'&&pathValue==='from')assertExpectedFixtureCapture(parsed);return {manifest:parsed.capture.manifest,files:parsed.capture.files.map(file=>({path:file.path,bytes:new Uint8Array(file.bytes)})),observations:parsed.capture.observations};
}
async function makeAdapter(binding,ownerFD,budget,report,bundle){
 return async(operation,ref,bytes)=>{const request={operation,workspace_id:binding.id,role:binding.role,root:binding.canonicalRoot,device:binding.rootIdentity.device,inode:binding.rootIdentity.inode,revision:binding.revision,path:ref.path,...(operation==='create'?{base64:Buffer.from(bytes).toString('base64')}:{})};
  const raw=Buffer.from(JSON.stringify(request)),response=await nativeCommand(bundle.binary,[],raw,limits.baseOutputBytes,'base',budget,report,ownerFD);return parseBaseResponse(response,request);
 };
}
async function readTreeRaw(binary,binding,pathValue,ownerFD,budget,report){const req={operation:'capture_tree',workspace_id:binding.id,role:binding.role,root:binding.canonicalRoot,device:binding.rootIdentity.device,inode:binding.rootIdentity.inode,revision:binding.revision,path:pathValue};const raw=await nativeCommand(binary,[],Buffer.from(JSON.stringify(req)),limits.treeOutputBytes,'tree',budget,report,ownerFD);return parseTreeResponse(raw,req);}
async function captureSummary(value){return {sha256:value.manifest.sha256,entries:value.manifest.entries.map(e=>({...e})),total_bytes:value.manifest.total_bytes,files:value.files.map(f=>({path:f.path,base64:Buffer.from(f.bytes).toString('base64')}))};}
const canaryRecord=async file=>({path:file,sha256:await digestFile(file)});

async function runNative(){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw fail('APPLE_SILICON_MAC_REQUIRED');
 const stage=await fs.realpath(await fs.mkdtemp('/private/tmp/gsa-directory-destination-'));await fs.chmod(stage,0o700);
 const report={format:'gsa-directory-destination-native-v1',state:'INCONCLUSIVE',activation:false,stage,started_at:new Date().toISOString(),limits:{...limits},counts:{treeCalls:0,baseCalls:0,signedBundles:0,baseCompiles:0,treeCompiles:0,observers:0,relocations:0},receipts:[],receiptBytes:0,cases:[],failures:[],unresolved:[]};
 let owner,budget=createBudget();
 try{
  await privateDir(stage);const fixture=await enroll(stage),before=await Promise.all(fixture.canaries.map(canaryRecord));report.canariesBefore=before;const sourceFiles=[path.join(fixture.roots.reference,'nested/payload.txt'),path.join(fixture.roots.workspace,'from/nested/payload.txt')],sourceBefore=await Promise.all(sourceFiles.map(canaryRecord));report.sourceBefore=sourceBefore;await privateWrite(path.join(stage,'baseline.json'),Buffer.from(JSON.stringify({canariesBefore:before,sourceBefore})));
  const roots={};for(const [id,root] of Object.entries(fixture.roots)){const s=await fs.stat(root,{bigint:true});roots[id]={id,role:id==='reference'?'reference':'workspace',canonicalRoot:root,rootIdentity:rootIdentity(s),revision:1};}
  const treeCandidate=await prepareTreeCandidate(stage,report),baseBinary=await compileBase(stage,report,budget),treeBinaries={};
  for(const id of Object.keys(roots)){const signed=await signBundle(stage,'tree',treeCandidate,roots[id],false,budget);treeBinaries[id]=signed;}
  const baseSigned=await signBundle(stage,'base',baseBinary,roots.destination,true,budget);
  owner=await fs.open(path.join(stage,'fixture-owner.lock'),fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR,0o600);report.bindings=Object.fromEntries(Object.entries(roots).map(([id,b])=>[id,{id:b.id,role:b.role,root:b.canonicalRoot,rootIdentity:b.rootIdentity,revision:b.revision,treeBinary:treeBinaries[id].binary,baseBinary:id==='destination'?baseSigned.binary:null}]));
  const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:'reference',root:roots.reference.canonicalRoot,role:'reference'},{id:'workspace',root:roots.workspace.canonicalRoot,role:'workspace'},{id:'destination',root:roots.destination.canonicalRoot,role:'workspace'}]);
  const registryBindings=Object.fromEntries(registry.list().map(g=>[g.id,g]));
  const reader={capture:async ref=>{const binding=registryBindings[ref.workspace_id];if(!binding)throw fail('UNKNOWN_READER_ROOT');return treeCall(binding,ref.path,owner.fd,budget,report,treeBinaries);}};
  let lostAck=false;const baseCall=await makeAdapter(registryBindings.destination,owner.fd,budget,report,baseSigned);
  const base={makeDirectory:async ref=>baseCall('mkdir',ref),createExclusive:async(ref,data)=>{const response=await baseCall('create',ref,data);if(lostAck){lostAck=false;throw noteLostAcknowledgement();}return response;},read:async()=>{throw fail('UNEXPECTED_BASE_READ');},replaceIfHash:async()=>{throw fail('UNEXPECTED_BASE_REPLACE');},copyExclusive:async()=>{throw fail('UNEXPECTED_BASE_COPY');},moveExclusive:async()=>{throw fail('UNEXPECTED_BASE_MOVE');},trashIfHash:async()=>{throw fail('UNEXPECTED_BASE_TRASH');}};
  const storeRoot=path.join(stage,'journal');await privateDir(storeRoot);const authorize=async()=>{};
  let store=new DirectoryCopyStore(storeRoot),copies=createMacDirectoryCopies(registry,reader,base,store,authorize);
  const verifyExact=async(id,rel)=>{const binding=registryBindings[id],result=await readTreeRaw(treeBinaries[id].binary,binding,rel,owner.fd,budget,report);assertExpectedFixtureCapture(result);return result.capture.manifest.sha256;};
  const refSource={workspace_id:'reference',path:'.'},workSource={workspace_id:'workspace',path:'from'},destRef={workspace_id:'destination',path:'reference-copy'},destWork={workspace_id:'destination',path:'workspace-copy'};
  const refHash=await (async()=>{const r=await reader.capture(refSource);return r.manifest.sha256;})();
  const firstId='ec669c2a-9edf-4ea3-8b8c-1536c1ecfa31',first=await copies.copy(firstId,refSource,destRef,refHash);if(first.status!=='APPLIED')throw fail('REFERENCE_COPY_NOT_APPLIED');await verifyExact('destination',destRef.path);report.cases.push({name:'reference-to-workspace',status:first.status,manifest_sha256:first.manifest_sha256,acknowledged:first.acknowledged});
  const writesAfterFirst=budget.snapshot().baseCalls,duplicate=await copies.copy(firstId,refSource,destRef,refHash);if(duplicate.status!=='APPLIED'||budget.snapshot().baseCalls!==writesAfterFirst)throw fail('DUPLICATE_REPLAYED');report.cases.push({name:'duplicate-id-no-replay',status:duplicate.status,additional_base_calls:0});
  const workspaceHash=(await reader.capture(workSource)).manifest.sha256,second=await copies.copy('2e4f3988-0f14-4b9d-83a7-b404119b46d1',workSource,destWork,workspaceHash);if(second.status!=='APPLIED')throw fail('WORKSPACE_COPY_NOT_APPLIED');await verifyExact('destination',destWork.path);report.cases.push({name:'workspace-to-workspace',status:second.status,manifest_sha256:second.manifest_sha256});
  store=new DirectoryCopyStore(storeRoot);copies=createMacDirectoryCopies(registry,reader,base,store,authorize);const restarted=await copies.readCopy(firstId);if(restarted.status!=='APPLIED'||restarted.readback?.status!=='MATCH')throw fail('RESTART_READBACK_MISMATCH');const writesAfterRestart=budget.snapshot().baseCalls;report.cases.push({name:'new-store-restart-readback',status:restarted.status,readback:restarted.readback.status,additional_base_calls:0});
  const collisionPath=path.join(roots.destination.canonicalRoot,'existing-destination');await privateDir(collisionPath);const collision=await copies.copy('e03c54b2-2cb8-4ebc-a573-30620b3b7e08',refSource,{workspace_id:'destination',path:'existing-destination'},refHash);if(collision.status!=='UNKNOWN')throw fail('AMBIGUOUS_COLLISION_NOT_UNKNOWN');const collisionReplayCount=budget.snapshot().baseCalls;const collisionAgain=await copies.copy('e03c54b2-2cb8-4ebc-a573-30620b3b7e08',refSource,{workspace_id:'destination',path:'existing-destination'},refHash);if(collisionAgain.status!=='UNKNOWN'||budget.snapshot().baseCalls!==collisionReplayCount)throw fail('COLLISION_REPLAYED');report.cases.push({name:'ambiguous-existing-destination',status:collision.status,readback:collisionAgain.readback?.status??null,additional_base_calls:0});
  const lostId='ac63fb6b-98dd-43fb-af21-8c2d59d65fca',lostDest={workspace_id:'destination',path:'lost-ack-copy'};lostAck=true;const lost=ensureUnknownSticky(await copies.copy(lostId,refSource,lostDest,refHash));const lostRead=ensureUnknownSticky(await copies.readCopy(lostId));if(lostRead.readback?.status!=='MATCH')throw fail('LOST_ACK_READBACK_NOT_MATCH');const writesAfterLost=budget.snapshot().baseCalls,lostDuplicate=ensureUnknownSticky(await copies.copy(lostId,refSource,lostDest,refHash));if(lostDuplicate.readback?.status!=='MATCH'||budget.snapshot().baseCalls!==writesAfterLost)throw fail('LOST_ACK_REPLAYED');await verifyExact('destination',lostDest.path);report.cases.push({name:'lost-ack-sticky-unknown',status:lost.status,readback:lostRead.readback.status,duplicate:lostDuplicate.status,additional_base_calls:0});
  report.finalStoreRoot=storeRoot;report.journalFiles=(await fs.readdir(storeRoot)).filter(name=>name.endsWith('.json'));report.canariesAfter=await Promise.all(fixture.canaries.map(canaryRecord));if(!isDeepStrictEqual(before,report.canariesAfter))throw fail('OUTSIDE_CANARY_CHANGED');report.sourceAfter=await Promise.all(sourceFiles.map(canaryRecord));if(!isDeepStrictEqual(sourceBefore,report.sourceAfter))throw fail('SOURCE_FIXTURE_CHANGED');
  report.counts=budget.snapshot();if(report.counts.treeCalls>limits.treeCalls||report.counts.baseCalls>limits.baseCalls||report.counts.signedBundles!==4||report.counts.baseCompiles!==1)throw fail('DESTINATION_BUDGET_ACCOUNTING');report.state='DESTINATION_NATIVE_SUITE_OBSERVED';report.completed_at=new Date().toISOString();
 }catch(error){const code=error.code??error.message;const partial=error.partial??{};report.failures.push({error:code,partial_stdout_base64:Buffer.from(partial.stdout??[]).toString('base64'),partial_stderr_base64:Buffer.from(partial.stderr??[]).toString('base64')});report.unresolved.push(code);report.state='INCONCLUSIVE';report.completed_at=new Date().toISOString();}
 finally{if(owner)await owner.close().catch(()=>{});report.counts=budget.snapshot();if(report.stage){await privateWrite(path.join(report.stage,'result.json'),Buffer.from(JSON.stringify(report,null,2))).catch(()=>{});console.log(JSON.stringify({state:report.state,stage:report.stage,counts:report.counts,activation:false,unresolved:report.unresolved.length,receipts:report.receipts.length}));}}
 return report;
}
async function main(){const argv=process.argv.slice(2);if(!argv.length||argv.length===1&&argv[0]==='--plan'){console.log(JSON.stringify(getPlan()));return;}const report=await runAcknowledged(argv,{reserve:async()=>reserveAttempt(reservation,{format:'gsa-directory-destination-native-v1',tree_release_sha256:treeReleaseSha256,tree_code_sha256:treeCodeSha256,base_source_sha256:sourceBaseSha256,driver_sha256:sha(await fs.readFile(script)),limits,at:new Date().toISOString(),activation:false}),run:runNative});if(report.state!=='DESTINATION_NATIVE_SUITE_OBSERVED')process.exitCode=1;}
if(process.argv[1]&&path.resolve(process.argv[1])===script)main().catch(error=>{console.error(error.code??error.message);process.exitCode=1;});
