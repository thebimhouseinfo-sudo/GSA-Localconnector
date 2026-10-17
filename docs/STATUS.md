# Source baseline status — 2026-10-17

This is a source checkpoint, not a production release. [Criteria](CRITERIA.md) defines desired behavior; implementation gaps remain. User data, machine configuration and VM media are excluded.

## Baseline history

Previous main product baseline: b071308, followed by harness-only integration e5ba967. This candidate consolidates local native checkpoint 19dac16 and subsequent Mac source changes into a product-only baseline. At the user's request, publication removes agent tooling from the current tree without rewriting history; local tooling and recovery copies remain on the development machine. Source, tests, product build/install scripts, CI and project documentation remain versioned. This is a fresh source starting point, not a reset of completed work or a production release.

## Current gaps

- Binding still creates read-only grants; legacy execution enrollment is not the desired full-workspace model. Explicit working/reference roles and descendant enforcement need reassessment.
- Mac native backend runs portable Linux ARM64 jobs in disposable snapshots, not macOS SDK applications. Host file/mutation, artifact, ownership/startup/recovery integration remain unfinished or need current evidence.
- Windows protected ACL storage/native containment is unverified. Mac results do not certify Windows.
- Historical individual Windows/Mac plugin calls passed; later sessions terminated. Current connectivity/simultaneous use needs fresh tests.

## Verification

Four TS18047 pipe errors were reproduced and fixed with checked streams; strict compiler settings remain. The existing process-journal regression exposed missing terminal immutability. Minimal repair preserves final output capture, then seals stopped records once output is complete.

Initial local suite after pipe fix: 147 total, 140 pass, 4 fail, 3 skip. Failures: two HTTP loopback listeners denied with EPERM by the execution environment, missing terminal-journal rejection, and a Node 24 async-ID assertion abort in review-regressions.test.js. Final verification and remote CI evidence must be recorded before calling the baseline green.

After the journal repair and explicit socket-error handling in the test probe: build PASS, journal regressions 3/3 PASS. Full local suite: 149 total, 143 pass, 3 fail, 3 skip. All three remaining failures are HTTP loopback listen EPERM in this restricted environment; the Node assertion abort no longer occurs. No test was skipped or weakened to obtain these results. Cross-platform CI remains to be checked on the published commit.

Fresh continuation verification on 2026-10-17 reproduced those three loopback EPERM failures inside the sandbox. With explicit permission to rerun outside the sandbox, the local verification wrapper exited 0, including TypeScript build PASS and product tests 149 total / 146 PASS / 0 FAIL / 3 skipped. No source or test was changed during that continuation. This is LOCAL_ONLY evidence for the dirty tree at HEAD `9066e01f61f7cddce17c9c23f9ce3d9105685928`, not a clean-commit, cross-platform, native capability or live-plugin certification. The wrapper and its private evidence stay local; `npm test` is the product verification entrypoint.

Previously observed cross-platform failures remain relevant until a fresh candidate run proves otherwise: Windows VM installation-proof fixture binding, and Ubuntu queued/running cancellation and production-bootstrap status fixtures (CI run 39009452982, unmerged PR #1). Mac source success does not clear them. Baseline publication must report the candidate's actual CI outcome; no failing test is removed or weakened for publication.

The project-only candidate was exported independently of local agent tooling and passed `npm test` on Mac: build exit 0; 149 tests, 146 PASS, 0 FAIL, 3 skips. Existing installed Node dependencies were reused; this was not a fresh dependency installation. Read-only review reproduced the remaining portability problems with Windows path normalization and Linux platform simulations: the VM installation fixture uses a POSIX-only path, while status and CI-cancel fixtures receive `UNSUPPORTED_PLATFORM` on Linux. These simulations explain the prior failures but do not replace actual candidate CI. Native tests, live plugins and remote candidate CI were not run for this preparation.

Historical native evidence: [worker integration](reviews/2026-10-17-NATIVE-WORKER-INTEGRATION.md) and earlier VM smoke reports. Exact-artifact evidence does not certify subsequent WIP or the complete source tree.

## Next sequence

Fix/review baseline, publish product source/docs, then reassess criteria and revise plan/milestones. Development milestones do not become approval gates in workspace tools.
