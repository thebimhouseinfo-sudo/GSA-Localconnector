# Track B — Native macOS Commands Implementation

## GOAL
Implement B1/B2/B3 in isolated Track B source without touching shared MCP or other Tracks.

## Source baseline and changes
- Target: `plan/mac-native-ci-vm-retirement-20261105`; initial observed HEAD `1cb77c271328bf20dd466875bda5c6575762fb90`. Concurrent Tracks may advance HEAD; final SHA must be re-read.
- `src/core/process-manager.ts`: introduce `validCommandCwd` delegating to existing `validateWorkspaceRelative(value,true)`, so `.` or strict descendant accepted. Reject traversal, absolute and malformed segments.
- `src/core/durable-process.ts`: use same helper for native process admission, preserving the existing durable journal and queued intent.
- `src/hosts/macos-host-commands.ts`: native Darwin `MacNativeCommands` implementing both existing `VerifiedNativeSandbox` and `VerifiedNativeProcessController` contracts. No VM/no new scheduler; Node spawn argv with `shell:false`; process group owner checked before any group signal; bounded SIGTERM→conditional SIGKILL; non-confirmed termination is UNKNOWN, not physical stop. Working root grant and canonical cwd rechecked at launch. Sanitized minimal environment. Bounded output, timeout, controller status/cursors. Terminal history bounded; never replay an uncertain operation.
- `test/mac-host-commands.test.ts`: direct Darwin scenarios with disposable workspaces and Git repos.

## Contract mapping
B1 native command and non-Git script: implemented in adapter, not wired to MCP until B4. B2 subcwd/cancellation: lexical and canonical checks implemented; kill only the verified live owned group. B3 Git: reuse existing `executeGit` and `gitPlan`, no automatic reset/replay. Process log and run ID: existing `DurableProcessManager` plus `ProcessJournalStore` are intended integration consumers, no separate store created.

## Safety truth
`command_confinement: none (user account)`; `state_integrity_vs_commands: not_protected`. These are host adapter public fields and required integration diagnostic values, NOT a claim of workspace-contained subprocesses. Initial cwd/root checking is admission only. The legacy `verified:true` interface does not establish OS confinement.

## Incomplete scope
- No shared MCP wiring; `src/mcp/*` exclusively belongs to Integration Agent G2.
- No hosted native-pass verified at writing time; GitHub Actions observed queued. Local installed Mac proof remains UNVERIFIED.
- Existing native process journal does not yet record an explicit per-run source/toolchain identity/artifact manifest for all routes; requires review with integration owner, not a second journal.
- Grant revocation after a spawned command requires existing workspace-stop orchestration; adapter rechecks at launch but is not independently subscribed to registry revocation.
- No automatic remote Git authentication, network operations, or OS command sandbox; intentionally blocked.
- Optional `artifact_paths` capture not implemented by this adapter; needs scoped native file API contract or explicit follow-up.

## Goal recheck
B1 PARTIAL pending exact-SHA hosted test; B2 PARTIAL pending physical-stop/neighbor negative host proof; B3 PARTIAL pending durable journal and Git execution integration proof. No CLAIM of DONE or release readiness.

## Track B closure decision — 2026-11-05

**Lifecycle: CLOSED — BLOCKED_BY_DEPENDENCY (NOT DONE, NOT PASS).** Human instructed closing the Track B work at this handoff boundary because completion depends on Track A and shared Integration/CI owners. No further Track B source edits or repeated CI attempts are authorized by this closure. Existing partial B1/B2/B3 implementation, regressions and reports remain preserved on the named development branch. This closure is administrative, not proof of acceptance.

**Dependencies for later reopening/integration:**
1. Track A and Integration owner reconcile native file interface mismatch (`NativeScopedFiles` versus `MacScopedNativeFiles` in `src/mcp/runtime-bootstrap.ts`, TS2739 observed in GitHub run 42046143138).
2. Track C/Integration restore exact-revision GitHub-hosted macOS C0 and C-B test execution, with required compiled test files and real native-process/cancellation results; blocked/missing suites must not be accepted as PASS.
3. G2 Integration owner wires Track B into shared MCP command/Git/status surfaces, preserves process journal and no-replay UNKNOWN behavior; subsequent independent review and exact-SHA CI proof remain required.
4. Actual physical Mac / installed plugin tests: **pending user require**. Not required for the current GitHub-hosted testing stage, and no claim of real-device validation.

**Handoff status:** All Track B implementation and reporting artifacts are left in place; findings and evidence are in `TRACK-B-MAC-COMMANDS-TEST-EVIDENCE.md` and `TRACK-B-MAC-COMMANDS-REVIEW.md`; integration requirements are in `TRACK-B-MAC-COMMANDS-INTEGRATION-REQUEST.md`. Main, other Tracks, MCP shared source and the user's Mac were not modified as part of this closure.
