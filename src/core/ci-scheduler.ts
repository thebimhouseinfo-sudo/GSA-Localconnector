import {BoundedEvidence} from "./ci-evidence.js";
import {createQueuedRun,transitionRun,type CiRunRecord} from "./ci-journal.js";
import {validateWorkflow,type CiWorkflow} from "./ci-dag.js";
import {requireNativeBackend,type VerifiedNativeSandbox,type SandboxedProcessRequest} from "./native-io.js";
export interface CiScheduleResult {record:CiRunRecord;logs:BoundedEvidence;finished_jobs:readonly string[]}
export class CiRunError extends Error{constructor(public readonly code:"CI_FAILED"|"CI_INVALID",message:string){super(message);}}
/** Per-call reference scheduler. Real durable CI also needs protected snapshots and journals,
 * so this helper is NOT exposed as ci_run until host-native evidence storage is proven.
 */
export async function scheduleValidatedCI(native:VerifiedNativeSandbox|null,workspaceId:string,workflow:CiWorkflow,sourceFingerprint:string):Promise<CiScheduleResult>{
 const runner=requireNativeBackend(native);
 const parsed=validateWorkflow(workflow);
 let run=createQueuedRun(workspaceId,workflow.name,sourceFingerprint);
 const logs=new BoundedEvidence(run.run_id);
 const completed:string[]=[];
 run=transitionRun(run,"PREPARING",run.revision);
 run=transitionRun(run,"RUNNING",run.revision);
 for(const jobId of parsed.job_order){
  const job=workflow.jobs.find(j=>j.id===jobId)!;
  for(const step of job.steps??[]){
   const request:SandboxedProcessRequest={workspace_id:workspaceId,executable:step.command,argv:step.args??[],cwd_relative:".",time_limit_ms:120000,max_output_bytes:65536,network_allowed:false};
   let out;
   try{out=await runner.execute(request);}
   catch{
    run=transitionRun(run,"UNKNOWN",run.revision);
    return {record:run,logs,finished_jobs:completed};
   }
   // Never discard a real execution outcome because evidence capture exceeded a quota.
   // The operation cannot be certified when its evidence is incomplete.
   try{
    if(Buffer.byteLength(out.stdout,"utf8")+Buffer.byteLength(out.stderr,"utf8")>request.max_output_bytes)
      throw Error("CI_OUTPUT_LIMIT");
    if(out.stdout)logs.append("stdout",out.stdout);
    if(out.stderr)logs.append("stderr",out.stderr);
   }catch{
    run=transitionRun(run,"UNKNOWN",run.revision);
    return {record:run,logs,finished_jobs:completed};
   }
   if(out.exit_code===null||out.output_limited||out.signal!==null||(out.timed_out&&out.exit_code===0)){
    run=transitionRun(run,"UNKNOWN",run.revision);return {record:run,logs,finished_jobs:completed};
   }
   if(out.cancelled){
    run=transitionRun(run,"CANCELLED",run.revision);return {record:run,logs,finished_jobs:completed};
   }
   if(out.timed_out||out.exit_code!==0){
    run=transitionRun(run,"FAILED",run.revision,undefined,{exit_code:out.exit_code??1,artifact_hashes:{}});
    return {record:run,logs,finished_jobs:completed};
   }
  }
  completed.push(jobId);
 }
 run=transitionRun(run,"PASSED",run.revision,undefined,{exit_code:0,artifact_hashes:{}});
 return {record:run,logs,finished_jobs:completed};
}
