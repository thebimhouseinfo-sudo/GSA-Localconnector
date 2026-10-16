# Cross-platform plan review — Windows + macOS

Date: 2026-10-16
Plan blob: `1886a749703880664af34da978e932ae47ee3746`
Status: **PLAN PASS WITH IMPLEMENTATION GATES** (document review, not runtime PASS).

## Review findings and resolutions
1. CRITICAL: earlier baseline prescribed standalone Windows runtime. Superseded by Section 13: common MCP API and host-specific Windows/macOS adapters; two native build/test/security gates.
2. CRITICAL: shell confinement cannot be asserted on macOS merely through cwd, POSIX ownership, or deprecated sandbox tools. PX-05 requires concrete OS-enforced denial of forbidden reads/writes, including subprocesses; otherwise SECURITY_BLOCKED.
3. IMPORTANT: Windows Scheduled Task has no macOS equivalent. Added launchd LaunchAgent with independent crash restart, logon, sleep/wake and uninstall checks.
4. IMPORTANT: workflows cannot silently use Windows shell syntax on Mac. Explicit shell and runs_on; identical CI result schema on both systems.
5. IMPORTANT: macOS TCC, APFS symlinks/case behavior, Apple Silicon vs Intel, installer/security/signing decisions need native evidence.

## Round 2 verification
Re-fetched the plan from GitHub at the blob above. Confirmed the OS adapters, ten XP acceptance tests, PX-01–PX-08 tickets and cross-platform security hard gates are included. No implementation, release or native testing has happened yet.

## Next action
Execute PX-01 host-adapter design and early PX-04/PX-05 isolation feasibility spikes. Build a shared MCP contract conformance suite. Only mark platform-specific production readiness after actual native host evidence.
