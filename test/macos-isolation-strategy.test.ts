import {test} from "node:test";
import assert from "node:assert/strict";
import {assessMacIsolation,requireMacIsolationProof} from "../src/hosts/macos-isolation-strategy.js";
test("macOS fallback planning never creates native execution authority",()=>{
 for(const strategy of ["seatbelt-experimental","virtualization-native-worker","dedicated-account"] as const){
  const a=assessMacIsolation(strategy);
  assert.equal(a.security_verified,false);
  assert.equal(a.process_execution_allowed,false);
  assert.ok(a.missing_evidence.includes("outside-root-read-and-write-denial"));
  assert.throws(()=>requireMacIsolationProof(a),(e:any)=>e.code==="SECURITY_BLOCKED");
 }
 assert.equal(assessMacIsolation("seatbelt-experimental").state,"BLOCKED");
 assert.equal(assessMacIsolation("dedicated-account").state,"BLOCKED");
 assert.equal(assessMacIsolation("virtualization-native-worker").state,"CANDIDATE");
});
