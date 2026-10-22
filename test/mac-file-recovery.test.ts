import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {test} from "node:test";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {FileTransactionStore} from "../src/local/file-transaction-store.js";
import {createMacFileRecovery,type MacFileRecoveryOptions} from "../src/hosts/macos-file-recovery.js";
const sha=(b:Uint8Array|string)=>createHash("sha256").update(b).digest("hex");
const before=sha("old"),bytes=Buffer.from("new"),ref={workspace_id:"work",path:"file.txt"};
async function fixture(t:any,respond?:(q:Readonly<Record<string,unknown>>)=>unknown|Promise<unknown>){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-recovery-adapter-")));
 const work=path.join(root,"work"),reference=path.join(root,"reference");
 await fs.mkdir(work,{mode:0o700});await fs.mkdir(reference,{mode:0o700});
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:"work",root:work,role:"workspace"},{id:"reference",root:reference,role:"reference"}]);
 const store=new FileTransactionStore(path.join(root,"journal"));const requests:Readonly<Record<string,unknown>>[]=[];const refs:unknown[]=[];
 const options:MacFileRecoveryOptions={registry,store,authorize:async()=>{},invoke:async(r,q)=>{refs.push(r);requests.push(q);assert.equal((await store.load(String(q.transaction_id))).intent.source.workspace_id,"work");return respond?respond(q):applied(q);}};
 return {registry,store,requests,refs,options};
}
function intent(q:Readonly<Record<string,unknown>>){return {protocol:"gsa-file-recovery-v1",transaction_id:q.transaction_id,operation:q.operation,workspace_id:q.workspace_id,revision:q.revision,path:q.path,expected_sha256:q.expected_sha256,after_sha256:q.operation==="trash"?"":sha(Buffer.from(String(q.base64),"base64"))};}
function applied(q:Readonly<Record<string,unknown>>){return {ok:true,protocol:"gsa-file-recovery-v1",transaction_id:q.transaction_id,status:"APPLIED",intent:intent(q),observations:{captured:true,capturedIdentity:{device:"1",inode:"2"},captured_sha256:before,...(q.operation==="trash"?{source_absent:true}:{published:true,destination_present:true,destination_sha256:sha(bytes),publishedIdentity:{device:"1",inode:"3"}})},retained_handles:[q.transaction_id],reason:"VERIFIED_READBACK"};}
for(const operation of ["replace","trash"] as const)test(`${operation}: durable intent precedes exact native request and complete outcome`,async t=>{
 const f=await fixture(t);const io=createMacFileRecovery(f.options);
 const out=operation==="replace"?await io.replaceIfHash(ref,bytes,before):await io.trashIfHash(ref,before);
 assert.equal(out.status,"APPLIED");assert.equal((await f.store.load(out.transaction_id)).status,"APPLIED");
 assert.deepEqual(Object.keys(f.requests[0]!).sort(),["protocol","operation","transaction_id","workspace_id","revision","path","expected_sha256",...(operation==="replace"?["base64"]:[])].sort());
 assert.equal(f.requests.length,1);
});
test("sparse conflict and restored capture preserve nulls without an invented retained handle",async t=>{
 const f=await fixture(t,q=>({...applied(q),status:"CONFLICT",observations:{captured:true,restored_exclusively:true,source_sha256:before},retained_handles:[],reason:"CAPTURE_CONFLICT"}));
 const out=await createMacFileRecovery(f.options).replaceIfHash(ref,bytes,before);
 assert.equal(out.status,"CONFLICT");assert.equal(out.reason,"ENTRY_CONFLICT");assert.equal(out.observations.destination_present,null);assert.deepEqual(out.retained_handles,[]);
});
for(const defect of ["id","intent","hash","type","extra","reason"] as const)test(`malformed ${defect} response becomes UNKNOWN without replay`,async t=>{
 const f=await fixture(t,q=>{const r:any=applied(q);if(defect==="id")r.transaction_id="00000000-0000-0000-0000-000000000000";if(defect==="intent")r.intent.path="other.txt";if(defect==="hash")r.observations.captured_sha256="invalid";if(defect==="type")r.observations.captured="true";if(defect==="extra")r.secret="must not propagate";if(defect==="reason")r.reason="INVENTED_SUCCESS";return r;});
 const out=await createMacFileRecovery(f.options).replaceIfHash(ref,bytes,before);assert.equal(out.status,"UNKNOWN");assert.equal(f.requests.length,1);assert.equal((await f.store.load(out.transaction_id)).status,"UNKNOWN");assert(!JSON.stringify(out).includes("must not propagate"));
});
test("transport loss returns journal-bound UNKNOWN and inspect never repeats mutation",async t=>{
 const f=await fixture(t,()=>{throw Error("lost response");});const io=createMacFileRecovery(f.options);const out=await io.replaceIfHash(ref,bytes,before);
 assert.equal(out.status,"UNKNOWN");const inspected=await io.readTransaction(out.transaction_id);assert.equal(inspected.status,"UNKNOWN");assert.deepEqual(Object.keys(f.requests[1]!).sort(),["protocol","operation","transaction_id"].sort());assert.equal(f.requests[1]!.operation,"inspect");assert.deepEqual(f.refs[1],ref);
});
test("store failure before native effect produces UNKNOWN with zero native calls",async t=>{
 const f=await fixture(t);f.options.store.create=async()=>{throw Error("journal unavailable");};const out=await createMacFileRecovery(f.options).replaceIfHash(ref,bytes,before);assert.equal(out.status,"UNKNOWN");assert.equal(f.requests.length,0);assert.match(out.transaction_id,/^[a-f0-9-]{36}$/);
});
test("store failure after effect preserves observed handles but never reports APPLIED",async t=>{
 const f=await fixture(t);f.options.store.update=async()=>{throw Error("journal acknowledgement lost");};const out=await createMacFileRecovery(f.options).replaceIfHash(ref,bytes,before);assert.equal(out.status,"UNKNOWN");assert.equal(out.observations.published,true);assert.deepEqual(out.retained_handles,[out.transaction_id]);assert.equal(f.requests.length,1);
});
test("reference and revoked grants cannot invoke native mutation",async t=>{
 const f=await fixture(t);const io=createMacFileRecovery(f.options);await assert.rejects(io.trashIfHash({workspace_id:"reference",path:"x"},before));assert.equal(f.requests.length,0);
 let checks=0;const options={...f.options,authorize:async()=>{if(++checks===2)f.registry.revoke("work");}};
 const out=await createMacFileRecovery(options).replaceIfHash(ref,bytes,before);assert.equal(out.status,"UNKNOWN");assert.equal(out.reason,"AUTHORIZATION_CHANGED");assert.equal(f.requests.length,0);
});
test("terminal readback is immutable and requires authorization",async t=>{
 const f=await fixture(t);let denied=false;const io=createMacFileRecovery({...f.options,authorize:async()=>{if(denied)throw Error("revoked controller");}});const out=await io.replaceIfHash(ref,bytes,before);
 assert.deepEqual(await io.readTransaction(out.transaction_id),out);assert.equal(f.requests.length,1);denied=true;await assert.rejects(io.readTransaction(out.transaction_id));assert.equal(f.requests.length,1);
});
test("authorized stale-binding readback is UNKNOWN without native dispatch or terminal rewrite",async t=>{
 const f=await fixture(t);const io=createMacFileRecovery(f.options);const out=await io.replaceIfHash(ref,bytes,before);
 f.registry.revoke("work");const readback=await io.readTransaction(out.transaction_id);
 assert.equal(readback.status,"UNKNOWN");assert.equal(readback.reason,"AUTHORIZATION_CHANGED");assert.deepEqual(readback.retained_handles,out.retained_handles);assert.deepEqual(readback.observations,out.observations);assert.equal(f.requests.length,1);assert.equal((await f.store.load(out.transaction_id)).status,"APPLIED");
});
test("explicit inspect reconciles a lost reply from journal intent without mutation replay",async t=>{
 let original:Readonly<Record<string,unknown>>|undefined;
 const f=await fixture(t,q=>{if(q.operation!=="inspect"){original=q;throw Error("lost acknowledgement");}return applied(original!);});
 const io=createMacFileRecovery(f.options),out=await io.replaceIfHash(ref,bytes,before);assert.equal(out.status,"UNKNOWN");const readback=await io.readTransaction(out.transaction_id);assert.equal(readback.status,"APPLIED");assert.equal(f.requests.length,2);assert.equal(f.requests.filter(q=>q.operation==="replace").length,1);
});
