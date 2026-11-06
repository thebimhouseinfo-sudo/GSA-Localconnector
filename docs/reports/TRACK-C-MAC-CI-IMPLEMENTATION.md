# Track C — GitHub-hosted macOS CI implementation

## GOAL
Build a fail-closed CI boundary for C0/C-A/C-B/C-G3 without claiming source-only checks prove an installed connector.

Branch: `plan/mac-native-ci-vm-retirement-20261105`. Baseline at authoring: `1cb77c271328bf20dd466875bda5c6575762fb90`.

Ownership: only `.github/workflows/ci.yml`, `scripts/ci-mac-*`, and Track C reports. No shared package/test registry edit.

- C0: hosted `macos-latest`, Node 22, `npm ci --ignore-scripts`, `npm run build`, dynamically discover every compiled test except the three explicit legacy `macos-vm-{artifacts,ci,runtime}` suites. Unknown VM suite fails rather than silently excludes. TAP summary requires all cases PASS, zero fail/skip/todo. Existing source-capture fixture compiles a Swift helper but never runs the product VM.
- Identity: checkout must equal `GITHUB_SHA`; log macOS, architecture, Xcode/Swift/Node/npm and package-lock SHA256.
- Separate G3 job: calls C-A, C-B, and C-G3 mandatory acceptance entrypoints. Missing entries exit 2 (BLOCKED) and produce failing checks; no skip-to-success. All three steps execute even after one fails.
- Current Track A/B native adapters and shared integrator must supply tested acceptance assertions before matching C-owned entrypoints are added. This avoids cosmetic green based on legacy tests.
- G3 cannot PASS without actual A/B/packaging assertions on the same candidate revision. Hosted CI never installs to the user's Mac and cannot certify TCC/tunnel/login.

The script prefix is reserved for CI-only Track C. No VM/QEMU/guest command is introduced.
