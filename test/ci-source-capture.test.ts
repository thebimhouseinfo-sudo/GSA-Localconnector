import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {CiJournalStore} from "../src/local/ci-store.js";
import {CiSnapshotStore} from "../src/local/ci-snapshot-store.js";
import {CiSourceCaptureService,type VerifiedWorkspaceSourceCapture} from "../src/core/ci-source-capture.js";
test("source capture is native-gated and binds source to exactly one Workspace",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"ci-capture-"));
 try{
  const journal=new CiJournalStore(path.join(tmp,"runs")),snapshots=new CiSnapshotStore(path.join(tmp,"snaps"));
  await assert.rejects(new CiSourceCaptureService(null,snapshots,journal).prepare("A"),(e:any)=>e.code==="SECURITY_BLOCKED");
  const native:VerifiedWorkspaceSourceCapture={verified:true,platform:"macos",policy_fingerprint:"stub",
   capture:async()=>[{path:"src/index.ts",bytes:Buffer.from("ok")}]};
  const service=new CiSourceCaptureService(native,snapshots,journal);
  const prep=await service.prepare("A");
  assert.match(prep.source_sha256,/^[a-f0-9]{64}$/);
  assert.equal((await service.requireOwned("A",prep.source_run_id)).total_bytes,2);
  await assert.rejects(service.requireOwned("B",prep.source_run_id),/SOURCE_OWNERSHIP_DENIED/);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
