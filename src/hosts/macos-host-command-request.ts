import fs from "node:fs/promises";
import type {WorkspaceRegistry} from "../core/workspace.js";
import path from "node:path";

/** M3/D1 host-command admission. This validates request shape only.
 * A host executor must separately pin and revalidate the selected workspace
 * root/cwd at use time. No OS confinement is provided or implied.
 */
export type MacHostCommandRequest={
 readonly workspace_id:string;
 readonly executable:string;
 readonly argv:readonly string[];
 readonly cwd_relative:string;
 readonly time_limit_ms:number;
 readonly max_output_bytes:number;
};
export function validateMacHostCommandRequest(request:MacHostCommandRequest):void{
 const invalid=()=>{throw Object.assign(Error("Invalid host command request"),{code:"INVALID_PROCESS"});};
 if(!request||typeof request.workspace_id!=="string"||!request.workspace_id.trim()||
 typeof request.executable!=="string"||!request.executable.trim()||request.executable.includes("\0")||
 !Array.isArray(request.argv)||request.argv.some(a=>typeof a!=="string"||a.includes("\0"))||
 !Number.isSafeInteger(request.time_limit_ms)||request.time_limit_ms<1||request.time_limit_ms>120000||
 !Number.isSafeInteger(request.max_output_bytes)||request.max_output_bytes<1||request.max_output_bytes>2097152||
 typeof request.cwd_relative!=="string"||!request.cwd_relative||request.cwd_relative.includes("\0"))invalid();
 const cwd=request.cwd_relative;
 if(path.posix.isAbsolute(cwd)||path.win32.isAbsolute(cwd)||cwd.includes("\\")||
 cwd.split("/").some(part=>part===""||part===".."||part==="."&&cwd!=="."))invalid();
 const normalized=path.posix.normalize(cwd);
 if(normalized!==cwd&&cwd!==".")invalid();
}
export const MAC_HOST_COMMAND_DISCLOSURE=Object.freeze({
 command_confinement:"none (user account)",
 state_integrity_vs_commands:"not_protected"
} as const);

/** Resolve only a currently allowed existing directory. Do not treat this
 * check as atomic with spawn; the executor must pin/recheck the root and cwd.
 */
export async function resolveMacHostCommandCwd(registry:WorkspaceRegistry,request:MacHostCommandRequest):Promise<string>{
 validateMacHostCommandRequest(request);
 registry.requireGrant(request.workspace_id,"execute");
 const cwd=await registry.resolveExistingRead(request.workspace_id,request.cwd_relative);
 const info=await fs.stat(cwd);
 if(!info.isDirectory())throw Object.assign(Error("Command cwd is not a directory"),{code:"INVALID_PROCESS"});
 return cwd;
}
