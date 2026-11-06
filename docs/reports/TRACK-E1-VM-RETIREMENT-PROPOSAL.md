# Track E1 — E2 VM Retirement Proposal (NOT EXECUTED)

## GOAL
After G4 native replacement proof, remove product VM code in an independent reversible source change, without touching user media, installed state or documentary history. This is a proposal only.

## Preconditions / stop gates
1. **G4 hard gate:** exact installed native Mac build has already proven selected-plugin file, Git, workspace script/build/test, owned stop, stdout/stderr/status/log, recovery and boundary behavior on disposable user-authorized roots. Source-only CI or A/B code completion is insufficient.
2. Pin integrated A/B/C/D + integrator exact branch SHA and G4 artifact identity. Ensure no unreviewed overlapping writes. E2 is a separate reversible PR/commit and has its own Reviewer.
3. Verify `C-G3` exact-candidate hosted `macos-latest` CI before installed Mac validation, and retain its logs. `C-VM` must run again on E2 candidate.
4. Confirm no E2 script touches `~/...` VM images, `native-vm` installed directories, retained Mac27 archives, secrets, saved run history or current local checkout. No destructive cleanup of local state.

## Phases and file ownership

### Phase 1 — Rebase classification on post-G4 integrated source
#### GOAL
Get exhaustive exact-revision edges, not stale E1 assumptions.
- **E2 owner (single integrator)** reads latest tree, source imports, dynamic imports, shell/package/CI references and native integration. Confirm that command path truly uses host-native executor.
- Record exact deletion/edit/retention manifest and canonical E1 evidence links. Preserve A/B native file + native process + owner contracts.
- Separate old `ci_*` public surface from basic command status/log/artifact/cancel; decide compatible API behavior under approved Criteria, no new DAG framework.

### Phase 2 — Decouple shared capture and migrate coverage
#### GOAL
Remove VM directory dependencies without removing useful native validation.
- **Track C owner in coordinated PR:** port `native/macos-vm/SourceCapture.swift` if needed to a clearly native location (or replace it with existing native capture), update `scripts/test-native-source-capture.py` and `.github/workflows/ci.yml`; require test executable and PASS, not silently skip.
- **Integrator:** remove `src/mcp/runtime-bootstrap.ts` VM imports, `native-vm` default installation and `MacVmCiExecutor`; align `src/mcp/server.ts`, `catalog.ts` capability claims/CI exposure and runtime recovery/status metadata with native evidence. Retain grants, checked native file loader, owner fencing and durable process state. Update `test/runtime-bootstrap.test.ts` to test the native route.
- **E2 owner:** classify `src/core/ci-*` and `src/local/ci-*` one module at a time; keep needed state readers and host command log/stop/history; do not delete any public functionality just because implementation once used VM.

### Phase 3 — Remove VM-only tracked source
#### GOAL
Eliminate now-dead VM components while preserving source history.
- Remove after verified decoupling: `src/hosts/macos-vm-runtime.ts`, `src/hosts/macos-vm-ci.ts`, `native/macos-vm/{WorkerHost.swift,Virtualization.entitlements,guest_worker.py}`, `scripts/{install-native-vm.mjs,prepare-vm-worker-seed.py,test-vm-guest-worker.py,test-vm-runtime-native.mjs,test-vm-worker-native.py,test-vm-worker-seed.py}`, `test/macos-vm-{artifacts,ci,runtime}.test.ts`.
- Remove `native/macos-vm/SourceCapture.swift` **only after** successful migration of its non-VM source-capture fixture. Preserve useful migrated common validation from `test/macos-vm-artifacts.test.ts`.
- Remove VM-only CI/install references and stale description. No wildcard `rm -rf native/macos-vm` until all exceptions handled.
- Historical `docs/security/*`, `docs/reviews/*`, `docs/superpowers/*`, original evidence and archivable logs remain unchanged. No removal of git history or old receipts.

### Phase 4 — Independent review, test, rollback
#### GOAL
Demonstrate no product VM dependency and no regression on exact E2 source revision.
- Static checks: compile graph + textual scans of `src`, `native`, `scripts`, `test`, `.github`, `package.json`; forbid production `macos-vm`, `native-vm`, `MacVmCiExecutor`, `loadMacVmRuntime`, Linux snapshot assumptions and VM installer/runner references. History-only references are allowlisted explicitly, not renamed or deleted.
- Required hosted `macos-latest` build, full appropriate non-VM suites, A/B file/command/Git/process/log safety tests, C-G3 package and native source-capture fixture, C-VM zero-dependency check. Tests must identify exact SHA, runner macOS version, artifact, expected vs observed, skips. Red/missing/skipped required checks = NOT PASS.
- Independent Reviewer PASS for diff + zero-dependency map + evidence/user-asset non-mutation; commit only scoped E2 source files and preserve unrelated concurrent changes.
- **Rollback:** leave separate deletion PR unmerged on failures; if merged and regression discovered, revert only the E2 commit(s) through a reviewed PR and retest. Rollback restores tracked code only; **never automatically boot old VM** or change user Mac installation. Real Mac app upgrade/rollback is separately human authorized and preserves data.

## Non-goals
No VM execution, image read, reinstall, cleanup of downloaded images, disk reclamation, repair, Windows implementation, local Mac activation, release or deploy. E1 creates only documentation and grants no E2 execution approval.
