# Source baseline status — 2026-10-17

This is a source checkpoint, not a production release. [Criteria](CRITERIA.md) defines desired behavior; implementation gaps remain. User data, machine configuration and VM media are excluded.

## Baseline history

Previous main product baseline: b071308, followed by harness-only integration e5ba967. PR #3 consolidates local native checkpoint 19dac16 and subsequent Mac source changes into a product-only baseline. At the user's request, publication removes agent tooling from the current tree without rewriting history; local tooling and recovery copies remain on the development machine. Source, tests, product build/install scripts, CI and project documentation remain versioned. This is a fresh source starting point, not a reset of completed work or a production release.

## Current gaps

- Binding still creates read-only grants; legacy execution enrollment is not the desired full-workspace model. Explicit working/reference roles and descendant enforcement need reassessment.
- Mac native backend runs portable Linux ARM64 jobs in disposable snapshots, not macOS SDK applications. Host file/mutation, artifact, ownership/startup/recovery integration remain unfinished or need current evidence.
- Windows protected ACL storage/native containment is unverified. Mac results do not certify Windows.
- Historical individual Windows/Mac plugin calls passed; later sessions terminated. Current connectivity/simultaneous use needs fresh tests.

## Verification

Source revision `ab6acfa10ca60019d0d17730af63838f218a52d9`, tree `cbf57453f231fb4ceb87bc1d074214153997d526`, passed Source Contract CI run **39015375272** on 2026-10-17. All three jobs completed successfully, including applicable later compilation and fixture checks. Each host ran `npm test` (TypeScript build plus source tests):

| Host | Total | Pass | Fail | Skipped |
| --- | ---: | ---: | ---: | ---: |
| macOS | 149 | 146 | 0 | 3 |
| Windows | 149 | 121 | 0 | 28 |
| Ubuntu | 149 | 140 | 0 | 9 |

Skipped platform/feasibility cases remain explicit. Ubuntu source success does not add Linux native host support. Windows source success does not verify Windows ACL containment. Source CI compiles native helpers and exercises fixtures; it does not certify an actual VM boot, installed runtime, live plugin or complete product operation.

Baseline repairs retain strict compiler checks and terminal-journal immutability. Cross-platform repairs give cancellation fixtures private snapshot storage, assert Linux's explicit unsupported status while retaining controller/denial checks, and validate macOS manifest paths with POSIX semantics on every CI host. Drive/UNC/traversal paths remain rejected. Actual native runtime loading still requires darwin/arm64.

The first PR #3 run, 39014797479, failed two Ubuntu fixtures and two Windows fixtures. Windows source-capture completion did not reproduce in the two subsequent Windows runs; real-storage error diagnostics and strict terminal-state assertions remain, and its original root cause is not claimed established. Run 39015197578 passed Ubuntu/Windows but exposed a Mac ownership-test startup race. That race was reproduced with an injected 2300ms child startup delay, then resolved by awaiting explicit readiness rather than assuming a two-second startup. Lock exclusivity, inherited descriptor fencing and release assertions remain intact. No failing test was removed or skipped for publication.

Independent cleanup/repair review found no blocking issue. The project-only export builds/tests without agent tooling. Local `npm test` after repairs also passed 146 tests with 3 skips; local runs reused installed dependencies, while CI installed dependencies separately. Earlier sandbox loopback EPERM failures remain environment evidence, not source success or native proof.

Historical native evidence: [worker integration](reviews/2026-10-17-NATIVE-WORKER-INTEGRATION.md) and earlier VM smoke reports. Exact-artifact evidence does not certify subsequent WIP or the complete source tree.

## Next sequence

Use the reviewed project-only source baseline, reassess the implementation against criteria, then revise the proposed plan/milestones before further product work. Source verification does not close the implementation gaps above. Development milestones do not become approval gates in workspace tools.
