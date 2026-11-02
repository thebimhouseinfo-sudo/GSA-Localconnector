import {spawn} from "node:child_process";
import type {ChildProcessWithoutNullStreams} from "node:child_process";
import {resolveMacHostCommandCwd,type MacHostCommandRequest,MAC_HOST_COMMAND_DISCLOSURE} from "./macos-host-command-request.js";
import type {WorkspaceRegistry} from "../core/workspace.js";

export type MacHostCommandObservation={
 readonly state:"SUCCEEDED"|"FAILED"|"UNKNOWN";
 readonly exit_code:number|null;
 readonly signal:string|null;
 readonly stdout:string;
 readonly stderr:string;
 readonly stdout_truncated:boolean;
 readonly stderr_truncated:boolean;
 readonly timed_out:boolean;
 readonly cancelled:boolean;
 readonly process_group_stop_verified:boolean;
 readonly command_confinement:"none (user account)";
 readonly state_integrity_vs_commands:"not_protected";
};
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
/** D1 candidate only, NOT plugged into MCP / process journal. OS group absence
 * does not prove escaped descendants stopped. This must not be used for M4 proof.
 */
export async function runMacHostCommandCandidate(
 registry:WorkspaceRegistry,request:MacHostCommandRequest,abort?:AbortSignal
):Promise<MacHostCommandObservation>{
 if(process.platform!=="darwin")throw Object.assign(Error("macOS host only"),{code:"SECURITY_BLOCKED"});
 if(abort?.aborted)throw Object.assign(Error("Cancelled before spawn"),{code:"CANCELLED"});
 const cwd=await resolveMacHostCommandCwd(registry,request);
 // Recheck immediately before spawn; cwd remains a pathname-based operation.
 // A concurrent rename after this check is not excluded by the Node API.
 await resolveMacHostCommandCwd(registry,request);
 const child=spawn(request.executable,[...request.argv],{
  cwd,detached:true,shell:false,stdio:["ignore","pipe","pipe"],env:process.env
 }) as ChildProcessWithoutNullStreams;
 if(!child.pid)throw Object.assign(Error("No owned process identity"),{code:"PROCESS_BUSY"});
 const pgid=child.pid,cap=request.max_output_bytes;
 const stdout:Buffer[]=[],stderr:Buffer[]=[];
 let total=0,outTruncated=false,errTruncated=false,closed=false;
 let exitCode:number|null=null,signal:string|null=null,spawnError:Error|undefined;
 let timedOut=false,cancelled=false,termSent=false,killSent=false;
 const collect=(bytes:Buffer,target:Buffer[],stream:"stdout"|"stderr")=>{
  const remain=Math.max(0,cap-total),keep=Math.min(remain,bytes.length);
  if(keep)target.push(Buffer.from(bytes.subarray(0,keep)));
  total+=keep;
  if(keep<bytes.length){if(stream==="stdout")outTruncated=true;else errTruncated=true;}
 };
 child.stdout.on("data",(chunk:Buffer)=>collect(chunk,stdout,"stdout"));
 child.stderr.on("data",(chunk:Buffer)=>collect(chunk,stderr,"stderr"));
 child.on("error",e=>{spawnError=e;});
 child.on("close",(code,sig)=>{closed=true;exitCode=code;signal=sig;});
 const groupAlive=()=>{try{process.kill(-pgid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=="ESRCH";}};
 const ownedSignal=(sig:NodeJS.Signals)=>{
  // Only send to the group created by detached spawn; never use a global kill.
  try{process.kill(-pgid,sig);}catch(e){if((e as NodeJS.ErrnoException).code!=="ESRCH")spawnError??=e as Error;}
 };
 const started=Date.now();
 const requestedStop=()=>abort?.aborted||Date.now()-started>=request.time_limit_ms;
 let groupStopped=false;
 try{
  while(Date.now()-started<request.time_limit_ms+5000){
   const age=Date.now()-started;
   if(requestedStop()&&!termSent){
    cancelled=!!abort?.aborted;timedOut=!cancelled;termSent=true;ownedSignal("SIGTERM");
   }
   if(termSent&&!killSent&&age>=request.time_limit_ms+2000){
    killSent=true;ownedSignal("SIGKILL");
   }
   if(closed&&!groupAlive()){groupStopped=true;break;}
   await sleep(25);
  }
 }finally{
  // Never claim full-tree ownership based on group status; no fixture cleanup.
 }
 const output={
  stdout:Buffer.concat(stdout,total).toString("utf8"),
  stderr:Buffer.concat(stderr,total).toString("utf8")
 };
 const uncertain=!closed||!groupStopped||!!spawnError||timedOut||cancelled||outTruncated||errTruncated||signal!==null;
 return {
  state:uncertain?"UNKNOWN":exitCode===0?"SUCCEEDED":"FAILED",
  exit_code:exitCode,signal,...output,
  stdout_truncated:outTruncated,stderr_truncated:errTruncated,
  timed_out:timedOut,cancelled,
  process_group_stop_verified:groupStopped,
  ...MAC_HOST_COMMAND_DISCLOSURE
 };
}
