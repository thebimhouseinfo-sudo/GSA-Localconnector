# Trusted Workspace enrollment — Phase 1 (read-only)
Status: source implementation and CI validation in progress. Windows/macOS tunnel apps require restart after local enrollment.

## Security model
- Workspace enrollment only via **local OS terminal** on the target host (not a remotely callable MCP tool).
- Grants are stored separately on each machine under GSA-Localconnector application data, with file creation mode 0600 on POSIX.
- The current grants tool deliberately enrolls only **read** permission. Shell/execute, writes and Local CI remain blocked. A local read grant does not permit shell execution.
- The MCP server reads saved grants at process startup. Restart the **correct machine's GSA-Localconnector tunnel** to reload. Do not restart GPTWorker or the other machine's tunnel.
- Read operations validate realpath confinement, reject relative traversal and cap directory results to 500 entries / file bytes to 65536. This check is not yet a native, race-free filesystem sandbox. Do not enroll sensitive or adversary-writable directories until native containment review passes.
- Revoke local grants before sharing high-sensitivity content; revocation currently takes effect after local MCP process restart, not instantaneously in already-running sessions. Avoid relying on this for urgent permissions withdrawal.

## Windows
```powershell
cd "D:\00 Other Works\Vibecode\GSA-Localconnector"
git pull --ff-only origin main
npm test
npm run workspace -- enroll-read project-a "D:\path\to\project"
npm run workspace -- list
```

## macOS
```bash
cd ~/GSA-Localconnector
git pull --ff-only origin main
npm test
npm run workspace -- enroll-read project-b "$HOME/path/to/project"
npm run workspace -- list
```

After verifying local enrollment, restart only the GSA tunnel for that host, then call `list_workspaces`, `list_directory` with `path` set to a subdirectory, and `fetch_file` for a small UTF-8 file. `path` does not accept `.` in this initial version. Do not send arbitrary local absolute paths through MCP tools.

## Shell and future Git/CI
Directory binding is not containment for arbitrary shell commands. Shell will not be exposed until native isolation per OS prevents escaped child processes, filesystem writes outside grants, network and elevation hazards per policy, and verified denial tests on real Windows/macOS installations. Future Git changes and CI must use the same independently verified process containment gate.

## CURRENT binding contract — plugin-first (2026-10-16)
This section supersedes local-CLI-first instructions above. User calls `gsa-lc` (Windows) or `gsa-lc-mac` (macOS) with one or more **explicit absolute directory paths**. GSA invokes `bind_workspaces({paths:[...]})` on the selected plugin, and the connector verifies each target exists and is a directory, canonicalizes it, assigns a stable host-local Workspace ID, persists read-only grant, and makes the grant available to the calling tool process immediately. The user **must supply the paths**; do not infer broad parent directories or grant extra paths. Each host has independent Workspace roots. Shell/write/Local CI remain blocked until OS-native containment is verified.

Example human instruction: `@gsa-lc-mac bind /Users/username/projectA and /Users/username/projectB`.

A tunnel MCP child process may reload between requests; persistence is required and included. If an existing process cached grants before binding, restart the selected host's GSA tunnel once to reload. Do not modify GPTWorker or the other host. The old `npm run workspace -- enroll-read ...` remains a maintenance fallback, **not a prerequisite** for normal Workspace binding.
