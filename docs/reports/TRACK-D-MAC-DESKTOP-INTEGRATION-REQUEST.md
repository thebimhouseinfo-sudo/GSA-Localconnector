# Track D D1 — integration requests

Date: 2026-11-05. Destination: Mac Integration Agent / G3-G4-M5 owners.

1. **D-INT-01:** supply authoritative IDLE/ACTIVE/UNKNOWN retained-work observer while preserving safe refusal of kill on ACTIVE/UNKNOWN; shared MCP/process integration belongs solely to integrator.
2. **D-INT-02:** reconcile requested Dock app with existing `LSUIElement=true` / accessory activation and verify selected icon on Mac.
3. **D-INT-03:** implement validated Pause/Resume using connector-owned processes only, no duplicate retained-work replay and no forced neighbor termination.
4. **D-INT-04:** include desktop-supervisor regression, native Swift compile and package fixture in required GitHub-hosted macOS G3 checks bound to exact candidate SHA.
5. **D-INT-05:** after separate authorization, run G4/M5 real Mac Dock, login, saved .env, tunnel, wake, crash, graceful stop and neighbor-process tests. Native CI PASS never substitutes for real Mac acceptance.
6. **D-INT-06:** `docs/reports/` is ignored in .gitignore; these mandatory reports are explicitly GitHub-committed through contents API.

Track D did not modify shared `src/mcp/{server,catalog,runtime-bootstrap,write-dispatch,batch-dispatch}.ts`, and must not install, merge or deploy.

## CI integration blocker observed
- C0 runs compiled `dist/test/*.test.js` through `scripts/ci-mac-source-tests.mjs`, but Track D's `test/desktop-supervisor.test.mjs` is outside this discovery. Add an explicit required native-safe Track D command `node --test test/desktop-supervisor.test.mjs` in Track C's CI ownership; fail on skipped/todo tests.
- At observation time `scripts/ci-mac-g3-acceptance.mjs` was missing. Track C must supply a required macOS desktop package/Swift fixture gate or report G3 BLOCKED; never mark PASS from C0 alone.
- Run https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42044118681 was queued at `f6c2cea47b369654712390dffed3fb8b939c5b56`, not a PASS. Recheck exact source SHA and executed job steps after Track C update.

## Test scope confirmation — Human decision 2026-11-05
- Current required execution environment: **GitHub-hosted macOS runner only** (`macos-latest`). Do not install or test on the user's physical Mac during this phase.
- Real-Mac Dock interaction, Login Items/background after actual login, live tunnel/API credentials, sleep/wake behavior, physical-process coexistence and installed-plugin acceptance: **pending user require**.
- **pending user require** is a deferred user-dependent acceptance item, not a hosted-CI failure and not evidence of physical Mac PASS. It must not block declaring the *hosted-only test phase* complete once all mandatory hosted checks have actually passed; it still blocks claiming real-Mac acceptance.
- Latest inspected branch SHA before this documentation revision: `9eaaaa23cc97d2147961beaaa06552e3f1ac7b75`. GitHub Actions push run [42059630490](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42059630490) was **IN_PROGRESS**; `c0-source` had successful checkout, tool setup and host identification, dependencies still in progress. PR run [42059643485](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42059643485) was **PENDING**. Do not claim CI PASS until completed exact-SHA evidence exists.

## Exact external-owner blockers for D1 CI closure (2026-11-05)
1. Track C must execute `node --test --test-reporter=tap test/desktop-supervisor.test.mjs` as a mandatory non-skippable `macos-latest` step; current compiled-test discovery omits this .mjs suite. The report must record tests/pass/fail/skipped and source SHA.
2. Track C must execute native Swift AppKit compile and desktop package/smoke tests on a disposable GitHub macOS runner; prevent live login/tunnel changes; G3 existing package gate alone does not establish D1 coverage.
3. Track A/Integration should inspect TS2739 prior failed CI at run `42046143138` (legacy source SHA `c6fa97f`). Do not override source ownership or assume still failing.
4. Once CI wiring and D1 code findings are resolved, obtain a completed exact-HEAD hosted macOS run, independently inspect job steps/logs, then update the D1 test evidence and review statuses.
5. Real Mac execution remains expressly **pending user require**, outside hosted-only completion.
