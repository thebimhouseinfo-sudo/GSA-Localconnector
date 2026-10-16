/** Platform-neutral wire contracts. These types do not confer host authority. */
export type HostPlatform = "windows" | "macos";
export type WorkspacePermission = "read" | "write" | "execute";
export type ConnectorErrorCode =
  | "UNSUPPORTED_PLATFORM" | "WORKSPACE_NOT_FOUND" | "PERMISSION_DENIED"
  | "PATH_OUTSIDE_SCOPE" | "HASH_CONFLICT" | "SECURITY_BLOCKED"
  | "SOURCE_UNVERIFIED" | "RESULT_UNKNOWN" | "SESSION_BUSY";
export interface WorkspaceGrant {
  readonly id: string;
  readonly canonicalRoot: string;
  readonly permissions: readonly WorkspacePermission[];
  readonly revision: number;
}
export interface HostCapabilities {
  readonly platform: HostPlatform;
  readonly arch: string;
  readonly shellIsolation: "blocked" | "verified";
  readonly localCi: "blocked" | "available";
}
export interface HostAdapter {
  readonly capabilities: HostCapabilities;
  canonicalizeExisting(path: string): Promise<string>;
}
export class ConnectorError extends Error {
  constructor(public readonly code: ConnectorErrorCode, message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}
