import {test} from "node:test";
import assert from "node:assert/strict";
import {BoundedEvidence} from "../src/core/ci-evidence.js";
test("CI evidence cursors and quotas fail closed",()=>{
 const ev=new BoundedEvidence("run-1",20);
 const a=ev.append("stdout","hello");assert.equal(a.sequence,1);
 ev.append("stderr","world");
 assert.equal(ev.page(0,1).next_cursor,1);
 assert.equal(ev.page(1,1).next_cursor,null);
 assert.match(ev.digest(),/^[a-f0-9]{64}$/);
 assert.throws(()=>ev.append("stdout","x".repeat(30)),/EVIDENCE_QUOTA_EXCEEDED/);
 assert.throws(()=>ev.page(-1),/INVALID_CURSOR/);
});
