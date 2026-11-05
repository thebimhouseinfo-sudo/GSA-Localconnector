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
