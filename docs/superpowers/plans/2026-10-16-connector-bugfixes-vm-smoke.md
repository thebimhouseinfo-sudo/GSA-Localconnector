# Connector bug fixes and VM smoke plan

Goal: fix the seven reviewed defects on b071308 and run the authorized fallback VM experiment.
Approach: preserve native capability gates and the baseline RAW; add regression tests, implement fixes, run full verification, then prepare and boot the independent candidate.

- [x] Add failing regression tests for source write permission, zero-context patch insertion, HTTP persisted grants, log/output cursors, process quota recovery and valid snapshot paths. Reproduce existing stdio test failure.
- [x] Fix write-dispatch.ts and unified-patch.ts; preserve hash/conflict checks.
- [x] Load trusted grants at HTTP startup and isolate stdio tests using temporary OS home/application directories.
- [x] Add optional bounded cursor/limit fields to MCP schemas and dispatch without weakening ownership checks.
- [x] Reclaim completed native process slots; reserve in-flight starts so concurrent calls cannot exceed capacity. Keep historical output accessible.
- [x] Use the shared workspace path validator for snapshot verification; retain integrity failure reporting.
- [x] Run npm test, Python EFI regression tests, bash syntax checks and git diff --check.
- [x] Prepare the CoW fallback candidate, compile/sign the VM probe, boot with read-only disk, observe guest display, and record actual outcome without claiming SEC01.

Review focus: concurrent starts, failed starts, cross-workspace access, invalid cursor/limit, path traversal, empty-file patches and preservation of baseline disk hash.
Execution: inline in the existing checkout, as authorized by the user; no push or production capability activation.

Outcome: see docs/reviews/2026-10-16-BUGFIX-VM-SMOKE.md. The additional AppKit event-pump correction was verified with the final repository wrapper, guest Enter input and clean native stop.
