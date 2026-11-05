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
