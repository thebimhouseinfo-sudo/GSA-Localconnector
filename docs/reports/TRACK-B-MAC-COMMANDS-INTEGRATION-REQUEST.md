# Track B → G2 Integration Request

## GOAL
Wire the native Track B host adapter into the selected Mac MCP runtime, preserving exact contracts, workspace ownership and truthful diagnostics. This is a request; Track B does not edit shared MCP files.

## Integrator-only files and actions
- `src/mcp/runtime-bootstrap.ts`: remove `loadMacVmRuntime` / `MacVmCiExecutor` from active Mac execution path, instantiate `MacNativeCommands(registry)` only with a verified owner session and current live WorkspaceRegistry. Feed its `VerifiedNativeSandbox` and `VerifiedNativeProcessController` interfaces into the *existing* `DurableProcessManager` with the *existing* `ProcessJournalStore`. Preserve independent workspace fencing and restart recovery. Never activate based merely on `verified:true`.
- `src/mcp/server.ts`: pass optional `cwd_relative` from both `run_command` and `start_process` (default `.`), validate common request; ensure reference-workspace command denied, revoked workspace denied, and result/report carries exact outcome. Route local Git through existing `executeGit` or appropriate durable command path; do not bypass network/auth policy. Preserve no-replay for UNKNOWN.
- `src/mcp/catalog.ts`: add OPTIONAL `cwd_relative` string to command/process tools, preserve old names/defaults; describe native user-account execution rather than disposable Linux snapshot. Keep existing response semantics, bounded cursor APIs and explicit blocked reasons.
- `src/mcp/runtime-bootstrap.ts` capability reporting (plus other integrator-owned status surface): replace Linux VM metadata with `executionEnvironment:macos-native`; `command_confinement:none (user account)`; `state_integrity_vs_commands:not_protected`. Any legacy `shellIsolation:verified` must be removed/reclassified; `verified:true` in old interface means adapter/owned-process contract, NOT OS command confinement.
- MCP Git admission: remove blanket `hostGit` denial only after actual native backend, working-root execute permission, per-op local Git admission and journal outcome are demonstrated. Network Git remains unavailable without separately approved credentials/network grant. Dirty Git files remain untouched unless user-selected operation explicitly changes them.

## Dependency and test gates
G2 depends on completed Track B implementation, C-B GitHub-hosted real Darwin tests, and earlier INT-A/file integration. Track C owns workflow; Track B supplies `test/mac-host-commands.test.ts` and host diagnostics. For exact-sha C-B require no mandatory test skip, native spawned command, subcwd, git, non-Git script, stdout/stderr, output cap, timeout, owned group physical stop + neighbor preserved, grant/revocation negative, restart UNKNOWN/no replay, journal readback and sanitized env. Installed plugin on user's Mac is a later attended G4 gate; no local checkout mutation before dirty/unpushed custody inspection.

## Shared-contract requests
Prefer no changes to `src/core/native-io.ts`. If artifacts/source/toolchain must be journaled, negotiate a backward-compatible optional field addition in `ProcessJournalRecord` and `ProcessJournalStore` under Track B ownership and a matching consumer test. Do not add another process queue, scheduler or Git runner. No VM fallback and no claim that commands are OS-constrained.

## Track B acceptance limit
Adapter is source-implemented, but G2 wiring and native CI/host evidence are not included in Track B's current proof. Integration owner must not mark B4/G2 PASS based on source existence alone.

## GitHub-hosted macOS CI reconciliation — 2026-11-05 (22:53 ICT continuation)

- Exact observed branch HEAD: `c6fa97f7bad65bc3cdd00d1c26304714fecc3da1`. GitHub run [42046143138](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42046143138) **completed FAILURE**, not pending. `c0-source` job 127341400609 passed checkout, host identity and `npm ci --ignore-scripts`, but `npm run build` failed with TypeScript `TS2739` at `src/mcp/runtime-bootstrap.ts(85,6)`: base `NativeScopedFiles` lacks `renameDirectoryExclusive` and `diffNonGitText` from `MacScopedNativeFiles`. This is a shared integration/Track A interface mismatch; Track B must not edit shared MCP or Track A files. Integration owner should coordinate the fix with Track A and re-run exact-SHA C0.
- `g3-preinstall` job 127342537678 also failed. `C-A` says `dist/test/mac-scoped-files.test.js` missing, `C-B` says `dist/test/mac-host-commands.test.js` missing, and `C-G3` says a real pinned tunnel-client artifact is unavailable. Because C0 compilation failed and the separate G3 job did not prepare compiled tests, missing compiled test outputs are **BLOCKED / NOT EXECUTED**, not proof of a failing Track B native test. Track C must arrange proper exact-revision compile/build and test delivery within its workflow ownership; absence must remain a failing gate.
- Track B standalone Darwin-native test result at current HEAD: **UNVERIFIED**. No test on user's physical Mac performed, as requested: **pending user require**. This is intentionally not an acceptance gate for Track B's GitHub-hosted CI stage; G4/M5 real-device acceptance remains separate.
- Safety and ownership: no changes to `src/mcp/*`, Track A/C/D/E source, local checkout, user device, VM media, `main`, or installer.
