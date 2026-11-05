# Track A — Scoped Coder Review

## GOAL
Review the exact Track A diff without claiming an independent Reviewer PASS or native qualification.

**Branch:** `plan/mac-native-ci-vm-retirement-20261105`  
**Source/test commit:** `c5490cb15920b55827f08928438ab331bfb50981`  
**Readback HEAD at review report creation:** `d5d3718a34e677acfcd6608afa77123af71cb82b`

## In-scope diff review

- `src/hosts/macos-directory-copy.ts`: extra validated capture is read-only and occurs **before** `DirectoryCopyStore.create`, `base.makeDirectory`, or `base.createExclusive`. Role checks are repeated after recapture. Does not add an installer, journal, schema, grant, authority or activation switch.
- `test/mac-directory-copy.test.ts`: positive evidence of regression oracle construction; injected changed source manifest causes rejection before any destination namespace calls or journal creation. Test execution still pending.
- Existing A1 native-owner fixture is explicitly skipped because original process-group absence cannot prove an escaped descendant is absent. It was not enabled or run here; prior handoff requirements remain open.
- A2 and A3 capabilities absent from shared interfaces were not patched through disallowed MCP/core files. No Track B/C/D/E files touched by this Coder.

## Findings and disposition

| ID | Severity | Status | Finding / routing |
| --- | --- | --- | --- |
| A-R01 | MAJOR | OPEN / BLOCKED | Native-owned group stop and escaped-descendant proof not established; do not rerun unsafe fixture or activate recovery |
| A-R02 | MAJOR | OPEN / BLOCKED | Full A2 cross-root move, non-Git diff and durable operation-log reader not implemented/verified; INT-A shared entry points need defined interface |
| A-R03 | MAJOR | OPEN / BLOCKED | Full A3 same-root/same-volume atomic directory rename and native positive/negative proof not delivered |
| A-R04 | MAJOR | OPEN / BLOCKED | Exact-SHA build/unit/native CI not completed; newly added regression has no executed result |
| A-R05 | MINOR | DOCUMENTED | Recapture is a preflight observed CAS only; a subsequent native filesystem change remains possible and must be handled by the broker/no-replay model |

**Self-review verdict:** PARTIAL, not independent Reviewer PASS; implementation cannot be marked DONE for A1/A2/A3 and cannot pass G1. No authorization to merge/deploy. Next reviewer should examine A-R01 through A-R05 after substantive A1/A2/A3 changes and executed checks.
