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

## Post-implementation self-review — cc83ae85

**Exact reviewed source/test commit:** `cc83ae852b33abcd2c39afa6013e59f1a3ae1246`; prior source `c5490cb15920b55827f08928438ab331bfb50981`. **Changed files:** `src/hosts/macos-directory-copy.ts`, `src/hosts/macos-scoped-files.ts`, `src/local/file-transaction-store.ts`, `native/macos-files/broker.swift`, `native/macos-files/test-broker.py`, `test/mac-directory-copy.test.ts`, `test/mac-scoped-installer.test.ts`, `test/helpers/mac-recovery-installed-fixture.mjs`, `test/mac-file-transaction-log.test.ts`, `test/mac-non-git-diff.test.ts`, `test/mac-directory-rename-native.test.ts`.

**Observed code properties:** Scope checks are performed for Mac-only rename before invoking a per-root signed broker. The broker's directory move uses the native exclusive no-follow beneath flags, verifies directory inode at destination and returns uncertainty on post-publication proof failure. Directory copy recaptures source before durable intent. The transaction log is a bounded authorized read over the existing journal, not a second engine. Text diff accepts only a bounded explicit UTF-8 baseline and uses the verified native read path. Fixture captures PID of each directly spawned process; its blocked real-owner test has not been unsafely re-enabled.

| Finding | Severity | Current disposition |
| --- | --- | --- |
| A-R01 Full child/group descendant physical-stop and signed-owner fixture | MAJOR | BLOCKED: direct PID inventory improves cleanup but has not been exercised with qualified native owner; retained fixture policy remains |
| A-R02 Cross-working-root durable regular-file MOVE | MAJOR | NOT_MET: absent complete capture/publish/delete/readback partial outcome and no-replay proof; cannot emulate atomic cross-volume rename |
| A-R03 Atomic directory rename signed runtime evidence | MAJOR | BLOCKED: Swift broker/tests source supplied; actual signed disposable execution, grant revocation and race negatives not observed |
| A-R04 Exact source test/CI | MAJOR | BLOCKED: GitHub macOS run `42045394162` queued; earlier C0 compile on older SHA only; prior suite failure belongs Track B |
| A-R05 Non-atomic directory copy observed manifest | MINOR | OPEN: preflight CAS narrows drift window but is not atomic; post-dispatch external mutation must be reported uncertain |
| A-R06 Diff baseline and log MCP consumer contract | MAJOR | INTEGRATION REQUEST: Mac-only methods and authorized store reader exist, but front-end baseline capture/persistence, exposure and filtered API require INT-A; do not advertise |
| A-R07 Native source-swap race | MAJOR | BLOCKED: held directory identity/post-rename check can detect wrong inode after an adversarial same-root swap, but no kernel source-content CAS exists; runtime native adversarial test required; UNKNOWN on uncertainty |

**Self-review result: CHANGES_REQUIRED / PARTIAL**, not independent Reviewer PASS, not G1 PASS. Tests on exact SHA are queued/unverified. In-scope source additions remain candidate-only; unresolved required A2 move and required native tests prevent closing Track A. No code outside Track A was changed by this coder and no forced Git update, merge or deployment was attempted.
