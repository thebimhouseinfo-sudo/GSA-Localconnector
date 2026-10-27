# Mac Desktop Lifecycle Implementation Plan

**Deferred by the user on 2026-10-19:** execute only after the core connector functions are working and verified. This retained plan is not the next active coding task.

> **For agentic workers:** Use superpowers:executing-plans with the existing manual Planner → Coder → Tester → Reviewer coordination. Tasks below are proposed scope, not completion markers. Do not create branches, commit, push or alter gate state.

**Goal:** Deliver the approved Dock app, persistent tunnel setup, background login startup, Pause/Resume/Quit.

**Architecture:** One per-user LaunchAgent owns a supervisor and the installed stdio tunnel. A small AppKit Dock app sends local lifecycle commands; it never creates a competing tunnel. The repository `.env` supplies the saved tunnel ID and key at launch.

**Tech stack:** Existing TypeScript ESM/Node, Swift/AppKit, Python owner launcher and launchd; no new dependency or VM.

**Spec:** [MAC-DESKTOP-LIFECYCLE-ADDITION.md](MAC-DESKTOP-LIFECYCLE-ADDITION.md).

## Global constraints and acceptance limit

- Preserve Mac-first order, selected Mac tunnel/plugin identity, existing owner fencing, all project data and other applications. Git integration stays manual-only.
- Repository `.env` is ignored, untracked, owner-only 0600, regular single-link and opened nofollow. Never read/print real credentials during development; tests use synthetic values.
- Only `GSA_LC_TUNNEL_ID` and `CONTROL_PLANE_API_KEY` are data inputs; never source/eval arbitrary env. Key never enters argv/plist/archive/logs.
- **All sleep prevention is outside this connector plan by the user's latest decision.** The user will independently install https://github.com/tmad4000/nosleep. No caffeinate, Keep Awake UI, power assertion, external-tool research/integration or sleep-prevention test belongs here. Preserve deliberate Sleep/shutdown and reconnect/reconciliation after wake. No privileged helper, global power modification or third-party installation is authorized.
- Native file/shell gaps remain separate. UI/packaging success cannot enable or certify an unavailable backend.

## Review focus

1. Missing/moved/unsafe `.env`: actionable error without repeated prompts or secret output (Task 1).
2. Shell metacharacters and extra env names: parsed data only, no execution or injection (Task 1).
3. Existing tunnel/retained workers: refuse duplicate ownership, never kill neighboring processes (Task 2).
4. Pause during owned work or app crash: no dropped result, no duplicate replay, correct owned-child lifetime (Task 3).
5. Login/update with stale installation pointer: verify exact artifact before launch, keep unrelated applications intact (Task 4).

## Task 1 — Saved setup and verified tunnel profile

**Files:** create `scripts/mac-desktop-config.mjs`, `test/mac-desktop-config.test.mjs`; modify `.gitignore` only if needed and `docs/tunnel/SETUP.md` for this setup path.

**Interfaces:** `loadDesktopEnv(envPath: string): Promise<{tunnelId: string, apiKey: string}>`; `renderMacTunnelProfile(runtimeRoot: string, tunnelId: string): string`. Export validation errors with stable reason codes, never source lines or key values. A setup write helper accepts the two fields and exclusively creates a missing file; replacing an existing file requires the UI's explicit Save action with expected file identity. Refuse an unexpected format rather than silently overwriting unrelated content.

- [ ] Add focused tests for two valid fields/no reprompt, absent file, moved path, symlink/hardlink/unsafe permissions, duplicate/unknown names, and literal `$()`/backticks that never execute.
- [ ] Implement bounded data-only parsing and file identity checks. Validate tunnel ID using `^tunnel_[a-fA-F0-9]{32}$`; API key must be nonempty, single-line and contain no control characters. Check Git ignore/tracking without reading file content into command output.
- [ ] Generate a private nonsecret YAML profile with known schema: `config_version: 1`, `control_plane.tunnel_id`, `control_plane.api_key: env:CONTROL_PLANE_API_KEY`, loopback health listener and `mcp.commands` entry `channel: main`. Quote the installed Node/stdio entrypoint correctly, including spaces. Use only the selected installed runtime; no dirty checkout executable paths.
- [ ] Run `node --test test/mac-desktop-config.test.mjs`; require all new cases pass and no sentinel key in rendered profile/errors. Source evidence: existing `reuse-gptworker-tunnel.ps1` YAML; local `bin/tunnel-client run --help` v0.0.14 confirms `--config`, `CONTROL_PLANE_API_KEY`, `CONTROL_PLANE_TUNNEL_ID`. Custom `GSA_LC_TUNNEL_ID` is mapped into YAML, not assumed client-native.

## Task 2 — One background stdio runtime

**Files:** create `scripts/mac-desktop-supervisor.mjs`, `test/mac-desktop-supervisor.test.mjs`; modify `scripts/mac-package.mjs`, `start.command`; reuse `scripts/macos-owner-launcher.py`, `src/local/mac-owner.ts` unchanged unless a narrowly demonstrated packaging defect requires review.

**Interfaces:** `startDesktopRuntime({runtimeRoot, configPath, envPath}): Promise<OwnedRuntime>`; `OwnedRuntime.status()`, `pause()`, `resume()`, `stop(): Promise<StopResult>`. Lifecycle status is nonsecret and includes installation/session identity, owned process state and actual backend availability. Expose these commands through a private per-user Unix socket under `~/Library/Application Support/GSA-Localconnector/desktop/` (directory 0700, socket owner-only); never expose a TCP control listener.

- [ ] Test manifest excludes `.env`, profile targets installed stdio, config paths with spaces, duplicate supervisor/tunnel refusal, invalid key stops reconnect-loop churn, and stop never targets a sentinel unrelated process.
- [ ] Extend packaging allowlist/manifest with existing `bin/tunnel-client`, installed Node, stdio JS, owner launcher, config helper and supervisor. Existing `cli.ts` invokes `withMacOwner`; preserve its FD3 ownership path rather than running a second HTTP server. Use explicit child environment with only selected credential plus required system/owner values; do not inherit arbitrary `.env` variables.
- [ ] Replace HTTP-only `serve` path with this supervisor, launch `tunnel-client run --config <generated-profile>` and capture bounded private logs with key redaction. Keep restart throttling. Validate known label/current artifact before load/bootout; do not broad-kill processes. Make `start.command` invoke the same installed lifecycle path instead of a checkout tunnel; valid saved setup skips prompts.
- [ ] Run `node --test test/mac-desktop-supervisor.test.mjs`; fake child processes prove lifecycle only. Defer actual live launch until explicit installation approval; never call a fake run native success.

## Task 3 — Dock controls and owned lifecycle

**Files:** create `native/macos-desktop/App.swift`, `native/macos-desktop/Info.plist`, `native/macos-desktop/test-lifecycle.py`, `assets/mac-desktop/plug-zap.svg`, `assets/mac-desktop/LICENSE`; extend supervisor admission and installed CLI plumbing in `src/mcp/runtime-bootstrap.ts`, `src/mcp/server.ts` only for lifecycle admission.

**Interfaces:** supervisor states `STARTING`, `RUNNING`, `PAUSING`, `PAUSED`, `STOPPING`, `STOPPED`, `SETUP_REQUIRED`, `FAILED`. A `DesktopAdmission` internal object offers `begin(): Lease` (reject while pausing/paused) and `pause()/resume()`; lease completion tracks outstanding asynchronous owned runs, not merely short MCP request completion. Lifecycle reads and cancel/status calls remain available while paused. It is operational standby, never a new approval gate.

- [ ] Pin tests: Pause rejects new mutating/execution work, lets already-owned jobs finish, retains final results; Resume uses the same installation; duplicate Pause/Resume is harmless. If active-run accounting is not available for a backend, report inability to drain rather than falsely entering PAUSED.
- [ ] Implement Dock app status/setup, Pause/Resume and Quit using private local IPC. Close hides its window. Setup field stores both ID and key once; valid file is reused. Quit bootouts only the owned LaunchAgent and cleans owned children, with honest remaining-worker status. Never SIGSTOP unrelated or owned commands as a substitute for draining.
- [ ] Vendor Lucide `plug-zap` SVG and ISC attribution from its official source, customize a teal badge, generate native icon assets using installed macOS tools, no new icon dependency. Bundle identifier and Dock app name consistently identify GSA Local Connector.
- [ ] Run focused Node admission tests plus `python3 native/macos-desktop/test-lifecycle.py` against disposable installed fixtures. Compile AppKit app using existing `swiftc`. On the real host verify that Dock controls reach the single installed service; mocks do not establish live lifecycle behavior.

## Task 4 — Login installation and selected-plugin acceptance

**Files:** extend `scripts/mac-package.mjs`; create `test/mac-desktop-package.test.mjs`; update `docs/tunnel/SETUP.md`, `docs/STATUS.md` only with observed outcomes. Disposable evidence goes under `docs/reports/`.

**Interfaces:** preserve `com.gsa-localconnector.mac` as the single service label. Nonsecret desktop configuration records absolute `envPath`, installed runtime identity and login preference. App Start/Resume bootstraps that known job; Quit bootouts it for the session without erasing next-login preference. Login starts the owned service and opens its Dock UI without Terminal.

- [ ] Verify disposable install/upgrade/repair manifests, stale-pointer rejection, missing credential path, idempotent start, Pause/Resume/Quit and uninstall preservation. Use `node --test test/mac-desktop-package.test.mjs`; run only new/affected cases, not unrelated still-valid suites.
- [ ] Reviewer checks each task's evidence and final packaging/source scope before live installation; maximum two repair rounds per pair. Primary agent requests explicit approval for exact runtime replacement/LaunchAgent registration and secure credential provisioning; no real `.env` content in chat or tools.
- [ ] After approval, validate actual post-login startup, no Terminal dependency, plugin refresh reaching exact installed Mac identity, Pause/Resume and Quit. Test restart/wake reconciliation with a disposable workspace operation; do not repeat uncertain writes. Confirm another application/process remains intact.
- [ ] Record current hashes, exact new tests and observed failures. Record all sleep prevention as user-managed nosleep outside connector scope; do not introduce a power assertion, dependency or acceptance test. Do not mark M4/M5 complete or sign G0/G11 from this plan.

Self-review: approved requirements map to Tasks 1–4; all sleep prevention has been explicitly removed by the user and delegated to user-installed nosleep. No plan task reads a live key, modifies global power policy, installs a helper, develops a VM or claims the missing native file/command backends complete. Implementation remains subject to human review of this concrete plan and existing manual harness coordination.
