# MCP transport bootstrap contract

Status: limited read-only stdio transport for local development, **not** production tunnel or signed-off SDK protocol conformance.

- JSON-RPC 2.0 over newline-separated stdio; stdout contains protocol responses only.
- initialize, notifications/initialized, ping, tools/list, tools/call.
- Public tool catalog: connector_status, list_workspaces, get_workspace.
- No arbitrary file read; no Workspace enrollment on wire; no file write, shell, Git or CI.
- A fresh process starts with an empty in-memory Workspace registry. Production trusted enrollment/persistence is not installed.
- Negative cases: unknown tool returns tool-level error and missing Workspace is rejected.
- No session, remote transport, authentication or host autostart implemented. Do **not** connect it to a public endpoint.
- The E2E test starts the actual compiled child server via stdio on CI runners, verifies handshake and request/response matching.
- Further work: conformance tests against supported official MCP client; install trusted Workspace enrollment/config; implement proper authenticated remote transport; native sandbox proof before running shell/CI.
