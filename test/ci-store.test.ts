import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createQueuedRun,transitionRun} from "../src/core/ci-journal.js";
import {CiJournalStore} from "../src/local/ci-store.js";
import {CiSnapshotStore} from "../src/local/ci-snapshot-store.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {createReadOnlyTools} from "../src/mcp/server.js";
test("CI journal persists revisions and rejects stale updates",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-ci-store-"));
 try{
  const store=new CiJournalStore(path.join(dir,"journal"));
  assert.deepEqual(await store.list(),[]);
  const r=createQueuedRun("ws","check","a".repeat(64));
  await store.save(r,null);
  assert.equal((await store.load(r.run_id)).state,"QUEUED");
  const next=transitionRun(r,"PREPARING",r.revision);
  await store.save(next,1);
  assert.equal((await store.load(r.run_id)).revision,2);
  await assert.rejects(store.save(next,1),(e:any)=>e.code==="RUN_REVISION_CONFLICT");
  assert.deepEqual((await store.list()).map(x=>x.run_id),[r.run_id]);
  await assert.rejects(store.load("../outside"),(e:any)=>e.code==="INVALID_RUN_ID");
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test("CI tool history isolates Workspace IDs",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-ci-mcp-"));
 try {
  const store=new CiJournalStore(path.join(dir,"journal"));
  const a=createQueuedRun("a","build","b".repeat(64));
  await store.save(a,null);
  const reg=new WorkspaceRegistry();
  await reg.enrollTrusted("a",dir,["read"]);await reg.enrollTrusted("b",dir,["read"]);
  const invoke=createReadOnlyTools(reg,null,null,store);
  const items=JSON.parse((await invoke({name:"ci_list_runs",arguments:{workspace_id:"a"}})).content[0].text);
  assert.deepEqual(items.result.map((x:any)=>x.run_id),[a.run_id]);
  const other=JSON.parse((await invoke({name:"ci_list_runs",arguments:{workspace_id:"b"}})).content[0].text);
  assert.deepEqual(other.result,[]);
  const forbidden=await invoke({name:"ci_status",arguments:{workspace_id:"b",run_id:a.run_id}});
  assert.equal(forbidden.isError,true);
  const status=JSON.parse((await invoke({name:"ci_status",arguments:{workspace_id:"a",run_id:a.run_id}})).content[0].text);
  assert.equal(status.result.state,"QUEUED");
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test("crash reconciliation marks unfinished runs UNKNOWN, not PASSED",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-recovery-"));
 try{
  const store=new CiJournalStore(path.join(tmp,"journal"));
  const started=createQueuedRun("w","compile","a".repeat(64));
  await store.save(started,null);
  const preparing=transitionRun(started,"PREPARING",1);
  await store.save(preparing,1);
  const active=transitionRun(preparing,"RUNNING",2);
  await store.save(active,2);
  const report=await store.reconcileInterrupted();
  assert.deepEqual(report.recovered,[started.run_id]);
  const recovered=await store.load(started.run_id);
  assert.equal(recovered.state,"UNKNOWN");assert.equal(recovered.revision,4);
  assert.deepEqual((await store.reconcileInterrupted()).recovered,[]);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test("queued CI can be cancelled, running CI cannot fake cancellation",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"ci-cancel-"));
 try{
  const journal=new CiJournalStore(path.join(tmp,"ci"));
  const queued=createQueuedRun("A","build","c".repeat(64));await journal.save(queued,null);
  const registry=new WorkspaceRegistry();await registry.enrollTrusted("A",tmp,["read","execute"]);await registry.enrollTrusted("B",tmp,["read","execute"]);
  const snapshots=new CiSnapshotStore(path.join(tmp,"snapshots"));
  const invoke=createReadOnlyTools(registry,null,null,journal,null,null,null,snapshots);
  const denied=await invoke({name:"ci_cancel",arguments:{workspace_id:"B",run_id:queued.run_id}});
  assert.equal(denied.isError,true);
  const approved=JSON.parse((await invoke({name:"ci_cancel",arguments:{workspace_id:"A",run_id:queued.run_id}})).content[0].text);
  assert.equal(approved.result.state,"CANCELLED");
  const repeated=await invoke({name:"ci_cancel",arguments:{workspace_id:"A",run_id:queued.run_id}});
  assert.equal(repeated.isError,true);
  const active=createQueuedRun("A","build","d".repeat(64));await journal.save(active,null);
  await journal.save(transitionRun(active,"PREPARING",1),1);
  const notPretended=await invoke({name:"ci_cancel",arguments:{workspace_id:"A",run_id:active.run_id}});
  assert.equal(notPretended.isError,true);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test("legacy failed CI without workflow provenance cannot be prepared for rerun",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"ci-rerun-"));
 try{
  const journal=new CiJournalStore(path.join(tmp,"journal"));
  const snapshots=new CiSnapshotStore(path.join(tmp,"snapshot"));
  const source=[{path:"README.md",bytes:Buffer.from("hello")}];
  const verifiedSource=await snapshots.persist((()=>{const x=createQueuedRun("X","test","a".repeat(64));return x.run_id;})(),source);
  // Bind a run to the exact manifest fingerprint and verified snapshot.
  const start=createQueuedRun("A","test",verifiedSource.source_sha256);
  await journal.save(start,null);
  await snapshots.persist(start.run_id,source);
  const preparing=transitionRun(start,"PREPARING",1);await journal.save(preparing,1);
  const running=transitionRun(preparing,"RUNNING",2);await journal.save(running,2);
  const failed=transitionRun(running,"FAILED",3,undefined,{exit_code:1,artifact_hashes:{}});await journal.save(failed,3);
  const reg=new WorkspaceRegistry();await reg.enrollTrusted("A",tmp,["read","execute"]);
  const invoke=createReadOnlyTools(reg,null,null,journal,null,null,null,snapshots);
  const response=JSON.parse((await invoke({name:"ci_rerun_failed",arguments:{workspace_id:"A",run_id:start.run_id}})).content[0].text);
  assert.equal(response.ok,false);
  assert.equal((await journal.list()).length,1);
  await assert.rejects(journal.prepareRerun(start.run_id,"A",snapshots),/WORKFLOW_PROVENANCE_REQUIRED/);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
