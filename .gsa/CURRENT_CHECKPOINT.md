# GSA-Localconnector — Current checkpoint

Date: 2026-10-16
Stage: P0-01 baseline recorded; PX-01 bootstrap source committed, **tests not yet verified**.

## Resume instructions
1. Read `.gsa/BASELINE.md`, this checkpoint, and `docs/plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md`.
2. Inspect HEAD and latest CI runs; do not claim PASS without run evidence.
3. Run `npm install --ignore-scripts && npm test` on Windows and macOS. Fix any TypeScript and test failures.
4. Implement durable trusted workspace registration and MCP transport with direct typed tools only after reviewing security boundaries.
5. Prioritize PX-04/PX-05 native OS isolation prototypes before exposing shell or local CI.

## Committed bootstrap
- TypeScript project and host-neutral contracts.
- Windows/macOS adapter detection; shell isolation and local CI intentionally BLOCKED.
- In-memory trusted workspace read resolver (not a security sandbox and not public enrollment).
- Unit tests for unsupported platform, traversal, symlink escape and grants.
- GitHub Actions cross-platform *source contract* CI, distinct from the future local CI runner.

## Known limitations
- MCP transport, autostart, privileged runtime, persistent registry and local-only CI are not implemented.
- Actual Windows/macOS tests have not yet been observed to PASS.
- No local shell/CI capability is enabled.

## Checkpoint discipline
After each verified ticket, update this file with Git HEAD, exact test results/evidence, blockers and next action. Keep BASELINE immutable. Resume from actual latest evidence, not optimistic status labels.

## CI execution checkpoint — 2026-10-16
- Initial cross-platform CI run `38836862166`: Ubuntu PASS; macOS FAILED, Windows test step FAILED/cancelled. Root cause not verified from logs; a canonical-path comparison issue was identified as a plausible cause.
- Test assertion revised in commit `df178b4a143a6b7997c503ec44572ce054ee269a` to compare `realpath` instead of lexically assembled target.
- CI for this revision: https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38836950377 (QUEUED at last inspection).
- **Do not mark cross-platform PASS until this run completes successfully on Windows and macOS.** If failure persists, inspect job logs and fix exact cause.

## Verified contract CI milestone
- Source revision `df178b4a143a6b7997c503ec44572ce054ee269a`: GitHub Actions run [38836950377](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38836950377) **PASS** on Ubuntu, macOS and Windows (all three jobs completed success).
- This verifies TypeScript build and bootstrap unit tests, **not** native autostart, OS sandbox, working MCP server or local CI runner.
- Status: P0 baseline PASS (source pin); PX-01 bootstrap contract tests PASS; PX-01 feature completeness IN PROGRESS.

## PX-01 increment — Read-only MCP stdio (2026-10-16)
- Source HEAD at implementation handoff: `278f81f730851cc7d57dc7f0bf023d708b68e629`.
- Implemented `src/mcp/server.ts` and `src/mcp/cli.ts` with JSON-RPC MCP stdio initialize, tools/list, tools/call and ping. Public tools: `connector_status`, `list_workspaces`, `get_workspace` only.
- Added tool catalog and denied-unregistered-root tests in `test/mcp.test.ts`, and `npm run mcp` command after TypeScript build.
- This is a **limited bootstrap transport**, not verified complete MCP SDK conformance or production authenticated remote transport. Trusted registry is still memory-only and has no external enrollment path; shells, writes and CI disabled.
- GitHub Actions for this revision: https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/38840578972 — status pending at checkpoint write. Do not infer PASS.
- NEXT: inspect latest CI outcome; fix failures; implement fully compliant MCP transport/session tests, then trusted persistent Workspace registry and native isolation proofs.
