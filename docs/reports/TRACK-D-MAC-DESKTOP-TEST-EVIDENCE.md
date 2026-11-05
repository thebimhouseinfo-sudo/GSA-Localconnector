# Track D D1 — test evidence

Date: 2026-11-05; branch: `plan/mac-native-ci-vm-retirement-20261105`. Track D source commits: `be638b334de7c5017620e574bf615a7a7b5409fa`, `29f4f43e3040ff22c7c185cf237c384e6bde983c`.

## Test cases added
- CONNECTED → DISCONNECTED → UNKNOWN → CONNECTING → CONNECTED retains exactly one child and signals no child/neighbor.
- ACTIVE retained work refuses stop with `ACTIVE_WORK_PRESENT` and leaves child and neighbor untouched.

Existing tests cover setup, secret env, owner lock, IDLE/UNKNOWN stop, crash exit, auth reject, split-chunk redaction and ownership release.

## Execution
- GitHub source read, individual source commits and blob readback: **OBSERVED**.
- `node --test test/desktop-supervisor.test.mjs`: **NOT RUN** on exact modified revision.
- `npm run build`, Swift AppKit build, package lifecycle and GitHub-hosted macOS runner: **NOT VERIFIED**. This agent has no checked-out repo or attached macOS execution surface; direct container GitHub DNS failed.
- Real Mac Dock/login, tunnel credentials, wake/restart, Pause/Resume/Quit, unrelated apps: **PENDING G4/M5**, not tested.

GitHub CI PASS cannot substitute real Mac Dock/login/tunnel acceptance. No historic source-only test is counted as current-revision PASS.

## Hosted GitHub Actions inspection (same day)
- Workflow `.github/workflows/ci.yml` uses `macos-latest`, Node 22, `npm ci --ignore-scripts`, `npm run build`, `node scripts/ci-mac-source-tests.mjs`, source capture and G3 required gates.
- Push run **42044118681** at `f6c2cea47b369654712390dffed3fb8b939c5b56`: `c0-source` observed **QUEUED** (no runner steps executed) at inspection; https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42044118681 . A corresponding pull-request run **42044126489** was also queued.
- Earlier run **42041391352** (different SHA) had completed host identification, dependencies and compile; its non-VM suite remained **IN_PROGRESS** when inspected. Not proof for D1.
- `scripts/ci-mac-source-tests.mjs` discovers only `dist/test/*.test.js`, so it does **not** invoke `test/desktop-supervisor.test.mjs`. No D1 lifecycle test execution is verified by C0.
- `scripts/ci-mac-g3-acceptance.mjs` was absent on branch at the time of reading; workflow's required G3 gate cannot be reported as passing.
- Only GitHub-hosted macOS **CI** is authorized here. A runner is a disposable hosted Mac, not the user's installed login-session Mac; real Dock/login/TCC/tunnel remain PENDING G4/M5.

## Test scope confirmation — Human decision 2026-11-05
- Current required execution environment: **GitHub-hosted macOS runner only** (`macos-latest`). Do not install or test on the user's physical Mac during this phase.
- Real-Mac Dock interaction, Login Items/background after actual login, live tunnel/API credentials, sleep/wake behavior, physical-process coexistence and installed-plugin acceptance: **pending user require**.
- **pending user require** is a deferred user-dependent acceptance item, not a hosted-CI failure and not evidence of physical Mac PASS. It must not block declaring the *hosted-only test phase* complete once all mandatory hosted checks have actually passed; it still blocks claiming real-Mac acceptance.
- Latest inspected branch SHA before this documentation revision: `9eaaaa23cc97d2147961beaaa06552e3f1ac7b75`. GitHub Actions push run [42059630490](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42059630490) was **IN_PROGRESS**; `c0-source` had successful checkout, tool setup and host identification, dependencies still in progress. PR run [42059643485](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42059643485) was **PENDING**. Do not claim CI PASS until completed exact-SHA evidence exists.
