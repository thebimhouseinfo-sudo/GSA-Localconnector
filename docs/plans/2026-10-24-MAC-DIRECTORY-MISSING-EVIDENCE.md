# Mac directory missing-evidence implementation plan

> **PROPOSED — continuation of existing directory-copy Task 4 only.** Use `superpowers:executing-plans` for a subsequently assigned implementation. Proposed checkboxes are not harness completion state. This document neither activates capabilities nor grants native execution or installation scope.

**Goal:** Close the missing evidence for the approved Mac directory-copy slice under unchanged criteria §§3/4/7/8, then continue the existing Mac-before-Windows goal.

**Architecture:** Preserve independently audited reader, destination and interruption observations as immutable evidence. Test the actual existing reader orchestration through a narrow seam, then prepare missing-only recipes over its tested components before reviewing any new finite native run. Keep source readiness, native observations, protected installation and live-plugin acceptance separate.

**Tech stack:** Existing TypeScript ESM/Node, Python 3 and Swift/macOS APIs; no new dependencies.

**Spec:** [Existing plan, Task 4](2026-10-24-MAC-DIRECTORY-COPY.md), [criteria](../CRITERIA.md) §§3/4/7/8.

## Global constraints

- Preserve existing pending `codex/mac-completion` work and all consumed one-shot records/stages/results. No reset, replay, branch change, fetch, push, merge, rebase, native installation, VM, permission or policy change. Push remains MANUAL_ONLY.
- Do not repeat successful fixtures merely for confidence. Do not reconstruct missing numeric timestamps, omit unresolved facts to manufacture eligibility, or relabel callback/coordinator observations as native-helper/controller evidence.
- The current explicit work window is 2026-10-24 15:14:17Z–15:44:17Z; primary tracks elapsed time across roles. At most five additional review/repair rounds, bounded by that deadline; no reset here. If unfinished, preserve checkpoint and primary obtains explicit continuation.
- Harness status is M1/P01 `AWAITING_USER`, `gate.next=G0`; trusted approval adapter unavailable. Preflight is `NEEDS_SCOPE_REVIEW` for existing dirty `codex/mac-completion`, with MANUAL_ONLY push and no fetch. This proposal changes no gate or attestation.
- Production activation stays false. Any future activation needs concrete reviewed proof/installation work and human review; routine source/test preparation follows the existing user authorization.

## Evidence ledger to retain

| Observation | Accepted scope | Still missing |
| --- | --- | --- |
| Reader stage `kkes26`, original result INCONCLUSIVE; 15 closed helpers/19 receipts | Workspace/reference bytes/structure, Unicode, unsafe descendants, limits, stale binding/traversal/write denial; release relocation returned `CONCURRENT_CHANGE`, no outside content | Persisted numeric relocation timeline; invalid-name helper observation (setup returned EILSEQ before helper); mount/device fixture; source-change and directory-replacement windows |
| Destination stage `RWhyiz`, audited 41 receipts | Actual reference/workspace copies; collision, client ACK loss, restart/readback and no replay | Historical inode continuity and some signed-artifact audit fields absent; no helper-crash/fsync/controller proof |
| Interruption v2 stage `MzC5tJ`, exit0, audited subset per primary | 17 tree/9 base calls, 4 bundles, 0 compile, 1 owned Node SIGKILL, 26 receipts/78 raw files; fresh UNKNOWN/MATCH and duplicate without writes; callback revocation UNKNOWN/DIFFERENT and no subsequent writes | Real helper crash, durable-store/fsync failure and live controller/grant revocation |

The interrupted journal remains `PENDING`; public inspection maps it to UNKNOWN. Do not rewrite it into a terminal UNKNOWN record. Reader release SHA256 `560e35152d7fb0f2aca10c38cd10c61b690a31a406c7e3269cfb33962b1ffd62`, normalized code `1245d201ddc251b091cbaf9edd676683f59a3e36bf09143e212516fd1cf47e12`, source `b63fa083b40bc23e0863f401c8aff917b8b2e4ecf2d1739c0e9e5bd255ab352d` are the retained candidate identities, not authorization to execute it again.

Source reports: [reader](../reports/2026-10-24-mac-directory-reader-native.md), [destination](../reports/2026-10-24-mac-directory-destination-native.md), [interruption v2](../reports/2026-10-24-mac-directory-interruption-v2-native.md). The interruption report's original “audit pending” wording is historical; parent supplies the completed subset audit, which must be linked durably by its evidence owner before broader acceptance.

The separate [retained host-FD finding](../reports/2026-10-23-mac-host-retained-fd-native.md) is BLOCKING for full criterion 7 acceptance: 24 bytes remained readable after root relocation. It is not repaired by reader denial. Apple ES availability remains unknown; no authority or criteria workaround is proposed.

Primary's read-only live-plugin status observation at approximately 15:37Z: connected, available file mutations limited to `create_file`, `create_directory` and `copy_file`; `hostFileWrites:false`, Git blocked and recovery false. Reported execution environment is `linux-arm64-vm` with `disposable-snapshot` workspace mode, which supplies no native Mac shell proof. Only `Testws-b152c830eed2592c`, revision 2, read/write/execute remained present. No live write, lease or installation occurred. Directory-copy installed/live MCP acceptance remains missing despite connectivity.

## Evidence-format decision

`src/hosts/macos-directory-evidence.ts` currently accepts exactly one fixture, two roots, ten named observations, strictly ordered numeric relocation phases and empty `unresolved`. `src/hosts/macos-directory-installation.ts` calls that validator and unconditionally advertises `available:false` through `macDirectoryCopyActivation()`.

A missing-only run therefore **cannot qualify as current v1 evidence** by combining old receipts with new roots. Keeping v1 and requiring an eligible single-fixture record would require repeating already successful cases. That is not the recommended next step and is not authorized by this proposal. Collecting truthful supplemental evidence can proceed later without claiming v1 eligibility; production remains blocked.

If qualification without repeated cases is subsequently required, propose a separately reviewed provenance format rather than silently relaxing v1: an immutable index of case receipts, each retaining its own stage/root identities, role/revision, signed bundle hashes/entitlements, exact release/code/source/build identity, raw file lengths/hashes and independent audit reference. Every required boundary must map to its own sufficient observation; mixed or changed artifacts, cross-root substitution, missing timeline, incomplete raw files and unaudited entries reject. Original unresolved records remain intact and visible; the index cannot create missing facts. No implementation of this alternative, change to required proof, or activation is included now. Reviewer must decide whether cross-fixture composition preserves each claim before a concrete schema/code change is proposed to the human.

## Review focus

1. Filesystem capability/fixture preflight must finish before the first native launch, signing action or attempt-slot effect. Setup failure must preserve a complete failure report, clean only newly owned fixture entries and dispatch no native helper; helper-cleanup unit tests do not prove whole-run phase ordering.
2. Missing observations remain UNVERIFIED, including invalid names rejected by the filesystem before helper execution and unavailable mount fixtures.
3. Relocation timestamps must be persisted as observed, including partial timelines after failure; output classification never supplies missing timing.
4. Source-change and directory-replacement windows need actual release-process identity and observable ordering; test-build instrumentation is not release proof.
5. Native-helper crash, fsync failure and live grant/controller revocation must retain their distinct trigger and actual durable state; no replay remains required.

## Task 4 continuation A — missing-reader driver preparation

**Trace:** §§3/4 source-to-workspace copy and §§7/8 real boundary evidence. **Owner:** Coder owns a narrowly assigned orchestration seam in `scripts/test-mac-directory-copy-native.mjs`; Tester owns regressions in `test/mac-directory-native-driver.test.mjs` and the new dated report. Preserve the archived consumed driver/source/result and reservation byte-for-byte. Editing current driver preparation does not authorize invoking its consumed native entrypoint or alter what the historical run executed.

**Interface to review before implementation:** expose the actual existing run's preparation/report orchestration through the narrowest dependency seam needed to test whole-run phase ordering without native launch. Complete filesystem capability/fixture preflight before native helpers, compilation/signing or slot consumption: the original EILSEQ was discovered after 15 helper calls, so a local cleanup-helper test alone misses the failure. Import/`--plan` remain inert. Any later missing-only entrypoint must be a thin case recipe over existing tested preparation, transport, raw receipt and lifecycle components, never a copied independent runner. Shared extraction is permitted only when necessary for this missing-evidence work, with compatibility tests through the actual existing driver path and archived-source preservation; no refactor for its own sake. Preparation must use exclusive copies of retained candidate/build artifacts, verify hashes before use, and reject changed inputs. A future native recipe needs a new exact acknowledgement and distinct never-used reservation; do not share/reset v1 reservations. No native command is yet approved.

- [ ] Tester first adds a regression that invokes the **actual existing reader run's preparation/report orchestration** using a real disposable filesystem, not merely an extracted validation helper or new unused standalone runner. Force EILSEQ at the invalid-name creation boundary after its case directory exists. Assert an event trace orders complete fixture capability preflight before any native/process/signing/compilation/attempt-slot effect; on failure all those effect counts are zero. Assert persisted setup-phase error with original code, unchanged pre-existing source/canary bytes and identities, and removal only of the owned empty case directory. Confirm the test fails before the driver repair; record exact command/output.
- [ ] Coder supplies the minimal existing-run seam and phase-ordering repair. Exercise real candidate/build exclusive-copy and hash checks, including changed-input denial. An invalid byte filename which the host filesystem itself refuses is `UNVERIFIED_PLATFORM_FIXTURE`, never `UNSUPPORTED_NAME` from the helper. Do not attempt a new filesystem/mount automatically to force support. Cover unavailable mount preflight explicitly without silently skipping its unresolved status.
- [ ] Tester exercises the same existing orchestration's relocation report persistence with synthetic ordered events and a forced failure after each phase. Assert exact observed numbers survive in the written report, absence remains absence, original error remains, and no success evidence is emitted. Existing `recordRelocationPhase` unit tests alone do not satisfy this path check. Assert importing and `--plan` cannot spawn, sign, reserve or relocate anything. If shared extraction is necessary, test request/receipt bytes, budgets, close/cleanup behavior and original acknowledgement/reservation routing through the existing driver; consumed slot remains consumed and is never used by tests.
- [ ] Run `npm run build` and `node --test test/mac-directory-native-driver.test.mjs` after implementation; run affected existing destination/interruption driver tests only if their shared components change. Reviewer checks actual call graph and filesystem diff, whole-run phase ordering, compatibility, failure diagnostics, ownership/cleanup, preserved pins and inertness. No native or implementation-readiness claim follows from this proposed plan.

**Concrete next step:** assign the first failing regression through the existing reader's actual orchestration above, proving EILSEQ preflight precedes all native/signing/slot effects. This advances the exact setup/reporting gap without another orchestration fork, native replay or acceptance-contract change.

## Task 4 continuation B — review a missing-only native scope

**Owner:** Tester constructs scope/report; Reviewer independently approves the driver/evidence mapping; primary decides whether existing user scope covers its execution. **Status: NOT_READY.** The reviewed missing-only driver, deterministic source-change/replacement ordering, exact launch/sign/observer/rename/signal counts and mount availability are not established. Do not infer reduced counts by subtracting from the old 24-helper budget.

The concrete review must state each missing case, exact release/bundle identities, fresh owned stage and slot, bounded output/time, all process births/PIDs/FDs, per-case mutations, termination and cleanup rules, and raw receipt persistence on every failure. Reuse candidate bytes if unchanged; avoid recompilation solely for confidence. A new root binding still requires its own signed-artifact checks. Relocation must persist `stopConfirmed < parentRelocated < resumed < responseObserved` on actual observation. Invalid-name setup and mount coverage are explicitly conditional; inability to create a valid platform fixture remains UNVERIFIED. Source replacement before open and during enumeration need distinct ordered observations; uncontrolled racing is insufficient.

Observable review trigger: complete inert `--plan`, source-only orchestration tests and exact driver hash available. Only then can a separate one-shot execute within a concrete reviewed scope. Audit raw requests/responses/stderr and source/outside canary identities/hashes; retain all gaps. No repeat of stable captures/denials/limits or destination/interruption journeys is included.

## Remaining Task 4 evidence — preserve as separate readiness items

| Item / trace | Owner and observable next trigger | Current status |
| --- | --- | --- |
| Actual helper crash / §§4/8 | Tester proposes an owned-helper identity/phase handshake and finite driver; Reviewer checks whether mutation-before-ACK was actually observed, then audits journal/readback/no replay | NOT_READY; Node coordinator SIGKILL is not this trigger |
| Durable-store/fsync failure / §§4/8 | Coder/Tester first exercise actual `DirectoryCopyStore` publish/lock/file-sync/directory-sync failure paths and public UNKNOWN/no-replay behavior; native scope separately reviewed if needed | UNVERIFIED; do not claim ancestor fsync or physical power-loss proof from unit failure injection |
| Live grant/revision/controller change / §§3/7/8 | Tester routes a disposable scoped journey through actual authority state and loader/MCP checks; Reviewer requires identity-bound revocation between acknowledged writes and no further dispatch | NOT_READY; callback toggle remains only callback evidence |
| Checked installation and live MCP / §§3/4/7/8 | Primary presents exact reviewed installation diff, artifact/proof binding and isolated acceptance request after qualifying proof exists; Reviewer checks tamper/stale-role/revision rejection and base capability preservation | BLOCKED on missing proof and unconditional activation false; no live owner replacement now |

## Acceptance and bounded handoff

Reviewer classifications: BLOCKING requires a violated criterion and reproducible evidence; missing facts are UNVERIFIED; unrelated additions are OUT_OF_SCOPE. Review triggers are readiness of continuation A, a concrete B driver, and subsequently each distinct crash/durability/authority/installation scope. Stay within primary's remaining round count and 15:44:17Z deadline; no automatic fresh window. Critic only at existing configured larger triggers.

Report four separate results: (1) source/test readiness, (2) exact native observations/gaps, (3) checked installation/live MCP acceptance, (4) full Mac acceptance. Prior safe verification reported 436 product PASS, two Windows skips, 34 harness PASS and 39 MJS PASS; those are historical checks, not new verification for future edits. No full Mac PASS follows while directory proof/installation gaps or the retained-FD boundary remain. Windows stays deferred. No manual gate/task completion, staging, commit or push is part of this proposal.

This revision serves the original directory-copy requirement by targeting only missing evidence and fixing preparation observability before another scarce one-shot. It adds no product feature, milestone, criteria exception or permission flow.
