import {spawn,spawnSync,type ChildProcess} from "node:child_process";
import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {WorkspaceRegistry} from "../core/workspace.js";
import {validateProcessRequest} from "../core/process-manager.js";
import type {SandboxedProcessRequest,SandboxedProcessReceipt,VerifiedNativeSandbox,VerifiedNativeProcessController,NativeProcessStatus} from "../core/native-io.js";

/** A trusted-user command launcher, NOT an OS sandbox. Workspace binding
 * restricts initial cwd only; child commands retain ambient user filesystem access.
 * The caller must ensure a single host session owns this instance.
 */
type Run={
 id:string;workspace:string;child:ChildProcess;pid:number;started_at:string;
 ended_at:string|null;state:NativeProcessStatus["state"];exit_code:number|null;signal:string|null;
 stdout:Buffer[];stderr:Buffer[];bytes:number;output_limited:boolean;max:number;
 cancelled:boolean;timed_out:boolean;closed:boolean;stopProof:boolean;
 settled:Promise<void>;resolve:()=>void;timer:ReturnType<typeof setTimeout>|null;
};
export class MacNativeCommands implements VerifiedNativeSandbox,VerifiedNativeProcessController {
 readonly platform="macos" as const;
 readonly verified=true as const;
 readonly policy_fingerprint="macos-native-user-account-no-confinement-v1";
 readonly command_confinement="none (user account)" as const;
 readonly state_integrity_vs_commands="not_protected" as const;
 private readonly runs=new Map<string,Run>();
 constructor(private readonly workspaces:WorkspaceRegistry){
  if(process.platform!=="darwin")throw Error("MACOS_HOST_REQUIRED");
 }
 private async cwd(req:SandboxedProcessRequest):Promise<string>{
  validateProcessRequest(req);
  const grant=this.workspaces.requireGrant(req.workspace_id,"execute");
  if(grant.role==="reference")throw Error("REFERENCE_EXECUTION_DENIED");
  const root=await fs.realpath(grant.canonicalRoot);
  const stat=await fs.stat(root,{bigint:true});
  if(root!==grant.canonicalRoot||String(stat.dev)!==grant.rootIdentity.device||String(stat.ino)!==grant.rootIdentity.inode)
   throw Error("WORKSPACE_ROOT_CHANGED");
  const candidate=await fs.realpath(path.join(root,req.cwd_relative));
  const relative=path.relative(root,candidate);
  if(relative===".."||relative.startsWith(".."+path.sep)||path.isAbsolute(relative))throw Error("COMMAND_CWD_ESCAPE");
  if(!(await fs.stat(candidate)).isDirectory())throw Error("COMMAND_CWD_NOT_DIRECTORY");
  if(this.workspaces.get(req.workspace_id)!==grant)throw Error("WORKSPACE_REVOKED");
  return candidate;
 }
 /** Group check is made only while our original child leader remains live.
  * Never signal by a historical PID or infer ownership from a group number alone. */
 private ownedGroup(run:Run):boolean{
  if(run.child.pid!==run.pid||run.closed||run.child.exitCode!==null||run.child.signalCode!==null)return false;
  const check=spawnSync("/bin/ps",["-o","pgid=","-p",String(run.pid)],{encoding:"utf8",timeout:1000,env:{PATH:"/usr/bin:/bin"}});
  return check.status===0&&check.stdout.trim()===String(run.pid);
 }
 private groupAbsent(run:Run):boolean{
  try{process.kill(-run.pid,0);return false;}
  catch(error){return (error as NodeJS.ErrnoException).code==="ESRCH";}
 }
 private record(run:Run,stream:"stdout"|"stderr",data:Buffer):void{
  const available=Math.max(0,run.max-run.bytes);
  const slice=data.subarray(0,available);
  if(slice.length)run[stream].push(slice);
  run.bytes+=slice.length;
  if(slice.length!==data.length)run.output_limited=true;
 }
 private buffer(chunks:Buffer[]):string{
  return Buffer.concat(chunks).toString("utf8");
 }
 private async launch(request:SandboxedProcessRequest):Promise<Run>{
  if(this.runs.size>=128){
   const completed=[...this.runs.values()].find(run=>run.closed&&run.stopProof);
   if(completed)this.runs.delete(completed.id);
   else throw Error("PROCESS_HISTORY_CAPACITY");
  }
  const cwd=await this.cwd(request),id=request.process_id??randomUUID();
  if(this.runs.has(id))throw Error("PROCESS_ID_ALREADY_USED");
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH??"/usr/bin:/bin",LANG:process.env.LANG??"C",TMPDIR:process.env.TMPDIR??"/tmp"};
  const child=spawn(request.executable,[...request.argv],{cwd,env,detached:true,stdio:["ignore","pipe","pipe"],shell:false});
  const pid=child.pid;
  if(!pid){child.kill();throw Error("PROCESS_SPAWN_UNCONFIRMED");}
  let resolve!:()=>void;
  const settled=new Promise<void>(done=>{resolve=done;});
  const run:Run={id,workspace:request.workspace_id,child,pid,started_at:new Date().toISOString(),ended_at:null,state:"RUNNING",exit_code:null,signal:null,
   stdout:[],stderr:[],bytes:0,output_limited:false,max:request.max_output_bytes,cancelled:false,timed_out:false,closed:false,stopProof:false,settled,resolve,timer:null};
  this.runs.set(id,run);
  child.stdout?.on("data",(chunk:Buffer)=>this.record(run,"stdout",chunk));
  child.stderr?.on("data",(chunk:Buffer)=>this.record(run,"stderr",chunk));
  child.on("error",()=>{run.state="UNKNOWN";});
  child.on("close",(code,signal)=>{
   run.closed=true;run.ended_at=new Date().toISOString();run.exit_code=code;run.signal=signal;
   if(run.timer)clearTimeout(run.timer);
   run.stopProof=this.groupAbsent(run);
   run.state=!run.stopProof||run.output_limited?"UNKNOWN":run.timed_out?"FAILED":run.cancelled?"CANCELLED":code===0?"SUCCEEDED":code===null?"UNKNOWN":"FAILED";
   resolve();
  });
  run.timer=setTimeout(()=>{run.timed_out=true;void this.terminate(run);},request.time_limit_ms);
  return run;
 }
 private async terminate(run:Run):Promise<boolean>{
  if(run.closed)return run.stopProof;
  if(!this.ownedGroup(run))return false;
  try{process.kill(-run.pid,"SIGTERM");}catch{return false;}
  for(let i=0;i<20;i++){
   if(this.groupAbsent(run))return true;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  // A leader may have exited during the grace period: do NOT signal a
  // potentially reused group ID. Mark UNKNOWN instead.
  if(!this.ownedGroup(run))return this.groupAbsent(run);
  try{process.kill(-run.pid,"SIGKILL");}catch{return false;}
  for(let i=0;i<20;i++){
   if(this.groupAbsent(run))return true;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  return false;
 }
 private get(id:string):Run{
  const run=this.runs.get(id);if(!run)throw Object.assign(Error("Native process unknown"),{code:"PROCESS_NOT_FOUND"});
  return run;
 }
 private statusOf(run:Run):NativeProcessStatus{
  return {state:run.state,exit_code:run.exit_code,started_at:run.started_at,ended_at:run.ended_at,stopped:run.stopProof};
 }
 async execute(request:SandboxedProcessRequest):Promise<SandboxedProcessReceipt>{
  const run=await this.launch(request);await run.settled;
  return {exit_code:run.stopProof?run.exit_code:null,signal:run.signal,stdout:this.buffer(run.stdout),stderr:this.buffer(run.stderr),
   cancelled:run.cancelled&&run.stopProof,timed_out:run.timed_out,output_limited:run.output_limited};
 }
 async cancel(process_id:string,workspace_id:string):Promise<boolean>{
  const run=this.get(process_id);
  if(run.workspace!==workspace_id)throw Error("PROCESS_NOT_OWNED_BY_WORKSPACE");
  run.cancelled=true;
  const groupStopped=await this.terminate(run);
  if(!groupStopped)return false;
  await Promise.race([run.settled,new Promise<void>(resolve=>setTimeout(resolve,1000))]);
  return run.closed&&run.stopProof;
 }
 async start(request:SandboxedProcessRequest):Promise<{native_id:string}>{
  const run=await this.launch(request);return {native_id:run.id};
 }
 async status(nativeId:string):Promise<NativeProcessStatus>{return this.statusOf(this.get(nativeId));}
 async wait(nativeId:string):Promise<NativeProcessStatus>{
  const run=this.get(nativeId);await run.settled;return this.statusOf(run);
 }
 async output(nativeId:string,cursor:number,limit:number):Promise<{stdout:string;stderr:string;next_cursor:number|null}>{
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>65536)throw Error("INVALID_OUTPUT_RANGE");
  const run=this.get(nativeId);
  const stdout=Buffer.from(this.buffer(run.stdout)),stderr=Buffer.from(this.buffer(run.stderr)),all=Buffer.concat([stdout,stderr]);
  if(cursor>all.length||(cursor<all.length&&(all[cursor]&0xc0)===0x80))throw Error("INVALID_OUTPUT_CURSOR");
  let end=Math.min(all.length,cursor+limit);
  while(end>cursor&&end<all.length&&(all[end]&0xc0)===0x80)end--;
  if(end===cursor&&end<all.length)throw Error("INVALID_OUTPUT_UTF8_BOUNDARY");
  return {stdout:all.subarray(cursor,Math.min(end,stdout.length)).toString(),stderr:all.subarray(Math.max(cursor,stdout.length),end).toString(),next_cursor:end<all.length?end:null};
 }
 async stop(nativeId:string):Promise<{stopped:boolean;state:NativeProcessStatus["state"]}>{
  const run=this.get(nativeId);
  if(run.closed)return {stopped:run.stopProof,state:run.state};
  run.cancelled=true;
  const stopped=await this.terminate(run);
  // The close event and group absence both matter; an acknowledged signal is
  // not sufficient to close a durable record.
  if(stopped)await Promise.race([run.settled,new Promise<void>(resolve=>setTimeout(resolve,1000))]);
  if(!run.closed||!run.stopProof)return {stopped:false,state:"UNKNOWN"};
  return {stopped:true,state:run.state};
 }
}
