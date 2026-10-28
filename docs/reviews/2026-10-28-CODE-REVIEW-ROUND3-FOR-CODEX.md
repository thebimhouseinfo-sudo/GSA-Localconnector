# Code review round 3 — findings and next steps for Codex

Date: 2026-10-28 · Branch `main` · Static review plus a build/test run of the **current working tree** (Codex's uncommitted repairs included). Extends [the main review report](2026-10-28-CODE-REVIEW-FOR-CODEX.md); finding numbers continue from 16.

## State observed

- `npm run build` OK. `npm test`: 532 tests, 529 pass, 0 fail, 3 skipped (baseline before repairs was 514/511/0/3).
- `git status`: 23 files modified, `src/core/session-lease.ts` and its test deleted, new tests `test/review-read.test.ts` and `test/review-process-store.test.ts`. Nothing of the repairs is committed.
- `docs/reviews/2026-10-28-MAC-COMPLETION-CHECKPOINT.md` says Mac completion is INCOMPLETE; a Coder run hit the account usage limit and delivered no driver/test change.

## Earlier findings: what I could confirm in the working tree (grep/read only, not re-run individually)

| # | Finding | Observed |
|---|---|---|
| 11 | glob ReDoS | `server.ts:362-374` now uses a dynamic-programming matcher |
| 13 | fetch_file 64 KiB cap | read cap is now `8*1024*1024` |
| 14 | stdio parse error | `-32700` response with `id:null` present (`server.ts:577`) |
| 5, 6 (partial) | git hardening | `git-plans.ts` adds `--no-textconv` and a `-c ...` prefix in `plan()` |
| 9 | duplicate lease | `session-lease.ts` and its test are deleted |
| 1 | journal quota | `PROCESS_JOURNAL_QUOTA` removed |
| 12 | tombstones | limit now counts only non-revoked entries |
| 16 | hidden search | result now includes `skipped_hidden` |

Not confirmed by me: findings 4 (pathspec), 7, 8, 10, 15 and the exact content of each fix. Ask the Tester role to re-run each red test on the committed result.

## New findings

### 17 (M) `bind_workspaces` has no deny-list for private directories
`src/mcp/server.ts:~118` (`bindSelections`) and `src/core/workspace.ts:~109` accept any existing absolute directory. Only the scoped-file backend later refuses overlap with its installation (`assertMacFileInstallationSeparated`). `WorkspaceReadSession` (list/read/search/fetch) does no such check.
- Repro: bind the connector identity directory (or `/`) as a reference root, then `fetch_file` on `proof-key` or `trusted-workspaces.json`.
- UNVERIFIED: whether the plugin UI, not the agent, chooses the path. If the agent can pass it, this is a scope-expansion risk.
- Fix direction: reject, at enrollment, the identity directory, its ancestors and descendants, and `/`; add negative tests. Confirm with the user whether `$HOME` itself should be allowed.

### 18 (M) Authorization is very expensive per operation
`src/mcp/runtime-bootstrap.ts:30` — `authorizeMcpWorkspace` takes the control-lease file lock and rereads and parses the grants file each call. Reads call it twice; `copy_directory` runs `check()` (3-4 authorizations) plus a fsynced journal write for `beginEntry` and `acknowledgeEntry` per entry, up to 1024 entries.
- Effect: thousands of lock create/unlink cycles and fsyncs in one tool call; risk of the 15 s helper timeout.
- Fix direction: authorize once per operation or batch; keep the strict re-check at the points that matter (before dispatch, after capture). Measure first; do not weaken the revocation checks.

### 19 (L) Duplicated protected-journal code
`directory-copy-store.ts` and `file-transaction-store.ts` share ~70 near-identical lines (`directory()`, `locked()`, `publish()`, `load()`); `process-store.ts` and `control-lease.ts` repeat the same pattern. The `.gsa-trash` reserved-name check appears in seven places (`write-dispatch.ts`, `server.ts`, `directory-copy.ts` ×3, `macos-directory-copy.ts`, both Swift brokers).
- Fix direction: one shared helper plus one reserved-name validator, behind existing tests. Do this after the correctness repairs, not mixed with them.

### 20 (M) Review of Codex's `process-store` repair
`src/local/process-store.ts:55-70` — `available()` skips an unreadable journal with only a stderr line. A damaged record of old-owner RUNNING work is then neither reconciled nor reported, and `restartRecovery` still says reconciled. With the quota gone, the directory also grows without bound and `list()` lstat-s every file at each startup.
- Fix direction: count unreadable records and keep workspace admission fenced / report degraded `restartRecovery` while any exist; prune old terminal records (keep UNKNOWN and non-terminal). Add a red test with a corrupt RUNNING journal.

### 21 (L) Tombstone repair is only partly bounded
`src/local/grants.ts:25` — revoked entries no longer count toward 128, but the file is still capped at 1 MiB (`readEntries`), so thousands of tombstones eventually still fail the store. Add compaction that preserves a per-installation revision floor.

## Next steps for Codex (in order)

1. **Do not lose the current work.** Run `node harness/gate.mjs status` and `node harness/git-admin.mjs preflight`; snapshot the modified files; confirm build/test (532/529/0/3).
2. **Verify the repairs.** For each of findings 1-16, name the red test and the final green evidence. Mark fixed / skipped / no_change_needed in the main report. Finding 10 needs a user decision, do not implement.
3. **Fix 20 and 21**, then **17**, then **18** (measure first), then **19** (refactor last, no behavior change).
4. **Mac27 recovery driver blockers** from the Reviewer in `2026-10-28-MAC-COMPLETION-CHECKPOINT.md` (owner verification FD3/env, stale captured identity after STOP, wrong-failure acceptance, observer chunk durability) are separate ordinary repairs in `scripts/test-mac27-recovery-native.mjs` and `test/mac27-recovery-native.test.mjs`. Keep them in their own task and commit.
5. **Commit in small groups** (user must approve): repairs 1-16, then 17-21, then the Mac27 driver. Never commit `docs/proposals/`, `.gsa/*` or `docs/LOCAL-MODEL-HANDOFF.md` unless the user asks.
6. **No native claims** from unit tests. Native runs need the explicit task scope and disposable fixtures (AGENTS.md).

## Not reviewed yet

`macos-recovery-installation.ts`, `macos-directory-evidence.ts`, `macos-directory-installation.ts`, the Swift files other than `broker.swift`, `ci-*` modules, and the installer/desktop scripts beyond a grep scan. Review these next if the user wants full coverage.

## Coder execution — 2026-10-28

Human scope: preserve prior repairs;20→21→17→18→19; separate driver task; ask before EVERY commit. No staging, commit or push performed. `docs/proposals/`, `.gsa/*` and `docs/LOCAL-MODEL-HANDOFF.md` remain excluded from all proposed groups. No Criteria, hook/role, identity or milestone-state edit.

Window started2026-10-28T02:49:54Z (09:49:54 local); deadline03:19:54Z. Gate status exit0 AWAITING_USER/GUIDED_ONLY; preflight exit1 DIRTY_WORKTREE; write-authority exit0 main. Snapshot09149da7-1a31-4211-a21f-57fe3e81f762 preserves the task-owned original working tree before this round, including deleted/new paths. Each subsequent edit was snapshotted separately.

Fresh baseline: `npm run build` exit0; `npm test` exit0, **532 total/529 pass/0 fail/3 skipped**,40514.526209ms. Logs `/tmp/gsa-r3-baseline-{build,test}.log`. The main report retains the observed historical red tests and green results for1–16; item10 remains skipped per Human “Để mục10 cho P04”. No regression was deliberately reintroduced just to manufacture another red run.

### Results

| Item | Status | Change / observed evidence |
|---|---|---|
|20|fixed — independent re-review PASS (see final continuation below)|Unreadable records now produce public processRecovery unreadable count/admission_blocked and degraded restartRecovery in direct and production composition. New durable starts are fenced; valid history remains readable. Startup scans all live records, retains UNKNOWN/nonterminal and archives sealed terminal records beyond1000. Archive readback and terminal immutability remain; create also rejects an archived ID. Active scan is bounded for completed history; archive storage still grows.|
|21|fixed|Legacy arrays remain readable. Beyond256 tombstones, atomically publish a compact v2 envelope with entries and a validated monotonic revision_floor in the SAME file. Re-enrollment/revocation uses at least that floor; it is never discarded after compaction. A2048-tombstone fixture verifies bounded file size and monotonically increasing revisions across reloaded/reused IDs. Existing1MiB publication/read cap remains.|
|17|fixed|Human explicitly confirmed rejecting HOME. Registry enrollment/import and durable-grant paths reject filesystem root, HOME, private identity roots, ancestors/descendants and canonical aliases, including caller-selected identity directories. Legitimate sibling/project children still work. A pre-existing HTTP CLI test enrolled its entire fake HOME; its fixture now uses a project child while retaining the original assertion.|
|18|fixed, measured scope|1024 real authorization checks took507.951664ms, median0.482583ms/p950.613167ms,1025 coordination-lock creates including context entry. Actual journal-only64entries/128progress writes took3357.381542ms;1024entries/2048writes58147.554ms. No native helper launched. Bottleneck was durable journal overhead, not permission-check latency. Reviewed minimal optimization removes sync only for EMPTY directory-copy coordination locks; O_EXCL/NOFOLLOW, owned-inode checks, no stale-lock breaking, all authorization/revocation points, durable begin/ack and publication temp-file+directory sync remain. After:64entries1644.3735ms;1024entries48486.899041ms. Single runs, not a throughput guarantee; full native copy remains unverified and large copies still cost time.|
|19|fixed, scoped refactor|Shared protected-journal-io.ts now owns identical locking/publication machinery for file-transaction and directory-copy stores. Domain schemas/root validation/error classes and their distinct lock durability policies remain in callers. One TypeScript reserved-segment validator serves all existing TS call sites with caller-specific errors preserved. Standalone signed Swift broker checks were intentionally not rewritten merely to share TS code: changing native source/build inputs would invalidate unrelated pinned evidence; no native behavior or build layout changed. Process/control stores retain their distinct persistence contracts rather than forcing them into the two transactional-store protocol.|

### Test-first evidence and failures

-20: `node --test --test-name-pattern='corrupt prior RUNNING|sealed terminal' dist/test/review-process-store.test.js`, exit1,2tests/0pass/2fail: missing admission rejection; active journal count1002 instead1001. First focused repaired run:18tests/17pass/1fail because capability composition overwrote degraded status; repaired without weakening the test. Full second run:534/531/0/3. Self-review added an archived-ID exclusion test; red exit1,1/0/1 (`Missing expected rejection`), then focused18/18pass. Lessons recorded for composition and archived-ID exclusivity.
-21: `node --test --test-name-pattern='tombstone compaction' dist/test/grants.test.js`, exit1,1/0/1 because persisted store remained over64KiB. First production draft build exited2 (readEntries wrapper accidentally scoped inside validation); no test ran. Corrected wrapper scope; full run535/532/0/3.
-17: `node --test dist/test/private-workspace-roots.test.js`, exit1,2/0/2 (missing enrollment rejections). First full run537/533/1/3: HTTP CLI isolated-profile fixture enrolled HOME containing identity. Updated only its project fixture, not its persisted-grant assertion; second full run537/534/0/3. Lesson records the policy/fixture distinction.
-18: `node --test --test-name-pattern='coordination locks avoid' dist/test/directory-copy-store.test.js`, exit1,1/0/1 (2empty-lock syncs instead0). Added a guard requiring both publication-file and directory syncs. The prior lock-sync-EIO test was deliberately updated to the reviewed transient-lock contract; publication-sync-EIO and competing/stale/replacement-lock/UNKNOWN tests remain. Full run538/535/0/3.
-19: behavior-preserving refactor; no behavioral red failure claimed. Existing security, publication-fault, descriptor-release, scope, reserved-path and full regression tests are the oracle. Build exit0 and full `npm test` exit0: **538/535/0/3**,40707.923167ms.

All full-run rows above mean `npm run build` exit0 followed by `npm test` exit0 unless explicitly stated otherwise. Logs `/tmp/gsa-r3-<item>-{build,test}.log`, second-run tags20-r2,21-r2,17-r2; final20 exclusivity focused log20-r3-focused. Benchmark scripts/results are `/tmp/gsa-r3-auth-bench.mjs`, `/tmp/gsa-r3-journal-bench.mjs`, `/tmp/gsa-r3-18-before.json`, `/tmp/gsa-r3-18-journals.jsonl`, `/tmp/gsa-r3-18-after.jsonl`.

### Separate driver group

See [Mac27 driver repair](2026-10-28-MAC27-DRIVER-REPAIR.md). Independent Reviewer PASS at round5 for original four source-preparation blockers;38/38 nonnative guards. No native admission or activation; both holds remain false and17/158 caps unchanged. This is a separate task/patch/approval group, not part of17–21.

### Proposed commit groups — nothing staged

1. Earlier1–16 repairs, baseline snapshot content and main review evidence;10deferred.
2. Round3 items17–21 source/tests and this report, after group1.
3. Mac27 driver/test/repair report, separate from product fixes.

Group1 patch is prepared at `/tmp/gsa-review-group1.patch`, checked against the unchanged index without mutation. Groups2/3 remain separate file sets; group2 is not ready due to the reopened item20 race. Human approval is required before applying EACH group to the index/creating its commit. No excluded path belongs to a group. No push is authorized by this request.


### Final independent review / window checkpoint

- Full `node harness/verify.mjs`: exit0, ok:true; self-check exit0; harness34/34pass; npm test538/535/0/3. These green tests **do not close the newly reproduced race**.
- Independent Round3 source review: CHANGES_REQUIRED. Focused42/42pass but item20 remains blocking. No concrete blocker found in17,18,19,21; their native/performance/power-loss limitations remain as stated.
- Reproduction: stall createA after its absent-ID lookup; createB publishes sealed terminal evidence under that ID; list() archivesB among1001journals; resumeA. Active-root O_EXCL now succeeds, and load(id) returns new evidence masking archived immutable result. Actual observation `{archiveExists:true,loadedStdout:'new evidence',duplicateCreateSucceeded:true}`. This is a nonnative disposable-store reproduction, not a native claim.
- Next repair: add this exact interleaving as a red regression; coordinate create and archive atomically per ID (including distinct store instances), preserve all UNKNOWN/nonterminal records and immutable historical readback; rerun focused/full checks and the same independent review. An existence precheck alone is insufficient. Do not stage/commit the current group2.
- No additional source repair was started immediately before the30-minute deadline03:19:54Z. Preserve this checkpoint and ask Human for a new window. No milestone/state edit, staging, commit or push.


### Final continuation — 2026-10-28, window 09:20:07–09:50:07 UTC

Human: “tiếp tục cho tới khi xong cho mac”. This resumes work; it does not waive per-commit approval, immutable Criteria, native one-shot admission or the 30-minute limit. Gate exit0 AWAITING_USER/GUIDED_ONLY, preflight exit1 DIRTY_WORKTREE, branch write check exit0 main. No gate/state change or index mutation. Preserved snapshot09149da7 remains available. Earlier `/tmp` race logs/patch were absent on resumption; those historical results above are retained as recorded observations, not represented as freshly rerun. Group1 patch was reconstructed from snapshot bytes and HEAD, 23files/83300bytes, and `git apply --cached --check /tmp/gsa-review-group1.patch` exited0 without staging.

Item20 race repair: create/save/archive now coordinate by process ID across store instances. Archive rereads under that same lock and never overwrites existing archived evidence. The deterministic paused-lookup regression initially reproduced two successful creators (1test/0pass/1fail); final test requires one winner and immutable archived readback. An initial test draft had a TypeScript implicit-any error (build exit2, no behavioral test); after annotating the mock parameter, source was restored to its pre-repair snapshot for the actual red run before reapplying the fix. Previous-window focused19/19 and full539/536/0/3 were recorded; their `/tmp` logs were no longer present in this resumed environment.

Independent review then reproduced a new consequence: an old-owner RUNNING journal with a leftover ID lock caused reconciliation/transport startup to reject. This window added `a leftover journal lock preserves uncertain work and degrades recovery without aborting diagnostics`. `npm run build` exit0; `node --test --test-name-pattern='leftover journal lock' dist/test/review-process-store.test.js` exit1, **1test/0pass/1fail**, actual unwanted PROCESS_JOURNAL_LOCKED rejection. Logs `/tmp/gsa-r3-leftover-red{,-build}.log`. Final repair catches only this contention during owner reconciliation, preserves journal/lock and counts unresolved_records. Admission remains fenced through list/initialize; diagnostics/history remain available. A later successful explicit reconciliation can clear the count. No stale lock removal, invented STOP, replay or relaxed authorization was introduced. Public degraded text now covers both unreadable and locked recovery.

`npm run build` exit0; focused review-process-store/process-journal/mcp-process-history exit0, **20/20pass** (`/tmp/gsa-r3-leftover-focused.log`). `npm test` exit0, **540total/537pass/0fail/3skipped**,39435.418209ms (`/tmp/gsa-r3-leftover-full-test.log`); the last generic degraded-string change followed this run and is covered by final harness verification below.

Independent configured Reviewer re-review: **PASS for17–21**, no concrete remaining blocker. Independent focused4/4, scoped36/36 and direct bootstrap fixture exit0. Both connector_status/list_capabilities report unresolved_records:1, admission_blocked:true and degraded recovery; RUNNING bytes and lock inode retained. Logs `/tmp/gsa-r3-independent-final-focus.log`, `/tmp/gsa-r3-independent-scoped.log`, `/tmp/gsa-r3-review-bootstrap.log`. Synthetic owner metadata establishes composition behavior only, not a kernel/native owner fence. Earlier review was interrupted by account usage limits; no alternate model was substituted. Current re-review completed under configured Reviewer role.

Final status:17 fixed,18 fixed within measured scope,19 fixed within stated refactor scope,20 fixed,21 fixed. Native/power-loss/throughput limits above remain UNVERIFIED. Main1–16 outcome stays15fixed/10skipped. Driver remains a separate source-reviewed group, not native acceptance.


Final frozen-source verification: `npm run build` exit0 (`/tmp/gsa-mac-review-final-build.log`); `node harness/verify.mjs` exit0, ok:true (`/tmp/gsa-mac-review-final-harness.log`, harness/reports/verify.json). Self-check exit0; harness34/34pass/0fail; npm test **540total/537pass/0fail/3skipped**,39265.917709ms, exit0 after the last degraded-string change. `git diff --check` exit0. No additional source changes after this verification. Expected TEST_CHANGED and LINT_NOT_CONFIGURED warnings remain; no linter/dependency added.


Human explicitly approved group1; committed only the checked23-file group1 patch as `bdae0c2` (`fix: address code review findings 1–16`), git commit exit0. Exact staged-path set matched manifest before commit; no excluded file staged. Groups2/3 still require their separate approvals. Sequential patches were validated in a plain disposable file tree (not a Git index/worktree): all three `git apply --check` exited0 and final40-file bytes matched the working tree. Manifest `/tmp/gsa-review-patch-manifest.json`.
