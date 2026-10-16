# Tunnel setup boundary — GSA-Localconnector

**Do not create the ChatGPT plugin before the local HTTP MCP server and tunnel are READY.**

The HTTP endpoint is currently **read-only and experimental**. It binds to `127.0.0.1:58347` by default and requires `Authorization: Bearer <token>` on `/mcp`. No shell/write/CI tools are exposed.

## Local smoke
1. Install Node 22 and checkout this repository on the desired Windows or macOS machine.
2. `npm install --ignore-scripts && npm test`, then `npm run build`.
3. Generate a random secret of >=32 characters locally; set `MCP_HTTP_TOKEN` as a **process secret**, never commit it or write it to a Workspace.
4. Run `npm run mcp:http`; check `http://127.0.0.1:58347/health`.
5. Verify authorized POST `/mcp` initialize and tools/list; a request lacking a token must be rejected.

## Cloudflare boundary
- Create a dedicated named Cloudflare Tunnel and DNS hostname **only after local tests pass**, and point its ingress to `http://127.0.0.1:58347`.
- Provision tunnel credentials **locally** through the trusted user-managed Cloudflare account; never commit a tunnel token/config/secrets to GitHub.
- Configure Cloudflare access policy and ChatGPT-compatible authentication; test the exact remote client authentication before adding a plugin. Bearer header support and Cloudflare Access policy configuration must be confirmed for the actual ChatGPT connector.
- Verify TLS, authentication-denied probes, startup/reconnect and no leak of /mcp to unauthenticated callers.
- Installer/autostart, tunnel process supervision and token rotation are **pending**, not silently satisfied by this example.

## Human action needed later
Cloudflare account and DNS authorization, host install, machine-local token provisioning, creating the actual dedicated tunnel, validating remote hostname, and only then registering the ChatGPT plugin.

## Unique endpoint identity
Choose a dedicated DNS label such as `gsa-lc-<locally-generated-random-suffix>.<your-owned-domain>`; generate the suffix locally and confirm the exact FQDN is free in Cloudflare DNS before creating it. Do not hardcode a guessed hostname or reuse GPTWorker/CadGPT/RevitGPT ingress. Port 58347 is a project default, not a guarantee of availability: fail on EADDRINUSE and allow MCP_HTTP_PORT override. Keep the HTTP service bound to 127.0.0.1, not a public interface.
