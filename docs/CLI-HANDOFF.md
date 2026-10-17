# Codex CLI handoff — 2026-10-17

## User-authorized integration boundary

The user requested a GitHub push and merge to main, then explicitly clarified:
**do not repair or push the failing files; record them in this handoff**.
Only the previously verified baseline `19dac16`, project harness/model configuration
`bcd33c8`, and this documentation handoff are included in the integration.
The 32 pending Mac files listed below remain local, unstaged and unpublished.
Do not use `git add -A`, `git commit -a` or push them as though they were verified.

## Verification of the published source snapshot

An isolated export of committed HEAD (without local WIP files) ran
`node harness/verify.mjs` successfully:
- Harness self-check PASS.
- Harness fixtures: 29 PASS, 0 FAIL.
- Product suite: 140 tests, 137 PASS, 3 skips, 0 FAIL.
This is source verification, not a new native VM run or release certification.
GitHub CI and merge identity are to be verified separately against the exact pushed SHA.

## Local unpublished state and known failures

The local working tree still includes unfinished Mac implementation. Running npm test
against that local tree fails TypeScript build with TS18047 at
`src/hosts/macos-scoped-files.ts:26`: child.stdout, child.stderr and two child.stdin
accesses possibly null. No fix is made in this integration task.

`test/process-journal.test.ts` additionally expects sealed terminal evidence to reject
changes with PROCESS_TERMINAL_IMMUTABLE; unfinished `src/local/process-store.ts` does
not yet implement that guard. The current compiler failure stops the normal suite
before that test. Do not weaken or remove the test to obtain a green run.

Recovery snapshot of all 32 local pending files:
`79182898-020b-4688-bdae-a2efd874b65d` under ignored `harness/snapshots/`.
Original hashes are in ignored `.gsa/local-state/bootstrap/unpublished-mac-files.json`.
Those local backups are not on GitHub. Do not delete/reset/clean the working tree.

### Unpublished files (not part of main/PR)

- `docs/superpowers/plans/2026-10-17-macos-completion.md`
- `native/macos-files/broker.swift`
- `native/macos-files/test-broker.py`
- `native/macos-vm/WorkerHost.swift`
- `native/macos-vm/guest_worker.py`
- `scripts/install-native-vm.mjs`
- `scripts/mac-package.mjs`
- `scripts/macos-owner-launcher.py`
- `scripts/test-mac-package.mjs`
- `scripts/test-vm-guest-worker.py`
- `scripts/test-vm-worker-native.py`
- `src/core/ci-dag.ts`
- `src/core/ci-manifest.ts`
- `src/core/durable-process.ts`
- `src/core/native-io.ts`
- `src/core/process-journal.ts`
- `src/hosts/macos-scoped-files.ts`
- `src/hosts/macos-vm-ci.ts`
- `src/hosts/macos-vm-runtime.ts`
- `src/local/ci-store.ts`
- `src/local/control-lease.ts`
- `src/local/mac-owner.ts`
- `src/local/process-store.ts`
- `src/mcp/cli.ts`
- `src/mcp/http-cli.ts`
- `src/mcp/http.ts`
- `src/mcp/runtime-bootstrap.ts`
- `src/mcp/server.ts`
- `test/mac-owner.test.ts`
- `test/macos-vm-artifacts.test.ts`
- `test/macos-vm-ci.test.ts`
- `test/process-journal.test.ts`

## Continuation context for CLI

This is a checkpoint, not authorization to restart product development immediately.
First report local dirty status and read this handoff plus existing approved plans.
Ask for the next concrete product task if the user has not assigned it. The latest
user instruction for this integration explicitly leaves the failing files untouched.

Mac completion work remains:
- Finish ownership/restart and process journal integration. The local process journal
  implementation is incomplete and not yet connected as a production persistence path.
- Complete native artifact transfer and refresh the installed proof only after actual
  native tests. Local guest/runtime modifications are unpublished and not release-ready.
- Scoped native file broker is unfinished/unwired. Destructive compare-and-mutate
  operations deliberately remain blocked; no safe host Git capability has been certified.
- Packaging/LaunchAgent work is unpublished and must be integrated/tested before activation.
- Recheck local transport/live plugin, cancellation/revocation/restart, and enabled host
  operations end-to-end. Do not claim a live plugin PASS from an old or terminated session.

Published baseline already has offline native worker/MCP evidence in
`docs/reviews/2026-10-17-NATIVE-WORKER-INTEGRATION.md`. Preserve both original RAW and
fallback candidate disks; never reconvert or mutate them simply to continue the task.
Historical checkpoint entries can retain older pending states; distinguish their dates.
Windows work and production release remain outside the completed Mac baseline claims.

## Working environment

CLI 0.163.0 is installed. Start from this project with
`codex -C /Users/nam/GSA-Localconnector`.
Current role/model settings: `.codex/config.toml`, `.codex/agents/*.toml`,
`harness/roles.json`; see `docs/bootstrap/AGENT_ASSIGNMENT.md`.
Main/Planner/Coder Sol 6.1 medium; Tester Luna medium; Reviewer Sol 6.1 high;
Critic Astra low at approved larger/high-risk triggers. Maximum two subagents.

Harness milestone remains NOT_CONFIGURED, review coordination GUIDED_ONLY, and no
trusted human gate-approval adapter is installed. Do not fabricate milestone approval.
Ignore local credentials/tunnel/media/cache/state. Publishing this checkpoint does not
publish those files and does not make the local unfinished Mac tree a passing build.
