import {test} from "node:test";
import assert from "node:assert/strict";
import {planMacVmPolicy} from "../src/hosts/macos-vm-policy.js";
import {inspectVmWorkerClaim,fingerprintVmWorkerChallenge} from "../src/hosts/macos-vm-handshake.js";

test("matching VM worker claim cannot authorize process execution",()=>{
 const p=planMacVmPolicy({workspace_id:"one",canonical_root:"/Users/owner/one"});
 const boot_nonce="b".repeat(64);
 const challenge={workspace_id:"one",policy_fingerprint:p.policy_fingerprint,boot_nonce};
 const claim={protocol:"gsa-vm-worker-v1" as const,...challenge,guest_arch:"arm64" as const,
  mounted_share_count:1,network_device_count:0,socket_device_count:0,vm_state:"READY" as const};
 assert.match(fingerprintVmWorkerChallenge(challenge),/^[a-f0-9]{64}$/);
 assert.deepEqual(inspectVmWorkerClaim(p,challenge,claim),{
  matched:true,security_verified:false,execution_authorized:false
 });
 for(const changed of [
  {...claim,network_device_count:1},{...claim,mounted_share_count:2},
  {...claim,boot_nonce:"c".repeat(64)},{...claim,policy_fingerprint:"d".repeat(64)},
  {...claim,workspace_id:"another"},{...claim,socket_device_count:1}
 ])assert.throws(()=>inspectVmWorkerClaim(p,challenge,changed),(e:any)=>e.code==="SECURITY_BLOCKED");
});
