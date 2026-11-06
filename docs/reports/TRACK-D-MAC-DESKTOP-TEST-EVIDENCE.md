# Track D D1 — test evidence

Date: 2026-11-05; branch: `plan/mac-native-ci-vm-retirement-20261105`. Track D source commits: `be638b334de7c5017620e574bf615a7a7b5409fa`, `29f4f43e3040ff22c7c185cf237c384e6bde983c`.

## Test cases added
- CONNECTED → DISCONNECTED → UNKNOWN → CONNECTING → CONNECTED retains exactly one child and signals no child/neighbor.
- ACTIVE retained work refuses stop with `ACTIVE_WORK_PRESENT` and leaves child and neighbor untouched.

Existing tests cover setup, secret env, owner lock, IDLE/UNKNOWN stop, crash exit, auth reject, split-chunk redaction and ownership release.

## Execution
- GitHub source read, individual source commits and blob readback: **OBSERVED**.
- `node --test test/desktop-supervisor.test.mjs`: **NOT RUN** on exact modified revision.
- `npm run build`, Swift AppKit build, package lifecycle and GitHub-hosted macOS runner: **NOT VERIFIED**. This agent has no checked-out repo or attached macOS execution surface; direct container GitHub DNS failed.
- Real Mac Dock/login, tunnel credentials, wake/restart, Pause/Resume/Quit, unrelated apps: **PENDING G4/M5**, not tested.

GitHub CI PASS cannot substitute real Mac Dock/login/tunnel acceptance. No historic source-only test is counted as current-revision PASS.

## Hosted GitHub Actions inspection (same day)
- Workflow `.github/workflows/ci.yml` uses `macos-latest`, Node 22, `npm ci --ignore-scripts`, `npm run build`, `node scripts/ci-mac-source-tests.mjs`, source capture and G3 required gates.
- Push run **42044118681** at `f6c2cea47b369654712390dffed3fb8b939c5b56`: `c0-source` observed **QUEUED** (no runner steps executed) at inspection; https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42044118681 . A corresponding pull-request run **42044126489** was also queued.
- Earlier run **42041391352** (different SHA) had completed host identification, dependencies and compile; its non-VM suite remained **IN_PROGRESS** when inspected. Not proof for D1.
- `scripts/ci-mac-source-tests.mjs` discovers only `dist/test/*.test.js`, so it does **not** invoke `test/desktop-supervisor.test.mjs`. No D1 lifecycle test execution is verified by C0.
- `scripts/ci-mac-g3-acceptance.mjs` was absent on branch at the time of reading; workflow's required G3 gate cannot be reported as passing.
- Only GitHub-hosted macOS **CI** is authorized here. A runner is a disposable hosted Mac, not the user's installed login-session Mac; real Dock/login/TCC/tunnel remain PENDING G4/M5.

## Test scope confirmation — Human decision 2026-11-05
- Current required execution environment: **GitHub-hosted macOS runner only** (`macos-latest`). Do not install or test on the user's physical Mac during this phase.
- Real-Mac Dock interaction, Login Items/background after actual login, live tunnel/API credentials, sleep/wake behavior, physical-process coexistence and installed-plugin acceptance: **pending user require**.
- **pending user require** is a deferred user-dependent acceptance item, not a hosted-CI failure and not evidence of physical Mac PASS. It must not block declaring the *hosted-only test phase* complete once all mandatory hosted checks have actually passed; it still blocks claiming real-Mac acceptance.
- Latest inspected branch SHA before this documentation revision: `9eaaaa23cc97d2147961beaaa06552e3f1ac7b75`. GitHub Actions push run [42059630490](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42059630490) was **IN_PROGRESS**; `c0-source` had successful checkout, tool setup and host identification, dependencies still in progress. PR run [42059643485](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42059643485) was **PENDING**. Do not claim CI PASS until completed exact-SHA evidence exists.

## Autonomous continuation — 2026-11-05, source-state recheck
- GitHub branch HEAD observed at `56efb0eb8c114149ab4b9310bb50d4ceafe9e9da` (concurrent Track A doc commit). A new push Actions run `42060685009` was `PENDING` with **no jobs returned** on inspection; a queued run is ENVIRONMENT/QUEUE_UNVERIFIED, not a test failure or PASS.
- Runs `42060234022` and `42060243337` for `9b6ef9e6f33069fecc776b7553e6cdeec5257708` were **CANCELLED** due to later source updates. No pass/fail can be asserted for them.
- Run `42059630490` at `9eaaaa23cc97d2147961beaaa06552e3f1ac7b75`: checkout, macOS host identification, dependency setup and `npm run build` completed successfully, but `C0 exhaustive non-VM node suites` was cancelled. Thus no C0 completion and no G3 PASS.
- A prior executed run `42046143138` at **different SHA** `c6fa97f7bad65bc3cdd00d1c26304714fecc3da1` failed build with TypeScript TS2739 at `src/mcp/runtime-bootstrap.ts(85,6)`: `NativeScopedFiles` missing `renameDirectoryExclusive` and `diffNonGitText` required by `MacScopedNativeFiles`. Those source owners are Track A / Integration, **not Track D**; do not patch their files here. This is historic evidence and not proof of current HEAD build failure.
- Current workflow `.github/workflows/ci.yml` has `cancel-in-progress: true` and no explicit step executing `node --test test/desktop-supervisor.test.mjs`; `scripts/ci-mac-source-tests.mjs` discovers compiled `dist/test/*.test.js` only. The D1 tests therefore have **no authoritative hosted execution evidence**, regardless of C0 pass.
- G3 package gate now exists at `scripts/ci-mac-g3-acceptance.mjs` and runs `scripts/test-mac-package.mjs`, but neither explicitly covers the D1 supervisor suite. Earlier report statement that G3 script is missing applies only to its earlier observed revision, not current HEAD.
- **Disposition: BLOCKED_CROSS_TRACK_CI_INTEGRATION / UNVERIFIED_HOSTED_D1**. Track D cannot modify Track C-owned workflow or shared MCP source. Required: Track C adds mandatory direct D1 Node tests with zero skip and macOS Swift/package fixture coverage, then exact-SHA green check and D1 review. Do not mark D1 PASS until that evidence exists.
- Actual physical Mac test and acceptance: **pending user require** (not a hosted CI requirement).

## FINAL TASK CLOSURE — BLOCKED (2026-11-05)

**Task:** D1 — Mac Desktop Application & Lifecycle. **Disposition:** CLOSED_BLOCKED (task work stopped and handed to integration owners; not DONE/PASS). **Source snapshot reviewed:** `2cf162650f93192eff270cc1a3ff37404ab6da73`, before writing this closure. No merge, deploy, user-Mac install or real tunnel changes.

### Exact reasons blocking D1 completion
1. **BLOCKER D-B01 — incomplete product behavior (Track D / Integration):** There is no completed Pause/Resume action; `scripts/mac-desktop-adapter.mjs` returns `UNKNOWN` from `ownedWorkState`, so safe Quit cannot stop an owned tunnel unless a reliable IDLE/ACTIVE result exists. Must not force-stop retained/unknown work or neighbor processes. Requires verified work observer and lifecycle integration.
2. **BLOCKER D-B02 — Dock behavior not implemented as approved (Track D):** `native/macos-desktop/Info.plist` uses `LSUIElement=true` and `App.swift` invokes `NSApp.setActivationPolicy(.accessory)`. This implements menu bar accessory rather than proving the requested Dock application. Requires an appropriate UI behavior fix and hosted compile, with physical visual verification deferred.
3. **BLOCKER D-B03 — missing mandatory hosted D1 test execution (Track C):** `.github/workflows/ci.yml` does not directly invoke `test/desktop-supervisor.test.mjs`; `scripts/ci-mac-source-tests.mjs` runs `dist/test/*.test.js` only. Source checks therefore cannot prove the D1 regression suite. Track C owns workflow wiring.
4. **BLOCKER D-B04 — full exact-revision CI not green (Track C / Integrator):** [run 42060878248](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42060878248) at earlier SHA `1693714afcbef10797f9645195f01dd7a804b803` completed FAILURE: C0 compiled-source test step failed; G3 prerequisite and C-A/C-B/C-G3 gates failed. [run 42060906252](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42060906252) at reviewed SHA was still IN_PROGRESS with C0 test step running on last inspection, so no PASS claim. Older TypeScript TS2739 failure at SHA `c6fa97f` belongs to shared integration, not established on current SHA. Many old runs were cancelled by concurrent commits. Investigate the exact failing test logs with appropriate owners and retest exact HEAD.

### Ownership and unblock conditions
- **Track D owner:** complete Pause/Resume, Dock behavior, and conservative owned-process lifecycle; add source-bound regressions without weakening active/unknown safety.
- **Integration owner:** provide authoritative retained-work observer and resolve cross-track shared contracts only in integrator-owned MCP paths.
- **Track C owner:** wire direct D1 tests plus Swift/native desktop packaging smoke into mandatory `macos-latest` workflow; obtain completed exact-revision jobs with zero required skips, inspect logs and evidence.
- **Resumption trigger:** owners commit verified fixes and CI coverage, then a separately coordinated D1 re-review/hosted retest passes. Closure is not a claim that work is accepted or source is complete.
- **Real Mac:** Dock/login with physical session, live tunnel/key, sleep/wake, installed-plugin check, neighbor apps: **pending user require**. This is explicitly deferred and is NOT the cause of this task's blocked status.
