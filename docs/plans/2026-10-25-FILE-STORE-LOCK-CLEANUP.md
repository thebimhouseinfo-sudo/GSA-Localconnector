# File store initial lock-metadata cleanup — scoped Task 4 plan

**Scope:** Same existing Task4 source failure-path mechanism as [directory-store cleanup](2026-10-25-DIRECTORY-STORE-LOCK-CLEANUP.md), unchanged criteria §§4/8 and user-authorized autonomous Mac fixes. Separate sequential task; previous scope/history stays unchanged. No new feature/milestone, native execution, installation, permission or activation change. Use systematic debugging/TDD and `superpowers:executing-plans` for the assigned implementation.

**Static root cause:** `src/local/file-transaction-store.ts` `locked()` opens the exclusive lock, then awaits initial `fd.stat({bigint:true})` outside cleanup protection. Stat failure bypasses close. Confirm this sibling defect with its own public-path RED; the directory-store GREEN does not prove sibling behavior.

**Ownership:** Coder only `src/local/file-transaction-store.ts`; Tester only `test/file-transactions.test.ts` plus its dated report. Reviewer reads exact source/RED/GREEN/effect ownership. Snapshot before edits; preserve all others' pending work. No shared abstraction, exported I/O seam, new dependency, stale-lock deletion or unrelated refactor.

1. Tester first adds RED through public `FileTransactionStore.create` on real private disposable filesystem. Wrap `fs.open` only for the exact owned `.lock` FileHandle; its initial stat throws the exact EIO object. Assert original EIO rejection, close attempted once, lock remains same device/inode and no journal record is published. With the wrapper restored, retry must reject `FILE_TRANSACTION_LOCKED` without touching that lock. Before repair record the expected missing-close failure, not a guessed RED.
2. Add companion initial-stat EIO plus close failure. Assert `RESULT_UNKNOWN`, one close attempt, no record, same retained lock and retry `FILE_TRANSACTION_LOCKED`. Use distinct fixture/ID for each scenario. Test finally restores the narrow wrapper and closes its exact retained real handle when necessary; no blind handle/lock cleanup, concurrent global mocking or native transport. Preserve diagnostic fixture on unexpected ownership/cleanup uncertainty.
3. Only after exact RED, Coder protects the acquired handle before first awaited metadata access. On initial stat failure attempt close once; successful close preserves original EIO, failed close reports `RESULT_UNKNOWN`. No identity was established, so retain the lock without unlink/lstat/retry/removal. Preserve existing verified-identity cleanup, publication, sync, reconciliation and no-replay behavior. Do not modify the already accepted directory-store fix.
4. Tester runs `npm run build` sequentially, then `node --test dist/test/file-transactions.test.js dist/test/mac-file-recovery.test.js dist/test/mcp-file-transaction-readback.test.js`. These verified existing TypeScript/build paths exercise store, recovery/readback and MCP integration without native fixture files. Record before/after results, exact close counts/lock identity/no-record/retry evidence and every failure, including pre-existing failures. No plain `npm test` or unguarded full verification.
5. Reviewer checks minimal source delta, public-create realFS RED/GREEN, both cleanup outcomes, owned test cleanup and unchanged verified-lock behavior. BLOCKING needs criterion and reproduction; missing facts UNVERIFIED; unrelated suggestions OUT_OF_SCOPE. No native/helper/codesign/observer test is authorized.

**Acceptance:** Acquired handle is closed exactly once on initial stat failure; original EIO survives successful close; close uncertainty is honest RESULT_UNKNOWN; unverified same lock remains; no record/effect; retry is FILE_TRANSACTION_LOCKED. This is source/test readiness, not native crash/fsync/power-loss proof, provenance qualification, installed/live MCP or full Mac acceptance. Windows remains deferred.

After both source fixes, **primary only** runs the previously approved safe full check exactly:

```sh
NODE_OPTIONS='--test-skip-pattern=^Seatbelt.native.candidate.permits.own.workspace.and.denies.sibling.read/write$' node harness/verify.mjs .
```

Keep the consumed historical Seatbelt native case excluded; never count it PASS. Report its exclusion separately from the two Windows-only skips. Focused tests above do not include the native-effect file. No new native execution is implied by the full-check label.

Primary tracks explicit current 2026-10-25 02:42:31Z–03:12:31Z window and maximum five rounds; directory pair is1/5 and sibling has not started. No reset across delegated work; checkpoint/request continuation at limit. MANUAL_ONLY push; no stage/commit/push/fetch/merge/rebase/branch or gate-state change. Implementation begins only after Tester RED and primary assignment; this plan grants no future activation.
