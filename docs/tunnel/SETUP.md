# GSA-Localconnector — OpenAI Secure MCP Tunnel (primary)

Status: Windows/macOS local MCP test gates **8/8 PASS**, from user native outputs; **OpenAI tunnel client NOT installed**, **tunnel_id NOT created**, **private ChatGPT MCP plugin NOT created**. Cloudflare is postponed to optional future interop.

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

Once ONE separate GSA-Localconnector OpenAI Tunnel ID has been created in Platform and an authorized runtime key is provisioned locally (never paste the key into chats or commands shared with other people), set `GSA_LC_TUNNEL_ID` and `CONTROL_PLANE_API_KEY` **only in the local PowerShell process**. Then run:

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

Windows and macOS are **alternate single-host installations**, not one cluster. Use ONE OpenAI tunnel ID and ONE private ChatGPT plugin for this connector. Install local profiles on both platforms referencing the SAME tunnel ID, but NEVER run two tunnel-client instances simultaneously. Only one active host. To switch: stop and verify old tunnel-client is stopped, wait for pending requests to settle, then start the second host and verify doctor/ready and connector_status. If old host is inaccessible, explicitly fence/revoke its runtime authorization before activating replacement; do not assume inactivity. Do not change the plugin or tunnel ID while switching.

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
tunnel-client init --sample sample_mcp_stdio_local --profile gsa-lc-windows --tunnel-id <SHARED_GSA_TUNNEL_ID> --mcp-command "node D:\00 Other Works\Vibecode\GSA-Localconnector\dist\src\mcp\cli.js"
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
tunnel-client init --sample sample_mcp_stdio_local --profile gsa-lc-macos --tunnel-id <SHARED_GSA_TUNNEL_ID> --mcp-command "node $HOME/GSA-Localconnector/dist/src/mcp/cli.js"
tunnel-client doctor --profile gsa-lc-macos --explain
tunnel-client run --profile gsa-lc-macos
```

## Verify and connect ChatGPT

1. Doctor passes; `tunnel-client` is healthy, ready and polling. It exposes local `/healthz`, `/readyz`, `/metrics` and `/ui` for diagnostics.
2. In ChatGPT **Plugins > + > Add custom MCP server**, set Connection **Tunnel**. Select the matching tunnel or paste its ID, configure auth and confirm the warning.
3. Create ONE private ChatGPT plugin named `GSA-Localconnector` referencing `<SHARED_GSA_TUNNEL_ID>`. Confirm discovery of the three read-only tools `connector_status`, `list_workspaces`, `get_workspace`; invoke `connector_status` and verify the expected host. **Only after that** mark the plugin connection PASS.
4. If tunnel is not visible, inspect Platform organization + ChatGPT workspace associations and Tunnels Read+Use permissions. Do not substitute a public unauthenticated HTTP endpoint.

OpenAI Secure MCP Tunnel is for private MCP connections, **not public plugin submission**. Its default per-request deadline is 120s, including queue time: future Local CI/shell work MUST be asynchronous with durable run IDs and short MCP polling calls; don't run long jobs inside one MCP request.

## Blockers and safeguards

- As of this document, no Platform tunnel ID or runtime key has been provisioned, and no native tunnel-client installation has been evidenced.
- No real plugin exists. Production OS sandbox, authenticated single-controller lease, shell/write, and Local CI remain **blocked**.
- Cloudflare remains an optional future multi-provider transport; not part of the current onboarding critical path.

## Single-plugin host handoff (mandatory)

- One `tunnel_id`, one ChatGPT plugin, two local installations and profiles, **exactly one RUNNING tunnel-client instance**.
- Windows -> macOS: stop Windows `tunnel-client` (and its supervisor if any), confirm stopped and no in-flight requests, then start macOS profile using the same tunnel ID, run `doctor` and confirm ready before issuing tool calls.
- macOS -> Windows: reverse the procedure.
- If the old host is unreachable, disable/revoke its tunnel runtime capability before bringing up the replacement. Never use simultaneous starts or rolling restarts; a shared tunnel queue does not pin stdio sessions to a host.
- Verify tool `connector_status` identifies the expected active OS after each handoff. This proves selected runtime; it does not confer workspace grants on another machine.
- Design is intentionally **manual handoff initially**. Cross-host automated election/fencing is outside MVP and MUST NOT be fabricated as an existing feature.

OpenAI stdio concurrency limitation: https://github.com/openai/tunnel-client/blob/master/docs/configuration.md#stdio-deployment-limits

## CURRENT DECISION — two simultaneous hosts, two private plugins (2026-10-16)

This section supersedes every older single-plugin/single-tunnel instruction above.

| Host | Private ChatGPT plugin | OpenAI tunnel | Local runtime |
| --- | --- | --- | --- |
| Windows | `gsa-lc-win` (existing plugin may be renamed if UI allows) | **existing Windows GSA tunnel ID** | `D:\\00 Other Works\\Vibecode\\GSA-Localconnector` |
| macOS | `gsa-lc-mac` (create second plugin) | **NEW separate macOS GSA tunnel ID** | `~/GSA-Localconnector` |

Both connections may remain active simultaneously, allowing GSA to run separate projects on the two machines. Never run two tunnel-client instances with the **same** tunnel ID. Do not reuse GPTWorker credentials/tunnel. Keep individual Workspace registries and approvals per host; an authorization on one host does not authorize the other. One active controller lease is **per host**, not globally across both.

Windows already demonstrated live ChatGPT tool calls via the existing plugin. **Do not delete/recreate the functioning Windows tunnel or plugin just to rename it.** macOS requires its own new tunnel ID and separate private plugin, independently tested through `connector_status` returning `platform=darwin`.

macOS setup instructions earlier in this file must use `<MACOS_TUNNEL_ID>`, **NOT** the Windows or shared tunnel ID. Key may be scoped separately; a key with correct permissions can be provisioned locally without sharing its value. This is a concurrency architecture revision, not evidence that the macOS tunnel or plugin exists.
