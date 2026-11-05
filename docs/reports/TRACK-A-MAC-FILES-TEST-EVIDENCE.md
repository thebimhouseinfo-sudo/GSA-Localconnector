# Track A — Test Evidence

## GOAL
Record exact revision and distinguish source inspection, automated checks, and unverified native Mac behavior.

**Branch:** `plan/mac-native-ci-vm-retirement-20261105`  
**Exact source + regression test commit:** `c5490cb15920b55827f08928438ab331bfb50981`  
**Readback HEAD when authoring:** `e9bbafe91c0792dac4277b8bd0e4eeccaa7facf4`

## Changed source/tests inspected

- `src/hosts/macos-directory-copy.ts` — source manifest recapture after asynchronous scope/authorization, before `store.create` and any destination effect; a mismatched hash is rejected with `HASH_CONFLICT`.
- `test/mac-directory-copy.test.ts` — new source-drift test expects two source reads, no native destination calls and no durable copy journal when the preflight hash differs.
- `docs/reports/TRACK-A-MAC-FILES-IMPLEMENTATION.md` — bounded pre-code proposal and source inventory.

## Evidence and limits

| Check | Outcome | Basis |
| --- | --- | --- |
| Branch/source blob readback | PASS | GitHub connector reread revised source blob `68d973d174bfb399c6622c8d749b4cb048ae1986` and revised test blob `d01d51024e1fdc69466fc1c04b37974ed1977528` |
| Source regression assertion added | PASS (presence only) | Regression is present in exact test blob; this is not an executed test result |
| `npm run build` on exact source SHA | BLOCKED / NOT EXECUTED | No connected checkout/executable GitHub runner result. Container here cannot resolve GitHub and is not the user's Mac checkout |
| `test/mac-directory-copy.test.ts` | BLOCKED / NOT EXECUTED | Hosted workflow has not delivered step results |
| `test/mac-scoped-installer.test.ts` | BLOCKED / NOT EXECUTED | No current executed result for this revision; real owner test remains deliberately SKIP until physical descendant stop proof |
| Native Mac owner/install/partial crash fixture | BLOCKED | Host qualification/current retained archive and whole-descendant termination proof unavailable. No real native mutation attempted |
| Cross-working-root move, non-Git diff, logs, same-volume atomic rename | UNVERIFIED | No complete implementation/test evidence established in this source slice |

**Observed GitHub Actions:** run `42040999674` for the earlier source commit `72ad48acf842233fdf27434ef21b0e19808ba043` had job `127291456506` `c0-source` QUEUED with no executed steps/conclusion when checked. It cannot establish build/test PASS for the later regression revision.

No automatic retry of an uncertain native mutation. No replacement of a blocked fixture with a synthetic PASS. CI pass, native containment and selected plugin integration remain unverified.

## Evidence update — Track A source candidate cc83ae85

**Exact source/test commit:** `cc83ae852b33abcd2c39afa6013e59f1a3ae1246`. Earlier A3 revision: `c5490cb15920b55827f08928438ab331bfb50981`. Changed files: `src/hosts/macos-scoped-files.ts`, `src/hosts/macos-directory-copy.ts`, `src/local/file-transaction-store.ts`, `native/macos-files/broker.swift`, `native/macos-files/test-broker.py`, `test/mac-directory-copy.test.ts`, `test/mac-scoped-installer.test.ts`, `test/helpers/mac-recovery-installed-fixture.mjs`, `test/mac-file-transaction-log.test.ts`, `test/mac-non-git-diff.test.ts`, `test/mac-directory-rename-native.test.ts`.

| Check | Status | Exact evidence |
| --- | --- | --- |
| GitHub write/readback of A1/A2/A3 source | PASS (persistence only) | Source/test files are visible on the approved branch, not a runtime PASS |
| Existing earlier C0 compile | PASS on *older* revision | GitHub Actions `42041118773` C0 compile completed successfully; source SHA predates A1/A2/A3 additions |
| Earlier C0 exhaustive suite | FAIL, unrelated Track B assertion | `42040999674` failed with actual `/private/var/folders/...` versus expected `/var/folders/...` in `mac-host-commands.test`. Not an A source test failure |
| New exact-source C0/macOS build | QUEUED / UNVERIFIED | GitHub Actions `42045394162` for `cc83ae85...` queued at observation; no runner steps completed |
| New `mac-file-transaction-log` and `mac-non-git-diff` tests | NOT EXECUTED on exact revision | Test source committed; do not infer pass from assertions |
| `mac-directory-rename-native` source compilation | NOT EXECUTED on exact revision | Actual Darwin Swift compile fixture committed |
| `native/macos-files/test-broker.py` signed no-overwrite/symlink/traversal tests | NOT EXECUTED on exact revision | New native tests committed; installed-bundle qualification not proven |
| A1 real native-owner fixture | SKIP / BLOCKED | Fixture remains explicitly skipped pending proof all owned descendants were physically stopped. Registration/cleanup source change alone is not certification |
| Selected installed Mac plugin A1/A2/A3 | BLOCKED | Connector reports `WORKSPACE_ROOT_CHANGED`, no available file backend or grant binding |
| Recoverable cross-root regular-file move | NOT MET | No safe complete cross-root intent + partial readback implementation |

**Evidence limitations:** Linux source inspection is not a macOS native test; source-only Swift compilation does not certify signed sandbox execution; a queued run cannot be reported PASS. Existing C-A full acceptance requires actual signed broker, owner/interruption/no-replay evidence and zero missing mandatory tests. No G1 PASS, no merge/deploy. Full test outcomes remain pending exact-SHA executable verification.

## Verification scope clarification — GitHub macOS runner only

**User instruction (2026-11-05):** For Track A, the current test target is the **GitHub-hosted macOS runner (virtual/hosted CI)** only. Testing on the user's physical Mac is **PENDING USER REQUIRE** and is **not a required acceptance check in this phase**. Earlier references to physical Mac/plugin absence as the immediate test blocker are superseded by this scope clarification. GitHub macOS runner can validate build, unit tests and disposable signed-native fixtures; it cannot prove behavior of the user's installed plugin, which remains separately unverified. Do not mark a missing physical-Mac test as a failure.

**GitHub CI evidence:** Runs `42045394162` and `42046143138` failed **C0 compile**, with `TS2739` at `src/mcp/runtime-bootstrap.ts(85,6)`: the Track A loader had exposed `MacScopedNativeFiles` where its shared consumer expected the existing `NativeScopedFiles`. Corrected **in Track A owned source only** at commit `9eaaaa23cc97d2147961beaaa06552e3f1ac7b75`, returning the original public interface and retaining optional Mac-only internal extensions; no shared runtime-bootstrap edit. **Retest after fix: not yet proven PASS** by a completed exact-SHA runner. CI failure is a real code issue, not an environment failure, and native tests are still pending their own evidence.

**Outstanding distinctions:** A2 cross-root recoverable move remains NOT MET by source, unrelated to where tests run. A1 real-owner fixture intentionally SKIP pending owned-descendant safety proof even on GitHub CI; GitHub runner is not permission to bypass that safety requirement. A3 native rename needs a completed signed broker fixture and CI. Any subsequent runner failure is an actionable source/fixture finding; mark each PASS/FAIL/SKIP/BLOCKED using its actual evidence.
