# GSA-Localconnector source baseline

Current scope authority: `docs/CRITERIA.md` and `docs/DECISIONS.md`. This file pins historical source references, not product permissions. Current target: independent concurrent Windows/Mac hosts; working workspace read/write/execute without connector gates; explicit reference roots read-only/non-execution; ungranted project data denied.

Date: 2026-10-16

- Connector pre-bootstrap main: `4ec0e3868f00f4e08e90c0e2d7c3998b93992d8d`
- GPTWorker main: `1eee510240eb8ad433854dacda833e42bbbb3152`
- GPT Super Agent main: `be8b663a878cca9c5b2920145f57fd20291d6164`
- Implementation plan blob: `39576efbf61d7480963e3f92bd5702d308569771`

Scope: Windows and macOS, single host/user/controller, multiple authorized local workspaces. No shell/CI exposure before native isolation validation.
