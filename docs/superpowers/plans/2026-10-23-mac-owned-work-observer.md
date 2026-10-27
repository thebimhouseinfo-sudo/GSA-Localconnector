# Mac Owned-Work Continuity Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans within the already authorized project role flow. This plan prepares the existing process journal as an observer prerequisite; it does not authorize a new sandbox experiment.

**Goal:** Preserve existing asynchronous process history across an actual Mac owner restart, with truthful UNKNOWN reconciliation and no replay or old native-ID control.

**Architecture:** Wire the existing protected ProcessJournalStore into the existing DurableProcessManager. Reconcile old-owner records only after verified kernel owner fencing, and serve persisted history even when the current native execution backend is unavailable. Keep desktop ownedWorkState UNKNOWN: history alone cannot prove safe IDLE.

**Tech Stack:** Existing TypeScript ESM/Node, protected POSIX journal and Python flock owner launcher; no new dependency, endpoint, permission or global setting.

**Spec:** `docs/CRITERIA.md` §§6–8 and `docs/plans/2026-10-19-MAC-CORE-RESUME.md`. User authorized continuing full Mac completion before Windows. This bounded deliverable advances continuity without changing that goal or inventing milestones.

**Queue:** execute after the primary agent's active recovery-inspect bugfix; this document does not start concurrent implementation or alter that task's source ownership.

## Evidence and scope decision

- `src/mcp/server.ts` currently constructs `new DurableProcessManager(nativeProcesses)` without its implemented persistence argument.
- `src/mcp/runtime-bootstrap.ts` reconciles CI after owner fencing but reports `process-journal-pending`.
- `src/local/process-store.ts` already supplies protected create/save/read and `reconcileAfterOwnerFence(session)`. `src/core/durable-process.ts` already persists starts/status/output when supplied ProcessPersistence.
- Its status/output methods currently require a backend before checking persisted terminal history. Server routing also selects the transient manager whenever nativeProcesses is absent. Both prevent useful retained history after an installation becomes unavailable.
- `run_command` uses a separate transient ProcessManager; this slice must not advertise recovered synchronous command history, CI output completeness or full process-tree continuity.
- Desktop loopback tunnel health reports connection readiness only. The existing runtime API exposes no authoritative complete work count or atomic quiesce operation. Listing work per workspace misses file calls, startup reservations and detached CI tasks; checking then killing races new dispatch.
- A future safe IDLE needs admission fencing plus live native-file call counts, VM retained/unconfirmed runs, CI tasks/preparations and the existing owner FD lifetime. That is a separate concrete lifecycle task after this journal wiring, not a fabricated read-only observer now.

## Global Constraints

Preserve current branch and other edits; snapshot explicit files before edits. No push/merge/rebase, gate-state/signature changes, new milestone, VM/media provisioning, native probe or recovery activation. Keep host Git/shell blocked and Windows deferred. A build or fake backend is not actual native containment proof.

## Review Focus

- Restarted owner cannot query/stop/replay an old native identity.
- Old RUNNING/QUEUED state becomes UNKNOWN, never successful or output-complete by assumption.
- Missing current backend cannot hide sealed history or enable execution.
- Cross-workspace access, expired controls and revoked grants remain denied.
- Journal reconciliation failure must not be swallowed or reported reconciled; no desktop IDLE inference.

## One bounded implementation task: connect existing journal and history routing

**Files:** Modify `src/mcp/runtime-bootstrap.ts`, `src/mcp/server.ts`, `src/core/durable-process.ts`; add focused cases to `test/process-journal.test.ts` and `test/runtime-bootstrap.test.ts` or one scoped new MCP-history test. Modify existing tests only where the new truthful metadata changes expectations. No native helper, desktop lifecycle, policy or VM runtime edits.

**Interfaces:** Add `processPersistence?: ProcessPersistence` to existing createReadOnlyTools options; reuse the exported type from `src/core/durable-process.ts`. Production supplies `{store: new ProcessJournalStore(path.join(identityRoot,'process-runs')), ownerSession: owner.session}` only with a verified Mac owner. Construct `new DurableProcessManager(nativeProcesses,16,options.processPersistence)` once; do not rebuild the dispatcher.

- [ ] Tester first adds RED cases: production bootstrap history routing, terminal status/output with null current backend, old unfinished record after fencing, start failure record, no replay/old-native-ID calls, workspace/control denial, missing/corrupt journal and immutable terminal history. Preserve existing paging/UTF-8 checks.
- [ ] Coder creates the process store in bootstrap, calls `reconcileAfterOwnerFence(owner.session)` in the existing owner-fenced startup block before dispatcher creation, and passes persistence. Do not call reconciliation without owner or emulate owner identity with environment edits. Propagate unsafe/unreadable store failures; never claim successful reconciliation after catch-and-continue. Existing store.list returns newest 1000 of at most 10000 records: disclose that history bound, never infer complete host work/IDLE from the loaded subset.
- [ ] Move requireNativeBackend in DurableProcessManager.status/output below successful retained terminal/previous-owner record lookup. Live records still require the current native backend. Existing stopped history is returned unchanged; UNKNOWN preserves partial stdout/stderr and output_complete false.
- [ ] Route list_processes/process_status/process_output to durable when nativeProcesses OR processPersistence is present. Preserve existing execute grant and control-token requirements. Only change the unsupported-pagination guard to recognize durable persisted output; retain cursor bounds/UTF-8 semantics. start_process and live stop_process still require a verified native backend.
- [ ] Expose process history tools through existing list_capabilities when persistence is available, separately from execution availability. Do not advertise run_command/start_process/stop_process as available because history exists. No new MCP tool or endpoint.
- [ ] Use exact metadata `processHistory: 'persisted-start_process; synchronous-run_command-history-pending'` when wired and `restartRecovery: 'ci-journal-reconciled; async-process-journal-reconciled; native-tree-recovery-not-certified'` only after successful owner reconciliation. Preserve truthful unavailable behavior without owner. These labels are evidence scope, not full native recovery certification.
- [ ] Tester runs build and affected compiled tests. Add a disposable real-owner startup/restart fixture only if needed to verify composition: it may seed synthetic private process records, acquire/release the real isolated owner fence and read history through MCP. Label this journal/startup evidence; do not launch a VM, arbitrary host command or recovery broker and do not claim an actual killed workload produced synthetic records.
- [ ] Verify old terminal bytes/state remain sealed; old active records become UNKNOWN/stopped only under actual replacement-owner admission. A retained FD3 holder must prevent replacement owner admission. Never use PID scans/killpg as proof all descendants died.
- [ ] Reviewer checks §8 evidence and all five review focus cases; maximum two repair rounds. Run required project verification and gate status, record all failures/skips including pre-existing ones. No manual state/approval edits or automatic commit/push.

## Exact limits and next decision

This delivers retained asynchronous process status/output and honest restart reconciliation. It does not make desktop Pause/Quit safe, revive unavailable execution or turn historical VM evidence into a current native pass. Keep `ownedWorkState` hardcoded UNKNOWN until a reviewed quiesce protocol can freeze new dispatch before observing complete retained work and verify owner-fence release after tunnel/CLI exit.

Actual host execution remains independently blocked. Installed `/usr/bin/sandbox-exec` and its man page exist, but the CLI is deprecated; public SDK sandbox.h documents only named profiles for sandbox_init and marks it unsupported. The previous restricted Seatbelt legitimate-read test failed SIGABRT and must not be rerun/widened under this plan. App Sandbox baseline does not deny all world-readable ungranted project data. No verified per-root arbitrary-child boundary is available.

For ownership, installed sys/event.h explicitly says NOTE_TRACK/NOTE_TRACKERR/NOTE_CHILD are unsupported since 10.5. libproc observations and NOTE_FORK are useful observations, not an automatic non-escapable descendant kill domain. A later host design must provide actual read/write/execute scope containment, safe revocation and owned process-tree termination before shell/Git integration; no private API, extra entitlement or old guest is assumed here.
