# Windows Native Connector — Implementation Plan

**Date:** 2026-11-09  
**Status:** PRE-CODE / DRAFT FOR REVIEW  
**Branch:** `feat/windows-native-connector-20261109`  
**Baseline:** `41102fa3e9d2a187c8373b1474e9377b737c66b1` (`main` at branch creation)  
**Authority:** `docs/CRITERIA.md` §§1–10 and user acceptance of Mac (2026-11-09); `docs/DECISIONS.md`; Mac `docs/{IMPLEMENTATION_PLAN,MILESTONES,TECHNICAL_PROPOSAL}.md`. See companion `WINDOWS_MILESTONES.md`, `WINDOWS_TECHNICAL_PROPOSAL.md`, `WINDOWS_JOB_GUIDE.md`.

## 1. GOAL and product boundary

Build the second, independent **Windows host** of the existing GSA-Localconnector. The online GSA invokes the already-defined MCP tools against the selected Windows machine; the Windows connector executes them using local Windows filesystem, commands and installed toolchains. It is **not** another AI agent, not a Mac-to-Windows file bridge, not a VM, and not a bespoke CI/DAG service.

Target end-to-end: select workspace/reference roots on Windows; read/search/list; safely create/edit/patch/copy/move/delete files; inspect/copy directories with bounded journal/readback; run native PowerShell, CMD, Git, node, project scripts/build/test; track/cancel owned jobs; run the connector on user login using the existing tunnel model; recover truthful state after a normal app quit/restart. Two machines use separate plugins, grants, keys and state. No simultaneous Mac+Windows testing is required.

Mac is user-accepted and **frozen as the reference behavior**, not a Windows test oracle. Windows proof must be generated separately. This task authors documents only; **no product code or installation before planning review and implementation authorization**.

## 2. Scope and latest UI decision

- Required: workspace full allowed functionality and reference read/copy-out only; multiple independent projects, grants/revocation, logs, diff, bounded network authorization, process status/stop and truthful UNKNOWN.
- Windows desktop: **Open and Quit only**, background/tray application and optional start at user login. **Do not implement Pause/Resume**. Mac PR #15 is historical source, not Windows feature scope.
- No anti-sleep, machine-wide global process kill, installer services with admin privileges by default, new VM, extra connector reasoning/orchestrator, per-operation human approval, or blanket network Git permission.
- Real Windows reboot acceptance is **deferred** under the current user direction about reboot. Preserve crash/restart recovery design and test what is safely testable without reboot; do not report reboot PASS.
- The older `CRITERIA.md` §8 and `DECISIONS.md` still mention Pause/Resume. This is an **outdated-document reconciliation** required before implementation approval; the user explicitly superseded it with Open/Quit, not an invented requirement change. Do not silently edit approved criteria during this pre-code task.

## 3. Mac-to-Windows reuse matrix

| Area | Reuse | Windows-specific work |
| --- | --- | --- |
| MCP catalog, schemas, dispatch | `src/mcp/{server,catalog,write-dispatch,runtime-bootstrap}.ts` contracts | Platform-specific bootstrap, truthful capability/state labels |
| Workspace selection | `src/core/workspace.ts`, contracts, grant roles | Canonical Windows root/volume identity, case-insensitive names, UNC/reparse rules, durable Windows grants |
| File operations | `src/core/{native-io,write-engine,edit-guards,file-transactions}.ts` | Win32 handle-relative native backend, atomic/conflict guards, cross-volume copy/move |
| Directory | `src/core/directory-copy.ts`, `src/local/directory-copy-store.ts` | Verified Windows tree reader and copy engine; junction/reparse and cycle rejection |
| Command/process | `src/core/{process-manager,durable-process}.ts` | Native Win32 launcher, working-directory identity, Job Objects for owned descendants, capped logs/timeouts |
| Git | `src/core/{git-plans,git-engine}.ts` | Local Git via Windows runner; remote requires separate enforceable network capability and trust restrictions |
| Durable data | Current private journals, transaction IDs, readback schemas | Windows ACL/DPAPI appropriate to threat model, locking and stale-owner reconciliation |
| Transport | Existing tunnel/auth/session model | Windows background host/tray and installer, credential storage, one connector owner |
| CI | Existing Node tests and CI patterns | GitHub-hosted `windows-latest` explicit native gates, then real Windows acceptance |
| Candidate | `src/hosts/windows-appcontainer-candidate.ts`, `scripts/native-gate-windows.ps1` | Research-only: prove OS support before relying on sandbox; do **not** claim `verified=true` |

Do not copy macOS `codesign`, Seatbelt, launchd, `renameatx_np`, POSIX FDs/lock semantics or Swift binaries into Windows code. Preserve common user-visible contracts, not low-level implementation.

## 4. Sequential phases

### W0 — Baseline and contract reconciliation (no product code)

Inventory the exact Windows-relevant source entrypoints and tests; record API contracts and current gaps; fix out-of-date references to Pause/Resume by an explicitly reviewed documentation decision; define Windows-supported host versions and architectures through evidence, not guesses. Pin branch SHA, workspace boundaries and acceptance fixtures. Critic/reviewer checks that no new authorization gate or VM was introduced.

### W1 — Windows host foundation and identity

Create a Windows owner/session mechanism and persisted grant store; enforce exclusive connector owner without modifying unrelated processes; store secrets safely and separately from workspace roots. Prove durable root identity under rename/replacement, drive-letter aliases, case changes, junctions, symlinks, alternate data streams, UNC paths and inaccessible volumes. Implement read-only capability probes that never assert enforcement from API presence alone.

### W2 — Native files and directories

Implement per-operation Win32 path/handle containment and recoverable mutations. No ordinary `path.resolve` + `fs` precheck is considered sufficient against TOCTOU. Deny unsafe reparse points and name ambiguities; implement versioned CAS replace/delete, atomic create, copy/move within/across approved roots, readback and conflict/UNKNOWN outcomes. Directory support separately qualifies traversal, manifest bounds and destination integrity. Stage in temporary fixture roots only; integration cannot enable unqualified capabilities.

### W3 — Native commands, Git, process and logs

Launch from the granted workspace or child cwd as the logged-in user. Under the approved §7 exception, this runner is **not OS-confined** and must advertise `command_confinement: none (user account)` and `state_integrity_vs_commands: not_protected`. Use a scoped initial cwd, minimal environment, bounded time/output; track process tree ownership (Job Objects) and avoid killing neighbors. Local Git and scripts/test/build in non-Git folders must work. Remote Git remains blocked until an independently reviewed, restricted network capability is demonstrated; report missing functionality truthfully, not as success.

### W4 — MCP integration, Windows CI and Desktop delivery

One integration owner wires the verified Windows backends into the existing dispatch and capability status without breaking Mac. Dedicated `windows-latest` workflow exercises Node typecheck/tests plus actual Windows file, directory and process fixtures. Build/test a per-user installation with background/tray Open/Quit and tunnel initialization from saved protected configuration; never embed secrets in artifacts. GitHub CI runs on exact candidate SHA before user-machine installation.

### W5 — Real Windows acceptance and closure

User-selected Windows machine: install/update, connect from separate Windows plugin, bind one workspace plus one reference, execute file and directory operations, projects with and without Git, build/test process lifecycle, safe cancellation, local Git, tunnel quit/relaunch, unknown/partial recovery and a second independent project. Confirm full workflow against the exact installed version; record failure/blocked/unverified cases instead of PASS. Reboot excluded; outstanding defects become Issues after explicit user acceptance.

## 5. Development process and controls

- **One Windows development branch:** `feat/windows-native-connector-20261109`; no edits to `main`, no merge or force-push during PRE-CODE.
- Plan/Proposal/Guide are separate from production implementation; each task receives a Job Instruction derived from milestone and technical proposal, not a copied harness.
- Parallel changes only where file ownership does not overlap. Source integration and MCP dispatch modifications are serial.
- Every feature has (a) contract and path owner, (b) negative safety tests, (c) exact SHA Windows-hosted CI, (d) honest report, (e) Windows native acceptance when necessary.
- If runtime confinement or a network policy cannot be proven, keep that feature explicitly blocked. The accepted **unconfined command exception** does not weaken scoped file-tool boundaries.
- Git remote must not be routed through an unconstrained command runner as a workaround for `gitPlan` network denial.

## 6. Acceptance and evidence

| Gate | Required evidence |
| --- | --- |
| P0 planning | Four mutually consistent docs, criteria traceability, source inventory, Critic findings closed or recorded; human implementation approval |
| G1 foundation | Windows user session, grants, owner/rebind, hostile path tests and persisted-state assertions on `windows-latest` |
| G2 files | Native file+directory containment, conflicts and readback/UNKNOWN; signed/attested mechanism appropriate to Windows, not macOS analogies |
| G3 commands | Real `powershell.exe`, `cmd.exe`, Git local, node and owned Job Object cancellation; neighbor process survives |
| G4 integration | Same MCP schemas, cross-platform regression (Mac unaffected), all required Windows suites PASS at exact candidate commit |
| G5 installed | Real Windows plugin and user workflow with receipts and version; Open/Quit/tunnel and multiple roots, no reboot requirement |
| Final | User accepts Windows; unresolved reproducible defects tracked as Issues, unimplemented restricted network Git disclosed |

## 7. Known open design questions to resolve before code

1. **Native file protection:** selected Win32 handle-relative technique for secure create/delete/replace/rename across reparse points and volume changes; prove with Windows-native tests before enabling.
2. **Windows process owner:** Job Object + process handle lifecycle and how child escape/breakaway is treated; no global PID-only cleanup.
3. **Network Git:** whether verifiable restricted network capability exists in the chosen host; do not pretend AppContainer API availability equals proof.
4. **Windows runtime and distribution:** per-user supported Windows version/CPU, packaged Node/installer, tray auto-login and safe update locks; record choices in Proposal/Job evidence.
5. **Document reconciliation:** latest Open/Quit decision supersedes older Pause/Resume prose; align authoritative docs through review without broad criteria changes.

## 8. Completion rule

Pre-code planning is **READY FOR REVIEW** once the four documents are persisted and cross-checked. It is **not approval to write Windows implementation**. Implementation begins only on the reviewed job pack and authorized branch. Any task requiring a real Windows PC remains **PENDING USER REQUIRE** if no Windows host is connected; hosted Windows tests alone cannot impersonate it.
