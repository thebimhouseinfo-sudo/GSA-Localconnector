import type {NativeScopedFiles,NativeDirectoryCopies} from "../core/native-io.js";
import {loadCheckedMacDirectoryInstallation} from "../hosts/macos-directory-installation.js";
import type {WorkspacePermission} from "../core/contracts.js";
import path from "node:path";
import fs from "node:fs/promises";
import {MacNativeCommands} from "../hosts/macos-host-commands.js";
import {loadMacScopedFiles} from "../hosts/macos-scoped-files.js";

import type {WorkspaceRegistry} from "../core/workspace.js";
import {identityDirectory} from "../local/identity.js";
import {requirePersistedGrant,recoverServerGrantLock} from "../local/grants.js";
import {ControlLeaseStore} from "../local/control-lease.js";
import {CiJournalStore,CiStoreError} from "../local/ci-store.js";
import {ProcessJournalStore} from "../local/process-store.js";
import {CiSnapshotStore} from "../local/ci-snapshot-store.js";
import {CiLogStore} from "../local/ci-log-store.js";
import {CiArtifactStore} from "../local/ci-artifacts.js";
import {requireCurrentControl} from "./control-context.js";
import {type MacOwner} from "../local/mac-owner.js";
import {createReadOnlyTools,type ToolCall,type ToolResult} from "./server.js";
import {inspectStartupIssue,type WorkspaceStartupIssue} from './startup-registry.js';


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
/** Explicit bound facade preserves private class receivers across composition. */
export function withMacDirectoryCopies(base:NativeScopedFiles,directoryCopies:NativeDirectoryCopies):NativeScopedFiles {
 const recovery=base.recoverableMutations;
 const legacy=["create_file","update_file","edit_file","apply_patch","create_directory","delete_file","copy_file","move_file"] as const;
 return {
  supportedOperations:Object.freeze([...new Set([...(base.supportedOperations??legacy),"copy_directory" as const])]),
  read:base.read.bind(base),createExclusive:base.createExclusive.bind(base),replaceIfHash:base.replaceIfHash.bind(base),makeDirectory:base.makeDirectory.bind(base),copyExclusive:base.copyExclusive.bind(base),moveExclusive:base.moveExclusive.bind(base),trashIfHash:base.trashIfHash.bind(base),
  ...(recovery?{recoverableMutations:{replaceIfHash:recovery.replaceIfHash.bind(recovery),trashIfHash:recovery.trashIfHash.bind(recovery),...(recovery.readTransaction?{readTransaction:recovery.readTransaction.bind(recovery)}:{})}}:{}),
  directoryCopies:{inspect:directoryCopies.inspect.bind(directoryCopies),copy:directoryCopies.copy.bind(directoryCopies),readCopy:directoryCopies.readCopy.bind(directoryCopies)}
 };
}
/** Production native Mac command composition; never launches the legacy product VM.
 * Shell processes run as the logged-in user and are not OS-confined.
 */
export async function bootstrapMcpTools(registry:WorkspaceRegistry,identityRoot=identityDirectory(),installationRoot=identityRoot,owner?:MacOwner,workspaceStartupIssue?:WorkspaceStartupIssue,fileLoaders?:{base:typeof loadMacScopedFiles;directory:typeof loadCheckedMacDirectoryInstallation}){
 if(owner&&owner.identityRoot!==await fs.realpath(identityRoot))throw Error("SERVER_OWNER_IDENTITY_MISMATCH");
 const controls=new ControlLeaseStore(identityRoot);
 const journal=new CiJournalStore(path.join(identityRoot,"ci-runs"));
 const snapshots=new CiSnapshotStore(path.join(identityRoot,"ci-snapshots"));
 const logs=new CiLogStore(path.join(identityRoot,"ci-logs"));
 const artifacts=new CiArtifactStore(path.join(identityRoot,"ci-artifacts"));
 const processPersistence=process.platform==="darwin"&&owner?.lockFD===3?{store:new ProcessJournalStore(path.join(identityRoot,"process-runs")),ownerSession:owner.session}:undefined;
 let ciDegraded=false;
 if(owner){
  await controls.invalidateAfterOwnerFence(owner.session);
  // The kernel owner fence proves every older server dead, so only its grant lock
  // is stale. Desktop, unparseable and current-session locks are left alone.
  try{await recoverServerGrantLock(identityRoot,owner.session);}catch{/* an unsafe lock stays visible through inspect_workspace_recovery */}
  try{await journal.reconcileAfterOwnerFence(owner.session);}
  catch(error){
   if(!(error instanceof SyntaxError)&&!(error instanceof CiStoreError&&error.code==="INVALID_RUN_RECORD"))throw error;
   ciDegraded=true;
  }
 }
 if(processPersistence)await processPersistence.store.reconcileAfterOwnerFence(processPersistence.ownerSession);
 let runtime:MacNativeCommands|null=null;
 let files:Awaited<ReturnType<typeof loadMacScopedFiles>>|null=null;
 let fileBlockedReason:string|undefined;
 let directoryCopyBlockedReason:string|undefined;
 const reloadFiles=async()=>{
  // An earlier signed backend must never survive changed durable scope.
  files=null;
  fileBlockedReason=undefined;
  directoryCopyBlockedReason=undefined;
  if(process.platform==="darwin"&&owner?.lockFD===3){
   try{
    const authorize=(workspaceId:string,permission:WorkspacePermission)=>authorizeMcpWorkspace(registry,workspaceId,identityRoot,permission);
    const base=await (fileLoaders?.base??loadMacScopedFiles)(registry,path.join(identityRoot,"scoped-files"),{ownerLockFD:owner.lockFD,authorize});
    files=base;
    try{
     const directory=await (fileLoaders?.directory??loadCheckedMacDirectoryInstallation)(registry,path.join(identityRoot,"directory-copy"),base,{ownerLockFD:owner.lockFD,authorize});
     files=withMacDirectoryCopies(base,directory);
    }catch(error){directoryCopyBlockedReason=error instanceof Error?error.message:"Directory copy installation unavailable";}
   }
   catch(error){fileBlockedReason=error instanceof Error?error.message:"Native file installation unavailable";}
  }else fileBlockedReason="Scoped Mac files require the verified Mac owner lifetime";
  if(!files)directoryCopyBlockedReason=fileBlockedReason;
 };
 await reloadFiles();
 let blockedReason:string|undefined;
 void installationRoot; // Retain stable argument position for existing callers; legacy VM is disabled.
 if(process.platform==="darwin"&&owner?.lockFD===3){
  try{runtime=new MacNativeCommands(registry);}
  catch(error){blockedReason=error instanceof Error?error.message:"Mac host command adapter unavailable";}
 }else blockedReason="Native Mac command runner requires verified owner session";
 const dispatch=createReadOnlyTools(registry,files,runtime,journal,artifacts,logs,runtime,snapshots,null,null,controls,{
  grantDirectory:identityRoot,
  processPersistence,
  fileBackendState:()=>({files,fileBlockedReason,directoryCopyBlockedReason}),
  onScopeChanged:async kind=>{
   // A selected bind may resolve its own pending issue but not unrelated stale
   // pins. Unbinding cannot prove that an initial recovery warning was resolved.
   const remaining=await inspectStartupIssue(identityRoot);
   if(kind==="bind")workspaceStartupIssue=remaining;
   else if(remaining)workspaceStartupIssue=remaining;
   await reloadFiles();
  }
 });
 const invoke=async(call:ToolCall):Promise<ToolResult>=>{
  if(ciDegraded&&["ci_prepare_source","ci_run","ci_rerun_failed","ci_cancel"].includes(call.name))return {isError:true,content:[{type:"text",text:JSON.stringify({ok:false,code:"CI_JOURNAL_DEGRADED"})}]};
  // Local Git is admitted by existing current-controller, workspace grant and Git plan checks.
  // Network Git remains independently blocked by gitPlan without explicit authorization.
  const result=await dispatch(call);
  if((owner||workspaceStartupIssue)&&["connector_status","list_capabilities"].includes(call.name)&&!result.isError){
   const body=JSON.parse(result.content[0].text);
   if(processPersistence){
    body.result.processRecovery=processPersistence.store.health();
    body.result.restartRecovery=body.result.processRecovery.admission_blocked?"degraded-process-journal":(ciDegraded?"degraded-ci-journal":"ci-journal-reconciled")+"; async-process-journal-reconciled; native-tree-recovery-not-certified";
   }
   if(ciDegraded)body.result.ciRecovery="degraded";
   if(workspaceStartupIssue){body.result.workspaceStartupIssue=workspaceStartupIssue;body.result.workspaceSelectionRequired=true;}
   return {...result,content:[{type:"text",text:JSON.stringify(body)}]};
  }
  if(runtime&&["run_command","start_process"].includes(call.name)&&!result.isError){
   const body=JSON.parse(result.content[0].text);
   if(body.ok)body.result={...body.result,execution_environment:"macos-native",workspace_mode:"host-workspace",command_confinement:"none (user account)",state_integrity_vs_commands:"not_protected"};
   return {...result,content:[{type:"text",text:JSON.stringify(body)}]};
  }
  return result;
 };
 return {invoke,nativeAvailable:runtime!==null,blockedReason,get fileNativeAvailable(){return files!==null;},get fileBlockedReason(){return fileBlockedReason;},get directoryCopyBlockedReason(){return directoryCopyBlockedReason;}};
}
