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

## Windows authenticated MCP initialize — user-provided evidence (2026-10-16)
- Windows PowerShell loaded bearer secret from `%LOCALAPPDATA%/GSA-Localconnector/mcp-token` without printing it and successfully POSTed authenticated JSON-RPC initialize to `http://127.0.0.1:58347/mcp`.
- Response: `protocolVersion=2025-03-26`, `serverInfo.name=gsa-localconnector`, `serverInfo.version=0.1.0`, `capabilities.tools.listChanged=false`.
- **WIN-AUTH-INITIALIZE PASS**; macOS authenticated initialize also PASS. Health and anonymous-denial tests already PASS on both systems.
- NEXT: verify authenticated `tools/list` on Windows and macOS, then native tunnel preparation; Cloudflare and plugin still not created.

## Windows authenticated tools/list — user-provided native evidence (2026-10-16)
- Windows authenticated POST `/mcp` with `MCP-Protocol-Version: 2025-03-26` and JSON-RPC `tools/list` succeeded.
- Exact three tools returned: `connector_status`, `list_workspaces`, `get_workspace`; descriptions reflect read-only scope.
- **WIN-TOOLS-LIST PASS**. The MCP catalog exposes no shell/write/CI tools.
- macOS authenticated tools/list still PENDING. Tunnel and ChatGPT plugin not created. Next: macOS authenticated tools/list; then install dedicated tunnel and confirm external HTTPS authentication.

## Native MCP read-only validation complete — Windows + macOS (2026-10-16)
- macOS authenticated `tools/list` returned exactly `connector_status`, `list_workspaces`, `get_workspace`, including expected read-only descriptions and inputSchema.
- **MAC-TOOLS-LIST PASS**. Together with previously recorded Windows tests, both platforms have now passed `/health`, unauthenticated `/mcp` rejection (401), authenticated `initialize`, authenticated `tools/list`: **8/8 platform-gates PASS**, user-provided native outputs.
- Next checkpoint: dedicated Cloudflare Tunnel install on each target host, unique hostname(s), external TLS and authenticated MCP verification. No tunnel or ChatGPT plugin is claimed READY. Never expose bearer secret in chat or GitHub.
- Security reminder: the current published tools remain read-only; source/file write, shell and local CI not exposed.

## Transport switch — OpenAI Secure MCP Tunnel primary (2026-10-16)
- User explicitly reversed Cloudflare-first decision: **OpenAI Secure MCP Tunnel is primary**; Cloudflare postponed, optional for multi-provider support.
- Official reference: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels . Updated `docs/tunnel/SETUP.md` with separate Windows/macOS stdio-first install/human runbook and added transport decision to `docs/plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md`.
- Target topology: ChatGPT private custom MCP plugin -> OpenAI tunnel -> tunnel-client on selected host -> `node dist/src/mcp/cli.js` stdio. Existing HTTP loopback and 8/8 Windows/macOS test evidence remain valid; **do not expose local HTTP publicly**.
- Human blockers: OpenAI Platform Tunnels Read+Manage/Use permission, per-host tunnel_id and scoped runtime API key, installation of official tunnel-client on each machine, `doctor` + `run` live evidence, plugin creation and actual `connector_status` invocation.
- **Not yet PASS:** OpenAI tunnel setup on either host, native tunnel-client and private ChatGPT plugin. Current connector tools remain read-only; write/shell/CI sandbox blocked. Secure tunnel default request deadline 120s, so implement durable async runs for long jobs.
- Next resume: user chooses first host; obtain nonsecret tunnel ID and doctor/ready observations from user's machine; never collect API key in chat. Validate one private plugin end-to-end before configuring second host.

## User-approved single-plugin architecture (2026-10-16)
- **Exactly ONE ChatGPT plugin (`GSA-Localconnector`) and ONE shared stable OpenAI `tunnel_id`** across two separately installed Windows/macOS runtimes. Supersedes all older notes suggesting one plugin or tunnel per OS.
- OpenAI stdio tunnel-client restriction: NEVER run two instances sharing the tunnel ID concurrently. Manual exclusive handoff only: stop and fence old client, ensure no pending/in-flight requests, start new OS profile with same ID, verify ready + connector_status OS. If old host inaccessible, revoke its runtime authorization before switching. No failover, session routing or fencing implementation claimed yet.
- Updated docs/tunnel/SETUP.md and unified implementation plan. Still waiting for Human to create ONE OpenAI tunnel and ONE plugin. Native Windows/macOS 8/8 read-only MCP gates PASS from user evidence.

## Windows GPTWorker tunnel binary reuse — source-only checkpoint (2026-10-16)
- User confirmed Windows `npm install --ignore-scripts`, `npm test` (8/8 PASS), `npm run build` PASS at repo commit `c84e006`. `tunnel-client` missing from PATH; the literal placeholder `<SHARED_GSA_TUNNEL_ID>` caused PowerShell parsing error. Those are onboarding instructions, **not** source test failures.
- Inspected actual GPTWorker source `openai-tunnel.ps1`: it already uses OpenAI tunnel-client binary stored at `chatgpt-local-worker/bin/tunnel-client.exe`, a YAML profile, `CONTROL_PLANE_API_KEY` environment reference, a dedicated health port.
- Added GSA-owned Windows launcher `reuse-gptworker-tunnel.ps1`. Reuses *existing GPTWorker executable only*, not its active process, tunnel ID, API key, profile, task or startup registration; isolated GSA profile under %LOCALAPPDATA% and health port 58348; launches the verified `dist/src/mcp/cli.js` via stdio.
- Primary local step: `powershell -NoProfile -ExecutionPolicy Bypass -File .\reuse-gptworker-tunnel.ps1 -Action check`; fallback `-TunnelClientPath` for existing install in alternate location. No tunnel-client PATH install needed on Windows.
- **Important NOT YET VERIFIED:** script launched on actual Windows, existing GPTWorker binary detection, doctor with real GSA tunnel ID/key, real OpenAI tunnel, plugin registration. Do not mark PASS until user evidence.
- Human still must create ONE GSA-Localconnector-specific OpenAI tunnel and authorize runtime key; **never use GPTWorker's tunnel ID or API key** for this connector. The stable GSA plugin is independent of GPTWorker.
- Mac: do not attempt to run Windows .exe; evaluate already-present Mac tunnel-client separately. Native read-only MCP tests remain 8/8 PASS across Windows/macOS.

## Windows GPTWorker binary reuse — LIVE PASS (2026-10-16)
- User executed `git pull --ff-only origin main` to `d7f1d85` in `D:\00 Other Works\Vibecode\GSA-Localconnector`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\reuse-gptworker-tunnel.ps1 -Action check` returned `PASS: existing tunnel-client binary found; GPTWorker unchanged.`
- Found existing `D:\00 Other Works\Vibecode\chatgpt-local-worker\bin\tunnel-client.exe`, version `0.0.14+0f870e50a973fa820d4c409000059e181e8d242b`.
- **WIN-TUNNEL-BINARY-REUSE PASS**, no new installation needed. This is executable discovery, not a tunnel connection, doctor or plugin PASS.
- Next: provision distinct GSA OpenAI Tunnel ID and scoped runtime key; verify dedicated profile/doctor/run without disturbing GPTWorker; validate macOS existing client separately.

## Windows OpenAI tunnel doctor/runtime failure and code fix — 2026-10-16
- User provided actual Windows doctor/run logs. Doctor PASS config_source, profile_load, tunnel_id, CONTROL_PLANE_API_KEY reference, stdio MCP target declaration and health listener. Doctor FAIL `mcp_command_executable`; tunnel run failed immediately while spawning local MCP, before ready, with `fork/exec C:Program Filesnodejsnode.exe` file not found.
- Root cause: GSA launcher generated stdio command containing Windows `C:\Program Files\nodejs\node.exe`; tunnel-client 0.0.14 command parser removes backslashes as escapes, leaving invalid `C:Program Filesnodejsnode.exe`.
- Fix commit `c4a124407d312f4c27b718e3e65b9fba9c75744d`: normalize Windows node executable and MCP script paths to forward-slash form while quoting whitespace-sensitive arguments in dedicated YAML profile.
- **FIX NOT LIVE VERIFIED YET.** User must pull updated main and rerun `-Action doctor` then `-Action run` only if doctor PASS. Avoid claiming tunnel READY or plugin LIVE before ready confirmation. The runtime stopped after failed spawn; GPTWorker was not modified.

## Windows OpenAI tunnel READY — user live evidence (2026-10-16)
- User ran `Invoke-WebRequest http://127.0.0.1:58348/readyz -UseBasicParsing` on Windows; result `StatusCode: 200`, `Content: ready`, timestamp `2026-10-16 03:56:11 GMT`.
- **WIN-OPENAI-TUNNEL-READY PASS** based on live native /readyz endpoint. The earlier Windows path parser fix has not been independently re-run through doctor output in this turn, but tunnel runtime now reports ready.
- Still pending: proof of ChatGPT private plugin connection, remote tool discovery/`connector_status`, explicit GSA host identity, macOS tunnel handoff. Do not claim plugin LIVE or read/write/shell/CI enabled.
- Next human action: in ChatGPT Plugins create ONE custom MCP server plugin `GSA-Localconnector`, Connection=Tunnel and select the existing GSA OpenAI tunnel, then invoke `connector_status`. Keep macOS tunnel-client stopped during Windows testing.

## ChatGPT private GSA-Localconnector plugin E2E verified — 2026-10-16
- User invoked installed `gsa-lc` plugin. Direct `mcp__gsa_lc__connector_status({})` returned `ok=true`, name `gsa-localconnector`, apiVersion `1`, capabilities `platform=windows`, `arch=x64`, `shellIsolation=blocked`, `localCi=blocked`, `readyForShell=false`.
- Direct `mcp__gsa_lc__list_workspaces({})` returned `ok=true`, `result=[]`.
- **WINDOWS CHATGPT -> OPENAI TUNNEL -> LOCAL MCP TOOLS E2E PASS.** Plugin connection real and tool calls succeeded. Workspace registry is currently empty; shell/write/CI are not enabled and are not certified.
- Next: implement secure local workspace enrollment and native containment before exposing coding operations. macOS handoff using the SAME plugin/tunnel still pending; do not launch both hosts simultaneously.

## Approved two-plugin concurrent Windows/macOS design (2026-10-16)
- User requests two separate plugins because Windows and Mac must be able to serve distinct projects **at the same time**. **Supersedes** earlier shared plugin/tunnel and exclusive handoff guidance.
- Windows existing ChatGPT plugin and its OpenAI tunnel **remain unchanged and verified E2E**. Optional UI rename `gsa-lc-win`, but do not disrupt a functioning connection.
- macOS needs a distinct OpenAI tunnel ID and a second private ChatGPT plugin (suggested `gsa-lc-mac`). Different tunnel-client profiles and per-host secrets. Same source/runtime protocol; permissions/session/workspace root registries scoped to each host.
- Both may run concurrently because **tunnel IDs differ**; never reuse same stdio tunnel ID on two machines. GSA routes each project explicitly through its corresponding plugin; no cluster/failover implemented.
- Updated docs/tunnel/SETUP.md and implementation plan. macOS tunnel/plugin provision and dual-host parallel test **NOT YET PASS**.

## macOS dedicated OpenAI Tunnel READY — native user evidence (2026-10-16)
- macOS Terminal `curl -i http://127.0.0.1:58348/readyz` returned `HTTP/1.1 200 OK`, response body `ready`, dated Fri 16 Oct 2026 04:11:52 GMT.
- **MAC-TUNNEL-READY PASS** for local tunnel runtime health endpoint (independent new macOS tunnel per user setup). This alone does not prove correct tunnel ID/remote routing or live ChatGPT plugin invocation.
- Windows plugin and tunnel already passed E2E; keep that installation unchanged. Next: create/connect macOS-specific private plugin `gsa-lc-mac` to NEW Mac tunnel, call `connector_status` and confirm `platform=darwin, arch=arm64`, then `list_workspaces`. Shell, CI and writes remain blocked.

## macOS ChatGPT private plugin E2E PASS — 2026-10-16
- User installed `gsa-lc-mac` plugin and invoked it. Live connector tool `mcp__gsa_lc_mac__connector_status({})` returned `ok=true`, `name=gsa-localconnector`, `apiVersion=1`, `capabilities.platform=macos`, `arch=arm64`, `shellIsolation=blocked`, `localCi=blocked`, `readyForShell=false`.
- Live `mcp__gsa_lc_mac__list_workspaces({})` returned `ok=true`, empty `result=[]`.
- **MAC CHATGPT -> DEDICATED OPENAI TUNNEL -> LOCAL MCP E2E PASS.** Windows plugin previously independently passed E2E. Two distinct installed plugins/tunnels now exist, but simultaneous cross-host work was not stress-tested.
- Next: secure Workspace enrollment/grant persistence and native shell sandbox implementation; current tools remain read-only with no enrolled workspaces. Do not claim coding/CI readiness.

## Phase 2 read-only Workspace implementation (2026-10-16)
- Added `src/local/grants.ts` persisted trusted Workspace registry per OS account and `src/local/workspace-cli.ts` supporting local `enroll-read`, `list`, `revoke`. Enrollment is NOT exposed over MCP. OS local app-data state, no path control from remote tools.
- Stdio tunnel MCP now loads enrolled roots at startup on Windows/macOS. Registered `list_directory` (500-entry max) and `fetch_file` (64 KiB UTF-8 max) using canonical-path read checks. Existing `connector_status`, `list_workspaces`, `get_workspace` preserved. Direct tools are read-only; shell/write/CI deliberately NOT registered.
- New `test/grants.test.ts` covers grant persistence/denial/revoke and corrupt-data fail-closed; updated stdio/HTTP tool-catalog tests. Added `docs/workspaces/LOCAL-ENROLLMENT.md` with host-specific commands and explicit security boundaries.
- Initial CI failed due to Linux stdio bootstrap attempting unsupported host-owned macOS/Windows grant-store path; code correction `c2429a52535806c4456911e282cf5a2ae107ed6a` keeps Linux CI stdio test harness on empty in-memory registry only, while Windows/macOS load protected grants. **Cross-platform CI re-verification pending**.
- Security caveats: read path realpath enforcement does NOT provide a race-free native sandbox (TOCTOU), and revocation requires MCP process restart. No high-sensitivity or adversary-writable folders should be enrolled until stronger protections verified. The target original plan's secure write/execution/Git/CI features remain unimplemented; never claim full coding readiness.
- Resume: check GitHub Actions run for correction, fix any failures, then test local enrollment/read/revoke on both hosts without exposing secret content. Implement platform-native isolation before exposing `run_command` or local CI.

## Phase 2 source CI verified — 2026-10-16
- GitHub Actions [run 38850073521](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38850073521) for source revision `c2429a52535806c4456911e282cf5a2ae107ed6a`: **Windows PASS, macOS PASS, Ubuntu PASS**. This verifies unit and E2E stdio contract tests for read-only Workspace support, NOT native directory enrollment on user's machines.
- Follow-up checkpoint-only commits did not alter TypeScript source. Local Windows/macOS smoke after git pull and restart still PENDING.

## macOS native Workspace enrollment — verified local, tunnel reload pending (2026-10-16)
- User Mac at `~/GSA-Localconnector` pulled source through commit `482fc6d`, ran `npm test`: **10/10 PASS**, zero failed, including trusted grant persistence, invalid-store fail-closed, stdio, HTTP and path escape tests.
- User ran `npm run workspace -- enroll-read gsa-source "$HOME/GSA-Localconnector"`: success. Local `npm run workspace -- list` returned `workspace_id=gsa-source`, canonical root `/Users/nam/GSA-Localconnector`, permissions `[read]`.
- Direct **live** `mcp__gsa_lc_mac__list_workspaces({})` still returns `[]`: existing tunnel MCP process has not reloaded host grants. **MAC LOCAL ENROLL PASS; MAC REMOTE GRANT VISIBILITY PENDING**.
- NEXT HUMAN: restart ONLY macOS GSA-Localconnector tunnel-client (not GPTWorker/Windows tunnel), preserving Mac runtime credentials in the new process environment; then call `list_workspaces`, `list_directory` and `fetch_file` via Mac plugin. Do not mark remote file tools PASS prematurely.

## Windows native Workspace enrollment — verified local, remote validation blocked (2026-10-16)
- Windows repo `D:\00 Other Works\Vibecode\GSA-Localconnector` pulled main through `e897a62`; `npm test` **10/10 PASS**, zero failures.
- Local `npm run workspace -- enroll-read gsa-source "D:\00 Other Works\Vibecode\GSA-Localconnector"` succeeded. `npm run workspace -- list` returned read-only grant `gsa-source` with canonical Windows root.
- **WIN LOCAL ENROLL PASS**; runtime must restart the GSA Windows MCP tunnel to reload local grant store.
- Live attempt `mcp__gsa_lc__list_workspaces({})` returned connector error `Session terminated` instead of a tool result; **remote workspace visibility remains UNVERIFIED**. Do not claim it has loaded grants or that remote file calls pass.
- Next: verify Windows GSA-only tunnel runtime running and `/readyz` port 58348; restart GSA tunnel if required (do not touch GPTWorker), then retry plugin `list_workspaces`, `list_directory`, `fetch_file`. Mac remote visibility was also pending restart in previous checkpoint.

## Activation correction — plugin + supplied absolute workspace paths (2026-10-16)
- User corrected earlier erroneous requirement to manually enroll workspaces in OS terminal. GPTWorker job invocation passes workspace to a selected job/agent; GSA-Localconnector must accept **one or multiple absolute folder paths directly in the selected plugin invocation**. Here NO job/agent is spawned: GSA is the calling agent.
- `src/mcp/server.ts` now includes `bind_workspaces` MCP tool with `paths[]`: validates absolute existing directories, canonicalizes, derives host-local IDs, persists read-only grants and adds them to current runtime. Updated MCP tools-list tests and `docs/workspaces/LOCAL-ENROLLMENT.md`, plus plan clarification. Windows plugin `gsa-lc` and macOS `gsa-lc-mac` remain separate host targets.
- GitHub Actions run 38850712120 PASS on revised tool catalog/source (Windows/macOS/Ubuntu); **native live plugin binding and persistence validation still PENDING**; current plugin may need tool metadata refresh/restart after updating sources on each host. Shell/write/CI remain blocked pending native containment. No job lifecycle is to be implemented.
