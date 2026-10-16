import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createQueuedRun,transitionRun} from "../src/core/ci-journal.js";
import {CiJournalStore} from "../src/local/ci-store.js";
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
