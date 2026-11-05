# Track C — CI run evidence

## Pre-change observed baseline
- Branch: `plan/mac-native-ci-vm-retirement-20261105`
- Revision: `1cb77c271328bf20dd466875bda5c6575762fb90`
- Actions run: https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42033066901
- Job: `macos-preinstall`, job ID `127264098308`, conclusion SUCCESS.
- Observed executed steps: checkout, macOS host print, Node setup, npm install, build, non-VM source tests, native source capture: SUCCESS. This is a pre-change C0-like SOURCE PASS only, not native C-A/C-B or G3 acceptance.

## Track C candidate
- First Track C commit SHA: `3c6f588170ac28410d5a886bc1953aee9cd348bc` (readback verified); this evidence amendment produces a newer SHA that must be checked independently.
- Observed Actions runs for first Track C commit (both QUEUED when checked, no executed job/step proof yet): push https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42040452644 ; PR https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42040463076 . Results must be independently checked once jobs execute.
- C0: NOT_RUN for new candidate.
- C-A: BLOCKED pending integrated native file implementation and mandatory acceptance entrypoint.
- C-B: BLOCKED pending integrated native command implementation and mandatory acceptance entrypoint.
- C-G3: BLOCKED pending complete A/B and packaging/desktop acceptance entrypoint.
- G4 user-host install: NOT_RUN (explicitly prohibited).
- No full pre-install PASS claimed.

## Track C continuation — 2026-11-05

Track C author commits:
- `56718d17df69a06391be3912ec09b760b0b0a354`: distinguish historical conditional C0 SKIP from true source test failures. Exact SHA hosted run `42044377994` was QUEUED on inspection, so outcome NOT_RUN.
- `a414d5598d116d971774d0dcdeef1063a5a40309`: ensure G3 macOS job prepares Node22 dependencies and compiles exact checkout; run `42044533741` QUEUED.
- `75c0f839971240ee40d6b42c30fa5265ecfeb019`: strict C-B Darwin subprocess/Git/process-journal runner; run `42044615434` QUEUED.
- `990cee7c5fc64696abf1c6860f52021aa475d832`: C-A real signed broker and scoped file test harness, still fail-closed until interrupted native transaction/physical helper-stop proof; run `42044823437` QUEUED.

Observed initial failed CI https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42040452644 :
C0 build and host identity PASS; C0 tests exit status 0 but 617 total / 600 pass / 17 conditional SKIP (legacy recovery qualification), strict old wrapper marked FAIL; G3 A/B/packaging missing acceptance entrypoints FAIL. The source-test skip handling was revised; re-run result is NOT_RUN until GitHub executes it.

Current pending acceptance:
- C0: hosted verification of revised SHA NOT_RUN (runner queued at last observation).
- C-A: signed broker and file source suites provisioned, production integrated interruption/owned-helper-stop proof BLOCKED.
- C-B: strict actual Darwin host command/Git/process runner provisioned, hosted result NOT_RUN.
- C-G3: full candidate manifest/signature/desktop startup-shutdown acceptance entrypoint remains BLOCKED; fail-closed.
- Native installed selected plugin: NOT_RUN (outside hosted CI, requires G3 and separate authorization).
No exact combined C0+C-A+C-B+packaging same-SHA PASS exists. Do not install, merge or deploy on this evidence.

## Hosted-only acceptance scope clarification (Human 2026-11-05)

- **macOS VM / GitHub-hosted runner tests:** required now. Use actual `macos-latest` ARM64 native runner. No acceptance may claim PASS from QUEUED or CANCELLED jobs.
- **Physical user Mac tests:** **pending user require**. Not a CI-phase blocker; do not install/start a real user Mac or claim such tests were done.
- **PR/push exact SHA:** Track C workflow now checkout `github.event.pull_request.head.sha || github.sha` and verifies `SOURCE_SHA`, records original `GITHUB_SHA`. Branch-wise concurrency distinguishes PR and push so neither cross-cancels solely by event type.
- **Latest observed historical failure:** PR run 42046143138 (source c6fa97f7bad65bc3cdd00d1c26304714fecc3da1) TypeScript build failure at `src/mcp/runtime-bootstrap.ts:85`: `NativeScopedFiles` missing `renameDirectoryExclusive`, `diffNonGitText` required by `MacScopedNativeFiles`. Source ownership with integrator; do not hide via CI `continue-on-error`.
- **Hosted run updates:** `42059630490` started C0 compiled source tests (later CANCELLED by newer branch pushes, not PASS). At the time of this read, exact SHA `8fe5ad963f67609d6668392e9146c8db80cbba02` had runs `42059926025` (push PENDING) and `42059936358` (PR PENDING). Complete C0/C-A/C-B/C-G3 statuses **UNVERIFIED**.
- **CI integration code commits:** `375057fa5b28f7b79d604c971ba66c15a0e02d36` source SHA checkout and event-separated concurrency; `8b04457eb6d9fe2f67fd98f854fc600f3e51adc5` G3 SHA env; `8fe5ad963f67609d6668392e9146c8db80cbba02` G3 SHA source check.
No release/merge/deploy authorized.
