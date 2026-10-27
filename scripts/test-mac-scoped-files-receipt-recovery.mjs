#!/usr/bin/env node
// Recover one saved, authentic relocation receipt into a separate disposable identity.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {enrollRolesTrustedBatch,loadTrustedRegistry,revokeTrusted} from '../dist/src/local/grants.js';
import {ControlLeaseStore} from '../dist/src/local/control-lease.js';
import {withControlToken} from '../dist/src/mcp/control-context.js';
import {authorizeMcpWorkspace} from '../dist/src/mcp/runtime-bootstrap.js';
import {requireMacFileEvidence} from '../dist/src/hosts/macos-file-evidence.js';
import {applyMacScopedFiles} from './install-mac-scoped-files.mjs';

const thisFile=fileURLToPath(import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const ROOT='/private/tmp/gsa-mac-single-probe-WMjZ94';
const ORIGINAL_REPORT=path.resolve('docs/reports/2026-10-22-mac-single-probe-native.jsonl');
const RECOVERY_REPORT=path.resolve('docs/reports/2026-10-22-mac-receipt-recovery-native.jsonl');
function fail(message){throw Error(message)}
async function privateDirectory(p){await fs.mkdir(p,{mode:0o700});await fs.chmod(p,0o700)}
async function identity(p){const s=await fs.stat(p,{bigint:true});return {device:String(s.dev),inode:String(s.ino)}}
async function run(file,args,input='',timeout=30000){return await new Promise((resolve,reject)=>{const child=spawn(file,args,{shell:false,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'}});let out=Buffer.alloc(0),err=Buffer.alloc(0),failure;const timer=setTimeout(()=>{failure=Error('command timeout: '+path.basename(file));child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL')},1000).unref()},timeout);child.stdout.on('data',b=>out=Buffer.concat([out,b]));child.stderr.on('data',b=>err=Buffer.concat([err,b]));child.on('error',e=>failure=e);child.on('close',code=>{clearTimeout(timer);if(failure)reject(failure);else if(code!==0)reject(Error(path.basename(file)+' exit '+code+': '+err.toString().slice(0,1500)));else resolve({stdout:out,stderr:err})});child.stdin.on('error',()=>{});child.stdin.end(input)})}
async function runOwner(identityRoot,mode,env,timeoutMs=90000){return await new Promise((resolve,reject)=>{
 const child=spawn('/usr/bin/python3',[path.resolve('scripts/macos-owner-launcher.py'),'--identity',identityRoot,'--node',process.execPath,'--entry',thisFile],{shell:false,detached:true,stdio:['ignore','pipe','pipe'],env:{...env,GSA_RECEIPT_MODE:mode}}),pgid=child.pid;
 let out=Buffer.alloc(0),err=Buffer.alloc(0),failure,stopping=false;
 const signal=kind=>{if(!Number.isSafeInteger(pgid))return;try{process.kill(-pgid,kind)}catch(e){if(e.code!=='ESRCH')throw e}};
 const exists=()=>{if(!Number.isSafeInteger(pgid))return false;try{process.kill(-pgid,0);return true}catch(e){return e.code!=='ESRCH'}};
 const stop=()=>{try{signal('SIGCONT')}catch{}try{signal('SIGTERM')}catch{}setTimeout(()=>{if(exists())try{signal('SIGKILL')}catch{}},1200).unref()};
 const failStop=message=>{if(!failure)failure=Error(message);if(!stopping){stopping=true;stop()}};
 const timer=setTimeout(()=>failStop('owner mode timeout'),timeoutMs);
 child.stdout.on('data',b=>{out=Buffer.concat([out,b]);if(out.length>1024*1024)failStop('owner stdout exceeds 1 MiB')});
 child.stderr.on('data',b=>{err=Buffer.concat([err,b]);if(err.length>65536)failStop('owner diagnostics exceed 64 KiB')});
 child.on('error',e=>{failure=e;stop()});
 child.on('close',async(code,signalName)=>{clearTimeout(timer);if(exists()){stop();const deadline=Date.now()+3500;while(Date.now()<deadline&&exists())await new Promise(r=>setTimeout(r,50));if(exists()){try{signal('SIGKILL')}catch{}await new Promise(r=>setTimeout(r,500));}}if(exists()){reject(Error('owned owner process group remains after cleanup'));return}if(failure)reject(failure);else if(code!==0)reject(Error('owner exited '+code+' '+signalName+': '+err.toString().slice(0,2500)));else resolve({stdout:out.toString('utf8'),stderr:err.toString('utf8')})});
})}
function bind(g,p,operation,extra={}){return {operation,workspace_id:g.id,role:g.role,root:g.root,device:g.rootIdentity.device,inode:g.rootIdentity.inode,revision:g.revision,path:p,...extra}}
async function candidateJourney(){
 const root=process.env.GSA_RECEIPT_ROOT,identityRoot=process.env.GSA_RECEIPT_IDENTITY,stage=process.env.GSA_RECEIPT_STAGE,rawReceipt=JSON.parse(process.env.GSA_RECEIPT_RELOCATION),canaryPath=process.env.GSA_RECEIPT_CANARY,expectedCanary=process.env.GSA_RECEIPT_CANARY_SHA;
 const proof=JSON.parse((await fs.readFile(path.join(stage,'install.json'),'utf8'))).body,body=JSON.parse(proof);
 const registry=await loadTrustedRegistry(identityRoot),leaseStore=new ControlLeaseStore(identityRoot),lease=await leaseStore.acquire(),authorize=(id,permission)=>authorizeMcpWorkspace(registry,id,identityRoot,permission);
 try{
  assert.equal(sha(await fs.readFile(canaryPath)),expectedCanary,'original outside canary differs before recovery');
  const source=await fs.readFile(new URL('../dist/src/hosts/macos-scoped-files.js',import.meta.url),'utf8'),moduleUrl=new URL('../dist/src/hosts/macos-scoped-files.js',import.meta.url);
  const moduleSource=source.replace('async function constructMacScopedFiles(','export async function constructMacScopedFiles(').replace(/from (["'])(\.[^"']+)\1/g,(_m,q,rel)=>`from ${q}${new URL(rel,moduleUrl).href}${q}`);
  const mod=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
  const io=await mod.constructMacScopedFiles(registry,stage,{ownerLockFD:3,authorize},true),grants=body.grants,work=grants.find(g=>g.role==='workspace'),ref=grants.find(g=>g.role==='reference');
  const uuid=randomUUID(),dir=`receipt-${uuid}`,created=Buffer.from('receipt-recovery-create-'+uuid),refBytes=Buffer.from('receipt-recovery-reference-'+uuid),call=(id,fn)=>withControlToken(leaseStore,lease.control_token,fn);
  await fs.mkdir(path.join(work.root,dir),{mode:0o700});
  const createReq=bind(work,`${dir}/created.bin`,'create',{base64:created.toString('base64')});
  await call(work.id,()=>io.createExclusive({workspace_id:work.id,path:createReq.path},created));
  const readReq=bind(work,createReq.path,'read'),read=await call(work.id,()=>io.read({workspace_id:work.id,path:readReq.path},1024));
  const mkdirPath=`${dir}-mkdir`,mkdirReq=bind(work,mkdirPath,'mkdir');
  await call(work.id,()=>io.makeDirectory({workspace_id:work.id,path:mkdirPath}));const mkdirStat=await fs.stat(path.join(work.root,mkdirPath));
  const refName=`receipt-source-${uuid}.bin`;await fs.writeFile(path.join(ref.root,refName),refBytes,{mode:0o600,flag:'wx'});
  const refReq=bind(ref,refName,'read'),refRead=await call(ref.id,()=>io.read({workspace_id:ref.id,path:refName},1024));
  const copyReq=bind(work,`receipt-copy-${uuid}.bin`,'create',{base64:Buffer.from(refRead.bytes).toString('base64')});
  await call(work.id,()=>io.copyExclusive({workspace_id:ref.id,path:refName},{workspace_id:work.id,path:copyReq.path},refRead.sha256));
  const copyBack=await fs.readFile(path.join(work.root,copyReq.path));
  const collisionPath=`receipt-collision-${uuid}.bin`,collisionBytes=Buffer.from('preserve-'+uuid);await fs.writeFile(path.join(work.root,collisionPath),collisionBytes,{mode:0o600,flag:'wx'});
  const collisionReq=bind(work,collisionPath,'create',{base64:Buffer.from('overwrite-'+uuid).toString('base64')});let collisionError;
  try{await call(work.id,()=>io.createExclusive({workspace_id:work.id,path:collisionPath},Buffer.from('overwrite-'+uuid)));}catch(e){collisionError=String(e.code??e.message)}
  const collisionAfter=await fs.readFile(path.join(work.root,collisionPath));
  const deniedName=`receipt-reference-write-${uuid}.bin`,refDestReq=bind(ref,deniedName,'create',{base64:refBytes.toString('base64')});let refDestError;
  try{await call(ref.id,()=>io.createExclusive({workspace_id:ref.id,path:deniedName},refBytes));}catch(e){refDestError=String(e.code??e.message)}
  const refDestAbsent=await fs.stat(path.join(ref.root,deniedName)).then(()=>false,()=>true);
  const broker=path.join(stage,work.id,'Broker.app/Contents/MacOS/broker'),original=await fs.readFile(broker),mode=(await fs.stat(broker)).mode&0o777,artifactName=`receipt-artifact-${uuid}.bin`,artifactReq=bind(work,artifactName,'create',{base64:Buffer.from('artifact-'+uuid).toString('base64')});let artifactError;
  try{await fs.chmod(broker,0o700);const changed=Buffer.from(original);changed[changed.length-1]^=1;await fs.writeFile(broker,changed);try{await call(work.id,()=>io.createExclusive({workspace_id:work.id,path:artifactName},Buffer.from('artifact-'+uuid)));}catch(e){artifactError=String(e.code??e.message)}}finally{await fs.writeFile(broker,original);await fs.chmod(broker,mode)}
  assert.equal(sha(await fs.readFile(broker)),sha(original),'staged broker restore failed');
  const artifactAbsent=await fs.stat(path.join(work.root,artifactName)).then(()=>false,()=>true);
  const staleName=`receipt-stale-${uuid}.bin`,staleReq=bind(work,staleName,'create',{base64:Buffer.from('stale-'+uuid).toString('base64')});
  await revokeTrusted(work.id,identityRoot);let staleError;
  try{await call(work.id,()=>io.createExclusive({workspace_id:work.id,path:staleName},Buffer.from('stale-'+uuid)));}catch(e){staleError=String(e.code??e.message)}
  const staleAbsent=await fs.stat(path.join(work.root,staleName)).then(()=>false,()=>true);
  const canaryAfter=sha(await fs.readFile(canaryPath));
  const observations={
   create:{request:createReq,response:{ok:true},expected_sha256:sha(created),readback_sha256:sha(await fs.readFile(path.join(work.root,createReq.path)))},
   read:{request:readReq,response:{ok:true,base64:Buffer.from(read.bytes).toString('base64'),sha256:read.sha256},expected_sha256:sha(created)},
   mkdir:{request:mkdirReq,response:{ok:true},isDirectory:mkdirStat.isDirectory()},
   referenceRead:{request:refReq,response:{ok:true,base64:Buffer.from(refRead.bytes).toString('base64'),sha256:refRead.sha256},expected_sha256:sha(refBytes)},
   copy:{request:copyReq,sourceRequest:refReq,response:{ok:true},expected_sha256:sha(refBytes),readback_sha256:sha(copyBack)},
   collision:{request:collisionReq,error:collisionError,before_sha256:sha(collisionBytes),after_sha256:sha(collisionAfter)},
   referenceDestination:{request:refDestReq,error:refDestError,absent:refDestAbsent},
   staleGrant:{request:staleReq,error:staleError,absent:staleAbsent},
   artifactMismatch:{request:artifactReq,error:artifactError,absent:artifactAbsent},
   outsideCanaries:[{path:canaryPath,before_sha256:expectedCanary,after_sha256:canaryAfter,event_order:['outside_canary_baseline','saved_interior_relocation','candidate_operations_start','candidate_operations_complete','outside_canary_readback']}],
   interiorRelocation:rawReceipt
  };
  const evidence={format:'gsa-scoped-files-native-evidence-v2',signing_profile:'gsa-scoped-files-adhoc-single-root-v1',build:body.build,fixture:{owner_fd:3,hostRelease:body.hostRelease,arch:body.arch,stage,stageIdentity:await identity(stage),roots:grants.map(g=>({id:g.id,root:g.root,rootIdentity:g.rootIdentity,revision:g.revision,role:g.role,artifacts:g.artifacts,presign_sha256:g.presign_sha256,code_sha256:g.code_sha256}))},observations,unresolved:[]};
  console.log(JSON.stringify({status:'CANDIDATE_EVIDENCE_READY',evidence,preValidation:{canary_before:expectedCanary,canary_after:canaryAfter,staleError,staleAbsent}}));
 }finally{await leaseStore.release(lease.control_token)}
}
async function strictJourney(){
 const root=process.env.GSA_RECEIPT_ROOT,identityRoot=process.env.GSA_RECEIPT_IDENTITY,workspace=path.join(root,'workspace'),reference=path.join(root,'reference'),registry=await loadTrustedRegistry(identityRoot),leaseStore=new ControlLeaseStore(identityRoot),lease=await leaseStore.acquire(),authorize=(id,permission)=>authorizeMcpWorkspace(registry,id,identityRoot,permission);
 try{
  const {loadMacScopedFiles}=await import('../dist/src/hosts/macos-scoped-files.js'),io=await loadMacScopedFiles(registry,path.join(identityRoot,'scoped-files'),{ownerLockFD:3,authorize}),work=registry.list().find(g=>g.role==='workspace'),ref=registry.list().find(g=>g.role==='reference');
  assert.ok(work&&ref);const call=(id,fn)=>withControlToken(leaseStore,lease.control_token,fn),uuid=randomUUID(),created=Buffer.from('strict-recovery-create-'+uuid),refBytes=Buffer.from('strict-recovery-reference-'+uuid);
  await call(work.id,()=>io.makeDirectory({workspace_id:work.id,path:'strict'}));const mkdirStat=await fs.stat(path.join(workspace,'strict'));
  await call(work.id,()=>io.createExclusive({workspace_id:work.id,path:'strict/create.bin'},created));const read=await call(work.id,()=>io.read({workspace_id:work.id,path:'strict/create.bin'},1024));
  const sourceName=`strict-source-${uuid}.bin`;await fs.writeFile(path.join(reference,sourceName),refBytes,{mode:0o600,flag:'wx'});const refRead=await call(ref.id,()=>io.read({workspace_id:ref.id,path:sourceName},1024));
  const copyName=`strict-copy-${uuid}.bin`;await call(work.id,()=>io.copyExclusive({workspace_id:ref.id,path:sourceName},{workspace_id:work.id,path:copyName},refRead.sha256));
  const copy=await fs.readFile(path.join(workspace,copyName)),createdReadback=await fs.readFile(path.join(workspace,'strict/create.bin'));
  const checks={mkdir:mkdirStat.isDirectory(),createRead:read.bytes.equals(created)&&sha(read.bytes)===sha(created)&&sha(createdReadback)===sha(created),referenceRead:refRead.bytes.equals(refBytes)&&sha(refRead.bytes)===sha(refBytes),copy:sha(copy)===sha(refBytes)&&sha(copy)===sha(refRead.bytes)};
  assert.ok(Object.values(checks).every(Boolean),'public strict-loader readback assertions failed');
  console.log(JSON.stringify({status:'STRICT_PUBLIC_LOADER_OK',roots:registry.list().map(g=>({id:g.id,root:g.canonicalRoot,role:g.role,revision:g.revision,rootIdentity:g.rootIdentity})),checks,hashes:{create:sha(createdReadback),reference:sha(refRead.bytes),copy:sha(copy)}}));
 }finally{await leaseStore.release(lease.control_token)}
}
async function main(){
 if(process.platform!=='darwin'||process.arch!=='arm64')fail('macOS ARM64 required');
 const mode=process.env.GSA_RECEIPT_MODE;if(mode==='candidate')return candidateJourney();if(mode==='strict')return strictJourney();
 const report=await fs.open(RECOVERY_REPORT,'wx',0o600);let reportBytes=0;const append=async value=>{const line=JSON.stringify(value)+'\n',size=Buffer.byteLength(line);if(reportBytes+size>1024*1024)fail('recovery evidence report exceeds 1 MiB');await report.writeFile(line);await report.sync();reportBytes+=size};
 try{
  await append({status:'STARTED',scope:'saved receipt recovery only',relocationRepeat:false});
  const original=fs.readFile(ORIGINAL_REPORT,'utf8').then(text=>text.trim().split('\n').map(JSON.parse));
  const records=await original,relocationRecord=records.find(x=>x.status==='RELOCATION_RESULT'),receipt=relocationRecord?.relocation?.attempts?.[0];
  if(!receipt||receipt.status!=='OBSERVED')fail('preserved relocation receipt is not an observed receipt');
  const root=ROOT,stage=relocationRecord.relocation.stage,identityRoot=path.join(root,'recovery-identity'),canaryPath=receipt.outsideCanary.path,canarySha=receipt.outsideCanary.before_sha256;
  assert.equal(stage,relocationRecord.relocation.stage);assert.equal(receipt.request.workspace_id,'work');assert.equal(receipt.request.role,'workspace');
  assert.equal(await fs.realpath(root),root);assert.equal(sha(await fs.readFile(canaryPath)),canarySha,'original outside canary no longer matches');
  const manifest=JSON.parse(await fs.readFile(path.join(stage,'install.json'),'utf8')),body=JSON.parse(manifest.body);
  assert.equal(body.build.release_sha256,relocationRecord.relocation.release_sha256);assert.equal(body.build.code_sha256,relocationRecord.relocation.code_sha256);
  assert.equal(body.grants.length,2);assert.deepEqual(body.grants.map(g=>g.id).sort(),['ref','work']);
  for(const g of body.grants){assert.equal(g.root,path.join(root,g.id==='work'?'workspace':'reference'));assert.equal(g.role,g.id==='work'?'workspace':'reference');assert.equal(g.revision,1);assert.deepEqual(await identity(g.root),g.rootIdentity)}
  const originalWork=body.grants.find(g=>g.id==='work');assert.equal(originalWork.root,receipt.request.root);assert.equal(originalWork.rootIdentity.device,receipt.request.device);assert.equal(originalWork.rootIdentity.inode,receipt.request.inode);
  const existed=await fs.stat(identityRoot).then(()=>true,()=>false);if(existed)fail('recovery identity directory already exists; no re-use permitted');await privateDirectory(identityRoot);
  const selected=body.grants.map(g=>({id:g.id,root:g.root,role:g.role})),enrolled=await enrollRolesTrustedBatch(selected,identityRoot);
  assert.equal(enrolled.length,2);
  for(const g of body.grants){const actual=enrolled.find(x=>x.id===g.id)?.grant;assert.ok(actual);assert.equal(actual.canonicalRoot,g.root);assert.equal(actual.role,g.role);assert.equal(actual.revision,g.revision);assert.equal(actual.rootIdentity.device,g.rootIdentity.device);assert.equal(actual.rootIdentity.inode,g.rootIdentity.inode)}
  await append({status:'RECOVERY_FIXTURE_BOUND',root,stage,identityRoot,release_sha256:body.build.release_sha256,code_sha256:body.build.code_sha256,roots:enrolled.map(x=>({id:x.id,root:x.grant.canonicalRoot,role:x.grant.role,revision:x.grant.revision,rootIdentity:x.grant.rootIdentity})),original_receipt:receipt});
  const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp',GSA_RECEIPT_ROOT:root,GSA_RECEIPT_IDENTITY:identityRoot,GSA_RECEIPT_STAGE:stage,GSA_RECEIPT_RELOCATION:JSON.stringify(receipt),GSA_RECEIPT_CANARY:canaryPath,GSA_RECEIPT_CANARY_SHA:canarySha};
  const candidate=await runOwner(identityRoot,'candidate',env);
  await append({status:'FULL_RAW_CANDIDATE_OUTPUT_BEFORE_VALIDATION',stdout:candidate.stdout});
  const candidateRecord=JSON.parse(candidate.stdout.trim().split('\n').at(-1));
  const evidence=candidateRecord.evidence;await append({status:'FULL_EVIDENCE_BEFORE_VALIDATION',evidence,preValidation:candidateRecord.preValidation});
  assert.deepEqual(evidence.observations.interiorRelocation,receipt,'saved actual relocation receipt changed');
  requireMacFileEvidence(evidence,body.build);
  await append({status:'EVIDENCE_VALIDATED'});
  assert.equal((await loadTrustedRegistry(identityRoot)).list().some(g=>g.role==='workspace'),false,'candidate must already have revoked its workspace grant');
  const advanced=await enrollRolesTrustedBatch(selected,identityRoot);
  for(const g of body.grants){const next=advanced.find(x=>x.id===g.id)?.grant;assert.ok(next);assert.equal(next.canonicalRoot,g.root);assert.equal(next.role,g.role);assert.equal(next.rootIdentity.device,g.rootIdentity.device);assert.equal(next.rootIdentity.inode,g.rootIdentity.inode);assert.equal(next.revision,g.revision+(g.role==='workspace'?2:0))}
  const applied=await applyMacScopedFiles(identityRoot,evidence);await append({status:'DISPOSABLE_INSTALL_APPLIED',applied});
  const strict=await runOwner(identityRoot,'strict',env);await append({status:'STRICT_PUBLIC_LOADER_RAW',stdout:strict.stdout});
  const strictRecord=JSON.parse(strict.stdout.trim().split('\n').at(-1));assert.equal(strictRecord.status,'STRICT_PUBLIC_LOADER_OK');
  await append({status:'STRICT_PUBLIC_LOADER_OK',result:strictRecord});console.log(JSON.stringify({status:'STRICT_PUBLIC_LOADER_OK',report:RECOVERY_REPORT,installation:applied.installation}));
 }catch(error){await append({status:'STOPPED_UNVERIFIED',error:String(error?.message??error)});throw error}finally{await report.close()}
}
if(process.argv[1]&&path.resolve(process.argv[1])===thisFile)main().catch(e=>{console.error(String(e?.stack??e));process.exitCode=1});
