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
