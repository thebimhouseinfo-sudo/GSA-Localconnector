# Technical Proposal — Native macOS Localconnector (PRE-CODE V3, 2026-11-05)

## GOAL

Deliver the *existing* approved local-connector capabilities to online GSA on native macOS, not through the old Linux guest. Keep the existing workspace/reference file-API boundary; commands execute as the logged-in user with **no OS confinement**, exactly as CRITERIA §7 (2026-10-31) permits. Reuse the existing native file brokers, owner/grant controls, durable file/process records and MCP interface. Run exact-revision GitHub-hosted macOS tests **before** any installation on the user's Mac. No new VM, CI/DAG system, local reasoning agent, or permission gate. This technical proposal covers Mac only and stops at M5; Windows requires a separate future proposal after M5 acceptance.

**Authority:** `docs/CRITERIA.md` APPROVED; 2026-10-31 §7 exception; 2026-11-05 human decision `docs/DECISIONS.md`; Plan and Task DAG at `docs/IMPLEMENTATION_PLAN.md` and `docs/MILESTONES.md`. Earlier technical discussions are archived at `docs/archive/TECHNICAL-PROPOSAL-LEGACY-PRE-20261105.md` and are NOT coding authority. This complete connected proposal replaces all older technical prescriptions. No product code has been modified; no prior Critic PASS is transferred to this revision.

**Observed source contracts:** `src/core/native-io.ts` exports `SandboxedProcessRequest` and `VerifiedNativeSandbox.execute/cancel`, `VerifiedNativeProcessController.start/status/output/stop`; `ProcessManager.validateProcessRequest` and `DurableProcessManager` presently enforce `cwd_relative === "."`; `src/mcp/server.ts` currently constructs `cwd_relative:"."` for commands and blocks Git with runtime-bootstrap's `hostGit` set; `src/mcp/runtime-bootstrap.ts` currently loads `loadMacVmRuntime` and `MacVmCiExecutor` and advertises Linux snapshot metadata; `src/mcp/catalog.ts` still describes Linux-sandbox command semantics; source path presence is NOT Mac-native runtime proof. `docs/MAC-QWEN-HANDOFF.md` describes an unfinished owned-child fixture cleanup. Confirm exact live SHA, dirty state and host configuration before source edits.

## PHASE T0 — Contract and authority freeze (sequential)

### GOAL

Allow truly independent feature branches without competing edits to shared MCP files or changing approved Criteria.

**T0-01 (READ/PLAN; prerequisite):** inventory active git branch/dirty work, the unpublished `codex/mac-completion` checkpoint, existing installed connector, and current source import graph. Never reset or overwrite user work. Record exact HEAD, blob SHAs, owner, API and prior test scope. Missing local-state evidence is UNKNOWN, not authorization to discard it.

**T0-02 (DESIGN; prerequisite):** preserve WorkspaceRegistry, trusted grant roots/roles, monotonic revision, owner/lease, protected state and current journal. A single interface integration owner owns `src/mcp/server.ts`, `catalog.ts`, `runtime-bootstrap.ts`, `write-dispatch.ts`, `batch-dispatch.ts`. Track A/B cannot edit those files simultaneously; each publishes contract changes for the integrator. Minimal interface change only if source truly needs it; no new generic host abstraction or parallel store. Freeze actual `SandboxedProcessRequest` fields and the `VerifiedNativeSandbox` adapter contract, not the illustrative V2 `MacHostRun` type.

**T0-03 (VM freeze):** classify imports/consumers of `native/macos-vm/*`, `src/hosts/macos-vm-runtime.ts`, `macos-vm-ci.ts`, `scripts/*vm*`, `test/*vm*`, `src/core/ci-*.ts`, `src/local/ci-*.ts`, workflows and user-owned media as VM-only / shared needed / historical evidence / external media. Freeze new VM feature, compile, smoke, QEMU and guest repair. Keep old reports readable; no VM tests required by native acceptance.

**Exit:** explicit file owners and contract signatures confirmed, no ambiguous active source edits, and short G0 reviewer PASS. This phase is a *development* dependency, not a user-facing connector approval step.

## PHASE A — M2 macOS scoped files (may run parallel to B/C/D/E after T0)

### GOAL

Expose all required file operations safely in working roots and read/copy-out only in references via the selected Mac plugin. Preserve user edits, journal/capture history and UNKNOWN/no-replay behavior.

| Task | Physical files and functions | Change | Requirement / test |
|---|---|---|---|
| A1 stopped-owner fixture and checked native installation | `scripts/install-mac-scoped-files.mjs` `applyMacScopedRecovery`, `withStoppedMacConnector`; `src/hosts/macos-scoped-files.ts`, `macos-file-recovery.ts`, `macos-recovery-installation.ts`; `test/mac-scoped-installer.test.ts`, existing fixture | MODIFY existing candidate; REUSE signed Swift broker, grants, owner fence, FileTransactionStore, checked loader and existing protected journal; no second installer/journal | Parent owns bounded child process group and verifies *physical stop* before deleting disposable fixture; retain fixture on uncertainty. Publish atomically under same owner, preserve older generation/captures; lost acknowledgement = UNKNOWN/no retry. Invalid/stale/missing proof leaves capability blocked |
| A2 regular files / cross-root move / logs / non-Git diff | `src/hosts/macos-file-recovery.ts`, `src/core/write-engine.ts`, `src/local/file-transaction-store.ts`, `src/mcp/write-dispatch.ts` (integrator only), relevant tests | MODIFY existing transaction path for recoverable move/readback. One log reader over existing records; minimal captured baseline for non-Git diff, scoped storage only when necessary | Workspace A→B file move; reference→workspace copy; role-denied source write; changed-file CAS/partial/UNKNOWN; no overwrite, no unreported retries; logs grouped by workspace and run |
| A3 directory and role transfer | `src/hosts/macos-directory-copy.ts`, `native/macos-files/tree-broker.swift`, `src/local/directory-copy-store.ts`, related tests | MODIFY/REUSE existing directory copy and readback; add minimal same-volume, same-workspace atomic directory rename only; no new directory-move engine | Reference copy-out; workspace→workspace copy; reference as destination denied; D2 cross-root/cross-volume rename explicitly rejected; symlink/revoked/changed-root negatives |

**A1 first source milestone** must reconcile uncommitted work and reviewed snapshot before editing installer; A2 and A3 may prepare disjoint code/tests in parallel, but shared broker, installer and transaction-store mutations serialize through A owner. Do not re-run the unsafe fixture before verifying parent cleanup and ownership. Existing held-descriptor relocation defect is not silently waived; if a required file API cannot enforce its scope, keep that specific operation blocked and report it. No unproven runtime activation via boolean flags.

**A contract:** current `NativeScopedFiles`, `NativeRecoverableFileMutations` and `NativeDirectoryCopies` remain the only downstream capabilities. Extend an existing method/receipt only when needed by accepted Criteria. No second native service. M2 acceptance requires current source/host/plugin evidence; old Mac27 archives are historical, not a substitute for matching candidate bytes and host evidence.

## PHASE B — M3 native macOS commands, Git and durable process records (parallel with A source)

### GOAL

Make `run_command`, `start_process`, `process_status`, `process_output`, `stop_process`, Git and project scripts operate on the native Mac under the currently granted workspace, without pretending subprocesses are OS-confined.

**B1 host adapter — CREATE only `src/hosts/macos-host-commands.ts` if no suitable existing native adapter; MODIFY minimal callers `src/core/native-io.ts` only if needed.** Use Node `child_process.spawn` or an existing equivalent; no shell interpolation for argv form. Existing public `SandboxedProcessRequest` fields remain: `workspace_id`, `executable`, `argv`, `cwd_relative`, `time_limit_ms`, `max_output_bytes`, `network_allowed`, optional artifact paths and `process_id`. `VerifiedNativeSandbox` is an existing interface name, **not** evidence of sandbox containment; `verified:true` must mean reviewed *host adapter and process ownership capability* only, not OS confinement. Advertise separate truthful capabilities. If this semantic separation cannot be implemented without falsely reporting `shellIsolation:verified`, update the diagnostic field and tests before activating.

**B2 request validation/cwd — MODIFY `src/core/process-manager.ts` `validateProcessRequest`, `src/core/durable-process.ts` validation, `src/mcp/server.ts` command request composition (integrator-only), and `src/core/git-engine.ts` where required.** Current code rejects any `cwd_relative` other than `"." `; extend to `"." ` and bounded normalized *relative descendants*. Reject absolute paths, `..`, empty aliases, NUL, symlink escapes, stale roots and reference roots. Resolve cwd within a current workspace, recheck scope/lease at admission; command descendants remain unconfined by policy. `run_command` and `start_process` currently do not accept a cwd argument in public catalog: add an OPTIONAL `cwd_relative` string in `src/mcp/catalog.ts` and `server.ts` with default `"." `, preserving existing clients; validate exactly once by a common helper. Git commands default to repository root unless explicit Git contract permits relative cwd. Keep `network_allowed:false` default, explicit network/auth workflow for remote Git as Criteria §5 requires. Do NOT silently allow client-specified environment secrets.

**B3 process execution and truthful outcomes — REUSE/MODIFY `src/core/process-manager.ts`, `src/core/durable-process.ts`, `src/core/process-journal.ts`, `src/local/process-store.ts`.** Maintain ONE process/run journal. Persist stable run ID, workspace and owner session, executable/argv/cwd, start/stop timestamps, exact exit/signal, truncated stdout/stderr cursors, artifacts and source/toolchain identity. Use existing `DurableProcessManager.run/startCommand/start/status/output/stop` where appropriate; do not create another queue/scheduler. Cancellation requires ownership-proof for spawned process group/descendants; SIGTERM→bounded wait→SIGKILL only for verified owned group, never guessed PID, never neighbors. Loss of physical-stop proof => UNKNOWN with admission fenced. Bound active counts, CPU/time/output as existing contracts allow; avoid blocking main MCP loop. `process_output` and list/status must report independent workspace results even after invocation returns.

**B4 MCP/consumer wiring — integrator MODIFY `src/mcp/runtime-bootstrap.ts`, `server.ts`, `catalog.ts`, `src/mcp/cli.ts`/HTTP only if changed calls require it.** Replace `loadMacVmRuntime`/VM process/CI composition on Mac with the actual host command adapter + existing process store. Do not carry `MacVmCiExecutor` into native command path. Remove `hostGit` blanket denial **only when** per-operation grant/controller/net requirements and actual Git backend are validated; otherwise explicitly mark unavailable. `executeGit` in `src/core/git-engine.ts` remains common planner/executor; local Git works on dirty repo without resetting unrelated work. Update `catalog.ts` descriptions for actual host execution (not Linux snapshot), preserve existing MCP tool names/input fields except optional cwd, status and bounded outputs. Replace diagnostic `executionEnvironment:linux-arm64-vm`, `workspaceMode:disposable-snapshot`, `shellIsolation:verified` with `executionEnvironment:macos-native`, `command_confinement:"none (user account)"`, `state_integrity_vs_commands:"not_protected"`, true blocked reasons, and explicit installed/backend identity. `ci_* ` VM run/capture/rerun tools are **not** the new project test route: deprecate them, block VM mutations, preserve read-only history with historical labeling until separate retirement migration; do not upgrade old guest runs into new Mac results.

**B5 safety:** only launch within granted working-root `cwd`; reject sensitive *workspace binding* roots (home, /, ~/.ssh, connector state), but do not promise subprocess path confinement. Strip connector tunnel/runtime key/grant/journal secrets from child environment, pass only minimum toolchain values. File API remains broker-confined. Network/download/extra credentials require authorization outside connector command grant when necessary. Detect externally changed process state and report unverified, not false PASS. No user-facing per-command approval gate is introduced.

**B source acceptance matrix:** commands with `cwd="."` and child cwd; local `uname -s`, `node -p process.platform`, Swift `swiftc -version`, `git --version`; temporary non-Git script pass/fail; disposable Git repo dirty-file preservation and local status/log; stdout and stderr, exit 0/nonzero, output cap/cursors, timeout, cancelled child with verified physical stop and unrelated neighbor alive; restart/disconnect returns UNKNOWN when proof missing, no replay; reference path rejected for command cwd; profile does not leak secrets. Run these on GitHub-hosted macOS once B is integrated, then through installed selected plugin on user's Mac only after G3.

## PHASE C — GitHub-hosted macOS pre-install CI (parallel author; serial exact-SHA gate)

### GOAL

Prevent testing/installing a new connector build on the user's Mac until it passes a real GitHub Actions macOS host (not a project VM).

**C1 — MODIFY `.github/workflows/ci.yml`; REUSE `package.json` scripts:** `runs-on: macos-latest`, Node 22, `npm ci --ignore-scripts`, `npm run build`, and non-VM source tests. Record `GITHUB_SHA`, macOS version, architecture, Xcode/Swift, `package-lock.json` hash and command exits. The existing `npm test` includes frozen VM-specific cases; do **not** run those as a required Mac capability test, but maintain an explicit exclusion list and fail if additional non-VM tests are skipped by accident. No VM/Virtualization.framework compile/guest, QEMU, image or bootstrap probes.

**C2 — REQUIRED native-safe fixture ownership and gate matrix:** CI agent creates/tests *only* the bounded disposable fixtures necessary for these contracts, with exact script names pinned during implementation (not an invented preexisting script). Requirements below are mandatory at named gates; absence, unexpected skip or false-green => FAIL/BLOCKED, not PASS:

| Gate | Required steps / assertions | Safe scope |
|---|---|---|
| C0 plan/CI baseline | npm install/build; all non-VM unit suites; existing `python3 scripts/test-native-source-capture.py` source fixture | GitHub runner temporary files |
| C-A (after A integrated) | all A1/A2/A3 targeted non-VM tests; signed disposable macOS file broker fixture(s), native role-negative and interrupted UNKNOWN/no-replay where supported | temporary roots ONLY, helper must terminate and canary preserved |
| C-B (after B integrated) | all B1–B5 source contracts + macOS actual subprocess, local Git, non-Git script, timeout/owned stop, stderr/exit/logs and live-neighbor proof | temp directories/process groups on runner; never OS-global services |
| C-G3 (pre local install) | C0+C-A+C-B; package/manifest/entitlement verification and harmless plugin startup/shutdown smoke if available in hosted runner; no mandatory test SKIP; exact candidate HEAD+artifact identity | GitHub runner; **never** install to user's Mac, never connect their tunnel |
| C-VM (after VM removal PR) | C-G3 regression and static zero VM production imports/runners/install references | reversible cleanup PR; preserve reports |

**Implementation rule:** C1 may run already implemented checks, but C-A/C-B/C-G3 must be wired into the Actions job as *required executable steps* **when those capabilities are implemented and proposed for acceptance**, with explicit exit nonzero if missing; do not label the current 2026-11-05 source-only workflow a completed C-G3. Where an exact script does not yet exist, task owner must first add its fixture and acceptance assertions; absence is BLOCKED, not assumed PASS. Report `PASS`, `FAIL`, `SKIP`, `NOT_RUN` separately and include expected versus observed. GitHub hosted native execution is real macOS userspace but does not prove installed Mac TCC/permissions/tunnel/startup.

## PHASE D — Mac desktop lifecycle (parallel source prep, local activation later)

### GOAL

Reuse existing Mac desktop app to deliver post-login background connector, signed artifact identity, Dock UI, Pause/Resume/Quit and ignored allowlisted `.env` configuration. No sleep-prevention code and no unrelated process changes.

**D1 — REUSE/MODIFY `native/macos-desktop/*`, `scripts/desktop-supervisor.mjs`, `scripts/mac-desktop-adapter.mjs` and matching isolated lifecycle tests; leave any installed login agent, secret or active connector untouched during hosted CI.** Honor hide-window vs Quit, owner-only stop, background login start, recovery after wake, existing cached tunnel ID/key. Test simulated UI/state transitions and packaging in hosted CI; actual Login Item, TCC, Dock and selected-plugin acceptance only at G4/M5 on real Mac. D source can develop parallel with A/B; shared runtime bootstrap changes go to integrator.

## PHASE E — VM freeze and complete retirement (E1 parallel inventory, E2 sequential deletion)

### GOAL

Zero VM runtime dependency in shipped connector, without destroying user VM media or useful independent file/process components.

**E1 — READ-ONLY inventory:** classify all VM-exclusive files, source call sites and CI steps. In particular `src/hosts/macos-vm-runtime.ts`, `macos-vm-ci.ts`, `native/macos-vm/*`, `scripts/install-native-vm.mjs`, `scripts/test-vm-*`, `test/macos-vm-*` are candidates. `src/core/ci-*.ts`/`src/local/ci-*.ts` may include shared records: classify by actual import graph; no wildcard delete. Preserve original VM images/media, archived reports and historical evidence. VM code is frozen **now**.

**E2 — REMOVE only after native replacement and MAC-G4 proof:** isolated reversible `chore/remove-vm-runtime` PR based on the accepted native Mac source, removing guest-only source/CLI/Catalog/CI hooks/VM-only tests and installation. Preserve read-only history safely or migrate it without mutating prior results; no remaining runtime VM imports or package dependencies. Run C-VM regression on exact deletion SHA; never merge VM deletion while native Mac regression red. On regression, revert **the deletion PR only**, keep native Mac plugin and user data unchanged; no automatic fallback to old VM, no auto-install. Any local installer upgrade/rollback is a separately reviewed human-approved action with matching signed artifact and preserved previous generation. Only accept M5 when replacement+retirement both verified.

## PHASE I — Serial integration and Mac M4/M5 acceptance

### GOAL

Resolve parallel outputs deterministically and prove results before real-device changes.

**Single integrator:** exclusive write ownership over `src/mcp/server.ts`, `runtime-bootstrap.ts`, `catalog.ts`, `write-dispatch.ts`, `batch-dispatch.ts`. Integrate reviewed Track A (G1) then Track B (G2) on one branch, rerun exact SHA hosted CI after each; independently completed D tests may be included before G3. M4 recovery logic/source tests can begin parallel with B2 once process journal semantics freeze; actual reboot/wake/installed restart requires G4. Do not run unsupported tools merely because they appear in the catalog.

**G3 mandatory preinstall:** C-G3 PASS on the precise proposed installer/source/artifact revision, review changed source/installer effects and identify target root, rollback generation and data preservation plan. Only then request the separate installation decision and test the *actual user's Mac* via installed plugin with disposable workspaces. No automatic deployment or key export.

**G4 actual installed Mac:** file/reference positive/denial, command script and Git, PID ownership/cancel, logs/cursors, failed/uncertain mutations, selected host plugin; user-host OS/arch/install hash/TCC and existing neighboring apps observed. No source-only or GitHub CI pass upgrades to live acceptance.

**M4:** owner fencing, crash/service restart/reboot/wake and truthful UNKNOWN/no duplicate effects, unrelated apps intact. M4 source preparation can overlap earlier tasks, but native reconciliation acceptance needs G4. **VM-E2 follows only a proven direct-host replacement** and is independently reversible; M5 waits for both complete recovery and clean VM retirement.

**M5:** installed app lifecycle, independent concurrent projects, complete Criteria §1–§8/§10, genuine plugin and Mac host results, exact version and no unverified required tool. Windows planning is a separate future phase and is not authorized by this Mac proposal.

## PRE-CODE REVIEW TABLE

| Criterion | Reviewable test | Current V3 status |
|---|---|---|
| Complete task coverage and no duplicate services | T0,A1–A3,B1–B5,C1/C2,D1,E1/E2,I/M4/M5 mapped to Plan+Milestones | DOCUMENTED |
| Product VM frozen | no new VM code; retirement separate reversible PR | DOCUMENTED, NOT EXECUTED |
| Host commands truthful | exact legacy caller/replacement and command risk declaration | DOCUMENTED, NOT IMPLEMENTED |
| File safety | signed broker/CAS/journal, reference denial, old captures retained | DESIGN; host evidence remains UNVERIFIED |
| Hosted CI before real Mac | C0/C-A/C-B/C-G3 mandatory matrix, exact artifact SHA | DESIGN; initial CI narrower |
| Role independence | agent scopes disjoint; integrator owns shared MCP | DOCUMENTED |
| Code + Mac installation | no product source changes or real Mac install in this review | NOT AUTHORIZED |
| Independent Reviewer/CR | must be performed on V3 exact source docs/Job revision | NOT YET RECORDED |


## Planning delivery inventory and review acceptance

| Artifact / owner | Status / evidence | Gate |
|---|---|---|
| `docs/IMPLEMENTATION_PLAN.md` | V3 current; goal mapping, parallel phases and task review | exact blob Reviewer |
| `docs/MILESTONES.md` | V3; Mac-only task DAG IDs `...000001`–`...000016`; Windows outside scope | exact blob Reviewer |
| `docs/TECHNICAL_PROPOSAL.md` | V3 current technical source/interface/caller specification, no implementation | exact blob PRE_CODE review |
| `docs/archive/TECHNICAL-PROPOSAL-LEGACY-PRE-20261105.md` | historical snapshot only, not source implementation authority | preserve, never use to override current VM freeze |
| `.github/workflows/ci.yml` | currently only C0-style source/native-safe baseline; C-A/C-B/C-G3 not yet implemented | mandatory native fixtures must be added during authorized source work, checked exact SHA before local install |
| `src/mcp/runtime-bootstrap.ts`, `src/core/process-manager.ts` | existing VM runtime import / current `cwd_relative="."` guard | B/T0 integration design; do not mark native host READY |
| Project Memory plan Job | review current Criteria and non-linear task topology | planning verification CAS/readback required; never inherit old J-2600 PASS |

**Review-only completion condition:** Plan, Milestones and Technical Proposal have no unresolved requirement, task ownership, call-site, dependency or acceptance contradictions, independent Reviewer PASS is recorded against exact versions, and GSA planning Job points to the approved Criteria and same DAG. No code or local install is authorized by document readiness itself.
