import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type {SandboxedProcessRequest,SandboxedProcessReceipt,VerifiedNativeSandbox} from "../core/native-io.js";
import {NativeBackendUnavailable} from "../core/native-io.js";
export type DockerPolicy={readonly image:string;readonly maxMemory:string;readonly cpus:string;readonly pids:number;readonly policy_fingerprint:string};
export class DockerPolicyError extends Error{constructor(message:string){super(message);this.name="DockerPolicyError";}}
export function dockerArguments(root:string,name:string,request:SandboxedProcessRequest,policy:DockerPolicy):string[]{
 if(!path.isAbsolute(root)||root.includes(",")||root.includes("\0")||!/^gsa-[0-9a-f-]{36}$/.test(name))throw new DockerPolicyError("INVALID_WORKSPACE_MOUNT");
 if(!/^[a-zA-Z0-9._/-]+@sha256:[0-9a-f]{64}$/.test(policy.image))throw new DockerPolicyError("UNPINNED_IMAGE");
 if(request.network_allowed)throw new DockerPolicyError("NETWORK_NOT_APPROVED");
 if(!request.executable||!Array.isArray(request.argv)||request.argv.some(x=>typeof x!=="string"||x.includes("\0")))throw new DockerPolicyError("INVALID_COMMAND");
 if(request.cwd_relative!=="."||request.time_limit_ms<1||request.time_limit_ms>120000||request.max_output_bytes<1||request.max_output_bytes>2*1024*1024)throw new DockerPolicyError("INVALID_RUN_LIMIT");
 if(!/^[0-9]+(?:m|g)$/.test(policy.maxMemory)||!/^[0-9]+(?:\.[0-9]+)?$/.test(policy.cpus)||!Number.isInteger(policy.pids)||policy.pids<1||policy.pids>256)throw new DockerPolicyError("INVALID_POLICY");
 return ["run","--rm","--pull=never","--name",name,
  "--network=none","--read-only","--cap-drop=ALL",
  "--security-opt=no-new-privileges:true","--pids-limit",String(policy.pids),
  "--memory",policy.maxMemory,"--cpus",policy.cpus,
  "--user","65534:65534","--tmpfs","/tmp:rw,nosuid,nodev,size=67108864",
  "--mount",`type=bind,source=${root},target=/workspace`,
  "--workdir","/workspace","--env","HOME=/tmp",
  policy.image,request.executable,...request.argv];
}
type Runner=(cmd:string,args:string[],options:{timeout:number;maxBuffer:number;windowsHide:boolean;env:NodeJS.ProcessEnv})=>Promise<{stdout:string;stderr:string;exitCode:number|null}>;
const exec:Runner=(cmd,args,options)=>new Promise(resolve=>{
 execFile(cmd,args,options,(error,stdout,stderr)=>{
  resolve({stdout:String(stdout),stderr:String(stderr),exitCode:error&&"code" in error&&typeof error.code==="number"?error.code:error?null:0});
 });
});
/** Candidate only: constructor intentionally does NOT implement VerifiedNativeSandbox.
 * Must perform native security proof before wrapping as verified capability.
 */
export class DockerSandboxCandidate {
 constructor(private readonly rootFor:(workspaceId:string)=>Promise<string>,
   private readonly policy:DockerPolicy,private readonly runner:Runner=exec){}
 async executeCandidate(request:SandboxedProcessRequest):Promise<SandboxedProcessReceipt>{
  const root=await fs.realpath(await this.rootFor(request.workspace_id));
  if(!(await fs.stat(root)).isDirectory())throw new DockerPolicyError("WORKSPACE_NOT_DIRECTORY");
  const name="gsa-"+randomUUID();
  const args=dockerArguments(root,name,request,this.policy);
  const limitedEnv:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:process.env.HOME,DOCKER_HOST:process.env.DOCKER_HOST};
  const result=await this.runner("docker",args,{timeout:request.time_limit_ms,maxBuffer:request.max_output_bytes,windowsHide:true,env:limitedEnv});
  if(result.exitCode===null){
   await this.runner("docker",["rm","-f",name],{timeout:15000,maxBuffer:4096,windowsHide:true,env:limitedEnv}).catch(()=>undefined);
  }
  return {exit_code:result.exitCode,stdout:result.stdout,stderr:result.stderr,signal:null,cancelled:false,timed_out:result.exitCode===null};
 }
 /** Proof receipt must be issued by host-native verification and signed/pinned to policy.
  * This module intentionally offers no self-asserted promote-to-verified switch. */
 get policyFingerprint(){return this.policy.policy_fingerprint;}
}
