# Technical Proposal — Coder-owned, whole Plan

Status: FINAL (revision 2, Critic CR PASS)
Critic CR: PASS

**Descriptive only.** No source, stub or test files are created by this proposal. It covers every milestone and Task of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), written bottom-up from the Tasks (P-IDs from [MILESTONES.md](MILESTONES.md)). It adds no scope: it describes how the already reviewed sequence maps onto existing code. "VERIFIED" = path/behavior seen in this repository; "PROPOSED" = new design; "UNVERIFIED" = depends on a host fact not yet proven. No accepted DEC files exist under `docs/discussions/`, so none is linked.

## Proposal by milestone

### MILESTONE-M1 — documented Mac boundary decision (Plan PLAN-M1)

#### TASK-P01 — a docs-only decision on what the Mac broker proves and what stays disabled
- **Plan / Criteria / decision refs:** PLAN-M1; CRITERIA §0, §4, §7
- **Files:** REUSE_AS_IS (VERIFIED): `docs/plans/M1-MAC-BOUNDARY-FEASIBILITY.md`, `M1-MAC-HOST-BOUNDARY-DESIGN.md`, `M1-MAC-BOUNDARY-DECISION.md`, `native/macos-files/{broker,tree-broker,recovery-broker}.swift` and their `test-*.py` characterizations. No new files.
- **Functions / interfaces:** none new. Consumers of the decision are P02/P03 (file mechanisms) and P04 (command boundary).
- **Shared dependencies / state / host constraints:** retained-FD authority survives root relocation (reproduced, unresolved); Endpoint Security entitlement absent/unknown — nothing assumed.
- **Tests:** none added; existing signed-broker native runs are the evidence.
- **Exclusions:** no native supervisor, no unrestricted fallback, no entitlement or administrator assumption.

### MILESTONE-M2 — Mac multi-root files (PLAN-M2)

#### TASK-P02 — role-bound roots, full file tool surface, recoverable move and workspace operation log
- **Plan / Criteria / decision refs:** PLAN-M2; CRITERIA §1–§4, §7 (and the "Theo dõi" row: operation logs and diff per workspace)
- **Files:** REUSE_AS_IS (VERIFIED): `src/local/{grants,workspace-cli,identity,mac-owner,file-transaction-store,protected-state}.ts`; `src/core/{workspace,workspace-read,workspace-path,write-engine,file-transactions,edit-guards,unified-patch}.ts` (list/search/read/glob, hash-guarded edit and patch conflict detection); `src/hosts/macos-{scoped-files,file-code,file-evidence,file-recovery,recovery-installation}.ts`; `src/mcp/{server,catalog,write-dispatch,batch-dispatch,runtime-bootstrap}.ts`. MODIFY: `macos-file-recovery.ts`, `native/macos-files/recovery-broker.swift` and the `recoverableMutations` facade in `src/mcp/runtime-bootstrap.ts` (currently only `replaceIfHash`, `trashIfHash`, `readTransaction`).
- **Functions / interfaces:** `move_file` already exists (`catalog.ts`, `write-dispatch.ts`, `write-engine.moveFile`; `FileTransactionOperation` already includes `"move"`). The remaining work is a **recoverable `moveExclusive`** added to `recoverableMutations`, following the move recovery contract that `docs/plans/M1-MAC-BOUNDARY-DECISION.md` still lists as disabled; it stays disabled until that contract is met. Workspace operation log: the criterion is met by a bounded read of `file-transaction-store` and `directory-copy-store` records through the existing `get_file_transaction`/`get_directory_copy` readbacks; a list-style operation-log reader over those same stores is PROPOSED (no new store), and diff outside Git has no owner yet — recorded as an open gap, not claimed.
- **Shared dependencies / state / host constraints:** one authority model (below). Production recovery activation stays false until installed proof exists. APFS races/TCC on installed artifacts UNVERIFIED.
- **Tests:** existing suites VERIFIED present in `dist/test` and run by `npm test`: `grants-roles`, `workspace-roles`, `mcp-workspace-roles`, `workspace-read`, `file-transactions`, `mac-file-code/evidence/recovery`, `mcp-file-transaction-readback`, `recoverable-write-routing`; new cases for recoverable move and the log reader; real-Mac fixture runs for native claims. Negatives: overlap, widening, revocation, reference mutation.
- **Exclusions:** no command execution; no Windows.

#### TASK-P03 — directory copy and working-root A↔B transfers
- **Plan / Criteria / decision refs:** PLAN-M2; CRITERIA §2–§4
- **Files:** REUSE_AS_IS (VERIFIED): `src/core/directory-copy.ts`, `src/local/directory-copy-store.ts`, `src/hosts/macos-directory-{copy,evidence,installation}.ts`, `native/macos-files/tree-broker.swift`. Directory **move** has no interface today (`catalog.ts` exposes `copy_directory` only) and is **not** proposed; it is out of this Task unless CRITERIA requires it.
- **Functions / interfaces:** copy through the tree broker; reference → workspace copy-out only; no writes into references. Shares broker identity, grants and installation separation with P02.
- **Shared dependencies / state / host constraints:** held-parent ancestry races UNVERIFIED.
- **Tests:** existing `directory-copy*`, `mac-directory-*`, `mcp-directory-*` suites (VERIFIED); native interruption/destination suites already recorded, not repeated.
- **Exclusions:** no directory move, no cross-OS copy, no VM shared roots.

### MILESTONE-M3 — Mac execution and evidence (PLAN-M3)

#### TASK-P04 (absorbs P05) — one host command run record: execution, Git and evidence
- **Plan / Criteria / decision refs:** PLAN-M3; CRITERIA §4, §5, §6. The reviewed milestone IDs P04/P05 are kept in MILESTONES.md; this proposal designs them as one Task because they share one record type.
- **Files:** MODIFY (VERIFIED existing): `src/core/native-io.ts` (the seam: `SandboxedProcessRequest`, `VerifiedNativeSandbox`), `src/core/{process-manager,durable-process,process-journal,git-engine,git-plans}.ts`, `src/local/process-store.ts`, `src/mcp/{server,catalog,runtime-bootstrap}.ts`. `server.ts` enables execution tools only when `sandbox?.verified`; `runtime-bootstrap.ts` currently wires them to `src/hosts/macos-vm-runtime.ts` and `docker-sandbox.ts`. A Mac host implementation of `VerifiedNativeSandbox` is PROPOSED as a new file under `src/hosts/` only after M1 selects a mechanism.
- **Functions / interfaces:** one interface — `VerifiedNativeSandbox.execute/start` — with a Mac host implementation behind it, **fail-closed (BLOCKED) until a boundary mechanism is proven**. `executeGit` is reused as a thin command planner over the same interface (not "no engine"): `git_*` tools keep routing through `git-engine.ts`, but its hard-coded `network_allowed:false`, 30 s limit and 1 MB cap are replaced by request-level settings. fetch/pull/push network and credential use is UNVERIFIED and stays a separately permitted capability per CRITERIA §4/§5; until then those plans remain refused.
- **Run record:** the process journal (`process-journal`/`process-store`) is the single owner of command, cwd, inputs, exit, ordered stdout/stderr, outputs and explicit uncertainty; `process_output` reads it. The `ci-store`/`ci-log-store`/`ci-artifacts` modules are REUSE_AS_IS and left untouched, used only for source and artifact capture; the `ci_*` tools and `ci-run-service`/`ci-dag`/`ci-scheduler` stay present but are **not extended and not exposed for Mac host runs** (decision: dormant, not removed, because the Linux CI path is preserved). No connector CI/DAG engine is added.
- **Behavior change and regression oracle:** today `run_command` runs on a disposable Linux snapshot and never copies edits to the host (`catalog.ts` description). After this Task, on Mac, command effects land in the granted host workspace. The catalog description is updated accordingly; the Linux snapshot path remains the optional VM path, and per the 2026-10-19 rule is removed rather than repaired if it fails in real use.
- **Shared dependencies / state / host constraints:** the boundary mechanism is UNVERIFIED (host-command/native-SDK research pending). The gap is a blocker, never an unrestricted fallback.
- **Tests:** timeout and owned cancellation; dirty-Git and non-Git; exit/stdout/stderr truthfulness and no stale results; git planner network refusal; a test that BLOCKED is returned when no verified sandbox exists; real-Mac runs once a mechanism exists.
- **Exclusions:** no connector CI/DAG engine, no VM runner, no multi-OS matrix, no universal test generator.

### MILESTONE-M4 — Mac continuity (PLAN-M4)

#### TASK-P06 — owner fencing, crash/restart/reboot reconciliation
- **Plan / Criteria / decision refs:** PLAN-M4; CRITERIA §6, §8
- **Files:** MODIFY (VERIFIED base): `src/local/{control-lease,process-store,protected-state}.ts`, `src/core/durable-process.ts`, `src/mcp/startup-registry.ts`. `src/core/session-lease.ts` (`SingleControllerLease`) is referenced only by `test/session-lease.test.ts`, not by `src`: it is a leftover duplicate of `control-lease.ts`; PROPOSED REMOVE together with its test so owner fencing has one owner (it changes no runtime path).
- **Functions / interfaces:** fence the prior owner before reconciliation; terminal results immutable; unreconciled work reported UNKNOWN, never replayed. Reuses P02 journal/readback semantics and the P04 run record.
- **Shared dependencies / state / host constraints:** power-loss and failed-fsync durability UNVERIFIED.
- **Tests:** competing/expired/revoked controllers; real crash, restart, reboot, wake.
- **Exclusions:** no automatic mutation replay.

### MILESTONE-M5 — complete Mac acceptance (PLAN-M5)

#### TASK-P07 — installed artifact, background lifecycle and per-host acceptance
- **Plan / Criteria / decision refs:** PLAN-M5; CRITERIA §1–§8, §10
- **Files:** REUSE / MODIFY (VERIFIED existing): `scripts/mac-package.mjs`, `mac-desktop-*.mjs`, `desktop-*.mjs`, `install-mac-scoped-files.mjs`, `start.command`, `native/macos-desktop/`, `native/macos-files/`; related `test/mac-desktop-*`, `test/desktop-*`.
- **Functions / interfaces:** signed installed package, post-login background start without Terminal, saved setup, Pause/Resume/Quit, selected-plugin routing.
- **Shared dependencies / state / host constraints:** begins only after P02–P06 are verified; TCC identity repair history is in `docs/plans/2026-10-26-MAC-DESKTOP-TCC-IDENTITY-REPAIR.md`.
- **Tests:** fresh installed-artifact acceptance recording source, artifact and toolchain identity; multiple concurrent projects; non-Git and hybrid flows.
- **Exclusions:** no Windows evidence.

### MILESTONE-M6 — complete Windows acceptance (PLAN-M6)

#### TASK-P08 — Windows implementation after Mac acceptance
- **Plan / Criteria / decision refs:** PLAN-M6; CRITERIA §9
- **Files:** NOT PROPOSED. By the approved sequence there is no Windows feasibility or detailed design before M5 is accepted; `src/hosts/windows-appcontainer-candidate.ts` is VERIFIED existing but only a historical candidate.
- **Functions / interfaces:** the same MCP tool groups; the Windows backend is designed after M5.
- **Shared dependencies / state / host constraints:** all Windows host facts UNVERIFIED.
- **Tests:** deferred.
- **Exclusions:** everything until M5 acceptance.

## Cross-milestone view
- **One authority model:** grants/identity/`control-lease`/protected state are shared by P02, P03, P04 and P06 (`session-lease.ts` removed as unused); no task introduces a parallel permission or ownership store.
- **One process model:** P04 (with P05) and P06 share `process-manager`/`durable-process`/`process-store`; the process journal is the only run/log record.
- **Ordering:** P01 → P02/P03 → P04 (incl. P05) → P06 → P07 → P08, matching the milestone dependencies. P04 is the highest-risk task because its boundary mechanism is not selected.
- **Risks:** retained-FD relocation (P01/P02/P03); command boundary without a proven mechanism (P04); durability beyond process interruption (P06); installed-artifact behavior differing from source tests (P07).
- **Preserved, not extended:** the Linux VM worker (`src/hosts/macos-vm-*`) stays optional and unverified; original media untouched.

## Critic CR record
**Round 1 — CHANGES_REQUIRED** (independent Critic, PRE_CODE_TECHNICAL, revision 1). Findings, all checked against source and accepted:
1. P04 omitted the real chain (`native-io.ts`, `git-engine.ts`, `git-plans.ts`, `server.ts`/`runtime-bootstrap.ts`, catalog descriptions) → revision 2 lists them, reuses `executeGit` as a planner and keeps network/credential Git gated.
2. P04/P05 duplicated ownership and left the `ci_*` engine undefined → merged into one run record owned by the process journal; `ci_*` dormant.
3. Move was already implemented; the real gap is recoverable move; P03 title promised directory move → P02 restated, directory move dropped.
4. "Theo dõi" operation-log/diff obligation had no owner → P02 owns a log reader over existing stores; non-Git diff recorded as open gap.
5. `session-lease.ts` duplicate → proposed REMOVE.
6. P04 lacked a design → minimal interface, fail-closed, regression oracle added.
7. Test set → itemized; the named suites exist in `dist/test` and run by `npm test`.
**Round 2 — PASS** (same independent Critic, revision 2). All seven fixes re-verified against source; no blocking finding. Non-blocking notes carried into implementation:
- Non-Git diff has no owner; report it to the user as an open gap at M2 acceptance, never silently.
- `ci-*` stores are untouched (REUSE_AS_IS), as now stated in P04.
- The operation-log reader is a read-only tool, added to the read-tool list near `server.ts:351` so it needs no execute grant.
- If M1 finds no boundary mechanism, P04 raises HUMAN_ESCALATION; the boundary is never relaxed.
