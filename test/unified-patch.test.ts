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
test('standard no-newline markers add, remove and preserve the final newline',()=>{
 const mark='\\ No newline at end of file\n';
 const cases=[
  ['old','new\n','@@ -1 +1 @@\n-old\n'+mark+'+new\n'],
  ['old\n','new','@@ -1 +1 @@\n-old\n+new\n'+mark],
  ['old','new','@@ -1 +1 @@\n-old\n'+mark+'+new\n'+mark],
  ['a\nb','a\nc','@@ -1,2 +1,2 @@\n a\n-b\n'+mark+'+c\n'+mark],
  ['a\nb','x\nb','@@ -1,2 +1,2 @@\n-a\n+x\n b\n'+mark],
  ['x','','@@ -1 +0,0 @@\n-x\n'+mark],
  ['','x','@@ -0,0 +1 @@\n+x\n'+mark]
 ];
 for(const [original,expected,patch] of cases)assert.equal(applyUnifiedTextPatch(original,patch),expected);
});
test('no-newline markers reject stale or non-final source and output annotations',()=>{
 const mark='\\ No newline at end of file\n';
 for(const [original,patch] of [
  ['a\n','@@ -1 +1 @@\n-a\n'+mark+'+b\n'],
  ['a\nb','@@ -1,2 +1,2 @@\n a\n'+mark+' b\n'],
  ['a\nb','@@ -1,2 +1,2 @@\n-a\n+x\n'+mark+' b\n']
 ])assert.throws(()=>applyUnifiedTextPatch(original,patch));
});
