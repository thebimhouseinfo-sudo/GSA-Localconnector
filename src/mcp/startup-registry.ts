import {ConnectorError} from '../core/contracts.js';
import {WorkspaceRegistry} from '../core/workspace.js';
import {loadTrustedRegistry,inspectTrustedWorkspaceRecovery} from '../local/grants.js';
import {protectedStateCapability} from '../local/protected-state.js';
import {identityDirectory} from '../local/identity.js';

export type WorkspaceStartupIssue='WORKSPACE_ROOT_CHANGED'|'WORKSPACE_ROOT_UNAVAILABLE';
/** Preserve incomplete-recovery diagnostics while independent valid roots stay
 * available. A retained stale grant is NEVER counted as active authority. */
export async function inspectStartupIssue(identityRoot=identityDirectory()):Promise<WorkspaceStartupIssue|undefined>{
 if(!protectedStateCapability().available)return undefined;
 const entries=await inspectTrustedWorkspaceRecovery(identityRoot);
 if(entries.some(item=>item.state==="STALE"&&item.reason!=="ROOT_NOT_FOUND"))return 'WORKSPACE_ROOT_CHANGED';
 if(entries.some(item=>item.state==="STALE"||item.state==="REAUTH_REQUIRED"))return 'WORKSPACE_ROOT_UNAVAILABLE';
 return undefined;
}
/** Import only currently verified roots. Invalid protected-store structure still
 * fails closed, and a race on an ACTIVE root never silently grants authority. */
export async function loadStartupRegistry(identityRoot=identityDirectory()):Promise<{registry:WorkspaceRegistry;workspaceStartupIssue?:WorkspaceStartupIssue}>{
 try{
  const registry=await loadTrustedRegistry(identityRoot);
  const workspaceStartupIssue=await inspectStartupIssue(identityRoot);
  return workspaceStartupIssue?{registry,workspaceStartupIssue}:{registry};
 }catch(error){
  if(!(error instanceof ConnectorError)||error.code!=="SOURCE_UNVERIFIED")throw error;
  const issue=error.message.startsWith("Workspace root identity changed: ")?"WORKSPACE_ROOT_CHANGED"
   :error.message.startsWith("Workspace root identity unavailable: ")?"WORKSPACE_ROOT_UNAVAILABLE":undefined;
  if(!issue)throw error;
  return {registry:new WorkspaceRegistry(),workspaceStartupIssue:issue};
 }
}
