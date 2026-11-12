# Windows Native Connector — Implementation Plan

**Date:** 2026-11-09  
**Status:** PRE-CODE / V3 WINDOWS-INDEPENDENT DESIGN — REVIEW PENDING (2026-11-12)  
**Branch:** `feat/windows-native-connector-20261109`  
**Branch origin:** `41102fa3e9d2a187c8373b1474e9377b737c66b1`; **Mac read-only reference:** `main@9d66c60c4f31cae6cfed64838468b5558973ab0c` (not an integration target)  
**Authority:** `docs/CRITERIA.md` §§1–10 and user acceptance of Mac (2026-11-09); `docs/DECISIONS.md`; Mac `docs/{IMPLEMENTATION_PLAN,MILESTONES,TECHNICAL_PROPOSAL}.md`. See companion `WINDOWS_MILESTONES.md`, `WINDOWS_TECHNICAL_PROPOSAL.md`, `WINDOWS_JOB_GUIDE.md`.

## GOAL

Deliver the already Mac-accepted connector experience as an independent native Windows host through existing GSA MCP tools, with Windows-scoped file authority, real commands and process ownership, reversible changes and truthful recovery. Preserve Mac behavior, workspace/reference roles and existing receipts. Do not implement a new agent, product VM, bespoke CI engine, Pause/Resume or per-operation approval gate.

## 1. GOAL and product boundary

Build the second, independent **Windows host** of the existing GSA-Localconnector. The online GSA invokes the already-defined MCP tools against the selected Windows machine; the Windows connector executes them using local Windows filesystem, commands and installed toolchains. It is **not** another AI agent, not a Mac-to-Windows file bridge, not a VM, and not a bespoke CI/DAG service.

Target end-to-end: select workspace/reference roots on Windows; read/search/list; safely create/edit/patch/copy/move/delete files; inspect/copy directories with bounded journal/readback; run native PowerShell, CMD, Git, node, project scripts/build/test; track/cancel owned jobs; run the connector on user login using the existing tunnel model; recover truthful state after a normal app quit/restart. Two machines use separate plugins, grants, keys and state. No simultaneous Mac+Windows testing is required.

Mac is user-accepted and **frozen as the reference behavior**, not a Windows test oracle. Windows proof must be generated separately. This task authors documents only; **no product code or installation before planning review and implementation authorization**.

## 2. Scope and latest UI decision

- Required: workspace full allowed functionality and reference read/copy-out only; multiple independent projects, grants/revocation, logs, diff, bounded network authorization, process status/stop and truthful UNKNOWN.
- Windows desktop: **Open and Quit only**, background/tray application and optional start at user login. **Do not implement Pause/Resume**. Mac PR #15 is historical source, not Windows feature scope.
- No anti-sleep, machine-wide global process kill, installer services with admin privileges by default, new VM, extra connector reasoning/orchestrator, per-operation human approval, or blanket network Git permission.
- Real Windows reboot acceptance is **deferred** under the current user direction about reboot. Preserve crash/restart recovery design and test what is safely testable without reboot; do not report reboot PASS.
- The older `CRITERIA.md` §8 and `DECISIONS.md` still mention Pause/Resume. This is an **outdated-document reconciliation** required before implementation approval; the user explicitly superseded it with Open/Quit, not an invented requirement change. Do not silently edit approved criteria during this pre-code task.

## 2026-11-12 V3 — Mac as read-only lessons, Windows as independent development

The Windows branch was created with four planning documents; Windows native product code has not been implemented in this phase. The comparison to `main@9d66c60` (including 16 recent Mac reliability fixes) is **read-only reference research**. **Do not merge, rebase, cherry-pick or synchronize `main` into the Windows development branch, and do not modify `main`.** Instead record each Mac bug, its root cause, corrected behavior, reusable API contract, Windows-specific mechanism, and Windows test. Any Windows code is authored and tested independently on `feat/windows-native-connector-20261109`; Mac's Swift/launchd/FD/POSIX implementation is not copied. New Mac fixes can be read and evaluated later as references without becoming automatic dependencies or approval gates.

GSA Project Memory branch authority was changed on 2026-11-12 to `feat/windows-native-connector-20261109` after explicit user instruction; historical Mac planning Job `J-F33D` remains a distinct READY planning record. Do not silently replay or reuse its old evidence for Windows.

| Source delta observed on newer `main` | Reuse / Windows design requirement | Task |
| --- | --- | --- |
| `src/core/workspace.ts`, `src/local/grants.ts`, `docs/workspaces/LOCAL-ENROLLMENT.md` | Retain selected-only reauthorization, `ACTIVE/STALE/REAUTH_REQUIRED/REVOKED`, grant revision and unrelated stale root preservation; choose Windows volume/file ID rather than Unix inode identity | W1-01, W1-02 |
| `src/mcp/server.ts`, `src/mcp/runtime-bootstrap.ts` and backend refresh tests | Separate a successful `bind_workspaces` result from an actually ready native file backend. A grant-set mismatch must remain fail-closed and expose a precise recovery action; never silently bypass signed/qualified backend checks | W1-04, W2-01, W4-01 |
| `src/mcp/image-file-transfer.ts`, `src/mcp/server.ts`, `docs/workspaces/IMAGE-ASSET-TRANSFER.md` | Reuse the existing `import_image_file` fileParam schema, approved HTTPS origin and MIME/signature/size checks; implement a real Windows native exclusive-create backend and independent SHA-256 readback | W2-05, W4-01, W5-02 |
| `src/mcp/startup-registry.ts` and Mac desktop installer/adapter lifecycle fixes | Reuse one owner and safe lifecycle semantics; use Windows-native tray, startup, tunnel and protected installer state | W1-03, W4-02 |
| `docs/reports/2026-11-09-mac-native-user-acceptance.md` | Mac acceptance is bounded user evidence, not Windows test proof; no requirement for reboot, Pause/Resume or unverified remote Git | W0, W5 |

**Shared functionality to retain without duplication:** `create_file_bytes`, `fetch_file_bytes`, transaction readback, trusted root/role binding, image downloader validation, MCP catalog and existing core process/Git state. The Mac file broker/signatures, macOS owner FD, Swift and launchd are **not** Windows implementations.

**Special network clarification:** The Mac plugin's Git remote fetch/pull/push were not technically accepted; do not mark Windows remote Git PASS by inheritance or bypass a restriction through an unconfined shell. Source CI on Windows is not selected-plugin native host proof.

### Updated W0 actions before implementation

- **W0-00 (Completed governance only):** GSA branch authority updated with exact Memory Repo CAS and readback; no Windows source/code capability was enabled.
- **W0-05 (Read-only Mac lessons):** Inspect `main` source, commits, bug reports and tests without Git integration; produce a Mac bug -> behavior -> Windows design -> Windows test matrix. Do not merge, rebase, cherry-pick, or write to `main`.
- **W0-07 (Pending reliability classification):** Map nine Mac defect categories to shared fixes, Windows-specific implementation and negative tests; finish before W0-06.
- **W0-06 (Pending review):** Cross-check these four Windows docs against exact revision and obtain independent Planner/Reviewer findings closure; obtain separate Human authorization before W1 source coding.

## 2026-11-12 V3 — Latest macOS reliability lessons for Windows

**Observed evidence:** 16 new `main` commits since `bce1875`; current `main` `9d66c60`; source paths `src/core/durable-process.ts`, `src/local/{control-lease,grants}.ts`, `src/mcp/{http,server}.ts`, `scripts/{desktop-supervisor,mac-desktop-adapter}.mjs`, `native/macos-desktop/App.swift`, tests and `docs/reviews/2026-11-12-RELIABILITY-FIX-GUIDE.md`. The guide describes nine Mac defects and includes historical repair steps; current checked source contains corresponding fixes. **Neither documentation nor Mac execution certifies a Windows implementation.** W0-05 only reads the Mac fixes and captures requirements. Independently develop equivalent Windows behavior using the contracts applicable to the Windows branch; no integration of `main` is required or permitted by this plan.

| Mac repair / failure mode | Windows treatment | Owner / acceptance |
| --- | --- | --- |
| Unexpected tunnel/client exit leaves connector offline | Port bounded retryable restart and backoff to Windows tray; never restart after Quit, auth/config denial or existing owner | W4-05: simulated tunnel exit, reconnect, ceiling, no duplicate owner |
| Quit blocked by `ACTIVE_WORK_UNKNOWN` | Read owned process journal; normal Quit only when safely idle, explicitly confirmed Force Quit for owned processes only, unrelated processes survive | W4-05, W3-02; W5-04 |
| Transient process journal failure made all tools `SESSION_INVALID` forever | Reuse `ensureReady` retry, `PROCESS_JOURNAL_UNAVAILABLE` and diagnostic `DEGRADED` response on Windows | W3-05, W4-01: fail-once/pass-next, permanent failure still allows diagnostics |
| Orphan grant lock caused permanent `GRANT_STORE_BUSY` | Port owner/session-fenced lock recovery to Windows-native lock mechanism; never delete foreign/unparseable/unowned locks by PID or age | W1-05: stale fenced writer, live writer, legacy lock and concurrency negatives |
| Controller token invalidated after restart | Reuse preserved unexpired hashed lease and `SESSION_BUSY.expires_at`; no takeover UI | W1-06; W5-03: renew after restart, expire/release behavior |
| HTTP socket closed mid-tool around 30 seconds | Reuse separate request/headers timeouts and completed-tool wait, with bounded execution | W4-04: >30s valid JSON-RPC result and slow-header rejection |
| JSON-RPC and native error codes misleading | Reuse `INTERNAL_ERROR`, correct HTTP/stdio `-32600/-32601/-32602/-32603` and secret/path-safe messages | W4-04: method/argument/runtime failure and redaction cases |
| Unit tests read installed Mac identity under real HOME | Windows tests must isolate `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, TEMP and identity; never touch real host state | W1-03, W4-03: synthetic-profile fixture isolation |
| Mac pause-state diagnostics/repair | **Do not port Pause/Resume or pause-state UI**. Preserve only shared reliability rule: status, capabilities, recovery inspection, release/stop respond even in degraded state | W4-01, W4-05: no diagnostic lockout |

**New bounded planning tasks:** W0-07 (reliability evidence mapping and common vs Windows vs Mac-only classifications), W1-05 (grant lock recovery), W1-06 (controller lease continuity), W3-05 (journal retry/degraded state), W4-04 (HTTP/stdio error and duration handling), W4-05 (tray reconnect, safe Quit/confirmed force). Add matching exact-SHA Windows-hosted tests and separately selected-plugin acceptance in W5; do not create extra product agents, UI modes or connector-wide CI systems. Native Windows locking and process control must be proven on Win32; Mac FD/Swift/launchd/Unix signals cannot be copied as their implementation.

**Distinct safety states:** a successfully reselected workspace is not proof its signed/qualified native file backend was refreshed; old or unparseable grants/locks do not authorize a new scope. `UNKNOWN` is never retried as a second file effect without readback. Real Windows plugin check is separate from hosted `windows-latest` checks. Mac Git remote and reboot remain outside this acceptance round.

### Windows-only implementation policy

- **Source of ideas:** read-only Mac production behavior, source, fix guides and tests from `main`.
- **Source of Windows work:** the authorized Windows development branch only. The Windows implementation may mirror *interfaces and outcomes* of Mac, but must add Windows-specific code and tests, not import Mac commits.
- **Source of acceptance:** actual Windows CI and selected Windows host evidence; no Mac PASS or commit comparison is a Windows PASS.
- **W0 is complete when the requirements/negative-tests mapping and plan review are complete.** Divergent Git history is informational, never a blocker to writing reviewed Windows code.

## 3. Mac-to-Windows reuse matrix

| Area | Reuse | Windows-specific work |
| --- | --- | --- |
| MCP catalog, schemas, dispatch | `src/mcp/{server,catalog,write-dispatch,runtime-bootstrap}.ts` contracts | Platform-specific bootstrap, truthful capability/state labels |
| Workspace selection | `src/core/workspace.ts`, contracts, grant roles | Canonical Windows root/volume identity, case-insensitive names, UNC/reparse rules, durable Windows grants |
| File operations | `src/core/{native-io,write-engine,edit-guards,file-transactions}.ts` | Win32 handle-relative native backend, atomic/conflict guards, cross-volume copy/move |
| Directory | `src/core/directory-copy.ts`, `src/local/directory-copy-store.ts` | Verified Windows tree reader and copy engine; junction/reparse and cycle rejection |
| Command/process | `src/core/{process-manager,durable-process}.ts` | Native Win32 launcher, working-directory identity, Job Objects for owned descendants, capped logs/timeouts |
| Git | `src/core/{git-plans,git-engine}.ts` | Local Git via Windows runner; remote requires separate enforceable network capability and trust restrictions |
| Durable data | Current private journals, transaction IDs, readback schemas | Windows ACL/DPAPI appropriate to threat model, locking and stale-owner reconciliation |
| Transport | Existing tunnel/auth/session model | Windows background host/tray and installer, credential storage, one connector owner |
| CI | Existing Node tests and CI patterns | GitHub-hosted `windows-latest` explicit native gates, then real Windows acceptance |
| Candidate | `src/hosts/windows-appcontainer-candidate.ts`, `scripts/native-gate-windows.ps1` | Research-only: prove OS support before relying on sandbox; do **not** claim `verified=true` |

Do not copy macOS `codesign`, Seatbelt, launchd, `renameatx_np`, POSIX FDs/lock semantics or Swift binaries into Windows code. Preserve common user-visible contracts, not low-level implementation.

## 4. Sequential phases

### W0 — Baseline and contract reconciliation (no product code)

**GOAL:** Reconcile branch authority and inherited shared source without changing accepted Criteria or claiming Windows source proof; four matching documents reviewed at an exact Git revision.

Inventory the exact Windows-relevant source entrypoints and tests; record API contracts and current gaps; fix out-of-date references to Pause/Resume by an explicitly reviewed documentation decision; define Windows-supported host versions and architectures through evidence, not guesses. Pin branch SHA, workspace boundaries and acceptance fixtures. Critic/reviewer checks that no new authorization gate or VM was introduced.

### W1 — Windows host foundation and identity

**GOAL:** Establish one Windows owner and safe grant/root identity, including selected-only stale-root reauthorization and truthful native-backend freshness.

Create a Windows owner/session mechanism and persisted grant store; enforce exclusive connector owner without modifying unrelated processes; store secrets safely and separately from workspace roots. Prove durable root identity under rename/replacement, drive-letter aliases, case changes, junctions, symlinks, alternate data streams, UNC paths and inaccessible volumes. Implement read-only capability probes that never assert enforcement from API presence alone. **W1-04:** define secure synchronization between reselected workspace grants and the verified native file-grant set. Rebinding an old root is not proof that native file mutations are enabled. Preserve previous native installation/recovery journals; report a blocked qualification/update step rather than assuming automatic refresh. **W1-05/W1-06:** qualify owner-session grant-lock recovery and hashed control lease continuity against Windows host identity, without PID/mtime stale-lock guesses.

### W2 — Native files and directories

**GOAL:** Deliver real Windows-native scoped file and directory operations, durable CAS/recovery and binary/image import using existing tool schemas, with native negative proof.

Implement per-operation Win32 path/handle containment and recoverable mutations. No ordinary `path.resolve` + `fs` precheck is considered sufficient against TOCTOU. Deny unsafe reparse points and name ambiguities; implement versioned CAS replace/delete, atomic create, copy/move within/across approved roots, readback and conflict/UNKNOWN outcomes. Directory support separately qualifies traversal, manifest bounds and destination integrity. Stage in temporary fixture roots only; integration cannot enable unqualified capabilities. **W2-05:** support existing binary tools and `import_image_file`, from genuine host-provided `file` metadata to exclusive Windows create, MIME/signature/extension checks, <=8 MiB, no redirects, no token logging, and SHA-256 source/import/readback equality; verify denial for reference targets, stale file grants, and collisions. A POSIX-only/Windows-skipped importer test does not satisfy Windows qualification.

### W3 — Native commands, Git, process and logs

**GOAL:** Run real Windows scripts, local Git and owned processes with bounded results and truthful user-account, unconfined command semantics.

Launch from the granted workspace or child cwd as the logged-in user. Under the approved §7 exception, this runner is **not OS-confined** and must advertise `command_confinement: none (user account)` and `state_integrity_vs_commands: not_protected`. Use a scoped initial cwd, minimal environment, bounded time/output; track process tree ownership (Job Objects) and avoid killing neighbors. Local Git and scripts/test/build in non-Git folders must work. Remote Git remains blocked until an independently reviewed, restricted network capability is demonstrated; report missing functionality truthfully, not as success. **W3-05:** a temporary process journal load failure may be retried and must not block diagnostic MCP tools; persistent failure is explicitly degraded.

### W4 — MCP integration, Windows CI and Desktop delivery

**GOAL:** Wire proven Windows capabilities through unchanged MCP contracts, ship per-user Windows Open/Quit and protected tunnel lifecycle and preserve Mac regression behavior.

One integration owner wires the verified Windows backends into the existing dispatch and capability status without breaking Mac, including existing image fileParam protocol and grant-recovery diagnostic shapes. Dedicated `windows-latest` workflow exercises Node typecheck/tests plus actual Windows file, directory and process fixtures. Build/test a per-user installation with background/tray Open/Quit and tunnel initialization from saved protected configuration; never embed secrets in artifacts. **W4-04:** independently verify long-tool HTTP responses and JSON-RPC error mapping. **W4-05:** bounded retryable reconnect and safe Quit/confirmed force for owned work only; no Pause/Resume. GitHub CI runs on exact candidate SHA before user-machine installation.

### W5 — Real Windows acceptance and closure

**GOAL:** Verify the installed Windows plugin's actual file, image import, process and lifecycle operations with independent source/byte readback before user acceptance.

User-selected Windows machine: install/update, connect from separate Windows plugin, bind one workspace plus one reference, execute file and directory operations, genuine-host `import_image_file` with SHA-256 readback, selected grant rebind/qualification handling, projects with and without Git, build/test process lifecycle, safe cancellation, local Git, tunnel quit/relaunch, unexpected tunnel exit/reconnect, retained unexpired controller lease, grant-lock and process-journal fail/recovery, long-running HTTP tool completion, safe Quit/confirmed force with neighbor unaffected, unknown/partial recovery and a second independent project. Confirm full workflow against the exact installed version; record failure/blocked/unverified cases instead of PASS. Reboot excluded; outstanding defects become Issues after explicit user acceptance.

## 5. Development process and controls

- **One Windows development branch:** `feat/windows-native-connector-20261109`; `main` is read-only reference for the entire Windows phase. No merge/rebase/cherry-pick from `main`, no edits to `main`, no force push. Develop native Windows code independently after approval.
- Plan/Proposal/Guide are separate from production implementation; each task receives a Job Instruction derived from milestone and technical proposal, not a copied harness.
- Parallel changes only where file ownership does not overlap. Source integration and MCP dispatch modifications are serial.
- Every feature has (a) contract and path owner, (b) negative safety tests, (c) exact SHA Windows-hosted CI, (d) honest report, (e) Windows native acceptance when necessary.
- If runtime confinement or a network policy cannot be proven, keep that feature explicitly blocked. The accepted **unconfined command exception** does not weaken scoped file-tool boundaries.
- Git remote must not be routed through an unconstrained command runner as a workaround for `gitPlan` network denial.

## 6. Acceptance and evidence

| Gate | Required evidence |
| --- | --- |
| P0 planning | Four mutually consistent docs, criteria traceability, source inventory, Critic findings closed or recorded; human implementation approval |
| G1 foundation | Windows user session, grants, owner/rebind, hostile path tests and persisted-state assertions on `windows-latest` |
| G2 files | Native file+directory+binary/image containment, conflicts and readback/UNKNOWN; signed/attested mechanism appropriate to Windows, not macOS analogies |
| G3 commands | Real `powershell.exe`, `cmd.exe`, Git local, node and owned Job Object cancellation; neighbor process survives |
| G4 integration | Same MCP schemas, cross-platform regression (Mac unaffected), all required Windows suites PASS at exact candidate commit |
| G5 installed | Real Windows plugin, real host fileParam/image E2E and user workflow with receipts and version; Open/Quit/tunnel and multiple roots, no reboot requirement |
| Final | User accepts Windows; unresolved reproducible defects tracked as Issues, unimplemented restricted network Git disclosed |

## 7. Known open design questions to resolve before code

1. **Native file protection:** selected Win32 handle-relative technique for secure create/delete/replace/rename across reparse points and volume changes; prove with Windows-native tests before enabling.
2. **Windows process owner:** Job Object + process handle lifecycle and how child escape/breakaway is treated; no global PID-only cleanup.
3. **Network Git:** whether verifiable restricted network capability exists in the chosen host; do not pretend AppContainer API availability equals proof.
4. **Windows runtime and distribution:** per-user supported Windows version/CPU, packaged Node/installer, tray auto-login and safe update locks; record choices in Proposal/Job evidence.
5. **Document reconciliation:** latest Open/Quit decision supersedes older Pause/Resume prose; align authoritative docs through review without broad criteria changes.

## 8. Completion rule

Pre-code planning is **READY FOR REVIEW** once the four documents are persisted and cross-checked. It is **not approval to write Windows implementation**. Implementation begins only on the reviewed job pack and authorized branch. Any task requiring a real Windows PC remains **PENDING USER REQUIRE** if no Windows host is connected; hosted Windows tests alone cannot impersonate it.
