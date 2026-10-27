# Directory store finite failure coverage — existing Task 4

**PROPOSED TEST ASSIGNMENT, execution timing decided by primary after current lock repairs.** Trace: [existing Task4 durability row](2026-10-24-MAC-DIRECTORY-MISSING-EVIDENCE.md), unchanged criteria §§4/8. Cover actual lock/publish/file-sync/directory-sync paths and public interrupted outcomes without replay. This is source-level fault evidence, not physical power-loss, native-helper crash, installation, provenance qualification or full Mac acceptance.

**Owners/files:** Tester owns only `test/directory-copy-store.test.ts`, `test/mac-directory-copy.test.ts` and a dated report. This plan assigns no implementation changes. If a test exposes a new bug, preserve exact expected RED and request a separate Coder assignment for the smallest task-owned repair; do not weaken assertions or refactor production to make injection easier. Reviewer examines real call path, fault reached, stored state, effect counts and owned cleanup. Preserve all pending work and snapshot before editing.

## Injection and evidence rules

Use real private disposable journal filesystem and real `DirectoryCopyStore` public methods. Narrow Node test mocks wrap `fs.open` only for exact owned lock/temp/journal-directory paths and wrap the exact returned FileHandle's `sync`; never globally fail every fsync. Identify publish stages from the actual own `fs.link`/`fs.rename` source/target and encoded record revision/status, then arm a **one-shot** EIO at the next journal-directory handle sync. Perform real link/rename first and inject only the later sync failure; do not fabricate a post-syscall error from a successful link/rename itself. Lock/temp sync faults target their own handle and phase. Record an event trace proving exactly one intended injection was reached; a passing test with an unused injector fails.

Do not proxy/replace `store.create`, `beginEntry`, `acknowledgeEntry` or `finish`; existing proxy-based coordinator coverage is not actual store-path evidence. No exported I/O seam, new dependency, general fuzzer or failure framework. Separate fixture/copy ID for every case; global fs mocks scoped/restored in finally and not used concurrently. Track exact opened handles and successful closes, restoring wrappers before exact owned real-close cleanup. Preserve fixture/report if ownership/closure cannot be established; no blind signals or unrelated lock deletion.

Coordinator tests use existing registry/source fixture and nonnative base/reader stubs. Mutation stubs update a bounded effect map; destination readback must derive its capture from that actual map (root-only, partial or full), with stable directory identities. Do not use the current fixture's unconditional `simple` capture to falsely report MATCH for absent/partial effects. Journal operations themselves remain real. All conclusions are test-level; no helper/process/signature/observer runs.

## Exactly six highest-value failure positions

Use the existing simple three-entry manifest (root, empty directory, note.txt) for coordinator cases. Its normal record schedule is create revision1; root begin2/ack3; empty begin4/ack5; file begin6/ack7; APPLIED finish8. Fault selection uses verified phase/revision, not an unqualified global call ordinal.

| Position / public path | Required observed state and error | Restart/no-replay assertion |
| --- | --- | --- |
| 1. Initial exclusive lock FileHandle.sync EIO in `store.create` | Real lock opened/stat verified; sync fails before operation. Original EIO survives successful verified cleanup, owned handle closes, same lock is safely released, no record/temp publication. | Fresh store create can create revision1: no previous durable transaction or namespace effect existed. Do not require public UNKNOWN for this known pre-intent failure. |
| 2. Initial publication temp FileHandle.sync EIO in `store.create` | Temp bytes were actually written; sync fails before link. Temp handle closes, own temp is removed, lock safely released, original EIO, no target record. | Fresh store create succeeds once with revision1. Assert zero namespace calls and no stale partial target; this does not prove hardware durability. |
| 3. Journal-directory sync EIO after actual initial exclusive link/publication during public `copies.copy` | Target record is fully readable PENDING revision1, ack[], pending null, single-link after temp unlink. `store.create` is outside coordinator loop try: initial public copy rejects `RESULT_UNKNOWN`, not a fabricated DirectoryCopyOutcome. Zero namespace calls. | After restoring fault, construct new DirectoryCopyStore and new coordinator over same journal/registry/effect map. `readCopy` and duplicate same-ID `copy` return UNKNOWN (destination ABSENT); no namespace dispatch. No ID replay just because initial call rejected. |
| 4. Journal-directory sync EIO after actual root `beginEntry` rename to revision2 | Durable visible record PENDING rev2/pending root/ack[]. Initial coordinator returns UNKNOWN before any namespace call. Catch may fail stale-revision finish; assert actual stored rev2, not a synthetic terminal UNKNOWN. | Fresh store/coordinator read and duplicate copy remain UNKNOWN; zero namespace calls. Preserve pending root and unchanged record bytes/revision across duplicate. |
| 5. Journal-directory sync EIO after actual root acknowledgement rename to revision3 | Root mkdir stub happened exactly once. Visible record PENDING rev3/ack root/pending null. Initial call UNKNOWN; no empty/file dispatch. Its in-memory pending receipt may differ from newer on-disk progress; inspect both honestly. | Fresh coordinator reads UNKNOWN with partial destination DIFFERENT, duplicate no additional namespace calls. Record remains rev3; no cleanup rollback or replay of root. |
| 6. Journal-directory sync EIO after actual APPLIED finish rename to revision8 | All three acknowledged namespace calls occurred once. Visible terminal APPLIED rev8 with complete ack/no pending; initial call returns UNKNOWN because completion publication acknowledgement failed. Do not overwrite terminal record to force UNKNOWN. | Fresh store/coordinator may truthfully read APPLIED/MATCH from the complete terminal record; duplicate returns APPLIED without any additional namespace call or record rewrite. This is observed current state, not proof fsync survived a crash. |

For positions3–6 assert exact initial outcome/error, actual record bytes/status/revision, temp/lock cleanup state and total namespace-call prefix. Restore injection **before** fresh-store inspection/retry; instantiate both a fresh store and fresh coordinator, retain the same authorized roots and bounded effect map. Count namespace mutations separately from permitted read captures. Never delete transaction records/locks to enable restart assertions. No automatic mutation replay after uncertain publication. If observed behavior contradicts these expected contracts, stop that case at reproducible RED and report it; no implementation is preapproved by this coverage plan.

## Safe verification and bounded review

After primary assigns test execution, Tester runs `npm run build` sequentially, then:

```sh
node --test dist/test/directory-copy-store.test.js dist/test/mac-directory-copy.test.js
```

These exact suites contain no native fixture entrypoint. Verify all six injected events were reached, owned wrappers restored, handles closed and actual journal records inspected. Report exact test totals and every failure, including pre-existing failures. Existing successful tests need only the affected focused rerun; do not repeat native suites or broaden into a matrix.

Only primary chooses any later full safe check, retaining the established native exclusion:

```sh
NODE_OPTIONS='--test-skip-pattern=^Seatbelt.native.candidate.permits.own.workspace.and.denies.sibling.read/write$' node harness/verify.mjs .
```

No plain npm test or unguarded verify. Historical consumed Seatbelt case is excluded, never counted PASS; Windows skips are separate. No new test-native command is authorized.

Review trigger: completed finite six-case report with reached injection/effect/record evidence, or a reproducible new failure needing Coder assignment. BLOCKING requires violated criterion and reproduction; unavailable evidence UNVERIFIED; unrelated suggestions OUT_OF_SCOPE. Primary tracks current explicit 2026-10-25 02:42:31Z–03:12:31Z window and remaining rounds across directory/sibling work; this proposal resets neither. At the limit preserve checkpoint and ask explicit continuation. No source activation, gate edits, Git staging/commit/push/fetch/merge/rebase/branch change. Windows remains deferred.
