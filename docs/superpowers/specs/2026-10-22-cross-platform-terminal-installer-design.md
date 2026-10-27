# Terminal installer and desktop presence — Windows and macOS

Date: 2026-10-22. Status: design approved in chat, with the user's additional requirement to retain API configuration in local `.env` on both platforms. Implementation plan awaits review; no installer or desktop app implemented by this document.

## Latest user scope — authoritative correction

The user has now read the plan and narrowed the goal to terminal-command installation, native Dock/tray presence, automatic startup after login, no persistent runtime Terminal, and no repeated API-key prompts using local `.env`. Proceed with sequential project roles for this scope. Enable per-user login startup on first installation as explicitly requested; preserve an existing preference on updates. No additional design approval cycle is needed for this correction.

The sections below retain design context, but Pause/Resume, runtime admission changes, interactive management IPC, extra diagnostics UI and a multi-action management product are outside this minimal delivery. Implement only necessary setup, owned lifecycle and packaging integrity. Older references to optional login setup or pending plan review are superseded by this paragraph. Actual secrets remain user-entered; no agent reading/writing real `.env`. No live process or installation is replaced until a concrete reviewed action is ready.

## User intent and scope

The user requested a suitable vector Dock icon and redesigned installation, then selected terminal-command installation for both Windows and macOS, inspired by LidAwake-Mac. After installation the connector must run independently of Terminal and have a desktop icon/presence. The user approved this design and explicitly required local `.env` persistence on both platforms, without repeated API-key prompts after installation. This extends the earlier Mac-only lifecycle design to both platforms. It does not approve live replacement of a running installation or agent access to actual secrets.

The normal user journey is: run an installation command, complete first-run connection setup if needed, see a desktop status app, and close Terminal without losing the connector. “Hidden Terminal” means background launch without a console window; never close or hide a user's existing shell or hide installation errors.

Windows has no macOS Dock: use a system tray icon, a Start menu shortcut, and a taskbar icon when the status window is open. On macOS use an ordinary Dock app whose window can close while the app stays running. Permanent taskbar/Dock pinning remains a user action.

## Approach and alternatives

Selected: common installation contract and release manifest, thin shell/PowerShell entrypoints, and native platform launchers. Build from an explicit source revision initially, using existing project dependencies and locally available tools. Install into a managed per-user runtime rather than running the development checkout. This fits the requested terminal experience and the existing project without a DMG/PKG requirement.

Alternative: terminal entrypoints download prebuilt app archives. This reduces tool requirements on target machines but needs a reviewed release source, trusted release integrity, and platform signing/distribution work. Keep the contract compatible with this later delivery method; do not invent a current download URL or advertise it as available.

Alternative: one shared script launches Node directly in the background. Rejected for the final user experience: it provides neither native desktop presence nor sufficient lifecycle ownership by itself.

## Installation commands and output

Proposed entrypoints from an explicit checked-out release, not working commands yet:

```sh
# macOS
bash ./install.sh
```

```powershell
# Windows PowerShell
powershell -NoProfile -File .\install.ps1
```

Both accept the same actions: `install` (default), `update`, `repair`, `doctor`, `uninstall`. Exact flags and implementation files will be resolved in the implementation plan. Do not suggest bypassing PowerShell execution policy or changing global settings; report an applicable policy restriction clearly.

Installer output has five stages: check requirements → build/verify → install → configure launch → open app. Show the version, destination, preserved-data notice, and a concise error if a stage fails. A successful install reports “Installed; opening GSA Local Connector,” not “Connected” unless the runtime actually confirms connection. Installation exits and returns the shell prompt; subsequent use needs no Terminal.

Preflight checks OS/architecture, supported tools and versions, writable destination, existing installation ownership, and required tunnel-client availability. Missing tools produce exact remediation rather than automatic system-tool/dependency installation. Reuse a compatible existing tunnel executable only; preserve the other application's tunnel configuration and processes. Mac Apple Silicon is the current tested platform; other architectures and Windows require their own actual evidence before support claims.

A later published one-line bootstrap must identify an approved release and verify a trusted release digest/signature before executing payloads. No unpinned `main` download or fabricated public endpoint is part of this design.

## Desktop identity and controls

Use the same visual identity across platforms: a navy rounded square, teal Lucide `plug-zap` vector, and generous internal spacing. Vendor the official SVG with its ISC attribution; no icon package dependency. Generate `.icns` for macOS and multi-resolution `.ico` for Windows. Keep the silhouette readable at 16, 32, 48 and larger sizes. Windows tray art needs its own small monochrome treatment for light/dark taskbars. Status text must remain understandable without color.

Sources: https://lucide.dev/icons/plug-zap and https://lucide.dev/license. The existing visual draft is exploratory; its DMG screen is superseded by the terminal flow in this document.

The compact status window shows installation version, actual connection state, actual backend availability, and the selected host identity. Controls: Pause/Resume, Start at Login, connection setup, diagnostics, and Quit. No unsupported file operation becomes enabled through packaging.

Mac: Dock icon remains while the app runs; closing its window keeps background work alive; clicking the Dock icon reopens the window. Windows: closing the window leaves the tray icon and runtime active; tray click/menu reopens status. Explicit Quit requests a clean stop of this installation and exits its UI. If work cannot safely stop, retain visible status and explain the remaining work instead of falsely reporting shutdown.

## One owned runtime per host

Retain the existing Mac design: one managed supervisor owns the installed stdio tunnel and MCP children; the Dock UI is its client. Upgrade the existing `com.gsa-localconnector.mac` registration in place rather than creating a second competing service. Preserve the owner launcher and FD3 fence.

Windows uses a native GUI-subsystem launcher, which starts the owned supervisor/tunnel without console windows. The tray app is its control client. Determine the exact per-user login registration and available native build tools during platform characterization, before coding that adapter. Do not promise a specific Windows mechanism without that evidence or add a framework dependency to obtain it.

Both use private local control IPC, restricted to the current user, rather than a public control endpoint. Start is idempotent. An installation/session identity plus retained process ownership establishes authority; PID or process name alone is insufficient. A checkout-started tunnel with the same host identity produces a visible conflict; never silently kill or replace it.

Closing Terminal must not terminate the installed supervisor or its children. Child output goes to bounded private diagnostic logs, not a hidden interactive shell. Never redirect a credential prompt into an invisible console. Missing/rejected setup opens an actionable native setup window.

States: STARTING, RUNNING, PAUSING, PAUSED, STOPPING, STOPPED, SETUP_REQUIRED, FAILED. Connection/backend status is reported independently; a running supervisor is not proof of a connected plugin. Pause rejects new mutating/execution work while existing owned work drains. Status/results/cancellation remain available. No SIGSTOP substitute. Report inability to drain rather than entering PAUSED falsely.

Start at Login is an explicit per-user preference. Preserve its existing value on update; a first install offers the choice in setup. Startup is after user login. Quit stops this session without silently deleting the preference. Restart/wake reconciles operations and preserves UNKNOWN results without replaying uncertain writes. No sleep-prevention behavior belongs to this scope.

## Installation, update, and removal boundaries

Mac app location: `~/Applications/GSA Local Connector.app`; versioned runtime and nonsecret metadata under the existing `~/Library/Application Support/GSA-Localconnector` root. Windows app/runtime: a per-user GSA-Localconnector directory under LocalAppData, with a Start menu shortcut. Final paths and collision handling belong in the reviewed platform plan. No admin elevation by default.

Build and verify in staging. Allowlist packaged files; exclude credentials, identities, grants, logs, journals, workspace data, developer configuration and original VM media. Verify artifact hashes and native executable identity before activating the new version. A manifest hash detects corruption; it does not independently authenticate a remote publisher.

Updates require verified ownership and a stopped/drained owned runtime. Switch the current runtime pointer only after validation. Retain the previous artifact for executable rollback; do not roll back user data or journals. Failures retain the previous pointer and show actionable diagnostics. If the new runtime cannot start, report failure even when automatic executable rollback succeeds. Repair cannot manufacture missing native acceptance evidence.

Uninstall stops only owned processes, removes managed app/runtime and owned login/shortcut registrations, and preserves credentials, grants, journals, logs and user workspaces. It is a separate explicit command with a concrete removal summary. Unknown conflicting files or processes are reported rather than removed.

## Credentials and independent host setup

Keep Mac and Windows tunnel IDs/plugins independent. Preserve the existing selected `gsa-lc-mac` and Windows `gsa-lc` identities and host grants; never reuse another host's tunnel ID or recreate plugins as an installer shortcut.

Persist the selected host's tunnel ID and API key in a local `.env` file, outside versioned release artifacts. Valid saved setup is loaded automatically on app launch, login, restart, update and repair; none of these paths asks for the API key again. Connectivity failures do not erase the saved key or trigger a fresh prompt. Only missing/unreadable/unsafe/invalid setup or a confirmed authentication rejection produces SETUP_REQUIRED and an explicit setup action; do not repeatedly display prompts.

Preserve an already-configured absolute `.env` path, including the earlier Mac repository-local preference. For a fresh installation with no existing configuration, use a per-user application configuration `.env` outside the versioned runtime: Mac `~/Library/Application Support/GSA-Localconnector/desktop/.env`; Windows `%LOCALAPPDATA%\\GSA-Localconnector\\desktop\\.env`. Store only the nonsecret absolute path in launcher metadata. Never silently copy a key from an existing source or change paths on upgrade. If the file moves, offer an explicit user-selected new path rather than scanning the disk. These default paths refine the user's local-env requirement; existing choices take precedence.

Use `GSA_LC_TUNNEL_ID` and `CONTROL_PLANE_API_KEY` as data, never source/eval the file. Validate tunnel ID with `^tunnel_[a-fA-F0-9]{32}$`; key is nonempty, single-line and contains no control characters. Reject duplicate/unknown names, shell evaluation and arbitrary environment injection. macOS requires a current-user-owned regular single-link file, no symlink traversal, mode 0600 under a private directory. Windows must verify current-user-private effective ACLs and reject unsafe reparse/link destinations before loading or saving; do not equate POSIX chmod with Windows protection. If a platform cannot demonstrate the private-file boundary, block persistent setup instead of weakening it.

First-run UI presents a concealed key field for the user once. Save is explicit and atomic; a failed save cannot report completion or destroy the previous valid configuration. Reuse an existing valid file without prompting. Uninstall preserves this file; deleting credentials needs a separate explicit user action. Secrets never enter archives, release manifests, argv, login registration, diagnostics or status. No machine-wide environment variables, Keychain/cloud copy, global shell-profile edits or credential logging.

Development and installer tests use synthetic credentials only. No real `.env`, private key or identity state may be read or edited by the agent. The user's authorization covers implementing the local persistence feature; actual credentials are entered directly by the user through the eventual setup UI, not supplied through chat or inspected by development tools.

## Acceptance and evidence

1. Install from a path containing spaces; missing tools, wrong architecture and conflicting owners fail visibly without touching a live owner.
2. App opens after installation; shell prompt returns. Closing the installation Terminal leaves one owned runtime and usable app controls. Windows launch shows no console flash; Mac startup opens no Terminal.
3. Dock/tray/shortcut icons display at native sizes; close/reopen and repeated Start do not duplicate the tunnel.
4. Pause drains truthfully; Resume reuses the same installation; Quit stops owned work safely and leaves unrelated sentinel processes intact.
5. Login preference, update/rollback/repair and uninstall preserve host identity, grants, credentials and journals; failed install does not activate a partial runtime.
6. Synthetic key sentinels are absent from all packaged files, process arguments, status and logs. Private IPC access is checked with actual OS permissions.
7. Actual plugin evidence reaches the exact installed host/runtime on each platform. Mock tests or macOS-only tests cannot establish Windows PASS. No unrelated feature/native backend completion is inferred.
8. Save synthetic setup once, then launch/relaunch/login/update/repair without showing a key prompt. Preserve the same `.env` identity/path and values across runtime replacements. A temporary connection failure does not erase setup. Missing/unsafe data and confirmed invalid credentials show one actionable setup state, without a prompt loop or secret disclosure.

Run focused deterministic contract tests first, then disposable native installations on each available host. Real installed-runtime replacement, login registration and credential provisioning require the exact proposed action to be reviewed before execution. Keep the existing live connector running during design and preparation.

## Review state and next artifact

This document is the concrete design deliverable for the user's terminal-install request. It supersedes the Mac-only distribution choice in the earlier desktop proposal; it does not silently edit that proposal's historical approval or product GOAL/criteria. No executable, live install, secret, login setting or gate state changed.

Self-review: separates requested behavior from platform assumptions; preserves single ownership and independent host identities; defines failure/rollback and native acceptance; labels commands as proposed; leaves unsupported Windows adapter details for characterization rather than inventing API support.

Next: create the scoped implementation plan from the design approved in chat, incorporating the local-env amendment; user reviews the plan before implementation. Include platform characterization, exact file ownership, required Planner → Coder → Tester → Reviewer triggers, and actual-host test boundaries. Follow existing manual gates; do not self-sign G0/G11 or claim the full Mac milestone complete.
