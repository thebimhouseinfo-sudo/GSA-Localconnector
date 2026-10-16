import {test} from "node:test";
import assert from "node:assert/strict";
import {applyUnifiedTextPatch} from "../src/core/unified-patch.js";
test("strict single hunk patch succeeds",()=>{
 const out=applyUnifiedTextPatch("alpha\nbeta\ngamma", "@@ -1,3 +1,3 @@\n alpha\n-beta\n+delta\n gamma\n");
 assert.equal(out,"alpha\ndelta\ngamma");
});
test("unified patch rejects stale context and malformed counts",()=>{
 assert.throws(()=>applyUnifiedTextPatch("other","@@ -1 +1 @@\n-old\n+new\n"),(e:any)=>e.code==="HASH_CONFLICT");
 assert.throws(()=>applyUnifiedTextPatch("a","@@ -1,2 +1,1 @@\n-a\n+b\n"),(e:any)=>e.code==="INVALID_PATCH");
 assert.throws(()=>applyUnifiedTextPatch("a","--- a\n+++ b\n"),(e:any)=>e.code==="INVALID_PATCH");
});
