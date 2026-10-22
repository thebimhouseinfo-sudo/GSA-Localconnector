import type {WorkspacePermission} from "../core/contracts.js";
import path from "node:path";
import fs from "node:fs/promises";
import {loadMacVmRuntime} from "../hosts/macos-vm-runtime.js";
import {loadMacScopedFiles} from "../hosts/macos-scoped-files.js";
import {MacVmCiExecutor} from "../hosts/macos-vm-ci.js";
import type {WorkspaceRegistry} from "../core/workspace.js";
import {identityDirectory} from "../local/identity.js";
import {requirePersistedGrant} from "../local/grants.js";
import {ControlLeaseStore} from "../local/control-lease.js";
import {CiJournalStore} from "../local/ci-store.js";
import {CiSnapshotStore} from "../local/ci-snapshot-store.js";
import {CiLogStore} from "../local/ci-log-store.js";
import {CiArtifactStore} from "../local/ci-artifacts.js";
import {requireCurrentControl} from "./control-context.js";
import {type MacOwner} from "../local/mac-owner.js";
import {createReadOnlyTools,type ToolCall,type ToolResult} from "./server.js";
import type {WorkspaceStartupIssue} from './startup-registry.js';

const hostGit=new Set(["git_status","git_diff","git_log","git_show","compare_commits","git_add","git_commit","create_branch","git_checkout","git_fetch","git_pull","git_push"]);
/** A concurrent durable lease read/renew may briefly own the exclusive lock.
 * Retry that contention only; expired, released and unsafe state fails closed.
 */
export async function authorizeMcpWorkspace(registry:WorkspaceRegistry,workspaceId:string,identityRoot=identityDirectory(),permission:WorkspacePermission="execute"):Promise<void>{
 for(let attempt=0;;attempt++){
  try{await requireCurrentControl();break;}
  catch(error){
   if(attempt>=4||!error||typeof error!=="object"||!("code" in error)||error.code!=="CONTROL_LEASE_LOCKED")throw error;
   await new Promise<void>(resolve=>setTimeout(resolve,25));
  }
 }
 await requirePersistedGrant(registry,workspaceId,identityRoot,permission);
}
/** Production composition. Scoped host files require an existing verified installation; VM commands
 * operate only on disposable Linux copies and never synchronize host edits.
 */
export async function bootstrapMcpTools(registry:WorkspaceRegistry,identityRoot=identityDirectory(),installationRoot=path.join(identityRoot,"native-vm"),owner?:MacOwner,workspaceStartupIssue?:WorkspaceStartupIssue){
 if(owner&&owner.identityRoot!==await fs.realpath(identityRoot))throw Error("SERVER_OWNER_IDENTITY_MISMATCH");
 const controls=new ControlLeaseStore(identityRoot);
 const journal=new CiJournalStore(path.join(identityRoot,"ci-runs"));
 const snapshots=new CiSnapshotStore(path.join(identityRoot,"ci-snapshots"));
 const logs=new CiLogStore(path.join(identityRoot,"ci-logs"));
 const artifacts=new CiArtifactStore(path.join(identityRoot,"ci-artifacts"));
 if(owner){await controls.invalidateAfterOwnerFence(owner.session);await journal.reconcileAfterOwnerFence(owner.session);}
 let runtime:Awaited<ReturnType<typeof loadMacVmRuntime>>|null=null;
 let files:Awaited<ReturnType<typeof loadMacScopedFiles>>|null=null;
 let fileBlockedReason:string|undefined;
 if(process.platform==="darwin"&&owner?.lockFD===3){
  try{files=await loadMacScopedFiles(registry,path.join(identityRoot,"scoped-files"),{ownerLockFD:owner.lockFD,authorize:(workspaceId,permission)=>authorizeMcpWorkspace(registry,workspaceId,identityRoot,permission)});}
  catch(error){fileBlockedReason=error instanceof Error?error.message:"Native file installation unavailable";}
 }else fileBlockedReason="Scoped Mac files require the verified Mac owner lifetime";
 let blockedReason:string|undefined;
 try{runtime=await loadMacVmRuntime(registry,installationRoot,{ownerLockFD:owner?.lockFD,authorize:workspaceId=>authorizeMcpWorkspace(registry,workspaceId,identityRoot)});}
 catch(error){blockedReason=error instanceof Error?error.message:"Native installation unavailable";}
 const executor=runtime?new MacVmCiExecutor(runtime,snapshots,logs,artifacts):null;
 const dispatch=createReadOnlyTools(registry,files,runtime?.sandbox??null,journal,artifacts,logs,runtime?.processes??null,snapshots,runtime?.sourceCapture??null,executor,controls,{grantDirectory:identityRoot,fileBlockedReason});
 const invoke=async(call:ToolCall):Promise<ToolResult>=>{
  if(hostGit.has(call.name))return {isError:true,content:[{type:"text",text:JSON.stringify({ok:false,code:"SECURITY_BLOCKED"})}]};
  const result=await dispatch(call);
  if((owner||workspaceStartupIssue)&&["connector_status","list_capabilities"].includes(call.name)&&!result.isError){
   const body=JSON.parse(result.content[0].text);
   if(owner)body.result.restartRecovery="ci-journal-reconciled; process-journal-pending";
   if(workspaceStartupIssue){body.result.workspaceStartupIssue=workspaceStartupIssue;body.result.workspaceSelectionRequired=true;}
   return {...result,content:[{type:"text",text:JSON.stringify(body)}]};
  }
  if(runtime&&["run_command","start_process"].includes(call.name)&&!result.isError){
   const body=JSON.parse(result.content[0].text);
   if(body.ok)body.result={...body.result,execution_environment:"linux-arm64-vm",workspace_mode:"disposable-snapshot",host_workspace_mutated:false};
   return {...result,content:[{type:"text",text:JSON.stringify(body)}]};
  }
  return result;
 };
 return {invoke,nativeAvailable:runtime!==null,blockedReason,fileNativeAvailable:files!==null,fileBlockedReason};
}
