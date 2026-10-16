import {test} from "node:test";
import assert from "node:assert/strict";
import {probeNativeCapabilities} from "../src/local/native-capability-probe.js";
test("native preflight never reports security verified",async()=>{
 const p=await probeNativeCapabilities();
 assert.equal(p.platform,process.platform);
 assert.equal(p.arch,process.arch);
 assert.equal(p.security_verified,false);
 assert.equal(p.requires_host_negative_test,true);
 if(process.platform==="win32")assert.equal(p.native_strategy,"windows-appcontainer-native-worker-required");
 if(process.platform==="darwin")assert.equal(p.native_strategy,"macos-seatbelt-candidate");
});
