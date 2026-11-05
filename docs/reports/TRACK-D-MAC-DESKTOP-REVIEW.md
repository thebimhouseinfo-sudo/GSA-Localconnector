# Track D D1 — bounded coder self-review

Date: 2026-11-05. Independent reviewer PASS is not claimed.

## Findings
- **D-R01 HIGH OPEN:** Adapter `ownedWorkState` always returns UNKNOWN. This correctly prevents unsafe termination but blocks fully working Pause/Resume/Quit. Requires authoritative work observer.
- **D-R02 HIGH OPEN:** `LSUIElement=true` plus `NSApp.setActivationPolicy(.accessory)` may conflict with requested Dock application. Resolve product UI before acceptance.
- **D-R03 MEDIUM PARTIAL:** Quit previously called NSApp terminate and always cancelled with a running supervisor. Updated to ask retained supervisor for graceful exit. No forced kill, but must run on actual Mac and must not bypass UNKNOWN.
- **D-R04 MEDIUM OPEN:** Crash/restart/wake and safe no-replay are not accepted without exact hosted/local evidence.
- **D-R05 TEST OPEN:** New tests, Swift build and hosted CI are not executed on modified SHA.
- **D-R06 SECRET PARTIAL:** `.env` ignored, private-file verification and API key redaction observed in source; live credential and package leak test unavailable.

## GOAL recheck
| Criterion | State |
|---|---|
| Key and saved tunnel private configuration | PARTIAL (source) |
| Login/background & Dock icon | UNVERIFIED / D-R02 |
| Tunnel loss/reconnect | PARTIAL (new unexecuted tests) |
| Pause/Resume | NOT MET |
| Quit only owned processes | PARTIAL / D-R01 |
| Restart/wake | UNVERIFIED |
| GitHub-hosted exact SHA CI | UNVERIFIED |
| Installed Mac acceptance | PENDING G4/M5 |

No D1 PASS, no merge/deploy/install claim.

## Test scope confirmation — Human decision 2026-11-05
- Current required execution environment: **GitHub-hosted macOS runner only** (`macos-latest`). Do not install or test on the user's physical Mac during this phase.
- Real-Mac Dock interaction, Login Items/background after actual login, live tunnel/API credentials, sleep/wake behavior, physical-process coexistence and installed-plugin acceptance: **pending user require**.
- **pending user require** is a deferred user-dependent acceptance item, not a hosted-CI failure and not evidence of physical Mac PASS. It must not block declaring the *hosted-only test phase* complete once all mandatory hosted checks have actually passed; it still blocks claiming real-Mac acceptance.
- Latest inspected branch SHA before this documentation revision: `9eaaaa23cc97d2147961beaaa06552e3f1ac7b75`. GitHub Actions push run [42059630490](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42059630490) was **IN_PROGRESS**; `c0-source` had successful checkout, tool setup and host identification, dependencies still in progress. PR run [42059643485](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42059643485) was **PENDING**. Do not claim CI PASS until completed exact-SHA evidence exists.

## Autonomous re-review, latest available evidence
- **D-R07 BLOCKED_EXTERNAL_OWNER:** Current CI excludes direct `test/desktop-supervisor.test.mjs` execution, and frequent branch updates cancel jobs. Requires Track C-owned workflow wiring and exact revision green log evidence. No false PASS from queued/cancelled run.
- **D-R08 HISTORIC_INTEGRATION_FAILURE:** TS2739 at old SHA in shared `runtime-bootstrap.ts` / `NativeScopedFiles`; source is owned by Integrator/Track A. Current HEAD build status remains unverified; do not treat old red run as present failure.
- **D-R09 CURRENT_STATUS:** D1 has unfinished functional items (Pause/Resume, authoritative IDLE observer, Dock activation policy) independently of the CI issue. These remain open software findings, not physical-host deferrals.
- **Host test disposition:** GitHub macOS runner only is requested now; real Mac tests **pending user require**. This defers physical acceptance but does not excuse missing hosted checks or missing software features.
- **Closure:** BLOCKED / no D1 completion claim. All edits stayed within Track D ownership; no merge/install/deploy performed.
