import {createQueuedRun,transitionRun,type CiRunRecord} from "./ci-journal.js";
import type {CiWorkflow} from "./ci-dag.js";
import {validateWorkflow} from "./ci-dag.js";
import type {CiJournalStore} from "../local/ci-store.js";
import type {CiSnapshotStore} from "../local/ci-snapshot-store.js";
import {NativeBackendUnavailable} from "./native-io.js";

/** Host-enforced CI executor: must prove snapshot source is immutable, run a
 * distinct writable copy and confine all child operations at the OS boundary.
 * A TypeScript mock does NOT provide native security certification.
 */
export interface VerifiedCiExecutor {
 readonly verified:true;
 readonly policy_fingerprint:string;
 execute(run:CiRunRecord,workflow:CiWorkflow):Promise<{exit_code:number|null;source_verified:boolean}>;
}
export class CiRunService {
 private readonly tasks=new Map<string,Promise<void>>();
 constructor(private readonly journal:CiJournalStore,private readonly snapshots:CiSnapshotStore,private readonly executor:VerifiedCiExecutor|null){}
 /** Returns a queued run ID quickly. No execution when the executor is absent. */
 async submit(workspaceId:string,workflow:CiWorkflow,sourceRunId:string):Promise<CiRunRecord>{
  if(!this.executor?.verified)throw new NativeBackendUnavailable();
  validateWorkflow(workflow);
  const snap=await this.snapshots.verify(sourceRunId);
  const queued=createQueuedRun(workspaceId,workflow.name,snap.source_sha256);
  await this.snapshots.duplicateVerified(sourceRunId,queued.run_id);
  await this.journal.save(queued,null);
  const task=this.execute(queued,workflow).finally(()=>this.tasks.delete(queued.run_id));
  this.tasks.set(queued.run_id,task);
  return queued;
 }
 private async execute(queued:CiRunRecord,workflow:CiWorkflow):Promise<void>{
  let state=queued;
  try{
   state=transitionRun(state,"PREPARING",state.revision);await this.journal.save(state,state.revision-1);
   state=transitionRun(state,"RUNNING",state.revision);await this.journal.save(state,state.revision-1);
   const result=await this.executor!.execute(state,workflow);
   if(!result.source_verified||result.exit_code===null){
    state=transitionRun(state,"UNKNOWN",state.revision);
   }else if(result.exit_code===0){
    state=transitionRun(state,"PASSED",state.revision,undefined,{exit_code:0,artifact_hashes:{}});
   }else{
    state=transitionRun(state,"FAILED",state.revision,undefined,{exit_code:result.exit_code,artifact_hashes:{}});
   }
   await this.journal.save(state,state.revision-1);
  }catch{
   // No blind retry of uncertain process outcomes. Recovery reconciles to UNKNOWN.
   if(["PREPARING","RUNNING"].includes(state.state)){
    try{
     const latest=await this.journal.load(state.run_id);
     if(["PREPARING","RUNNING"].includes(latest.state)){
      const unknown=transitionRun(latest,"UNKNOWN",latest.revision);
      await this.journal.save(unknown,latest.revision);
     }
    }catch{/* Leave for startup reconciliation; do not claim success. */}
   }
  }
 }
 async settle(runId:string):Promise<void>{await this.tasks.get(runId);}
}
