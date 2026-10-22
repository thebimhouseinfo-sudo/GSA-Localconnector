import {ConnectorError} from '../core/contracts.js';
import {WorkspaceRegistry} from '../core/workspace.js';
import {loadTrustedRegistry} from '../local/grants.js';
import {identityDirectory} from '../local/identity.js';

export type WorkspaceStartupIssue='WORKSPACE_ROOT_CHANGED'|'WORKSPACE_ROOT_UNAVAILABLE';

/** A stale root must deny all workspace authority without killing transport.
 * Durable pins remain untouched. Unsafe/malformed stores still fail startup.
 */
export async function loadStartupRegistry(identityRoot=identityDirectory()):Promise<{registry:WorkspaceRegistry;workspaceStartupIssue?:WorkspaceStartupIssue}>{
 try{return {registry:await loadTrustedRegistry(identityRoot)};}
 catch(error){
  if(!(error instanceof ConnectorError)||error.code!=='SOURCE_UNVERIFIED')throw error;
  const issue=error.message==='Workspace root identity changed'?'WORKSPACE_ROOT_CHANGED'
   :error.message==='Workspace root identity unavailable'?'WORKSPACE_ROOT_UNAVAILABLE':undefined;
  if(!issue)throw error;
  return {registry:new WorkspaceRegistry(),workspaceStartupIssue:issue};
 }
}
