# GSA-Localconnector — Unified Implementation Plan

Status: **DRAFT PROPOSAL — pending human approval/activation; no product PASS**
Revision: DRAFT-2026-10-17 — consolidate existing scope, criteria and remaining work.
Scope: independent simultaneous Windows/Mac plugins and distinct tunnels, one user
and one authenticated controller per host, multiple authorized roots. No cluster.
Mac-first changes sequencing only; Windows/cross-platform release remain required.

This refresh preserves the original goal/tool catalog/acceptance intent and latest
explicit user decisions. User operating logic: ../CRITERIA.md. Technical acceptance/evidence mapping: appendix below.
No implementation, runtime activation, completion marker or Git mutation is authorized.

## Product authority — user clarification, 2026-10-17

GSA-Localconnector is an offline GitHub: a local workspace and working-tool provider.
Binding a user-supplied workspace enables read/write/edit/delete, command/process,
Git and CI work within that workspace without connector approval gates or separate
read/write/execute unlocks. Safety enforcement protects data/resources outside the
bound workspace; it does not add task, review, promotion or mutation approval flows.
Authentication, path containment, hash-conflict detection and OS constraints still apply.
User may additionally grant read-only reference directories for cross-design or
knowledge lookup. Distinguish working workspaces (read/write/execute) from reference
roots (read/search only). Execution jobs, cwd and generated outputs belong to working
workspaces; reference roots cannot be mutation/execution targets, including via child
processes, symlinks or indirect tool calls. This does not forbid approved system
toolchains used to execute workspace jobs. Ungranted host data/credentials stay denied.

This supersedes earlier read-only-binding/separate-write-grant product requirements.
Current historical implementations may still have those restrictions: that is an
implementation gap, not the desired product. Development review/release work is separate from use of connector tools.

## 1. Purpose and non-goals

Build an offline GitHub workspace and working-tool provider for GSA through local MCP. GSA owns all reasoning, Project/Job/Task/Run orchestration, decisions and reviewer gates. Connector owns local filesystem, code search/edit/patch, shell and process execution, local Git, local-only CI (including folders without .git), reliable state/log/artifact persistence, registration and platform isolation. Borrow tested modules from `thebimhouseinfo-sudo/chatgpt-local-worker` without changing that existing application. GitHub Connector remains for GitHub-only PR/issues/Actions functions; GSA Memory Repo remains online.

No local Planner/Builder, Job Pack, fake CLI, generic `work_tool`, multi-user tenant system, multi-host scheduling, automatic GitHub sync, or CadGPT/RevitGPT-specific business logic. Linux is outside initial release scope.

## 2. System architecture and authoritative contracts

- Shared TypeScript/Node MCP server, schema-validated direct tools, workspace/capability registry, common CI DAG engine, immutable run evidence, typed errors; platform HostAdapter for filesystem, process containment, startup, host-secret storage, process tree and packaging.
- Same tools/schema across Windows and macOS; optional platform capabilities are explicitly negotiated in `connector_status`, never silently emulated.
- One active authenticated control session per installation with explicit lease; concurrent calls use request-local Workspace IDs without global cwd. No cross-host session lock.
- Ordinary operation paths are Workspace-relative; only bind_workspaces accepts explicit absolute roots. Binding a working workspace enables all working tools without separate read/write/execute approval. Explicit reference-root enrollment grants read/search only and never execution or mutation. Workspace IDs are host-local; boundary identity/revisions are rechecked per request. Project declarations cannot expand that boundary.
- Do not conflate local mutation with Git commit: report local before/after content hashes and `committed:false`, not fake commit SHA. Errors structured: `WORKSPACE_NOT_FOUND`, `PERMISSION_DENIED`, `PATH_OUTSIDE_SCOPE`, `HASH_CONFLICT`, `RUNNER_UNAVAILABLE`, `SECURITY_BLOCKED`, `SOURCE_UNVERIFIED`, `RESULT_UNKNOWN`.
- Unknown write/process outcomes demand readback/reconciliation before retry.
- Windows default recoverable deletion uses Recycle Bin; macOS default uses Trash. If recoverable delete is unavailable, fail clearly; permanent delete is a distinct explicit tool action, without a connector permission gate for workspace-local deletion.
- Source version pins and dependency licenses captured before copying any GPTWorker code. Do not rewrite the live GPTWorker installation.

## 3. Direct MCP API (target)

Workspace: `connector_status`, `bind_workspaces`, `unbind_workspace`, `list_workspaces`, `get_workspace`, `list_capabilities`.
Files: `list_directory`, `fetch_file` (line/range/binary metadata), `get_file_info`, `create_file`, `update_file` (expected hash), `edit_file` (exact-match), `apply_patch` (precondition checks), `delete_file`, `create_directory`, `copy_file`, `move_file`, `glob`, `search` (bounded grep results), `batch_file_operations` (per-action outcome, no fictitious transaction).
Execution: `run_command`, `start_process`, `list_processes`, `process_status`, `process_output`, `stop_process`.
Git: `git_status`, `git_diff`, `git_log`, `git_show`, `git_fetch`, `git_pull`, `git_add`, `git_commit`, `git_push`, `create_branch`, `git_checkout`, `compare_commits`; Git-specific tools fail `NOT_A_GIT_REPOSITORY` on plain folders.
CI: `ci_list_workflows`, `ci_validate_workflow`, `ci_run`, `ci_status`, `ci_logs`, `ci_artifacts`, `ci_read_artifact`, `ci_cancel`, `ci_list_runs`, optional `ci_rerun_failed`.

All tools independently registered in MCP `tools/list` with explicit schemas. Return structured `ok`, stable code, `workspace_id`, target, revisions, status and bounded paginated log/artifact results. No generic remote tool façade or pre-job activation.

## 4. Trusted Workspace registry, paths and grants

- Normal activation: selected host plugin bind_workspaces accepts one/multiple user-supplied absolute existing roots, persisting stable IDs and the full in-workspace working scope. No inferred parent/sibling roots or local job/agent spawning. CLI enrollment is an administrative fallback; workspace-local actions require no separate privilege activation.
- Track working workspace versus read-only reference role explicitly; do not silently promote reference roots. Tool/API details for reference enrollment remain an implementation design choice, not a claim of existing API support.
- Persist root identity, rights and monotonic revision in protected storage. Fail closed on missing/revoked/replaced roots, ambiguous identity, privilege mismatch, absolute operation paths outside binding, traversal, symlink/junction/UNC escape, ADS and unsafe encoding. Recheck at operation time; deny when atomic containment cannot be established.
- Explicit source and destination Workspace IDs for cross-root move/copy; destination must be a working workspace; source may be a working workspace or a read-only reference for copy, but move requires a working source too. No per-action approval for operations within those scopes. No implicit parent grant. Requests can run concurrently across roots without shared mutable cwd.
- Windows tests: case-insensitive drive/UNC, NTFS reparse points/junctions, path canonicalization. macOS tests: case-sensitive/insensitive APFS, Unicode normalization, POSIX symlinks, volume mounts, TCC-denied paths. Treat TCC permissions as user-controlled, not something to bypass.

## 5. Local connection, one-session lease and lifecycle

Windows and Mac may be ONLINE simultaneously through independent plugins/tunnels,
identities, credentials, grants and runtime state. Plugin selection routes each project;
one authenticated controller per host. Preserve existing installations. No fleet router,
shared global lock, automatic handoff/failover or cluster scheduler. Authenticate inbound MCP.

Session protocol:
1. On enrollment, generate a connector installation identity and authentication secret in protected host-owned storage, independent of Workspace files and CI executor.
2. Transport must authenticate and encrypt remote MCP communication (approved secure tunnel or equivalent); health endpoints expose no credentials or privileged tools. Bind an authenticated session ID to installation ID + grant revision + expiry.
3. State machine `UNPAIRED → IDLE → LEASE_ACTIVE → LEASE_EXPIRED/REVOKED → IDLE`. Acquire lease atomically; active concurrent controllers get `SESSION_BUSY`. Reconnect may renew the **same authenticated session** inside an explicit grace window, not silently take over another session.
4. Explicit disconnect/revoke or timeout invalidates the session; stale tokens, replay and grant-revision mismatch fail closed. Running CI processes are either safely cancelled on revocation or explicitly detached with no further authority and auditable reconciliation per process policy.
5. A restart re-authenticates and reconciles process/run records; never reconstruct authorization from untrusted workspace state.

Windows: independent Task Scheduler AtLogOn launcher (safe HKCU Run fallback), hidden startup, unique mutex, health supervisor and connector-specific ports/tunnel, no changes to GPTWorker/CadGPT/RevitGPT startup values. macOS: user `launchd` LaunchAgent with RunAtLoad/KeepAlive where appropriate, plist-safe args, no Terminal dependency, dedicated app support/logs, repair and scoped uninstall. Neither platform promises pre-login system service. Sleep suspends work; wake triggers reconciliation. Continuous compute during sleep is not guaranteed.

## 6. OS-enforced protection of the workspace boundary

Cwd + regex command guards alone are **not** filesystem sandboxing. Shell/CI child processes may not run under unrestricted interactive user authority if claiming strict containment.

Security policy is an OS-specific, trusted, user-approved capability manifest (not writable by Workspaces):
- Bound project workspaces with full read/write/execute working access, separately granted data-reference roots with read-only/no-execution access, exact per-run output roots, runner-owned temporary scratch, approved toolchain/system read-only roots, tightly scoped package caches, restricted environment variables, secrets references and explicit network policy (default deny unless approved for package installation/known destinations).
- No inherited connector admin tokens, handles, ambient credentials or writable trusted registry/evidence paths; sandboxed children and grandchildren retain restrictions. Trusted supervisor is the only registry/evidence writer.
- Windows candidate: restricted token/identity with NTFS ACL/AppContainer or comparable verifiable mechanism. macOS candidate: supported isolated execution identity with verified ACL, isolated VM/container with scoped mounts or another demonstrable enforcement method. Do not assume `sandbox-exec`, user `cwd`, POSIX `chroot`, command-token parsing or a separate OS account alone is sufficient.
- Verify forbidden sibling-file reads/writes (direct and nested PowerShell/CMD/Python/zsh/bash, subprocesses), symlinks/junctions, environment-indirected paths, mount/network shares, temporary path abuse, file handle inheritance, secrets and evidence tampering. Positive actual compile/test with declared SDK/cache paths required.
- If either OS cannot implement and validate containment with its toolchains, mark that OS `SECURITY_BLOCKED`; cross-platform product release cannot claim security PASS. A blocked OS can expose safe read-only metadata, not arbitrary confined shell/CI.

## 7. Local CI — no Git required

Versioned local workflow manifest `.gsa/ci.yaml` supports named workflows, jobs/`needs` DAG, steps, explicit shell/executable and argv, `runs_on`, env, resource limits, timeout and artifacts. Validate unknown keys, unsupported GitHub Actions YAML/features, dependency cycles and missing IDs as errors. Optional restricted GitHub Actions import adapter may be separately designed; **not** full GitHub Actions compatibility.

**Executable revision guarantee:**
1. Determine source-input manifest, ignore rules, workflow bytes, symlinks and declared dependency/toolchain provenance; compute fingerprint before execution.
2. Materialize a **private per-run copy of exact validated source inputs**. Fix the input snapshot as read-only reference; start test steps against a separate writable working copy or copy-on-write overlay derived from that reference. Writable build trees may generate files but cannot rewrite the immutable reference or trusted journal.
3. Record the exact working-copy origin and verified reference fingerprint. In-source generated files are allowed only as declared build outputs, excluded from input fingerprint by explicit policy. Detect unexpected edits to protected source and missing dependency provenance; report `SOURCE_UNVERIFIED` (not revision-bound PASS).
4. Each CI run has unique ID, pinned workflow revision, source fingerprint, runner/toolchain/OS/arch and isolation policy version. Job state `QUEUED → PREPARING → RUNNING → PASSED|FAILED|CANCELLED|BLOCKED|UNKNOWN`; exit codes, not narrative logs, decide test result.
5. CI child writes only its workspace copy, per-run scratch and approved output directories. Supervisor ingests approved artifacts into protected immutable or append-only evidence storage; children cannot modify evidence or secrets. Store bounded stdout/stderr, per-step exit codes, timestamps, log cursors, hashes and artifact provenance.
6. Run journal survives disconnect/reboot; interrupted states reconciled as unknown/interrupted unless verifiably finished. No automatic retry of uncertain mutations; resumable steps require declared idempotency. Per-run quotas/cancellation kill owned process tree only. Concurrent runs use isolated temp/cache/permissions.
7. Offline non-Git project CI must work when installed toolchains/dependencies suffice. Network operations, remote package fetches and secrets are separately authorized, never silently enabled by workflow YAML.

Local CI run outcome and independent GSA Reviewer PASS are different facts; GSA consumes revision-bound `ci_run_evidence` and decides whether to approve/promote.

## 8. Original implementation tickets (retained requirement inventory)

The Mac-first T00–T08 sequence below supersedes this original global ordering;
these ticket IDs retain traceability and do not imply completion.

| Order | Ticket | Deliverable | Completion proof |
| --- | --- | --- | --- |
| 0 | P0-01 | Pin exact GPTWorker/GSA/connector revisions, API schemas, OS-specific security threat model | Reviewed source refs and contract |
| 1 | PX-01 | Portable core with Windows/macOS HostAdapter, same tools/errors | Contract tests on both systems |
| 2 | PX-04/05 | OS isolation feasibility prototypes on Windows and macOS | Forbidden read/write denied; authorized build succeeds on each |
| 3 | PX-02/03 | Windows autostart and macOS LaunchAgent, one-session lease, secure MCP | Native restart/reconnect/revocation tests |
| 4 | P2-01 | Trusted workspace registry, path/junction/symlink grants | Concurrent multi-root safety and negative path tests |
| 5 | P3-01 | Direct filesystem/search/patch tools, hash checking and binary handling | Tool mutation and concurrency tests |
| 6 | P4A-01 | CI parser, immutable snapshot, protected writable execution copy and evidence | Non-Git CI + fingerprint tests on both |
| 7 | P4A-02 | Durable CI scheduler, logs, artifacts, cancel, recovery, quotas | Crash/reboot/parallel CI tests |
| 8 | P4B-01 | Shell/process/Git tools | Authorized build/test, Git dirty-tree and process isolation |
| 9 | P5-01 | GSA LOCAL/HYBRID execution-target contract and CI evidence consumption | GSA local-only and GitHub-only regression |
| 10 | P6-01 | Windows/macOS installers, upgrade/repair/uninstall | Native full E2E + neighbor-app noninterference |

No implementation phase is globally PASS without evidence on both supported platforms. Platform-specific readiness can be reported independently. Implement in the new repo; modifying `GPT-supper-agent` in P5 requires reviewing the actual client/connector invocation boundary rather than presuming its MCP server can call another MCP server.

## 9. Acceptance tests

- API01: direct MCP schemas are identical cross-platform, with correct typed errors and tool annotations.
- WS01: three authorized roots accessed concurrently without cross-root leakage, path/permission/grant-revocation enforcement on each OS.
- WS02: NTFS junction/UNC/ADS and APFS symlink/case/Unicode/TCC negative fixtures fail closed.
- SEC01: working workspace read/write/execute succeeds; explicitly granted reference roots allow read/search but deny mutation/execution; ungranted data, nested-script escapes, secrets and evidence access denied by **OS enforcement**; legitimate in-scope compile works.
- AUTH01: competing GSA session rejected, reconnect expiry/revocation safe, no credential leak; no multi-host router.
- START01: Windows reboot/login startup and macOS launchd/login startup, hidden/nonterminal, crash/wake reconciliation, uninstall isolation.
- FILE01: read/search/patch/binary/edit/batch/copy/move/hash conflict tests; recoverable deletion uses Windows Recycle Bin/macOS Trash.
- CI01: local folder with no `.git` executes a failing and a passing workflow, logs and artifacts are accurate.
- CI02: writable build copy mutates generated output while reference snapshot stays immutable; unexpected input mutation causes `SOURCE_UNVERIFIED`.
- CI03: concurrent jobs have separate cwd/cache/temp/logs/artifacts; limits, cancellation and process tree ownership proven.
- CI04: restart/disconnect/reboot preserves truthful journal/evidence; source revision and workflow hashes validated.
- GIT01: local changes preserved, unrelated files not staged/reset, no force push unless explicitly authorized under GSA governance.
- GSA01: GSA-only GitHub Projects unchanged, LOCAL-only and HYBRID use discovered direct local tools with revision-bound CI evidence.
- REL01: both native installations verified, independent from existing GPTWorker/CadGPT/RevitGPT startup and files.

Every ticket records exact commit/dirty hashes, commands/exits, timestamp, platform/backend,
source/workflow/grant revisions, redacted logs/artifact hashes and remaining blockers.
Planning evidence is distinct from runtime evidence. A source checkpoint does not
establish release readiness; unresolved failures and missing proof remain explicit.

## 10. Review history

See `docs/reviews/2026-10-16-CR-ARCHITECTURE.md`, `2026-10-16-CR-ROUND2-SINGLE-HOST.md`, and Planner RL reports for historical decisions. Current architecture, draft sequence and baseline/failure ledger below supersede conflicting historical states; historical reviews do not certify the current WIP tree.

## Transport decision — 2026-10-16 (supersedes Cloudflare-first onboarding)

- **Primary:** OpenAI Secure MCP Tunnel for a private ChatGPT/GSA plugin. Use the verified native stdio MCP entrypoint `node dist/src/mcp/cli.js` as `tunnel-client --mcp-command`, avoiding HTTP bearer forwarding.
- **Fallback/test:** Retain 127.0.0.1:58347 HTTP MCP and per-install secret. Both Windows and macOS completed `/health`, anonymous 401, authenticated `initialize`, and authenticated `tools/list` native tests (8/8).
- **Optional future:** Cloudflare only for non-OpenAI client interop (Claude, others); not required for ChatGPT MVP. The transport decision preserves authentication and workspace-boundary enforcement; it creates no approval gates for workspace tools.
- **Platform limitations:** OpenAI-hosted secure tunnel is for private MCP, not public plugin distribution. Tunnel-client needs Platform Tunnels permissions, a tunnel ID, an API key provided securely on each local host, and workspace association. Human must install the official client and create the private plugin after observing ready/doctor PASS. Windows and macOS require distinct tunnel identities when independently connected.
- **Deadline:** OpenAI tunnel default request deadline 120s end-to-end, including queue time. Model long-running local CI and processes as durable asynchronous operations, exposing short MCP calls rather than blocking transport requests.
- Operational commands and human gates in `docs/tunnel/SETUP.md`. No live tunnel or plugin is claimed by this plan.

## Architecture revision — two concurrently active hosts/plugins (2026-10-16)

Authoritative decision: two independent Windows/Mac plugins with distinct tunnels may
run simultaneously. Each has independent identity/secrets/grants/state and one controller.
No global lock or failover; GSA explicitly chooses the project plugin. Both pairs have
historical individual E2E evidence; preserve/revalidate them rather than assume Mac
provisioning is still pending. Fresh simultaneous operation remains unverified. Older
shared-plugin/exclusive-host instructions are superseded historical decisions.

## Proposed remaining product work — DRAFT-2026-10-17

| Task / existing ticket | Dependency; criterion IDs | Observable product evidence |
| --- | --- | --- |
| T00 baseline/contracts / P0-01,PX-01 | draft assessment; API01 | M0: source revision/schema/license inventory and criteria trace. |
| T01 Mac confinement / PX-04/05 | T00; SEC01 | M1: actual workspace build and reference read success; reference writes/execution and ungranted-root/nested-child/network denials; explicit boundary/capability scope. |
| T02 Mac ownership/grants/recovery / PX-02/03,P2-01,P4A-02 | T00; BIND01,WS01,WS02,AUTH01,START01,PROC01,CI03,CI04 | M1: actual competing-owner/crash/restart, revoked/replaced roots, expired controller and immutable terminal tests. Lock before reconciliation; UNKNOWN on uncertainty. |
| T03 Mac durable CI / P4A-01/02 | T02; SEC01,CI01–04 | M2: actual non-Git pass/fail, immutable reference, pinned rerun, parallel isolation/cancel/timeouts/output limits/lost receipt. |
| T04 Mac artifact transfer / P4A-01/02 | T03; CI01–04 | M2: real binary export; path/type/symlink/quota/hash/forgery/unclean-stop rejection. Exact-artifact native tests before installed proof refresh. |
| T05 Mac host files/Git / P2-01,P3-01,P4B-01 | T01,T02; WS01,WS02,SEC01,FILE01,GIT01 | M3 feature_complete: native hash/race/scope/binary/Trash/copy/move/dirty-tree tests, including reference-source copy success and reference-source move rejection. Prove host shell/Git containment; no workspace-local permission unlock. |
| T06 Mac packaging/transport / PX-03,P6-01 | T02,T04,T05 disposition; AUTH01,START01,REL01 | M3: native login/install/upgrade/repair/uninstall/crash/wake/revoke; fresh stdio/HTTP/plugin identity and enabled operations. |
| T07 Windows parity/source portability / original platform tickets | M3 disposition; all criteria except GSA01 | M4: independent Windows native denial/positive build/lifecycle/recovery/file/Git/CI and fresh Mac/Windows/Ubuntu source CI. |
| T08 GSA/dual-plugin release / P5-01,P6-01 | T06,T07 and all required evidence; API01,BIND01,AUTH01,GSA01,REL01 | M5: simultaneous distinct plugins, LOCAL/HYBRID evidence, GitHub-only/Memory Repo regression and both native packages. |

These proposed task scopes are existing subsystems; narrow to exact files/APIs in an
approved execution plan before coding. No speculative interface or new dependency.
Task designs must satisfy ../CRITERIA.md; technical acceptance/evidence mapping is in the appendix below. Failed host feasibility leaves
independent guest/packaging review possible but blocks required host capability/full
release. These are proposed deliverables and evidence requirements, not agent execution
instructions or connector approval gates. No completion is claimed by this proposal.

## Baseline/failure ledger — 2026-10-17

The project-only source baseline consolidates local native checkpoint 19dac16 and later
Mac WIP on top of main e5ba967 through PR #3. It is not a release. Historical native evidence covers
offline Linux ARM64 VM/local HTTP MCP, not current WIP, host SDK/mutation or Windows.
First native export de4f0a42/CI 39009452982 passed Mac but failed Windows installation-proof
binding and Linux queued/running cancellation plus bootstrap readyForShell; that PR was
not merged. Later local fixes addressed four TS18047 stream errors and terminal-journal
immutability. Source revision ab6acfa passed CI run 39015375272 on Mac, Windows and Ubuntu
after fixture/path repairs and ownership-test readiness synchronization. Source success
does not establish native containment or full criteria compliance.
Both remote plugins returned Session terminated during native integration: current
plugin health is unverified. [STATUS.md](../STATUS.md) records current evidence and gaps.
Preserve original RAW/candidate media; native tests need scoped disposable disks.

## User-corrected activation contract — GSA plugin + absolute Workspace roots (2026-10-16)

GPTWorker remains **reference for its workspace/job initiation separation**, not a model to clone verbatim. GPTWorker selects a job and agent/runtime and passes workspace. GSA-Localconnector is ONLY a local MCP execution substrate: **no job creation, job catalog, agent spawning or job lifecycle**. GSA is already the active reasoning/planning agent. To start, human invokes the selected host plugin (`gsa-lc` Windows, `gsa-lc-mac` Mac) and supplies one or more absolute folder paths. Connector `bind_workspaces({paths:[...]})` checks the paths on its own host and registers them as that host's workspaces; GSA uses workspace IDs in subsequent file/git/shell tools. Multiple bound directories supported; explicitly selected plugin is the host boundary. Legacy terminal `npm run workspace enroll-read` is administrative fallback, not normal activation. The user's supplied root establishes the workspace for all working tools; no separate read/write/shell approval gates apply. This 2026-10-17 clarification supersedes the former read-only binding restriction. Never infer or add sibling/parent roots. This contract supersedes the earlier CLI-first enrollment design. See docs/workspaces/LOCAL-ENROLLMENT.md.

## Historical evidence — native macOS offline smoke (2026-10-16)

Current local changes on base b071308 verify an independent writable CoW guest disk, local read-only NoCloud bootstrap, bounded Python compile/run and nested subprocess checks, matching per-run serial result, clean stop, failure cleanup and unchanged baseline hashes. This advances the positive workload prerequisite of PX-04/05; it does not complete SEC01, enable MCP execution, or substitute for Windows native proof. Detailed current evidence and next worker/share/cancellation gates: `docs/reviews/2026-10-16-OFFLINE-VM-SMOKE.md` and the product evidence linked in docs/STATUS.md. Earlier boot-pending entries are historical.

## Historical evidence — native worker and MCP integration (2026-10-17)

Supersedes the earlier worker-pending state above. The exact installed macOS VM worker now passed low-privilege/cgroup execution, outside read/write and credential denials, immutable source, timeout/output limits, normal shutdown and stdout-backpressure cleanup. Authenticated local HTTP MCP passed six actual VM boots covering command execution, pinned two-step CI, failed pinned rerun, logs/artifacts, controller release and durable grant revocation. Production stdio/HTTP composition loads this signed installation only; missing/tampered installations fail closed. Grants persist root identity and revision, and ordinary binding remains read-only.

This is an offline Linux ARM64 disposable-snapshot backend, with no host mounts or network. It does not implement macOS SDK execution, host file/Git mutation, general generated artifact export, restart recovery, startup lifecycle or Windows native containment. Windows protected state remains explicitly unavailable until a native ACL implementation is verified; its server exposes status without importing unverified grants. Live connected plugin calls returned `Session terminated`, so tunnel/plugin health and cross-platform release are not PASS. See `docs/reviews/2026-10-17-NATIVE-WORKER-INTEGRATION.md` and the latest checkpoint for evidence and remaining gates.


## Technical acceptance and evidence mapping — implementation reference

The following matrix was moved out of CRITERIA.md after the user clarified its purpose.
CRITERIA.md describes the settled user operating logic and governs design. This matrix
translates that logic into proposed implementation checks; API names, error codes,
mechanisms and task IDs do not redefine the user need. Current failures belong to
the baseline/failure ledger and evidence reports, not the definition of desired behavior.

| Criterion / source | Observable acceptance test | Platform; proposed task/milestone |
| --- | --- | --- |
| API01 / plan §§2–3 | Direct tools/list schemas match across hosts; typed errors and truthful blocked capabilities; preserve full canonical tool catalog. | Windows + Mac; T00,T07,T08 / M0,M4,M5 |
| BIND01 / latest activation decision | Selected plugin binds supplied absolute roots with full workspace-local tool use and no separate read/write/execute approval. Invalid paths and escapes rejected; no inferred parent/sibling access. Separately granted reference roots allow read/search only, never write/execute or implicit promotion. Demonstrate workspace read/edit/write/delete/command/Git/CI without connector gate prompts and cross-design reference reading. | Both; T02,T07,T08 / M1,M4,M5 |
| WS01 / plan §4 | Three roots operate concurrently without shared cwd/leakage. Root identity/revision and revocation checked per operation and running job; cross-root copy accepts a granted reference source and working destination; move requires working source and destination. Preserve read-only references, with no per-action approval for allowed operations. | Both; T02,T05,T07 / M1,M3,M4 |
| WS02 / plan §4 | Native APFS case/Unicode/symlink/mount/TCC and NTFS junction/UNC/ADS fixtures plus root replacement/TOCTOU fail closed. | Respective native hosts; T02,T05,T07 / M1,M3,M4 |
| SEC01 / plan §6 | Workspace build succeeds and can read granted references; reference writes/execution and ungranted private/world-readable/sibling access, nested-child escapes, inherited credential leakage, evidence tampering and unapproved network are denied by OS enforcement. VM Linux proof cannot certify native Mac SDK or Windows. | Each host/backend; T01,T03,T05,T07 / M1,M2,M3,M4 |
| AUTH01 / plan §5 + two-plugin decision | One authenticated controller per host; reject competing/stale/replayed/expired/revoked sessions. Distinct Windows/Mac plugins/tunnels run simultaneously with independent identity/grants/state; no global lock/cluster/failover. | Both + simultaneous run; T02,T06,T07,T08 / M1,M3,M4,M5 |
| START01 / plan §5 | Hidden login startup without Terminal; unique ownership; crash/sleep/wake recovery; scoped repair/uninstall preserves neighboring apps/other host. No sleep-compute or pre-login guarantee. | Mac launchd + Windows scheduler; T02,T06,T07 / M1,M3,M4 |
| FILE01 / plan §§2–3 | Read/search/binary/edit/patch/batch/copy/move/hash-conflict tests return truthful per-action outcomes, local hashes and committed:false. Trash/Recycle Bin default or clear failure; permanent deletion separately authorized. | Both; T05,T07 / M3,M4 |
| PROC01 / plan §§3,5,7 + Mac continuation | Kernel-owned installation lock precedes reconciliation. Real competing-owner/crash/restart tests preserve identity/output/status; uncertainty becomes UNKNOWN/readback before retry. Sealed terminal changes reject with PROCESS_TERMINAL_IMMUTABLE. | Both; T02,T07 / M1,M4 |
| CI01 / plan §7 | Plain-folder pass/fail workflows, accurate bounded logs/artifacts; validate version/keys/DAG/missing IDs/unsupported Actions features. Offline with installed dependencies; YAML grants no network/secrets. | Each backend; T03,T04,T07 / M2,M4 |
| CI02 / plan §7 | Immutable source reference and writable build copy retain source/workflow/toolchain provenance; unexpected protected-input mutation yields SOURCE_UNVERIFIED. Outputs follow declared policy; failed rerun stays pinned. | Both; T03,T04,T07 / M2,M4 |
| CI03 / plan §7 | Concurrent jobs isolate cwd/cache/temp/logs/artifacts. Quotas/timeouts/cancel/revoke stop owned trees only; queued/running cancellation persists truthful state; async controls remain responsive. | Both; T02,T03,T04,T07 / M1,M2,M4 |
| CI04 / plan §7 | Crash/disconnect/reboot never invents success. Immutable terminal evidence; artifact ingestion checks path/type/symlink/size/quota/hash/source/workflow/run identity and verified clean-stop receipt. | Both; T02,T03,T04,T07 / M1,M2,M4 |
| GIT01 / plan §§2–3 | Preserve dirty/unrelated files; stage selected changes only, no implicit hooks/filters/network rights; plain folders return NOT_A_GIT_REPOSITORY; uncertain mutation reconciles. | Both; T05,T07 / M3,M4 |
| GSA01 / plan §1,P5-01 | LOCAL/HYBRID consume direct tools and revision-bound ci_run_evidence; GitHub-only Projects/PR/issues/Actions and online Memory Repo unchanged. Verify actual invocation boundary; no local agent/job lifecycle. | GSA + both plugins; T08 / M5 |
| REL01 / plan §5,P6-01 | Independent native install/upgrade/repair/uninstall and enabled-capability E2E on both hosts, simultaneous correct routing, neighbor-app preservation, fresh Mac/Windows/Ubuntu source CI. Required blocked capability prevents full release. | Both; T06,T07,T08 / M3,M4,M5 |

Evidence: criterion/task/milestone IDs, exact commit plus dirty-path hashes, timestamp,
OS/version/arch/backend/toolchain/policy, command/exit, source/workflow/grant revisions,
expected/actual outcomes, redacted log/artifact paths/hashes and blockers. Relevant
changes invalidate old evidence. Native claims require actual positive/denial runs;
compile/mock/preflight is insufficient. Live plugin needs a fresh remote tool result
and correct installation identity; local HTTP or terminated sessions cannot prove it.

Acceptance requires an observable deliverable and evidence tied to the criteria;
unresolved failures and missing proof must remain explicit. No approval, activation,
completion or release readiness is claimed by this proposal.
