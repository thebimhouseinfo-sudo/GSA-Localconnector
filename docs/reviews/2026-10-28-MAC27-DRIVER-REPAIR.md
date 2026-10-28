# Mac27 recovery source-preparation repair — separate task

Date2026-10-28. Status: independent Reviewer PASS, repair round5. Scope ONLY scripts/test-mac27-recovery-native.mjs and test/mac27-recovery-native.test.mjs; this report is evidence for a separate commit group. No staging/commit/push or native run.

Original four blockers in MAC-COMPLETION-CHECKPOINT.md are resolved in actual wiring:

1. Owner verification receives inheritedFD3 and allowlisted session environment through the actual transport/command path.
2. Post-STOP captured-name identity is read afresh and compared with frozen original identity, plus source/staged namespace observations.
3. Staging requires matching retained native receipt, actual SIGXFSZ and1–4096staged bytes. Lost acknowledgement requires retained raw APPLIED reply plus a deliberate drop. A different failure cannot qualify the planned fault case.
4. Streaming observer request/metadata and numbered raw chunks/descriptors are durable and attributable before parsing. A fresh reader reconstructs split JSON inside the callback. Both known failed close and earlier abort/error paths synchronously cancel queued callbacks before drain. Raw evidence is retained and all copies/metadata charged to existing receipt budget.

Validation:
- Baseline guard suite28/28pass.
- First new red suite33tests/28pass/5fail: stale post-STOP identity acceptance directly reproduced; four other failures were missing-helper INTERFACE GAPS, not native incidents.
- Additional adversarial red2/0/2: missing truncated flag and event publication after overflow. Repaired34/34.
- Round3 durable attribution/split-stream regression initially failed for a missing writer boundary; intermediate36/36green. Reviewer reproduced the actual failed-close ordering bug with inert promises: `{knownChildExit:2,callbackRanBeforeReportedFailure:true,failure:"CHILD_EXIT"}`.
- Round4 close guard fixed that ordering;37/37green.
- Round5 already-aborted-stream test failed with Missing expected rejection; synchronous abort propagation repaired it.
- Final independent `node --test test/mac27-recovery-native.test.mjs`: exit0, **38tests/38pass/0fail/0skip**. `node --check` and scoped `git diff --check`: exit0. Build also passed in the repair batch.
- Driver SHA256 `65f42c05d8cebeac0d97bb5bba4e3a0d065d09d29099a886033813cd18d3c75a`; tests SHA256 `e062d7f896f88d3a86440e8326a613d1a12addc031376a305ec5ef9c2f02fd59`.

SOURCE_REVIEW_COMPLETE:false; IMPLEMENTATION_COMPLETE:false; activation:false; default/import remain inert;17broker/158spawn caps unchanged. No compile/codesign, attempt reservation/reset, production identity/secret access, installed update or native acceptance was performed. Stderr is not parsed and remains retained in the normal close receipt; no cross-stream ordering certificate is claimed.

Five review/repair rounds are exhausted for this pair and the final scoped review passed. Any new blocking repair needs an explicitly extended allowance. No milestone is completed. Logs `/tmp/gsa-recovery-prep-round*-*.log` preserve the run-specific evidence. Human must approve this group separately before its commit.


Fresh continuation check2026-10-28: `node --test test/mac27-recovery-native.test.mjs` exit0,38/38pass/0fail/0skip,290.673583ms (`/tmp/gsa-mac27-driver-final-guards.log`). Driver source/test unchanged by the Round3 journal repair. Native flags/holds/activation remain false; no new driver repair round or native run.
