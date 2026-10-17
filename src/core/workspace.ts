import path from "node:path";
import fs from "node:fs/promises";
import {validateWorkspaceRelative} from "./workspace-path.js";
import { ConnectorError, type WorkspaceGrant, type WorkspacePermission } from "./contracts.js";

/** Use platform path rules; canonicalize EXISTING targets. Never treat this alone as a sandbox. */
export class WorkspaceRegistry {
  private readonly grants = new Map<string, WorkspaceGrant>();
  private readonly revisions = new Map<string, number>();
  constructor(private readonly pathApi: typeof path = path) {}

  /** Trusted local enrollment only; never expose via an ordinary MCP tool. */
  async enrollTrusted(id: string, root: string, permissions: readonly WorkspacePermission[]): Promise<WorkspaceGrant> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) throw new ConnectorError("WORKSPACE_NOT_FOUND", "Invalid workspace ID");
    if (!this.pathApi.isAbsolute(root)) throw new ConnectorError("PATH_OUTSIDE_SCOPE", "Root must be absolute");
    const canonicalRoot = await fs.realpath(root);
    const rootStat=await fs.stat(canonicalRoot,{bigint:true});
    if(!rootStat.isDirectory())throw new ConnectorError("PATH_OUTSIDE_SCOPE","Workspace root must be a directory");
    const rootIdentity=Object.freeze({device:String(rootStat.dev),inode:String(rootStat.ino)});
    const revision=(this.revisions.get(id)??0)+1;
    if(!Number.isSafeInteger(revision))throw new ConnectorError("SOURCE_UNVERIFIED","Workspace revision exhausted");
    const grant: WorkspaceGrant = Object.freeze({ id, canonicalRoot, rootIdentity, permissions: Object.freeze([...new Set(permissions)]), revision });
    this.grants.set(id, grant);this.revisions.set(id,grant.revision);
    return grant;
  }
  /** Import a durable pin without authorizing the directory currently at its path. */
  async importTrusted(grant:WorkspaceGrant):Promise<WorkspaceGrant>{
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(grant.id)||!this.pathApi.isAbsolute(grant.canonicalRoot)||
       !Number.isSafeInteger(grant.revision)||grant.revision<1||
       ![grant.rootIdentity.device,grant.rootIdentity.inode].every(value=>typeof value==="string"&&/^(0|[1-9][0-9]{0,31})$/.test(value))||
       grant.permissions.some(value=>!["read","write","execute"].includes(value)))
      throw new ConnectorError("SOURCE_UNVERIFIED","Invalid persisted Workspace grant");
    const canonical=await fs.realpath(grant.canonicalRoot),info=await fs.lstat(grant.canonicalRoot,{bigint:true});
    if(canonical!==grant.canonicalRoot||!info.isDirectory()||String(info.dev)!==grant.rootIdentity.device||String(info.ino)!==grant.rootIdentity.inode)
      throw new ConnectorError("SOURCE_UNVERIFIED","Workspace root identity changed");
    if(grant.revision<(this.revisions.get(grant.id)??0))throw new ConnectorError("SOURCE_UNVERIFIED","Workspace revision decreased");
    const pinned:WorkspaceGrant=Object.freeze({...grant,rootIdentity:Object.freeze({...grant.rootIdentity}),permissions:Object.freeze([...grant.permissions])});
    this.grants.set(pinned.id,pinned);this.revisions.set(pinned.id,pinned.revision);return pinned;
  }
  list(): readonly WorkspaceGrant[] { return [...this.grants.values()]; }
  get(id: string): WorkspaceGrant | undefined { return this.grants.get(id); }
  revoke(id: string): void {
    if(this.grants.has(id))this.revisions.set(id,(this.revisions.get(id)??0)+1);
    this.grants.delete(id);
  }
  requireGrant(id: string, permission: WorkspacePermission): WorkspaceGrant {
    const grant = this.grants.get(id);
    if (!grant) throw new ConnectorError("WORKSPACE_NOT_FOUND", "Unknown workspace");
    if (!grant.permissions.includes(permission)) throw new ConnectorError("PERMISSION_DENIED", "Permission not granted");
    return grant;
  }
  /** Read-only bootstrap resolver; writes/CI need handle-relative protection and native isolation. */
  async resolveExistingRead(id: string, relative: string): Promise<string> {
    const grant = this.requireGrant(id, "read");
    validateWorkspaceRelative(relative,true);
    const currentRoot=await fs.stat(grant.canonicalRoot,{bigint:true});
    if(String(currentRoot.dev)!==grant.rootIdentity.device||String(currentRoot.ino)!==grant.rootIdentity.inode)
      throw new ConnectorError("SOURCE_UNVERIFIED","Workspace root identity changed");
    if(relative===".")return grant.canonicalRoot;
    const candidate = await fs.realpath(this.pathApi.join(grant.canonicalRoot, relative));
    const rel = this.pathApi.relative(grant.canonicalRoot, candidate);
    if (rel === ".." || rel.startsWith(".." + this.pathApi.sep) || this.pathApi.isAbsolute(rel))
      throw new ConnectorError("PATH_OUTSIDE_SCOPE", "Canonical path escapes workspace");
    return candidate;
  }
}
