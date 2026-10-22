# Mac retained-capture characterization — 2026-10-18

**Verdict: narrow filesystem observations and adverse counterexamples, not a production mutation or confinement pass.** The [experiment contract](../plans/M1-RETAINED-CAPTURE-EXPERIMENT.md) was exercised once using [the disposable fixture](../../native/macos-files/test-retained-capture.py). This continues [M1 boundary research](../plans/M1-MAC-HOST-BOUNDARY-DESIGN.md); complete M1 remains pending. Existing broker characterization was not rerun.

## Artifact and host identity

| Artifact | SHA-256 |
| --- | --- |
| Fixture source | `40f7a4a5bf90cc233a209cf83443e0a36c7b630d765e4b78900556ac98ab2ec7` |
| Embedded C helper source | `4b20e943a5370b5e28950350587c11df48e91b1d1f940a428fe9ed7ad53bdc4e` |
| Compiled disposable helper | `e61e12c1a9c60fb1bccf85c33bfee0b9d57492fe61a26a1b2e5f0141d33c3e08` |
| Native result JSON | `d1fa091873aa6b7ce9319d1ac936e47878ae3b5c321f5c70e6215ef12a2b13c6` |
| Real-process supervision probe result JSON | `be74927cb73d5370349cae9e4bcee069295990c35aa108cdaa4de0463debf8e3` |

Recorded host: Darwin25.6.0/arm64, APFS block size4096. Apple clang21.0.0, resolved `/Library/Developer/CommandLineTools/usr/bin/clang`, executable SHA-256 `1590ac950a3d627817d09ade5cb60b2115f17a72182a3141e010b4bcc482a0c9`. Queried SDK27.0; actual compiler header selection was not independently traced. The helper was ordinary unsandboxed test code, not the signed broker or an installed backend. Its binary was removed with the disposable fixture.

Command: `python3 native/macos-files/test-retained-capture.py`, exit0, 12 recorded cases, empty stderr. Local [raw JSON](../reports/2026-10-18-retained-capture-native.json) retains syscall returns/errno, literal bytes/hashes, device/inode identities, namespaces, writer acknowledgements and child exits. The [test report](../reports/2026-10-18-retained-capture-test.md) links the separate exit/stderr and supervision-probe artifacts. These local files must accompany any independent evidence review; this document alone is not raw runtime proof.

## Observed effects

| Case | Observation and consequence |
| --- | --- |
| Stable capture/publication | Exclusive capture and publish returned0. Recovery held original `OLD!` inode; input held staged `NEW!` inode. Shows this namespace sequence on this fixture, not content CAS. |
| In-place edit before capture | `EDIT` differed from the expected initial bytes and was restored with the captured original inode. No stale-byte publication was accepted. Rename-before-capture is not covered by this in-place-edit variant. |
| Open-FD late write | A descriptor opened before capture wrote `LATE` into the retained inode; published `NEW!` stayed on a separate inode. Retaining a name preserves later writes here, but does not make an immutable backup. |
| Recreate before publish / restore | Both exclusive operations returned-1/EEXIST17. The recreated `USER` entry and captured/staged versions remained. No overwrite rollback occurred. |
| Crash after capture / publication | Two intentional SIGKILL exits(-9). Fresh-process readback distinguished absent input plus retained old bytes from published new bytes plus retained old bytes. This is process interruption evidence, not power-loss durability. |
| Recovery-name collision | Capture returned-1/EEXIST17; original input and `COLLISION` target remained. No disk exhaustion or ENOENT variant was exercised. |
| Writer during copy/hash | Source states were `AAAABBBB`, `1111BBBB`, `11112222`; copied bytes were `AAAA2222`. The copied hash authenticates those observed bytes, not a coherent source version. This is an adverse counterexample. |
| Root replacement | The explicit revalidation guard detected a changed root; replacement canary remained intact. This is a tested guard branch, not general OS confinement. |
| Ancestor relocation | Held descriptors successfully captured/published in the relocated tree. Descriptor-relative I/O alone did not preserve the original pathname boundary. This is an adverse counterexample, not a successful denial. |
| Cleanup identity guard | Cleanup refused an already-replaced target and preserved both versions during that check. Replacement between identity check and unlink was not tested or prevented by this result. |

All12 observations satisfy the experiment's own oracles, including adverse results. `ok:true` means the fixture observed the expected research effects; it does not mean production safety criteria passed.

## Supervision, cleanup and timing limits

A separate real-fork regression probe ran once, exit0. It observed a driver exit0 while its descendant retained stdout, then shortened that owned group's deadline. The watchdog rejected the timeout; independent OS checks observed the descendant PID and group disappear before identity-checked cleanup. The probe deliberately supplies a failure reason to fixture finalization, so its nested `ok:false` is an expected tested failure, not a hidden native test failure.

Native cleanup reported all23 process groups ultimately quiescent and the identity-checked private fixture removed. Group82638 also retained `[Errno1] Operation not permitted`. The reviewed code records quiescence only after leader exit and a later absent-group observation; the record does not demonstrate a surviving group. Which check/signal produced EPERM, its cause and timing remain **UNVERIFIED**. Do not claim error-free shutdown or general stop guarantees.

Native `elapsed_seconds=1.171656666` and probe approximately0.362s are internal samples taken before JSON serialization/output. External full-process timing was not retained. The implementation permits a60s workload deadline plus up to1s supervisor join and a shared2s stop-only grace. Strict end-to-end60s enforcement and complete wall-clock budget compliance remain **UNVERIFIED**; no over-budget execution was demonstrated. Identity-check/unlink race protection also remains unproven.

## Design disposition

Continue investigating protected retained-version recovery with explicit partial effects/UNKNOWN. The experiment supports retention and exclusive-collision behavior under the observed conditions, while directly refuting coherent-copy and pathname-confinement assumptions. Do not enable production replace/move/Trash or cross-root copy from this result.

Remaining obligations include protected same-volume recovery and its retention policy, coherent-source/content-conflict semantics, root/revocation confinement, move/Trash outcome contracts and durability. Native command/macOS guest feasibility still needs the approved resource choice and independent boundary proof described in the M1 design. No Windows work, original-media access, production code or installed permission change was part of this experiment.
