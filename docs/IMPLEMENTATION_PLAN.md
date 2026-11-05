# Implementation Plan — GSA-Localconnector

## 2026-11-05 PRE-CODE REVIEW V2 — canonical delivery plan and parallel work authority

**Review status:** planning proposal revised against approved [CRITERIA.md](CRITERIA.md), including 2026-10-31 §7; NOT a product implementation, independently approved Critic result, M2–M5 PASS, installation authorization or merge authorization. This section supersedes older sequencing, optional-VM and VM-first directions in this document and linked historical plans. The technical execution contract is in [TECHNICAL_PROPOSAL.md](TECHNICAL_PROPOSAL.md#2026-11-05-pre-code-technical-proposal-v2--parallel-native-mac-tracks) and the task DAG is in [MILESTONES.md](MILESTONES.md#2026-11-05-milestone-task-dag-v2--parallel-delivery).

### Review findings and corrected decisions

- **R1 (BLOCKING to code allocation):** older "M3 after completed M2" artificially serializes source development. Corrected: M2 file backend and M3 host-command implementation may proceed in parallel **after** shared interfaces and scope contract are frozen. Live integrated M3 acceptance still requires verified grants and M2 file functionality.
- **R2 (BLOCKING to VM development):** the old optional Linux VM, guest worker, VM compile/tests and VM-bound execution path conflict with the new human direction. Freeze immediately; inventory for removal; never use VM as native-Mac evidence. Preserve historical reports and original media.
- **R3 (BLOCKING to install):** GitHub-hosted `macos-latest` CI must pass for the **exact install candidate revision** before installation or activation on the user's Mac. It runs on GitHub's macOS host, not a project VM. CI PASS alone does not establish installed-plugin/native acceptance.
- **R4 (HIGH):** legacy long proposal/hand-off includes obsolete requirements, stale file/commit evidence and a previously unfinished fixture cleanup issue. Preserve dirty/untracked work, identify actual live branch and state, do not copy a previous CR PASS to new code or rerun a native fixture until its owned child is bounded and physically stopped.
- **R5 (HIGH):** file API isolation and unconfined user-account commands are distinct under approved Criteria §7. Do not claim a VM-grade sandbox or prohibit legitimate shell operation. Report `command_confinement: none (user account)` and `state_integrity_vs_commands: not_protected`; fail closed on grant/controller errors and avoid connector-secret injection.
- **R6 (HIGH):** per-agent file ownership and integration contract were unspecified. Corrected below; branch-level parallelism is allowed, concurrent writes to the same shared file are not. Integration is serial and uses reviewable PRs.

### Goal, scope and non-goals

Online GSA calls selected host plugin; connector supplies API/tools for independently granted workspaces (full file, Git, command, process, build/test) and references (read/search/copy-out only), real results and truthful recovery. No local agent, new approval gates, VM or new CI/DAG framework. Finish the Mac product before Windows. Keep M0–M6 names, but split tasks and assign a critical path. The latest approved Criteria and settled D1–D3 override contradictory pre-2026-11-05 text.

### Read-before-code baseline and shared contract (sequential; short)

**P0-01 — baseline/dirty-tree preservation:** confirm `main` and `codex/mac-completion` or other working branch, status/diffs, current installed-plugin capability and relevant prior fixtures without resetting, deleting, fetching over or overwriting local changes. Historical acceptance and uncommitted content are not transferable evidence. Record exact SHA and ownership before feature PRs.

**P0-02 — shared interfaces (must finish before parallel code):** one selected-host controller/scope identity, workspace/reference roles, normalized path and epoch checks; file transactions keep existing journal/readback/UNKNOWN; command runs reuse process journal and `VerifiedNativeSandbox`-style seam without guest-specific assumptions; one command metadata contract (`cwd`, command, host/toolchain, exit, stdout/stderr, state, output bounds, cancellation, provenance). Lock shared MCP catalog/bootstrap interface signatures and ownership. Decide API changes in a tiny interface PR before agent branches; do not force all features to wait for native acceptance.

**P0-03 — VM freeze baseline:** enumerate VM-only vs shared/non-VM paths/imports, registration points, CI tests, installer assets and external user-owned media. Mark VM code as FROZEN. The cleanup PR is deferred until a functional native replacement is evidenced; document safe rollback and preserved history.

### Parallel source development tracks (after P0-02; isolated branches)

| Track | Task IDs | Primary owner and limited file scope | Parallel with | Output / exit |
|---|---|---|---|---|
| A — Mac file backend | M2-A1 recovery/install; M2-A2 file moves, diff/log; M2-A3 directory transfer | `src/hosts/macos-{scoped-files,file-recovery,directory-*}.ts`, `native/macos-files/*`, file-specific stores/tests, `scripts/install-mac-scoped-files.mjs`; one subtask author per shared file | B, C, D, E | Working/reference positive and denial paths, same-owner journals, conflict/UNKNOWN/no replay; native-safe fixture green |
| B — native Mac commands | M3-B1 host runner; M3-B2 Git/process/results | `src/hosts/macos-host-commands.ts` (proposed), `src/core/{native-io,process-manager,durable-process,process-journal,git-*}.ts`, process tests; shared MCP wiring only in integration | A, C, D, E | Real macOS child execution with bound cwd, output/timeout/owned-stop, command result schema; no VM and no shell confinement claim |
| C — hosted Mac CI/evidence | CI-C1 workflow and non-VM suite; CI-C2 native-safe fixture matrix | `.github/workflows/*`, CI-only scripts/test fixtures; no product runtime mutation | A, B, D, E | GitHub `macos-latest` reproducible checks on PR SHA; no secrets, no VM steps; clear PASS/FAIL/SKIP |
| D — Mac desktop lifecycle preparation | M5-D1 audit/setup contract and non-invasive tests | `native/macos-desktop/*`, Mac desktop packaging/docs and isolated lifecycle tests; **no production install/activation** | A, B, C, E | Reviewed design/tests for login, Dock, Pause/Resume/Quit, allowlisted ignored `.env`, neighbor preservation; implementation may be staged but release waits integration |
| E — VM retirement inventory | VM-E1 inventory/test mapping; VM-E2 deletion PR **after** replacement proof | VM-only path map/documentation first; later isolated VM removal PR; never edit A/B files without integration owner | A, B, C, D (inventory only) | Exact deletable-path list, replacement map, no original media touched, zero shipped runtime dependency after retirement |

Within Track A, A1/A2/A3 may each build isolated fixtures/interfaces in parallel **only where file ownership does not overlap**; shared installer, broker, grants and MCP dispatch edits are serialized by Track A integrator. Within B, B1 native adapter precedes B2 end-to-end process/Git binding. Track C refreshes exact baseline after every merged source change; prior CI results never transfer to new SHA. Track D does not install/start on user machine.

### Sequential integration and physical-host gates

| Gate | Needs | Action | Condition to advance |
|---|---|---|---|
| G0 interface-freeze | P0-01/P0-02 | Review exact source and shared API, register branches/owners | No ambiguous concurrent ownership; accepted pre-code interface review |
| G1 M2 source | Track A PR(s) + C tests | Serial integration, focused conflict/reference/UNKNOWN tests | macOS hosted CI PASS exact SHA; unsupported backend remains visibly blocked |
| G2 M3 source | Track B PR(s) + G0 + working M2 grant surface | Serial bind into `src/mcp/{runtime-bootstrap,server,catalog}.ts`; run end-to-end sandbox-free command checks on hosted macOS disposable roots | exact-SHA hosted CI PASS with macOS host command/Git scripted fixture, no VM dependency, no fake native PASS |
| G3 candidate acceptance pre-install | G1 + G2 + applicable D tests + CI-C2 | Review provenance/installer and macOS hosted native-safe suite | full required hosted suite PASS, no unexplained skipped mandatory test, artifact/build SHA recorded |
| G4 user's Mac | G3 + explicit installation action | Verified install only onto intended Mac, disposable workspace/reference roots, plugin file + Git + command/build/run/log/stop probes, no neighboring process kill | Actual installed-plugin evidence, not GitHub CI alone |
| G5 recovery + VM removal | G4 native replacement evidence, then M4 recovery checks and VM-E2 in independent PR | Prove restart/reconciliation/UNKNOWN/owned-stop; remove VM-only runtime + run hosted regression again | no shipped VM import/installer/entrypoint/test prerequisite; preserved evidence/media |
| G6 M5 release | G4 + G5 + desktop D complete | Installed lifecycle, multi-project isolation and per-host full acceptance | all required Mac Criteria proven, no unresolved mandatory capability |
| G7 M6 Windows | G6 | Plan Windows parity separately | No Windows feature work earlier |

**Concurrency rule:** A/B/C/D/E may research and code in distinct branches after G0; a task does **not** need the preceding milestone fully complete to start if its interface and safety dependencies are known. However actual integration and acceptance move G0→G6 sequentially. Never cherry-pick unreviewed shared-MCP edits from competing branches; one integration owner applies and tests them.

### CI, acceptance and protection

Hosted runner: GitHub Actions macOS with exact PR/head SHA, Node 22, `npm ci --ignore-scripts`, TypeScript build, non-VM source tests, scoped native-safe Swift/Python fixtures where compatible, runtime smoke for real macOS commands as implementation lands, clean termination and log artifacts. Explicitly exclude VM guest/Virtualization.framework/QEMU tests; classify older VM suites as frozen, not a passing replacement. CI must flag missing mandatory native test rather than silently SKIP. No real user token/tunnel, no release install or privileged destructive tests in Actions.

Real Mac after G3: separate install approval and matching pinned artifact; record host/arch/OS/toolchain, command/cwd, run IDs, clean/dirt hashes, exit/log/result, root roles, canaries and observed revocation/recovery. Protect existing user data, local unfinished work and other applications. `command_confinement` warning is mandatory. A successful macOS cloud test does not certify the local TCC/permissions, Dock/login, selected-plugin tunnel, or native installation.

### Pre-code review disposition

**SELF-REVIEW: PASS for consistency of scope and proposed dependency map only.** External Critic/Reviewer PASS for this V2 is **NOT RECORDED**. Agent coding should begin with G0 ownership/interface review and a fresh source/working-tree check; no product source or deployment is authorized by this document alone. All old completion claims remain bounded to their evidence and latest STATUS, not upgraded by planning text.



## 2026-11-05 — Human direction: freeze VM, test on GitHub-hosted macOS before installing locally

**Effective scope:** No further Linux/macOS guest VM development, fixes, provisioning, QEMU, EFI or VM-based runtime validation. The Linux VM worker is deprecated, not an optional implementation path for M3. Prepare complete removal of VM integration after native Mac replacement and tests; retain historical evidence and do not erase any original user VM media. A GitHub Actions `macos-*` hosted runner is a remote macOS test host, **not** a request to develop/run our own VM. No new connector CI/DAG engine.

**Order (applies to M2–M5):**
1. Inventory VM dependencies/imports, production registrations, tests and workflows. Mark VM entrypoints frozen; forbid new VM work except safe removal. Classify files as VM-only, shared/non-VM, historical evidence or external media.
2. Implement the smallest direct-macOS-host file, process, Git and project-script path, respecting CRITERIA §7's 2026-10-31 command exception. Use existing process/log facilities, no new local agent or orchestration engine.
3. **Pre-install test gate:** run `npm ci --ignore-scripts`, `npm run build`, `npm test`, and relevant non-destructive native-macOS fixture tests on GitHub Actions `macos-latest` from the exact PR commit. Record runner OS/arch, SHA, actual results and skips. No private tunnel, local user secrets, installed connector, or privileged/system-mutating fixture in hosted CI. A green Actions run is preliminary, not proof of local installed-plugin behavior.
4. If pre-install CI is green, only then conduct a separately reviewed installed integration test on the user's actual Mac, using disposable workspace roots and verified installer/artifact identity. Do not install, activate or replace the user connector automatically.
5. After direct-host execution has equivalent coverage, remove all VM-only code, install scripts, worker/guest assets and VM-only CI/test registrations in a separate reversible cleanup PR. Validate no production references and run hosted macOS regression again. Preserve historical reports, original user media and external files. **Target: zero VM runtime dependency in shipped connector.**
6. Complete M3 process/log/Git/script, M4 recovery and M5 plugin/desktop acceptance on actual Mac; Windows stays deferred.

**Current status:** this directive adds plan and hosted-CI preparation only; no M2–M5 acceptance, no local installation and no native-host execution claim. Existing implementation/status snapshots may describe earlier VM behavior but do not override the freeze.


Status: ACTIVE

**Current handoff (2026-11-02):** Start with [MAC-QWEN-HANDOFF.md](MAC-QWEN-HANDOFF.md) for the working-tree checkpoint, remaining review finding and exact next actions. M2 is in progress; M2–M5 are not accepted. The active P02 simplification and first stopped-owner slice in [TECHNICAL_PROPOSAL.md](TECHNICAL_PROPOSAL.md#p02-simplification--active-2026-11-01) govern over conflicting historical proposals. Do not restart discovery or infer milestone completion from historical evidence.

Derived from the approved [CRITERIA.md](CRITERIA.md) (Status: APPROVED, kept unchanged by the user). It reorganizes the already reviewed sequence in [MILESTONES.md](MILESTONES.md) and the detailed [implementation plan](plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md) into GOALs; it adds no new product scope, milestone or task. Facts: [PROJECT_PROFILE.md](PROJECT_PROFILE.md), [ARCHITECTURE.md](ARCHITECTURE.md), current state: [STATUS.md](STATUS.md). CRITERIA has no per-requirement IDs, so references use `CRITERIA §N` (its numbered sections 1–10 and the 2026-10-18 scope confirmation, `§0`).

**GOALMAP is inside this Plan.** Milestone IDs are kept as the reviewed identities; State is only a pointer to evidence in STATUS.md, never a completion claim. Gate state is owned by `harness/gate.mjs`; nothing here advances it.

## GOALMAP

| Goal ID | Observable result | Approved CRITERIA | Dependencies | Plan section | State |
|---|---|---|---|---|---|
| M1 | A concrete Mac boundary decision: what the existing broker proves, its limits, and what stays blocked | §0, §4, §7 | none | PLAN-M1 | Docs decision exists; file boundary remains BLOCKED by retained-FD authority survival after root relocation; §7 accepts unconfined host commands |
| M2 | GSA edits real projects on the selected Mac across multiple working/reference roots with no per-operation approval | §1–§4, §7 | M1 | PLAN-M2 | IN PROGRESS: source slices have evidence; installed/native file delivery pending |
| M3 | GSA runs real commands, Git and existing project scripts on this Mac and gets truthful status, logs and outputs | §4, §5, §6 | M1 + G0 interface contract for parallel source; M2 integration before Mac installed acceptance | PLAN-M3 | PENDING: source may be developed in parallel with M2, native/plugin acceptance remains blocked |
| M4 | Disconnects, crashes and reboots never produce false results or duplicate mutations | §6, §8 | M3 | PLAN-M4 | PENDING |
| M5 | The full Mac journey is accepted per host, including several independent projects | §1–§8, §10 | M2, M3, M4 | PLAN-M5 | PENDING |
| M6 | The same journey works on Windows, built only after M5 is accepted | §9, plus §1–§8 on Windows | M5 | PLAN-M6 | NOT STARTED by design |

No M0 item is planned: the baseline/design milestone is planning evidence only.

## Plan items

No `docs/discussions/` DEC files exist, so no accepted Decision is linked below; the settled scope decisions live in [DECISIONS.md](DECISIONS.md) and CRITERIA §0.

### PLAN-M1 — GOAL: a documented Mac boundary decision that says what is proven and what stays disabled

- **CRITERIA references:** §0, §4, §7
- **Current state / gap:** [M1 feasibility](plans/M1-MAC-BOUNDARY-FEASIBILITY.md), [design](plans/M1-MAC-HOST-BOUNDARY-DESIGN.md) and [decision](plans/M1-MAC-BOUNDARY-DECISION.md) exist with broker and retained-capture evidence. The reproduced retained-FD authority survival after root relocation is unresolved; the Apple Endpoint Security entitlement is reported absent/unknown and nothing is assumed about it.
- **Implementation:** retain the broker characterization for file operations. The 2026-10-31 §7 decision accepts host commands under the logged-in account without OS confinement; it does not resolve the file broker's retained-FD limitation.
- **Dependencies:** none
- **Acceptance:** blocked mutation, cross-root and reference-copy paths stay explicitly disabled until a reviewed mechanism is proven.
- **Verification:** reviewed documents plus the recorded signed-broker native runs; no new native run is required by this Plan.
- **Limitations / non-goals:** broker success is not command-boundary or full Mac acceptance.

### PLAN-M2 — GOAL: GSA works on real Mac projects in several granted roots, with workspace full-access and reference read/copy-out only

- **CRITERIA references:** §1, §2, §3, §4, §7
- **Current state / gap:** registry, persistence, explicit role binding, regular-file recoverable operations, transaction readback, directory copy and installed-file delivery slices have source/bounded native evidence ([STATUS.md](STATUS.md), [Mac core resumption](plans/2026-10-19-MAC-CORE-RESUME.md)). Remaining: installed native file delivery, move/rename, remaining directory cases and live-plugin routing proof. Production activation of recovery stays false.
- **Decisions:** [Human D1–D3](reviews/2026-10-30-MAC-FINISH-PLAN.md) and [§7 decision](reviews/2026-10-30-CRITERIA-S7-DELTA-PROPOSAL.md); the 2026-11-01 instruction is to simplify Plan and Proposal against Criteria before more code. D2's directory move is same workspace and volume, atomic, no overwrite, no separate recovery; it does not remove the requirement for file moves between granted workspaces.
- **Implementation — revised M2 direction (2026-11-01):** finish one vertical path through the selected plugin, scoped broker, existing transaction journal and readback before adding further infrastructure. Reuse the checked Mac file/recovery backend and existing journal where they meet Criteria; retain capture/history and return UNKNOWN on uncertainty, never replay automatically. Simplify the installer/evidence path in [P02 revision](TECHNICAL_PROPOSAL.md#p02-simplification--active-2026-11-01), keeping effective boundary, conflict detection and artifact identity checks. The exact historical qualification report, helper count and repeated proof plumbing are not product outcomes. Do not disable an existing guard until the replacement path is implemented and its equivalent required behavior is actually demonstrated.
- **Delivery order:** (1) integrated file recovery/installation with preserved old history, (2) file move and operation-log/non-Git diff through existing stores, plus minimal D2 directory rename, (3) selected-plugin installed delivery with disposable Mac fixtures; then M3 → M4 → M5 as already ordered. Historical step2b implementation detail is superseded only where the active P02 revision says so; preserve existing commits, evidence, uncommitted work and actual installation data until a safe migration or explicit disposition is reviewed.
- **Dependencies:** M1
- **Acceptance:** list/search/read, create, write/edit/patch/binary, copy/move/rename/delete, diff and logs in working roots; A↔B copy/move between workspaces; reference read/copy only; invalid or overlapping roots, races, TCC, revocation and no widening are rejected.
- **Verification:** `npm run build`, `npm test` (verified in `harness/common/checks.json`) for source; matching real-Mac disposable-fixture runs for native claims. Unit tests never certify native behavior.
- **Limitations / non-goals:** no command-completeness claim; Windows is out of scope.
- **Coverage / feasibility / conflicts:** §3–§4/§7 file boundaries, concurrent projects, log/diff and §8 UNKNOWN/no replay remain required; no new CI, daemon or per-operation approval. Held-descriptor relocation and installed integration remain UNVERIFIED for the revised path; native tests are needed. Past proof applies only to the exact tested artifact and must not be promoted to the new path. Approved Criteria and D1–D3 take precedence over older M2 technical wording; no other active decision is intentionally changed.

### PLAN-M3 — GOAL: GSA runs real project commands, Git and existing scripts on this Mac and reads back honest results

- **CRITERIA references:** §4, §5, §6
- **Current state / gap:** process journal and history source exist; actual Mac host shell/Git/script execution is not implemented or proven.
- **Implementation:** reuse the process journal as the sole run record. Run commands as the logged-in user with validated workspace-relative cwd, timeout, output limit and owned cancellation. Report `command_confinement: none (user account)` and `state_integrity_vs_commands: not_protected`; detect and report suspected state changes. No connector CI/DAG engine or multi-OS matrix.
- **Dependencies:** G0 interface freeze permits source development parallel to M2; final MCP integration requires a verified M2 grant/file path.
- **Acceptance:** pass/fail, stdout/stderr/exit and outputs; timeout and owned cancellation; dirty-Git and non-Git behavior; no stale-result claims.
- **Verification:** real commands on the Mac with recorded evidence; relevant working/reference boundary checks.
- **Limitations / non-goals:** commands and descendants can access and change data outside the workspace, including connector state, with the user's permissions. Use trusted projects; file tools and connector APIs retain their scoped boundary. Tunnel credentials in the existing ignored environment file share this risk.

### PLAN-M4 — GOAL: operations stay truthful across disconnect, service failure and reboot

- **CRITERIA references:** §6, §8
- **Current state / gap:** pending after M3; interruption evidence exists only for the file-recovery adapter.
- **Implementation:** owner fencing before reconciliation, immutable terminal results, UNKNOWN instead of guessing, no duplicate mutation.
- **Dependencies:** M3
- **Acceptance:** competing/expired/revoked controllers rejected; real crash, restart, reboot and wake behave as recorded; unrelated processes untouched.
- **Verification:** actual-host crash/restart/reboot runs.
- **Limitations / non-goals:** power-loss and failed-fsync durability remain unverified until separately tested.

### PLAN-M5 — GOAL: the complete Mac journey is accepted, including multiple independent projects

- **CRITERIA references:** §1–§8, §10
- **Current state / gap:** pending; the desktop lifecycle (saved setup, login startup, Dock UI, Pause/Resume/Quit) follows only after core Mac functions are verified.
- **Implementation:** installed artifact with signature identity, background lifecycle without Terminal, selected-plugin routing and control, non-Git local-only and hybrid flows.
- **Dependencies:** M2, M3, M4
- **Acceptance:** every required Mac criterion has current proof; no required Mac capability unresolved.
- **Verification:** fresh installed-artifact runs with source, artifact and toolchain identity recorded.
- **Limitations / non-goals:** Mac evidence does not certify Windows.

### PLAN-M6 — GOAL: the same tool groups and journey work on Windows

- **CRITERIA references:** §9 and §1–§8 on Windows
- **Current state / gap:** deliberately not started; no Windows feature work or native feasibility before M5 is accepted.
- **Implementation:** to be planned only after M5; needs its own Windows ACL, storage, process and package implementation.
- **Dependencies:** M5
- **Acceptance:** Windows-specific evidence per host; three-OS source CI is regression evidence only.
- **Verification:** actual Windows runs.
- **Limitations / non-goals:** skips are not native passes.

## Technical direction

TypeScript ESM on Node >=20 and existing native Swift/macOS helpers; no new product VM, guest toolchain or local CI engine. The former optional Linux VM disposition is superseded by the 2026-11-05 freeze-and-retire decision. Preserve original VM media, remove VM-only shipped integration after direct-host replacement proof.

## Open Human questions

None required for steps 2–6 now. Domain or scope escalations (for example a path that would need the Endpoint Security entitlement) will be raised when they arise, not assumed.
