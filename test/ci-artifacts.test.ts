import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {CiArtifactStore} from "../src/local/ci-artifacts.js";
import {CiJournalStore} from "../src/local/ci-store.js";
import {createQueuedRun,transitionRun} from "../src/core/ci-journal.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {createReadOnlyTools} from "../src/mcp/server.js";
test("protected CI artifacts return hashes and enforce run Workspace ownership",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-artifacts-"));
 try{
  const store=new CiJournalStore(path.join(tmp,"journals"));
  const artifacts=new CiArtifactStore(path.join(tmp,"artifacts"));
  let r=createQueuedRun("A","build","a".repeat(64));
  await store.save(r,null);
  const meta=await artifacts.ingest(r.run_id,"report.txt",Buffer.from("hello"));
  assert.match(meta.sha256,/^[0-9a-f]{64}$/);
  for(const state of ["PREPARING","RUNNING"] as const){r=transitionRun(r,state,r.revision);await store.save(r,r.revision-1);}
  r=transitionRun(r,"PASSED",r.revision,undefined,{exit_code:0,artifact_hashes:{"report.txt":meta.sha256}});await store.save(r,r.revision-1);
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
test('artifact reads reject tampered content and missing run evidence',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-artifact-integrity-'));
 try{
  const store=new CiJournalStore(path.join(tmp,'journals')),artifacts=new CiArtifactStore(path.join(tmp,'artifacts'));
  let run=createQueuedRun('A','build','a'.repeat(64));await store.save(run,null);
  const meta=await artifacts.ingest(run.run_id,'report.txt',Buffer.from('original'));
  const registry=new WorkspaceRegistry();await registry.enrollTrusted('A',tmp,['read']);const call=createReadOnlyTools(registry,null,null,store,artifacts);
  const read=async()=>JSON.parse((await call({name:'ci_read_artifact',arguments:{workspace_id:'A',run_id:run.run_id,artifact:'report.txt'}})).content[0].text);
  const missingEvidence=await read();
  for(const state of ['PREPARING','RUNNING'] as const){run=transitionRun(run,state,run.revision);await store.save(run,run.revision-1);}
  run=transitionRun(run,'PASSED',run.revision,undefined,{exit_code:0,artifact_hashes:{'report.txt':meta.sha256}});await store.save(run,run.revision-1);
  assert.equal(Buffer.from((await read()).result.base64,'base64').toString(),'original');
  await fs.writeFile(path.join(tmp,'artifacts',run.run_id,'report.txt'),'tampered');
  const changed=await read();assert.equal(changed.ok,false);assert.equal(changed.code,'ARTIFACT_HASH_MISMATCH');assert.equal(missingEvidence.ok,false);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
