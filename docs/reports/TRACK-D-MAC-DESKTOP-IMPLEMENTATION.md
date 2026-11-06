# Track D D1 — Mac desktop implementation

Date: 2026-11-05. Branch: `plan/mac-native-ci-vm-retirement-20261105`.

## GOAL
Prepare Mac desktop lifecycle on the existing native app without changing user Mac, secret, login state, live tunnel or neighboring applications.

## Authority and source
Read APPROVED `docs/CRITERIA.md`, `docs/DECISIONS.md`, V3 Implementation Plan, Milestones and Technical Proposal. Examined `native/macos-desktop/{App.swift,Info.plist,test-lifecycle.py}`, `scripts/{desktop-supervisor,desktop-config,mac-desktop-adapter,desktop-install,desktop-release}.mjs`, `test/desktop-supervisor.test.mjs` and `.gitignore`.

## Changes
- `be638b334de7c5017620e574bf615a7a7b5409fa`: two new supervisor regression tests for connection loss/reconnect without duplicate child and ACTIVE-work refusing stop.
- `29f4f43e3040ff22c7c185cf237c384e6bde983c`: Quit menu signals retained supervisor only, waits for physical supervisor exit and avoids killing other processes; ACTIVE/UNKNOWN retained work still causes safe refusal.
- Existing app has accessory menu bar, private credential config, launch agent and tunnel child supervision. These features are inspected but are NOT freshly host-verified.

## Incomplete
Pause/Resume is not implemented end-to-end; `ownedWorkState` returns UNKNOWN. App uses `LSUIElement=true` and accessory activation, so requested Dock presence is unresolved. Crash/restart/wake and packaging/local tunnel require further validation. See review/integration requests.

## Test scope confirmation — Human decision 2026-11-05
- Current required execution environment: **GitHub-hosted macOS runner only** (`macos-latest`). Do not install or test on the user's physical Mac during this phase.
- Real-Mac Dock interaction, Login Items/background after actual login, live tunnel/API credentials, sleep/wake behavior, physical-process coexistence and installed-plugin acceptance: **pending user require**.
- **pending user require** is a deferred user-dependent acceptance item, not a hosted-CI failure and not evidence of physical Mac PASS. It must not block declaring the *hosted-only test phase* complete once all mandatory hosted checks have actually passed; it still blocks claiming real-Mac acceptance.
- Latest inspected branch SHA before this documentation revision: `9eaaaa23cc97d2147961beaaa06552e3f1ac7b75`. GitHub Actions push run [42059630490](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42059630490) was **IN_PROGRESS**; `c0-source` had successful checkout, tool setup and host identification, dependencies still in progress. PR run [42059643485](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42059643485) was **PENDING**. Do not claim CI PASS until completed exact-SHA evidence exists.

## Continuation state (2026-11-05)
Autonomous GitHub-run review found D1 hosted test coverage is not wired into the Track C-owned workflow. Running/cancelled old CI does not demonstrate D1 test success. The current D1 remains **BLOCKED on Track C/integration + OPEN functional findings**; no real Mac action is requested. Physical Mac validation is **pending user require**.

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
