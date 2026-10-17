# Project technical profile

- Authority: [CRITERIA.md](CRITERIA.md). Offline GitHub workspace/tools; no connector task/review/per-operation approval gates.
- Working roots: read/write/execute. Explicit design/knowledge references: read/search only, no mutation/execution. Ungranted project data denied, including via descendants.
- Targets: independent concurrent Windows/Mac plugins/tunnels; current priority macOS ARM64.
- TypeScript ESM / Node >=20; tsconfig.json is authoritative. Source CI uses Node 22 on macOS, Ubuntu and Windows.
- Swift native helpers with Apple's Virtualization.framework and signing entitlements; Python guest/seed utilities.
- src/core: contracts/policies; src/local: protected persistence; src/hosts: adapters; src/mcp: transport/dispatch; native/: helpers/guest; scripts/: product installation, diagnostics and tests.
- Build: npm run build. Tests: npm test. npm run check is a test alias. No standalone linter.
- Native claims need actual matching host/guest runs; unit tests/compilation do not certify boot, boundary enforcement, restart or live-plugin operation.
- Preserve immutable Ubuntu RAW/digests; native tests use disposable fixtures. Mac evidence does not certify Windows.
- Root identity, revocation, ownership and clean stop protect boundaries; see security/ and [plan](plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md).
- Host App Sandbox is not proof of arbitrary-shell containment. Linux guest execution does not establish macOS SDK support.
- Legacy read-only binding/separate execute grants are gaps against criteria; see [STATUS.md](STATUS.md).
