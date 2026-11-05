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
