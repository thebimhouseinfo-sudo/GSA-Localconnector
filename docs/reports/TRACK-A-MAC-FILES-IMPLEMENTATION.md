# Track A — Native Mac Files Implementation

## GOAL
Deliver scoped A1/A2/A3 source work without unsafe activation, parallel transaction engines, or shared MCP edits.

**Branch:** `plan/mac-native-ci-vm-retirement-20261105`  
**Pre-edit HEAD (observed):** `9e41819c34fb1455c1e8280f7dc1896080cc0849`  
**Authority:** Human-assigned DIRECT_AGENT CODER; no new branch, merge, or deploy.

## Descriptive PRE_CODE_TECHNICAL — bounded source inventory

- **A1 KEEP/REUSE_AS_IS** `test/mac-scoped-installer.test.ts` detached process-group monitor, retained fixture and explicitly BLOCKED native real-owner test; `scripts/install-mac-scoped-files.mjs`, `src/hosts/macos-file-recovery.ts`, `src/hosts/macos-recovery-installation.ts`: no evidence to enable production recovery. Fixture descendant escape is not certified. No activation flip.
- **A2 MODIFY** `src/local/file-transaction-store.ts`: add bounded authorized read-only workspace transaction listing over the *existing* protected file journal, with no new record types or log storage. Input is workspace ID, read authorization callback, limit; output is immutable validated current records. Load each through the existing protected `load` path, reject unexpected entries, check authorization before and after. Direct consumer is future INT-A log endpoint; no shared MCP change. Add `test/mac-file-transaction-log.test.ts` for workspace separation/revocation/corruption/limit. This is not a replacement for non-Git diff or complete cross-root move.
- **A1 MODIFY** `test/helpers/mac-recovery-installed-fixture.mjs` and `test/mac-scoped-installer.test.ts`: register every directly owned fixture subprocess PID and require physical absence before disposable cleanup; preserve fixture if registration or stop proof fails. Real-owner fixture remains skipped until its native qualification is safe.
- **A2 KEEP/REUSE_AS_IS** `src/hosts/macos-scoped-files.ts` and `src/local/file-transaction-store.ts`. Current `NativeScopedFiles.moveExclusive` is same-root only. Cross-root move, operation log and non-Git diff require scoped, verified interface and integration; do not fake completion or create a second journal.
- **A3 MODIFY** `native/macos-files/broker.swift` fixed `rename_directory` dispatch and `src/hosts/macos-scoped-files.ts` Mac-only extension: same-workspace directory rename via descriptor-relative `renameatx_np` with `RENAME_EXCL`, `RENAME_NOFOLLOW_ANY`, `RENAME_RESOLVE_BENEATH`, no overwrite, root/grant checks, and post-operation inode verification. No change to shared `NativeScopedFiles` contract or supportedOperations advertisement; INT-A owns MCP exposure after native verification. Native source is a *candidate*, never an installed/verified capability.
- **A3 MODIFY** `src/hosts/macos-directory-copy.ts`, `createMacDirectoryCopies.copy`: independently recapture the source after asynchronous grant checks, before the first durable copy intent and destination write, and reject a changed manifest as `HASH_CONFLICT`. Existing `NativeDirectoryReader.capture` and `DirectoryCopyStore` remain the only reader/journal. No additional public API, no shared dispatcher change. This narrows pre-publication source drift but does not establish an atomic OS snapshot or same-volume rename.
- **A3 REUSE_AS_IS** `src/local/directory-copy-store.ts` journal and `NativeScopedFiles.createExclusive/makeDirectory` no-overwrite destination publication.
- **KEEP** `src/mcp/{server,catalog,runtime-bootstrap,write-dispatch,batch-dispatch}.ts` and Track B/C/D/E files unchanged; hand off shared additions to INT-A.

Call graph: caller `NativeDirectoryCopies.copy` → `createMacDirectoryCopies.copy` → `authorize / registry / reader.capture` → `DirectoryCopyStore.create/beginEntry/acknowledgeEntry/finish` → `NativeScopedFiles` exclusive publication → final reader readback. Input is source/destination scoped refs and expected source manifest hash; output remains `DirectoryCopyOutcome` or a pre-intent `HASH_CONFLICT` denial. Revocation and publication uncertainty retain existing fail-closed/no-replay behavior.

## Checks required

Source inspection, TypeScript build, relevant macOS native-safe tests and existing A1 safety fixture tests. Native real-owner fixture remains SKIP/BLOCKED until independently established physical descendant-stop containment. A source-only inspection cannot assert runtime PASS.

## Delivery state

Pre-code proposal recorded. Exact source change, test outcomes, review, remaining findings and integration requests are tracked in the companion reports. This planning record does not itself certify any capability.
