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
