# P0 — Source Baseline, Native Mac Interface Freeze and VM Retirement Inventory

## GOAL

Complete all **GitHub-verifiable** P0 source checks and produce an executable contract freeze without modifying product code, local Mac settings, installed plugin, user-owned media or unrelated processes. P0/G0 PASS additionally requires exact current physical Mac checkout/grant/selected-plugin evidence, reconciliation of the durable GSA Job and independent planning Reviewer PASS.

**Bound source target:** `thebimhouseinfo-sudo/GSA-Localconnector`, branch `plan/mac-native-ci-vm-retirement-20261105`, commit `8e79bcec510e75306af4c232f0c161526d150739` at initial read. Tree is full (`truncated:false`, 434 entries); docs-only changes after this audit need their own source HEAD re-pin. Product Criteria blob `3386b803ef655d4398d438c6c6b0d8a3343afb24` agrees byte-for-byte with GSA Memory Criteria. Human-approved 2026-11-05 VM freeze is recorded at `docs/DECISIONS.md` blob `8f48fded38012bf6943e17799fcddb5665f73392`. GitHub-hosted macOS CI was green on the source-docs revision `8e79bce...`, but it only runs Node build, non-VM unit suites and source-capture; it **does not** certify native command/file/selected installed-plugin behavior.

## P0-01 — Source, Git branch and physical Mac custody

| Check | Evidence / disposition |
|---|---|
| GitHub product repository | Exact source branch/HEAD above, full recursive tree fetched; no product source was written during P0 audit |
| GitHub review branch | `plan/mac-native-ci-vm-retirement-20261105` is confirmed and active under GSA Project Branch Policy; `main` reserved for release |
| Source Criteria | Current approved §7: arbitrary Mac shell runs as logged-in user, `cwd` inside bound working root; commands are not OS-confined; status reports `command_confinement:none (user account)`, `state_integrity_vs_commands:not_protected` |
| Local Mac dirty checkpoint | `docs/MAC-QWEN-HANDOFF.md` blob `1586ba73154739ba2c9d05e1700d33a8a7b3a377` warns `main` was at `c41188e` at handoff; local commits not pushed and unrelated untracked `docs/proposals/` exist. **Not independently inspectable from GitHub**; do not assume checkout clean, fetch/pull/reset or cherry-pick |
| Connected Mac host | `gsa_lc_mac.connector_status` returned `platform:macos`, `arch:arm64`, `workspaceStartupIssue:WORKSPACE_ROOT_CHANGED`, `workspaceSelectionRequired:true`, `readyForShell:false`, `fileBackendAvailable:false`, `git:blocked`, `native-tree-recovery-not-certified`. `list_workspaces` returned `[]`. No active grants; Mac-local checkout and selected installed-plugin code revision remain **UNKNOWN** |
| Mac custody action | **NO LOCAL MUTATION**. Later, when the user re-enrolls an actual authorized workspace, perform read-only `git status --short`, `git rev-parse HEAD`, `git branch --show-current`, `git log -n 5` and installed app identity/hash; retain and reconcile unpushed/dirty files before any product code work. A connected plugin reporting a platform is not enough to certify installed behavior |

**P0-01 verdict:** remote source inventory PASS; local dirty/installed-plugin ownership proof BLOCKED by no bound Mac workspace, not silently passed.

## P0-02 — Frozen actual contract and single-writer registry

| Seam | Observed source contract | Owner / permitted future implementation |
|---|---|---|
| Native file API | `src/core/native-io.ts`: `NativeScopedFiles`, `NativeRecoverableFileMutations`, `NativeDirectoryCopies`, `ScopedFileRef` | Track A owns checked `src/hosts/macos-*-file*.ts`, `src/hosts/macos-directory*.ts`, `native/macos-files/*`, scoped-file installer, file/directory stores/tests; integrator alone owns server dispatcher/wiring |
| File delivery/owner | `src/mcp/runtime-bootstrap.ts`: `loadMacScopedFiles` under verified lockFD/owner and `loadCheckedMacDirectoryInstallation` composition, owner fence; `src/local/mac-owner.ts` uses verified FD 3 owner session | REUSE Mac owner, workspace registry, native broker, durable file transactions. No duplicate installer, grant database, journal or separate local agent |
| Command request | `src/core/native-io.ts`: `SandboxedProcessRequest` `workspace_id/executable/argv/cwd_relative/time_limit_ms/max_output_bytes/network_allowed` plus optional ID/artifacts; `VerifiedNativeSandbox.execute/cancel` and `VerifiedNativeProcessController.start/status/output/stop` | Track B owns native Mac host runner adapter and related `src/core/process-manager.ts`, `durable-process.ts`, `git-engine.ts`, journal/process store. Existing interface name `VerifiedNativeSandbox` is legacy and **must not** imply OS command confinement |
| Existing command validators | `src/core/process-manager.ts` line 35 and `src/core/durable-process.ts` line 190 require `cwd_relative==='.'`, reject network flag; `src/mcp/server.ts` calls hardcode cwd `'.'` | B changes validation to canonical normalized workspace-relative descendants and truthful host behavior. Shared server/catalog modifications go to integrator |
| Current command/Git route | `src/mcp/runtime-bootstrap.ts` lines 6,8,94–96 import `loadMacVmRuntime` and `MacVmCiExecutor`, lines 23/108 reject all host Git; `src/mcp/catalog.ts` line 44 says disposable Linux Workspace | Integrator replaces VM composition with B adapter and disables legacy VM execution path; change catalog, git authorization and capability truth in one reviewed integration |
| Process state | `src/core/durable-process.ts`, `src/local/process-store.ts`, `src/core/process-journal.ts`, `src/mcp/server.ts` currently have one durable journal, bounded output and owned-session checks | REUSE current journal. Evidence must prove physical owned group stop (not just timeout of observation), no guessed PID/neighbor kill, UNKNOWN/no replay on loss |
| Shared MCP exclusive files | `src/mcp/server.ts`, `src/mcp/catalog.ts`, `src/mcp/runtime-bootstrap.ts`, `src/mcp/write-dispatch.ts`, `src/mcp/batch-dispatch.ts` | **Single integrator only**; A/B/D do not write these simultaneously. Propose typed contract and common-file patch to integrator, who serializes A then B |
| CI | `.github/workflows/ci.yml` currently `runs-on:macos-latest`, Node22, `npm ci --ignore-scripts`, build, select non-VM test files and `scripts/test-native-source-capture.py` | Track C exclusively owns Actions workflow/CI-only scripts. C-A file, C-B native host runner and C-G3 exact candidate mandatory suites need *implementation* after authorized coding |
| Desktop | `native/macos-desktop/*`, `scripts/desktop-{supervisor,install,health}.mjs` and Mac desktop-specific tests | Track D owns desktop isolated source; no work on user's actual Login Item, secrets or selected tunnel until later authorized installed acceptance |

**Interface freeze rules:** working roots grant file mutation/script launch, reference roots read/search/copy-out only; `cwd` never a reference. File APIs enforce broker scope; arbitrary child commands execute as user with no OS confinement, no implicit connector secrets. Prefer an optional `cwd_relative` catalog arg with `'.'` default; never change existing MCP tool names except reviewed additions. Integrator resolves all shared source changes from disjoint branches. Exact source SHA must be pinned at dispatch, not assumed stable now.

**P0-02 verdict:** source-visible contracts and exclusive writer map DOCUMENTED; final binding against user Mac checkout and G0 reviewer approval remain PENDING.

## P0-03 — VM dependency/retirement inventory (no VM runtime change)

| Classification | Source candidates | Rule |
|---|---|---|
| **VM-only candidate: guest/host** | `native/macos-vm/{SourceCapture.swift,Virtualization.entitlements,WorkerHost.swift,guest_worker.py}`; `src/hosts/{macos-vm-runtime,macos-vm-ci}.ts`; `scripts/{install-native-vm.mjs,prepare-vm-worker-seed.py,test-vm-guest-worker.py,test-vm-runtime-native.mjs,test-vm-worker-native.py,test-vm-worker-seed.py}` | FREEZE now, do not run/install/build/repair. E2 may REMOVE from product **after** actual native Mac replacement G4, with separate reversible PR and exact CI |
| **Active VM caller requiring replacement** | `src/mcp/runtime-bootstrap.ts` (VM runtime/CI), `src/mcp/catalog.ts` (disposable Linux tool text and `ci_*`), `src/mcp/server.ts` (VM capability metadata and CI dispatch) | B/integrator replaces native command path; preserve historical records as read-only. E2 cleans remaining VM hooks only after replacement proof |
| **Shared candidates requiring import/consumer review** | `src/core/ci-{dag,evidence,journal,manifest,run-service,scheduler,snapshot,source-capture}.ts`, `src/local/ci-{artifacts,log-store,snapshot-store,store,working-copy}.ts`; `src/core/process-{manager,journal}.ts`, `src/core/durable-process.ts` | DO NOT wildcard delete. Determine actual production import graph after B integration; preserve required source capture/journal/process/log history; remove only proven VM-exclusives |
| **VM-specific tests/docs** | `test/macos-vm-*` (verify glob in exact tree), `scripts/test-vm-*`, `docs/superpowers/plans/*vm*`, archived evidence | Old VM tests not mandatory native CI proof. Archive historical docs unchanged; after E2 static import scan must show zero VM runtime dependencies |
| **User-owned assets/state** | Existing Mac guest media, retained Mac27 archive, saved plugin/tunnel/grants, old run evidence | **Never delete or rewrite** in source cleanup or CI. No automated fallback to VM after E2 |

**E2 acceptance (not an P0 mutation):** no production VM imports; no VM install/build requirement; C0+C-A+C-B+C-G3+C-VM tests pass on exact separate deletion PR SHA; historical read-only reports remain; rollback reverts E2 PR only. Live Mac plugin upgrade/rollback always separate human-reviewed action and never deletes user-owned VM media.

**P0-03 verdict:** source-tree candidate inventory and retirement rules DOCUMENTED; final import graph must be rechecked against the actual post-integration source and local user data remains UNKNOWN.

## P0-04 — GSA Planning Job reconciliation and review

- Current replacement Mac-only planning Job: `J-FA79` / `01a1ab7b-14d0-7a65-bb9b-d8475aabfa79`; 16 task nodes **G0 → A/B/C/D/E1 → INT-A → INT-B → G3 → G4 → M4/E2 → M5**. Windows is **not** a node or task of this Mac project planning round.
- Approved Criteria binding in Job revision 2 was corrected to `3386b803ef655d4398d438c6c6b0d8a3343afb24` and independently read back. It remains `DRAFT`, `planning_review:PENDING` and `planning_topology:[]`. This report does **not** falsely claim durable planning review PASS.
- Prior historical `J-2600` READY and earlier Reviewer PASS belong to an obsolete strict M2→M3 source-coding plan. Current replacement needs independent current-revision PASS; do not inherit old review or supersede without verified CAS/LLC58 transition.
- Reviewer should check the *task dependency edges*, not treat display-only `topology.stage/next` as additional constraints. If a distinct `planning_topology` DAG is a schema requirement, planner must persist 16 task nodes with `depends_on` matching `docs/MILESTONES.md`, with no M6 node, and read back.

**P0-04 verdict:** Criteria and Mac-only scope reconciled; durable topology+Reviewer still PENDING.

## P0 / G0 exit checklist

- [x] GitHub source branch and 434-node tree verified
- [x] Approved Criteria and VM decision verified against current source
- [x] Native Mac file/command/Git/process/MCP seam and single-writer registry documented
- [x] Source VM freeze/retirement candidates classified without deleting anything
- [x] Current connected Mac plugin queried read-only; no workspace/dirty state falsely inferred
- [ ] Exact physical Mac dirty checkout, unpushed commits, local installer/plugin identities and state canary safely observed (blocked: `WORKSPACE_ROOT_CHANGED`, no enrolled workspace)
- [ ] Current Job revision bound to complete DAG, role-isolated independent Reviewer PASS persisted/read back, and historic job disposition reconciled
- [ ] G0 review confirms common interface plus local custody as needed for safe product-code merge

**Current verdict: P0 SOURCE AUDIT COMPLETE; P0/G0 OVERALL BLOCKED/PENDING.** No product source edits, no Mac install, no VM mutation, no main merge or deployment. It is unsafe to claim P0 PASS while local dirty work and durable Reviewer are unknown.
