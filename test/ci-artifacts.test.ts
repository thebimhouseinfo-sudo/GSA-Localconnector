import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {CiArtifactStore} from "../src/local/ci-artifacts.js";
import {CiJournalStore} from "../src/local/ci-store.js";
import {createQueuedRun} from "../src/core/ci-journal.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {createReadOnlyTools} from "../src/mcp/server.js";
test("protected CI artifacts return hashes and enforce run Workspace ownership",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-artifacts-"));
 try{
  const store=new CiJournalStore(path.join(tmp,"journals"));
  const artifacts=new CiArtifactStore(path.join(tmp,"artifacts"));
  const r=createQueuedRun("A","build","a".repeat(64));
  await store.save(r,null);
  const meta=await artifacts.ingest(r.run_id,"report.txt",Buffer.from("hello"));
  assert.match(meta.sha256,/^[0-9a-f]{64}$/);
  const reg=new WorkspaceRegistry();
  await reg.enrollTrusted("A",tmp,["read"]);await reg.enrollTrusted("B",tmp,["read"]);
  const call=createReadOnlyTools(reg,null,null,store,artifacts);
  const listed=JSON.parse((await call({name:"ci_artifacts",arguments:{workspace_id:"A",run_id:r.run_id}})).content[0].text);
  assert.equal(listed.result.length,1);
  const fetched=JSON.parse((await call({name:"ci_read_artifact",arguments:{workspace_id:"A",run_id:r.run_id,artifact:"report.txt"}})).content[0].text);
  assert.equal(Buffer.from(fetched.result.base64,"base64").toString(),"hello");
  const denied=await call({name:"ci_read_artifact",arguments:{workspace_id:"B",run_id:r.run_id,artifact:"report.txt"}});
  assert.equal(denied.isError,true);
  await assert.rejects(artifacts.ingest(r.run_id,"../outside",Buffer.from("x")),(e:any)=>e.code==="INVALID_ARTIFACT");
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
