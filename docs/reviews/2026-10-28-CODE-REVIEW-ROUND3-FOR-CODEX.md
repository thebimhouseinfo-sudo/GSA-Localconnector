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
