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
