import {createHash,randomUUID} from "node:crypto";
export type RunState="QUEUED"|"PREPARING"|"RUNNING"|"PASSED"|"FAILED"|"CANCELLED"|"BLOCKED"|"UNKNOWN";
const transitions:Record<RunState,RunState[]>={
 QUEUED:["PREPARING","CANCELLED","BLOCKED"],
 PREPARING:["RUNNING","FAILED","CANCELLED","BLOCKED","UNKNOWN"],
 RUNNING:["PASSED","FAILED","CANCELLED","BLOCKED","UNKNOWN"],
 PASSED:[],FAILED:[],CANCELLED:[],BLOCKED:[],UNKNOWN:[]
};
export interface CiRunRecord {
 readonly run_id:string;readonly workspace_id:string;readonly workflow:string;
 readonly source_sha256:string;readonly created_at:string;readonly updated_at:string;
 readonly state:RunState;readonly revision:number;readonly rerun_of?:string;readonly evidence?:{exit_code:number;artifact_hashes:Readonly<Record<string,string>>};
}
export class CiStateError extends Error {constructor(message:string){super(message);this.name="CiStateError";}}
export function sourceFingerprint(entries:ReadonlyArray<{path:string;sha256:string}>):string {
 const seen=new Set<string>();
 for(const e of entries){
  if(!e.path||e.path.startsWith("/")||e.path.split("/").some(p=>!p||p==="."||p==="..")||! /^[0-9a-f]{64}$/.test(e.sha256)||seen.has(e.path))throw new CiStateError("INVALID_INPUT_MANIFEST");
  seen.add(e.path);
 }
 return createHash("sha256").update(JSON.stringify([...entries].sort((a,b)=>a.path.localeCompare(b.path)))).digest("hex");
}
export function createQueuedRun(workspace_id:string,workflow:string,source_sha256:string,now=new Date()):CiRunRecord {
 if(!workspace_id||!workflow||! /^[0-9a-f]{64}$/.test(source_sha256))throw new CiStateError("INVALID_RUN_INPUT");
 const time=now.toISOString();
 return Object.freeze({run_id:randomUUID(),workspace_id,workflow,source_sha256,created_at:time,updated_at:time,state:"QUEUED",revision:1});
}
export function transitionRun(run:CiRunRecord,next:RunState,expectedRevision:number,now=new Date(),evidence?:CiRunRecord["evidence"]):CiRunRecord {
 if(run.revision!==expectedRevision)throw new CiStateError("RUN_REVISION_CONFLICT");
 if(!transitions[run.state].includes(next))throw new CiStateError("INVALID_STATE_TRANSITION");
 if(next==="PASSED"&&(!evidence||evidence.exit_code!==0))throw new CiStateError("PASS_REQUIRES_ZERO_EXIT_EVIDENCE");
 if(next==="FAILED"&&evidence&&evidence.exit_code===0)throw new CiStateError("FAILED_EXIT_CONFLICT");
 return Object.freeze({...run,state:next,updated_at:now.toISOString(),revision:run.revision+1,...(evidence?{evidence}: {})});
}

/** After a host crash, execution evidence is incomplete. Never silently resume
 * a RUNNING or PREPARING job or label it successful.
 */
export function reconcileInterruptedRun(run:CiRunRecord,now=new Date()):CiRunRecord{
 if(run.state==="RUNNING"||run.state==="PREPARING")
   return transitionRun(run,"UNKNOWN",run.revision,now);
 return run;
}

/** Rerun is a NEW revision-bound queue record, never reuse the failed run ID.
 * Caller must separately revalidate the immutable source snapshot fingerprint.
 */
export function prepareFailedRerun(failed:CiRunRecord,verifiedSourceSha:string):CiRunRecord{
 if(failed.state!=="FAILED"||failed.source_sha256!==verifiedSourceSha)throw new CiStateError("RERUN_REQUIRES_FAILED_VERIFIED_SOURCE");
 return Object.freeze({...createQueuedRun(failed.workspace_id,failed.workflow,verifiedSourceSha),rerun_of:failed.run_id});
}
