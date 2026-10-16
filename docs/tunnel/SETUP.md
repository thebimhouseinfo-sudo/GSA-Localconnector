# GSA-Localconnector — Native install & Cloudflare handoff

**Status: tunnel is NOT installed, no ChatGPT plugin exists.** This handoff is for one Windows or macOS machine at a time. Local MCP is read-only during bootstrap. The real Cloudflare tunnel and host validation require the authorized human.

## 1. Prepare the machine

Install Node.js 22+ and Git. From a user-owned checkout of
`https://github.com/thebimhouseinfo-sudo/GSA-Localconnector` run:

```bash
npm install --ignore-scripts
npm test
npm run prepare
npm run mcp:http
```

The `prepare` command generates a unique 48-byte random bearer secret under the user's host-owned application directory (Windows: LocalAppData/GSA-Localconnector; macOS: ~/Library/Application Support/GSA-Localconnector). It reuses the secret if already initialized and does not print its value. Do not commit, chat, screenshot, or upload that secret.

HTTP MCP binds **127.0.0.1:58347** by default. Override the port with `MCP_HTTP_PORT` if the port is occupied. `/health` is unprivileged health only; `/mcp` requires a bearer token. Do not bind this local app to `0.0.0.0`.

Open another terminal, check local health:
```bash
curl http://127.0.0.1:58347/health
```

No plugin or tunnel should be created until the server starts and the health test passes. The local token is not exposed by the health endpoint.

## 2. Create a dedicated Cloudflare tunnel (human action)

Use your own Cloudflare account and a DNS zone you control. Create a **new named Tunnel**, unique to this connector, using the Cloudflare Zero Trust dashboard. Choose a DNS label like `gsa-lc-<random-suffix>.<your-domain>`. Verify the name is unassigned before provisioning it. Set its public hostname service to `http://127.0.0.1:58347`.

Follow Cloudflare's generated install/connector commands for the **actual target OS** (Windows or macOS); do not paste credentials into this repo or ChatGPT. A tunnel token/credentials are different from the local MCP bearer token. Never reuse GPTWorker/CadGPT/RevitGPT tunnel credentials, ports, startup registrations or hostname.

Check Cloudflare route DNS, TLS, and the authenticated MCP initialize handshake from an **external** client. Choose a ChatGPT-compatible authentication/Access strategy; this read-only bootstrap currently requires a bearer header and **does not implement an OAuth authorization server**. If ChatGPT's plugin flow requires OAuth, stop at this gate rather than exposing an unauthenticated endpoint or inventing a token bypass.

## 3. Human-ready checklist

- [ ] Native local npm tests PASS on target OS
- [ ] `npm run prepare` succeeded without exposing token
- [ ] `npm run mcp:http` starts on loopback port, `/health` responds
- [ ] Cloudflare named tunnel installed, distinct hostname mapped to 127.0.0.1:58347
- [ ] Remote TLS valid; anonymous `/mcp` denied; authorized MCP handshake succeeds
- [ ] Restart/reconnect and local supervision validated
- [ ] Compatible authentication with ChatGPT verified before plugin registration

## 4. Until the native sandbox is verified

Only the status/workspace metadata tools are available. No execute, shell, write or Local CI is enabled. A READY tunnel **does not** imply Localconnector's coding tools are ready. Production startup, token rotation, secure authenticated control-session lease and native Windows/macOS sandbox remain separate unfinished tickets.

See `.gsa/CURRENT_CHECKPOINT.md` for last verified code revision and test evidence.
