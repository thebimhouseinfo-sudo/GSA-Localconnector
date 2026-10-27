// Observations are supplied by the caller; inspection never probes or installs tools.
const versionPattern = /^v?(\d+)\.\d+(?:\.\d+)?$/;

function observedTool(value) {
  return value === true || (typeof value === "string" && versionPattern.test(value));
}

function observedClientFlag(help) {
  if (typeof help !== "string") return null;
  const flags = new Set();
  for (const match of help.matchAll(/(?:^|\s)(--config|--profile-file)(?=$|[\s=])/g)) {
    flags.add(match[1]);
  }
  return flags.has("--config") ? "--config" : flags.has("--profile-file") ? "--profile-file" : null;
}

/**
 * Inspect injected tool observations without changing them or claiming native proof.
 * Readiness is a prerequisite check; Windows additionally requires adapter evidence.
 */
export function inspectPlatform({platform, arch, tools, clientHelp, nativeEvidence} = {}) {
  const missing = [];
  const observations = tools && typeof tools === "object" ? tools : {};
  const clientRunFlag = observedClientFlag(clientHelp);
  const nodeVersion = typeof observations.node === "string"
    ? versionPattern.exec(observations.node) : null;
  if (!nodeVersion || Number(nodeVersion[1]) < 20) missing.push("node>=20");

  if (platform === "darwin") {
    if (arch !== "arm64") missing.push("supported macOS architecture (arm64)");
    for (const tool of ["swiftc", "python3", "iconutil", "tunnelClient"]) {
      if (!observedTool(observations[tool])) missing.push(tool);
    }
  } else if (platform === "win32") {
    if (arch !== "x64" && arch !== "arm64") missing.push("supported Windows architecture");
    for (const tool of ["powershell", "csc", "winforms", "tunnelClient"]) {
      if (!observedTool(observations[tool])) missing.push(tool);
    }
    if (nativeEvidence?.adapterVerified !== true ||
        typeof nativeEvidence.reportPath !== "string" ||
        nativeEvidence.reportPath.trim().length === 0 ||
        /[\u0000-\u001f\u007f]/.test(nativeEvidence.reportPath)) {
      missing.push("verified Windows adapter");
    }
  } else {
    missing.push("supported platform");
  }

  if (clientRunFlag === null) missing.push("tunnel-client profile flag");
  return {platform, arch, ready: missing.length === 0, missing, clientRunFlag};
}
