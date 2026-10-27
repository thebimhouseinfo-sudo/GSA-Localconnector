# Mac Workspace Reselection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or the already authorized project role flow to implement this scoped repair. Steps remain unchecked; gate commands own completion records.

**Goal:** Recover the existing verified create/mkdir/copy subset after the user explicitly reselects the Mac test workspace, and report current selection/backend state truthfully.

**Architecture:** Retain one dispatcher, its scope serialization, controller and process/CI state. Refresh only the scoped-file backend after a successfully reconciled scope publication; keep the backend unavailable when current signed bindings or evidence do not match. Reprovision the already selected Test root through the existing stopped-owner installer with accepted exact-build evidence, rather than changing signed pins or signing during a plugin bind.

**Tech Stack:** TypeScript ESM/Node, existing Swift signed broker, existing Python owner fence; no dependencies.

**Spec:** `docs/CRITERIA.md` §§2–4, 7–10; existing bounded delivery plan `docs/plans/2026-10-21-MAC-INSTALLED-FILE-DELIVERY.md`. User on 2026-10-23 authorized checking GitHub, continuing Mac/testing through gsa-lc-mac, then Windows only after full Mac acceptance. This repair is partial progress toward that unchanged goal.

## Global Constraints

- Preserve `codex/mac-completion` and all dirty/untracked work. Manual-only push; no branch switching, merge/rebase or gate-state edits.
- Snapshot explicit files before mutation. Do not access secrets or change permissions/policies/global configuration.
- Preserve exact signed role/root/device/inode/revision checks, durable grant authorization, owner/control fencing and installation separation.
- Recovery, unsupported file operations, host shell/Git and Windows remain unavailable in this slice. This is not full Mac acceptance.
- Planner → Coder → Tester → Reviewer for this repair; maximum two repair/review rounds. No new milestone or criteria.

## Evidence and diagnosis

- Parent fetched `origin/main` at `b265f6757451edbaa7efc1fbd739d7b0ee911fcf`; all 249 upstream product blobs match the current working files. No content integration is needed.
- Live plugin selected `/Users/nam/Desktop/Test`, workspace `ws-b152c830eed2592c`, revision 2; reads work. File backend remains unavailable with `Scoped file grant set changed` and stale `WORKSPACE_ROOT_CHANGED`.
- `bootstrapMcpTools` loads files and creates its dispatcher only once. A startup registry emptied after stale-root detection therefore leaves a cached null backend and a permanent startup warning after successful binding.
- `bind_workspaces` already serializes and reconciles durable scope publication. Recreating the whole dispatcher would discard its uncertainty fence/queue and unrelated process state; refresh the backend within the existing composition.
- Current Test identity differs from the initial signed installation. Refresh alone must not revive writes against old signed grants. Installer `applyMacScopedFiles(identityRoot,evidence)` already stages/signs current trusted roots, enforces exact build/evidence and holds the stopped-owner fence.
- Parent located accepted release evidence at `docs/reports/2026-10-22-mac-scoped-files-release-evidence.json`; unchanged release code is a prerequisite, not a replacement for installer validation.

## Review Focus

- Failed/uncertain scope publication must not clear the startup warning or enable files.
- A changed root/revision must keep rejecting old signed bundles even after refresh.
- Revocation must immediately deny subsequent access; backend reload failure must not roll back durable scope or imply binding failed.
- Concurrent binds must retain existing serialization and uncertainty behavior; avoid whole-dispatcher replacement.
- Capability diagnostics must match actual operations: selected roots can be valid while installation remains blocked.

## Task 1: Refresh file composition after reconciled scope changes

**Files:** `src/mcp/runtime-bootstrap.ts`, `src/mcp/server.ts`; focused tests in `test/runtime-bootstrap.test.ts` and `test/mcp-workspace-roles.test.ts`. Keep native broker/loader pins and installer unchanged.

**Interfaces:** Extend the existing `createReadOnlyTools` options with optional `onScopeChanged?: (kind: 'bind'|'unbind') => Promise<void>` and `fileBackendState?: () => {files: NativeScopedFiles|null; fileBlockedReason?: string}`. Existing callers retain their static backend behavior. Runtime owns the mutable backend and warning; callback reload failures are captured into unavailable backend state and resolve normally.

- [ ] Add failing regression tests for a successful rebind clearing startup selection warning, dynamic backend/capability refresh, refresh failure retaining successful binding with explicit backend reason, failed publication retaining warning, unbind refreshing availability, and changed revision/revocation denying old writes. Reuse existing concurrent-publication/uncertain-state tests.
- [ ] Run the focused tests and record the specific expected failures before implementation.
- [ ] Invoke `onScopeChanged` only after durable publication, registry replacement and readback all succeed, inside the existing scope queue. Do not invoke it on failed/uncertain publication. Runtime callback clears the historical startup-selection issue only after confirmed successful explicit bind; unbind refreshes the backend without clearing that historical issue. Discard the old backend and call the unchanged strict loader. A loader failure leaves files null and exposes its reason; it is not a failed durable selection.
- [ ] Resolve the optional backend state for file capability reporting and each mutation dispatch. Recompute supported operations from the current backend. Capture one state per call; preserve existing controller checks, scope uncertainty fence and per-operation authorization. Do not reconstruct the dispatcher or reload VM/process/CI services.
- [ ] Ensure returned bootstrap availability/reason access reflects current state rather than immutable startup values. Keep unavailable-owner/platform behavior unchanged. Tests may use fake backends for composition only and must be labeled unit evidence.
- [ ] Run `npm run build`, the affected compiled test files, then `node harness/gate.mjs status`. Record pass/failure/skip counts; no claim of native acceptance from these tests.

## Task 2: Reinstall exact accepted base broker for the selected Test root and test plugin

**Files:** Existing installer and desktop runtime scripts are used unchanged. Tester writes a scoped evidence report under `docs/reports/`; no identity/grant edits by hand.

**Interfaces:** Existing `inspectMacScopedFiles`, `applyMacScopedFiles(identityRoot,evidence)`, strict public `loadMacScopedFiles`; existing owned connector stop/start route and plugin APIs. Do not print installation proof material, runtime credentials or control tokens.

- [ ] Tester confirms installer inspection still describes only the user-selected roots. Use the existing release evidence file; installer must validate it against the current exact compiled release. A missing/mismatched record blocks installation. Do not fabricate evidence or repeat exhausted relocation probes.
- [ ] Stop only the owned Mac connector through its established lifecycle route. Apply the existing installer while its stopped-owner fence is held, retain its previous-installation rollback directory, and restart the owned connector. No broad process killing or automatic signing from plugin bind.
- [ ] Through gsa-lc-mac, acquire control and inspect status/capabilities. Confirm current roots, no stale selection warning, available file backend and exactly the supported subset. If the transport retains an old session, refresh through its established route and record it.
- [ ] In a unique disposable child of `/Users/nam/Desktop/Test`, use plugin create-directory, create-file, fetch/read, file-info and copy-file. Compare created/copied bytes and SHA-256; verify exclusive destination collision preserves original bytes. Retain fixture output for inspection where cleanup needs unsupported deletion.
- [ ] Verify unsupported operations remain honestly blocked and release control in all outcomes. Do not add new roots solely for negative probes. Existing adapter/native evidence covers reference denial and stale binding; rerun affected focused tests when changed composition invalidates it.
- [ ] Run required repository verification (`node harness/verify.mjs`, plus affected native checks justified by changes); report all failures including pre-existing ones. Record plugin tool results separately from unit/build evidence and inspect gate status.
- [ ] Reviewer classifies findings BLOCKING / OUT_OF_SCOPE / UNVERIFIED with criterion and reproduction. After at most two repair rounds report remaining blockers. Use existing finish-task workflow for pending gate handoff; do not sign unavailable user approvals.

## Deliverable and remaining boundary

This is a proposed repair under the already authorized Mac continuation, with execution handled by the primary agent; no new execution-method approval is needed. Success means current Test create/mkdir/copy work through the actual plugin and re-selection diagnostics refresh safely. It does not close recovery, full file operations, native host shell/Git or the full Mac criteria. Keep automatic provisioning of arbitrary newly selected roots as a later bounded design: the current stopped-owner installer cannot safely be called inside a live bind. Continue Mac gaps after this slice; start Windows only after evidence satisfies the existing full Mac acceptance criteria.
