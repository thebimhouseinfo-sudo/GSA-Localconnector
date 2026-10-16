import {createHash,timingSafeEqual} from "node:crypto";
import type {MacVmPolicy} from "./macos-vm-policy.js";

/** Host-supervisor handshake: untrusted worker output cannot self-certify.
 * This pure validator never opens sockets, boots a VM, or grants execution.
 */
export interface VmWorkerClaim {
 readonly protocol:"gsa-vm-worker-v1";
 readonly workspace_id:string;
 readonly policy_fingerprint:string;
 readonly boot_nonce:string;
 readonly guest_arch:"arm64";
 readonly mounted_share_count:number;
 readonly network_device_count:number;
 readonly socket_device_count:number;
 readonly vm_state:"READY";
}
export interface VmWorkerChallenge {
 readonly workspace_id:string;
 readonly policy_fingerprint:string;
 readonly boot_nonce:string;
}
export class VmWorkerHandshakeError extends Error {
 readonly code="SECURITY_BLOCKED";
 constructor(message:string){super(message);}
}
function equalDigest(a:string,b:string):boolean {
 if(!/^[a-f0-9]{64}$/.test(a)||!/^[a-f0-9]{64}$/.test(b))return false;
 return timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
/** Even an exact match is an untrusted *claim* pending independent host proof. */
export function inspectVmWorkerClaim(policy:MacVmPolicy,challenge:VmWorkerChallenge,claim:VmWorkerClaim):{
 readonly matched:true;readonly security_verified:false;readonly execution_authorized:false;
} {
 if(!policy||policy.verified!==false||policy.executable!==false||
  !equalDigest(policy.policy_fingerprint,challenge.policy_fingerprint)||
  !equalDigest(policy.policy_fingerprint,claim.policy_fingerprint)||
  policy.workspace_id!==challenge.workspace_id||policy.workspace_id!==claim.workspace_id||
  typeof challenge.boot_nonce!=="string"||!/^[a-f0-9]{64}$/.test(challenge.boot_nonce)||
  claim.boot_nonce!==challenge.boot_nonce||claim.protocol!=="gsa-vm-worker-v1"||
  claim.guest_arch!=="arm64"||claim.mounted_share_count!==1||
  claim.network_device_count!==0||claim.socket_device_count!==0||claim.vm_state!=="READY")
  throw new VmWorkerHandshakeError("Untrusted VM worker claim rejected");
 return {matched:true,security_verified:false,execution_authorized:false};
}
export function fingerprintVmWorkerChallenge(challenge:VmWorkerChallenge):string {
 if(!/^[a-f0-9]{64}$/.test(challenge.boot_nonce))throw new VmWorkerHandshakeError("Invalid boot nonce");
 return createHash("sha256").update(JSON.stringify(challenge)).digest("hex");
}
