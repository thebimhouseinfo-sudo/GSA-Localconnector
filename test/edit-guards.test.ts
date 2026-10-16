import {test} from "node:test";
import assert from "node:assert/strict";
import {sha256,planExactEdit,EditConflict} from "../src/core/edit-guards.js";
test("hash-guarded edit plans exact one match without writing",()=>{
 const before=Buffer.from("hello\nworld\n");const hash=sha256(before);
 const plan=planExactEdit(before,hash,"world","GSA");
 assert.equal(plan.content.toString(),"hello\nGSA\n");
 assert.equal(plan.before_sha256,hash);assert.equal(plan.committed,false);
 assert.notEqual(plan.after_sha256,hash);assert.equal(before.toString(),"hello\nworld\n");
});
test("hash conflicts and ambiguous edits fail closed",()=>{
 const before=Buffer.from("a a");
 assert.throws(()=>planExactEdit(before,"0".repeat(64),"a","b"),(e:any)=>e.code==="HASH_CONFLICT");
 assert.throws(()=>planExactEdit(before,sha256(before),"a","b"),(e:any)=>e.code==="MATCH_CONFLICT");
 assert.throws(()=>planExactEdit(before,sha256(before),"","b"),(e:any)=>e.code==="MATCH_CONFLICT");
 assert.throws(()=>planExactEdit(Buffer.from([255]),sha256(Buffer.from([255])),"a","b"),(e:any)=>e.code==="MATCH_CONFLICT");
});
