> CURRENT: Explicit user one-extra approval received and consumed once. Exactly replace→inspect ran; new slot remains consumed. Do NOT rerun prepared command or reset reservation. Result UNVERIFIED_NATIVE_RECEIPT; source readback fix and separately scoped read-only followup pending. See docs/reports/2026-10-23-mac-recovery-parent-native.md. Everything below preserves preparation history.

# Proposed single Mac recovery held-parent probe — 2026-10-23

**Status: READY_FOR_EXPLICIT_ONE_EXTRA_QUOTA — last blocker resolved after user resumed repair. No native run or quota extension authorized yet.**

Purpose: test one missing recovery containment event under existing `docs/CRITERIA.md` §§7–8.
Mac reselection/create/mkdir/copy delivery is recorded separately in
`docs/reports/2026-10-23-mac-reselection-delivery.md`; it does not certify recovery.
No new milestone, scope criterion, permission or activation is proposed.

## Why explicit approval is required

The old interruption plan allowed bounded overlap probes, but the later cumulative
allowance was exhausted. `docs/reports/2026-10-22-mac-scoped-delivery-closeout.md`
requires a concrete reviewed proposal and explicit user extension before another native experiment.
The preserved ledger records five attempts, including misses/ineligible windows;
later preserved-receipt recovery did not reset its reservation or permit another relocation.
This proposal requests exactly one additional recovery-mutation attempt beyond that history.
The user's general instruction to continue Mac work has not explicitly extended that quota.
Never reset, delete or reinterpret prior attempt/reservation records.

## Source evidence and missing fixture preparation

`native/macos-files/recovery-broker.swift:174–218` opens and retains a relative parent FD,
persists intent/staged bytes, then rechecks workspace/recovery roots before capture/publication.
Those root checks do not establish that the retained interior parent still lies inside workspace.
The existing `scripts/test-mac-recovery-installation-native.mjs` builds a disposable signed
fixture and uses the real owner launcher/FD3, but has no held-parent observer/stop/relocation mode.
Its current full journey must not be run as if it implements this proposal.
The base-file fixture's libproc observer is useful implementation reference only;
its create-operation target-absence assertions and evidence do not certify recovery replace.

Concrete test-only implementation now exists: `scripts/test-mac-recovery-parent-probe.mjs`
and `scripts/mac-recovery-probe-control.mjs`. Primary owns the real adapter/native-child bridge;
Tester supplied the import-safe reservation/parser/budget controls. The default command prints
its plan without running native code or consuming a slot. Run mode requires prior explicit user
extension; its acknowledgement flag alone does not establish approval.

Preparation evidence: ten non-native tests passed. Both the separate Swift observer and unchanged
candidate compiled successfully; neither executable was run, no PID was signalled, no relocation
occurred and no attempt was consumed. An initial observer Swift whitespace compiler error was
fixed before successful compilation. This compile-only preparation supersedes the earlier proposed
ban on compiler execution; it does not establish native runtime or containment acceptance.
No broker source changes, injected hooks or interposition.
The old `/private/tmp/gsa-recovery-broker-candidate` is absent. Swift source still matches
`d31392926056ce369999ee48ccc4c3ce47a715a25e3db972da015b496407e14f`; the old binary hash/evidence
cannot be assumed transferable. A future approved run needs a reviewed unchanged-source candidate
build under recorded original toolchain/profile, with actual new build/artifact identities;
this event alone will not certify that whole build or authorize recovery activation.

## Exact proposed experiment

1. Create one unique owner-private `/private/tmp/gsa-recovery-held-parent-*` fixture containing
   separate workspace, recovery, installation and ungranted outside siblings on one filesystem.
   A reference root is unnecessary. Create `workspace/held-<uuid>/item-<uuid>` with known original
   bytes/inode and independent workspace-neighbor, recovery-neighbor and outside canaries.
   No real Test folder, installed identity/installation, VM media, credentials or global settings.
2. Verify source and actual reviewed candidate/build identities; the historical candidate is absent.
   Copy the reviewed unchanged-source candidate into a root-specific signed disposable RecoveryBroker.app.
   Record pre-sign candidate hash, signed artifact hashes, actual entitlements and strict signature
   verification. Stop before launch if pins/profile/loader admission fail; never fabricate evidence.
3. Use the real isolated owner launcher and inherited FD3. Send exactly one adapter `replace`
   for the unique item/transaction, capturing native child PID and original process identity.
   No warm-up mutation, trash, second target, looped candidate launch or automatic retry.
4. Arm a libproc observer restricted to that owned child; observe an open FD with the held
   parent's exact device/inode, send SIGSTOP, verify stopped state, then independently reconfirm
   same process identity and same FD/inode. Observe for at most 4 seconds; mutation watchdog at 26 seconds, absolute child-close deadline 30 seconds; outer owner watchdog 90 seconds and bounded 95-second wait. The observer must not select arbitrary system processes.
5. While stopped, confirm source still exists with original inode/bytes and transaction capture
   has not happened. Otherwise mark INCONCLUSIVE and do not relocate. Record the observed stage;
   holding the FD alone cannot prove capture/publication timing.
6. Rename that one held parent exactly once to a unique child of the ungranted outside sibling.
   Confirm relocated device/inode, original-name absence and unchanged grant-root identities.
   Send SIGCONT only to the verified owned child and collect its bounded native receipt/exit.
7. Preserve the actual mutation reply, then intentionally drop its adapter acknowledgment (test-only
   lost-ack fixture). This leaves the checked coordinator UNKNOWN without journal edits or replay,
   so one readTransaction requests fresh native inspect even after a terminal native outcome.
   This is a lost-ack recovery experiment, not normal acknowledged mutation acceptance.
   Read back both namespaces, source/replacement bytes/hashes/inodes, retained recovery artifacts
   and all canaries before cleanup. Request one adapter transaction readback and record whether it actually invokes native inspect.
   Terminal cached readback cannot certify native inspection; classify it UNVERIFIED. Compare
   pre/post workspace/recovery/outside namespace state and prove zero mutation replay.
   Preserve raw bounded outputs and failed/inconclusive fixtures; never overwrite prior reports.

**Invocation budget:** one mutation-broker invocation plus at most one read-only inspect invocation:
at most two recovery helper launches total. The inspect is not a second relocation/mutation attempt; replay is forbidden.
This budget counts recovery-broker launches; owner, observer and eventual approved build helpers
are separately enumerated and bounded by the reviewed harness, never additional mutation attempts.
Before mutation spawn, exclusively reserve one fixed durable NEW-slot file using O_EXCL.
Reviewer pins its location; no caller-configurable fresh path, deletion, reset or old-ledger edit.
Reservation consumes the attempt even on spawn failure, observer miss, process crash or interrupted run.
Record historical count five plus one new attempt; never change historical reservation state.
If timeout/miss occurs, return INCONCLUSIVE with no repeat. Resume and terminate only owned children;
verify identity before signals, use bounded TERM/KILL cleanup, and never signal unrelated processes.

## Interpretation and review

- **BLOCKING:** source/capture/publication changes the relocated outside directory, or independent
  canaries change through the candidate. Cite criterion §7 and exact receipt/namespace evidence.
- **One-event containment PASS:** verified held-FD relocation preceded effects, relocated source
  and canaries remain unchanged, receipt/readback are honest, and inspect performs no mutation.
- **INCONCLUSIVE:** missed FD/window, stop/identity/stage not proven, or no eligible relocation.
  A native error without the intended event is not a containment PASS.
- Record UNKNOWN/CONFLICT/APPLIED exactly as observed; unexpected output or missing evidence
  remains UNVERIFIED. Reviewer classifies findings; no automatic repair or second experiment.

Even PASS establishes only this event. Recovery stays disabled pending complete review/evidence.
Independent blockers remain journal/fsync interruption and post-capture durability, move/rename
and directory copy, actual macOS host shell/Git containment, and a verified owned-work observer
for process control/recovery. Existing base-file evidence does not close these gaps.
Continue Mac acceptance against unchanged criteria; do not start Windows yet.

## Prepared command (not executed)

```sh
node scripts/test-mac-recovery-parent-probe.mjs --run-one --ack-existing-five-plus-one
```

Fixed NEW reservation: `docs/reports/.recovery-parent-probe-20261023/attempt.json`.
Source/test hashes and independent review are recorded in
`docs/reports/2026-10-23-mac-recovery-probe-preparation.md`. Any script change invalidates review.
Reported capture/publication/restoration after relocation blocks containment even if final bytes
were restored. Cached terminal readback stays UNVERIFIED; no forced UNKNOWN or replay.

## Unresolved round2 blocker — stop here

If ownership checks refuse cleanup signals and the mutation child has not closed by its deadline,
`boundedClose` throws but the checked adapter converts that error to UNKNOWN. The harness can then
launch inspect while the earlier child remains unconfirmed. Required repair: latch cleanup uncertainty
in the transport and refuse every later broker invocation, adapter readback and certification; retain
raw evidence and fixture with UNVERIFIED cleanup. Add a non-native controlled lifecycle regression
for that path. Do not weaken ownership checks or authorize another probe.

Reviewer independently10PASS/syntaxPASS but rejects native-readiness. Two review/repair rounds
reached; report to user before further repair under AGENTS.md workflow11. This proposal is not
ready for quota extension; do not execute the prepared command.

## Superseding extra-repair result

User resumed Mac repair. Permanent lifecycle latch and actual-adapter regression implemented;
reviewer independently11PASS and accepts last blocker resolved at harnessSHA
`e81e1cf01434a5d89723ce4e588148f63f0252f8278d6ebedd47dffdf5b8a2ad`.
The earlier stop/NOT_READY result above is historical. Concrete one-extra quota question is pending;
readiness does not authorize executing this command. See final report section for current hashes.
