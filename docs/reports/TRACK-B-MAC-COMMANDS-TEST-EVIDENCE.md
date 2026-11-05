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

## Continuation — 2026-11-05 macOS runner feedback

- GitHub Actions run [42041118773](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42041118773), job 127291868453, commit `c5490cb15920b55827f08928438ab331bfb50981`: C0 compile SUCCESS; native-safe node test phase FAILED in the Darwin subcwd assertion. Actual cwd was `/private/var/folders/...`, while the test expected `/var/folders/...`. These are the same canonical macOS location. This was a test assertion mismatch, not evidence of a CWD security escape. The test was repaired in commit `2369d24630d02acb7280df15ac3b15671fb56f25` by comparing canonical paths.
- Follow-up source repairs: cancellation now only acknowledges confirmed child close AND absent owned process group; synchronous receipt reports a null exit when physical group-stop proof is missing, preventing false Git success. Added explicit non-Git shell, minimal environment, timeout and cancellation fixtures.
- New HEAD GitHub Actions results were still QUEUED at inspection. The above older failing run is NOT proof that the repaired SHA passes. Exact-revision Darwin C0/C-B execution, journal/restart and installed plugin tests are still UNVERIFIED.

## CI inspection follow-up — 2026-11-05

Checked HEAD `f6c2cea47b369654712390dffed3fb8b939c5b56` and workflow runs 42044126489 / 42044118681: both QUEUED, zero executed steps at observation. Older runs 42041391352 and 42041292987 had C0 compile SUCCESS, test stage IN_PROGRESS with no final conclusion. A live in-progress job-log request returned GitHub 404 (log object not yet available); this is not evidence of a source failure.

Review of the command adapter found a possible indefinite caller wait after termination timeout when native child never emits `close`. Commit `77e13830fd88f7cb6f95212c30b5dd6396ee2221` bounds the synchronous caller observation to requested time limit plus 6 seconds. Without confirmed close and physical group-stop proof the receipt exposes `exit_code:null` and maps through existing Git logic to GIT_UNKNOWN. No command replay is introduced. Real Darwin retest for this fix is still PENDING; do not assert PASS from source inspection.
