# Independent source / hosted-CI Pre-local Readiness Review — 2026-11-06

**Verdict: CHANGES_REQUIRED — NOT_READY_FOR_LOCAL_TEST.**  
**Repository:** `thebimhouseinfo-sudo/GSA-Localconnector`  
**Source revision reviewed:** `42bdbecd3fcadcb2f611e9baa02c25363566ae93`  
**Branch:** `plan/mac-native-ci-vm-retirement-20261105`  
**Authorized testing environment:** GitHub-hosted macOS only; user's actual Mac is **PENDING USER REQUIRE**.

## Real positive evidence

GitHub Actions [run #42163752457](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42163752457) completed **SUCCESS** on this exact source revision. Both `c0-source` and `g3-preinstall` passed; mandatory C0, C-A, C-B and C-G3 CI steps passed. Native signed base broker, native signed recovery-broker candidate, actual FD3 owner, production `FileTransactionStore` + `createMacFileRecovery` coordinator, intentionally dropped ACK, journal `UNKNOWN` → explicit `APPLIED` readback, no replay, and direct fixture-owned PID/process-group stop were exercised on hosted Darwin. Official pinned tunnel-client v0.0.14 artifact staging + source-identity package manifest passed. **No user's Mac or live connector was installed/tested.**

**Evidence boundary:** The C-A interruption fixture explicitly says `checked installed-loader qualification and arbitrary escaped descendants not covered`. Its coordinator is supplied a disposable signed-broker invocation directly; it does **not** call production `loadCheckedMacRecoveryInstallation` with a newly independently qualified exact-source installed artifact. C-A green does not turn that untested boundary into PASS.

## Findings against APPROVED `docs/CRITERIA.md` and native Mac plan

| Finding | Severity | Status | Concrete mismatch / route |
|---|---|---|---|
| PL-R01 — Cross-working-root recoverable file MOVE | IMPORTANT | **OPEN** | Approved workspace A↔B move and durable crash-aware no-replay semantics are required. `src/hosts/macos-scoped-files.ts` exposes same-root source-broker `moveExclusive`; `supportedOperations` omits `move_file`. `src/hosts/macos-file-recovery.ts` currently supplies replace/trash only, not cross-root move coordinator. A2/INT-A must implement and exercise native positive, reference-denial, changed-source CAS, partial/UNKNOWN/replay negatives without copying outside approved roots or bypassing a prior GitHub safety tool rejection. |
| PL-R02 — Desktop Pause/Resume and safe retained-work observer | IMPORTANT | **OPEN** | Approved `docs/DECISIONS.md` requires a Dock app exposing Pause/Resume and Quit. `native/macos-desktop/App.swift` does not implement Pause/Resume; `scripts/mac-desktop-adapter.mjs` returns constant `ownedWorkState: async () => "UNKNOWN"`. Safe Quit correctly refuses uncontrolled work, but Desktop lifecycle cannot yet perform the required pause/resume/idle decision. Implement a genuine auditable admission/control state and run hosted UI/supervisor tests; never fake idle or terminate unrelated work. |
| PL-R03 — Production checked installation qualification / unknown descendants | IMPORTANT | **OPEN** | Native C-A passed a real signed broker and the core transaction coordinator, but production loader's exact host/source qualification path through `loadCheckedMacRecoveryInstallation` remains unproven on hosted source. Old Mac27 archive is host-bound and not interchangeable with the current runner. Direct known helper PIDs are physically absent, but arbitrary escaped-descendant exclusion is not established by process-group ESRCH alone. The fixture must preserve evidence on uncertainty; implement signed qualified disposable installation/owner proof before promoting recovery availability. |
| PL-R04 — Shared MCP file feature coverage | IMPORTANT | **OPEN** | Mac-only non-Git text diff, journal log viewer, and native directory rename exist as candidates/extensions; approved workspace/ref file APIs still need verified shared MCP contracts, authorization and run/workspace visibility. A native candidate method by itself is not selected-plugin acceptance. INT-A must test actual dispatched entrypoints before advertising capabilities. |
| PL-R05 — CI/feature acceptance parity | IMPORTANT | **OPEN** | Current C0/C-A/C-B/C-G3 suite is **actually green**, but it does not cover the missing A2 cross-root MOVE, D1 Pause/Resume, production checked-loader qualification or entire MCP file-dispatch surface. Therefore successful CI is NOT proof that all approved Criteria are met. Add native mandatory regression oracles for each missing feature as implemented; never mark complete just by static presence checks or test stubs. |

## Decisions

- **CI candidate gate (as currently defined): PASS**, exact revision above. No evidence of failure in the current hosted tests.
- **Full approved Mac product feature readiness for user's local testing: CHANGES_REQUIRED.** Do not recommend running `install.sh` yet.
- **User's existing local checkout/grants/unpushed files: UNKNOWN/protected**; inspect/reconcile only after obtaining explicit local-test authorization, without overwriting old data.
- **Real Mac install/test:** PENDING USER REQUIRE; **not** a prerequisite to further GitHub hosted coding/test.
- **VM retirement E2:** prohibited until independent G4 real Mac replacement acceptance; not a prelocal gate.
- **No new branch, no `main` merge, no deploy, no local installation** in this review.

## Exact next gate

1. Implement and test PL-R01/02/03/04, using current approved architecture and explicit source-owner boundaries; retain the historical Track A safety-tool BLOCKED disposition rather than bypassing it.
2. Extend hosted native acceptance tests to cover changed capabilities, including actual current-controller/workspace/reference denial and unknown/no-replay under interruption.
3. Independent review/test the same exact release-candidate SHA. Only if all mandatory hosted tests AND all prelocal-required Criteria items are met may a later **PRELOCAL_READY** report be recorded; then **stop before touching the user's Mac**.
