# Proposed Mac host bootstrap v2 — literal /dev/null write only

**Status: USER APPROVED ONE SUITE; CONSUMED, DO NOT RERUN.** Exact driver below ran once, all twelve commands started. First eleven observations passed their fixed checks; last nc returned1 without stderr, so original driver verdict remains UNVERIFIED_DENIAL_loopback-denied. Subsequent read-only exact-PID kernel logs corroborate a network-outbound denial; no raw verdict was rewritten. See `docs/reports/2026-10-23-mac-host-bootstrap-v2-native.md`. Fixed v2 slot is consumed; no further native execution is authorized. Driver `scripts/test-mac-host-bootstrap-v2.mjs` SHA256 `0771b002c4f5c793134beee0d8cfa394f6afe5f622f6fa480607591a20d795aa`, profile SHA256 `ac6bd382dcef686e4b990049556f4949563f9acefe92f8b5c3ed28159d1e24fd`. Independent preparation review confirmed nine passing nonnative tests, syntax and read-only plan, with no BLOCKING finding. No production capability activation.

## Evidence and exact change

User-approved v1 driver SHA256 `6535b3f7b6519b9ebd6d26f24402a356260d9656f6987ff580a5b091b0749bac` ran once. Preserved raw result: `/private/tmp/gsa-host-bootstrap-1oQLsa/result.json`; narrative: `docs/reports/2026-10-23-mac-host-bootstrap-native.md`.

Workspace read and shell write/read returned expected bytes without SIGABRT. Shell still warned about denied `/private/var/select/sh` access. Git then exited128: `fatal: could not open '/dev/null' for reading and writing: Operation not permitted`. The suite stopped; nine later cases remain unrun. This is specific evidence for a missing read/write-open bootstrap resource, not general host feasibility or outside-data denial proof.

Keep every existing v1 policy line and case unchanged. Add exactly this one line:

```scheme
(allow file-write-data (literal "/dev/null"))
```

Do not add file-write*, other `/dev` nodes, `/dev` subpaths, selector access, sysctl entries or system directories. Existing `/dev/null` read permission remains. A literal data-write grant permits discarding output through that device; it confers no directory creation, rename, unlink or metadata-write allowance. Whether this is sufficient for Git's open is a hypothesis requiring the separate run; if another denial occurs, stop and report it rather than widening again.

The root-name and two named-sysctl exposures remain exactly as disclosed in v1; neither becomes hidden nor newly approved by this document. Do not read/print kernel boot arguments or lockdown values. Preserve the shell-selector warning as a compatibility limitation; it is not silently repaired.

## Concrete preparation before requesting user approval

Primary implemented the bounded revision inline with the already disclosed Coder/Tester quota limitation. Owned new `scripts/test-mac-host-bootstrap-v2.mjs` and `test/mac-host-bootstrap-v2.test.mjs`, with snapshots. V1 driver is preserved unchanged alongside its raw evidence and consumed slot. No product/native policy/installer or approval-state edits. System-path reporting additionally uses bigint stat to avoid rounded inode numbers; the command runner and its bounds remain identical to v1.

The distinct v2 driver uses fixed slot `docs/reports/.mac-host-bootstrap-v2.attempt.json` and exact acknowledgement `--ack-reviewed-dev-null-variant`. Concrete command after review and approval:

```bash
node scripts/test-mac-host-bootstrap-v2.mjs --run --ack-reviewed-dev-null-variant
```

The v1 acknowledgement must not authorize v2. Default/no args and `--plan` remain read-only, showing the v2 policy delta, actual driver/profile hashes, reservation, case budget and explicit approval pending. The command is proposed until the concrete revised driver/tests are reviewed; a paper proposal grants no run permission.

Tests must assert the profile differs from the recorded v1 profile by exactly the one allow line; unchanged cases/order, timeout/output limits, denial classification and first-failure stop; new fixed slot and acknowledgement; old acknowledgement rejected; no native launch for default/plan or deterministic tests; consumed v2 slot prevents another run. Do not introduce configurable policy additions or slot paths.

Independent review checks the exact revised driver/profile hashes, minimal delta, guard and command. Only then request explicit approval for **one additional v2 suite**. User's earlier v1 approval is consumed and general continuation does not extend it. Record any review-role unavailability honestly instead of claiming independent acceptance.

## Fixed execution bounds if separately approved

Reuse all v1 fixture isolation, credential/descriptor exclusions, declared read-only system/toolchain resources, synthetic world-readable outside/reference markers, namespace/hash/inode canaries and loopback-only network control. Use a new private disposable fixture; no real Test/project/installation/identity, external network or VM media.

Run the same 12 ordered sandbox cases once: workspace read; workspace shell write/read; Git version; synthetic make script; bounded root-name count/hash; direct outside read denial; nested outside read denial; symlink escape denial; outside write denial; reference write denial; reference script denial; loopback network denial. Earlier positive cases are repeated only because they validate the changed exact profile. No resume from case4, hidden baseline launch, ladder or retry.

Each sandbox child remains bounded to5s and16KiB combined output, entire suite≤60s, maximum12 launches. Stop immediately on the first positive failure, escape, timeout, output limit or unclassified denial. SIGABRT/generic failure is not a negative-control PASS. Persist shell warnings and bounded raw receipts honestly. Cleanup remains restricted to owned children/fixture identities.

Before any sandbox launch reserve the fixed v2 slot exclusively (O_CREAT|O_EXCL|O_NOFOLLOW, mode0600), fsync it and its directory, pin the approved driver/profile hashes and planned case budget. Consume even on spawn failure/crash; reserve each launch before spawning. Never reset/delete either slot, replay missing cases or treat v2 as unused v1 allowance. Preserve failing/inconclusive fixture and raw report.

## Interpretation

At most, success proves these observations on this exact v2 profile/host/toolchain. Process-domain containment, setsid/double-fork ownership, revocation of existing handles, root-identity races, durable cancel/restart and full native SDK/Git workflows remain UNVERIFIED. Production shell/Git stay blocked; Windows waits for full Mac acceptance. Another failure permits reporting and a concrete next decision, not another automatic variant or suite.
