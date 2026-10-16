import path from "node:path";
import fs from "node:fs/promises";
import { ConnectorError, type WorkspaceGrant, type WorkspacePermission } from "./contracts.js";

/** Use platform path rules; canonicalize EXISTING targets. Never treat this alone as a sandbox. */
export class WorkspaceRegistry {
  private readonly grants = new Map<string, WorkspaceGrant>();
  constructor(private readonly pathApi: typeof path = path) {}

  /** Trusted local enrollment only; never expose via an ordinary MCP tool. */
  async enrollTrusted(id: string, root: string, permissions: readonly WorkspacePermission[]): Promise<WorkspaceGrant> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) throw new ConnectorError("WORKSPACE_NOT_FOUND", "Invalid workspace ID");
    if (!this.pathApi.isAbsolute(root)) throw new ConnectorError("PATH_OUTSIDE_SCOPE", "Root must be absolute");
    const canonicalRoot = await fs.realpath(root);
    const previous = this.grants.get(id);
    const grant: WorkspaceGrant = Object.freeze({ id, canonicalRoot, permissions: Object.freeze([...new Set(permissions)]), revision: (previous?.revision ?? 0) + 1 });
    this.grants.set(id, grant);
    return grant;
  }
  list(): readonly WorkspaceGrant[] { return [...this.grants.values()]; }
  get(id: string): WorkspaceGrant | undefined { return this.grants.get(id); }
  revoke(id: string): void { this.grants.delete(id); }
  requireGrant(id: string, permission: WorkspacePermission): WorkspaceGrant {
    const grant = this.grants.get(id);
    if (!grant) throw new ConnectorError("WORKSPACE_NOT_FOUND", "Unknown workspace");
    if (!grant.permissions.includes(permission)) throw new ConnectorError("PERMISSION_DENIED", "Permission not granted");
    return grant;
  }
  /** Read-only bootstrap resolver; writes/CI need handle-relative protection and native isolation. */
  async resolveExistingRead(id: string, relative: string): Promise<string> {
    const grant = this.requireGrant(id, "read");
    if (relative === ".") return grant.canonicalRoot;
    if (!relative || this.pathApi.isAbsolute(relative) || this.pathApi.win32.isAbsolute(relative) || relative.includes("\\") && process.platform !== "win32")
      throw new ConnectorError("PATH_OUTSIDE_SCOPE", "Path must be workspace-relative");
    const parts = relative.split(/[\\/]/);
    if (parts.some(p => p === ".." || p === "." || p === "")) throw new ConnectorError("PATH_OUTSIDE_SCOPE", "Unsafe relative path");
    const candidate = await fs.realpath(this.pathApi.join(grant.canonicalRoot, relative));
    const rel = this.pathApi.relative(grant.canonicalRoot, candidate);
    if (rel === ".." || rel.startsWith(".." + this.pathApi.sep) || this.pathApi.isAbsolute(rel))
      throw new ConnectorError("PATH_OUTSIDE_SCOPE", "Canonical path escapes workspace");
    return candidate;
  }
}
