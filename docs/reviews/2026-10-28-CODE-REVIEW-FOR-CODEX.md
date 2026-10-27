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
`src/local/process-store.ts:57` — `list()` throws `PROCESS_JOURNAL_QUOTA` when more than 10000 `<uuid>.json` files exist, and nothing deletes journals. `DurableProcessManager`'s constructor calls `store.list()` into its `ready` promise, so once the limit is hit every later command, list and stop fails.
- Repro: create 10001 valid journals in a temp store, construct `DurableProcessManager`, await `initialize()`.
- Fix direction: prune or archive terminal journals (keep UNKNOWN/active), or make `list()` bounded without failing startup. Keep terminal-immutability rules.

### 2 (H) Reconcile after owner fence only sees the newest 1000 journals
`src/local/process-store.ts:59` — `list()` sorts by mtime and slices to 1000; `reconcileAfterOwnerFence` (`:62`) iterates that list. An older record still marked RUNNING/non-stopped is never rewritten to UNKNOWN/stopped and is not hydrated.
- Repro: 1001+ journals where the oldest is `stopped:false` and owned by a previous session; call `reconcileAfterOwnerFence(newSession)`; the old record is unchanged.
- Fix direction: reconcile must scan all non-terminal records (filter before slicing), independent of any display limit.

### 3 (M) One bad journal blocks the whole store
`src/local/process-store.ts:59` — `Promise.all` over `load()` rejects on the first unsafe/corrupt/invalid file (`create()` writes the final name directly with `O_EXCL`, so a crash or full disk can leave a partial file). `ready` rejects and process management is unavailable.
- Repro: write a truncated `<uuid>.json` into the store, then initialize the manager.
- Fix direction: quarantine or report unreadable records and continue, or write via temp+link like `file-transaction-store.publish`. Do not silently treat a bad record as stopped.

### 4 (M) `git_add` accepts pathspec magic that can leave the workspace root
`src/core/git-plans.ts:24` — `rel()` rejects `/`, `..`, `.` segments and `\`, but not a leading `:`. `:/` and `:(top)other-dir` are Git pathspec magic.
- Repro: workspace root is a subfolder of a larger repo; `gitPlan("git_add",{paths:[":/"]})` yields `git add -- :/`, staging files outside the granted root.
- Fix direction: reuse `validateWorkspaceRelative` (rejects `:`) or add `--literal-pathspecs`. Add negative tests for `:/`, `:(top)x`, `:!x`.

### 5 (M) Git hardening is inconsistent with its own stated rule
`src/core/git-plans.ts:20-27` — the header says no inherited Git hooks may run, but: only `status` and `diff` pass `core.fsmonitor=false`; `git_commit` runs repo hooks (`pre-commit`, `commit-msg`); `git_diff`, `git_show`, `compare_commits` do not pass `--no-textconv`, so `diff.<driver>.textconv` from repo config can execute.
- Repro: repo with a `.git/hooks/pre-commit` or a textconv driver writing a marker file; run the matching plan (inside the sandbox once one exists).
- Fix direction: add `-c core.hooksPath=/dev/null`, `-c core.fsmonitor=false` to every plan and `--no-textconv`; add a test asserting the argv of every plan. This matters most when P04 enables host execution.

### 6 (M) Unified patch rejects the standard "no newline" marker
`src/core/unified-patch.ts:31` — lines starting with `\` (e.g. `\ No newline at end of file`) fail the operation check with `INVALID_PATCH`.
- Repro: `git diff` for a file whose last line has no trailing newline, apply with `applyPatch`.
- Fix direction: accept and honor the marker (it controls final newline), with tests for add/remove of the trailing newline.

### 7 (M) Over-limit output discards the real result
`src/core/durable-process.ts:114` — the output-size check throws inside the `try` around `sandbox.execute`, so the `catch` saves `UNKNOWN` with `exit_code:null` and no stdout/stderr, although the command finished.
- Repro: backend returns a receipt with `stdout` larger than `max_output_bytes` and exit code 0; the journal ends UNKNOWN with empty output.
- Fix direction: save the receipt truncated with `output_limited` honesty (state UNKNOWN is fine, losing exit code/output is not). Align `timed_out` (FAILED here, UNKNOWN in `git-engine.ts`).

### 8 (L) Stale-lock removal can steal a live in-process lock
`src/local/control-lease.ts:173` — `invalidateAfterOwnerFence` unlinks `control-lease.lock` outside the `locked()` promise chain. If a `locked()` operation in this process holds the file, the lock is removed under it.
- Repro: start `acquire()` and call `invalidateAfterOwnerFence` concurrently with a stalled operation.
- Fix direction: serialize through `this.pending`, or compare the lock's `owner_session` before unlinking. Only matters at startup, hence L.

### 9 (L) Unused duplicate lease implementation
`src/core/session-lease.ts:4` — `SingleControllerLease` is referenced only by `test/session-lease.test.ts`; `runtime-bootstrap` uses `src/local/control-lease.ts`. Two fencing implementations can drift. The Technical Proposal (P06) already proposes removing it.
- Fix direction: delete the file and its test after `grep` confirms no other use.

### 10 (M) Commands cannot run outside the workspace root
`src/core/process-manager.ts:35` — `validateProcessRequest` requires `cwd_relative==="."`. With argv-only execution there is no `cd`, so a project in a subfolder cannot run its build/test (CRITERIA §5).
- Repro: `validateProcessRequest({...cwd_relative:"app"})` throws `INVALID_PROCESS`.
- Fix direction: allow a validated relative cwd (`validateWorkspaceRelative`) once the P04 boundary exists. Do not loosen before the sandbox seam is proven; this is a design decision to confirm with the user.

### 11 (H) `glob` pattern causes catastrophic regex backtracking (ReDoS)
`src/mcp/server.ts:368` — each `*` becomes `.*` in `new RegExp("^"+escaped+"$")`. Many stars backtrack exponentially and block the single-threaded Node process, so every MCP call (including `release_control` and `stop_process`) hangs.
- **Reproduced:** in a standalone Node snippet, pattern `"*a".repeat(25)+"*b"` (52 chars, under the 160 limit) tested against `"a".repeat(60)` did not finish within 60 s (I killed it).
- Repro in-product: a directory containing a file named `aaaa…a` (60 chars), then `glob` with that pattern.
- Fix direction: replace the regex with a linear-time wildcard matcher (two-pointer `*`/`?` match), or collapse consecutive stars and cap the number of `*`. Add a test with a time bound.

### 12 (M) Revoked-grant tombstones accumulate until the grant store becomes invalid
`src/local/grants.ts:25` — `validateEntries` throws `INVALID_GRANT_STORE` for more than 128 entries, but `revokeTrusted` keeps every revoked id as a tombstone (to preserve epochs). Only re-enrolling the same id replaces it.
- Repro: enroll and revoke 129 distinct ids (batches of ≤16); then `loadTrustedRegistry()` throws, so the connector cannot start or bind any workspace.
- Fix direction: raise the limit separately for tombstones, or compact old tombstones while keeping a per-installation monotonic epoch floor so a re-enrolled id can never reuse a revision. Do not drop revision history without that floor.

### 13 (M) `fetch_file` cannot read files larger than 64 KiB
`src/mcp/server.ts:413` — `start_line`/`max_lines` imply paging, but the whole file is read with `read(path,65536)` and only then sliced, so any file over 64 KiB fails with `READ_LIMIT_EXCEEDED`. The reader supports up to 8 MiB.
- Repro: `fetch_file` with `start_line:1,max_lines:50` on a 100 KB source file.
- Fix direction: raise the cap toward the 8 MiB reader limit (response size stays bounded by `max_lines`), or add byte-range reads. Conflicts with CRITERIA §4 (read project files).

### 14 (L) stdio transport sends no response for malformed JSON
`src/mcp/server.ts:537` — `handle` parses the line before `id` is known; on `JSON.parse` failure the catch writes nothing (`id` is `undefined`). JSON-RPC requires a `-32700` Parse error with `id:null`.
- Repro: send `{"jsonrpc":"2.0",` over stdio; the client waits forever.
- Fix direction: answer with `{"jsonrpc":"2.0","id":null,"error":{"code":-32700,...}}` when parsing fails.

### 15 (L) HTTP transport lacks the concurrency and timeout limits stdio has
`src/mcp/http.ts:80` — stdio caps 32 calls and 4 urgent controls; HTTP has no cap, no body-read timeout and no request timeout. A client holding the token can stall many requests, and `stop_process`/`release_control` have no reserved capacity.
- Fix direction: set `server.requestTimeout`/`headersTimeout`, and share the `activeCalls`/`activeControls` limits with the stdio path.

### 16 (L) `search` silently skips hidden paths
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
