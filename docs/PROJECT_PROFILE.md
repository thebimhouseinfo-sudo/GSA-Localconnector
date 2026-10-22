# Project technical profile

- Authority: [CRITERIA.md](CRITERIA.md). Connector supplies capabilities/API consumed by GSA through `gsa-lc-mac` or `gsa-lc`; no local reasoning agent or connector task/review/per-operation approval gates.
- Working roots: full file operations (including copy/move/rename/delete), shell, Git, diff and build/test. Reference roots: list/search/read/copy into working roots only; no reference mutation/direct execution or copy destination. Ungranted project data denied, including via descendants. Existing OS permissions still apply.
- Targets: personal use with independent Windows/Mac plugins/tunnels; finish and accept macOS ARM64 before starting Windows development. Acceptance is per host, without simultaneous multi-machine testing; retain independent multi-project operation on one host.
- Personal-use delivery: local file/Git tools and a runner for existing project scripts/build/tests on the current host. Cross-OS tests belong to a project-specific GitHub CI workflow when needed. No universal test generator, VM lab or advanced professional configuration layer is required. Historical VM components are preserved but are not current delivery prerequisites.
- Project workloads may include Android/iOS app development and testing. These are app targets, not new connector host platforms. Prefer existing local tools/devices; online app testing is an optional integration with its own demonstrated capabilities and authorization, not a new mandatory dependency or VM requirement.
- TypeScript ESM / Node >=20; tsconfig.json is authoritative. Source CI uses Node 22 on macOS, Ubuntu and Windows.
- Swift native helpers with Apple's Virtualization.framework and signing entitlements; Python guest/seed utilities.
- src/core: contracts/policies; src/local: protected persistence; src/hosts: adapters; src/mcp: transport/dispatch; native/: helpers/guest; scripts/: product installation, diagnostics and tests.
- Build: npm run build. Tests: npm test. npm run check is a test alias. No standalone linter.
- Native claims need actual matching host/guest runs; unit tests/compilation do not certify boot, boundary enforcement, restart or live-plugin operation.
- Preserve immutable Ubuntu RAW/digests; native tests use disposable fixtures. Mac evidence does not certify Windows.
- Root identity, revocation, ownership and clean stop protect boundaries; see security/ and [plan](plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md).
- Host App Sandbox is not proof of arbitrary-shell containment. Linux guest execution does not establish macOS SDK support.
- Explicit source role binding/persistence is implemented; legacy `paths` remains read-only for compatibility. Actual Mac files/commands and installed-plugin proof remain gaps; role permissions do not activate unverified backends. See [STATUS.md](STATUS.md).
