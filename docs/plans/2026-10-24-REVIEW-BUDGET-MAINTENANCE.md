# Review continuation budget maintenance — 2026-10-24

Authorized by the user's explicit request to increase two rounds to five, ask after 30 minutes and never silently exit; subsequently confirmed by the replacement AGENTS.md supplied by the user. Apply this exact scope, without another confirmation.

Changes: AGENTS.md rule11; harness/policy.json maxReviewRounds5 and reviewWindowMs1800000; harness/lib.mjs budget reporting and simulated gate timestamp/continuation handling; harness/test/harness.test.mjs boundary regressions; four existing role TOMLs' round/time instruction sentences only; existing gsa-finish-task skill and WORKFLOW.md. Models, effort, roles, hook permissions, native command timeouts, push policy, approval authentication and product criteria stay unchanged.

Behavior: whichever comes first, five review/repair rounds per pair or 30 minutes of wall time including delegated work. Preserve checkpoint, report unresolved work and ask whether the user permits continuation. Wait for an explicit reply, never infer silence or auto-reset counters. The primary records/checks its conversation window at tool/agent boundaries. Simulated gate time begins at first signature and status reads never reset it. Live approval remains GUIDED_ONLY/AWAITING_USER; no background timer or automatic authorization is claimed. Command timeouts remain separate and bounded.

Tests: RED new three tests failed before implementation (missing budget function/start timestamp); GREEN required full harness suite and self-check, plus independent review. Explicit two-round simulation fixtures retain their configured policy, testing backward compatibility. Add five-round gate boundary and completion-after-time checks if review identifies missing coverage.

Rollback: snapshot e79e6b54-2499-4225-9bb6-eec5133c1af1 retains exact previous owned file bytes. Restore only hash-matching owned paths via snapshot tool; never modify live harness/state.json or unrelated WIP. No dependencies or global settings.
