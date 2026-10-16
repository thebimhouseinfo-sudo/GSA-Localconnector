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

## Continuing implementation after reading unified plan — 2026-10-16
- Re-read `docs/plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md`: direct GitHub-like tools, Workspace-relative access; GSA owns planning/agent lifecycle. Current decisions override obsolete older plan notes: two independent plugins/tunnels, host selected by plugin, user supplies absolute Workspace paths via `bind_workspaces`.
- Implemented additional read-only MCP tools: `get_file_info` (stat + SHA256 for regular files <= 8 MiB) and `search` (bounded in-process UTF-8 literal search: <=200 files, <=100 matches, <=64KiB per file, skips hidden entries/symlinks). Workspace root `.` now supported for safe directory reads/search. Updated MCP list-contract tests and added `test/workspace-tools.test.ts` for search/metadata, traversal denial, argument validation.
- Caught CI failure for Workspace root child-path `./src` rejection; fixed to normalize root child paths in commit `8baba006`, updated test expected normalized path in `b00741fa`. **Latest CI on `b00741fa` pending final result at time of checkpoint; do not declare PASS until complete**.
- Shell/process, Git mutation, local CI and write operations remain SECURITY_BLOCKED pending OS-native confinement and dedicated grants; cross-host live plugin tool testing requires human to pull/restart separately.
- Next: verify final CI, add bounded read-only source discovery / paginated file ranges and tests, then evaluate Windows/macOS isolation prototyping against SEC01 before any shell tool is exposed. No local test required yet.

## CI confirmation — file discovery batch
- GitHub Actions run [38851369558](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38851369558), commit `b00741fa362590557d232e01f9e6f28fa36805e7`: **Windows PASS, macOS PASS, Ubuntu PASS**. Unit and MCP contract tests only; native plugin Workspace bind and OS isolation still pending. Latest subsequent commits only checkpoint documentation.

## User directive: finish all tool implementation before any local tests (2026-10-16)
- User explicitly directed: WRITE **ALL** planned tools before asking for Windows/macOS local testing. No partial-phase native smoke-test requests. GitHub CI/build/unit checks continue during implementation.
- Added full direct tool schema catalog `src/mcp/catalog.ts`: filesystem mutations, process/shell, Git and local CI. All unimplemented/unsafe tools currently return `SECURITY_BLOCKED` (discoverability is NOT execution readiness). Existing read-only tools continue working. New `list_capabilities`, bounded `glob` added, with expanded catalog contract tests.
- Windows/macOS native isolation remains unverified; no claim that registering these APIs constitutes actual implementation. Current source batch has ongoing CI after fixing glob escaping (`7e8debd`).
- Next milestones: implement real file write/edit/patch and Git operations behind defensible scoped grants, implement safe process containment and CI DAG/evidence, complete all tool handlers and automated negative tests. Only THEN ask human for a consolidated local test on Windows/macOS. Keep two dedicated plugins/tunnels unaffected until that point.

## Full tool-catalog first — implementation progress (2026-10-16)
- Following user instruction, no further incremental local user testing until complete tool implementation. GitHub CI remains iterative.
- Added `src/mcp/catalog.ts` full **schema** for remaining files, process/shell, Git and CI tools; published in `tools/list`. **SCHEMA PRESENCE IS NOT TOOL IMPLEMENTATION**: unimplemented/unverified operations deterministically return `SECURITY_BLOCKED`. Never characterize write/Git/process/CI as functional.
- Implemented `list_capabilities` and bounded `glob`, retained prior read-only `bind_workspaces`, `list_directory`, `fetch_file`, `get_file_info`, `search`. Added test verifying unsafe `run_command` fails with `SECURITY_BLOCKED`. Updated HTTP/stdio catalogs and corrected test assertions for discoverable-but-blocked APIs.
- CI at source `e7b6cd929b777db9545afe167160334b544451a8`: run 38851918346 in progress when written (Ubuntu, macOS passed; Windows pending). No source rollout requested from human.
- Continue remaining actual implementations (not schemas) and OS-native sandbox tests; do not ask for local test before all planned tools are implemented or explicitly report hard security blocker preventing completion.

## Automated implementation continuation — 2026-10-16 (no human gate yet)
- User asked to proceed autonomously and stop ONLY when a human-required local action or decision is reached. Work so far remains on GitHub repo; no native installs or restarts requested.
- Added `src/core/edit-guards.ts` pure SHA256 precondition and unique exact text edit planner. Rejects stale expected hash, ambiguous match, invalid UTF8; produces before/after hashes and `committed:false` without writing. `test/edit-guards.test.ts` passes in GitHub Actions run 38854433950 on Windows/macOS/Ubuntu.
- Added `src/core/ci-dag.ts` strict pure dependency DAG parser with missing-dependency/cycle/unknown-key rejection, plus `test/ci-dag.test.ts`; CI run 38854501279 underway at checkpoint time.
- Neither module confers filesystem write or shell authority; security gates still block unverified execution. User requires full tools before local test.

## Autonomous implementation batch — 2026-10-16
- User authorized autonomous ongoing implementation; only interrupt human at a true native/permission decision. Direct plugins `gsa-lc` (Windows) and `gsa-lc-mac` (macOS); no local test until entire tool set implemented, as instructed.
- Completed additional **source modules**: `src/core/edit-guards.ts` (hash-guarded exact edit), `src/core/ci-dag.ts` (workflow DAG schema), `src/core/ci-journal.ts` (revision-bound state/evidence), `src/core/session-lease.ts` (single-controller exclusive lease), `src/core/git-plans.ts` (strict Git argv plans), `src/core/native-io.ts` (typed native backend boundary), `src/core/write-engine.ts` (file mutations against injected verified backend). Updated `fetch_file` with bounded line ranges, `ci_validate_workflow` with JSON-compatible YAML-subset validation. Added unit tests for these modules; all read-only tools remain separately usable.
- Critical distinction: **native file backend, OS sandbox backend, real Git/process runner, and CI executor remain unimplemented/unverified**. Discoverable shell/write/Git/CI calls still return `SECURITY_BLOCKED`; injected-backend tests do not assert host sandbox PASS.
- Latest source revision `f924ca62be310200535ff8faceaeec49095f6ada` GitHub Actions [run 38855140581](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38855140581): Ubuntu and macOS PASS, Windows in progress at checkpoint time. Continue checking CI, fix failures, implement remaining actual tools, review source pinning to GPTWorker without modifying its repo. Only after full source and CI review request one consolidated Windows/macOS native E2E/security test.

## Verified cross-platform CI before autonomous scheduled continuation (2026-10-16)
- GitHub Actions [38855140581](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38855140581) for revision `f924ca62be310200535ff8faceaeec49095f6ada`: **Windows PASS, macOS PASS, Ubuntu PASS**. Later checkpoint-only changes do not modify source. The code includes native scoped I/O interface and mocked file mutation tests; this is NOT proof that native confinement exists.
- User authorized automatic continuation until a real human gate. Scheduled autonomous follow-up configured hourly; source of truth is this checkpoint and Implementation Plan. No user local test now. Exact status remains: schemas complete, actual host-native backends and several MCP handlers incomplete.

## Live autonomous continuation (2026-10-16)
- User requested immediate work rather than waiting for hourly scheduler. Existing schedule is once per hour (system minimum for scheduled automation); development continued in this conversation without waiting.
- Implemented `ci_list_workflows`: inspect scoped `.gsa/ci.json` with strict DAG validator; classify `.gsa/ci.yaml` as unsupported format rather than pretending to parse arbitrary YAML; fail closed on escaped paths, require read grant, never execute command. Added empty/valid manifest tests in `test/workspace-tools.test.ts`. Latest source revision `1418986b691d0aaea7d69bbe65bb2b486342702c`; CI run [38855451479](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38855451479) pending at checkpoint time.
- Remaining hard engineering work: native OS file backend, sandboxed process backend, session lease integration, Git backend, CI snapshot/scheduler/evidence and all security negative tests. No user local test requested until entire tool set is implemented.

## CI verified — immediate continuation
- GitHub Actions run [38855451479](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38855451479) for source `1418986b691d0aaea7d69bbe65bb2b486342702c`: Windows PASS, macOS PASS, Ubuntu PASS (MCP and unit tests). No native sandbox claims; code changes not deployed on users' live local hosts.

## HUMAN GATE: choose and verify native sandbox substrate — 2026-10-16
- Continued immediately beyond previous checkpoint. Added `src/core/ci-evidence.ts`, `src/core/process-manager.ts`, `src/core/git-engine.ts`, `src/core/ci-scheduler.ts`, `src/mcp/write-dispatch.ts`, `src/mcp/batch-dispatch.ts`, `src/core/unified-patch.ts`, native-gated direct MCP handlers for file mutations, strict patches, Git and process actions, and associated tests.
- Added **Docker Linux-container candidate** `src/hosts/docker-sandbox.ts` with pinned image, no network, read-only root, cap drop, no-new-privileges, resource limits, non-root identity, one canonical Workspace mount, and no Docker socket; `test/docker-sandbox.test.ts` verifies the generated command arguments and mocked runner. GitHub Actions run [38856446614](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38856446614) for revision `a75f0fc75f1ff309ff672e1923530393b1f8f59e`: **Windows/macOS/Ubuntu CI PASS**. This is only code validation; **NOT** OS containment proof.
- Security decision doc `docs/security/NATIVE-SANDBOX-GATE.md` explains requirements and limited Docker capability. Docker Linux containers cannot execute Windows-only or macOS-only native programs; those projects need native host-specific sandbox paths. Current Docker candidate has NOT been promoted to `VerifiedNativeSandbox`; write/shell/Git/CI still blocked on user's live plugins. CI process lifecycle and journal persistence need further implementation after sandbox selection.
- HUMAN REQUIRED before completing native execution backend: confirm whether Docker Desktop Linux containers are acceptable for Windows/macOS local coding projects, and whether installed/running on each host (command: `docker version --format '{{.Server.Os}}/{{.Server.Arch}}'` and `docker info --format '{{.OSType}}'`). If not acceptable, choose OS-native isolation strategy instead. Do not ask to test individual tools; this is an architecture/environment prerequisite.
- Resume ONLY after this human decision. Neither Windows nor Mac application has been updated with new source or restarted in this batch; do not claim live tool PASS. Keep GPTWorker/CadGPT/RevitGPT untouched.

## Human environment feedback — Windows Docker CLI unavailable (2026-10-16)
- User executed Windows PowerShell `docker version --format '{{.Server.Os}}/{{.Server.Arch}}'` and received `CommandNotFoundException` / `docker is not recognized` from PATH. This establishes Docker CLI is not available in that PowerShell session; do not infer whether Docker Desktop is installed elsewhere or daemon state. `docker info` output was not provided.
- Windows Docker-based candidate cannot be validated from present environment. Do NOT ask user to install Docker without architecture decision. Keep shell/CI/Git execution blocked and prototype OS-native Windows confinement alternative as needed.
- macOS Docker capability has not yet been reported. Resume planning/source-only work that does not depend on Docker, but do not claim native security PASS.

## Human environment gate resolved — neither host has Docker CLI (2026-10-16)
- macOS user Terminal: both `docker version --format '{{.Server.Os}}/{{.Server.Arch}}'` and `docker info --format '{{.OSType}}'` returned `zsh: command not found: docker`.
- Windows user PowerShell: both commands returned CommandNotFoundException. Both current shells therefore lack Docker CLI; not proof no binary exists elsewhere.
- DECISION FOR IMPLEMENTATION: do not make Docker a prerequisite and do not ask for installation. Native Windows/macOS sandbox prototypes must be designed separately; shell/CI remain SECURITY_BLOCKED until OS-enforced negative tests pass. Docker candidate remains optional and inactive. GSA remains agent, gsa-lc and gsa-lc-mac direct connectors; user supplies absolute workspace directories.
- Further source implementation independent of native tests may continue. Next true human gate is testing the selected host-native security backend and legitimate SDK builds on both machines.

## Native-first source continuation — 2026-10-16 (no Docker)
- Implemented shared portable path gate `src/core/workspace-path.ts`, used by Workspace read resolver and native-gated file mutation engine. Rejects drive/absolute paths, traversal, mixed separators, Windows ADS `:`, reserved device names, control bytes and ambiguous trailing dots/spaces. Added negative tests on both supported OS.
- Added direct `unbind_workspace` persisted grant revocation via plugin. Maintained MCP tool catalog tests across stdio/HTTP.
- Implemented protected host-owned CI storage: `src/local/ci-store.ts` durable revision journal with cross-process exclusive update locks, `ci-artifacts.ts` bounded artifact bytes plus SHA256, `ci-log-store.ts` append-only log chunks with hash verification/pagination. Exposed Workspace-scoped MCP `ci_list_runs`, `ci_status`, `ci_artifacts`, `ci_read_artifact`, `ci_logs`. Added cross-Workspace deny tests.
- Added `src/core/ci-manifest.ts` strict YAML subset parser; `.gsa/ci.yaml` is now accepted in `ci_list_workflows` and `ci_validate_workflow` alongside JSON. Reject unsupported YAML features instead of guessing; added tests.
- Source revision `b3e53477650a9805c22a2cb4717824b4124568d0`: GitHub Actions [run 38858448388](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38858448388) **PASS Windows/macOS/Ubuntu**. Prior transient failures in this batch were repaired; current PASS covers unit/MCP contracts, NOT native sandbox.
- Remaining: native Win/macOS filesystem mutation backend, OS-enforced shell/process confinement, restart-safe CI run executor/snapshots, actual isolated local Git, authentication lease integration, startup lifecycle. These remain blocked / not native-verified. Do not request individual local tool tests until source completion. Docker not a prerequisite and absent on both host shells. No GPTWorker/CadGPT/RevitGPT changes. Next human gate requires a concrete host-native sandbox prototype plus SEC01 negative tests; still source work can continue.

## Continued source implementation — native-first, Docker optional (2026-10-16)
- User requested immediate coding. Implemented shared portable Workspace path gate (`src/core/workspace-path.ts`) now used by read resolver and write engine; rejects traversal, Windows ADS, device names, control characters, mixed separator, ambiguous path segments. Implemented persisted `unbind_workspace` direct MCP tool.
- Protected CI host persistence: `src/local/ci-store.ts` journal with exclusive per-run revision locks; `src/local/ci-log-store.ts` chunked/paginated log integrity; `src/local/ci-artifacts.ts` bounded artifacts and SHA256. Exposed `ci_list_runs`, `ci_status`, `ci_logs`, `ci_artifacts`, `ci_read_artifact` through Workspace ID access checks; stores instantiated lazily to keep unsupported Linux CI startup fail-closed. Added negative tests for cross-Workspace access and log/artifact bounds.
- CI workflow discovery/validation now accepts JSON and a deliberately strict subset of `.gsa/ci.yaml` through `src/core/ci-manifest.ts`; YAML aliases/tags/unknown nesting are rejected.
- Added `src/hosts/security-probe.ts` portable negative-control acceptance contract; synthetic unit PASS is explicitly never OS native certification. Added `src/hosts/native-file-candidate.ts` using final-component no-follow file open, lstat symlink denial, exclusive create and Workspace canonical parent checks. **It is NOT an injected NativeScopedFiles backend**; TOCTOU ancestor rename and Windows reparse-point enforcement still require OS-native proof.
- GitHub Actions [run 38858633513](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38858633513) on `b4e5add2bb98004a8f1a9dd305daf96905c57054`: PASS Windows/macOS/Ubuntu. This validates compile and automated contracts, NOT real local user-host security. No Docker installation requested; no user app touched.
- Next: continue native Windows/macOS file and process sandbox backends, isolate child SDK/cache/filesystems and run SEC01 negative tests; do not enable shell/Git/CI until native evidence. Existing plugin live runtimes are not updated by GitHub commits. No human test needed for this source batch.

## Autonomous security fixes — 2026-10-16
- Continued source work without local test. Fixed concurrent grant-store lost-update hazard in `src/local/grants.ts` with exclusive local writer lock; stale lock fails closed (`GRANT_STORE_BUSY`). File JSON serialization corrected after a failing CI run. Reject duplicate canonical roots to prevent two IDs silently aliasing one Workspace.
- Implemented `enrollReadOnlyBatch()` to validate ALL user-supplied root paths, then persist the new trusted grant set in one rename. `bind_workspaces` now calls batch API rather than persisting roots one at a time. Invalid second directory no longer partially enrolls the first. Note in-memory registry is updated only after persistence; no process/sandbox privilege changes.
- New tests `test/grant-lock.test.ts`: multi-workspace persistence/revoke, duplicate-root rejection, exclusive-lock denial, invalid multi-root all-or-nothing. GitHub Actions run [38859166543](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38859166543) at source `7c946aaa3c34403da88243e2fcc444fada191c8d`: Windows/macOS/Ubuntu **PASS**. No native OS isolation certification and no local plugin rollout.
- Still outstanding: OS-enforced Windows/macOS shell/CI sandbox and handle-relative filesystem mutations, complete durable scheduler/reconnect semantics, process cancellation. Keep shell/Git/CI blocked until proof. No Human step now; continue source work according to implementation plan.

## Autonomous continuation — crash reconciliation & process guard (2026-10-16)
- Implemented `reconcileInterruptedRun` in `src/core/ci-journal.ts`: PREPARING/RUNNING runs from a previous host lifecycle become UNKNOWN, never automatically PASSED or silently re-executed. Added explicit `CiJournalStore.reconcileInterrupted()` with revision-checked persistence; the method is opt-in supervisor recovery, not automatically called from arbitrary client read paths. Unit tests cover durable UNKNOWN and idempotence.
- Hardened `ProcessManager.run()` request validation: reject network-enabled requests, non-root working directory, invalid argv, excessive time/output limits; over-limit native response becomes UNKNOWN rather than false success. Tests cover the invalid request path and over-quota output.
- GitHub Actions run [38859533268](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38859533268), source `403c6d3619ab355e4fdedfff7ba951a0f24bd1fd`: Windows/macOS/Ubuntu PASS.
- Remaining native Windows/macOS process sandbox, handle-relative mutation and persistent supervisor activation tests; no shell/Git/CI permissions have been turned on. Native user-host test not yet requested; continue work autonomously.

## Current continuation — macOS native sandbox verification gate (2026-10-16)
- User ordered autonomous work until Human Gate. Source changes in this run: unified `ProcessManager.run` with shared start/settle and concurrency limits (`30729f6`), added concurrency test (`ca6782b`), added read-only Windows and Mac native substrate preflights (`scripts/check-native-sandbox.ps1` and `scripts/check-native-sandbox-macos.sh`).
- Native Mac Seatbelt test `test/macos-seatbelt-native.test.ts` produced SIGABRT for an allowed `/bin/cat` under sandbox-exec on GitHub's macOS runner (GitHub Actions run `38862428495` and `38862518500`). Restoring expected system read roots did not resolve it. The test now separately probes an allow-default baseline and SKIPS security proof with a diagnostic when the baseline is unavailable; **skip is NOT PASS**. Run `38862598349` (source `0cdb367`): test suite completed successfully on Windows/macOS/Ubuntu but native Mac sandbox proof remains UNVERIFIED.
- Windows AppContainer experimental API source is a policy planner only; no OS worker or native confinement proof. Docker CLI absent in user PowerShell and Mac Terminal; Docker is not required.
- HUMAN GATE: determine on user's Mac whether `/usr/bin/sandbox-exec` is actually runnable and native feature viability, and on Windows whether native sandbox substrate/OS version supports isolation. Run only the read-only preflight scripts or paste their commands; no SDK installation, UAC changes, elevated writes or tunnel restarts until results. Do not enable Git/shell/CI/process write capabilities on live plugin yet. Continue after user returns preflight output; plan alternative isolation on macOS if sandbox-exec remains unsupported.

## Consolidated CI implementation + native human gate — 2026-10-16
- User directed autonomous implementation until a genuine Human Gate, no one-off local tool tests.
- Implemented argument NUL validation, oversized CI evidence => UNKNOWN, deterministic immutable source manifest and protected source snapshot store with SHA-256 verification.
- Added durable async process controller contract and Workspace-specific IDs. Consolidated overlapping concurrent start/stop handlers. Native process backend is still NOT validated.
- Added ci_cancel for QUEUED-only (active run cancellation requires native process-tree proof); ci_rerun_failed creates fresh ID only with verified source fingerprint.
- Added native-gated ci_prepare_source, ci_run, CI run coordinator, strict source ownership and immutable source snapshots. Live plugins remain SECURITY_BLOCKED without verified native workers.
- Windows AppContainer and macOS Seatbelt manifest candidates present, NOT actual verified native sandboxes. Windows candidate syntax corrected.
- Read-only native capability preflight script added: npm run native:probe. No shell execution or credential read by this command; security_verified is always false.
- Source commit 9544e7d66dacf9b4ec8a717bed57b52199cecea2: GitHub Actions run 38862675054 PASS Windows/macOS/Ubuntu for unit and transport contracts. NOT user-host SEC01 native sandbox proof.
- HUMAN GATE: run native:probe on both local Windows and macOS checkouts and return JSON to determine actual runtime substrate capabilities. Do NOT install Docker or restart tunnels; no other apps altered.
- Windows source D:\\00 Other Works\\Vibecode\\GSA-Localconnector; macOS ~/GSA-Localconnector. Local code update by git pull --ff-only origin main; npm ci; npm run native:probe.
- Remaining OS-native confined execution, reparse-point-safe write backend, secure process tree cancellation and true SEC01 tests are blocked pending native host proof. Do not claim full tool set ready.

## Human macOS Seatbelt baseline — resolved (2026-10-16)
- User verified on actual MacBook macOS 26.6.2 / arm64: `/usr/bin/sandbox-exec` exists; `/usr/bin/sandbox-exec -p '(version 1) (allow default)' /usr/bin/true` returned exit code 0. This resolves only the executable availability/baseline human gate, NOT deny-policy confinement, negative-control or nested-process proof. GitHub runner had SIGABRT in stricter policy earlier, thus real host SEC01 remains pending.
- Resume coding and targeted policy-negative tests, do not claim OS sandbox verified or activate shell/Git/CI based on this baseline alone.

## HUMAN GATE — native Windows/macOS sandbox feasibility (2026-10-16)
- User requested autonomous code until a real human gate. Continued source edits, including native-gated process IDs/cancellation/status tests, inactive Mac Seatbelt policy planner (`src/hosts/macos-seatbelt-candidate.ts`), inactive Windows experimental AppContainer spec planner (`src/hosts/windows-appcontainer-candidate.ts`), CI working copy module (`src/local/ci-working-copy.ts`) with independent mutable bytes, and native security capability probes (`scripts/native-gate-windows.ps1`, `scripts/native-gate-macos.sh`). Added tests; CI workflow now `fail-fast: false` to gather evidence across all OS runners independently. Other automated iteration also added immutable source snapshot and process/CI services; do not overwrite concurrent code without fresh SHA.
- **Mac GH runner evidence**: `sandbox-exec` baseline works after fixing newline and `/usr/bin/true` fixture, but restricting Seatbelt profile makes even allowed `/bin/cat` command abort with SIGABRT (run 38863226218). Thus Mac candidate is NOT VERIFIED and is `SECURITY_BLOCKED`; negative controls cannot certify it. macOS test marks this feasibility blocker as an explicit SKIP, NOT a PASS. Do NOT relax the policy to get green CI without proving isolation.
- Windows new composable sandbox API is experimental, Windows 11 minimum, dynamically exported by `processmodel.dll` (`Experimental_CreateProcessInSandbox`). Native execution helper is NOT implemented, and Windows plugin stays SECURITY_BLOCKED. See https://learn.microsoft.com/en-us/windows/win32/secauthz/createprocessinsandbox .
- CI source at `c34253332ca0d1f0604b058b113422bb1407e9fb` GitHub Actions run https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38863411020 ; Linux/macOS PASS, Windows status pending when recorded. Green source CI is not OS security certification.
- Next Human Gate is **read-only sandbox availability probes on BOTH user's real hosts**, not individual MCP tool tests. On Windows repository at `D:\\00 Other Works\\Vibecode\\GSA-Localconnector`: `git pull --ff-only origin main`, then `powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\native-gate-windows.ps1`. On Mac repository `~/GSA-Localconnector`: `git pull --ff-only origin main`, then `sh ./scripts/native-gate-macos.sh`. Probe outputs contain only OS/arch/availability booleans; no secrets or OS modifications. Do not require Docker (both shells lack it). Stop source decisions requiring an OS sandbox until user supplies outputs. Do not claim native runtime tests pass, and do not enable shell/CI/Git/file writes until host-native SEC01 proof.

## Human Gate consolidated — Windows API + strict Mac Seatbelt policy (2026-10-16)
- After Mac baseline was already confirmed on the user's MacBook, added targeted macOS negative-control probe `scripts/native-policy-macos.mjs` exposed as `npm run native:policy:mac`. It creates disposable OS temp files only, executes candidate policy to verify allowed workspace read and denied sibling read/write, prints bounded booleans and `security_verified:false`, removes test files. This is *not* SEC01 full native certification. On GH macOS runner strict profile aborts, so `test/macos-seatbelt-native.test.ts` reports explicit candidate BLOCKED/SKIP rather than false PASS.
- Windows feature probe `scripts/native-gate-windows.ps1` checks Windows build/arch and `Experimental_CreateProcessInSandbox` export from processmodel.dll. No admin or OS mutations. Windows API experimental, not a verified native executor.
- GitHub Actions [38863783431](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38863783431) for commit `88d557a88678cc197a3959147bcaccde9b264cee`: **Windows, macOS, Ubuntu source/contract CI PASS**. Mac native sandbox constraint still unverified despite CI green.
- Human must run **only**: Windows repo checkout `git pull --ff-only origin main` then `powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\native-gate-windows.ps1`; Mac repo checkout `git pull --ff-only origin main`, `npm ci`, then `npm run native:policy:mac`. Do NOT repeat Mac baseline probe already completed. Report JSON. No Docker/install/restart or modifications to GPTWorker/CadGPT/RevitGPT.
- Until results arrive, keep all native file writes, Git execution, shell, process, Local CI SECURITY_BLOCKED. OS sandbox backend still incomplete and requires stronger SEC01 negative tests after candidate feasibility decision. Hourly automation is disabled at Human Gate.

## Seatbelt native negative-controls expansion (2026-10-16)
- User's Mac baseline `(allow default)` succeeded on macOS 26.6.2 arm64; that proves sandbox-exec launches, not root isolation.
- Extended `test/macos-seatbelt-native.test.ts` with actual symlink escape, nested `/bin/sh` child read-denial, and in-Workspace write-success controls; SIGABRT denial is explicitly differentiated from clean permission refusal. Source commits `9126837` and `e8b8411`.
- CI run [38864023706](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38864023706) completed PASS Windows/macOS/Ubuntu; native Seatbelt test contains explicit SKIP on unsupported macOS runner baseline/allowed-positive failure, so this must NOT be treated as native sandbox PASS. Latest `e8b8411` CI still pending at this note.
- Next meaningful Human Gate is executing the complete Seatbelt policy negative-control suite on user macOS host, in an isolated disposable temp workspace, from exact repo revision. Do not activate Git/shell/CI before that plus remaining native proof. Windows native sandbox approval/test remains separate.

## macOS Seatbelt extended policy source completed — host test gate (2026-10-16)
- Expanded `test/macos-seatbelt-native.test.ts` with symlink-to-outside read denial, nested shell child inheritance and allowed workspace write. Distinguished SIGABRT from clean denied read. Source `e8b8411` passed GitHub Actions [38864095260](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38864095260) on Windows/macOS/Ubuntu; conditional native Seatbelt test may SKIP on hosted runner and must NOT be reported as isolation proof.
- Updated local `scripts/native-policy-macos.mjs` for a disposable temporary Workspace with positive read/write, sibling read/write denial, symlink escape denial and nested shell denial; outcome only `EXTENDED_POLICY_NEGATIVE_CONTROLS_PASS`, while `security_verified` is always false until further review. Syntax error in first commit was detected by CI and repaired at `9204d15`. Run [38864299817](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38864299817) validates current revision.
- New HUMAN GATE: user Mac has already confirmed basic sandbox-exec works. Need output of `npm run native:policy:mac` from an updated checkout at `~/GSA-Localconnector` (requires existing Node/npm and dependencies). This tool creates and deletes temporary test files only, no modifications to trusted Workspace or installed plugins. If `EXTENDED_POLICY_NEGATIVE_CONTROLS_PASS` is not achieved, keep sandbox blocked and design alternative. A PASS here is feasibility only, not verified authorization to activate shell/CI.

## Host macOS native policy result: SECURITY_BLOCKED — 2026-10-16
- User MacBook at macOS 26.6.2 arm64 ran `git pull --ff-only`, `npm ci`, `npm run native:policy:mac` at repo commit `5de4381`. Build PASS, but native report: `baseline_allowed:true`, `workspace_read_allowed:false`, all negative controls false, `outcome:SECURITY_BLOCKED`, `security_verified:false`. This means strict Seatbelt policy cannot run the allowed `/bin/cat` on the actual host, not evidence that restricted access is denied correctly.
- Probe repair: canonicalize OS temp directory with fs.realpath before constructing Workspace policy (macOS `/var` vs `/private/var` can differ); print bounded positive command exit/signal/error/stderr with temp root redacted, NEVER private file content. Revision `4e292c5`; test asserts canonicalization/diagnostic secrecy and updated extended-outcome enumeration revision `f112da2`. GitHub Actions run [38865856521](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38865856521) PASS on Windows/macOS/Ubuntu. These are compile/test PASS, not native security verification.
- Next Human Gate is to run `git pull --ff-only origin main && npm ci && npm run native:policy:mac` again on MacBook, return JSON with `positive_probe`. If workspace_read_allowed remains false, debug native stderr/signal and consider alternative to deprecated sandbox-exec. Shell/Git/CI still SECURITY_BLOCKED; don't activate any native production backend.

## Host macOS 26.6.2 restricted Seatbelt SIGABRT — diagnostic ladder (2026-10-16)
- User reran `npm run native:policy:mac` from `110f52c` on actual MacBook macOS 26.6.2 arm64: `baseline_allowed:true`, `workspace_read_allowed:false`, positive_probe `exit_code:null`, `signal:SIGABRT`, `error_code:null`, empty stderr, `temp_path_canonicalized:true`, `security_verified:false`. Canonical temp path fix did not resolve Seatbelt crash. Do not infer that deny controls passed.
- Added three non-mutating sandbox-exec policy rungs in `scripts/native-policy-macos.mjs`: allow-default cat positive, deny-default unrestricted file reads/process exec, deny-default plus in-workspace file-write. Each reports exit code/signal/allowed, no secret content and only temporary fixture files. This isolates whether failure stems from basic deny-default semantics or specific restrictions. Commit `b339942f961ca9f25f040e9042f7b516b632308d`; GitHub Actions run 38866440583 PASS Windows/macOS/Ubuntu, but security_verified remains false.
- HUMAN GATE: user's local Mac must pull and execute `npm run native:policy:mac` to return `policy_ladder` and `positive_probe`; then choose native Seatbelt repair or alternative native isolation. No real connector sandbox, shell, Git execution, or local CI activation has occurred.

## macOS policy ladder follow-up — human gate (2026-10-16)
- Actual MacBook macOS 26.6.2/arm64 on source `49a63de`: baseline allowed, strict candidate policy `/bin/cat` aborted SIGABRT without stderr. Policy ladder observations: `allow_default_cat`: exit 65; `deny_default_exec_read`: exit 65; `deny_default_workspace_write`: exit 0 / allowed true. The first two rungs had an unused `-D WORKSPACE` option; their exit 65 may be argument usage, NOT evidence of sandbox permission denial. Third rung proves a deny-default profile containing broad file-read plus Workspace write can launch `/bin/cat`, NOT proof of root confinement.
- Reworked `scripts/native-policy-macos.mjs` in `69e951e` to pass `-D WORKSPACE` only when the profile references it; expanded diagnostic ladder to six incremental read/write/network combinations to isolate the strict policy crash. Updated test contract `d6fa023`. A Windows runner timing-dependent CI source capture integration test failed at 1 second; increased bounded settlement window to 6 seconds at `cfb23247`. GitHub Actions [run 38867377159](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38867377159) PASS Windows/macOS/Ubuntu. Green compile/CI remains distinct from native confinement proof (macOS native test may skip).
- Next HUMAN GATE: On MacBook pull new main then execute `npm run native:policy:mac`, return full JSON `policy_ladder` + `positive_probe`. Based on which restrictive rungs allow a valid read, adjust macOS policy before full negative security tests. Keep live plugin shell/Git/CI SECURITY_BLOCKED; don't declare security_verified or activate native backend.

## Seatbelt host strict-read isolation update (2026-10-16)
- User macOS arm64 policy ladder at `a8103f9`: `allow_default_cat`, `deny_default_exec_read`, `deny_default_workspace_write` all exit 0 / valid read; `restricted_read_no_write`, `restricted_read_with_write`, `restricted_read_write_network_deny` all SIGABRT and fail to launch. Therefore failure precedes network restriction; most likely the restricted file-read policy blocks launch-critical macOS resources. No native containment proof yet.
- Added temporary, diagnostic-only macOS Seatbelt rungs in `scripts/native-policy-macos.mjs` for `/dev`, `/private/etc`, `/private/var/db`, broad `/private` (DIAGNOSTIC ONLY; unsafe to promote), and combined narrower path grants to localize the missing runtime read. These only run against disposable temporary test fixtures and never change live plugin rights. Added rung contract coverage. Source `22d404dc`; GitHub Actions run [38868183670](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38868183670) PASS Windows/macOS/Ubuntu, **not sandbox certification**.
- NEXT HUMAN GATE: On actual MacBook `cd ~/GSA-Localconnector && git pull --ff-only origin main && npm run native:policy:mac` and return `policy_ladder` plus `positive_probe`. Do not enable shell/Git/CI or label sandbox verified. If broad `/private` works while narrow rungs fail, investigate required runtime paths further rather than shipping broad privacy-exposing policy.

## Mac host restricted-read verdict — stop blind Seatbelt expansion (2026-10-16)
- Human test on macOS 26.6.2 ARM64, repo `fadef0e`: all broad file-read profiles worked; restricted file-read positive controls SIGABRT, including system-read additions `/dev`, `/private/etc`, `/private/var/db`, broad `/private` diagnostic and combined variants. `baseline_allowed=true`, `workspace_read_allowed=false`, all actual denial tests unexecuted/false, `security_verified=false`. This profile has repeatedly FAILED legitimate in-scope reads; no confinement PASS can be claimed.
- Source update: `docs/security/NATIVE-SANDBOX-GATE.md` declares exact Seatbelt policy production-ineligible rather than further widening system reads. `src/hosts/macos-seatbelt-candidate.ts` exports explicit `MACOS_SEATBELT_HOST_VERDICT` status `BLOCKED_HOST_SIGABRT`, `production_eligible:false`, `security_verified:false`; regression test added. GitHub Actions [run 38868693898](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38868693898) PASS on Windows/macOS/Ubuntu for source/tests, NOT native confinement proof. Main source revision `c633537` before this checkpoint.
- Decision: redirect design to an independent macOS isolation substrate (native worker with approved OS sandbox/virtualization) and OS-native handle-relative files; never confuse separate user account/POSIX permission with root-isolation. Windows AppContainer still unverified. Shell/Git/CI continue SECURITY_BLOCKED; no more repetitive Mac Seatbelt path-grant human tests until new sandbox implementation is designed and available.

## macOS native alternate substrate implementation — 2026-10-16
- Exact Seatbelt profile remains production-ineligible after host 26.6.2 arm64 SIGABRT. Researched Apple's supported Virtualization.framework as a candidate; it supports Linux/macOS guests and requires virtualization entitlement. The chosen initial scope is Linux ARM64 guest for portable CLI only, NOT native macOS binaries.
- Implemented `src/hosts/macos-isolation-strategy.ts` fail-closed strategy assessment (`seatbelt-experimental` BLOCKED, `dedicated-account` BLOCKED, `virtualization-native-worker` CANDIDATE, never verified/executable) with regression tests.
- Implemented `src/hosts/macos-vm-policy.ts`: exact single Workspace share policy, no guest network adapter/host socket/USB/clipboard/secrets, bounded CPU/RAM/time, immutable fingerprint, `verified:false`, `executable:false`, plus negative contract tests. No VM launch or guest install.
- Added `native/macos-vm/CapabilityProbe.swift` as a read-only Apple Virtualization.framework import/host architecture probe; unknown codesign/entitlement are reported null, never falsely assumed false/true. `.github/workflows/ci.yml` macOS job compiles and runs this Swift probe without any VM launch.
- Added `docs/security/MACOS-VM-ISOLATION-DESIGN.md` explaining guest/supervisor boundary, limitations, and mandatory SEC01 proof. GitHub Actions [run 38869224288](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38869224288) at `7998863b410b4f76b5db51e72c5c622785f5391d`: PASS Windows/macOS/Ubuntu including Swift compile/probe.
- Remaining HUMAN/native gate: signed/entitled Swift VM worker, Linux ARM64 guest image selection/provisioning, actual host framework permission, end-to-end filesystem/process/network escape controls and native Windows work. No authorizing user action or executable worker yet; retain live Shell/Git/Local CI SECURITY_BLOCKED. Continue source implementation without requesting user to repeat old Seatbelt tests.

## VM worker protocol groundwork — 2026-10-16
- Implemented `src/hosts/macos-vm-handshake.ts` pure fail-closed host/worker claim verification: strict protocol version, workspace ID, matching policy SHA256, boot nonce, guest architecture ARM64, exactly one mounted share, zero network and socket devices and READY state. Tampered claims produce `SECURITY_BLOCKED`. Even a matching claim returns `security_verified:false`, `execution_authorized:false` because worker self-attestation cannot replace OS proof. Added tests in `test/macos-vm-handshake.test.ts`.
- Updated `docs/security/MACOS-VM-ISOLATION-DESIGN.md` with protocol limitations; no worker launch, guest image download or entitlement changes. GitHub Actions [run 38869931403](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38869931403) source `064d5aaa`: PASS Windows/macOS/Ubuntu including macOS Swift probe.
- NEXT: write signed native Swift VM worker and guest image lifecycle under explicit native hard gate, independent host measurements and SEC01. Shell/Git/CI remain blocked; no user-host action required yet.

## Native Swift VM worker preflight — 2026-10-16
- Implemented `native/macos-vm/WorkerPreflight.swift`: stdin JSON capped at 4096 bytes, workspace ID and resource limits validation, canonical-root and symlink checks, construction of Apple Virtualization.framework VZVirtioFileSystemDeviceConfiguration and one VZSharedDirectory, no network adapters. Does NOT boot a VM or authorize process execution; output explicitly `securityVerified:false`, `executionAuthorized:false`, `frameworkConfigurationValid:false` because guest boot/storage is not provisioned.
- GitHub Actions compiles the real Swift preflight on macOS, tests permitted canonical Workspace and rejects root '/' and malformed JSON. Initial macOS runner test with `/tmp` failed because symlinked root was correctly rejected; corrected CI to use canonical checkout. Final source `95cf7febcf100ef4953ff5151a5292fb83ebdd70`; [run 38870630917](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38870630917) PASS Windows/macOS/Ubuntu, including native Swift compile and negative fixtures.
- Next HUMAN gate is choosing/provisioning a pinned Linux ARM64 guest image and confirming local Virtualization entitlement/code signing and VM capability on actual Mac. Do NOT download OS images or request broad machine changes without explicit user approval; no shell/Git/CI activation. Swift worker remains safe preflight, not functioning virtualization process backend.

## Host preflight PASS and guest image gate — 2026-10-16
- Human MacBook (macOS 26.6.2 arm64) pulled `b0f50f3`, compiled `WorkerPreflight.swift` with Virtualization.framework, and successfully ran it against `$(pwd -P)`: returned `state:CANDIDATE_ONLY`, `fileShareTag:workspace`, `workspaceID:test`, `cpuCount:2`, `memoryMiB:2048`, `executionAuthorized:false`, `securityVerified:false` and `BOOT_IMAGE_AND_NATIVE_PROOF_MISSING`. Native preflight PASS only; not a booted VM or containment proof.
- Added `src/hosts/macos-vm-image.ts`: manifest schema with Linux ARM64/RAW format, absolute path, pinned SHA256, exact size, provenance, read-only streamed digest and symlink/type rejection; successfully verified manifest still returns `executable:false`, `security_verified:false`. This verifier is not a durable file descriptor lease and must not be used to authorize boot of the same pathname without host-native race protections. Added `test/macos-vm-image.test.ts` negative controls. GitHub Actions [38871985869](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38871985869) at source `c643d894e540e09effa0f7d231500c0dc98721cd`: PASS Windows/macOS/Ubuntu.
- HARD HUMAN GATE remains guest image selection/provisioning and VM entitlement/signing and live VM proof, including actual guest isolation. No OS image downloaded/installed, and shell/Git/CI remain blocked. Next step requires a user-approved guest image acquisition/provision workflow, not another Seatbelt test.

## Explicit image acquisition approval and next host gate — 2026-10-16
- User explicitly approved preparing an ARM64 Linux guest image for Mac-native VM testing.
- Selected official Canonical Ubuntu 24.04 LTS ARM64 cloud image `https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-arm64.img` with contemporaneous official SHA256SUMS (site release listing shows build 20260926 at this time). Disk image approximately 591 MB download. Apple VZLinuxBootLoader requires a separately provided ARM64 kernel/initrd for direct Linux boot; cloud image alone does not establish bootability.
- Implemented opt-in `scripts/prepare-ubuntu-arm64-image.mjs` for user-host use: macOS ARM64 gate, fetch Canonical SHA256SUMS, download with max-size and exact size check to exclusive temp file, streamed SHA256 verification, atomic rename, exclusive machine-local manifest, no overwrite. `boot_ready:false`, `security_verified:false`, `execution_authorized:false`. No VM launch, install or entitlements changed.
- Provenance note: official HTTPS checksum listing is *not* independently signed or immutably pinned; acquired `.img` cloud image is not the earlier verified raw-disk format. Needs format verification and controlled transformation before boot. Updated `docs/security/MACOS-VM-ISOLATION-DESIGN.md`.
- CI [38874832108](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38874832108) PASS 3/3 including script syntax check; latest docs-only CI pending at note. Human gate: user runs explicit script on MacBook (`node scripts/prepare-ubuntu-arm64-image.mjs`) after pulling latest repo; return JSON, troubleshoot without enabling connector execution. Image not downloaded to user host by GitHub-only code edits.

## Ubuntu guest image acquired; QCOW2 format gate (2026-10-16)
- Human MacBook ran `node scripts/prepare-ubuntu-arm64-image.mjs` successfully after pulling `66ded9a`. Local file: `/Users/nam/Library/Application Support/GSA-Localconnector/images/ubuntu-24.04-server-cloudimg-arm64.img`, exact size `620224512` bytes; verified downloaded SHA256 `1d6bffe64b848468ac97f821d369a4846d983de1800ccf6b5ec8853e85cefc55`. Acquisition PASS; not boot-ready.
- Added `src/hosts/macos-vm-disk-format.ts` header inspector: QCOW2 magic/version/virtual-size and backing/external-data indicators, always `safe_for_direct_vz_disk_attachment:false`, `boot_ready:false`, `execution_authorized:false`. Added `test/macos-vm-disk-format.test.ts` fixture coverage.
- Added read-only offline `scripts/inspect-ubuntu-arm64-image.mjs` to validate user's existing manifest, rehash file, detect header and report `format_conversion_required` without new network access, image changes or VM boot. CI [38876554470](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38876554470) PASS macOS/Windows/Ubuntu at source `3a28fcfff15a69cc3fba9202e08fc0eee3464a77`.
- New HUMAN GATE: on MacBook, pull main and execute `npm run build && node scripts/inspect-ubuntu-arm64-image.mjs`; return JSON. This is a read-only inspection, no conversion or boot. Once actual format is known, implement safe deterministic offline conversion/guest startup path and host native SEC01 proof. Shell/Git/Local CI remain SECURITY_BLOCKED.

## Mac QCOW2 v3 human inspection PASS; RAW conversion candidate — 2026-10-16
- Actual MacBook after `2765658`: `IMAGE_INSPECTED`, SHA256 verified, bytes `620224512`, `disk_format:qcow2`, `qcow_version:3`, `virtual_size_bytes:3758096384`, backing/external data `false`; `format_conversion_required:true`, `boot_ready:false`, `security_verified:false`, `execution_authorized:false`.
- Implemented opt-in `scripts/convert-ubuntu-arm64-image.mjs`: validates pinned source manifest, SHA256 and QCOW2 layout, checks installed `/opt/homebrew/bin/qemu-img`, detects backing/encryption and converts to a separate 3.5 GiB RAW file. Refuses overwrites; destination SHA256 and separate manifest emitted. No installation, VM boot or execution authority. Residual race on reopening source by external converter is documented; do not treat as trusted production pipeline.
- `docs/security/MACOS-VM-ISOLATION-DESIGN.md` updated; CI syntax check added. GitHub Actions [38879050648](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38879050648) at `4b9f158ef33139fd1b9a54f62002c66d3910c127` PASS Windows/macOS/Ubuntu. CI does not execute real conversion.
- HUMAN GATE: inspect whether `/opt/homebrew/bin/qemu-img` exists on actual Mac. If absent require user approval before installing; if present run opt-in conversion script. Shell/Git/local CI remain SECURITY_BLOCKED.
