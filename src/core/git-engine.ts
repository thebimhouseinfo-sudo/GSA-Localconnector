import {gitPlan,GitPlanError,type GitPlan} from "./git-plans.js";
import {requireNativeBackend,type SandboxedProcessRequest,type VerifiedNativeSandbox} from "./native-io.js";
export class GitExecutionError extends Error {constructor(public readonly code:"GIT_FAILED"|"GIT_UNKNOWN"|"GIT_OUTPUT_LIMIT",message:string){super(message);}}
export interface GitReceipt {
 readonly workspace_id:string;readonly command:readonly string[];
 readonly exit_code:number|null;readonly output:string;readonly stderr:string;
 readonly mutates:boolean;readonly network:boolean;readonly committed:false;
}
/** Execution is impossible without a native sandbox. Never run git with ambient host credentials. */
export async function executeGit(sandbox:VerifiedNativeSandbox|null,workspaceId:string,toolName:string,args:Record<string,unknown>={}):Promise<GitReceipt> {
 const native=requireNativeBackend(sandbox);
 const plan=gitPlan(toolName,args);
 if(plan.network)throw new GitPlanError("Git network requires a separately approved restricted network capability");
 const request:SandboxedProcessRequest={
  workspace_id:workspaceId,executable:plan.executable,argv:plan.argv,cwd_relative:".",
  time_limit_ms:30000,max_output_bytes:1024*1024,network_allowed:false
 };
 const result=await native.execute(request);
 if(result.output_limited||Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr)>request.max_output_bytes)throw new GitExecutionError("GIT_OUTPUT_LIMIT","Git output is incomplete");
 if(result.cancelled||result.timed_out||result.signal!==null||result.exit_code===null)throw new GitExecutionError("GIT_UNKNOWN","Git process outcome is unresolved");
 if(result.exit_code!==0)throw new GitExecutionError("GIT_FAILED",result.stderr.slice(0,512));
 return {workspace_id:workspaceId,command:plan.argv,exit_code:result.exit_code,output:result.stdout,stderr:result.stderr,mutates:plan.mutates,network:false,committed:false};
}
