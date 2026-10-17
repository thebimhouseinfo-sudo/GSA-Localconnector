import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {CiJournalStore} from "../src/local/ci-store.js";
import {CiSnapshotStore} from "../src/local/ci-snapshot-store.js";
import {CiRunService,type VerifiedCiExecutor} from "../src/core/ci-run-service.js";
import {CiSourceCaptureService} from "../src/core/ci-source-capture.js";
import {createQueuedRun,transitionRun} from "../src/core/ci-journal.js";
const workflow={name:"test",jobs:[{id:"run",steps:[{id:"step",command:"node",args:["--version"]}]}]};
async function fixture(){
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"ci-service-"));
 const snapshots=new CiSnapshotStore(path.join(tmp,"snaps")),journal=new CiJournalStore(path.join(tmp,"runs"));
 const hostFile=path.join(tmp,"ci.json");await fs.writeFile(hostFile,JSON.stringify(workflow));
 const capture=new CiSourceCaptureService({verified:true,platform:"macos",policy_fingerprint:"test-only",
  capture:async()=>[{path:"ci.json",bytes:await fs.readFile(hostFile)},{path:"README.md",bytes:Buffer.from("original source")}]},snapshots,journal);
 const source=await capture.prepare("A");
 return {tmp,snapshots,journal,hostFile,source,cleanup:()=>fs.rm(tmp,{recursive:true,force:true})};
}
test("CI submit executes captured workflow despite later host changes and persists provenance",async()=>{
 const f=await fixture();
 try{
  await fs.writeFile(f.hostFile,JSON.stringify({...workflow,name:"changed"}));
  let observed="";
  const executor:VerifiedCiExecutor={verified:true,policy_fingerprint:"test-only",execute:async(_run,w)=>{observed=w.name;return {exit_code:0,source_verified:true};}};
  const service=new CiRunService(f.journal,f.snapshots,executor);
  const queued=await service.submit("A","ci.json",f.source.source_run_id);
  await service.settle(queued.run_id);
  const completed=await f.journal.load(queued.run_id);
  assert.equal(observed,"test");assert.equal(completed.state,"PASSED");
  assert.equal(completed.workflow_binding?.path,"ci.json");
  assert.deepEqual(completed.workflow_binding?.document,workflow);
  assert.match(completed.workflow_binding!.sha256,/^[a-f0-9]{64}$/);
  assert.equal(completed.source_run_id,f.source.source_run_id);
  assert.equal((await f.snapshots.verify(queued.run_id)).source_sha256,queued.source_sha256);
 }finally{await f.cleanup();}
});
test("CI service native denial and source ownership cannot create runnable records",async()=>{
 const f=await fixture();
 try{
  await assert.rejects(new CiRunService(f.journal,f.snapshots,null).submit("A","ci.json",f.source.source_run_id),(e:any)=>e.code==="SECURITY_BLOCKED");
  const executor:VerifiedCiExecutor={verified:true,policy_fingerprint:"fake",execute:async()=>({exit_code:0,source_verified:false})};
  const service=new CiRunService(f.journal,f.snapshots,executor);
  await assert.rejects(service.submit("B","ci.json",f.source.source_run_id),/SOURCE_OWNERSHIP_DENIED/);
  assert.equal((await f.journal.list()).length,1);
  const queued=await service.submit("A","ci.json",f.source.source_run_id);await service.settle(queued.run_id);
  assert.equal((await f.journal.load(queued.run_id)).state,"UNKNOWN");
 }finally{await f.cleanup();}
});
test("failed rerun schedules original workflow and source after host workflow deletion",async()=>{
 const f=await fixture();
 try{
  const seen:string[]=[];
  const executor:VerifiedCiExecutor={verified:true,policy_fingerprint:"fake",execute:async(run,w)=>{
   seen.push(JSON.stringify(w));assert.equal((await f.snapshots.verify(run.run_id)).source_sha256,f.source.source_sha256);
   return {exit_code:seen.length===1?1:0,source_verified:true};}};
  const service=new CiRunService(f.journal,f.snapshots,executor);
  const first=await service.submit("A","ci.json",f.source.source_run_id);await service.settle(first.run_id);
  await fs.rm(f.hostFile);
  const second=await service.rerunFailed("A",first.run_id);await service.settle(second.run_id);
  assert.equal(second.rerun_of,first.run_id);assert.notEqual(second.run_id,first.run_id);
  assert.deepEqual(seen,[JSON.stringify(workflow),JSON.stringify(workflow)]);
  assert.equal((await f.journal.load(second.run_id)).state,"PASSED");
  assert.equal((await f.journal.load(first.run_id)).state,"FAILED");
 }finally{await f.cleanup();}
});
test("rerun denies absent backend, wrong owner and legacy workflowless records without queue creation",async()=>{
 const f=await fixture();
 try{
  const executor:VerifiedCiExecutor={verified:true,policy_fingerprint:"fake",execute:async()=>({exit_code:1,source_verified:true})};
  const service=new CiRunService(f.journal,f.snapshots,executor);
  const first=await service.submit("A","ci.json",f.source.source_run_id);await service.settle(first.run_id);
  const count=(await f.journal.list()).length;
  await assert.rejects(new CiRunService(f.journal,f.snapshots,null).rerunFailed("A",first.run_id),(e:any)=>e.code==="SECURITY_BLOCKED");
  await assert.rejects(service.rerunFailed("B",first.run_id),/Run not owned|RUN_NOT_FOUND/);
  assert.equal((await f.journal.list()).length,count);
  const legacy=createQueuedRun("A","old",f.source.source_sha256);
  let state=legacy;
  await f.journal.save(state,null);
  for(const target of ["PREPARING","RUNNING","FAILED"] as const){const next=transitionRun(state,target,state.revision);await f.journal.save(next,state.revision);state=next;}
  assert.equal((await f.journal.load(legacy.run_id)).state,"FAILED");
  await assert.rejects(service.rerunFailed("A",legacy.run_id),/WORKFLOW_PROVENANCE_REQUIRED/);
  assert.equal((await f.journal.list()).length,count+1);
 }finally{await f.cleanup();}
});
test("rerun fails closed on altered source or journal provenance and preserves run count",async()=>{
 const f=await fixture();
 try{
  const executor:VerifiedCiExecutor={verified:true,policy_fingerprint:"fake",execute:async()=>({exit_code:1,source_verified:true})};
  const service=new CiRunService(f.journal,f.snapshots,executor);
  const first=await service.submit("A","ci.json",f.source.source_run_id);await service.settle(first.run_id);
  const stored=await f.journal.load(first.run_id),count=(await f.journal.list()).length;
  // Revisions cannot retarget an existing run to another Workspace or workflow.
  await assert.rejects(f.journal.save({...stored,workspace_id:"B",revision:stored.revision+1},stored.revision),/provenance is immutable/);
  const file=path.join(f.tmp,"snaps",first.run_id,"files","ci.json");
  await fs.chmod(file,0o600);await fs.writeFile(file,JSON.stringify({...workflow,name:"tampered"}));
  await assert.rejects(service.rerunFailed("A",first.run_id),(e:any)=>e.code==="SNAPSHOT_INTEGRITY");
  assert.equal((await f.journal.list()).length,count);
 }finally{await f.cleanup();}
});
test("CI journal records executor artifact hashes and only confirmed cancellation",async()=>{
 const f=await fixture();try{
  const hashes={"execution.json":"a".repeat(64)};
  const executor:VerifiedCiExecutor={verified:true,policy_fingerprint:"fake",execute:async()=>({exit_code:0,source_verified:true,artifact_hashes:hashes})};
  const service=new CiRunService(f.journal,f.snapshots,executor),queued=await service.submit("A","ci.json",f.source.source_run_id);await service.settle(queued.run_id);
  assert.deepEqual((await f.journal.load(queued.run_id)).evidence?.artifact_hashes,hashes);
  const cancelled:VerifiedCiExecutor={verified:true,policy_fingerprint:"fake",execute:async()=>({exit_code:null,source_verified:true,cancelled_verified:true})};
  const other=new CiRunService(f.journal,f.snapshots,cancelled),next=await other.submit("A","ci.json",f.source.source_run_id);await other.settle(next.run_id);
  assert.equal((await f.journal.load(next.run_id)).state,"CANCELLED");
 }finally{await f.cleanup();}
});
test("CI running cancellation requires real native confirmation and retains ownership",async()=>{
 const f=await fixture();let resolve!:(value:{exit_code:number|null;source_verified:boolean;cancelled_verified?:boolean})=>void;
 let entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});let allow=false;
 const executor:VerifiedCiExecutor={verified:true,policy_fingerprint:"fake",execute:async()=>{entered();return new Promise(r=>{resolve=r;});},cancel:async()=>{if(!allow)throw Error("native stop unconfirmed");resolve({exit_code:null,source_verified:true,cancelled_verified:true});return {stopped:true};}};
 try{
  const service=new CiRunService(f.journal,f.snapshots,executor),queued=await service.submit("A","ci.json",f.source.source_run_id);await started;
  await assert.rejects(service.cancel("B",queued.run_id),/owned/);
  await assert.rejects(service.cancel("A",queued.run_id),/unconfirmed/);assert.equal((await f.journal.load(queued.run_id)).state,"RUNNING");
  allow=true;assert.equal((await service.cancel("A",queued.run_id)).state,"CANCELLED");
 }finally{resolve?.({exit_code:null,source_verified:false});await f.cleanup();}
});
test("CI cancellation during snapshot preparation prevents native execution",async()=>{
 const f=await fixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{entered=r;});let nativeCalls=0;
 const executor:VerifiedCiExecutor={verified:true,policy_fingerprint:"fake",execute:async()=>{nativeCalls++;return {exit_code:0,source_verified:true};}};
 try{
  const service=new CiRunService(f.journal,f.snapshots,executor);
  const original=f.snapshots.verify.bind(f.snapshots);let block=false;
  f.snapshots.verify=async id=>{if(block){entered();await gate;}return original(id);};
  const queued=await service.submit("A","ci.json",f.source.source_run_id);block=true;await ready;
  const cancellation=service.cancel("A",queued.run_id);await new Promise(r=>setImmediate(r));release();
  assert.equal((await cancellation).state,"CANCELLED");assert.equal(nativeCalls,0);
 }finally{release?.();await f.cleanup();}
});
