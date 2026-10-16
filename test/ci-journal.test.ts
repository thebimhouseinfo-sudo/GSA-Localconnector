import {test} from "node:test";
import assert from "node:assert/strict";
import {createQueuedRun,sourceFingerprint,transitionRun,prepareFailedRerun} from "../src/core/ci-journal.js";
const h="a".repeat(64);
test("CI input fingerprint stable across input ordering and rejects escapes",()=>{
 const a=[{path:"src/a.ts",sha256:h},{path:"package.json",sha256:h}];
 assert.equal(sourceFingerprint(a),sourceFingerprint([...a].reverse()));
 assert.throws(()=>sourceFingerprint([{path:"../sensitive",sha256:h}]));
 assert.throws(()=>sourceFingerprint([a[0],a[0]]));
});
test("durable CI state requires truthful evidence and revision",()=>{
 const queued=createQueuedRun("ws","build",h);
 const prep=transitionRun(queued,"PREPARING",1);
 const run=transitionRun(prep,"RUNNING",2);
 assert.throws(()=>transitionRun(run,"PASSED",3));
 assert.throws(()=>transitionRun(run,"PASSED",3,{exit_code:1} as any));
 const pass=transitionRun(run,"PASSED",3,undefined,{exit_code:0,artifact_hashes:{}});
 assert.equal(pass.state,"PASSED");assert.equal(pass.revision,4);
 assert.throws(()=>transitionRun(pass,"RUNNING",4));
 assert.throws(()=>transitionRun(run,"FAILED",1));
});

test("failed CI rerun requires matching source and new run ID",()=>{
 const queued=createQueuedRun("w","test",h);
 const prep=transitionRun(queued,"PREPARING",1);
 const running=transitionRun(prep,"RUNNING",2);
 const failed=transitionRun(running,"FAILED",3,undefined,{exit_code:1,artifact_hashes:{}});
 const retry=prepareFailedRerun(failed,h);
 assert.equal(retry.state,"QUEUED");
 assert.equal(retry.rerun_of,failed.run_id);
 assert.notEqual(retry.run_id,failed.run_id);
 assert.throws(()=>prepareFailedRerun(failed,"b".repeat(64)),/RERUN_REQUIRES_FAILED_VERIFIED_SOURCE/);
 assert.throws(()=>prepareFailedRerun(running,h),/RERUN_REQUIRES_FAILED_VERIFIED_SOURCE/);
});
