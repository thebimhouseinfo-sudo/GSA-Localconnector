import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createQueuedRun,transitionRun} from "../src/core/ci-journal.js";
import {CiJournalStore} from "../src/local/ci-store.js";
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
