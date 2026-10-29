# Mac27 recovery qualification — one approved native attempt

Result: **RECOVERY_SEQUENCE_OBSERVED; independent evidence review PASS for this finite recovery scope.** This is not installed acceptance or complete Mac readiness.

## Authority and exact run

Human separately approved one180-second run,17broker/158explicit-spawn cap, recovery fixture compile/sign, no retry or production activation. Admission Reviewer PASS covered only two source holds false→true. Enabled driver SHA256 `97687eda4eabfcdd3a47534357e3f5275c1f392bb348a58707e1bca41a1145d4`. Held source restored exactly afterward: `65f42c05d8cebeac0d97bb5bba4e3a0d065d09d29099a886033813cd18d3c75a`; test hash unchanged. No test assertion was removed or weakened to open the run.

Command run exactly once: `node scripts/test-mac27-recovery-native.mjs --run-native --ack-mac27-recovery-one-pass` — **exit0**. Host darwin27.0.0/arm64. Retained stage `/private/tmp/gsa-mac27-recovery-62acad0b62a9a68308e95017`; exclusive slot `docs/reports/.mac27-recovery-native-v1.attempt.json` remains consumed. No reset/retry. Stdout state RECOVERY_SEQUENCE_OBSERVED, activation:false.

Original temporary BASE binary was absent. The installed regular owned BASE binary was read-only hash-checked and copied exclusively/fsynced to the driver's existing private input path. SHA256 `3c540b7f5e151ad74c313c758aa12b1f249524db8a367b8692b5f33e24c00aea` exactly matches accepted archive; no BASE rebuild or installed change. Build/evidence archive pins also matched. Production recovery source SHA256 `6b5debec3543ca6d0c25b2844e77113630f884ca1513d168bfd161d52fe0fab8`, release SHA256 `95817c08d1a409ed33fc27aef46b8975ee9e1bb5b03cad4c924609e71b5a8a31`, normalized code SHA256 `046820244f22afb203ffca4261cb4365df45b26018a943ee2cea865e5a596205`. Build compiler/SDK/source/arguments/UUID and separate diagnostic provenance are retained in report.json.

## Actual evidence

- Merged counts17broker,4sign,2compile,6observer,1owner,105tool = **135 explicit spawned children**,5managed signals. All135 receipts closed, none truncated; cleanup CLOSED_EXPLICIT_HANDLES_ONLY. Private compiler descendants remain UNVERIFIED.
- Normal production replace/trash APPLIED with hash/inode readback. Lost ACK retains actual raw APPLIED reply and deliberate drop, initially UNKNOWN then inspect APPLIED without replay. Wrong hash preserves source; duplicate native ID refuses reuse.
- Three constructed staged/captured/published states are STRUCTURAL_READBACK_ONLY, never represented as observed crashes.
- Held-parent relocation: actual owned STOP, unchanged parent identity, one rename and monotonic observations. Result **OBSERVED_DENIAL at pre-capture-read**, exercisedSyscalls:[]; no outside effect. This does not exercise capture/publication/restoration outside the workspace.
- Staging interruption actually SIGXFSZ with nonempty bounded retained stage. Post-capture interruption confirms fresh captured-name inode, staged-name presence and source absence after STOP; SIGTERM then inspect remains UNKNOWN, retained capture and no replay.
- Separate diagnostic source/build injects one sync-error branch; DIAGNOSTIC_ONLY, actualKernelFsyncFailure:false. No physical power-loss claim.
- Eleven canary checkpoints unchanged. Both observer streams' four chunk/descriptor pairs reconstruct the actual events and match hashes. Control released, unresolved empty. Production identity, installation, grant and service unchanged.

Independent configured Reviewer inspected **405 raw receipt blobs**, lengths/hashes,17broker schedule,16adapter replies plus direct duplicate, observer chunks, native fault signals, canaries and current held-source restoration. Verdict PASS for this finite evidence; installer/verifier linkage may proceed under the reviewed plan. An initial reviewer chunk-path audit failed due to an incorrect audit root, then corrected read-only audit passed; not a product failure.

## Durable evidence and remaining work

Sanitized archive: [manifest](2026-10-28-mac27-recovery-native-archive/manifest.json), [worker report](2026-10-28-mac27-recovery-native-archive/report.json), [owner report](2026-10-28-mac27-recovery-native-archive/owner-report.json).421files/22916183bytes preserve reports, raw synthetic receipts, immutable hashes, slot copy and console output. Identity, proof keys, installation trees and worker-input are excluded. The first archival snapshot command exceeded the harness200-path limit and exited1 before writing; batched snapshots completed before copy. Original stage remains intact.

Post-run held-source guard suite: `node --test test/mac27-recovery-native.test.mjs` exit0,**38/38pass/0fail/0skip**,150.942625ms. Full product checks immediately before native: build0, npm540/537/0/3, harness34/34. No product source changed during native; only temporary driver holds were opened/restored.

Three user-approved commits: bdae0c2 (findings1–16),52401e3 (findings17–21),dccd5c3 (driver). No push. This report/archive are new uncommitted evidence requiring approval before any commit. Native recovery activation stays false until the exact evidence→build→signed installation linkage is implemented, independently checked and tested through the installed plugin. P04 host shell/Git boundary and other Mac requirements remain separate blockers; no Windows transition or milestone completion.

Retained artifact follow-up: archive now preserves the exact production and diagnostic release binaries/build metadata plus unchanged BASE binary, all hash-checked against report pins. Total 426 files/23319213 bytes; private identity/proof/installation trees still excluded. These are evidence copies, not installed executable updates.

Commit-scope disclosure2026-10-29: this summary may be committed with the source linkage and portable exact report fixture. The426-file raw archive/binaries remain LOCAL retained evidence and are not part of that proposed source commit; existing local archive links refer to those retained files. No claim that a source-only checkout contains all raw blobs or can repeat the consumed native run.
