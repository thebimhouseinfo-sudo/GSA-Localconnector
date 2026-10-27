import {createQueuedRun,transitionRun,type CiRunRecord} from "./ci-journal.js";
import type {CiWorkflow} from "./ci-dag.js";
import {parseCiManifest} from "./ci-manifest.js";
import {createHash} from "node:crypto";
import {CiSourceCaptureService} from "./ci-source-capture.js";
import {CiStoreError} from "../local/ci-store.js";
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
 execute(run:CiRunRecord,workflow:CiWorkflow):Promise<{exit_code:number|null;source_verified:boolean;artifact_hashes?:Readonly<Record<string,string>>;cancelled_verified?:boolean}>;
 cancel?(runId:string,workspaceId:string):Promise<{stopped:true}>;
}
export class CiRunService {
 private readonly tasks=new Map<string,Promise<void>>();
 private readonly executing=new Set<string>();
 private readonly cancelPreparing=new Set<string>();
 constructor(private readonly journal:CiJournalStore,private readonly snapshots:CiSnapshotStore,private readonly executor:VerifiedCiExecutor|null){}
 /** Workflow paths resolve exclusively inside the source snapshot. */
 async submit(workspaceId:string,workflowPath:string,sourceRunId:string):Promise<CiRunRecord>{
  return this.submitPinned(workspaceId,workflowPath,sourceRunId);
 }
 async submitPinned(workspaceId:string,workflowPath:string,sourceRunId:string):Promise<CiRunRecord>{
  if(!this.executor?.verified)throw new NativeBackendUnavailable();
  const snap=await new CiSourceCaptureService(null,this.snapshots,this.journal).requireOwned(workspaceId,sourceRunId);
  const bytes=await this.snapshots.readVerifiedFile(sourceRunId,workflowPath);
  const workflow=parseCiManifest(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  const queued:CiRunRecord=Object.freeze({...createQueuedRun(workspaceId,workflow.name,snap.source_sha256),
   source_run_id:sourceRunId,workflow_binding:{path:workflowPath,
    sha256:createHash("sha256").update(bytes).digest("hex"),document:structuredClone(workflow)}});
  const copy=await this.snapshots.duplicateVerified(sourceRunId,queued.run_id);
  if(copy.source_sha256!==queued.source_sha256)throw Error("SOURCE_FINGERPRINT_MISMATCH");
  await this.journal.save(queued,null);
  this.schedule(queued);
  return queued;
 }
 async rerunFailed(workspaceId:string,runId:string):Promise<CiRunRecord>{
  if(!this.executor?.verified)throw new NativeBackendUnavailable();
  const previous=await this.journal.load(runId);
  if(previous.workspace_id!==workspaceId)throw new CiStoreError("RUN_NOT_FOUND","Run not owned by Workspace");
  await this.boundWorkflow(previous);
  const queued=await this.journal.prepareRerun(runId,workspaceId,this.snapshots);
  this.schedule(queued);
  return queued;
 }
 private async boundWorkflow(run:CiRunRecord):Promise<CiWorkflow>{
  if(!run.workflow_binding)throw Error("WORKFLOW_PROVENANCE_REQUIRED");
  const manifest=await this.snapshots.verify(run.run_id);
  if(manifest.source_sha256!==run.source_sha256)throw Error("SOURCE_FINGERPRINT_MISMATCH");
  const bytes=await this.snapshots.readVerifiedFile(run.run_id,run.workflow_binding.path);
  if(createHash("sha256").update(bytes).digest("hex")!==run.workflow_binding.sha256)throw Error("WORKFLOW_FINGERPRINT_MISMATCH");
  const workflow=parseCiManifest(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  if(JSON.stringify(workflow)!==JSON.stringify(run.workflow_binding.document)||workflow.name!==run.workflow)
   throw Error("WORKFLOW_FINGERPRINT_MISMATCH");
  return workflow;
 }
 private schedule(queued:CiRunRecord):void{
  const task=this.execute(queued).finally(()=>{this.tasks.delete(queued.run_id);this.cancelPreparing.delete(queued.run_id);});
  this.tasks.set(queued.run_id,task);
 }
 private async execute(queued:CiRunRecord):Promise<void>{
  let state=queued;
  try{
   state=transitionRun(state,"PREPARING",state.revision);await this.journal.save(state,state.revision-1);
   const workflow=await this.boundWorkflow(state);
   if(this.cancelPreparing.has(state.run_id)){
    const cancelled=transitionRun(state,"CANCELLED",state.revision);await this.journal.save(cancelled,state.revision);return;
   }
   state=transitionRun(state,"RUNNING",state.revision);await this.journal.save(state,state.revision-1);
   if(this.cancelPreparing.has(state.run_id)){
    const cancelled=transitionRun(state,"CANCELLED",state.revision);await this.journal.save(cancelled,state.revision);return;
   }
   this.executing.add(state.run_id);
   let result:Awaited<ReturnType<VerifiedCiExecutor["execute"]>>;
   try{result=await this.executor!.execute(state,workflow);}finally{this.executing.delete(state.run_id);}
   const hashes=result.artifact_hashes??{};
   if(!hashes||typeof hashes!=="object"||Array.isArray(hashes)||Object.entries(hashes).some(([name,hash])=>!name||typeof hash!=="string"||!/^[a-f0-9]{64}$/.test(hash)))throw Error("INVALID_ARTIFACT_EVIDENCE");
   if(result.cancelled_verified===true){
    state=transitionRun(state,"CANCELLED",state.revision);
   }else if(!result.source_verified||result.exit_code===null){
    state=transitionRun(state,"UNKNOWN",state.revision);
   }else if(result.exit_code===0){
    state=transitionRun(state,"PASSED",state.revision,undefined,{exit_code:0,artifact_hashes:hashes});
   }else{
    state=transitionRun(state,"FAILED",state.revision,undefined,{exit_code:result.exit_code,artifact_hashes:hashes});
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
 async cancel(workspaceId:string,runId:string):Promise<CiRunRecord>{
  const run=await this.journal.load(runId);
  if(run.workspace_id!==workspaceId)throw new CiStoreError("RUN_NOT_FOUND","Run not owned by Workspace");
  if(!this.tasks.has(runId))return this.journal.cancelQueued(runId,workspaceId);
  if(this.executing.has(runId)){
   if(!this.executor?.cancel)throw new NativeBackendUnavailable();
   const confirmed=await this.executor.cancel(runId,workspaceId);
   if(confirmed.stopped!==true)throw new NativeBackendUnavailable();
  }else{
   // No native request has started. execute checks this flag after every await
   // before crossing the process boundary.
   this.cancelPreparing.add(runId);
  }
  await this.settle(runId);
  const completed=await this.journal.load(runId);
  if(completed.state!=="CANCELLED")throw new CiStoreError("RUN_REVISION_CONFLICT","Run completed without verified cancellation");
  return completed;
 }
}
