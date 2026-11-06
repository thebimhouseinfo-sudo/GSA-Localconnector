# Track E1 — Independent Documentation Review

## GOAL
Review E1 inventory, dependency evidence and E2 retirement design at the pinned source snapshot without executing E2.

## Exact evidence
Source baseline: `1cb77c271328bf20dd466875bda5c6575762fb90`. Original report blob SHA: inventory `f8c8d711cf81ea93c44687a6dd762a93ac18058e`; map `a2f9dd880274504d1c25d1d0db463776c27be5fd`; proposal `509348489bae57c05324b86a7f54c4134d0f168d`. Reviewer role separately admitted by `start_direct_agent(role=reviewer)` and `get_agent_harness(role=reviewer, mode=DIRECT_AGENT)`. Reviewer only inspected; Planner owns this documentation change. These observations are not GSA Job Verification.

Authority: `docs/CRITERIA.md`, `docs/DECISIONS.md` (Nov 5 supersession), `docs/IMPLEMENTATION_PLAN.md`, `docs/MILESTONES.md`, `docs/TECHNICAL_PROPOSAL.md`, and P0 audit.

## Evidence-backed assessment
- **PASS:** live VM imports in `src/mcp/runtime-bootstrap.ts:6,8,94,96-97`, CLI `src/mcp/cli.ts:4,14`, Linux status semantics in `src/mcp/server.ts:191-192` and `src/mcp/catalog.ts:44` are mapped.
- **PASS:** installer direct dependencies `scripts/install-native-vm.mjs:60-76`, host/guest workers and VM tests are inventoried.
- **PASS:** non-VM CI capture test `scripts/test-native-source-capture.py:20` still uses `native/macos-vm/SourceCapture.swift`; migration precedes deletion.
- **PASS:** shared `src/core/ci-*`, `src/local/ci-*` and native process interfaces have explicit per-module decision, not wildcard removal.
- **PASS:** proposal requires G4 actual installed native Mac evidence, C-G3/C-VM on exact SHA, no modification to user images/media, reversible E2 PR, preservation of historical docs.
- **PASS:** E1 changes are document-only. No VM executed, installed, removed or repaired.

## Concurrent branch control and limitations
Comparison of baseline `1cb77c2` to former E1 HEAD `d0e9afb` showed 14 commits, including unrelated concurrent Track B/C/D source/CI edits; these are **not E1 mutations**. A review-record write initially returned 409 because remote HEAD advanced; this was investigated and fresh remote branch HEAD/file blob re-read before retry. E1 snapshot is intentionally pinned: it is *not* a post-integration full-graph certification. Targeted source references establish actual edges, but no AST-complete static/dynamic import closure has yet been run.

## Findings
No unresolved actionable **E1 documentation** finding in the pinned baseline. Deferred E2 gates (not E1 failures): (1) G4 native replacement installed-plugin proof; (2) migrate native source-capture fixture; (3) reconcile public ci_* API/stores and history; (4) rerun complete import/reference scans and exact hosted CI after integration. E2 must stop on any unverified closure, missing mandatory CI test, or stale source SHA.

## Verdict
**PASS for bounded E1 documentary inventory/proposal** on source baseline `1cb77c2...`, zero open documentation findings. **NOT** G4 proof, **NOT** full post-integration import-closure proof, **NOT** E2 authorization. E2 remains blocked. No merge, deploy, or Mac/local VM mutation.

## Follow-up review: HTTP entry correction (2026-11-05)
The initial map left HTTP → bootstrap verification for E2. Direct inspection of `src/mcp/http.ts:7,119,123` and `src/mcp/http-cli.ts:1` confirms that macOS HTTP startup also calls `bootstrapMcpTools`. The map has been repaired in E1 (blob `45e96ffc9c67c116761d5030e4a9ef72f8def738`; commit `6cd16e60aa93534239f59d6e800a1422b5ec5913`). This was a **MINOR documentation coverage finding, RESOLVED**. Both HTTP and stdio are now in the E2 cleanup gate. Source remains unchanged, and no VM test or real-Mac operation was executed. There is no claim of complete AST-wide import closure: that is explicitly deferred to the post-integration E2 gate.

Final scope verdict: **E1 documentation PASS, zero remaining known actionable E1 documentation findings**, while G4 native proof and exact-source zero-VM dependency gates remain **NOT MET / E2 BLOCKED**.

## Final task closure — 2026-11-05

**Track E1 state: CLOSED / COMPLETED (DOCS-ONLY).** Inventory, caller-to-callee dependency map, E2 proposal and documented review are persisted; the identified HTTP route coverage finding was repaired. No additional E1 investigation or code change is authorized by this closure.

**Track E2 state: BLOCKED / NOT STARTED — external prerequisite G4 missing or unverified.** This is **not** an E1 test failure. E2 deletion cannot begin because there is no verified acceptance evidence on the user's real Mac establishing that the native replacement is installed and works through the selected plugin. GitHub-hosted macOS source/build tests, native adapters existing in source and CI preparation are insufficient to satisfy the distinct G4 actual-host gate. In addition, the final post-integration import closure, migration of `native/macos-vm/SourceCapture.swift` currently used by non-VM CI, and decisions preserving shared `ci_*` consumers remain E2 prerequisites, not completed implementation.

**Responsible next work:** A/B/C/D integration and G3 must provide exact-revision, required hosted macOS CI evidence; then G4 requires separately authorized installed-plugin tests and recorded actual-host results. The E2 integrator may resume **only after** G4 PASS is independently verified and must re-pin the source dependency map before any deletion. Do not bootstrap VM, run VM tests, modify installed VM media, delete guest images, change user-local checkout, merge or deploy as a workaround.

**Closure meaning:** E1 = DONE with documented limitations; E2 = WAITING_ON_G4 (BLOCKED); native Mac actual-host acceptance = PENDING USER AUTHORIZATION / EVIDENCE. No E1 work remains pending merely because downstream E2 is gated.
