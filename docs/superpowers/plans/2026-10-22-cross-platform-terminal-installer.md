# Cross-platform Terminal Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans within the project role workflow. The user reviewed the plan and clarified the minimal delivery scope below; proceed sequentially without reopening design approval. Pending checkboxes describe proposed work; never hand-mark completion. No branch changes, commits, fetches, pushes or gate signatures.

## Authoritative minimal delivery scope — user clarification

Deliver only terminal installation, Mac Dock icon / Windows tray and shortcut, automatic startup after login following boot, no runtime Terminal, and one-time API setup saved in local `.env`. Enable per-user login startup on first install because the user requested it; preserve an existing preference during update/repair. Startup is after login, not a pre-login system service. This narrower scope overrides broader controls in the linked design and earlier plan. No Pause/Resume, admission policy, new MCP behavior, management protocol or expanded control dashboard. Retain only necessary owner checks, private credential integrity, internal owned stop for installation maintenance, and preservation during install/repair.

**Goal:** Install a single per-host connector by terminal command, save local `.env` setup once, and start it automatically at login with Dock/tray presence and no runtime console.

**Architecture:** Common installer/configuration/launch contracts feed platform adapters. On macOS the existing LaunchAgent starts the native Dock app executable; that app owns a consoleless Node supervisor child, which owns the tunnel and preserves the stdio ownership fence. On Windows the native GUI app similarly owns the hidden supervisor after actual Windows characterization. The app remains running after its window closes; no sidecar restart cycle or new control protocol is required.

**Tech Stack:** Existing Node >=20/TypeScript ESM, Python 3, Swift/AppKit/launchd, shell/PowerShell; Windows candidate is installed .NET Framework C#/WinForms, subject to Task 1. No new package, toolchain, plugin, VM, global setting or privilege dependency.

**Spec:** [Approved design with local-env amendment](../specs/2026-10-22-cross-platform-terminal-installer-design.md).

## Global Constraints

- Mac-first native execution; Windows needs its own host evidence. Current planning host reports Darwin. No Windows native PASS is established.
- Commands: `bash ./install.sh` and `powershell -NoProfile -File .\install.ps1`; actions `install` (default), `update`, `repair`, `doctor`, `uninstall`. No execution-policy bypass or invented download URL.
- Preserve independent `gsa-lc-mac`/Windows `gsa-lc` identities, current grants, journals and other applications. A conflicting existing owner is a visible refusal, never a process-name kill.
- Fresh `.env`: Mac `~/Library/Application Support/GSA-Localconnector/desktop/.env`; Windows `%LOCALAPPDATA%\GSA-Localconnector\desktop\.env`. Preserve a configured absolute path, including existing Mac repository `.env`; never copy/migrate it silently.
- Only `GSA_LC_TUNNEL_ID` and `CONTROL_PLANE_API_KEY`; tunnel regex `^tunnel_[a-fA-F0-9]{32}$`. Key is nonempty/single-line/no control characters. Data-only parsing, no sourcing/eval/arbitrary env injection.
- Normal launch/login/restart/update/repair uses valid saved setup without a key prompt. Transient network errors never erase setup. Invalid/missing/unsafe setup yields one SETUP_REQUIRED state, not a prompt loop.
- Use synthetic credentials and disposable private paths only. Agent never reads/writes real `.env`, private keys or identity state. Real user provisioning and live runtime/login replacement need concrete reviewed actions.
- Mac credential file: private directory, current owner, regular single-link, no symlink traversal, mode 0600. Windows effective ACL/reparse/link protection must be demonstrated, not simulated by chmod.
- Secrets excluded from archives/manifests/argv/status/login records/logs. Uninstall preserves credentials, grants, journals, logs and workspace data. No sleep prevention or power changes.
- Terminal installation returns its prompt; app launch/login never opens a console. Do not close/hide the user's existing shell. No automatic Dock/taskbar pinning.
- Keep `codex/mac-completion` WIP; snapshot explicit files before mutation. GUIDED_ONLY M1/P01 gates remain separate and cannot be self-signed.

## Review Focus

1. Existing configured `.env` outside the default directory survives update unchanged; missing/moved path asks for an explicit new location (Tasks 2, 6).
2. Temporary disconnection preserves key and does not reprompt; confirmed auth rejection yields setup state with no repeated dialog (Tasks 2–4).
3. Close/reopen, duplicate Start, app crash and an unknown checkout tunnel never spawn a second owner or kill a neighbor (Tasks 3–5).
4. Closing the installing shell and a fresh login leave exactly one installed runtime, a visible native icon and zero API prompts with valid saved setup (Tasks 3–6).
5. Partial update, stale pointer and a path with spaces retain the old runnable artifact and original configuration; restored executable alone is not a successful update (Task 6).

---

## Task 1 — Pin platform adapter contracts and Windows prerequisites

**Files:** create `scripts/desktop-platform-check.mjs`, `test/desktop-platform-check.test.mjs`, `docs/reports/2026-10-22-desktop-platform-characterization.md`.

**Interfaces:** `inspectPlatform({platform,arch,tools,clientHelp,nativeEvidence}): PlatformReadiness`; result `{platform,arch,ready,missing:string[],clientRunFlag:string|null}` contains no credential. `tools`, `clientHelp` and `nativeEvidence:{adapterVerified:boolean,reportPath:string}|null` are injected observations, never guessed version strings or native PASS claims.

- [ ] Write failing `supportedMacRequiresExistingTools`, `missingCompilerRefusesNoInstall`, `clientFlagComesFromObservedHelp`, `windowsWithoutNativeEvidenceIsUnverified` tests. Assert unknown tools/flags cannot produce `ready:true` and no package-manager/system change is executed.
- [ ] Run `node --test test/desktop-platform-check.test.mjs`; observe red before implementation.
- [ ] Implement inspection and collect read-only Mac tool versions and tunnel-client `run --help`; normalize its observed `--config` or `--profile-file` instead of assuming cross-platform parity.
- [ ] On an available Windows test host, collect OS/architecture, PowerShell/Node/tunnel-client versions and existing C# compiler/.NET Framework availability. Confirm GUI compilation, file/reparse/hardlink handle checks, effective file ACLs, per-user login registration and shortcut APIs in disposable fixtures. Record exact API signatures and compiler command in the report.
- [ ] Run focused tests; require green and sanitized report. If no Windows host/compiler exists, report Windows UNVERIFIED/BLOCKED prerequisite. **Hold Task 5 and Windows native setup/installer activation until this report proves the adapter and Reviewer accepts it.** Do not install a compiler or silently choose another framework.

Windows candidates have official documentation, not host validation: [NotifyIcon](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.notifyicon?view=windowsdesktop-9.0), [CreateNoWindow with UseShellExecute=false](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.createnowindow?view=netframework-4.8.1), and [HKCU Run login registration](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys). If HKCU Run is selected, its command length limit is 260; reject an oversized command instead of truncating. The failed documentation retrieval for file-access-rule pages is not API evidence; resolve exact file-protection signatures in this task.

## Task 2 — Persist local setup once through a private-file adapter

**Files:** create `scripts/desktop-config.mjs`, `scripts/mac-desktop-private-file.mjs`, `test/desktop-config.test.mjs`, `test/mac-desktop-private-file.test.mjs`. Windows private-file implementation belongs to Task 5, not a permissive stub.

**Interfaces:** `parseDesktopEnv(text): {tunnelId,apiKey}`; `loadDesktopConfig({envPath,privateFile}): Promise<SetupResult>`; `saveDesktopConfig({envPath,values,expectedIdentity,privateFile}): Promise<{identity}>`. `SetupResult` is `{state:'READY',values,identity}` or `{state:'SETUP_REQUIRED',reason}`. `resolveDesktopSetup({envPath,privateFile,promptOnce}): Promise<SetupResult>` calls injected `promptOnce` only for explicit setup while not READY, allowing prompt-count assertions. `PrivateFile` provides `readVerified(path)` and `replaceVerified(path,bytes,expectedIdentity)` using retained file identity and a same-directory atomic replacement; `expectedIdentity:null` means exclusive first create. Failures return stable codes, never source text/key values.

- [ ] Add failing tests `saveOnceNoPromptOnRelaunchLoginUpdateRepair`, `preservesConfiguredRepoPath`, `networkErrorDoesNotEraseSetup`, `missingMovedUnsafeSetupIsActionable`, `rejectDuplicateUnknownControlData`, `literalShellSyntaxNeverExecutes`, `failedSaveKeepsOldConfig`, `staleIdentityCannotReplace`. Exercise `resolveDesktopSetup` with injected `promptOnce` count: one initial save, zero additional calls on READY reloads; real UI/lifecycle counts are checked again in Tasks 4–6. Assert parser rejects extra names; key values are never evaluated as shell syntax.
- [ ] Add native Mac private-file tests for symlink ancestor/file, hardlink, wrong owner/mode and replacement race. All files contain synthetic sentinels under disposable roots; never use real defaults in tests.
- [ ] Run the two new test files to red; implement parser, explicit save and Mac retained-handle boundary. Keep real path metadata nonsecret and synthetic-only tests; no global env/Keychain modification.
- [ ] Run `node --test test/desktop-config.test.mjs test/mac-desktop-private-file.test.mjs`; require all green. Scan generated profiles/errors for the synthetic key sentinel, not actual credentials. Missing Windows adapter fails closed.

## Task 3 — One background launcher and minimal status

**Files:** create `scripts/desktop-supervisor.mjs`, `test/desktop-supervisor.test.mjs`. Reuse the installed `src/mcp/cli.ts` entrypoint, `scripts/macos-owner-launcher.py` and `src/local/mac-owner.ts` without changing MCP behavior. No admission source/test or server/bootstrap modifications.

**Interfaces:** `startDesktopRuntime({runtimeRoot,envPath,platformAdapter}): Promise<OwnedRuntime>`; `OwnedRuntime.status(): Promise<RuntimeStatus>`, `stopOwned(): Promise<{stopped:boolean,reason?:string}>` are internal maintenance interfaces. `RuntimeStatus={installationId,sessionId,state:'STARTING'|'RUNNING'|'STOPPED'|'SETUP_REQUIRED'|'FAILED',connection,reason?}` is a nonsecret private status snapshot with no remote control commands. Retained child handles and installation/session identity establish ownership. Stop refuses active retained work when it cannot stop safely; no new drain/admission mechanism or broad process kill.

- [ ] Write failing tests `duplicateOwnerRefused`, `ownedStopKeepsNeighbor`, `activeUnknownWorkRefusesStop`, `logsAreBoundedAndRedacted`, `invalidKeyStopsRetryLoop`, `networkErrorPreservesSetup`, `statusContainsNoCredential`, `closedInstallerShellLeavesChildAlive`.
- [ ] Run `node --test test/desktop-supervisor.test.mjs` to red. Implement the minimal launcher using installed stdio and Task 2's explicit credential environment; preserve FD3 fencing. Connection status must distinguish a live process from a connected plugin. No HTTP-only fallback, key in argv, or interactive child prompt.
- [ ] Run the focused test to green plus `npm run build && node --test dist/test/mac-owner.test.js` if owner launch plumbing is affected. Assert no uncertain write replay and no PID/name-only process authority. No management listener, Pause/Resume or MCP API change.

## Task 4 — Mac Dock app, launcher and shared icon assets

**Files:** create `native/macos-desktop/App.swift`, `native/macos-desktop/Info.plist`, `native/macos-desktop/test-lifecycle.py`, `scripts/mac-desktop-adapter.mjs`, `scripts/build-desktop-icons.mjs`, `assets/desktop/plug-zap.svg`, `assets/desktop/LICENSE`, `test/mac-desktop-adapter.test.mjs`; modify `scripts/mac-package.mjs`, `start.command` to use the same installed desktop path.

**Interfaces:** `MacDesktopAdapter.start/stopOwned/status/ensureLogin` wraps the existing `com.gsa-localconnector.mac` label and Task 3 runtime. LaunchAgent starts the Dock app executable without Terminal, and the app starts one retained Node supervisor child. App reads only the private nonsecret status snapshot, provides first-run concealed setup/explicit save and reopens on Dock click. Existing valid setup skips entry. `ensureLogin({firstInstall,existingPreference})` enables first-install startup and preserves an existing preference. `buildDesktopIcons({outputRoot}): Promise<{icns,ico,trayPngs}>` uses existing local native tooling, with no icon dependency/download at runtime.

- [ ] Add red adapter/lifecycle tests: duplicate app reopens, close hides while Dock stays, first install enables login launch, prior update preference remains, internal owned stop leaves a neighbor alive, missing setup opens one window, valid setup never reopens key entry (actual UI presentation count unchanged across relaunch/login), no Terminal launch path, unavailable backend stays unavailable.
- [ ] Run `node --test test/mac-desktop-adapter.test.mjs` and `python3 native/macos-desktop/test-lifecycle.py` to red; implement adapter and AppKit client using the Task 1 observed toolchain. No live LaunchAgent modifications yet.
- [ ] Vendor official Lucide plug-zap and ISC attribution, generate navy/teal `.icns`/`.ico` plus readable tray variants. Inspect 16/32/48/128/512/1024 size renderings; verify masks, padding and light/dark contrast. No Apple/OpenAI branding or permanent Dock preference edit.
- [ ] Run focused tests to green and compile the app. In a disposable installation, close the launching Terminal and prove one runtime remains; exercise Dock reopen, a fresh login launch and internal owned stop with a sentinel neighboring process. Record native evidence separately from mocks. No custom management buttons.

## Task 5 — Windows tray/consoleless and protected setup adapter (held on Task 1)

**Files:** create `native/windows-desktop/App.cs`, `native/windows-desktop/PrivateFile.cs`, `native/windows-desktop/test-lifecycle.ps1`, `scripts/windows-desktop-adapter.mjs`, `test/windows-desktop-adapter.test.mjs`. Use Task 4 shared `.ico`/tray artwork; no control-pipe subsystem.

**Interfaces:** `WindowsDesktopAdapter.start/stopOwned/status/ensureLogin` matches Tasks 3–4. Native `PrivateFile` implements Task 2 verified read/replacement with effective ACL, no reparse traversal, link-count and expected-identity checks. C# GUI subsystem app launches the hidden owned supervisor, retains tray on window close and reopens on tray action. Start menu shortcut launches this same app; no second tunnel. Any first-run values pass through an inherited private setup channel, never argv or status.

- [ ] After the Task 1 hold is released, write failing native tests for GUI subsystem/no console flash, paths with spaces, tray/shortcut close/reopen, duplicate launch, first-install login startup, update preference preservation, internal owned stop keeps a neighbor alive, and `.env` ACL/reparse/hardlink/replace-race rejection. Use synthetic fixture files only.
- [ ] Run `powershell -NoProfile -File native/windows-desktop/test-lifecycle.ps1` to red on actual Windows. Implement using only the compiler/API signatures proven in Task 1; `UseShellExecute=false` and `CreateNoWindow=true` on owned console children, not a hidden PowerShell prompt. Preserve existing Windows tunnel binary/config identity independently of GPTWorker.
- [ ] Run native and `node --test test/windows-desktop-adapter.test.mjs` to green. Login registration affects only the exact owned per-user entry, with no machine-wide registry or policy edit. Confirm shell closure does not stop the runtime; valid saved `.env` eliminates subsequent key prompts after login/restart, with actual UI presentation count unchanged.

## Task 6 — Common installer, transactional update and native acceptance

**Files:** create `install.sh`, `install.ps1`, `scripts/desktop-install.mjs`, `test/desktop-install.test.mjs`, `scripts/test-desktop-install-native.mjs`; modify `scripts/mac-package.mjs`, `docs/tunnel/SETUP.md`, `docs/CLI-HANDOFF.md`, `.gsa/CURRENT_CHECKPOINT.md` for observed outcomes only. Do not create new milestones or alter old approval records.

**Interfaces:** `runInstall({action,platformAdapter,sourceRoot,installRoot,envPath}): Promise<InstallResult>`; action is the five-value contract. `InstallResult={state,version,installRoot,previousVersion?,reason?}` contains no secrets. Manifest v1 lists platform/arch, source revision and allowlisted file SHA256/native identity, with `runtime-current.json` updated only after validation. Installer first resolves existing nonsecret `envPath` metadata; no fallback copy of its key.

- [ ] Write red tests `installStagesReturnPrompt`, `spacePathQuoted`, `wrongArchMissingToolsRefused`, `unknownOwnerUntouched`, `partialBuildRetainsPointer`, `stalePointerRefused`, `failedStartRollsBackButFailsUpdate`, `repairPreservesEnvIdentity`, `uninstallKeepsData`, `sentinelAbsentFromRelease`. Assert only the known managed paths are removed and all five actions share the contract.
- [ ] Run `node --test test/desktop-install.test.mjs` to red; implement thin shell/PowerShell wrappers and staged build/verify/activate/open flow. Use exact app/runtime paths from spec; never package secrets/identities/grants/journals/logs/VM media. Missing compiler/client prints remediation, never auto-installs it. `doctor` does not require or display the key. First install enables automatic login startup as requested; update/repair preserve existing preference. Reuse existing minimal maintenance commands rather than adding a management UI.
- [ ] Run focused tests to green. `node scripts/test-desktop-install-native.mjs --platform darwin` and its `--platform win32` counterpart must run on matching hosts with disposable installations; otherwise explicitly skip the unsupported host without claiming PASS. Verify saved-config path/identity/value across install/relaunch/login/update/repair, assert actual setup-window presentation count increases only on the initial explicit setup, no reprompt on transient disconnect, and uninstall preservation. The fixture must never default to live install paths.
- [ ] Tester runs focused deterministic/native checks; Reviewer reviews source, manifests, fixture evidence and secret-exclusion before any live replacement. Present the exact live runtime/login action for user review; actual key entry stays directly in setup UI. After authorized replacement, selected plugin verifies the exact installed host/runtime; no uncertain mutation replay.
- [ ] Run required `node harness/verify.mjs`; report all failures and pre-existing warnings. Update sanitized reports/handoff with hashes, platform evidence and remaining limits, never certify missing backend features or full Mac milestone from packaging success.

## Role triggers, review and execution handoff

The user reviewed the plan and clarified the authoritative minimal scope above. Proceed sequentially through project roles; do not request another design/planning approval. Coder owns one task's listed implementation paths; Tester owns corresponding tests/evidence; Reviewer checks the completed task/patch and exact approved requirement. Use configured gpt-6.1-sol medium (Planner/Coder), gpt-6-luna medium (Tester), gpt-6.1-sol high (Reviewer). Unavailable role/model is BLOCKED; the earlier recovery-only inline exception does not authorize fallback here. At most two subagents. Critic only on a separately configured larger trigger, not routine task review.

Required review points: Task 1 Windows prerequisite hold, private secret-file boundary (Task 2 and Windows part of Task 5), one-owner background launch (Task 3), and source/package/native evidence before live activation (Task 6). A BLOCKING finding names a violated approved requirement plus reproduction; unrelated ideas are OUT_OF_SCOPE and uncertain claims UNVERIFIED. Maximum two repair/review rounds per pair, then report to user. No manual gate-state/checklist completion or Git publication.

The latest scope correction authorizes progress on this minimal delivery. Concrete live-runtime/login replacement and real user credential provisioning still follow Task 6 review boundaries; this is not a reason to delay source implementation. Native inline role substitution would need an explicit project-role exception, not an assumed extension of prior fixture permission.

## Coverage and self-review

| Spec requirement | Tasks / evidence |
|---|---|
| Terminal commands, no tool/dependency auto-install | 1, 6: requirement/refusal and wrapper contract tests |
| Local `.env`, save once, no repeated prompts | 2, 4–6: synthetic reload/login/update/repair and native setup tests |
| Dock/tray icon, no console, close/reopen | 4, 5: render inspection and actual OS lifecycle evidence |
| One runtime, automatic login startup, no runtime console | 3–6: owner/shell-close/login tests plus native sentinel checks |
| Private credential integrity, secret exclusion, independent host identity | 2–6: OS file permission tests, archive/argv/log sentinels, selected-plugin evidence |
| Transactional update/repair/remove preserving data | 6: partial failure, stale pointer, executable rollback and preservation tests |
| Honest platform/backend claims and manual governance | 1, 6 and role triggers: Windows hold, separate evidence, unchanged live gates |

Self-review: task interfaces align; five review-focus classes have named tests; normal saved configuration never triggers key entry; no transient-network reset; old configured `.env` path wins. No Pause/Resume/admission/MCP changes or new management protocol remain. Windows implementation is conditional on a concrete accepted native report. No source or real credential has been changed by this plan. This scope reduction serves the user's stated five delivery requirements and supersedes broader desktop-control work in earlier proposals.
