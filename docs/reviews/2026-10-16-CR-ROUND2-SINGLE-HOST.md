# Independent CR — Round 2: Single-host cross-platform architecture

Date: 2026-10-16
Target: `docs/plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md`
Reviewed blob SHA: `cba0f75e7661fd69c706e5e7406b31357778d1a9`
Prior CR: `docs/reviews/2026-10-16-CR-ARCHITECTURE.md`
Planner RL: `docs/reviews/2026-10-16-PLANNER-RL-SINGLE-HOST.md`
**Independent verdict: CHANGES REQUIRED** — design-document assessment; not native runtime tests or formal GSA Job CR verification.

## Independent findings

1. **IMPORTANT / CR2-01 — The base plan remains internally contradictory.** Section 1.5 says "Windows connector"; 1.6 discusses "Worker Windows user's OS privileges" and a path-only boundary; 1.9 defaults to Windows Recycle Bin. Earlier P1/P6, source inventory and table of tickets remain Windows-specific. Sections 13/14 say these are superseded, but implementation agents reading earlier sections could implement the obsolete design. Consolidate into a single authoritative platform-neutral specification; move legacy text to history. Mac trash semantics need an explicit API policy.

2. **IMPORTANT / CR2-02 — Single-host/single-user does not resolve authentication design by itself.** Even one connected host needs authenticated remote MCP transport, session lease expiry/revocation, safe startup with no token leak, and protection against a second connection claiming the same active session. The Section 14 lease is conceptual; document concrete state machine, session renewal/replacement semantics, one-connection criterion and failure tests. No multi-host router is required.

3. **IMPORTANT / CR2-03 — Source snapshot vs build writable tree still underspecified.** A read-only snapshot is not directly executable by build systems that write generated files in source directories. Select an actionable input copy + writable overlay strategy, identify the exact evaluated tree, and prohibit CI PASS if source/evidence mapping or dependencies are unverified. Define handling of symlinks and local absolute paths embedded in build systems.

4. **IMPORTANT / CR2-04 — Containment policy for legitimate build tools is an implementation blocker requiring an explicit policy.** There is no authoritative list/model for toolchain read paths, caches, network fetching, shell environment, tmp, subprocess ACL inheritance. Add a concrete platform-specific capability policy manifest and negative/positive fixtures. macOS isolation remains a feasibility hard gate, not a validated solution.

5. **MINOR / CR2-05 — Review labels overclaim closure.** Planner report labels CR-01 "resolved", but the Windows-only clauses still exist in operative text. Classify supersession as interim and do not promote architecture to unqualified PASS until consolidated.

## Prior CR comparison after independent verdict
- CR-01: PARTIAL; changed GOAL and phase appendix, but operative historical sections remain.
- CR-02: security risk acknowledged and gated; implementation proof remains pending (not falsely called runtime PASS).
- CR-03: principle resolved, detailed ACL/read-write authority graph outstanding.
- CR-04: multi-host aspect intentionally removed by user; single-session security still requires contract.
- CR-05: snapshot concept improved but needs a realizable build approach.
- CR-06: macOS login session/sleep limitations appropriately documented.

## Required Planner edits
1. Replace sections 1/5/6/12 conflicting Windows-only language and acceptance text with one cross-platform baseline; clearly specify Windows Recycle Bin and macOS Trash semantics.
2. Define one-host/one-session lease and transport trust protocol including expiry, takeover, reconnect and revocation tests, with no fleet logic.
3. Define CI isolated materialization strategy: immutable source inputs + writable build overlay/copy; evidence hash and dependency provenance.
4. Add platform capability policy schema (toolchain, cache, temp, network, child process) and discrete OS-isolation feasibility validation before shell/CI release.
5. Run Planner RL on exact new blob SHA; CR can be requested again after revision.

**Status:** No code, Windows, macOS or CI security tests were run as part of this review.
