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
