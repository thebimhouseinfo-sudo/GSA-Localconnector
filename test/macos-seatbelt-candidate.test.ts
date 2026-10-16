import {test} from "node:test";
import assert from "node:assert/strict";
import {planMacSeatbelt,MACOS_SEATBELT_PROFILE,MACOS_SEATBELT_HOST_VERDICT} from "../src/hosts/macos-seatbelt-candidate.js";
test("Seatbelt candidate writes only into selected workspace and denies network",()=>{
 if(process.platform==="win32"){
  assert.throws(()=>planMacSeatbelt("/tmp/mywork","/usr/bin/python3",[]),/MACOS_ONLY/);
  return;
 }
 const p=planMacSeatbelt("/Users/owner/project","/usr/bin/python3",["-c","print('hello')"]);
 assert.equal(p.verified,false);
 assert.equal(p.command,"/usr/bin/sandbox-exec");
 assert.match(MACOS_SEATBELT_PROFILE,/deny network\*/);
 assert.match(MACOS_SEATBELT_PROFILE,/allow file-write\* \(subpath \(param "WORKSPACE"\)\)/);
 assert.ok(!MACOS_SEATBELT_PROFILE.includes('subpath "/Users"'));
 assert.ok(p.argv.includes("WORKSPACE=/Users/owner/project"));
 assert.equal(p.argv.at(-1),"print('hello')");
});
test("Seatbelt planning rejects root and traversal",()=>{
 if(process.platform==="win32")return;
 for(const root of ["/","relative/path","/tmp/../secret","/tmp/./child","/tmp/project\n(allow default)"])
  assert.throws(()=>planMacSeatbelt(root,"/usr/bin/true",[]));
});

test("host-reported Seatbelt SIGABRT cannot promote an unverified candidate",()=>{
 assert.equal(MACOS_SEATBELT_HOST_VERDICT.status,"BLOCKED_HOST_SIGABRT");
 assert.equal(MACOS_SEATBELT_HOST_VERDICT.security_verified,false);
 assert.equal(MACOS_SEATBELT_HOST_VERDICT.production_eligible,false);
});
