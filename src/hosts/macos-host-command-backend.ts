import type {ApprovedMacHostCommandBackend,SandboxedProcessRequest,SandboxedProcessReceipt} from "../core/native-io.js";
import type {WorkspaceRegistry} from "../core/workspace.js";
import {runMacHostCommandCandidate} from "./macos-host-command-candidate.js";
import {validateMacHostCommandRequest,MAC_HOST_COMMAND_DISCLOSURE} from "./macos-host-command-request.js";

/** M3/D1 unconfined adapter. Not registered by the production bootstrap:
 * a cancellation acknowledgement cannot substitute for M4 OS stop provenance.
 */
export class MacSameUserHostCommands implements ApprovedMacHostCommandBackend {
 readonly platform="macos" as const;
 readonly execution_mode="same-user-unconfined" as const;
 readonly command_confinement=MAC_HOST_COMMAND_DISCLOSURE.command_confinement;
 readonly state_integrity_vs_commands=MAC_HOST_COMMAND_DISCLOSURE.state_integrity_vs_commands;
 private readonly active=new Map<string,{workspace:string;controller:AbortController}>();
 constructor(private readonly registry:WorkspaceRegistry){}
 async execute(request:SandboxedProcessRequest):Promise<SandboxedProcessReceipt>{
  if(process.platform!=="darwin"||request.network_allowed!==true||
     request.artifact_paths?.length||!request.process_id||typeof request.process_id!=="string")
   throw Object.assign(Error("Host command request unsupported"),{code:"INVALID_PROCESS"});
  validateMacHostCommandRequest(request);
  if(this.active.has(request.process_id)||this.active.size>=4)
   throw Object.assign(Error("Host command identity already active"),{code:"PROCESS_BUSY"});
  const controller=new AbortController();
  this.active.set(request.process_id,{workspace:request.workspace_id,controller});
  try{
   const observed=await runMacHostCommandCandidate(this.registry,request,controller.signal);
   return {
    exit_code:observed.exit_code,signal:observed.signal,
    stdout:observed.stdout,stderr:observed.stderr,
    timed_out:observed.timed_out,cancelled:observed.cancelled,
    output_limited:observed.stdout_truncated||observed.stderr_truncated
   };
  }finally{
   const entry=this.active.get(request.process_id);
   if(entry?.controller===controller)this.active.delete(request.process_id);
  }
 }
 async cancel(process_id:string,workspace_id:string):Promise<boolean>{
  const entry=this.active.get(process_id);
  if(!entry||entry.workspace!==workspace_id)return false;
  entry.controller.abort();
  return true; // request acknowledged, no OS physical-stop certification
 }
}
