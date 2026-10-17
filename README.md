# GSA-Localconnector

An offline GitHub workspace and tool provider for GSA on Windows and macOS. GSA owns reasoning and orchestration; connector supplies direct MCP file/search/edit, version control, process and local CI tools.

The target model gives working workspaces read/write/execute without per-operation approval gates. Optional explicit reference directories permit read/search only, not mutation/execution; data outside granted scopes must remain inaccessible. Windows/Mac use separate plugins/tunnels and may run simultaneously. This source checkpoint does not yet implement the full model; see [current gaps and verification](docs/STATUS.md).

## Project documents

- [User operating logic](docs/CRITERIA.md)
- [Decisions](docs/DECISIONS.md)
- [Source status](docs/STATUS.md)
- [Implementation plan](docs/plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md)
- [Milestone proposals](docs/MILESTONES.md)
- [Workspace model](docs/workspaces/LOCAL-ENROLLMENT.md)
- [Transport setup](docs/tunnel/SETUP.md)

## Build and tests

Node >=20 is required; source CI uses Node 22. Install with `npm ci --ignore-scripts`, then `npm run build` and `npm test`.

Product code is in src/, native/ and scripts/; tests in test/ and product test scripts. Native tests require matching hosts/disposable fixtures. A source build does not certify native or live readiness.

This repository versions product source, CI/build/install/test scripts and project documents. Agent harness, skills and local Codex configuration are excluded; product tests do not require them.
