# Architecture — GSA-Localconnector

Describes HOW the product is built, from verified [PROJECT_PROFILE.md](PROJECT_PROFILE.md). Product rules live in [CRITERIA.md](CRITERIA.md); do not duplicate them here. Status of work: [STATUS.md](STATUS.md).

## Role in the system
Local MCP connector. GSA reasons and orchestrates; the connector supplies capabilities/API through the `gsa-lc-mac` or `gsa-lc` plugin on the chosen machine. It runs no local reasoning agent and adds no connector-side task/review/per-operation approval gates.

## Components and source paths
| Path | Responsibility |
|---|---|
| `src/core/` | Contracts and policies |
| `src/local/` | Protected persistence (roles, grants, epochs) |
| `src/hosts/` | Host adapters (macOS, Windows) |
| `src/mcp/` | Transport and dispatch (stdio `cli.js`, HTTP `http-cli.js`) |
| `native/` | Swift native helpers (Apple Virtualization.framework, entitlements) and Python guest worker |
| `scripts/` | Product installation, diagnostics and tests |
| `test/` | Node test suite compiled to `dist/test/*.test.js` |

## Boundaries
- Working roots: full file operations, shell, Git, diff, build/test. Reference roots: list/search/read/copy into working roots only. Ungranted data is denied, including via descendants; OS permissions still apply.
- Explicit source role binding/persistence is implemented; legacy `paths` is read-only for compatibility.
- Root identity, revocation, ownership and clean stop protect boundaries (see `security/` and the [plan](plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md)).

## Stack and build
TypeScript ESM, Node >=20 (`tsconfig.json` authoritative). Source CI uses Node 22 on macOS, Ubuntu and Windows. Build `npm run build`; tests `npm test` (builds first); `npm run check` aliases test. No standalone linter. Verified commands are in `harness/common/checks.json`.

## Delivery targets
Personal use with independent Windows/Mac plugins and tunnels. Mac is finished and accepted before Windows development starts; acceptance is per host. The Linux VM worker and historical VM components are preserved but are not delivery prerequisites. Android/iOS are app targets of project workloads, not connector host platforms.

## Known risks and gaps
- Host App Sandbox is not proof of arbitrary-shell containment; a Linux guest does not establish macOS SDK support.
- Actual Mac file/command operation and installed-plugin proof remain gaps; unit tests and compilation do not certify native boot, boundary enforcement, restart or live-plugin operation.
- Role permissions do not activate unverified backends. Mac evidence does not certify Windows.
- Original Ubuntu RAW images and digests are immutable; native tests use disposable fixtures.
