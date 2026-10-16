import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {CiJournalStore} from "../src/local/ci-store.js";
import {CiSnapshotStore} from "../src/local/ci-snapshot-store.js";
import {CiRunService,type VerifiedCiExecutor} from "../src/core/ci-run-service.js";
const workflow={name:"test",jobs:[{id:"run",steps:[{id:"step",command:"node",args:["--version"]}]}]};
test("CI submit returns durable ID and records executor evidence truthfully",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"ci-service-"));
 try{
  const snapshots=new CiSnapshotStore(path.join(tmp,"snaps")),journal=new CiJournalStore(path.join(tmp,"runs"));
  const original=randomUUID();
  await snapshots.persist(original,[{path:"README.md",bytes:Buffer.from("hello")}]);
  const executor:VerifiedCiExecutor={verified:true,policy_fingerprint:"test-only",execute:async()=>({exit_code:0,source_verified:true})};
  const service=new CiRunService(journal,snapshots,executor);
  const queued=await service.submit("A",workflow,original);
  await service.settle(queued.run_id);
  const completed=await journal.load(queued.run_id);
  assert.equal(completed.state,"PASSED");
  assert.equal(completed.evidence?.exit_code,0);
  assert.equal((await snapshots.verify(queued.run_id)).source_sha256,queued.source_sha256);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test("CI service rejects missing sandbox and does not falsify source evidence",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"ci-service-failed-"));
 try{
  const snapshots=new CiSnapshotStore(path.join(tmp,"snaps")),journal=new CiJournalStore(path.join(tmp,"runs"));
  const original=randomUUID();await snapshots.persist(original,[{path:"a.txt",bytes:Buffer.from("a")}]);
  await assert.rejects(new CiRunService(journal,snapshots,null).submit("A",workflow,original),(e:any)=>e.code==="SECURITY_BLOCKED");
  const executor:VerifiedCiExecutor={verified:true,policy_fingerprint:"fake",execute:async()=>({exit_code:0,source_verified:false})};
  const service=new CiRunService(journal,snapshots,executor);
  const queued=await service.submit("A",workflow,original);await service.settle(queued.run_id);
  assert.equal((await journal.load(queued.run_id)).state,"UNKNOWN");
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
