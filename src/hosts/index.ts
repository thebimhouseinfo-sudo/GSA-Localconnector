import fs from "node:fs/promises";
import { ConnectorError, type HostAdapter, type HostPlatform } from "../core/contracts.js";

/** Native isolation MUST be separately verified before any shell or CI tool is registered. */
export function createHostAdapter(platform: NodeJS.Platform = process.platform): HostAdapter {
  let kind: HostPlatform;
  if (platform === "win32") kind = "windows";
  else if (platform === "darwin") kind = "macos";
  else throw new ConnectorError("UNSUPPORTED_PLATFORM", `Unsupported host platform: ${platform}`);
  return {
    capabilities: { platform: kind, arch: process.arch, shellIsolation: "blocked", localCi: "blocked" },
    canonicalizeExisting: async (value: string) => fs.realpath(value),
  };
}
