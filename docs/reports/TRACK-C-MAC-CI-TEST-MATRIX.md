# Track C — exact required test matrix

| Gate | Expected | Current provision | State |
| --- | --- | --- | --- |
| C0 host/toolchain and SHA | Darwin `macos-latest`, Node22, exact HEAD | workflow host identity | IMPLEMENTED, new SHA NOT_RUN |
| C0 installation/build | `npm ci --ignore-scripts`, `npm run build` | workflow steps | IMPLEMENTED, new SHA NOT_RUN |
| C0 non-VM | all compiled non-VM suites, zero skipped/todo; explicit VM exclude | `ci-mac-source-tests.mjs` | IMPLEMENTED, new SHA NOT_RUN |
| C0 source capture | historical Swift source-capture only, not VM runtime | `test-native-source-capture.py` | IMPLEMENTED, new SHA NOT_RUN |
| C-A native files | signed disposable broker, workspace/ref permission negatives, CAS/UNKNOWN/readback, interrupted transactions, helper cleanup/canary | required `ci-mac-a-acceptance.mjs` absent until A integration and assertions | BLOCKED |
| C-B native commands | actual Darwin host, cwd/ref denial, Git/non-Git, stdout/stderr/exit, timeout, owned stop and neighboring canary, process journal | required `ci-mac-b-acceptance.mjs` absent until B integration and assertions | BLOCKED |
| C-G3 artifact/desktop | matching SHA candidate package/manifest/entitlement, harmless startup/shutdown smoke, no secrets/local install | required `ci-mac-g3-acceptance.mjs` absent pending D/integration | BLOCKED |
| G4 installed user Mac | selected plugin, OS permissions/TCC/tunnel/restart | intentionally outside hosted CI | NOT_RUN |

Required gates never use an absent executable, a skipped test, a stub or a source-only PASS as acceptance. `BLOCKED` describes a required check unable to execute; GitHub Actions therefore returns a failing gate job, not a green preinstall signal.

## Continuation implementation status (2026-11-05)

| Gate | Native-safe executable now wired | Still required for acceptance |
| --- | --- | --- |
| C0 | `ci-mac-source-tests.mjs`: all non-VM compiled tests; conditional source SKIPs recorded as SKIP rather than failures | New exact candidate SHA hosted run must complete |
| C-A | `ci-mac-a-acceptance.mjs`: actual ad-hoc-signed Swift file broker, negative scope controls, source CAS/UNKNOWN/readback | integrated interrupted file transaction, physically stopped owned helper and no replay (`ci-mac-a-interruption-proof.mjs` missing); gate FAIL/BLOCKED |
| C-B | `ci-mac-b-acceptance.mjs`: Darwin native host subprocess, Git/non-Git, cancel, neighbor, limits and journal-targeted suites, zero skips mandatory | exact SHA hosted test and integrator MCP/journal caller review |
| C-G3 | `ci-mac-g3-acceptance.mjs`: disposable desktop buildStage + verifyStage, signed UI, manifest and code hash, source package tests | genuine `bin/tunnel-client` absent in repository; runtime startup/shutdown proof and exact combined gate success |
| G4 | Not run | actual selected plugin on real Mac only after G3 and separate user authorization |

A `PASS` from a subset of source tests never substitutes for required host proof. The G3 GitHub job remains deliberately non-green while mandatory upstream/real release prerequisites are missing.

### Execution boundary approved 2026-11-05
GitHub-hosted macOS ARM64 CI testing is in scope now. Physical Mac user device testing: **pending user require**. This deferred physical-device check does not excuse any failing hosted C0/C-A/C-B/G3 gate and is never to be described as PASS.
