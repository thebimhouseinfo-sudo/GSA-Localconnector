# Track C — CI run evidence

## Pre-change observed baseline
- Branch: `plan/mac-native-ci-vm-retirement-20261105`
- Revision: `1cb77c271328bf20dd466875bda5c6575762fb90`
- Actions run: https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42033066901
- Job: `macos-preinstall`, job ID `127264098308`, conclusion SUCCESS.
- Observed executed steps: checkout, macOS host print, Node setup, npm install, build, non-VM source tests, native source capture: SUCCESS. This is a pre-change C0-like SOURCE PASS only, not native C-A/C-B or G3 acceptance.

## Track C candidate
- New commit SHA: NOT_YET_VERIFIED in this report; use GitHub run's `head_sha` and checkout log before binding acceptance.
- New Actions run/job URLs: NOT_RUN at report preparation; inspect after source commit and fill as separate evidence revision.
- C0: NOT_RUN for new candidate.
- C-A: BLOCKED pending integrated native file implementation and mandatory acceptance entrypoint.
- C-B: BLOCKED pending integrated native command implementation and mandatory acceptance entrypoint.
- C-G3: BLOCKED pending complete A/B and packaging/desktop acceptance entrypoint.
- G4 user-host install: NOT_RUN (explicitly prohibited).
- No full pre-install PASS claimed.
