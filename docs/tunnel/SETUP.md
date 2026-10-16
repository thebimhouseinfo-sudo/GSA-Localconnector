# GSA-Localconnector — OpenAI Secure MCP Tunnel (primary)

Status: Windows/macOS local MCP test gates **8/8 PASS**, from user native outputs; **OpenAI tunnel client NOT installed**, **tunnel_id NOT created**, **private ChatGPT MCP plugin NOT created**. Cloudflare is postponed to optional future interop.

Official guides:
- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md
- https://github.com/openai/tunnel-client/releases/latest

## Architecture

ChatGPT private plugin -> OpenAI-hosted tunnel endpoint -> `tunnel-client` on one authorized machine -> local GSA-Localconnector via **stdio**.

**Prefer stdio over HTTP** here. The tunnel client launches the local MCP process and exchanges JSON-RPC through stdin/stdout. This avoids passing the current local HTTP MCP bearer secret into tunnel configuration. Existing loopback HTTP MCP at 127.0.0.1:58347 remains available for independent native validation; never bind it to a public interface.

Windows installation path: `D:\00 Other Works\Vibecode\GSA-Localconnector`.
macOS installation path: `~/GSA-Localconnector`.

Windows and macOS are **alternate single-host installations**, not one cluster. Create separate OpenAI tunnels and private ChatGPT plugin entries per machine if both are to be reachable independently. Keep the one active GSA controller rule. Do not point both live clients at the same tunnel ID.

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
3. Confirm discovery of the three read-only tools `connector_status`, `list_workspaces`, `get_workspace`; invoke `connector_status` and verify the expected host. **Only after that** mark the plugin connection PASS.
4. If tunnel is not visible, inspect Platform organization + ChatGPT workspace associations and Tunnels Read+Use permissions. Do not substitute a public unauthenticated HTTP endpoint.

OpenAI Secure MCP Tunnel is for private MCP connections, **not public plugin submission**. Its default per-request deadline is 120s, including queue time: future Local CI/shell work MUST be asynchronous with durable run IDs and short MCP polling calls; don't run long jobs inside one MCP request.

## Blockers and safeguards

- As of this document, no Platform tunnel ID or runtime key has been provisioned, and no native tunnel-client installation has been evidenced.
- No real plugin exists. Production OS sandbox, authenticated single-controller lease, shell/write, and Local CI remain **blocked**.
- Cloudflare remains an optional future multi-provider transport; not part of the current onboarding critical path.
