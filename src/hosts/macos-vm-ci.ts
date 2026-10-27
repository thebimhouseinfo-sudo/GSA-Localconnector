import {createHash} from "node:crypto";
import {validateWorkflow,type CiWorkflow} from "../core/ci-dag.js";
import {parseCiManifest} from "../core/ci-manifest.js";
import {createSnapshotManifest} from "../core/ci-snapshot.js";
import type {CiRunRecord} from "../core/ci-journal.js";
import type {VerifiedCiExecutor} from "../core/ci-run-service.js";
import type {CiSnapshotStore} from "../local/ci-snapshot-store.js";
import type {CiLogStore} from "../local/ci-log-store.js";
import type {CiArtifactStore} from "../local/ci-artifacts.js";
import type {MacVmRuntime} from "./macos-vm-runtime.js";

type Snapshots=Pick<CiSnapshotStore,"verify"|"readVerifiedFile">&{
 readVerifiedEntries(runId:string):Promise<Array<{path:string;bytes:Uint8Array}>>;
};
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function blocked(message:string):never{throw Object.assign(new Error("SECURITY_BLOCKED: "+message),{code:"SECURITY_BLOCKED"});}
/** One guest request preserves build outputs between steps. All commands inherit
 * the native job's UID, cgroup, output budget and overall 120-second deadline.
 * No host shell or mutable Workspace path is consulted by this executor.
 */
function runner(workflow:CiWorkflow):string{
 const {job_order}=validateWorkflow(workflow);
 const jobs=job_order.map(id=>workflow.jobs.find(job=>job.id===id)!);
 const encoded=Buffer.from(JSON.stringify(jobs)).toString("base64");
 return `import base64,json,subprocess,sys\njobs=json.loads(base64.b64decode('${encoded}'))\nfor job in jobs:\n for step in job['steps']:\n  result=subprocess.run([step['command']]+step.get('args',[]),stdin=subprocess.DEVNULL)\n  if result.returncode != 0:\n   sys.exit(result.returncode if 0 < result.returncode < 256 else 1)\n`;
}
export class MacVmCiExecutor implements VerifiedCiExecutor{
 readonly verified=true as const;
 readonly policy_fingerprint:string;
 private readonly active=new Map<string,string>();
 constructor(private readonly runtime:MacVmRuntime,private readonly snapshots:Snapshots,
  private readonly logs:CiLogStore,private readonly artifacts:CiArtifactStore){
  this.policy_fingerprint=runtime.sandbox.policy_fingerprint;
 }
 async execute(run:CiRunRecord,workflow:CiWorkflow):Promise<{exit_code:number|null;source_verified:boolean;artifact_hashes:Readonly<Record<string,string>>;cancelled_verified:boolean}>{
  if(run.state!=="RUNNING"||!run.workflow_binding||this.active.has(run.run_id))blocked("WORKFLOW_PROVENANCE_REQUIRED");
  this.active.set(run.run_id,run.workspace_id);
  try{
  validateWorkflow(workflow);
  const manifest=await this.snapshots.verify(run.run_id);
  if(manifest.source_sha256!==run.source_sha256)blocked("SOURCE_FINGERPRINT_MISMATCH");
  const bytes=await this.snapshots.readVerifiedFile(run.run_id,run.workflow_binding.path);
  if(sha(bytes)!==run.workflow_binding.sha256||JSON.stringify(parseCiManifest(new TextDecoder("utf-8",{fatal:true}).decode(bytes)))!==JSON.stringify(workflow)||
   JSON.stringify(workflow)!==JSON.stringify(run.workflow_binding.document)||workflow.name!==run.workflow)blocked("WORKFLOW_FINGERPRINT_MISMATCH");
  const entries=await this.snapshots.readVerifiedEntries(run.run_id);
  if(createSnapshotManifest(entries).source_sha256!==run.source_sha256)blocked("SOURCE_FINGERPRINT_MISMATCH");
  // Secrets must not silently disappear from an otherwise verified CI snapshot.
  // The runtime filters these paths; rejecting preserves the journal's exact binding.
  if(entries.some(e=>e.path.split("/").some(p=>p.toLowerCase().startsWith(".env")||[".npmrc",".pypirc",".git-credentials",".ssh"].includes(p.toLowerCase()))))blocked("SOURCE_CONTAINS_PROTECTED_PATH");
   const receipt=await this.runtime.executeSnapshot({workspace_id:run.workspace_id,process_id:run.run_id,executable:"/usr/bin/python3",argv:["-I","-c",runner(workflow)],
    cwd_relative:".",time_limit_ms:120000,max_output_bytes:1048576,network_allowed:false,...(workflow.artifacts!==undefined?{artifact_paths:workflow.artifacts}:{})},entries);
   let sequence=0;
   for(const stream of ["stdout","stderr"] as const){
    // Split by code points so each chunk independently respects the UTF-8 cap.
    let chunk="",size=0;
    for(const char of receipt[stream]){
     const length=Buffer.byteLength(char);if(size+length>65536){await this.logs.append(run.run_id,++sequence,stream,chunk);chunk="";size=0;}
     chunk+=char;size+=length;
    }
    if(chunk)await this.logs.append(run.run_id,++sequence,stream,chunk);
   }
   const after=await this.snapshots.verify(run.run_id);
   const source_verified=after.source_sha256===run.source_sha256;
   const outputLimited=(receipt as typeof receipt&{output_limited?:boolean}).output_limited===true;
   const exit_code=receipt.cancelled||receipt.timed_out||receipt.signal!==null||outputLimited||receipt.artifact_error?null:receipt.exit_code;
   const artifact_hashes:Record<string,string>={};
   const generated:Array<{path:string;name:string;sha256:string;size:number}>=[];
   // executeSnapshot resolves only after the VM host confirms a clean stop.
   for(const file of receipt.artifacts??[]){
    const stored=await this.artifacts.ingest(run.run_id,"generated-"+sha(Buffer.from(file.path))+".bin",Buffer.from(file.base64,"base64"));
    if(stored.sha256!==file.sha256)blocked("ARTIFACT_HASH_MISMATCH");
    artifact_hashes[stored.name]=stored.sha256;generated.push({path:file.path,name:stored.name,sha256:stored.sha256,size:file.size});
   }
   const artifact=await this.artifacts.ingest(run.run_id,"execution.json",Buffer.from(JSON.stringify({format:"gsa-native-ci-execution-v1",run_id:run.run_id,workspace_id:run.workspace_id,
    source_sha256:run.source_sha256,workflow_sha256:run.workflow_binding.sha256,source_verified,exit_code,cancelled:receipt.cancelled,timed_out:receipt.timed_out,signal:receipt.signal,
    output_limited:outputLimited,child_exit_code:receipt.exit_code,artifact_error:receipt.artifact_error??null,generated_artifacts:generated,security_verified:false})+"\n"));
   return {exit_code,source_verified,artifact_hashes:{...artifact_hashes,[artifact.name]:artifact.sha256},cancelled_verified:receipt.cancelled};
  }finally{this.active.delete(run.run_id);}
 }
 /** Confirmation means the native VM stopped, never merely a journal update. */
 async cancel(runId:string,workspaceId:string):Promise<{stopped:true}>{
  if(this.active.get(runId)!==workspaceId||!this.runtime.sandbox.cancel||!await this.runtime.sandbox.cancel(runId,workspaceId))blocked("native CI cancellation unconfirmed");
  return {stopped:true};
 }
}
