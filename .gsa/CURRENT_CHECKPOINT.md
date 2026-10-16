# GSA-Localconnector — Current checkpoint

Date: 2026-10-16
Stage: P0-01 baseline recorded; PX-01 bootstrap source committed, **tests not yet verified**.

## Resume instructions
1. Read `.gsa/BASELINE.md`, this checkpoint, and `docs/plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md`.
2. Inspect HEAD and latest CI runs; do not claim PASS without run evidence.
3. Run `npm install --ignore-scripts && npm test` on Windows and macOS. Fix any TypeScript and test failures.
4. Implement durable trusted workspace registration and MCP transport with direct typed tools only after reviewing security boundaries.
5. Prioritize PX-04/PX-05 native OS isolation prototypes before exposing shell or local CI.

## Committed bootstrap
- TypeScript project and host-neutral contracts.
- Windows/macOS adapter detection; shell isolation and local CI intentionally BLOCKED.
- In-memory trusted workspace read resolver (not a security sandbox and not public enrollment).
- Unit tests for unsupported platform, traversal, symlink escape and grants.
- GitHub Actions cross-platform *source contract* CI, distinct from the future local CI runner.

## Known limitations
- MCP transport, autostart, privileged runtime, persistent registry and local-only CI are not implemented.
- Actual Windows/macOS tests have not yet been observed to PASS.
- No local shell/CI capability is enabled.

## Checkpoint discipline
After each verified ticket, update this file with Git HEAD, exact test results/evidence, blockers and next action. Keep BASELINE immutable. Resume from actual latest evidence, not optimistic status labels.

## CI execution checkpoint — 2026-10-16
- Initial cross-platform CI run `38836862166`: Ubuntu PASS; macOS FAILED, Windows test step FAILED/cancelled. Root cause not verified from logs; a canonical-path comparison issue was identified as a plausible cause.
- Test assertion revised in commit `df178b4a143a6b7997c503ec44572ce054ee269a` to compare `realpath` instead of lexically assembled target.
- CI for this revision: https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38836950377 (QUEUED at last inspection).
- **Do not mark cross-platform PASS until this run completes successfully on Windows and macOS.** If failure persists, inspect job logs and fix exact cause.

## Verified contract CI milestone
- Source revision `df178b4a143a6b7997c503ec44572ce054ee269a`: GitHub Actions run [38836950377](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38836950377) **PASS** on Ubuntu, macOS and Windows (all three jobs completed success).
- This verifies TypeScript build and bootstrap unit tests, **not** native autostart, OS sandbox, working MCP server or local CI runner.
- Status: P0 baseline PASS (source pin); PX-01 bootstrap contract tests PASS; PX-01 feature completeness IN PROGRESS.

## PX-01 increment — Read-only MCP stdio (2026-10-16)
- Source HEAD at implementation handoff: `278f81f730851cc7d57dc7f0bf023d708b68e629`.
- Implemented `src/mcp/server.ts` and `src/mcp/cli.ts` with JSON-RPC MCP stdio initialize, tools/list, tools/call and ping. Public tools: `connector_status`, `list_workspaces`, `get_workspace` only.
- Added tool catalog and denied-unregistered-root tests in `test/mcp.test.ts`, and `npm run mcp` command after TypeScript build.
- This is a **limited bootstrap transport**, not verified complete MCP SDK conformance or production authenticated remote transport. Trusted registry is still memory-only and has no external enrollment path; shells, writes and CI disabled.
- GitHub Actions for this revision: https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38840578972 — status pending at checkpoint write. Do not infer PASS.
- NEXT: inspect latest CI outcome; fix failures; implement fully compliant MCP transport/session tests, then trusted persistent Workspace registry and native isolation proofs.

## PX-01 MCP test repair — 2026-10-16
- Logs for run 38840675186 showed 3/4 tests passed on Ubuntu; last test failed because Linux is intentionally unsupported by `createHostAdapter`. The test was corrected without enabling Linux runtime.
- Corrected source revision `56229dae6942df3a8180808fd4dacc10059ad698` (GitHub Actions run https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38840727047). Its completion must be checked before milestone PASS.
- NEXT: verify Windows/macOS passing test jobs; then replace bootstrap handwritten stdio with protocol-conformance validated MCP SDK implementation; implement trusted persistent enrollment while keeping arbitrary shell/CI disabled.

## Verified CI — MCP bootstrap revision
- Source revision `56229dae6942df3a8180808fd4dacc10059ad698` GitHub Actions [run 38840727047](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38840727047): **Windows PASS, macOS PASS, Ubuntu PASS** (3/3 completed success).
- Verified TypeScript compilation and bootstrap unit tests only. Stdio interoperability with an external MCP client, remote auth, persistent enrollment, native autostart, containment and local CI remain **NOT TESTED / NOT IMPLEMENTED**.
- PX-01 status: MCP read-only bootstrap source/tests PASS; full PX-01 contract IN PROGRESS. NEXT: MCP SDK protocol conformance and authenticated connector transport, then trusted workspace persistence and PX-04/PX-05 native security spikes.

## Verified checkpoint — MCP process integration (2026-10-16)
- Exact code revision: `9d1afffad45b24f109a70096aa6bcf99e2df14a4`.
- GitHub Actions run [38842153103](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38842153103): **Windows PASS / macOS PASS / Ubuntu PASS** (3/3 completed success).
- Added `test/mcp-stdio.test.ts`: spawns compiled MCP server, exercises JSON-RPC initialize, notifications/initialized, tools/list, list_workspaces, missing Workspace, unknown tool and ping through stdin/stdout.
- Added `docs/contracts/MCP-BOOTSTRAP.md`: current tool/API scope and non-production transport limitations.
- Explicitly NOT validated: official SDK-client conformance, authenticated external MCP transport, on-disk trusted enrollment, write/shell/CI, Task Scheduler, launchd and OS isolation.
- **Human boundary for privileged continuation:** authorize local trusted Workspace enrollment and permit Windows/macOS on-device sandbox feasibility fixtures. No arbitrary shell or CI will be enabled before native isolation evidence. Exact paths need local user enrollment, not made-up paths.
- Resume: verify HEAD + this checkpoint; implement local trusted enrollment/persistence and official client conformance; then platform-native sandbox feasibility and release tests.

## HTTP MCP + tunnel preparation checkpoint — 2026-10-16
- Implementation source revision `81a842f9bf47f7a9b354dd8e8e74158b4d507b48`.
- Added `src/mcp/http.ts`, `src/mcp/http-cli.ts`, `test/http.test.ts`, `docs/tunnel/SETUP.md`.
- HTTP MCP is stateless JSON-RPC at loopback `127.0.0.1:43281/mcp`; `/health` returns unprivileged liveness.
- Secret is mandatory `MCP_HTTP_TOKEN` (>=32 characters), compared timing-safe; requests lacking bearer token rejected. Origin and MCP Accept/protocol version checks included. Limits body size to 1 MiB.
- Only read-only `connector_status`, `list_workspaces`, `get_workspace`; all shell/write/CI capabilities remain disabled.
- Added `npm run mcp:http`. Never expose directly on 0.0.0.0.
- [CI run 38842600984](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38842600984) for implementation revision: Ubuntu PASS and macOS PASS, Windows IN PROGRESS at the checkpoint moment. **Do not claim 3/3 until verified.**
- Cloudflare named Tunnel, domain/hostname mapping, secret provisioning, end-to-end public HTTPS MCP handshake, process autostart and ChatGPT plugin creation are NOT DONE.
- Human action required at tunnel installation: machine-local Node + cloudflared, Cloudflare DNS/tunnel authorization and hostname, environment secret setup and external access acceptance test. `docs/tunnel/SETUP.md` describes this boundary. **Do not create a ChatGPT plugin before tunnel READY.**
- Resume by checking latest CI outcome, then tunnel/client compatibility and safe auth; do not advertise production security conformance yet.

### Verified HTTP transport CI completion
- Implementation revision `81a842f9bf47f7a9b354dd8e8e74158b4d507b48`: [run 38842600984](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38842600984) completed **Windows PASS / macOS PASS / Ubuntu PASS**.
- This verifies HTTP test harness, compilation, bearer rejection and tool restrictions in GitHub Actions; real external Cloudflare tunnel, host native install and ChatGPT client compatibility remain untested.

## Endpoint uniqueness (2026-10-16)
- Default HTTP loopback port changed from 43281 to **58347**; MCP_HTTP_PORT remains configurable. The previous 43281 references above are historical.
- Bind address stays 127.0.0.1 (security), and Cloudflare hostname must use an independently generated suffix under the user's authorized domain, checked for DNS collisions before creation.
- Change requires cross-platform CI verification. Real hostname/tunnel does not exist yet; do not invent one.

## Human installation handoff — secret bootstrap + tunnel provisioning (2026-10-16)
- Source implementation revision `7397d4fd146e4e3cde1e6aeea657d6faf8f67c59`.
- Added per-install random bearer token creation under host-owned Application Support/LocalAppData, via `npm run prepare`. Token is not printed; `npm run mcp:http` reads it automatically if MCP_HTTP_TOKEN is not set.
- [Cross-platform CI run 38843055075](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38843055075): **Windows PASS / macOS PASS / Ubuntu PASS**. This verifies unit/test suite for that source revision, not actual local installation.
- Updated `docs/tunnel/SETUP.md` for human operating steps and Cloudflare hostname authentication boundary. Port **58347**, bind **127.0.0.1**.
- **NEXT HUMAN ACTION:** install Node/Git on the chosen host, clone/pull repo, run `npm install --ignore-scripts; npm test; npm run prepare; npm run mcp:http`, then check local `/health`. Create a NEW Cloudflare named tunnel + distinct DNS label in user's account; map to localhost:58347. Verify remote authenticated MCP request *before* creating any ChatGPT plugin.
- **STOP CONDITIONS:** no cloudflared or DNS/tunnel credentials available to this GitHub-only environment; no remote MCP OAuth/client compatibility proof; do not register plugin yet. Keep shell/write/CI disabled because OS sandbox P2 not verified.
- On resume: inspect HEAD, this checkpoint, actual native test logs, tunnel install status and authentication method. Proceed with Cloudflare external validation only after host endpoint is ready.

## Windows native install evidence — user-provided (2026-10-16)
- Windows PowerShell `Invoke-RestMethod http://127.0.0.1:58347/health` returned `status=alive`, `name=gsa-localconnector`, `exposedTools=read-only`.
- **WIN-HEALTH PASS** (user-supplied live machine evidence). This does **not** prove `npm test`, bearer enforcement, MCP initialize, tunnel connectivity or startup persistence.
- Windows next: anonymous POST `/mcp` must return 401, then authorized MCP handshake and `npm test` evidence. macOS native installation/health test pending. Cloudflare plugin must not be created yet.

## Windows authentication gate — user-provided live evidence (2026-10-16)
- PowerShell unauthenticated POST `http://127.0.0.1:58347/mcp` with JSON-RPC initialize returned `HTTP Status: 401` and `PASS - Authentication protection works`.
- **WIN-AUTH-NEGATIVE PASS**: anonymous MCP access rejected on the user's Windows host.
- Combined Windows evidence: `/health` alive and anonymous `/mcp` POST 401. Authenticated tool handshake and native `npm test` output have NOT been supplied.
- macOS native `/health` and anonymous 401 remain PENDING. No tunnel or ChatGPT plugin has been created.

## macOS native HTTP gates — user-provided live evidence (2026-10-16)
- Mac Terminal `curl http://127.0.0.1:58347/health` returned `{"status":"alive","name":"gsa-localconnector","exposedTools":"read-only"}`. **MAC-HEALTH PASS**.
- Unauthenticated POST `/mcp` with JSON-RPC `initialize` returned `HTTP Status: 401`. **MAC-AUTH-NEGATIVE PASS**.
- Combined Windows/macOS native health and anonymous-token-rejection gates: **4/4 PASS** based on user-supplied local outputs.
- No claim yet for authenticated initialize/tools/list from either host, macOS `npm test` output, tunnel provisioning, external HTTPS MCP, startup persistence or shell/CI containment.
- NEXT: run authenticated MCP initialize + tools/list locally without printing the token; then configure distinct Cloudflare tunnel only after local gates PASS; no ChatGPT plugin until tunnel READY.

## macOS authenticated MCP initialize — user-provided evidence (2026-10-16)
- macOS authenticated POST `http://127.0.0.1:58347/mcp` with token read locally from `~/Library/Application Support/GSA-Localconnector/mcp-token` returned JSON-RPC result: `protocolVersion=2025-03-26`, `serverInfo.name=gsa-localconnector`, `serverInfo.version=0.1.0`, `capabilities.tools.listChanged=false`.
- **MAC-AUTH-INITIALIZE PASS**; token was not included in evidence.
- Windows authenticated initialize and both hosts' authenticated tools/list still pending; actual Cloudflare tunnel and ChatGPT plugin not created.
