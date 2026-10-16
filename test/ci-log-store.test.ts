import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {CiLogStore} from "../src/local/ci-log-store.js";
import {CiJournalStore} from "../src/local/ci-store.js";
import {createQueuedRun} from "../src/core/ci-journal.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {createReadOnlyTools} from "../src/mcp/server.js";
test("durable CI logs read through owned Workspace and reject cross-workspace access",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-logs-"));
 try {
  const logs=new CiLogStore(path.join(tmp,"logs"));
  const journal=new CiJournalStore(path.join(tmp,"journal"));
  const r=createQueuedRun("A","test","b".repeat(64));await journal.save(r,null);
  await logs.append(r.run_id,1,"stdout","hello");
  await logs.append(r.run_id,2,"stderr","warning");
  assert.equal((await logs.page(r.run_id,0,1)).next_cursor,1);
  const reg=new WorkspaceRegistry();await reg.enrollTrusted("A",tmp,["read"]);await reg.enrollTrusted("B",tmp,["read"]);
  const call=createReadOnlyTools(reg,null,null,journal,null,logs);
  const ok=JSON.parse((await call({name:"ci_logs",arguments:{workspace_id:"A",run_id:r.run_id}})).content[0].text);
  assert.equal(ok.result.entries.length,2);
  assert.equal((await call({name:"ci_logs",arguments:{workspace_id:"B",run_id:r.run_id}})).isError,true);
  await assert.rejects(logs.append(r.run_id,1,"stdout","duplicate"));
  await assert.rejects(logs.page("../secret"),(e:any)=>e.code==="INVALID_RUN_ID");
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
