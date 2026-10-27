# GSA-Localconnector

Local capabilities and MCP APIs for GSA through `gsa-lc-mac` or `gsa-lc`. GSA owns reasoning and orchestration; the connector targets file/search/edit, Git, process and existing project build/test tools on the selected machine.

The target model gives working workspaces full file operations, including copy/move/rename/delete, shell, Git, diff and build/test without per-operation approval gates. Explicit references permit list/search/read and copy out into a workspace, never mutation or direct execution in the reference. Data outside granted scopes must remain inaccessible. Windows/Mac use separate plugins/tunnels; complete Mac before Windows development. Personal-use acceptance checks each host separately and keeps projects independent on that host. Tests use the current actual host and installed tools; cross-OS project checks can use GitHub CI when needed. No new VM or connector CI engine is required. This source checkpoint does not yet implement the full model; see [current gaps and verification](docs/STATUS.md).

The source binding API accepts explicit workspace/reference roles and retains the legacy read-only `paths` form. Role grants describe intended scope; they do not activate missing native backends. See the [binding contract and examples](docs/workspaces/LOCAL-ENROLLMENT.md).

## Project documents

- [User operating logic](docs/CRITERIA.md)
- [Decisions](docs/DECISIONS.md)
- [Source status](docs/STATUS.md)
- [Implementation plan](docs/plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md)
- [Criteria-to-source assessment](docs/plans/CRITERIA-TRACEABILITY.md)
- [Milestone proposals](docs/MILESTONES.md)
- [First Mac boundary feasibility plan](docs/plans/M1-MAC-BOUNDARY-FEASIBILITY.md)
- [Workspace model](docs/workspaces/LOCAL-ENROLLMENT.md)
- [Transport setup](docs/tunnel/SETUP.md)

## Build and tests

Node >=20 is required; source CI uses Node 22. Install with `npm ci --ignore-scripts`, then `npm run build` and `npm test`.

Product code is in src/, native/ and scripts/; tests in test/ and product test scripts. Native tests require matching hosts/disposable fixtures. A source build does not certify native or live readiness.

This repository versions product source, CI/build/install/test scripts and project documents. Agent harness, skills and local Codex configuration are excluded; product tests do not require them.
