import {createHash} from "node:crypto";
import path from "node:path";
import {validateWorkspaceRelative} from "../core/workspace-path.js";

/** Plan for a future signed Swift Virtualization.framework worker.
 * Does NOT create VMs, share directories, execute processes or certify safety.
 * Linux guest supports portable CLI tools, not native macOS executables.
 */
export interface MacVmPolicy {
 readonly backend:"apple-virtualization-linux-arm64";
 readonly host_os:"macos";readonly guest_arch:"arm64";
 readonly workspace_id:string;
 readonly guest_mount:"/workspace";
 readonly shared_host_paths:readonly string[];
 readonly read_write_share:true;
 readonly network_device_count:0;
 readonly sockets_to_host:0;
 readonly usb_passthrough:false;
 readonly clipboard_sharing:false;
 readonly secrets_in_guest:false;
 readonly cpu_count:number;
 readonly memory_mib:number;
 readonly max_runtime_ms:number;
 readonly policy_fingerprint:string;
 readonly verified:false;
 readonly executable:false;
}
export class MacVmPolicyError extends Error {
 readonly code="INVALID_VM_POLICY";
 constructor(message:string){super(message);}
}
export function planMacVmPolicy(input:{
 workspace_id:string;canonical_root:string;cpu_count?:number;
 memory_mib?:number;max_runtime_ms?:number;
}):MacVmPolicy{
 const {workspace_id,canonical_root}=input;
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(workspace_id))
  throw new MacVmPolicyError("Invalid workspace ID");
 if(typeof canonical_root!=="string"||!path.posix.isAbsolute(canonical_root)||
  canonical_root==="/"||canonical_root.includes("\0")||canonical_root.includes("\n")||
  canonical_root.split("/").some((part,i)=>i>0&&(part==="."||part==="..")))
  throw new MacVmPolicyError("Canonical workspace root required");
 const cpu_count=input.cpu_count??2,memory_mib=input.memory_mib??2048;
 const max_runtime_ms=input.max_runtime_ms??120000;
 if(!Number.isInteger(cpu_count)||cpu_count<1||cpu_count>8||
  !Number.isInteger(memory_mib)||memory_mib<512||memory_mib>16384||
  !Number.isInteger(max_runtime_ms)||max_runtime_ms<1000||max_runtime_ms>3600000)
  throw new MacVmPolicyError("Excess resource allocation");
 const body={
  backend:"apple-virtualization-linux-arm64" as const,host_os:"macos" as const,
  guest_arch:"arm64" as const,workspace_id,guest_mount:"/workspace" as const,
  shared_host_paths:[canonical_root],read_write_share:true as const,network_device_count:0 as const,
  sockets_to_host:0 as const,usb_passthrough:false as const,
  clipboard_sharing:false as const,secrets_in_guest:false as const,
  cpu_count,memory_mib,max_runtime_ms
 };
 return {...body,policy_fingerprint:createHash("sha256").update(JSON.stringify(body)).digest("hex"),verified:false,executable:false};
}
export function validateGuestRelativePath(relative:string):string{
 return validateWorkspaceRelative(relative);
}
