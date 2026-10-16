# Independent Critic Review — Round 3 (Unified Plan)

Date: 2026-10-16
Target: `docs/plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md`
Reviewed blob SHA: `39576efbf61d7480963e3f92bd5702d308569771`
Independent result: **PASS WITH FINDINGS** — architecture planning acceptance, NOT implementation/security/native CI PASS.

## Prior-round disposition (evaluated against target source, not Planner's PASS claim)
- CR2-01 CLOSED: base Windows-only contradictions removed; one unified cross-platform source of truth. Recoverable deletion specifies Windows Recycle Bin and macOS Trash.
- CR2-02 CLOSED AT CONTRACT LEVEL: single-host one-session lease, authenticated transport, renewal/revocation and SESSION_BUSY are specified. Implementation mechanism remains a required native test.
- CR2-03 CLOSED AT CONTRACT LEVEL: immutable reference materialization separated from writable per-run working copy with SOURCE_UNVERIFIED fallback.
- CR2-04 CLOSED AT CONTRACT LEVEL: trusted OS-specific capability manifest covers toolchains, cache/temp, network and descendants, plus an explicit fail-closed sandbox feasibility gate.
- CR2-05 CLOSED: Planner outcomes and runtime evidence are clearly distinguished.

## New non-blocking implementation findings
1. **IMPORTANT / CR3-01 — CI policy input/outputs need executable schema and containment tests.** Section 7 provides an architecture but not exact manifest grammar, source include/exclude precedence, cache key inputs or allowed in-tree writes. P4A-01 must deliver a normative schema and fixture matrix before CI is enabled; otherwise SOURCE_UNVERIFIED could conceal test coverage gaps.
2. **IMPORTANT / CR3-02 — Session lease recovery must be concretely specified in tests.** Define atomic acquisition, signed/opaque token binding, time source and expiry policy, behavior on sudden host restart or dropped tunnel, and whether a process started under revoked grants is cancelled. P1/P2 must demonstrate replay, competing session, stale grant and crash recovery negatives.
3. **IMPORTANT / CR3-03 — Sandbox compatibility may block normal coding.** Isolated writable build copies will interact with package managers and toolchains that use user profiles, shared caches, signing keys or absolute paths. P0/PX-04/05 must establish verified capability allowlists and positive Node/Python and locally available compiled-toolchain fixtures; failure is SECURITY_BLOCKED, not a relaxed shell.
4. **MINOR / CR3-04 — One active control session is not one active tool invocation.** Document that bounded concurrent MCP calls and multiple Workspaces remain permitted within the leased session, with per-request cwd/scope and cancellation IDs. Existing Section 2 implies this correctly; add explicit concurrency acceptance to API01.

## Independent determination
The requested design scope is internally consistent and adequately gated. These findings can be closed within P0/P1/P4A and do not justify another wholesale plan rewrite or holding architecture readiness. However any native OS isolation failure blocks the corresponding shell/CI release and cross-platform release PASS. `PASS WITH FINDINGS` is for the **architecture document only**.

## GSA governance limitation
No GSA Job record is registered under the project's Memory Repo in this review. Therefore formal GSA `start_critic_review` / `critic_review_record` (requiring a durable Job ID, record and SHA) cannot be invoked without creating unrelated Job state. This report is a repository-level independent CR, not a GSA Verification record.

Next: P0-01 source pins/contract specs; PX-01 portable HostAdapter; early PX-04/PX-05 native isolation feasibility, then CI/workspace implementation with revision-bound tests.
