import type {NativeScopedFiles,NativeDirectoryCopies} from "../core/native-io.js";
import {loadCheckedMacDirectoryInstallation} from "../hosts/macos-directory-installation.js";
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
import {ProcessJournalStore} from "../local/process-store.js";
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
/** Production composition. Scoped host files require an existing verified installation; VM commands
 * operate only on disposable Linux copies and never synchronize host edits.
 */
export async function bootstrapMcpTools(registry:WorkspaceRegistry,identityRoot=identityDirectory(),installationRoot=path.join(identityRoot,"native-vm"),owner?:MacOwner,workspaceStartupIssue?:WorkspaceStartupIssue,fileLoaders?:{base:typeof loadMacScopedFiles;directory:typeof loadCheckedMacDirectoryInstallation}){
 if(owner&&owner.identityRoot!==await fs.realpath(identityRoot))throw Error("SERVER_OWNER_IDENTITY_MISMATCH");
 const controls=new ControlLeaseStore(identityRoot);
 const journal=new CiJournalStore(path.join(identityRoot,"ci-runs"));
 const snapshots=new CiSnapshotStore(path.join(identityRoot,"ci-snapshots"));
 const logs=new CiLogStore(path.join(identityRoot,"ci-logs"));
 const artifacts=new CiArtifactStore(path.join(identityRoot,"ci-artifacts"));
 const processPersistence=process.platform==="darwin"&&owner?.lockFD===3?{store:new ProcessJournalStore(path.join(identityRoot,"process-runs")),ownerSession:owner.session}:undefined;
 if(owner){await controls.invalidateAfterOwnerFence(owner.session);await journal.reconcileAfterOwnerFence(owner.session);}
 if(processPersistence)await processPersistence.store.reconcileAfterOwnerFence(processPersistence.ownerSession);
 let runtime:Awaited<ReturnType<typeof loadMacVmRuntime>>|null=null;
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
 try{runtime=await loadMacVmRuntime(registry,installationRoot,{ownerLockFD:owner?.lockFD,authorize:workspaceId=>authorizeMcpWorkspace(registry,workspaceId,identityRoot)});}
 catch(error){blockedReason=error instanceof Error?error.message:"Native installation unavailable";}
 const executor=runtime?new MacVmCiExecutor(runtime,snapshots,logs,artifacts):null;
 const dispatch=createReadOnlyTools(registry,files,runtime?.sandbox??null,journal,artifacts,logs,runtime?.processes??null,snapshots,runtime?.sourceCapture??null,executor,controls,{
  grantDirectory:identityRoot,
  processPersistence,
  fileBackendState:()=>({files,fileBlockedReason,directoryCopyBlockedReason}),
  onScopeChanged:async kind=>{
   if(kind==="bind")workspaceStartupIssue=undefined;
   await reloadFiles();
  }
 });
 const invoke=async(call:ToolCall):Promise<ToolResult>=>{
  if(hostGit.has(call.name))return {isError:true,content:[{type:"text",text:JSON.stringify({ok:false,code:"SECURITY_BLOCKED"})}]};
  const result=await dispatch(call);
  if((owner||workspaceStartupIssue)&&["connector_status","list_capabilities"].includes(call.name)&&!result.isError){
   const body=JSON.parse(result.content[0].text);
   if(processPersistence)body.result.restartRecovery="ci-journal-reconciled; async-process-journal-reconciled; native-tree-recovery-not-certified";
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
 return {invoke,nativeAvailable:runtime!==null,blockedReason,get fileNativeAvailable(){return files!==null;},get fileBlockedReason(){return fileBlockedReason;},get directoryCopyBlockedReason(){return directoryCopyBlockedReason;}};
}
