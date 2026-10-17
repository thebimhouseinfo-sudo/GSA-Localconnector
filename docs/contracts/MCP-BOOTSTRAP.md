# MCP transport and bootstrap

[CRITERIA.md](../CRITERIA.md) governs the offline GitHub workspace/tool provider. GSA owns reasoning and orchestration; connector transports direct workspace/file/search/edit/process/Git/CI calls and truthful results, with no task/review/promotion approval gates.

Working workspaces permit read/write/execute without separate unlocks. Explicit reference roots permit read/search only; no mutation/execution there, including through subprocesses. Ungranted project data stays inaccessible. Each host has its own plugin/tunnel and scope.

## Source entry points

- `src/mcp/cli.ts`: stdio; stdout is protocol output.
- `src/mcp/http-cli.ts` and `src/mcp/http.ts`: HTTP composition/authentication.
- `src/mcp/server.ts`: JSON-RPC handshake, discovery/dispatch and binding.
- `src/mcp/catalog.ts`: planned direct schemas; registration alone does not prove implementation.
- `src/mcp/runtime-bootstrap.ts`: native composition/evidence checks.

The historical three-tool empty bootstrap is not the current catalog. Inspect actual `tools/list` at the exact revision/installation. Long jobs use durable IDs and short status/log/output/cancel calls.

## Implementation gaps

Local source still binds read-only and retains legacy execution-grant/proof restrictions. The full working/reference distinction is not established. These are implementation gaps, not desired user gates. Native/live readiness requires actual evidence; schemas, stdio tests and historical HTTP success do not prove current remote health.

See [source status](../STATUS.md) and [protected state](../security/PROTECTED-STATE-PLATFORMS.md). This doc update changes no runtime and claims no protocol/SDK conformance.
