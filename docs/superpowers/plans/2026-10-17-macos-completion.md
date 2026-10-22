# macOS completion

## Current requirement alignment — 2026-10-17

This continuation plan must satisfy [CRITERIA.md](../../CRITERIA.md): working workspace read/write/execute without connector gates; optional read-only design/knowledge roots; no reference mutation/execution or ungranted data access, including from nested jobs. Native proof tests the boundary, not a separate user unlock. Include positive reference reads and negative reference write/delete/execute tests.

The source/ledger below remains WIP history. Its prior execution authorizations are not new instructions to run probes or implement code during this documentation task.

Authority: the unified implementation plan plus the user's instruction to finish macOS first. Windows implementation is deferred. Starting checkpoint: `19dac16`, with native offline VM/MCP evidence already passing.

Intent: deliver a usable Mac local connector with truthful capabilities, durable state, scoped host operations, CI artifacts, repairable startup and verified local/plugin operation. Preserve existing disk images, workspaces and neighboring applications. Never widen host execution merely to make a capability available.

## Ordered work

1. **Host confinement feasibility.** Probe Apple's signed App Sandbox on disposable fixtures: allowed root reads/writes, forbidden private and world-readable siblings, symlinks, nested commands and network. Inspect entitlements and compare file hashes. A failure keeps host shell/Git blocked; a fixed-operation filesystem broker still needs its own containment proof. No production switch based on compilation alone.
2. **Server ownership and recovery.** Introduce a kernel-owned installation lock before journal reconciliation; reject concurrent owners, release on crash, and never guess stale ownership from a PID alone. Persist process identities/status/output and reconcile interrupted records to UNKNOWN after the old owner is fenced. Test real child-server crash/restart and two concurrent owners.
3. **Artifact transfer.** Export explicitly declared bounded generated files through the authenticated guest channel. Validate relative paths, symlinks/type/size/hash, source/workflow/run identity and total quota; ingest only from verified clean-stop receipts. Prove positive binary artifacts plus traversal/forged/over-cap rejection with actual guest execution.
4. **Host file/Git implementation.** Install only an independently tested native boundary. Use root identity/revision and controller checks at every operation; preserve hash conflicts, unrelated changes and recoverable deletion. Disable network and implicit hooks/filters unless separately supported. If the OS mechanism fails, document the precise blocker and continue other Mac tasks.
5. **Mac packaging/startup.** Provide install/upgrade/repair/doctor/uninstall for the connector's own LaunchAgent and private runtime. Use fixed executable paths, plist-safe arguments and private logs; verify with plutil/launchctl. Never alter other applications or the Windows installation.
6. **Transport and release E2E.** Inspect the existing Mac tunnel without exposing credentials, verify local stdio/HTTP and live plugin when reachable, and exercise restart, revocation, CI logs/artifacts and file/Git behavior actually enabled. Missing external authentication is a concrete external blocker, never a fabricated PASS.

Each task uses reproducing tests before implementation and a native test for every native capability claim. Run the full source suite after changes, one independent review at the end, then record exact remaining blockers. No shared-branch push or public release is implied.

## Execution ledger

- Ruling: reuse the user's existing checkout on `codex/mac-completion` and checkpoint the previous verified changes at `19dac16` — preserves all preceding work and the user's untracked `.continue`, `bin` and lockfile without copying them into an unrelated checkout; cost if wrong is needing a later checkout move, not losing user files.
- Ruling: existing plan and repeated continuation instructions authorize native feasibility tests and implementation within this scope — no additional design-approval interruption; cost if a mechanism fails is keeping that capability blocked and using the measured result to choose the next safe implementation.
- Task 1: in progress. Apple documents temporary path exceptions and child sandbox inheritance, but also permits some POSIX world-readable locations; fixtures must test those rather than assume full root confinement.
