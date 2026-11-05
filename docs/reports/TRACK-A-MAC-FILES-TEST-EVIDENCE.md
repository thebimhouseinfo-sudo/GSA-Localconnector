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
