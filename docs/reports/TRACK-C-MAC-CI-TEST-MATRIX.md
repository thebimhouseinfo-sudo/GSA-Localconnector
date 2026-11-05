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
