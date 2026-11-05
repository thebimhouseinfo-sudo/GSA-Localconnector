# Native Mac Phase 3 — Cross-track consolidation and integration checkpoint (2026-11-05)

## GOAL

Make one accountable integrator own the results of A/B/C/D/E1 on the existing shared development branch; eliminate artificial cross-track writer blocks without weakening actual native file/process or GitHub macOS acceptance. Historical Track reports remain preserved verbatim. This report is an observed integration checkpoint, **not** a G1/G2/G3 or release PASS.

**Repository:** `thebimhouseinfo-sudo/GSA-Localconnector`  
**Only development branch:** `plan/mac-native-ci-vm-retirement-20261105`  
**Observed current source HEAD before writing report:** `9cbb46db81659b3f23584f5badfe2286438a42ba`. The report commit advances HEAD; CI evidence must always use its own exact run/source SHA.

## Consolidated deliverables

| Track | Actual source/report evidence | Integration status / unresolved proof |
|---|---|---|
| A / A1-A3 | `TRACK-A-MAC-FILES-*.md`; candidate signed file broker/rename/diff/log and fixture fixes committed to branch | **PARTIAL**: cross-root recoverable move absent; native owner interruption + physically stopped descendants still unproven; shared file MCP exposure/INT-A and C-A complete evidence outstanding. A reported an explicit safety-blocked tool write to `src/hosts/macos-file-recovery.ts`; it must **not** be bypassed. |
| B / B1-B3 | `TRACK-B-MAC-COMMANDS-*.md`; `src/hosts/macos-host-commands.ts` adapter and process/Git tests already exist | Candidate source integrated into bootstrap and server; **NOT G2 PASS** until actual Darwin native tests and independent review. Network Git remains blocked. |
| C | `TRACK-C-MAC-CI-*.md`; C0/C-A/C-B/C-G3 gates implemented as fail-closed scripts | C0 historical source suite failed 3/636 tests at run `42060878248`; exact post-integration run **PENDING**. C-A explicitly requires unavailable `scripts/ci-mac-a-interruption-proof.mjs` after actual implementation. C-G3 requires genuine `bin/tunnel-client` with pinned origin and hosted stage. Do not stub or skip. |
| D / D1 | `TRACK-D-MAC-DESKTOP-*.md`; desktop/installer, lifecycle, menu UI and test files | Dock accessory mismatch fixed. Dedicated `test/desktop-supervisor.test.mjs` now runs as mandatory C0 suite. **Still missing** safe authoritative retained-work observer and functional Pause/Resume; current `ownedWorkState` returns UNKNOWN and must refuse unsafe Quit. |
| E1 | `TRACK-E1-VM-*.md` (inventory, call graph, E2 proposal and independent doc review) | **E1 documentation DONE**. E2 source deletion remains prohibited until G4 real Mac replacement verification. `SourceCapture.swift` is still consumed by non-VM CI; do not delete blindly. |

## Single-integrator repairs committed on current branch

1. **CI concurrency:** `.github/workflows/ci.yml` now has `cancel-in-progress:false` so another parallel commit does not cancel an in-flight hosted-run evidence record. Commit `dd43085c1298b3c390fd222bd675a142fb8f19f1`.
2. **Desktop test inclusion:** `scripts/ci-mac-source-tests.mjs` now executes the previously missed standalone `test/desktop-supervisor.test.mjs` with zero-skip/fail-closed accounting. Commit `c359b6143f57389beb8b6e15117f841d65a3ee31`.
3. **Desktop Dock:** `native/macos-desktop/Info.plist` `LSUIElement=false`; `App.swift` activates as regular application, replacing previous menu-only accessory. Commits `6bd2e16dae8dab5aae67da6571f1913133f554d6` and `45bf83d60d8398225ac2d9f166951dcc101da86d`. Must still compile/test on hosted Mac; physical visual acceptance deferred.
4. **B native MCP composition:** `src/mcp/runtime-bootstrap.ts` uses existing `MacNativeCommands(registry)` only under verified macOS owner lock; legacy VM runtime/CI is not invoked as production command backend. Existing process journal, file loaders and control leases reused, no duplicate store. Commit `af6a6d4eef2f2f42ecf0180b52d68e987ac70b42`.
5. **Shared status and request routing:** `src/mcp/server.ts` reports `macos-native`, `command_confinement:none (user account)`, `state_integrity_vs_commands:not_protected`, local-only Git state and optional `cwd_relative`. It retains controller/workspace-grant admission; `git-engine.ts` independently rejects remote network Git. `src/mcp/catalog.ts` preserves command names and defaults while exposing optional cwd and truthful native-user execution. Commits `7be30a8eb4aa4dba35b72781f0ccddc2ea7e23ad`, `fc31ecf671cbd6c1f131b201a7ac28dc771b7fae`.
6. **CI diagnostic clarity:** `scripts/ci-mac-source-tests.mjs` now emits actionable failing TAP assertions rather than flooding GitHub logs with 600+ successful tests. Commit `8b38c3b47aa872f1179f821eb8a68975063b5469`.
7. **CI prerequisite ordering:** `g3-preinstall` now starts only after `c0-source` success, instead of generating misleading cascading G3 failures when C0 already fails. Missing native acceptance steps remain fail-closed when G3 is actually reached. Commit `9cbb46db81659b3f23584f5badfe2286438a42ba`.

## Remaining actionable work owned by ONE integration path

| Order | Action | Required completion proof |
|---|---|---|
| 1 | Obtain completed exact-SHA GitHub-hosted macOS C0 on integrated source; inspect native TypeScript compile, 3 historical unit failures and new D tests | Executed job/step logs with failure case names, fixed root cause plus independent rerun; do not accept PENDING/CANCELLED |
| 2 | Finish A2 recoverable cross-working-root file move using existing signed file transaction/journal **only through a permitted source tool/action**, and A1 owner cleanup/interruption fixture with real physically stopped descendant proof | C-A actual signed disposable native test PASS with UNKNOWN/no-replay and working/reference negatives; safety tool rejection not bypassed |
| 3 | Integrate A's journal readback, bounded non-Git diff and native directory rename to the existing MCP surface only when the signed backend's actual operations are verified and old API semantics preserved | G1/C-A zero mandatory SKIP, current controller/grant/owner receipt, no unverified operations advertised |
| 4 | Run B native adapter via production MCP and local Git plus durable process history; fix exact failures found by C-B | G2/C0+C-A+C-B executed exact SHA, no mandatory SKIP, owned stop/neighbor/no replay, working/reference and network policy |
| 5 | Complete Desktop retained-work observer, Pause/Resume, package source identity; obtain genuine tunnel client with authorized provenance and hosted signed stage | D1 tests, Swift compile, native staging and C-G3 PASS on exact source + artifact, not a test stub |
| 6 | After all required hosted checks PASS, request separate Human installation approval for user's real Mac (G4). Test local plugin/workspaces, native files/Git/commands, crash/wake, ownership and real Dock using disposable roots | G4 real Mac evidence only after authorization. **PENDING USER REQUIRE** for physical Mac and **NOT** a blocker for current hosted-source testing |
| 7 | E2 VM runtime deletion ONLY after G4; full import-graph post-integration review and migration of shared CI capture | Independent reversible change + C-VM exact SHA CI, preserve user-owned VM media/historical records |

## Exact current CI evidence

- Historic executed run `42060878248` on older SHA `1693714afcbef10797f9645195f01dd7a804b803`: C0 compiled source tests **FAILED**: 636 tests, 616 pass, 3 fail, 17 skips. The 3 original failure details were not reliably visible in the aggregated GitHub log; the new diagnostics enable root-cause identification on future executed runs. No automatic diagnosis by guess.
- Run `42063713266` at SHA `9cbb46db81659b3f23584f5badfe2286438a42ba` was **PENDING** at observation; no pass/fail claim.
- An earlier run `42063309767` at `8b38c3b47aa872f1179f821eb8a68975063b5469` was **QUEUED**. Historical cancelled runs are not source failures or PASS evidence.

**Current verdict:** `E1 DOC PASS`; integration code checkpoint **COMMITTED/READABLE**, but `G1/G2/G3: NOT YET VERIFIED / BLOCKED`. This is not a completed Mac product phase. No merge into `main`, deployment, real-user Mac install, VM test/repair/deletion or user checkout mutation was performed.

## Coordination correction

**Single branch is a shared persistence surface, NOT five independent integration owners.** The parallel Track reports were assigned overlapping shared runtime/testing dependencies and then their individual scopes prohibited resolving them. All five historical reports are now inputs to ONE integrator who exclusively owns shared MCP files, CI gates and release readiness. Upstream A/D operations may only be advertised after actual reviewed/native proof. Reports must remain honest about historical OPEN findings and exact source versions; do not reclassify CLOSED_BLOCKED agent handoffs as product DONE.

## Phase 3 C0 failure investigation — 2026-11-06

- GitHub-hosted macOS run [42079544146](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42079544146), attempt 2, exact source `835c8d2f6457a83bd88d7a1636bee5bd737f322f`: C0 **FAILED** at 637 tests / 617 pass / 3 fail / 17 skip; G3 skipped due dependency. Job `127453801556` identified failures #427, #428, #429 in `mcp-directory-authority.test.ts`.
- Root cause: directory copy production implementation performs an additional **mandatory source re-capture CAS** before creating the durable intent; test's `captureEvents` expected the previous sequence, omitting the extra `source` observation. This is a positive security check, not a production regression. Test expectation updated to preserve all controller revocation, durable grant, no-disclosure, no-replay, and journal assertions. No production security check or gate removed. Test correction commit `2090fabf1a5f4e24ffb9418cc23ce89edc5d2818`.
- Diagnostic script corrected in `835c8d2f6457a83bd88d7a1636bee5bd737f322f` to expose TAP failing cases. Next exact-HEAD GitHub macOS CI must execute; correction is **not PASS evidence**.
- C-A owner-stop/UNKNOWN and recoverable cross-root move, D Pause/Resume/retained-work, C-G3 genuine signed artifact/tunnel-client provenance and independent review remain **BLOCKED/UNVERIFIED**. Mac physical test/install = `pending user require`. No G4/E2, product VM execution, merge, deploy or fake artifact.

## Hosted CI exact-HEAD checkpoint — 2026-11-06 (run 42098162328)

- Tested HEAD `66045717ca38e0672a560ee8eb43cff33f8614c5` at [GitHub Actions run 42098162328](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42098162328), completed FAILURE. C0 job `127495010485` **SUCCESS** (build, exhaustive compiled suites, Desktop source suite, Swift typecheck and native source capture). Previous three C0 assertions were resolved; no gate relaxed.
- G3 preinstall job `127496057854`: **C-B PASS**, 57 tests / 57 pass / 0 fail / 0 skipped / 0 todo, with native macOS adapter evidence. **C-A FAIL/BLOCKED** after 74/74 compiled tests and real ad-hoc-signed sandbox broker fixture passed: mandatory integrated `scripts/ci-mac-a-interruption-proof.mjs` absent. The broker's ad-hoc signature is not a distributable Developer ID signature and does not satisfy C-G3 packaging.
- **C-G3 FAIL/BLOCKED**: required genuine pinned `bin/tunnel-client` artifact absent; no substitution, stub, or fabricated provenance authorized. Package unit suite 10/10 passed but cannot constitute package acceptance.
- Remaining product proof: recoverable cross-root move, production owner-stop/UNKNOWN/no-replay interruption fixture, Desktop Pause/Resume/retained-work observer, genuine tunnel binary provenance, complete signed package acceptance and independent review. Do not promote C0/C-B partial successes to overall hosted Phase 3 PASS.
- Track E1 remains documentation-only DONE; E2/G4 prohibited. Mac physical test/install remains **pending user require**. No product VM execution, merge, deploy or real Mac action.
- This checkpoint is persisted as a report-only commit and therefore advances HEAD; CI PASS for the new report HEAD has **not** been established. Subsequent CI must be assessed on its own exact SHA.
