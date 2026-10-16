import path from "node:path";
import {createHash} from "node:crypto";

/** Experimental macOS Seatbelt profile (sandbox-exec is deprecated).
 * Construction is NOT native enforcement verification. NEVER inject this
 * as VerifiedNativeSandbox without host-specific negative controls.
 */
/** Host evidence is negative: this exact policy SIGABRTs on macOS 26.6.2 arm64.
 * This is intentionally NOT a capability token and must never be upgraded
 * based on a compile/test-only PASS.
 */
export const MACOS_SEATBELT_HOST_VERDICT={
 status:"BLOCKED_HOST_SIGABRT",
 security_verified:false,
 production_eligible:false,
 reason:"Restricted file-read policy fails the legitimate in-Workspace read control"
} as const;
export class MacSandboxPolicyError extends Error {
 constructor(message:string){super(message);this.name="MacSandboxPolicyError";}
}
/** Only the explicitly bound workspace is writable; system runtime libraries
 * are readable so build tools may start. A host-native test must verify actual
 * deny semantics including nested subprocesses, symlinks, and network access.
 */
export const MACOS_SEATBELT_PROFILE=[
 "(version 1)",
 "(deny default)",
 "(allow process-exec)",
 "(allow process-fork)",
 "(allow file-read*",
 "  (subpath (param \"WORKSPACE\"))",
 "  (subpath \"/System\")",
 "  (subpath \"/usr\")",
 "  (subpath \"/bin\")",
 "  (subpath \"/sbin\")",
 "  (subpath \"/Library\")",
 "  (literal \"/dev/null\")",
 "  (literal \"/dev/urandom\"))",
 "(allow file-write* (subpath (param \"WORKSPACE\")))",
 "(deny network*)"
].join("\n");
export interface MacSeatbeltPlan {
 readonly command:"/usr/bin/sandbox-exec";
 readonly argv:readonly string[];
 readonly policy_fingerprint:string;
 readonly verified:false;
}
export function planMacSeatbelt(workspaceRoot:string,executable:string,argv:readonly string[]):MacSeatbeltPlan {
 if(process.platform==="win32")throw new MacSandboxPolicyError("MACOS_ONLY");
 if(typeof workspaceRoot!=="string"||!path.posix.isAbsolute(workspaceRoot)||workspaceRoot==="/"
  ||workspaceRoot.includes("\0")||workspaceRoot.includes("\n")||workspaceRoot.includes("\r")
  ||workspaceRoot.split("/").some((x,i)=>i>0&&(x==="."||x==="..")))
  throw new MacSandboxPolicyError("INVALID_WORKSPACE_ROOT");
 if(typeof executable!=="string"||!path.posix.isAbsolute(executable)||executable.includes("\0")
  ||!Array.isArray(argv)||argv.some(x=>typeof x!=="string"||x.includes("\0")))
  throw new MacSandboxPolicyError("INVALID_EXECUTABLE");
 const policy_fingerprint=createHash("sha256").update(MACOS_SEATBELT_PROFILE).digest("hex");
 return {
  command:"/usr/bin/sandbox-exec",
  argv:["-p",MACOS_SEATBELT_PROFILE,"-D","WORKSPACE="+workspaceRoot,executable,...argv],
  policy_fingerprint,
  verified:false
 };
}
