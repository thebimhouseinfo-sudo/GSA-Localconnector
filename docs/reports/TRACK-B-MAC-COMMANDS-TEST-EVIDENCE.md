# Track B — Test Evidence

## GOAL
Distinguish committed test oracles, actual native execution, and missing evidence.

## Verified source facts
Read from nominated GitHub branch. Test file: `test/mac-host-commands.test.ts`; expected scenarios:
1. Actual Darwin subprocess with root/subdirectory working cwd; stdout/stderr and exit code.
2. Negative cwd traversal, absolute, redundant path and symlink escape; reference role and revoked workspace.
3. Nonzero and output cap.
4. Owned process group stop and unrelated neighbor remains running.
5. Disposable local Git init/status of dirty untracked file, preserving content.
6. Timeout bounded and not falsely SUCCEEDED.
7. Controller output cursors/identity negative.

The code imports and uses existing `WorkspaceRegistry`, `executeGit` and no new process journal. Existing tests: `test/process-manager.test.ts`, `test/durable-process.test.ts`, `test/process-journal.test.ts`, `test/git-engine.test.ts`, `test/git-plans.test.ts`, `test/review-process-store.test.ts`.

## Execution evidence at report creation
GitHub Actions job `macos-preinstall` is configured in `.github/workflows/ci.yml` using `runs-on:macos-latest`, Node 22, build and all non-VM tests. A run for the Track B commits was observed QUEUED, not executed. No runner steps or exit code existed in that observation. CI outcome: ENVIRONMENT_PENDING / UNVERIFIED (NOT PASS, NOT SOURCE_FAILURE). No direct real Darwin or user-installed plugin test was executed by this Direct Agent.

## Required independent evidence for acceptance
A finished GitHub-hosted macOS run at exact integrated SHA must show `npm ci --ignore-scripts`, `npm run build`, mandated non-VM suite, exact Track B fixture assertions (no skipped mandatory tests), run logs and captured host identity. For G2 require integration test with real MCP call, process journal readback, startup/restart owner reconciliation, UNKNOWN/no replay, network/secret negative, and per-workspace independent logs. Do not substitute this source inspection for physical owned-process-stop proof.
