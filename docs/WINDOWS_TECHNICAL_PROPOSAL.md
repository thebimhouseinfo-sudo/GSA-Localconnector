# Windows Native Connector — Technical Proposal

**Updated:** 2026-11-12 (V2 shared-source reconciliation)  
**Status:** PRE-CODE — technical review required  
**Repository/branch:** `thebimhouseinfo-sudo/GSA-Localconnector` / `feat/windows-native-connector-20261109`  
**Branch fork:** `41102fa3e9d2a187c8373b1474e9377b737c66b1`; **newer `main` inspected, not merged:** `bce187542ec68491f29a95b4a876fd7b4dc5648e`

## 0. Goal, authority and non-goals

Deliver a native Windows backend beneath the **existing** GSA-Localconnector MCP interface. Preserve approved workspace/reference behavior and existing API/result formats; GSA owns planning and reasoning. Share TypeScript core contracts, role/revision checks, CAS, diff, Git plans, process and transaction state. Replace only host-specific implementations, platform wiring and installer/lifecycle.

Read in order: `docs/CRITERIA.md` (especially §§1,5,7–10) → `docs/DECISIONS.md` → `docs/WINDOWS_IMPLEMENTATION_PLAN.md` → `docs/WINDOWS_MILESTONES.md` → this proposal → relevant source → `docs/WINDOWS_JOB_GUIDE.md`. macOS `docs/TECHNICAL_PROPOSAL.md` is a design/reference, **not** a command to port its POSIX mechanisms. No VM, local AI, bespoke CI engine, admin daemon or per-operation approval gate.

Most recent user-scoped lifecycle decision: **Open/Quit only**. Older Mac Pause/Resume text is not Windows scope. Reboot acceptance is excluded in this iteration; process-crash/relaunch evidence still required. Outdated Criteria wording to be reconciled through a reviewed documentation change, not an implicit new product requirement.

## GOAL

Build the second native Windows host beneath the existing MCP contract, reusing tested Mac-side product semantics without importing POSIX/Swift/launchd implementation. Prove native scoped-file authority and process ownership on Windows and confirm outcomes through selected-plugin readback. No VM, local AI, additional CI platform, Pause/Resume, per-operation work approval or misleading sandbox claims.

## V2 — Inherited shared changes and Windows-specific decisions (2026-11-12)

These requirements are derived from newer shared-source changes seen on `main`; they are **design and test obligations**, not Windows-native implementation evidence. Current Windows branch originally contained only four documentation files, ahead 4 / behind 67 at inspection. New branch policy has been persisted for the Windows branch; merge/reconcile newer common code before W1 implementation and re-pin the candidate SHA. Preserve Mac code and its real-host acceptance history, and do not mislabel remote Git as accepted.

### A. Grant reauthorization and native backend readiness (W1-04, W2-01, W4-01)

Reuse the common grant inventory and the selected-only root rebind semantics now found in `src/local/grants.ts`, `src/core/workspace.ts`, `src/mcp/server.ts` and `docs/workspaces/LOCAL-ENROLLMENT.md`: `ACTIVE`, `STALE`, `REAUTH_REQUIRED`, `REVOKED`, versioned root identity and independent preservation of unrelated stale grants. Windows root identity must be independently proven with volume/file handles and alias/reparse-negative tests.

**Two different readiness layers:** `bind_workspaces` may persist an explicitly selected, newly verified root while the native file-grant/backend installation still refers to an older grant set. Report that mismatch with a structured actionable recovery diagnostic, *not* a false successful file capability. An attempted mutation must fail closed. W1-04 investigates a safe qualified update scheme with owner fencing, atomic install/readback and preserved previous generation/journals; only qualified proof may activate a new grant set. Never treat easier update UX as permission to skip signature/identity/recovery protections. Source tests and real selected Windows plugin evidence cover both successful sync and blocked mismatch.

Required negatives: stale root replacement, unrelated stale record, root/volume alias, revoked control lease, protected store corruption, missing/failed native installer, owner still active during replacement and a failed upgrade preserving the previous installation. `UNKNOWN` is never automatically retried as a successful operation.

### B. Existing binary/image import (W2-05, W4-01, W5-02)

`src/mcp/image-file-transfer.ts` already defines the host-supplied `file` input, approved HTTPS download, no redirects/URL credentials, bounded image data, PNG/JPEG/WebP signature and extension validation. Keep the existing **MCP tool and `_meta["openai/fileParams"]=["file"]` protocol**; do not reimplement image parsing or use chat-assembled Base64 as a special Windows workaround.

The Windows adapter must connect **that validated byte stream** to a native, scoped exclusive-create file operation. Existing `create_file_bytes` and `fetch_file_bytes` share the same workspace and write-grant authority; reject references as destinations and do not allow a failed native backend to trigger a generic unconfined `fs.writeFile` fallback. Responses require source/import SHA-256 and independently fetched local bytes/metadata. Every output path must be a grounded workspace-relative path; absolute output paths are derived only from verified Windows workspace identity.

Tests: legitimate host fileParam object, unresolved string/ID, missing fields, bad/redirected URL, disallowed hostname, MIME/signature/extension mismatch, >8MiB, malicious relative path/ADS, collision, read-only reference, revoked controller, stale backend grant, short transfer/interrupted write and preserved source/readback hash. The existing `test/mcp-image-file-import.test.ts` contains a POSIX-controller fixture skipped on win32; **a Windows-skip does not count as Windows PASS**. Native fixtures on `windows-latest` and an end-to-end actual ChatGPT image artifact through the selected Windows plugin are separate gates.

### C. Startup, installation and truthful capabilities (W1-03, W4)

Examine `src/mcp/startup-registry.ts`, `scripts/desktop-install.mjs` and Mac adapter fixes for accepted *state semantics* (single instance, owner fence, no unverified ready/quit, preserve tunnel key and protected state). Implement Windows-native per-user tray and setup; do not import macOS `launchctl`, Dock or helper binaries. The user-facing design is Open/Quit only, no Pause/Resume. Quit may safely defer while owned work is not proven idle; never kill other apps or falsify completion. Reboot remains excluded from this iteration's acceptance while process crash/relaunch and stopped-owner maintenance can be tested on disposable fixtures.

The Windows MCP capability status must differentiate (1) read/list ability, (2) native file mutation readiness and its grant-sync state, (3) binary/image operations, (4) command runner ownership and unconfined filesystem effect, (5) network Git blocked or proven, and (6) installed adapter/source identity. Do not enable methods merely because the schemas are present or Mac evidence is green.

### D. Provenance and test strategy

- During W0 integrate the **current** `main` into this Windows branch in a separately reviewed Git operation; preserve all four pre-code files and user-owned state, without force-push or writing `main`.
- Windows hosted test gate: actual Win32 filesystem+Job Object fixtures, real tool dispatch, exact commit/source provenance, explicit fail on required skip/missing runner. Mac source/regression gate on the same integration commit is separate.
- Real Windows plugin acceptance after reviewed hosted CI and installer authorization; user-owned test roots only; verify imported image original bytes against file API readback rather than asserting success from an MCP response.
- Review source interfaces before replacing or extending any shared contract; one integrator owns `src/mcp/server.ts`, `catalog.ts`, `runtime-bootstrap.ts` and `write-dispatch.ts`.

## 1. Baseline and integration seams

| Existing contract or implementation | Retain / change |
| --- | --- |
| `src/core/native-io.ts`: `NativeScopedFiles`, `NativeDirectoryCopies`, `NativeRecoverableFileMutations`, `VerifiedNativeSandbox`, process controller | Retain schemas; Windows implementation implements real methods only when proven; unused `verified` marker must not imply OS sandbox |
| `src/core/workspace.ts`: role/grant, immutable root identity and revision | Reuse role logic; Windows identity from canonical opened volume/file-ID handles, not Unix device/inode assumptions |
| `src/core/write-engine.ts`, transaction/patch guards | Reuse pre/post SHA and statuses, with native Windows atomicity and identity readback |
| `src/core/directory-copy.ts` and `src/local/directory-copy-store.ts` | Reuse manifest and acknowledgment format; new Win32 native traverser |
| `src/hosts/macos-host-commands.ts` | Reference for outcomes, not POSIX spawn/group semantics |
| `src/local/grants.ts`, `src/core/workspace.ts` (new selected-only recovery) | Reuse ACTIVE/STALE/REAUTH_REQUIRED/REVOKED and rebind-only-selected semantics; Windows root identity separately verified |
| `src/mcp/image-file-transfer.ts`, `src/mcp/server.ts` (new import) | Preserve host fileParam, download validation and `import_image_file`; Windows exclusive create + native byte readback required |
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
| F2 | file CAS, crash/partial journal, copy/move, directory traversal, binary/image import and readback | `windows-latest` | Native backend receipts and no unintended writes |
| F3 | PowerShell/CMD/node/Git, Job Object owned cancellation, neighbor unaffected | `windows-latest` | Actual process+child handles verified |
| F4 | MCP tool invocation, two workspaces and reference, Mac regression | Windows + Mac CI | Exact SHA both platforms PASS, no misleading capability flags |
| F5 | tray Open/Quit, protected tunnel setup, installer repair/uninstall | Hosted package smoke then user Windows | No secret exposure; normal app and tunnel lifecycle |
| F6 | selected user Windows full workflow including genuine image host fileParam and independent SHA readback | Windows PC via its own plugin | Real outputs and user acceptance; reboot excluded |

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
