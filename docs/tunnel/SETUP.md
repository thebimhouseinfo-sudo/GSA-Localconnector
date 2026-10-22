# GSA-Localconnector — OpenAI Secure MCP Tunnel (primary)

Product authority: [CRITERIA.md](../CRITERIA.md). Windows/Mac use distinct plugins and tunnels. Finish and accept Mac before starting Windows development; verify the selected host individually during its stage. Personal use requires no simultaneous Win+Mac, multiple-Mac or multiple-Windows acceptance fixture. Both hosts have historical individual E2E evidence; later handoff records terminated sessions, so current selected-host health needs fresh verification.

Working workspace tools have no connector approval gates. Additional explicit reference directories permit read/search only, not mutation/execution. Credentials authenticate the connection, not individual workspace actions. This runbook is documentation, not authorization to install or restart anything.

Official guides:
- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md
- https://github.com/openai/tunnel-client/releases/latest

## Mac terminal installer and menu bar app — 2026-10-22

Run `bash /Users/nam/GSA-Localconnector/install.sh` after stopping an older connector session. The script builds a versioned local runtime, creates `~/Applications/GSA Local Connector.app`, registers the per-user `com.gsa-localconnector.mac` LaunchAgent and starts the menu bar app. User clarified that the icon belongs in the top menu bar, so the app uses accessory activation/LSUIElement instead of a Dock icon. Its monochrome plug/bolt icon adapts to the system appearance. Clicking it shows one disabled status line and Quit; there is no status/setup window or separate panel. Configuration is through Terminal. Startup is after user login. Existing Node20+, workspace TypeScript dependencies, Swift command-line tools, Python3 and local tunnel-client are required; missing tools are not installed automatically.

The installer refuses active owners or conflicting app/job contents. User data, grants and the scoped native backend are preserved. The Applications entry is a managed symlink into the verified versioned app bundle. The menu bar app stays available without any ordinary window.

Update/repair can recover a missing managed Applications symlink when the existing release manifest and private installation metadata still verify. A registered launchd job without a PID is treated as inactive; only its verified owned registration is retired before activation. Active or unknown owners, missing ownership evidence and conflicting Applications entries still refuse. A saved valid `.env` does not need `setup` again after this recovery.

The installer now prompts in Terminal when saved setup is missing: enter the tunnel ID, then the API key with echo disabled. It saves `GSA_LC_TUNNEL_ID` and `CONTROL_PLANE_API_KEY` as data in local `.env`, normally `~/Library/Application Support/GSA-Localconnector/desktop/.env`. Valid saved setup is reused without prompts after install/launch/login and is outside release artifacts. Temporary connection failure does not erase it. A configured absolute path is preserved; optional `--env-path /absolute/private/path/.env` explicitly selects a first-install source. The directory must be current-user private0700 and file regular, single-link and private0600; unsafe paths are refused without copying or permission changes. Never put a real key in chat, argv, plist or logs.

For an already installed app, run `bash /Users/nam/GSA-Localconnector/install.sh setup` to enter or replace configuration directly in Terminal without rebuilding. Enter on either field keeps its saved value; Ctrl+C cancels without saving. Noninteractive input is refused. This writes the configured local file; a running connector retains its in-memory values until the next app start or login. It does not stop retained work.

The updated app probes its retained tunnel process through a private loopback health locator on an ephemeral port. It reports waiting until live/ready endpoints pass and the pinned client confirms a successful control-plane poll within120s. Verification means daemon health, not plugin end-to-end acceptance. Unsafe/missing evidence never reports verification, and stale success expires. This replaces the older constant UNKNOWN status after the updated app is installed; existing running bundles are not patched in place. `bash /Users/nam/GSA-Localconnector/install.sh update` builds/applies the new app when the old session is stopped; active/unknown retained work still refuses update.

Read status from the menu bar icon. Reopening the Applications entry does not create a window. `start.command` starts it, or invokes installation when absent, and no longer requests a session-only key. A running process is reported separately from verified plugin connection. Unexpected tunnel exit, including exit0, is recorded as CHILD_EXITED with numeric exit/signal evidence rather than an intentional stop. Logs retain the newest16KiB of the bounded redacted stream; warning level avoids filling the budget with Fx dependency startup details. Conservative unknown-work checks refuse maintenance stop while the supervisor is running. To apply an update after finishing connector tasks, stop the existing per-user session with `launchctl bootout gui/$(id -u)/com.gsa-localconnector.mac`, then run `bash /Users/nam/GSA-Localconnector/install.sh update`. Saved valid setup is reused; do not rerun setup just for this UI update.

A workspace directory that disappeared or changed its recorded identity no longer terminates Mac MCP startup. The Mac transport starts with an empty workspace registry and reports `workspaceStartupIssue` plus `workspaceSelectionRequired` in `connector_status`/`list_capabilities`. All file authority remains denied until explicit trusted reselection; saved pins are never silently refreshed. Malformed/unsafe grant storage still fails closed. Windows startup behavior is unchanged.

Evidence: `docs/reports/2026-10-22-mac-terminal-installer-delivery.md`. Native testing used real AppKit/Node with synthetic credentials/client and a temporary RunAtLoad job that was removed. No production install, real-key UI entry, actual reboot/login or new live-plugin acceptance was executed. Windows remains deferred by the user's Mac-first choice.

## Windows: reuse GPTWorker's existing tunnel-client (no additional download)

The GSA-Localconnector runner now has `reuse-gptworker-tunnel.ps1`. It discovers the preinstalled `tunnel-client.exe` inside GPTWorker's `bin` directory. **No PATH installation and no second download**. This reuses only the executable, not GPTWorker's tunnel ID, runtime key, profile, autostart, or process.

From PowerShell:

```powershell
cd "D:\00 Other Works\Vibecode\GSA-Localconnector"
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File .\reuse-gptworker-tunnel.ps1 -Action check
```

If the binary is elsewhere, append `-TunnelClientPath "FULL_PATH_TO_EXISTING_tunnel-client.exe"`. The first command must find the existing binary and report its version, without touching GPTWorker.

Once the Windows-specific GSA-Localconnector OpenAI Tunnel ID has been created in Platform and an authorized runtime key is provisioned locally (never paste the key into chats or commands shared with other people), set `GSA_LC_TUNNEL_ID` and `CONTROL_PLANE_API_KEY` **only in the local PowerShell process**. Then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\reuse-gptworker-tunnel.ps1 -Action doctor -TunnelId $env:GSA_LC_TUNNEL_ID
powershell -NoProfile -ExecutionPolicy Bypass -File .\reuse-gptworker-tunnel.ps1 -Action run -TunnelId $env:GSA_LC_TUNNEL_ID
```

**PowerShell caveat:** The nested `powershell` process inherits environment variables; if you use an in-process secret prompt, launch it in the SAME process or set environment variables in the parent session first. The script writes a dedicated YAML profile to `%LOCALAPPDATA%\GSA-Localconnector\tunnel\gsa-localconnector.yaml`, with only `env:CONTROL_PLANE_API_KEY` reference (no secret contents). Health port 58348; GPTWorker's own health port remains unchanged.

The existing HTTP server may continue to listen on 58347, but the GSA tunnel runs the compiled **stdio** MCP, not HTTP; HTTP token is not passed to OpenAI.

For macOS, discover a preinstalled `tunnel-client` binary if present and use the dedicated stdio profile. Do not assume GPTWorker's Windows `.exe` can run on macOS. A separate macOS executable is necessary unless already present; obtaining it is a separate human/platform step.

---

## Architecture

ChatGPT private plugin -> OpenAI-hosted tunnel endpoint -> `tunnel-client` on one authorized machine -> local GSA-Localconnector via **stdio**.

**Prefer stdio over HTTP** here. The tunnel client launches the local MCP process and exchanges JSON-RPC through stdin/stdout. This avoids passing the current local HTTP MCP bearer secret into tunnel configuration. Existing loopback HTTP MCP at 127.0.0.1:58347 remains available for independent native validation; never bind it to a public interface.

Windows installation path: `D:\00 Other Works\Vibecode\GSA-Localconnector`.
macOS installation path: `~/GSA-Localconnector`.

Windows and Mac are independent installations with **distinct tunnel IDs and plugins**. Use existing Windows `gsa-lc` (optional display name `gsa-lc-win`) and Mac `gsa-lc-mac`. Both may stay online. Never run two stdio clients with the same tunnel ID. Preserve existing installations; no recreation/rename is required. Credentials, working/reference roots and one-controller ownership are per host. No global lock or exclusive host handoff.

## Prerequisites (human/Platform authorization)

1. Platform organization with Tunnels **Read + Manage** to create and **Read + Use** for running/selection; ChatGPT workspace authorized to add custom MCP servers. Tunnel must be associated with the intended workspace.
2. An OpenAI-hosted `tunnel_id` created in Platform tunnel settings and a scoped runtime API key entered locally using secure input/environment; **never post keys in chat or commit them**.
3. Download the official latest `tunnel-client` release for the actual OS and inspect `tunnel-client help quickstart`; follow live CLI help if it differs from examples.
4. Local repository checked out and `npm install --ignore-scripts`, `npm test`, `npm run build` succeed; Node.js and Git installed.

## Windows — PowerShell (after authorized tunnel/key provisioning)

```powershell
cd "D:\00 Other Works\Vibecode\GSA-Localconnector"
git pull --ff-only origin main
npm install --ignore-scripts
npm test
npm run build
# Install tunnel-client via official release and ensure it is on PATH.
tunnel-client help quickstart
# Set CONTROL_PLANE_API_KEY using the client's supported local secure method;
# do not include the actual secret in a pasted command or chat transcript.
tunnel-client init --sample sample_mcp_stdio_local --profile gsa-lc-windows --tunnel-id <WINDOWS_TUNNEL_ID> --mcp-command "node D:\00 Other Works\Vibecode\GSA-Localconnector\dist\src\mcp\cli.js"
tunnel-client doctor --profile gsa-lc-windows --explain
tunnel-client run --profile gsa-lc-windows
```

The example `--mcp-command` string contains a path with spaces. Verify the resulting profile command and quoting with `doctor` before running. Where quoting is incompatible with the client, put a local launcher outside the repository that preserves argument boundaries and does not contain secrets.

## macOS — Terminal (after authorized tunnel/key provisioning)

```bash
cd ~/GSA-Localconnector
git pull --ff-only origin main
npm install --ignore-scripts
npm test
npm run build
# Install tunnel-client via official release and ensure it is on PATH.
tunnel-client help quickstart
# Set CONTROL_PLANE_API_KEY using the client's supported local secure method.
tunnel-client init --sample sample_mcp_stdio_local --profile gsa-lc-macos --tunnel-id <MACOS_TUNNEL_ID> --mcp-command "node $HOME/GSA-Localconnector/dist/src/mcp/cli.js"
tunnel-client doctor --profile gsa-lc-macos --explain
tunnel-client run --profile gsa-lc-macos
```

## Verify and connect ChatGPT

1. Doctor passes; `tunnel-client` is healthy, ready and polling. It exposes local `/healthz`, `/readyz`, `/metrics` and `/ui` for diagnostics.
2. In ChatGPT **Plugins > + > Add custom MCP server**, set Connection **Tunnel**. Select the matching tunnel or paste its ID, configure auth and confirm the warning.
3. Connect the selected host plugin to its matching tunnel; preserve an existing plugin. Discover the actual catalog, invoke `connector_status` and verify the correct installation/OS. Complete the Mac journey first; perform the Windows journey only in the later Windows stage. Multi-project isolation is tested on the selected host, without a simultaneous multi-machine routing fixture. Discovery alone does not establish working-tool readiness.
4. If tunnel is not visible, inspect Platform organization + ChatGPT workspace associations and Tunnels Read+Use permissions. Do not substitute a public unauthenticated HTTP endpoint.

OpenAI Secure MCP Tunnel is for private MCP connections, **not public plugin submission**. Its default per-request deadline is 120s, including queue time: future Local CI/shell work MUST be asynchronous with durable run IDs and short MCP polling calls; don't run long jobs inside one MCP request.

## Current status and scope

Historical individual plugin E2E is recorded in the project checkpoint; [source status](../STATUS.md) records later terminated calls and incomplete local work. Do not assume tunnels are absent or recreate them. Check only the selected host; preserve GPTWorker and the other host.

Normal work uses the selected plugin plus supplied workspace paths, with optional explicitly read-only reference paths. Current source still uses legacy read-only binding; that is an implementation gap, not a requirement to ask for write/execute unlocks. Reference-role API support is not assumed. See [workspace model](../workspaces/LOCAL-ENROLLMENT.md).

These are retained setup snippets, not commands to run blindly against this dirty checkout. Follow handoff boundaries and installed client help for version-specific syntax. Cloudflare remains optional; public unauthenticated HTTP is not a fallback.

The old one-plugin/shared-tunnel/manual-host-handoff design is superseded and removed from this active runbook. Same-tunnel concurrency restrictions do not prohibit two distinct host tunnels.
