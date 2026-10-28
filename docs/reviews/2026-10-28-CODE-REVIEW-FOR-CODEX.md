# Code review for Codex — bugs to fix

Date: 2026-10-28 · Branch: `main` (local, merge `1bbbfed`) · Mode: static read-only review, effort high.

## Scope and limits (read first)

- Requested target: `src native scripts`. Round 1 read: `src/core/{workspace-path,write-engine,edit-guards,unified-patch,git-engine,git-plans,workspace-read,process-manager,durable-process,session-lease}.ts`, `src/local/{control-lease,process-store,file-transaction-store}.ts`, `src/hosts/macos-scoped-files.ts`, `native/macos-files/broker.swift`. Round 2 (added below as findings 11-16) read: `src/mcp/server.ts` (dispatch section, lines ~330-568), `src/mcp/http.ts`, `src/local/grants.ts`, `src/hosts/macos-directory-copy.ts` (readback/authorization), `src/hosts/macos-file-recovery.ts`, and a grep scan of `scripts/*` for shell/rm/eval patterns. Still NOT reviewed: the first 330 lines of `server.ts`, `batch-dispatch.ts`, `write-dispatch.ts`, `runtime-bootstrap.ts`, `directory-copy-store.ts`, `macos-directory-evidence/installation.ts`, `macos-recovery-installation.ts`, `core/directory-copy.ts` (beyond its header), the Swift files other than `broker.swift`, and the desktop/package/native-test scripts beyond the grep scan.
- Findings come from reading code. **No finding was reproduced by running a failing test.** Each item below says how to reproduce; write the failing test first.
- Baseline when reviewed: `npm run build` OK; `npm test` 514 tests, 511 pass, 0 fail, 3 skipped.
- Follow AGENTS.md: snapshot files before editing, one task at a time, no weakening tests, no push.

Severity: **H** = likely breaks real use or a stated guarantee, **M** = real but bounded, **L** = cleanup/robustness.

## Findings

### 1 (H) Process journal quota permanently disables process features

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/local/process-store.ts:57` — `list()` throws `PROCESS_JOURNAL_QUOTA` when more than 10000 `<uuid>.json` files exist, and nothing deletes journals. `DurableProcessManager`'s constructor calls `store.list()` into its `ready` promise, so once the limit is hit every later command, list and stop fails.
- Repro: create 10001 valid journals in a temp store, construct `DurableProcessManager`, await `initialize()`.
- Fix direction: prune or archive terminal journals (keep UNKNOWN/active), or make `list()` bounded without failing startup. Keep terminal-immutability rules.

### 2 (H) Reconcile after owner fence only sees the newest 1000 journals

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/local/process-store.ts:59` — `list()` sorts by mtime and slices to 1000; `reconcileAfterOwnerFence` (`:62`) iterates that list. An older record still marked RUNNING/non-stopped is never rewritten to UNKNOWN/stopped and is not hydrated.
- Repro: 1001+ journals where the oldest is `stopped:false` and owned by a previous session; call `reconcileAfterOwnerFence(newSession)`; the old record is unchanged.
- Fix direction: reconcile must scan all non-terminal records (filter before slicing), independent of any display limit.

### 3 (M) One bad journal blocks the whole store

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/local/process-store.ts:59` — `Promise.all` over `load()` rejects on the first unsafe/corrupt/invalid file (`create()` writes the final name directly with `O_EXCL`, so a crash or full disk can leave a partial file). `ready` rejects and process management is unavailable.
- Repro: write a truncated `<uuid>.json` into the store, then initialize the manager.
- Fix direction: quarantine or report unreadable records and continue, or write via temp+link like `file-transaction-store.publish`. Do not silently treat a bad record as stopped.

### 4 (M) `git_add` accepts pathspec magic that can leave the workspace root

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/core/git-plans.ts:24` — `rel()` rejects `/`, `..`, `.` segments and `\`, but not a leading `:`. `:/` and `:(top)other-dir` are Git pathspec magic.
- Repro: workspace root is a subfolder of a larger repo; `gitPlan("git_add",{paths:[":/"]})` yields `git add -- :/`, staging files outside the granted root.
- Fix direction: reuse `validateWorkspaceRelative` (rejects `:`) or add `--literal-pathspecs`. Add negative tests for `:/`, `:(top)x`, `:!x`.

### 5 (M) Git hardening is inconsistent with its own stated rule

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/core/git-plans.ts:20-27` — the header says no inherited Git hooks may run, but: only `status` and `diff` pass `core.fsmonitor=false`; `git_commit` runs repo hooks (`pre-commit`, `commit-msg`); `git_diff`, `git_show`, `compare_commits` do not pass `--no-textconv`, so `diff.<driver>.textconv` from repo config can execute.
- Repro: repo with a `.git/hooks/pre-commit` or a textconv driver writing a marker file; run the matching plan (inside the sandbox once one exists).
- Fix direction: add `-c core.hooksPath=/dev/null`, `-c core.fsmonitor=false` to every plan and `--no-textconv`; add a test asserting the argv of every plan. This matters most when P04 enables host execution.

### 6 (M) Unified patch rejects the standard "no newline" marker

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/core/unified-patch.ts:31` — lines starting with `\` (e.g. `\ No newline at end of file`) fail the operation check with `INVALID_PATCH`.
- Repro: `git diff` for a file whose last line has no trailing newline, apply with `applyPatch`.
- Fix direction: accept and honor the marker (it controls final newline), with tests for add/remove of the trailing newline.

### 7 (M) Over-limit output discards the real result

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/core/durable-process.ts:114` — the output-size check throws inside the `try` around `sandbox.execute`, so the `catch` saves `UNKNOWN` with `exit_code:null` and no stdout/stderr, although the command finished.
- Repro: backend returns a receipt with `stdout` larger than `max_output_bytes` and exit code 0; the journal ends UNKNOWN with empty output.
- Fix direction: save the receipt truncated with `output_limited` honesty (state UNKNOWN is fine, losing exit code/output is not). Align `timed_out` (FAILED here, UNKNOWN in `git-engine.ts`).

### 8 (L) Stale-lock removal can steal a live in-process lock

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/local/control-lease.ts:173` — `invalidateAfterOwnerFence` unlinks `control-lease.lock` outside the `locked()` promise chain. If a `locked()` operation in this process holds the file, the lock is removed under it.
- Repro: start `acquire()` and call `invalidateAfterOwnerFence` concurrently with a stalled operation.
- Fix direction: serialize through `this.pending`, or compare the lock's `owner_session` before unlinking. Only matters at startup, hence L.

### 9 (L) Unused duplicate lease implementation

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/core/session-lease.ts:4` — `SingleControllerLease` is referenced only by `test/session-lease.test.ts`; `runtime-bootstrap` uses `src/local/control-lease.ts`. Two fencing implementations can drift. The Technical Proposal (P06) already proposes removing it.
- Fix direction: delete the file and its test after `grep` confirms no other use.

### 10 (M) Commands cannot run outside the workspace root

**Coder status (2026-10-28): skipped — Human deferred to P04; cwd remains restricted to `"."`.**

`src/core/process-manager.ts:35` — `validateProcessRequest` requires `cwd_relative==="."`. With argv-only execution there is no `cd`, so a project in a subfolder cannot run its build/test (CRITERIA §5).
- Repro: `validateProcessRequest({...cwd_relative:"app"})` throws `INVALID_PROCESS`.
- Fix direction: allow a validated relative cwd (`validateWorkspaceRelative`) once the P04 boundary exists. Do not loosen before the sandbox seam is proven; this is a design decision to confirm with the user.

### 11 (H) `glob` pattern causes catastrophic regex backtracking (ReDoS)

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/mcp/server.ts:368` — each `*` becomes `.*` in `new RegExp("^"+escaped+"$")`. Many stars backtrack exponentially and block the single-threaded Node process, so every MCP call (including `release_control` and `stop_process`) hangs.
- **Reproduced:** in a standalone Node snippet, pattern `"*a".repeat(25)+"*b"` (52 chars, under the 160 limit) tested against `"a".repeat(60)` did not finish within 60 s (I killed it).
- Repro in-product: a directory containing a file named `aaaa…a` (60 chars), then `glob` with that pattern.
- Fix direction: replace the regex with a linear-time wildcard matcher (two-pointer `*`/`?` match), or collapse consecutive stars and cap the number of `*`. Add a test with a time bound.

### 12 (M) Revoked-grant tombstones accumulate until the grant store becomes invalid

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/local/grants.ts:25` — `validateEntries` throws `INVALID_GRANT_STORE` for more than 128 entries, but `revokeTrusted` keeps every revoked id as a tombstone (to preserve epochs). Only re-enrolling the same id replaces it.
- Repro: enroll and revoke 129 distinct ids (batches of ≤16); then `loadTrustedRegistry()` throws, so the connector cannot start or bind any workspace.
- Fix direction: raise the limit separately for tombstones, or compact old tombstones while keeping a per-installation monotonic epoch floor so a re-enrolled id can never reuse a revision. Do not drop revision history without that floor.

### 13 (M) `fetch_file` cannot read files larger than 64 KiB

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/mcp/server.ts:413` — `start_line`/`max_lines` imply paging, but the whole file is read with `read(path,65536)` and only then sliced, so any file over 64 KiB fails with `READ_LIMIT_EXCEEDED`. The reader supports up to 8 MiB.
- Repro: `fetch_file` with `start_line:1,max_lines:50` on a 100 KB source file.
- Fix direction: raise the cap toward the 8 MiB reader limit (response size stays bounded by `max_lines`), or add byte-range reads. Conflicts with CRITERIA §4 (read project files).

### 14 (L) stdio transport sends no response for malformed JSON

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/mcp/server.ts:537` — `handle` parses the line before `id` is known; on `JSON.parse` failure the catch writes nothing (`id` is `undefined`). JSON-RPC requires a `-32700` Parse error with `id:null`.
- Repro: send `{"jsonrpc":"2.0",` over stdio; the client waits forever.
- Fix direction: answer with `{"jsonrpc":"2.0","id":null,"error":{"code":-32700,...}}` when parsing fails.

### 15 (L) HTTP transport lacks the concurrency and timeout limits stdio has

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/mcp/http.ts:80` — stdio caps 32 calls and 4 urgent controls; HTTP has no cap, no body-read timeout and no request timeout. A client holding the token can stall many requests, and `stop_process`/`release_control` have no reserved capacity.
- Fix direction: set `server.requestTimeout`/`headersTimeout`, and share the `activeCalls`/`activeControls` limits with the stdio path.

### 16 (L) `search` silently skips hidden paths

**Coder status (2026-10-28): fixed — local evidence below; no native acceptance claim.**

`src/mcp/server.ts:392` — entries starting with `.` are skipped, and the scan stops after 200 files or 200 directories; `truncated` may still be `false`. Text in `.github/workflows/*.yml`, `.env.example` or `.eslintrc` is reported as absent.
- Fix direction: report skipped-hidden counts, or add an `include_hidden` option; keep dot-directories like `.git` excluded.

## Checked in round 2 and found acceptable (no finding)

- `directory-copy` `readCopy` re-checks source and destination grants through `check()` before and after the readback, so revocation does not disclose copy status (`macos-directory-copy.ts:67-79`).
- `file-recovery` `readTransaction` authorizes against the journal's workspace and degrades APPLIED/CONFLICT to UNKNOWN when the grant changed; `normalize` validates the native reply strictly and falls back to UNKNOWN.
- `http.ts` uses a constant-time bearer comparison, binds to `127.0.0.1`, rejects non-localhost `Origin`, and caps the body at 1 MiB.
- `grants.ts` writes via temp file + `fsync` + `rename` + directory `fsync` under an exclusive lock, and reports `RESULT_UNKNOWN` instead of guessing after publication.
- A grep of `scripts/*` found no `execSync`, `shell:true` or `eval`; `fs.rm(...,{recursive:true})` is used on staging/runtime directories only (`install-native-vm.mjs:85-87`, `mac-desktop-install.mjs:155-232`, `mac-package.mjs:85`, `native-policy-macos.mjs:94`). I did not audit that each target path is confined; do that when reviewing the installers.

## Observations (not defects)

- `moveExclusive`/`replaceIfHash`/`trashIfHash` are refused by `broker.swift` (`SECURITY_BLOCKED_ATOMIC_COMPARE_UNAVAILABLE`) and `supportedOperations` omits update/edit/patch/delete while recovery activation is false. This is documented, so edit/patch/delete do not work on a real Mac install yet.
- `src/mcp/catalog.ts` still describes `run_command` as running on a disposable Linux snapshot; see `docs/TECHNICAL_PROPOSAL.md` P04.
- In the origin/main merge, conflicting files were resolved by keeping the newer local version. If a fix from `origin/main` is missing in a conflicted file (`src/core/durable-process.ts`, `src/mcp/server.ts`, `src/hosts/macos-recovery-installation.ts`, `src/mcp/runtime-bootstrap.ts`, `src/core/native-io.ts`), compare against `origin/main`.

## Suggested order for Codex

11 first (it can freeze the whole server) → 1 and 2 together (same file, shared test fixture) → 3 → 4 and 5 (one Git-plans change) → 12 → 13 → 7 → 6 → 14, 15, 16 → 8 and 9 → 10 only after the user confirms the design.


## Coder repair evidence — 2026-10-28

Scope: the sixteen findings above, in the requested order; item 10 deferred by Human in chat to P04. LOCAL_ONLY, no milestone completion or authenticated gate approval. No new dependency, branch operation, push/fetch/merge/rebase, credential access, or hook/role/configuration edit was performed. No staging or commit was performed by this Coder.

### Start and baseline

- Read AGENTS.md, approved CRITERIA, final Technical Proposal (Critic CR PASS), review, project profile and relevant Coder/debugging/TDD instructions. Criteria and proposal content were not edited.
- `node harness/gate.mjs status`: exit 0, `AWAITING_USER`, `GUIDED_ONLY`, G0 pending trusted Human approval. This repair request was executed under the explicit chat scope; no gate was signed or state edited.
- `node harness/git-admin.mjs preflight`: exit 1, `NEEDS_SCOPE_REVIEW`, `DIRTY_WORKTREE`; branch/target `main`, push `MANUAL_ONLY`. Existing staged documents/harness plus dirty checkpoint/handoff were preserved.
- `python3 harness/common/branch_authority.py check-write`: exit 0, `PASS: write target: main` (also rechecked later).
- Baseline `npm run build`: exit 0. `npm test`: exit 0; **514 tests, 511 pass, 0 fail, 3 skipped**, 36909.662625 ms. Logs: `/tmp/gsa-review-baseline-{build,test}.log`.
- At the first comparison, `git diff origin/main -- src/core/durable-process.ts src/mcp/server.ts src/hosts/macos-recovery-installation.ts src/mcp/runtime-bootstrap.ts src/core/native-io.ts` contained only this task's first glob repair. The five source files therefore matched the locally available origin/main before these repairs. No missing origin/main fix was observed; no fetch was performed.
- During work, pre-existing staged Criteria/Plan/proposal, review and bootstrap files were committed externally (current HEAD observed: `45e7635`). The commits did not change the repaired source. This Coder did not create those commits or reset them.

### Findings and observed repairs

| Item | Status | Reproduction and resulting behavior |
| --- | --- | --- |
| 11 | fixed | Dispatcher subprocess with `"*a".repeat(25)+"*b"` and a 60-character filename was killed at its 3 s deadline before repair. Bounded dynamic programming replaces exponential regex matching. Literal punctuation, wildcard matches and Unicode filenames are covered. Second repair corrected mixed code-point/UTF-16 iteration, after a new literal emoji regression test failed. |
| 1 | fixed | 10,001 valid journals caused `PROCESS_JOURNAL_QUOTA` before repair. Startup now succeeds, preserves every journal and retains the 1,000-record display page. Capability metadata now reports no journal-count quota (`null`). |
| 2 | fixed | With 1,001 journals, the oldest prior-owner RUNNING journal remained non-stopped before repair. Owner-fenced reconciliation now scans all journal filenames independently of the display page, retaining partial output and recording UNKNOWN/stopped rather than replaying work. Lazy history readback for older records remains supported. |
| 3 | fixed | A truncated journal rejected manager initialization before repair. Invalid/unsafe record reads are now reported to stderr as `PROCESS_JOURNAL_UNREADABLE <uuid>`, preserved unchanged and excluded from hydration; valid history remains available. Direct `load()` still rejects the damaged record; no stopped state is invented. |
| 4 | fixed | Planner accepted `:/`, `:(top)x`, `:!x` before repair. All are now rejected as unsafe relative paths. |
| 5 | fixed | New argv assertions failed on missing hook/fsmonitor/textconv protections. Every plan now supplies `core.hooksPath=/dev/null` and `core.fsmonitor=false`; diff/show/compare also disable textconv and external diff. This proves planner output, not execution in a native sandbox. |
| 12 | fixed | Enrollment of the 129th distinct revoked ID failed with `INVALID_GRANT_STORE`. The 128-entry limit now counts active grants only. All tombstones/revisions are retained; re-enrolling id-0 advances to revision 3. No compaction or epoch-history deletion occurs. A serialized 1 MiB size check runs before publication so a new oversized store cannot invalidate later startup. The active-capacity rejection test still verifies unchanged durable bytes. |
| 13 | fixed | Paging a source file above 64 KiB failed before repair. Reader cap is now its existing 8 MiB ceiling, with at most 500 lines per page (including the default). A 2,000-line fixture verifies exact middle-page content and default truncation. |
| 7 | fixed | Oversized output lost the receipt; a timeout returned FAILED. Repair keeps the actual exit code and bounded stdout/stderr prefixes without splitting UTF-8, marks `output_limited`, persists that flag for restarted output readback, and reports incomplete UNKNOWN. Timeout now follows the Git UNKNOWN convention while retaining its receipt. |
| 6 | fixed | Standard no-newline markers were rejected as invalid hunk operations. Addition/removal/preservation of final newline, empty-file additions/deletions and invalid marker placement are covered. First repair regressed an existing empty-file insertion test; second repair restored it without changing that test. |
| 14 | fixed | Malformed JSON produced no response, leaving only the subsequent ping frame. It now emits JSON-RPC `-32700`, `id:null`; notifications remain silent and the next request succeeds. |
| 15 | fixed | Eight excess HTTP calls remained held until the test's 5 s client deadline; request timeout also exceeded the intended bound. HTTP and stdio now reuse one admission helper (32 ordinary / 4 control calls per transport). Excess calls return SERVER_BUSY and ping remains available. HTTP uses a 30 s request/inactivity deadline and 10 s headers deadline; a real incomplete-body client closed in about 30 s (30007.226417 ms in the item run). |
| 16 | fixed | A negative search silently skipped `.github` and `.env.example`. Response now includes `skipped_hidden` and sets truncation when paths were skipped. Hidden content is still excluded, including `.git`. The separate 201-file fixture already reported the 200-file budget as truncated before repair: that suspected budget subcase was **not reproduced**, and its behavior was preserved. |
| 8 | fixed | Stalling an acquire lock's metadata write allowed invalidation to unlink the live file (`ENOENT` on stat). Entire invalidation now queues behind in-process operations, then uses the file lock without recursively entering its own queue. The regression checks retained lock identity and eventual lease invalidation. |
| 9 | fixed | `rg -n 'SingleControllerLease|session-lease' src test scripts native` found only the class and its standalone test. Removed those two files and their stale ignored compiled outputs. **No runtime failure was reproduced or failing behavioral test added for this unused-code cleanup**; deletion is specifically authorized by the request and P06. Production control-lease tests remain. |
| 10 | skipped | Human explicitly chose “Để mục 10 cho P04”. No cwd behavior change or reproduction test was added. Validated subdirectory cwd remains a P04 design/boundary task. |

### Red-test commands and results

Every red-test command below ran after a successful `npm run build` (exit 0), except the explicitly noted initial test compilation error. Red failures were observed before editing the corresponding production code.

| Item | Command | Exit; tests / pass / fail |
| --- | --- | --- |
| 11 | `node --test dist/test/review-read.test.js` | 1; 1 / 0 / 1 (subprocess killed by 3 s deadline) |
| 1+2 | `node --test dist/test/review-process-store.test.js` | 1; 2 / 0 / 2 |
| 3 | `node --test --test-name-pattern='corrupt journals' dist/test/review-process-store.test.js` | 1; 1 / 0 / 1 |
| 4+5 | `node --test dist/test/git-plans.test.js` | 1; 4 / 2 / 2 |
| 12 | `node --test --test-name-pattern='129 distinct' dist/test/grants.test.js` | 1; 1 / 0 / 1 |
| 13 | `node --test --test-name-pattern='fetch_file pages' dist/test/review-read.test.js` | 1; 1 / 0 / 1 |
| 7 | `node --test --test-name-pattern='oversized receipts|timed out command' dist/test/mcp-command-history.test.js` | 1; 2 / 0 / 2 |
| 6 | `node --test dist/test/unified-patch.test.js` | 1; 4 / 3 / 1 |
| 14 | `node --test --test-name-pattern='malformed JSON' dist/test/mcp-stdio-concurrency.test.js` | 1; 1 / 0 / 1 |
| 15 | `node --test --test-name-pattern='HTTP bounds|HTTP closes' dist/test/http.test.js` | 1; 2 / 0 / 2 |
| 16 | `node --test --test-name-pattern='search reports' dist/test/review-read.test.js` | 1; 2 / 1 / 1 |
| 8 | `node --test --test-name-pattern='metadata write is stalled' dist/test/control-lease.test.js` | 1; 1 / 0 / 1 |
| 11, second repair | `node --test --test-name-pattern='literal Unicode' dist/test/review-read.test.js` | 1; 1 / 0 / 1 |

Red logs: `/tmp/gsa-review-<item>-red.log`; use `1-2`, `4-5`, and `11-r2` for the combined/second runs. An earlier single-case 10,001-journal reproduction also failed with PROCESS_JOURNAL_QUOTA before the two independent fixtures were run.

Item 7's first test draft failed compilation (build exit 2, TS2339: union output type does not always declare `complete`); no test executed in that attempt. Correcting the test's type access produced the two real red behavioral tests above before any production repair.

### Build and full-suite evidence after each repair

For each row, commands were **`npm run build` then `npm test`**. Both exited **0**, except the marked first item-6 suite failure. Logs are `/tmp/gsa-review-<tag>-{build,test}.log`.

| Tag / item | Tests | Pass | Fail | Skipped |
| --- | ---: | ---: | ---: | ---: |
| baseline | 514 | 511 | 0 | 3 |
| 11 | 515 | 512 | 0 | 3 |
| 1-2 | 517 | 514 | 0 | 3 |
| 3 | 518 | 515 | 0 | 3 |
| 4-5 | 520 | 517 | 0 | 3 |
| 12 | 521 | 518 | 0 | 3 |
| 13 | 522 | 519 | 0 | 3 |
| 7 | 524 | 521 | 0 | 3 |
| 6, first attempt | 526 | 522 | **1** | 3 |
| 6-r2 | 526 | 523 | 0 | 3 |
| 14 | 527 | 524 | 0 | 3 |
| 15 | 529 | 526 | 0 | 3 |
| 16 | 531 | 528 | 0 | 3 |
| 8 | 532 | 529 | 0 | 3 |
| 9 | 531 | 528 | 0 | 3 |
| 11-r2, final source | **532** | **529** | **0** | **3** |

First item-6 build exited 0 and its suite exited 1. Failure: `zero-context patches insert after the named old line and into an empty file`, got `"x"` instead of `"x\n"`. Existing assertion was kept; the second repair passed. Lessons were recorded for both second repairs (items 6 and 11). Maximum repair count per item: two, below five. Work stayed within one 30-minute window; no counter/state reset or continuation was needed.

Final source tests: 40131.2185 ms. Net change: 19 added tests, one authorized unused-module test removed; 514 → 532 total. The three baseline skips remain skips.

### Task-owned files

Modified source:
- `src/core/durable-process.ts`
- `src/core/git-plans.ts`
- `src/core/process-journal.ts`
- `src/core/unified-patch.ts`
- `src/local/control-lease.ts`
- `src/local/grants.ts`
- `src/local/process-store.ts`
- `src/mcp/http.ts`
- `src/mcp/server.ts`

Modified tests:
- `test/control-lease.test.ts`
- `test/git-plans.test.ts`
- `test/grants-roles.test.ts` (active capacity still rejects atomically; tombstones no longer count as active)
- `test/grants.test.ts`
- `test/http.test.ts`
- `test/mcp-command-history.test.ts`
- `test/mcp-process-history.test.ts` (metadata expectation and explicit corrupt-record reporting; direct unsafe load still rejects)
- `test/mcp-stdio-concurrency.test.ts`
- `test/unified-patch.test.ts`

Created:
- `test/review-process-store.test.ts`
- `test/review-read.test.ts`
- `lessons/2026-10-28-unified-patch-empty-file.md`
- `lessons/2026-10-28-glob-character-units.md`

Removed after usage scan:
- `src/core/session-lease.ts`
- `test/session-lease.test.ts`

Updated this review report. Build regenerated ignored dist files; stale ignored outputs for the removed module/test were explicitly removed. Every project file edit/removal was preceded by `node harness/snapshot.mjs create <files...>` (exit 0). No existing assertion was weakened to hide a failing behavior; two old expectations were updated for the newly required journal/grant behavior while retaining explicit negative safety checks.

### Remaining limits / unverified boundaries

- No independent Tester/Reviewer session or installed native/plugin acceptance run was performed. Build/unit/transport tests do not establish Mac containment, reboot/power-loss durability, real Git hooks/textconv suppression inside a verified sandbox, or Windows behavior.
- Existing native compare-and-mutate limitations and P04 command boundary remain as documented in the approved proposal. Item 10 stays deferred.
- Journals are retained, not pruned; listing still scans directory metadata and fencing scans all records. Very large history costs time/storage. Corrupt journal diagnostics go to stderr; individual corrupt records remain explicitly unreadable and are not inferred stopped.
- Grant revision history is fully retained, without compaction. The existing 1 MiB file ceiling remains; reaching it rejects a new publication with GRANT_STORE_QUOTA and keeps the previous store readable.
- `fetch_file` still refuses files above 8 MiB. A very long single line can make a large page; line paging is not byte-range streaming.
- Hidden paths are reported as skipped, not searched. No `include_hidden` option was introduced.
- No remote refresh was performed; origin/main comparison used the local tracking ref only. Existing unrelated checkpoint/handoff changes remain untouched.

Final harness verification and gate/status observations are recorded below after execution.

### Final harness / handoff

- `node harness/verify.mjs`: **exit 0, ok:true**. All configured commands completed without timeout:
  - `node harness/self-check.mjs`: exit 0; harness syntax/configuration, five role/model assignments and hook schema checks passed (488 ms).
  - `node --test harness/test/harness.test.mjs`: exit 0; **34 tests, 34 pass, 0 fail, 0 skipped** (4365.7125 ms).
  - `npm test` (includes TypeScript build): exit 0; **532 tests, 529 pass, 0 fail, 3 skipped** (40078.36925 ms).
- Harness warnings: expected `TEST_CHANGED` entries and `LINT_NOT_CONFIGURED`; no standalone linter was configured or added. Full captured evidence: `harness/reports/verify.json` and `/tmp/gsa-review-final-harness.log`.
- `git diff --check`: exit 0.
- Final `node harness/gate.mjs status`: exit 0, still **AWAITING_USER / GUIDED_ONLY**, G0 awaits the trusted Human approval adapter. This is not a milestone PASS; no signing/advance/completion action was attempted.
- Final `node harness/git-admin.mjs status`: exit 0, **LOCAL_ONLY**, branch/target main, push MANUAL_ONLY, remote UNVERIFIED_NOT_FETCHED. This task's source/test/report changes are unstaged; new tests are untracked. The two local lesson files follow the repository's existing ignore rule and are not staged.
- Outcome: **15 items fixed locally, item 10 skipped by Human decision**. The item-16 file-budget suspicion was not reproduced; the unused-code item 9 has no behavioral red test. All other repaired findings have observed pre-repair failing tests. Native/plugin/Windows acceptance remains unverified as listed above.

### Follow-up: real Mac check requested by Human

See [2026-10-28 real Mac acceptance evidence](../reports/2026-10-28-REAL-MAC-ACCEPTANCE.md). The signed release broker passed seven narrow native cases on disposable roots. The live gsa-lc-mac endpoint still reports shell/Git and most file mutations blocked, directory installation unsafe/stale, and the previous journal-count limit. The host Seatbelt candidate aborted its allowed command and the test skipped (0 pass). Thus complete Mac readiness and deployment of these source repairs are not established. Human's conditional push/Windows transition was not performed. These observations do not invalidate the recorded source regression-test results or change any milestone status.

### Round3 continuation evidence

Fresh preservation baseline on2026-10-28: build exit0, npm test exit0 **532/529/0/3** (`/tmp/gsa-r3-baseline-test.log`). All per-finding historical red-test commands and final green outcomes above remain recorded; no red history is replaced with an unobserved claim. Item10 remains skipped by Human decision. Later hardening of the1/3 journal repair and12 tombstone repair is explicitly tracked as new findings20/21 in [Round3](2026-10-28-CODE-REVIEW-ROUND3-FOR-CODEX.md), not silently presented as part of the original patch. Final integrated product suite after17–21: **538total/535pass/0fail/3skipped**, build/test exit0. Native qualification remains separate.


Round3 independent review reopened item20 for a reproduced create-versus-archive ID race despite the538/535/0/3 green suite. The current integrated source is not approved for the17–21 commit group. Original1–16 patch is preserved separately at `/tmp/gsa-review-group1.patch`; no index changes or commits were performed. See Round3 checkpoint for the exact next regression/repair.


### Superseding Round3 verification — 2026-10-28

The item20 create/archive race and subsequent leftover-lock startup regression are repaired and independently reviewed PASS; see Round3 final continuation for actual red tests, failed drafts and independent bootstrap evidence. Final product suite observed540total/537pass/0fail/3skipped, build/test exit0; original pre-Round3 preservation baseline532/529/0/3 and original pre-repair baseline514/511/0/3 remain distinct. Findings1–16 retain their per-item evidence and statuses; item10 stays skipped for P04 by Human decision. No native readiness, deployed-source acceptance, commit, push or milestone completion follows from these source tests.
