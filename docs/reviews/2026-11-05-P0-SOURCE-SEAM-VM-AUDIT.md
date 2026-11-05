# P0 — Source Baseline, Native Mac Interface Freeze and VM Retirement Inventory

## GOAL

Complete the GitHub-verifiable P0 source, interface, VM inventory and durable GSA planning review needed to **begin independent coding on GitHub branches** after separate Human execution authorization. P0/G0 source readiness **does not require an operational current Mac plugin, bound workspace or inspected physical Mac checkout**: those are product defects / later Mac-host integration evidence. Preserve unknown local dirty/unpushed files and do not touch the existing Mac checkout until separately reconciled. No product code, local Mac settings, installed plugin, media or unrelated process is modified by this audit.

**Bound source target:** `thebimhouseinfo-sudo/GSA-Localconnector`, branch `plan/mac-native-ci-vm-retirement-20261105`, commit `8e79bcec510e75306af4c232f0c161526d150739` at initial read. Tree is full (`truncated:false`, 434 entries); docs-only changes after this audit need their own source HEAD re-pin. Product Criteria blob `3386b803ef655d4398d438c6c6b0d8a3343afb24` agrees byte-for-byte with GSA Memory Criteria. Human-approved 2026-11-05 VM freeze is recorded at `docs/DECISIONS.md` blob `8f48fded38012bf6943e17799fcddb5665f73392`. GitHub-hosted macOS CI was green on the source-docs revision `8e79bce...`, but it only runs Node build, non-VM unit suites and source-capture; it **does not** certify native command/file/selected installed-plugin behavior.

## P0-01 — Source, Git branch and physical Mac custody

| Check | Evidence / disposition |
|---|---|
| GitHub product repository | Exact source branch/HEAD above, full recursive tree fetched; no product source was written during P0 audit |
| GitHub review branch | `plan/mac-native-ci-vm-retirement-20261105` is confirmed and active under GSA Project Branch Policy; `main` reserved for release |
| Source Criteria | Current approved §7: arbitrary Mac shell runs as logged-in user, `cwd` inside bound working root; commands are not OS-confined; status reports `command_confinement:none (user account)`, `state_integrity_vs_commands:not_protected` |
| Local Mac dirty checkpoint | `docs/MAC-QWEN-HANDOFF.md` blob `1586ba73154739ba2c9d05e1700d33a8a7b3a377` warns `main` was at `c41188e` at handoff; local commits not pushed and unrelated untracked `docs/proposals/` exist. **Not independently inspectable from GitHub**; do not assume checkout clean, fetch/pull/reset or cherry-pick |
| Connected Mac host | `gsa_lc_mac.connector_status` returned `platform:macos`, `arch:arm64`, `workspaceStartupIssue:WORKSPACE_ROOT_CHANGED`, `workspaceSelectionRequired:true`, `readyForShell:false`, `fileBackendAvailable:false`, `git:blocked`, `native-tree-recovery-not-certified`. `list_workspaces` returned `[]`. No active grants; Mac-local checkout and selected installed-plugin code revision remain **UNKNOWN** |
| Mac custody action | **NO LOCAL MUTATION**. Before any later action reads/writes, merges into, syncs, checks out or installs over **the user's existing local checkout**, obtain a separately authorized read-only inspection by a functioning access path (or explicit user-supplied local Git evidence): `git status --short`, `git rev-parse HEAD`, `git branch --show-current`, `git log -n 5` and installer identity/hash. Preserve unpublished work. This restriction does **not** apply to new isolated GitHub work branches or hosted macOS runners. Current installed-plugin failure is an implementation target |

**P0-01 verdict:** PASS for the *required remote pre-code baseline*; Mac-local checkout state is explicitly UNKNOWN and becomes a protection gate only before later local checkout modification, plugin installation or unreviewed merge. `WORKSPACE_ROOT_CHANGED` is a product defect, not a P0/G0 prerequisite.

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

**P0-02 verdict:** PASS for source-visible contracts and single-writer ownership required to dispatch independent GitHub coding branches. Native adapter/host correctness must be implemented and tested later; local Mac checkout is not needed at P0.

## P0-03 — VM dependency/retirement inventory (no VM runtime change)

| Classification | Source candidates | Rule |
|---|---|---|
| **VM-only candidate: guest/host** | `native/macos-vm/{SourceCapture.swift,Virtualization.entitlements,WorkerHost.swift,guest_worker.py}`; `src/hosts/{macos-vm-runtime,macos-vm-ci}.ts`; `scripts/{install-native-vm.mjs,prepare-vm-worker-seed.py,test-vm-guest-worker.py,test-vm-runtime-native.mjs,test-vm-worker-native.py,test-vm-worker-seed.py}` | FREEZE now, do not run/install/build/repair. E2 may REMOVE from product **after** actual native Mac replacement G4, with separate reversible PR and exact CI |
| **Active VM caller requiring replacement** | `src/mcp/runtime-bootstrap.ts` (VM runtime/CI), `src/mcp/catalog.ts` (disposable Linux tool text and `ci_*`), `src/mcp/server.ts` (VM capability metadata and CI dispatch) | B/integrator replaces native command path; preserve historical records as read-only. E2 cleans remaining VM hooks only after replacement proof |
| **Shared candidates requiring import/consumer review** | `src/core/ci-{dag,evidence,journal,manifest,run-service,scheduler,snapshot,source-capture}.ts`, `src/local/ci-{artifacts,log-store,snapshot-store,store,working-copy}.ts`; `src/core/process-{manager,journal}.ts`, `src/core/durable-process.ts` | DO NOT wildcard delete. Determine actual production import graph after B integration; preserve required source capture/journal/process/log history; remove only proven VM-exclusives |
| **VM-specific tests/docs** | `test/macos-vm-*` (verify glob in exact tree), `scripts/test-vm-*`, `docs/superpowers/plans/*vm*`, archived evidence | Old VM tests not mandatory native CI proof. Archive historical docs unchanged; after E2 static import scan must show zero VM runtime dependencies |
| **User-owned assets/state** | Existing Mac guest media, retained Mac27 archive, saved plugin/tunnel/grants, old run evidence | **Never delete or rewrite** in source cleanup or CI. No automated fallback to VM after E2 |

**E2 acceptance (not an P0 mutation):** no production VM imports; no VM install/build requirement; C0+C-A+C-B+C-G3+C-VM tests pass on exact separate deletion PR SHA; historical read-only reports remain; rollback reverts E2 PR only. Live Mac plugin upgrade/rollback always separate human-reviewed action and never deletes user-owned VM media.

**P0-03 verdict:** PASS for pre-code VM candidate inventory/freeze/retirement plan. Actual post-integration import-graph elimination and user-owned asset preservation are later E2 acceptance tasks, not P0 completion prerequisites.

## P0-04 — GSA Planning Job reconciliation and review

- Current replacement Mac-only planning Job: `J-FA79` / `01a1ab7b-14d0-7a65-bb9b-d8475aabfa79`, **planning revision 3, READY, Reviewer PASS**, 16 task nodes **G0 → A/B/C/D/E1 → INT-A → INT-B → G3 → G4 → M4/E2 → M5**. Windows is **not** a node or task of this Mac project planning round.
- Approved Criteria binding `3386b803ef655d4398d438c6c6b0d8a3343afb24` is independently read back. Job revision 3 contains **16 explicit `planning_topology` nodes**, exactly matching task dependencies, no dependency cycles and no Windows task. Independent planning Reviewer verification `01a1ab9b-f30d-73da-8d92-8105ade491de.json` is durably **PASS / zero findings**, and the Job was moved to **READY** by authorized exact-SHA transition/readback.
- Prior historical `J-2600` strict M2→M3 source-coding plan has been transitioned to **SUPERSEDED**, result `SUPERSEDED`, using the GSA guarded exact-SHA transition and GitHub readback (Job blob `b0304603e5f433e36f47fb5f900e8ffb32a5e1a5`). Its older Reviewer PASS does not transfer to the current plan.
- Reviewer accepted the 16-task `planning_topology` and actual `depends_on` edges at revision 3. Display-only `topology.stage/next` does not add dependencies; the DAG is the accepted authority.

**P0-04 verdict:** PASS for current pre-code planning topology, Criteria, Mac-only scope and old Job disposition. This is **NOT** a PASS for host checkout custody or product implementation.

## P0 / G0 exit checklist

- [x] GitHub source branch and 434-node tree verified
- [x] Approved Criteria and VM decision verified against current source
- [x] Native Mac file/command/Git/process/MCP seam and single-writer registry documented
- [x] Source VM freeze/retirement candidates classified without deleting anything
- [x] Current connected Mac plugin queried read-only; no workspace/dirty state falsely inferred
- [x] Physical Mac checkout, unpublished commits and installed-plugin identity explicitly marked UNKNOWN; no local files modified; operation-specific custody check deferred until a later local checkout/sync/install action. Broken plugin not a P0 blocker
- [x] Current Job revision 3 bound to complete 16-node DAG, independent Reviewer PASS with zero findings persisted/read back, old `J-2600` marked SUPERSEDED, new `J-FA79` READY
- [x] G0 pre-code source readiness confirms GitHub baseline, interface owner map, VM freeze, approved Criteria and reviewed Mac-only Job. Separate Human approval still required to begin code; Mac checkout custody required only before touching the local Mac checkout or installing a release

**Corrected verdict (2026-11-05): P0-01/02/03/04 COMPLETE for pre-code source/plan scope; G0 SOURCE-READINESS PASS.** The current Mac connector's unavailable grants, shell/Git and file backend remain **open product implementation defects** assigned to A/B/host integration, not admission conditions for those tracks. Current local checkout/installed artifact are still **UNKNOWN** and must be inspected before local writes, syncing, release installation or claiming real-Mac acceptance. The original GSA planning Reviewer PASS at J-FA79 revision 3 applies to its pinned planning revision; subsequent documentation clarification requires an exact-revision rereview before claiming a *new* formal Reviewer PASS on revised source docs. No product code changes, local Mac install, VM mutation, main merge or deployment.
