# Independent Critic Review — GSA-Localconnector Architecture

Date: 2026-10-16
Target: docs/plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md
Reviewed target blob SHA: 1886a749703880664af34da978e932ae47ee3746
Verdict: **CHANGES REQUIRED** (independent document assessment, not a formal GSA Job CR verification).

## Findings

### CR-01 — IMPORTANT — Cross-platform requirements contradict base plan
The document's GOAL still states "standalone Windows Local MCP Connector"; Phase 1/6 and original acceptance gates are Windows-oriented. Section 13 supersedes them, but developers may reasonably implement P1 as Windows-only and postpone macOS until a later phase.
**Fix:** rewrite main GOAL, scope, phase definitions and acceptance matrix as first-class Windows/macOS; consolidate instead of relying on an overriding appendix.

### CR-02 — CRITICAL — Mac OS process isolation feasibility is unresolved
The proposed dedicated OS user/ACL or virtualization boundary does not establish that arbitrary toolchains can operate with required macOS TCC, code-signing, process spawning, shared cache and system paths while forbidding sibling paths. No selected enforceable mechanism and no proof-of-concept result exist.
**Fix:** platform threat model + adversarial native proof-of-concept must precede implementing broad shell/CI; maintain BLOCKED state if impossible.

### CR-03 — IMPORTANT — Per-workspace security versus CI runner snapshots lacks a concrete trust boundary
CI snapshots, caches, output artifacts and runner-owned state outside the workspace are described, but access by sandboxed commands to these paths and the sensitive host registry is not specified as a least-privilege mount/ACL graph. This risks unauthorized writes or evidence tampering.
**Fix:** define host-side privilege matrix and immutable evidence writer separate from untrusted step executor; test forbidden access both ways.

### CR-04 — IMPORTANT — Remote MCP connectivity and host identity need explicit trust/selection
Multiple Windows/macOS hosts can register identical workspace_id labels. Host identity, target binding, authentication, revoked sessions and reconnect to the correct host need an exact protocol and collision behavior. Source Project identity alone cannot be trusted to select a host.
**Fix:** stable cryptographic host identity, explicit host+workspace binding, authenticated transport and replay/revocation tests.

### CR-05 — IMPORTANT — CI evidence and non-Git source snapshots need actionable consistency semantics
A workflow may update source files; the current plan says detect drift but does not commit to exact snapshot execution versus live tree. Merely hashing source before launch does not mean CI executed those bytes.
**Fix:** run against immutable verified input snapshot or refuse revision-bound PASS when live source drift or unresolved dependency inputs exist; define dependency/environment provenance.

### CR-06 — IMPORTANT — Startup design does not yet define macOS unattended operation limitations
LaunchAgent requires a logged-in user session; sleep suspends execution and TCC can block paths. Headless boot-before-login and continuous operation through Mac sleep are not equivalent to Windows background service behavior.
**Fix:** define supported session model, wake recovery, status machine and explicit non-goals for sleep continuity and pre-login operation.

## Review conclusion

Do not mark architecture CR PASS yet. The direction of design is reasonable and the cross-platform appendix is valuable, but the primary plan requires a consolidated platform-neutral rewrite plus early isolation feasibility evidence. This verdict is based on reviewed repo content only; no native security, autostart or CI implementation tests were executed.

## Process note
The GSA `start_critic_review` contract requires an existing durable GSA Job record/id. This project currently contains only PROJECT.md in GSA Memory Repo. Therefore this file is a repository-level independent CR report, **not** a fabricated GSA CRITIC_REVIEW verification.
