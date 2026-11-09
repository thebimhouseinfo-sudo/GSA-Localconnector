# Windows Native Connector — Technical Proposal

**Date:** 2026-11-09  
**Status:** PRE-CODE — technical review required  
**Repository/branch:** `thebimhouseinfo-sudo/GSA-Localconnector` / `feat/windows-native-connector-20261109`  
**Source baseline:** `41102fa3e9d2a187c8373b1474e9377b737c66b1`

## 0. Goal, authority and non-goals

Deliver a native Windows backend beneath the **existing** GSA-Localconnector MCP interface. Preserve approved workspace/reference behavior and existing API/result formats; GSA owns planning and reasoning. Share TypeScript core contracts, role/revision checks, CAS, diff, Git plans, process and transaction state. Replace only host-specific implementations, platform wiring and installer/lifecycle.

Read in order: `docs/CRITERIA.md` (especially §§1,5,7–10) → `docs/DECISIONS.md` → `docs/WINDOWS_IMPLEMENTATION_PLAN.md` → `docs/WINDOWS_MILESTONES.md` → this proposal → relevant source → `docs/WINDOWS_JOB_GUIDE.md`. macOS `docs/TECHNICAL_PROPOSAL.md` is a design/reference, **not** a command to port its POSIX mechanisms. No VM, local AI, bespoke CI engine, admin daemon or per-operation approval gate.

Most recent user-scoped lifecycle decision: **Open/Quit only**. Older Mac Pause/Resume text is not Windows scope. Reboot acceptance is excluded in this iteration; process-crash/relaunch evidence still required. Outdated Criteria wording to be reconciled through a reviewed documentation change, not an implicit new product requirement.

## 1. Baseline and integration seams

| Existing contract or implementation | Retain / change |
| --- | --- |
| `src/core/native-io.ts`: `NativeScopedFiles`, `NativeDirectoryCopies`, `NativeRecoverableFileMutations`, `VerifiedNativeSandbox`, process controller | Retain schemas; Windows implementation implements real methods only when proven; unused `verified` marker must not imply OS sandbox |
| `src/core/workspace.ts`: role/grant, immutable root identity and revision | Reuse role logic; Windows identity from canonical opened volume/file-ID handles, not Unix device/inode assumptions |
| `src/core/write-engine.ts`, transaction/patch guards | Reuse pre/post SHA and statuses, with native Windows atomicity and identity readback |
| `src/core/directory-copy.ts` and `src/local/directory-copy-store.ts` | Reuse manifest and acknowledgment format; new Win32 native traverser |
| `src/hosts/macos-host-commands.ts` | Reference for outcomes, not POSIX spawn/group semantics |
| `src/mcp/runtime-bootstrap.ts` | Currently Mac-only; introduce platform composition with strict selection; one integration owner |
| `src/core/git-engine.ts` | Local Git plans reusable; remote remains blocked until limited network proof |
| `src/hosts/windows-appcontainer-candidate.ts` and `scripts/native-gate-windows.ps1` | **Candidates/probes only**, never a verified host backend |
| `scripts/desktop-*`, Mac app and tunnel code | Reuse config schema and startup invariants; Windows tray/installer native |
| `src/local/*-store.ts` | Reuse schemas and record identity, implement Windows ACL/lock/readback equivalents |

Record exact imports/callers before modifying these shared seams. A change to shared code requires both Windows tests and a Mac regression check.

## 2. Windows authority and threat model

### 2.1 File tool/API versus commands

**Connector file tools** must be contained at OS-native operation time within authorized roots and roles. `workspace` permits read/write; `reference` permits list/search/read and copy-out, but not source delete/move or target writes. All roots have explicit selection, durable identity and revisions. Binding a project grants its allowed operations; no second connector-side work approval.

**Shell/PowerShell/CMD/Git local/build/test** runs under the logged-in user's account with cwd inside an authorized workspace. As accepted for Mac in Criteria §7, it is *not OS-confined*; report exactly:
- `command_confinement: none (user account)`
- `state_integrity_vs_commands: not_protected`

Reject requests whose initial cwd is outside the granted workspace or in reference roots. State that child scripts can access outside workspace under Windows user privileges. Do not call that a sandbox. Keep timeout/output caps, minimal environment and correct ownership-based cancellation.

**Network Git** must be a separate capability with enforceable endpoint/proxy/credential policy, not generic `run_command(["git","fetch"])` as a bypass. If no enforceable policy has been demonstrated, continue returning `SECURITY_BLOCKED` for fetch/pull/push and advertise it as unavailable. Review usability tradeoff with the user when that gate becomes material.

### 2.2 Path identity, case, reparse points

Root selection resolves through the Windows filesystem once, opens and pins a directory handle, and records stable volume identity + file ID/reparse characteristics + canonical resolved path and grant revision. Do not rely on `path.win32.resolve()` alone. Windows drive-letter mapping, volume GUID aliases, case-insensitivity, 8.3 names, junctions, mount points, symlinks, UNC, `\\?\` and alternate data streams need explicit classification. A new or replaced root, revoked grant, changed drive/volume or changed canonical identity blocks stale tool operations. Reject reserved device names, trailing dot/space ambiguity, embedded NUL, path segments `.`/`..`, alternate streams and unexpected reparse traversal. Do not assume every Windows filesystem exposes the same semantics; start from observed NTFS/Windows runner and record unsupported volumes.

For each file operation: validate a lexical relative path **then** traverse using pinned opened directory handles; recheck identity at the actual create/open/rename/delete, not only before. Prevent time-of-check/time-of-use escapes by adversarial junction swap tests. A path string returned to the model is not an authority token. Temporary paths, output artifacts and journal roots remain separated from authorized project data.

### 2.3 Durable private state and secrets

Use per-user private Windows storage protected with DACL restricted to the owning user and SYSTEM as appropriate; consider DPAPI for long-term tunnel/runtime credentials, never print secrets. Owner process/session must acquire a Windows-exclusive lock and reject a second running instance without killing the first. Persist workspace selections, grant revisions, transaction IDs and process receipts with atomic replacement plus flush/readback. On startup reconcile stale owner records; differentiate `APPLIED`, `CONFLICT` and `UNKNOWN`. A failed or incomplete write must never be replayed automatically merely because a journal is present.

A shell child may access connector state under the accepted unconfined-user-account exception; expose the risk accurately rather than claiming absolute integrity.

## 3. Native scoped file backend

### Candidate design, with proof gate

A minimal native Win32 broker in C#/.NET or a thin native C/C++ module is acceptable **only after a feasibility spike** proves safe handle-relative operations using Windows APIs (e.g. `CreateFileW` with appropriate flags; native `NtCreateFile` relative handles where justified, `GetFileInformationByHandleEx`, `SetFileInformationByHandle`, flush and exclusive rename semantics). Prefer the smallest verified implementation with typed messages and bounded outputs. Avoid using PowerShell `Copy-Item` / `Remove-Item` / naive Node `fs` as the privileged file-tool boundary.

A `windows-appcontainer-candidate.ts` manifest is **not** working confinement. Existing experimental Microsoft AppContainer API is only considered if supported on the selected Windows host and proven with real hostile tests; otherwise use a separate verified handle-relative file broker, while commands remain intentionally unconfined per §7.

### Operations

| Function | Required behavior |
| --- | --- |
| read/list/search/get_file_info | Pinned volume/root, no reparse traversal escape, bounded reads and metadata; accurate SHA-256 |
| create_file/create_directory | Exclusive creation (never overwrite) and commit/readback; conflict distinct from success |
| update_file/edit_file/apply_patch | Expected source SHA + version/identity check, atomic replacement where Windows supports it; return journal + retained previous state |
| delete_file | CAS + native reversible capture/quarantine, verified disappearance or UNKNOWN; no blind permanent delete |
| copy_file | Source read pinned from workspace or reference, destination exclusively in workspace, verified hash |
| move_file | Workspace source only; same-volume proven atomic move or verified two-phase copy+recovery-trash; cross-volume partial effects explicit |
| inspect_directory/copy_directory/get_directory_copy | Bounded tree manifest, reject reparse loops/unsupported entries, copy files exclusively with journal and per-entry acknowledgments, readback |
| get_file_transaction | Verifiable persisted intent and current outcome; no re-execution during readback |

For unsupported filesystem atomicity or interrupted states, return `UNKNOWN`/blocked rather than auto-retry. Tests must include a conflict after destination creation, a source change during copy, access denied, reparse point swap, cancellation, disk full and incomplete journal.

## 4. Native Windows command/process host

- Spawn Windows processes using proper executable/argv handling; never construct a shell command string by concatenating untrusted arguments. To run shell scripts, explicitly choose `powershell.exe -NoProfile ...` or `cmd.exe /d /c ...`, and document quoting/expansion semantics. Absolute executable resolution from approved toolchain or PATH is permitted for commands inside trusted project workspaces.
- Set process cwd to the canonical selected workspace/subdirectory, verify source role and root identity before launch. Do not promise filesystem confinement of child effects.
- Create a **Windows Job Object** before the child can escape ownership; attach processes securely, handle descendants and disallow unintended breakaway (or record `UNKNOWN` if uncontrollable). Use process handles, not historical PIDs alone. `stop_process` signals only connector-owned work, never `taskkill /F /IM` or a global PID sweep. If Job Object attachment fails, do not claim ownership, fail admission/mark state unknown.
- Persist bounded stdout/stderr (UTF-8 conversion with explicit encoding behavior), exit codes, timeout, cancellation and output-limit flags. Preserve per-project separation; protect process journal from duplicate re-execution.
- Test: non-Git PowerShell script; Node build/test; local Git; command failure and timeout; process with child; cancellation while unrelated Windows process remains alive; restart reconciliation and `UNKNOWN`.

## 5. Git and network

Use existing `gitPlan` allowlist and local `executeGit` with Windows native process adapter. It must work for local repositories and preserve unrelated dirty/untracked content. Validate executable and workspace identity; harden environment to prevent accidental token/helper leaks, and disable hooks for connector-authored operations where appropriate.

**Remote phase is separate**: a deliberate restricted-network adapter must prevent arbitrary remote URLs, `insteadOf` rewrites, unexpected redirects and unsafe credential helpers. It must pin permitted GitHub HTTPS endpoints, source grant and authorization; preserve proper user consent to network/key use and verify ff-only pull behavior. If the platform cannot prove this boundary, remote remains `NETWORK_CAPABILITY_NOT_VERIFIED` and is not part of falsely reported native PASS. May use the connected GitHub plugin for remote repository operations in ChatGPT, but this is **not** equivalent to local Git remote PASS.

## 6. MCP composition and status

Only one integrator touches shared `src/mcp/runtime-bootstrap.ts`, `server.ts`, catalog and dispatch. Refactor bootstrap into platform adapter selection:
- macOS: existing `MacNativeCommands` and signed native file loaders unchanged.
- Windows: checked Windows owner+grants; verified file backend and directory; logged-in-user process adapter.
- Any other OS/unqualified host: fail-closed capability unavailable.

Expose host `windows-native`, truthful support flags, native file/recovery/directory readiness, `command_confinement`, `state_integrity_vs_commands`, local-only vs remote Git and detailed blocked reasons. Never advertise a method merely because its interface or a manifest planner exists.

Maintain old tool names, `workspace_id`, role semantics, hashes, transaction and process receipts. Requests across different machines never reuse root identity or control token.

## 7. Windows desktop and installation

Implement smallest per-user Windows tray/background application with **Open and Quit**; allow start at user login, one-instance owner, safe tunnel start/stop, saved per-machine connection settings, and observable status. No Pause/Resume, no anti-sleep, no hidden always-on daemon after Quit. Keep other Windows apps and services untouched. Quit must stop owned tunnel/helper processes only; when active operation state cannot be proven idle, fail safe and report inability to complete Quit rather than terminate unknown work.

Deliver one reviewed install/update/uninstall workflow, no unnecessary administrator privilege, no unrelated registry/system changes. Protect API key/tunnel ID with per-user secrets storage, fail-closed parsing, ignore .env and generated private files in Git, no secrets in logs/CI artifacts. On failed upgrade preserve last working installation and journal.

## 8. Native feasibility & CI matrix

| Gate | Example tests | Where | PASS rule |
| --- | --- | --- | --- |
| F0 | Windows version/API probe, AppContainer candidate feasibility, filesystem type | Hosted Windows | Recorded availability, **not** security certification |
| F1 | Grants, aliases/junction escape, root swap, reference no-write | `windows-latest` real Windows filesystem | Actual Win32 negative cases PASS |
| F2 | file CAS, crash/partial journal, copy/move, directory traversal and readback | `windows-latest` | Native backend receipts and no unintended writes |
| F3 | PowerShell/CMD/node/Git, Job Object owned cancellation, neighbor unaffected | `windows-latest` | Actual process+child handles verified |
| F4 | MCP tool invocation, two workspaces and reference, Mac regression | Windows + Mac CI | Exact SHA both platforms PASS, no misleading capability flags |
| F5 | tray Open/Quit, protected tunnel setup, installer repair/uninstall | Hosted package smoke then user Windows | No secret exposure; normal app and tunnel lifecycle |
| F6 | selected user Windows full workflow | Windows PC via its own plugin | Real outputs and user acceptance; reboot excluded |

CI YAML must make required native suites explicit. No `skip`/fixture absence treated as success. Test only disposable directories and benign processes; do not install drivers, alter global policy, kill neighboring processes, use VM or write outside approved test roots. If platform lacks a required API, surface a finding and alternative design, not a fabricated PASS.

## 9. Design review and corrections required

Before implementation:
1. Independently review whether the scoped file broker can truly satisfy Win32 reparse/TOCTOU and recovery requirements without unnecessary complexity. Prototype permitted only **after** W0 approval.
2. Resolve whether AppContainer is useful at all. Command confinement remains none by policy; file tools need proven containment. Do not conflate these.
3. Prove file/volume identity compatibility and control ownership for selected Windows versions and architecture.
4. Review restricted remote Git independently and keep it disabled absent enforceable proof.
5. Review Windows tray Open/Quit vs older Pause/Resume docs. Reconcile the historical text without adding unwanted UI.
6. Confirm each deliverable has an owner and acceptance evidence; refine Job Instructions when upstream findings arrive.

## 10. Decision record and current status

- **Decision:** Windows host implementation is a separate platform adapter under reusable core/MCP contracts.
- **Decision:** Windows commands intentionally unconfined as a user-account operation; only connector file tools claim scoped authority, after native evidence.
- **Decision:** No unverified experimental AppContainer as `VerifiedNativeSandbox`.
- **Decision:** Minimal user-facing lifecycle = Open/Quit; reboot not a gate this round.
- **Decision:** Truthful `UNKNOWN` and retained journals dominate convenience/autoretry.
- **Not done:** Windows native code, security probe, GitHub `windows-latest` CI, selected Windows host test, Windows acceptance and independent Critic review.

**This document proposes an implementation, not a certification. No Windows product code is authorized or marked complete by writing it.**
