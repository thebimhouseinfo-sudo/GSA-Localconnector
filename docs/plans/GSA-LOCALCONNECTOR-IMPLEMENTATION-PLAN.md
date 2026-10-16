# GSA-Localconnector — Unified Implementation Plan

Status: **PLANNING / implementation not started**  
Revision: 2026-10-16 — Planner response to CR Round 2  
Scope: Windows + macOS, **one machine, one OS user, one active GSA control session**, multiple simultaneously authorized local Workspaces. Windows and macOS are alternate installations, not a multi-host cluster. Native security and runtime PASS remain unverified.

## 1. Purpose and non-goals

Build a machine-first local MCP connector for GSA. GSA owns all reasoning, Project/Job/Task/Run orchestration, decisions and reviewer gates. Connector owns local filesystem, code search/edit/patch, shell and process execution, local Git, local-only CI (including folders without .git), reliable state/log/artifact persistence, registration and platform isolation. Borrow tested modules from `thebimhouseinfo-sudo/chatgpt-local-worker` without changing that existing application. GitHub Connector remains for GitHub-only PR/issues/Actions functions; GSA Memory Repo remains online.

No local Planner/Builder, Job Pack, fake CLI, generic `work_tool`, multi-user tenant system, multi-host scheduling, automatic GitHub sync, or CadGPT/RevitGPT-specific business logic. Linux is outside initial release scope.

## 2. System architecture and authoritative contracts

- Shared TypeScript/Node MCP server, schema-validated direct tools, workspace/capability registry, common CI DAG engine, immutable run evidence, typed errors; platform HostAdapter for filesystem, process containment, startup, host-secret storage, process tree and packaging.
- Same tools/schema across Windows and macOS; optional platform capabilities are explicitly negotiated in `connector_status`, never silently emulated.
- One active authenticated control session with explicit lease; concurrent tool calls **within** this session can use different Workspace IDs without changing global cwd. Process ownership and scope are request-local, not process-global.
- API paths are Workspace-relative; `workspace_id` is an opaque ID from trusted local registration. The GSA Project declaration cannot grant local rights. Grant revisions are rechecked for every request.
- Do not conflate local mutation with Git commit: report local before/after content hashes and `committed:false`, not fake commit SHA. Errors structured: `WORKSPACE_NOT_FOUND`, `PERMISSION_DENIED`, `PATH_OUTSIDE_SCOPE`, `HASH_CONFLICT`, `RUNNER_UNAVAILABLE`, `SECURITY_BLOCKED`, `SOURCE_UNVERIFIED`, `RESULT_UNKNOWN`.
- Unknown write/process outcomes demand readback/reconciliation before retry.
- Windows default recoverable deletion uses Recycle Bin; macOS default uses Trash. If recoverable delete is unavailable, fail clearly; permanent delete is a distinct operation with explicit authorization.
- Source version pins and dependency licenses captured before copying any GPTWorker code. Do not rewrite the live GPTWorker installation.

## 3. Direct MCP API (target)

Workspace: `connector_status`, `list_workspaces`, `get_workspace`, `list_capabilities`.
Files: `list_directory`, `fetch_file` (line/range/binary metadata), `get_file_info`, `create_file`, `update_file` (expected hash), `edit_file` (exact-match), `apply_patch` (precondition checks), `delete_file`, `create_directory`, `copy_file`, `move_file`, `glob`, `search` (bounded grep results), `batch_file_operations` (per-action outcome, no fictitious transaction).
Execution: `run_command`, `start_process`, `list_processes`, `process_status`, `process_output`, `stop_process`.
Git: `git_status`, `git_diff`, `git_log`, `git_show`, `git_fetch`, `git_pull`, `git_add`, `git_commit`, `git_push`, `create_branch`, `git_checkout`, `compare_commits`; Git-specific tools fail `NOT_A_GIT_REPOSITORY` on plain folders.
CI: `ci_list_workflows`, `ci_validate_workflow`, `ci_run`, `ci_status`, `ci_logs`, `ci_artifacts`, `ci_read_artifact`, `ci_cancel`, `ci_list_runs`, optional `ci_rerun_failed`.

All tools independently registered in MCP `tools/list` with explicit schemas. Return structured `ok`, stable code, `workspace_id`, target, revisions, status and bounded paginated log/artifact results. No generic remote tool façade or pre-job activation.

## 4. Trusted Workspace registry, paths and grants

- Trusted enrollment is an interactive OS user/admin configuration action **outside ordinary MCP tools**. Persist canonical root identity, stable Workspace ID, rights `read|write|execute`, allowed supplementary capabilities and monotonically increasing grant revision in connector-owned protected storage.
- Fail closed for missing/revoked workspace, ambiguous volume/file identity, privilege mismatch, absolute user-supplied file paths, traversal, symlink/junction/UNC escape, alternate data streams and unsafe encoding. Recheck target at operation time; prefer handle-relative APIs to mitigate TOCTOU; deny when atomic containment cannot be established.
- Explicit source and destination Workspace IDs for cross-root move/copy, each separately authorized. No implicit parent grant. Requests can run concurrently across roots without shared mutable cwd.
- Windows tests: case-insensitive drive/UNC, NTFS reparse points/junctions, path canonicalization. macOS tests: case-sensitive/insensitive APFS, Unicode normalization, POSIX symlinks, volume mounts, TCC-denied paths. Treat TCC permissions as user-controlled, not something to bypass.

## 5. Local connection, one-session lease and lifecycle

Only one installed host and one active user GSA session at a time; no fleet router or host selection API. Still authenticate all inbound remote MCP connections; a single-user design does not imply trusting every client.

Session protocol:
1. On enrollment, generate a connector installation identity and authentication secret in protected host-owned storage, independent of Workspace files and CI executor.
2. Transport must authenticate and encrypt remote MCP communication (approved secure tunnel or equivalent); health endpoints expose no credentials or privileged tools. Bind an authenticated session ID to installation ID + grant revision + expiry.
3. State machine `UNPAIRED → IDLE → LEASE_ACTIVE → LEASE_EXPIRED/REVOKED → IDLE`. Acquire lease atomically; active concurrent controllers get `SESSION_BUSY`. Reconnect may renew the **same authenticated session** inside an explicit grace window, not silently take over another session.
4. Explicit disconnect/revoke or timeout invalidates the session; stale tokens, replay and grant-revision mismatch fail closed. Running CI processes are either safely cancelled on revocation or explicitly detached with no further authority and auditable reconciliation per process policy.
5. A restart re-authenticates and reconciles process/run records; never reconstruct authorization from untrusted workspace state.

Windows: independent Task Scheduler AtLogOn launcher (safe HKCU Run fallback), hidden startup, unique mutex, health supervisor and connector-specific ports/tunnel, no changes to GPTWorker/CadGPT/RevitGPT startup values. macOS: user `launchd` LaunchAgent with RunAtLoad/KeepAlive where appropriate, plist-safe args, no Terminal dependency, dedicated app support/logs, repair and scoped uninstall. Neither platform promises pre-login system service. Sleep suspends work; wake triggers reconciliation. Continuous compute during sleep is not guaranteed.

## 6. OS-enforced execution security — release hard gate

Cwd + regex command guards alone are **not** filesystem sandboxing. Shell/CI child processes may not run under unrestricted interactive user authority if claiming strict containment.

Security policy is an OS-specific, trusted, user-approved capability manifest (not writable by Workspaces):
- Authorized project inputs (read, and explicitly approved write areas), exact per-run output roots, runner-owned temporary scratch, approved toolchain/system read-only roots, tightly scoped package caches, restricted environment variables, secrets references and explicit network policy (default deny unless approved for package installation/known destinations).
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

## 8. Implementation tickets and order

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
- SEC01: forbidden outside-root read/write, nested scripts, subprocesses, secrets and evidence access denied by **OS enforcement**; legitimate in-scope compile works.
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

Every ticket's evidence includes exact source commit, test commands, logs, platform, result and remaining blockers. Review loop: implement → test → independent Reviewer → fix → retest until PASS or explicit BLOCKED. Planning PASS does not imply runtime PASS.

## 10. Review history

See `docs/reviews/2026-10-16-CR-ARCHITECTURE.md`, `2026-10-16-CR-ROUND2-SINGLE-HOST.md`, and Planner RL reports. This unified document **replaces** the accumulated superseding appendices of earlier revisions. Source code implementation and native Windows/macOS security tests are still pending.

## Transport decision — 2026-10-16 (supersedes Cloudflare-first onboarding)

- **Primary:** OpenAI Secure MCP Tunnel for a private ChatGPT/GSA plugin. Use the verified native stdio MCP entrypoint `node dist/src/mcp/cli.js` as `tunnel-client --mcp-command`, avoiding HTTP bearer forwarding.
- **Fallback/test:** Retain 127.0.0.1:58347 HTTP MCP and per-install secret. Both Windows and macOS completed `/health`, anonymous 401, authenticated `initialize`, and authenticated `tools/list` native tests (8/8).
- **Optional future:** Cloudflare only for non-OpenAI client interop (Claude, others); not required for ChatGPT MVP. The decision does not replace or relax workspace, session, native sandbox, write, shell, CI, process, and proof gates.
- **Platform limitations:** OpenAI-hosted secure tunnel is for private MCP, not public plugin distribution. Tunnel-client needs Platform Tunnels permissions, a tunnel ID, an API key provided securely on each local host, and workspace association. Human must install the official client and create the private plugin after observing ready/doctor PASS. Windows and macOS require distinct tunnel identities when independently connected.
- **Deadline:** OpenAI tunnel default request deadline 120s end-to-end, including queue time. Model long-running local CI and processes as durable asynchronous operations, exposing short MCP calls rather than blocking transport requests.
- Operational commands and human gates in `docs/tunnel/SETUP.md`. No live tunnel or plugin is claimed by this plan.
