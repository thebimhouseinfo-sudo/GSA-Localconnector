import {test} from "node:test";
import assert from "node:assert/strict";
import {planMacVmPolicy,validateGuestRelativePath} from "../src/hosts/macos-vm-policy.js";
test("macOS VM planner exposes only exact workspace share and no host network",()=>{
 const p=planMacVmPolicy({workspace_id:"project",canonical_root:"/Users/owner/project"});
 assert.deepEqual(p.shared_host_paths,["/Users/owner/project"]);
 assert.equal(p.network_device_count,0);
 assert.equal(p.sockets_to_host,0);
 assert.equal(p.secrets_in_guest,false);
 assert.equal(p.verified,false);
 assert.equal(p.executable,false);
 assert.match(p.policy_fingerprint,/^[0-9a-f]{64}$/);
 assert.equal(validateGuestRelativePath("src/index.ts"),"src/index.ts");
});
test("macOS VM planner rejects root escape and excessive resource budgets",()=>{
 for(const root of ["/","relative","/Users/x/../y","/Users/x/./y","/Users/x\nwrong"])
  assert.throws(()=>planMacVmPolicy({workspace_id:"project",canonical_root:root}));
 assert.throws(()=>planMacVmPolicy({workspace_id:"project",canonical_root:"/tmp/project",cpu_count:64}));
 assert.throws(()=>planMacVmPolicy({workspace_id:"project",canonical_root:"/tmp/project",memory_mib:128}));
 assert.throws(()=>validateGuestRelativePath("../../secret"));
});
