import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {WorkspaceRegistry} from '../dist/src/core/workspace.js';
import {createMacDirectoryCopies} from '../dist/src/hosts/macos-directory-copy.js';
import {directoryManifestDigest} from '../dist/src/core/directory-copy.js';
import {DirectoryCopyStore} from '../dist/src/local/directory-copy-store.js';
import {assertExpectedFixtureCapture,createBudget,ensureUnknownSticky,getPlan,noteLostAcknowledgement,parseBaseResponse,runAcknowledged,limits,serializePlist} from '../scripts/test-mac-directory-copy-destination-native.mjs';
import {createHash} from 'node:crypto';

const hash=b=>createHash('sha256').update(b).digest('hex');
test('destination driver has an inert plan, explicit one-shot gate, and exact budgets',async()=>{
 const plan=getPlan();assert.equal(plan.nativeExecution,false);assert.equal(plan.activation,false);assert.equal(plan.limits.treeCalls,30);assert.equal(plan.limits.baseCalls,16);
 let reserved=0,ran=0;await assert.rejects(runAcknowledged([], {reserve:async()=>reserved++,run:async()=>ran++}),{code:'ACKNOWLEDGEMENT_REQUIRED'});
 await assert.rejects(runAcknowledged(['--run-native','--ack-disposable-destination-v1'],{platform:'linux',arch:'arm64',reserve:async()=>reserved++,run:async()=>ran++}),{code:'APPLE_SILICON_MAC_REQUIRED'});
 assert.equal(reserved,0);assert.equal(ran,0);
 const budget=createBudget();for(let i=0;i<limits.treeCalls;i++)budget.consume('tree');assert.throws(()=>budget.consume('tree'),{code:'DESTINATION_BUDGET_EXHAUSTED'});
 for(let i=0;i<limits.baseCalls;i++)budget.consume('base');assert.throws(()=>budget.consume('base'),{code:'DESTINATION_BUDGET_EXHAUSTED'});
 assert.deepEqual(budget.snapshot(),{treeCalls:30,baseCalls:16,signedBundles:0,baseCompiles:0,treeCompiles:0,observers:0,relocations:0});
});
test('strict base responses preserve ambiguous denial and UNKNOWN never upgrades',()=>{
 assert.deepEqual(parseBaseResponse(Buffer.from('{"ok":true}'),{}),{ok:true});
 assert.throws(()=>parseBaseResponse(Buffer.from('{"ok":false,"error":"ALREADY_EXISTS_OR_DENIED"}'),{}),{code:'ALREADY_EXISTS_OR_DENIED'});
 assert.throws(()=>parseBaseResponse(Buffer.from('{"ok":true,"bytes":"PRIVATE"}'),{}),{code:'BASE_SUCCESS_SHAPE'});
 assert.throws(()=>ensureUnknownSticky({status:'APPLIED'}),{code:'UNKNOWN_NOT_PRESERVED'});
 assert.equal(noteLostAcknowledgement(new Error('ack')).code,'CLIENT_ACK_LOST');
});
test('plist serializer emits entitlement root arrays and fixture parity rejects extra or missing paths',()=>{
 const xml=serializePlist({'com.apple.security.app-sandbox':true,'com.apple.security.temporary-exception.files.absolute-path.read-only':['/private/fixture/root/']});assert.match(xml,/<array><string>\/private\/fixture\/root\/<\/string><\/array>/);
 const bytes=Buffer.from('destination-only fixture payload\n'),entries=[{path:'',kind:'directory'},{path:'empty',kind:'directory'},{path:'nested',kind:'directory'},{path:'nested/payload.txt',kind:'file',size:bytes.length,sha256:hash(bytes)}],observations=entries.map((e,i)=>({path:e.path,kind:e.kind,device:'1',inode:String(i+1),size:e.kind==='file'?e.size:0,mtime_ns:'1',ctime_ns:'2'}));
 const capture=(list=entries,payload=bytes)=>({capture:{manifest:{entries:list,total_bytes:list.filter(e=>e.kind==='file').reduce((n,e)=>n+e.size,0),sha256:directoryManifestDigest(list)},files:list.filter(e=>e.kind==='file').map(e=>({path:e.path,bytes:payload})),observations}});
 assert.equal(assertExpectedFixtureCapture(capture()),true);assert.throws(()=>assertExpectedFixtureCapture(capture([...entries,{path:'unexpected',kind:'file',size:0,sha256:hash(Buffer.alloc(0))}])),{code:'EXPECTED_MANIFEST_MISMATCH'});assert.throws(()=>assertExpectedFixtureCapture(capture(entries.filter(e=>e.path!=='empty'))),{code:'EXPECTED_MANIFEST_MISMATCH'});
});

async function fixture(t){
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'gsa-dest-driver-'));await fs.chmod(root,0o700);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const dirs={reference:path.join(root,'reference'),workspace:path.join(root,'workspace'),destination:path.join(root,'destination'),journal:path.join(root,'journal')};
 for(const d of Object.values(dirs)){await fs.mkdir(d,{mode:0o700});await fs.chmod(d,0o700);}
 const seed=async root=>{await fs.mkdir(path.join(root,'empty'),{recursive:true});await fs.mkdir(path.join(root,'nested'),{recursive:true});await fs.writeFile(path.join(root,'nested','payload.txt'),Buffer.from('destination-only fixture payload\n'));};await seed(dirs.reference);await fs.mkdir(path.join(dirs.workspace,'from'),{mode:0o700});await seed(path.join(dirs.workspace,'from'));
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:'reference',root:dirs.reference,role:'reference'},{id:'workspace',root:dirs.workspace,role:'workspace'},{id:'destination',root:dirs.destination,role:'workspace'}]);
 let captureCount=0;const capture=async ref=>{captureCount++;const grant=registry.requireGrant(ref.workspace_id,'read'),base=path.resolve(grant.canonicalRoot,ref.path);const entries=[],files=[],observations=[];async function walk(dir,rel=''){const st=await fs.lstat(dir,{bigint:true});entries.push({path:rel,kind:'directory'});observations.push({path:rel,device:String(st.dev),inode:String(st.ino),kind:'directory',size:0,mtime_ns:String(st.mtimeNs),ctime_ns:String(st.ctimeNs)});for(const name of (await fs.readdir(dir)).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))){const child=path.join(dir,name),p=rel?`${rel}/${name}`:name,s=await fs.lstat(child,{bigint:true});if(s.isDirectory())await walk(child,p);else if(s.isFile()){const bytes=await fs.readFile(child);entries.push({path:p,kind:'file',size:bytes.length,sha256:hash(bytes)});files.push({path:p,bytes:new Uint8Array(bytes)});observations.push({path:p,device:String(s.dev),inode:String(s.ino),kind:'file',size:bytes.length,mtime_ns:String(s.mtimeNs),ctime_ns:String(s.ctimeNs)});}}}await walk(base);entries.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));files.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));observations.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));const total_bytes=entries.reduce((n,e)=>n+(e.kind==='file'?e.size:0),0);return {manifest:{format:'gsa-directory-manifest-v1',entries,total_bytes,sha256:directoryManifestDigest(entries)},files,observations};};
 const calls=[];const base={makeDirectory:async ref=>{calls.push('mkdir');const g=registry.requireGrant(ref.workspace_id,'write'),p=path.resolve(g.canonicalRoot,ref.path);await fs.mkdir(p);},createExclusive:async(ref,bytes)=>{calls.push('create');const g=registry.requireGrant(ref.workspace_id,'write'),p=path.resolve(g.canonicalRoot,ref.path);await fs.writeFile(p,bytes,{flag:'wx'});},read:async()=>{throw Error('unexpected read');},replaceIfHash:async()=>{throw Error('unexpected replace');},copyExclusive:async()=>{throw Error('unexpected copy');},moveExclusive:async()=>{throw Error('unexpected move');},trashIfHash:async()=>{throw Error('unexpected trash');}};
 const store=new DirectoryCopyStore(dirs.journal),copies=createMacDirectoryCopies(registry,{capture},base,store,async()=>{});return {dirs,registry,calls,store,copies,capture,base,root,get captureCount(){return captureCount;}};
}
test('actual coordinator applies exact directory contents, restarts, and keeps lost ACK UNKNOWN without replay',async t=>{
 const x=await fixture(t),source={workspace_id:'reference',path:'.'},destination={workspace_id:'destination',path:'copy'},manifest=(await x.capture(source)).manifest;
 const id='127110f0-7a70-4a4a-9d85-c575b30b82d0',applied=await x.copies.copy(id,source,destination,manifest.sha256);assert.equal(applied.status,'APPLIED');
 const target=path.join(x.dirs.destination,'copy');assert.deepEqual(await fs.readFile(path.join(target,'nested','payload.txt')),Buffer.from('destination-only fixture payload\n'));assert.equal((await fs.readdir(path.join(target,'empty'))).length,0);
 const count=x.calls.length,duplicate=await x.copies.copy(id,source,destination,manifest.sha256);assert.equal(duplicate.status,'APPLIED');assert.equal(x.calls.length,count);
 // A fresh store/coordinator can load the durable record without issuing base operations.
 const restartCopies=createMacDirectoryCopies(x.registry,{capture:x.capture},x.base,new DirectoryCopyStore(x.dirs.journal),async()=>{});assert.equal((await restartCopies.readCopy(id)).status,'APPLIED');assert.equal(x.calls.length,count);
 const lostId='227110f0-7a70-4a4a-9d85-c575b30b82d0',lostDest={workspace_id:'destination',path:'lost'};let lose=true;const lostBase={...x.base,createExclusive:async(ref,bytes)=>{await x.base.createExclusive(ref,bytes);if(lose){lose=false;throw noteLostAcknowledgement(Error('synthetic ACK loss'));}}};const lostCopies=createMacDirectoryCopies(x.registry,{capture:x.capture},lostBase,new DirectoryCopyStore(x.dirs.journal),async()=>{});
 const first=ensureUnknownSticky(await lostCopies.copy(lostId,source,lostDest,manifest.sha256));assert.equal(first.status,'UNKNOWN');assert.deepEqual(await fs.readFile(path.join(x.dirs.destination,'lost','nested','payload.txt')),Buffer.from('destination-only fixture payload\n'));
 const workSource={workspace_id:'workspace',path:'from'},workManifest=(await x.capture(workSource)).manifest,workCopy=await x.copies.copy('427110f0-7a70-4a4a-9d85-c575b30b82d0',workSource,{workspace_id:'destination',path:'work-copy'},workManifest.sha256);assert.equal(workCopy.status,'APPLIED');assert.deepEqual(await fs.readFile(path.join(x.dirs.destination,'work-copy','nested','payload.txt')),Buffer.from('destination-only fixture payload\n'));
 const callsAfter=x.calls.length,read=ensureUnknownSticky(await lostCopies.readCopy(lostId));assert.equal(read.readback.status,'MATCH');const again=ensureUnknownSticky(await lostCopies.copy(lostId,source,lostDest,manifest.sha256));assert.equal(again.readback.status,'MATCH');assert.equal(x.calls.length,callsAfter);
 const collisionPath=path.join(x.dirs.destination,'existing');await fs.mkdir(collisionPath,{mode:0o700});const collisionBase={...x.base,makeDirectory:async()=>{throw Object.assign(Error('ALREADY_EXISTS_OR_DENIED'),{code:'ALREADY_EXISTS_OR_DENIED'});}};const collisionCopies=createMacDirectoryCopies(x.registry,{capture:x.capture},collisionBase,new DirectoryCopyStore(x.dirs.journal),async()=>{});
 const collision=await collisionCopies.copy('327110f0-7a70-4a4a-9d85-c575b30b82d0',source,{workspace_id:'destination',path:'existing'},manifest.sha256);assert.equal(collision.status,'UNKNOWN');
 const collisionRetry=await collisionCopies.copy('327110f0-7a70-4a4a-9d85-c575b30b82d0',source,{workspace_id:'destination',path:'existing'},manifest.sha256);assert.equal(collisionRetry.status,'UNKNOWN');assert.ok(x.captureCount<=limits.treeCalls,`actual coordinator read captures ${x.captureCount} times, above native tree budget`);assert.ok(x.calls.length<=limits.baseCalls,`actual coordinator issued ${x.calls.length} base effects, above native base budget`);
});
