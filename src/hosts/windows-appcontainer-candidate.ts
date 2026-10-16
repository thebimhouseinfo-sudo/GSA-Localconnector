import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
/** Manifest planner ONLY for Microsoft's experimental sandbox API.
 * Compiling FlatBuffers and actual Experimental_CreateProcessInSandbox calls
 * require a native Windows worker and OS feature detection. Nothing here
 * authorizes a process or constitutes a verified sandbox.
 */
export class WindowsSandboxPolicyError extends Error {
 constructor(message:string){super(message);this.name="WindowsSandboxPolicyError";}
}
function safeWindowsDirectory(value:string):string{
 if(typeof value!=="string"||!path.win32.isAbsolute(value)||!/^([a-zA-Z]:\\)/.test(value)
  ||value.includes("\0")||value.includes("\n")||value.includes("\r"))
  throw new WindowsSandboxPolicyError("INVALID_WINDOWS_ROOT");
 if(value.split(/[\\\\/]/).some(s=>s==="."||s===".."))
  throw new WindowsSandboxPolicyError("DOT_SEGMENT_FORBIDDEN");
 const cleaned=path.win32.normalize(value);
 if(cleaned.length<=3||cleaned.split("\\").some((s,i)=>i>0&&(s==="."||s==="..")))
  throw new WindowsSandboxPolicyError("DRIVE_ROOT_OR_DOT_SEGMENT_FORBIDDEN");
 // Planning does not resolve junctions/reparse points, which native worker must check.
 return cleaned;
}
export interface WindowsSandboxPlan {
 readonly identity:string;
 readonly spec:{readonly version:"0.1.0";readonly app_container:true;
  readonly integrity:"system_default";readonly disallow_win32k_system_calls:true;
  readonly fs_read_write:readonly string[];readonly fs_read_only:readonly string[];
  readonly capabilities:"";};
 readonly policy_fingerprint:string;
 readonly verified:false;
}
/** No ambient network capabilities. Read-only runtime folders must be explicit
 * user-authorized toolchain roots and must never contain Workspace siblings.
 */
export function planWindowsAppContainer(workspace:string,toolchainReadOnly:readonly string[]=[]):WindowsSandboxPlan {
 const root=safeWindowsDirectory(workspace);
 if(toolchainReadOnly.length>16)throw new WindowsSandboxPolicyError("EXCESS_TOOLCHAIN_ROOTS");
 const dependencies=toolchainReadOnly.map(safeWindowsDirectory);
 const lower=root.toLowerCase();
 for(const dep of dependencies){
  const candidate=dep.toLowerCase();
  if(candidate===lower||candidate.startsWith(lower+"\\")||lower.startsWith(candidate+"\\"))
   throw new WindowsSandboxPolicyError("OVERLAPPING_TOOLCHAIN_ROOT");
 }
 const spec={version:"0.1.0" as const,app_container:true as const,
  integrity:"system_default" as const,disallow_win32k_system_calls:true as const,
  fs_read_write:[root],fs_read_only:dependencies,capabilities:"" as const};
 return {identity:"GSA_LC_"+randomUUID().replace(/-/g,""),
  spec,policy_fingerprint:createHash("sha256").update(JSON.stringify(spec)).digest("hex"),verified:false};
}
