# GSA-Localconnector — OpenAI Secure MCP Tunnel (primary)

Product authority: [CRITERIA.md](../CRITERIA.md). Two distinct Windows/Mac plugins and tunnels may run simultaneously. Both have historical individual E2E evidence; later handoff records terminated sessions, so current live health needs fresh verification.

Working workspace tools have no connector approval gates. Additional explicit reference directories permit read/search only, not mutation/execution. Credentials authenticate the connection, not individual workspace actions. This runbook is documentation, not authorization to install or restart anything.

Official guides:
- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md
- https://github.com/openai/tunnel-client/releases/latest

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
3. Connect the selected host plugin to its matching tunnel; preserve an existing plugin. Discover the actual catalog, invoke `connector_status` and verify the correct installation/OS. Check each host and then simultaneous routing. Discovery alone does not establish working-tool readiness.
4. If tunnel is not visible, inspect Platform organization + ChatGPT workspace associations and Tunnels Read+Use permissions. Do not substitute a public unauthenticated HTTP endpoint.

OpenAI Secure MCP Tunnel is for private MCP connections, **not public plugin submission**. Its default per-request deadline is 120s, including queue time: future Local CI/shell work MUST be asynchronous with durable run IDs and short MCP polling calls; don't run long jobs inside one MCP request.

## Current status and scope

Historical individual plugin E2E is recorded in the project checkpoint; [source status](../STATUS.md) records later terminated calls and incomplete local work. Do not assume tunnels are absent or recreate them. Check only the selected host; preserve GPTWorker and the other host.

Normal work uses the selected plugin plus supplied workspace paths, with optional explicitly read-only reference paths. Current source still uses legacy read-only binding; that is an implementation gap, not a requirement to ask for write/execute unlocks. Reference-role API support is not assumed. See [workspace model](../workspaces/LOCAL-ENROLLMENT.md).

These are retained setup snippets, not commands to run blindly against this dirty checkout. Follow handoff boundaries and installed client help for version-specific syntax. Cloudflare remains optional; public unauthenticated HTTP is not a fallback.

The old one-plugin/shared-tunnel/manual-host-handoff design is superseded and removed from this active runbook. Same-tunnel concurrency restrictions do not prohibit two distinct host tunnels.
