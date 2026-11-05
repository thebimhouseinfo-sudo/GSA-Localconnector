# Track A — Integration Requests

## GOAL
Route shared interface/dispatcher work to INT-A rather than modifying files owned by other parallel tracks.

**Branch:** `plan/mac-native-ci-vm-retirement-20261105`  
**Track A source/test SHA:** `c5490cb15920b55827f08928438ab331bfb50981`  
**Readback HEAD at creation:** `3b7080d3fedff668b9c62483b788750fb2c05f2c`

## Requests (not implementation claims)

1. **INT-A-01 — File/move contract.** Current `NativeScopedFiles.moveExclusive` in `src/core/native-io.ts` and `macos-scoped-files.ts` invokes a same-workspace broker; `invoke` rejects cross-root destination. Define approved cross-working-root regular file move with source/destination role binding, CAS, no overwrite, partial result reporting and durable no-replay reconciliation using the existing transaction store. Keep reference source mutation denied. Shared interface/dispatcher edits by integrator only.
2. **INT-A-02 — Non-Git diff and operation log.** Wire a bounded non-Git baseline/diff reader and operation-log API to existing file transaction evidence without a duplicate transaction log; enforce workspace/ref visibility and secret redaction. Request may require owned code addition plus shared catalog/server signature; integrator owns common files.
3. **INT-A-03 — Directory atomic rename.** Provide exact contract and MCP hook for same-root/same-volume atomic native rename with exclusive destination, symlink and grant-revocation checks. Reject cross-volume/cross-root rename or return explicit supported partial semantics; do not claim tree-copy+delete is atomic.
4. **INT-A-04 — Capability truth.** `supportedOperations` and selected plugin exposure must only advertise a feature after A1/A2/A3 native evidence and CI qualification. `macFileRecoveryActivation.available` must remain false until actual reviewed installation and crash/containment evidence. Do not toggle it based on test mocks.
5. **INT-A-05 — G1 regression handoff.** Run exact-SHA macOS build, focused directory/file/recovery tests and disposable signed native broker; classify unavailable Mac27 archive/runner as BLOCKED. Never rerun native-owner fixture while descendant physical-stop evidence is inadequate.

## Scope / ownership

Track A may change the scoped Mac hosts, native file brokers, existing file/directory stores and their tests. Only integrator changes `src/mcp/server.ts`, `catalog.ts`, `runtime-bootstrap.ts`, `write-dispatch.ts` and `batch-dispatch.ts`. No new branch, no main mutation, no forced push, no merge/deploy.

## Remaining findings

A-R01 owner fixture physical stop; A-R02 cross-root file move/log/diff; A-R03 atomic directory rename; A-R04 exact-SHA executed test evidence; A-R05 non-atomic preflight source observation. All remain OPEN or BLOCKED. **No G1 PASS.**

## Revised interface handoff — cc83ae85

**Exact Track A source/test commit:** `cc83ae852b33abcd2c39afa6013e59f1a3ae1246` (earlier A3 `c5490cb15920b55827f08928438ab331bfb50981`). Changed owned files: `src/hosts/macos-scoped-files.ts`, `src/hosts/macos-directory-copy.ts`, `src/local/file-transaction-store.ts`, `native/macos-files/{broker.swift,test-broker.py}`, `test/{mac-directory-copy,mac-scoped-installer,mac-file-transaction-log,mac-non-git-diff,mac-directory-rename-native}.test.ts`, `test/helpers/mac-recovery-installed-fixture.mjs`. Native run `42045394162` still QUEUED when observed; integration MUST not claim its PASS.

1. **A2 source owner — cross-root recoverable MOVE still missing.** Existing `NativeScopedFiles.moveExclusive` routes to a source-root `move` operation blocked by native broker; it does not implement A↔B move. Provide one existing FileTransactionStore-backed, crash-aware publish/readback/conditional removal flow with explicit partial UNKNOWN and no replay. An undocumented copy-then-delete, direct unconfined host FS mutation or second journal is **not** acceptable. A2 remains NOT_MET until code and evidence exist; integrator cannot simply expose it.
2. **INT-A authorized file transaction logs:** existing `FileTransactionStore.listWorkspace(workspaceId,authorize,limit=100)` is bounded to 4096 entries and 100 returned records, includes records where source/destination matches, rechecks a host-provided *persisted read authorization* callback before/after. Integrator must ensure caller is current authorized project and never leak records across scopes. Existing transaction records only, no new log service.
3. **INT-A bounded non-Git text diff:** `MacScopedNativeFiles.diffNonGitText(ref,capturedBaseline)` returns `MacNonGitTextDiff { before_sha256,after_sha256,changed,patch }` with 1 MiB UTF-8 cap and verified native read. Integrator determines authorized baseline capture/transport/persistence; do not claim Git history or historical state when no baseline exists.
4. **INT-A directory rename:** Mac-only `MacScopedNativeFiles.renameDirectoryExclusive(source,destination)` routes `rename_directory` to `native/macos-files/broker.swift`, *same workspace only*, with `renameatx_np` exclusive/no-follow/beneath and post-publication inode check. Shared `NativeDirectoryCopies` or MCP schema wiring must be reviewed by single integrator. Native binaries MUST be rebuilt/requalified for exact source with signed disposable fixture before any capability claim; do not change `supportedOperations` prematurely.
5. **C-A/G1 native validation:** new `native/macos-files/test-broker.py` scenarios cover successful atomic rename, destination collision, symlink denial and traversal denial. New Darwin candidate compile test and existing A1 fixture are separate levels of evidence. A1 real-owner fixture is still SKIP/BLOCKED until all owned descendant physical-stop evidence and current qualification inputs are available. CI queued is not PASS.

**Status:** Integration requests remain OPEN; source A1/A2/A3 are PARTIAL. No G1 acceptance, merge/deploy or modification to protected shared MCP files.

## Test-handoff scope update — current Human decision (2026-11-05)

For **C-A/INT-A/G1**, request exact-source **GitHub-hosted macOS runner** build, tests and safe signed disposable native broker/owner fixtures. User's physical Mac installation, plugin rebind and local checkout verification: **PENDING USER REQUIRE** (deferred until a new user request; not a gate for current hosted CI source testing). Treat a hosted runner test failure as a test/source finding, not as lack of a real Mac. Do not bypass owned-process safety or relabel a deliberately skipped mandatory hosted fixture as PASS.

**Interface compatibility repair:** `loadMacScopedFiles` retains the existing `Promise<NativeScopedFiles>` contract after commit `9eaaaa23cc97d2147961beaaa06552e3f1ac7b75`; Mac-specific extension `MacScopedNativeFiles` remains a candidate to integrate later. No change to `src/mcp/runtime-bootstrap.ts`. INT-A still owns shared MCP exposure and A2 cross-root MOVE must be finished before claiming Track A DONE.
