# Windows Native Connector — Job Guide / Task Contracts

**Date:** 2026-11-09  
**Status:** PRE-CODE / NOT AUTHORIZED TO IMPLEMENT  
**Development branch (single):** `feat/windows-native-connector-20261109`  
**Baseline SHA:** `41102fa3e9d2a187c8373b1474e9377b737c66b1`  
**Project:** `thebimhouseinfo-sudo/GSA-Localconnector`

## 1. Purpose and how to use this guide

Windows development starts from the **Mac-accepted existing source**, not a blank connector. The Mac milestone has been accepted by the user; its implementations are patterns, **not** Windows verification. Windows Plan, Milestones, Technical Proposal and the approved Criteria are the authority. This guide tells each assigned GSA role **WHAT / WHERE / CONSTRAINTS / DONE** and the necessary reading, not how to reason or a second copy of GSA Harness.

A role performing a task must use its active GSA Harness and load only relevant Skills. Do not independently create a new project, overwrite main or automatically merge. Tasks remain on the single Windows branch unless the user changes branch governance.

**Mandatory pre-code gate:** W0 Reviewer/Critic assessment and explicit Human implementation authorization. Before that, only documentation, source reading and non-mutating verification are allowed. This guide is a job-pack template; it is **not** itself an instruction to start coding.

### Standard compact Job Instruction

```text
MODE: DIRECT_AGENT or approved GSA workflow
ROLE: <Planner | Coder | Tester | Reviewer>
REPO: thebimhouseinfo-sudo/GSA-Localconnector
BRANCH: feat/windows-native-connector-20261109
BASE / HEAD: <verified exact SHA>
TASK: <Wn-ID from WINDOWS_MILESTONES.md>

WHAT: <one bounded deliverable and supported user behavior>
WHERE: <files/functions allowed; dependencies and inputs>
CONSTRAINTS: <critical criteria, preserve Mac, avoid side effects,
              do not expand permissions/network/unverified security>
DONE: <exact tests and evidence, receipt paths, commit+push,
       review/finding resolution and truthful blocked report>
```

Do not paste full Criteria, Harness or Proposal into each job. Link exact sections/functions needed; Planner refines instructions after preceding jobs generate new inputs. If a task is based on provisional findings, label its instruction provisional and revisit before assigning Coder.

## 2. Source reading strategy by role

| Role | Required reading | Read selectively |
| --- | --- | --- |
| Planner | Criteria §§1–10 (especially 7–10), Decisions, `WINDOWS_IMPLEMENTATION_PLAN.md`, Milestones, Proposal and this guide | Existing Mac Plan/Milestones and target source seams for cross-platform feasibility |
| Coder | Assigned Job Instruction first; referenced Proposal sections and functions; applicable core interface; owned tests | Only directly related Mac implementation for behavior, not all Mac report history |
| Tester | Acceptance matrix and task-specific negative cases; exact changed code; CI workflow and fixtures | Native API docs/probe for test interpretation; do not label missing native execution PASS |
| Reviewer/Critic | Criteria and latest user decisions; all four Windows documents for W0; exact code diff and evidence for later jobs | Critical trust boundary implementation and test logs, not unrelated history |
| Operator | User-accepted selected Windows root/plugin, installed SHA, task acceptance instructions | No source rewrite unless authorized; read status and journal first on recovery |

**Reading order:** top-down for intention and constraints; bottom-up for exact implementation/receipt when reviewing a suspected gap. Planner links only relevant Criteria subsections for each task. Full-document preload is avoided unless auditing the complete planning phase.

## 3. W0 — Planning and review contract

**Role:** Planner → Reviewer/Critic  
**WHAT:** Preserve four Windows pre-code documents on the Windows branch, trace the accepted Mac architecture into Windows tasks, and reconcile source limitations and the latest Open/Quit-only user decision.  
**WHERE:** `docs/WINDOWS_{IMPLEMENTATION_PLAN,MILESTONES,TECHNICAL_PROPOSAL,JOB_GUIDE}.md`; reference `docs/CRITERIA.md`, `docs/DECISIONS.md`, `src/core/native-io.ts`, `src/mcp/runtime-bootstrap.ts`.  
**CONSTRAINTS:** Documentation only; do not reclassify incomplete Windows work as PASS; do not edit product code or `main`; no VM, per-operation approval, Pause/Resume or reboot requirement. Record any discrepancy with old Mac-era Criteria rather than silently making requirements.  
**DONE:** All four docs linked and mutually consistent; exact source revision, dependencies, file ownership, Windows negative tests and Windows-native evidence gates present. Independent review records findings and dispositions. Explicit Human approval before W1 implementation.

## 4. W1 — Owner / Windows grant / host capability contracts

**Role:** Coder + Tester, Reviewer at G1  
**WHAT:** One per-user Windows connector owner, protected durable grant store, Windows root identity and revision checks. Prove unsupported sandbox API is never advertised as verified.  
**WHERE:** Native Windows host/grant adapters (new files in `src/hosts/` or `src/local/`), `src/core/workspace.ts`, `src/hosts/windows-appcontainer-candidate.ts` as research only, `scripts/native-gate-windows.ps1`, Windows-specific tests.  
**CONSTRAINTS:** Maintain Mac code paths. Root identity cannot be a string path alone. Deny unapproved roots, overlapping workspace/reference, stale grant after rename/drive alias/reparse swap, private connector directory. No admin or VM assumption. Don't change MCP dispatch yet.  
**DONE:** GitHub `windows-latest` host probe and case-sensitive/casefold/drive/UNC/junction/reparse hostile fixtures; only proved operation flags enabled. Commit/push exact SHA and G1 test evidence.

**Instruction update trigger:** After host probe, Planner records supported Windows versions, native API availability and whether additional proof is necessary; revise W2 and W3 instructions before dispatch.

## 5. W2 — Native file/recovery/directory contracts

**Role:** Coder (owned subtracks) + Tester  
**WHAT:** Build safe Windows file-tool boundary, versioned CAS mutations, recovery/journal readback, role-aware copy/move, directory inspection/copy with negative tests.  
**WHERE:** New Windows file broker/adapter under `src/hosts/` and any narrowly justified native source; reuse `src/core/{native-io,write-engine,file-transactions,directory-copy}.ts`, `src/local/{file-transaction-store,directory-copy-store}.ts`.  
**CONSTRAINTS:** Distinguish file tools from unconfined shell exception. Do not implement authority using `fs.realpath`/path strings alone; require Win32 handle-based containment and root revision checks. Reject reparse escapes, ADS, unsafe volume aliases, unknown stop. No silent duplicate effects, no unrestricted delete. Ref may only be source of read/copy-out.  
**DONE:** Native Windows fixture suite with create/read/CAS replace/patch/delete/copy/move/directory and manifest readback; adversarial junction swaps, stale source SHA, reference denial, destination conflicts, separate project roots, cross-volume partial/UNKNOWN if relevant. Exact-HEAD G2 CI and signed/provenance review. Unsupported capability reports BLOCKED.

**Instruction update trigger:** W2-01 chooses and proves the file-open/handle mechanism; Planner updates W2-02/03/04 to cite its API and known gaps, not generic Win32 assumptions.

## 6. W3 — Command / process / Git contracts

**Role:** Coder + Tester  
**WHAT:** Run local Windows scripts/build/test/Git with process ownership and recoverable status; investigate restricted remote Git independently.  
**WHERE:** Windows command/process adapter, `src/core/{process-manager,durable-process,git-engine,git-plans}.ts`, command and process journal tests.  
**CONSTRAINTS:** Initial cwd must belong to granted workspace/subfolder; no executing directly from reference. **Shell not OS-confined:** advertise `command_confinement: none (user account)`, `state_integrity_vs_commands: not_protected`. No arbitrary machine-wide process kills; use Job Object/owned handles and log caps. Never bypass remote Git policy through shell.  
**DONE:** Native PowerShell, CMD, node, non-Git script, Git local, timeout, stdout/stderr/exit, owned process tree stop, neighbor survival and UNKNOWN on unprovable kill, exact G3 Windows CI. Remote Git either has independently reviewed restricted-network proof or remains explicitly blocked.

**Instruction update trigger:** After feasibility, Planner records whether remote Git is a separately approved follow-up; do not widen scope or weaken the command risk statement to make it pass.

## 7. W4 — MCP integration / Desktop / CI contracts

**Role:** Single Integrator (MCP), Coder (Desktop), Tester  
**WHAT:** Expose proven Windows backends over existing MCP calls, ship per-user Windows background/tray Open/Quit and trusted tunnel start/stop, preserve Mac behavior.  
**WHERE:** Integration owner only touches `src/mcp/{runtime-bootstrap,server,catalog,write-dispatch}.ts`. Desktop owner uses new Windows UI/installer scripts, package resources and tests. CI owner edits Windows workflow files.  
**CONSTRAINTS:** No new tool catalog or work approval layer. Don't claim Windows `verified=true` from AppContainer manifest alone. Open/Quit only; no Pause/Resume. No secret in published output; no global configuration changes. No update/kill of unrelated applications. Never alter Mac login app as a Windows side effect.  
**DONE:** Source typecheck, full core tests, exact SHA hosted Windows native suites, Windows desktop/package smoke, Mac regression, real MCP status exposes truthful capability and blocked reasons. Artifacts contain no secrets. Review findings corrected and rerun.

**Instruction update trigger:** Integrator obtains exact stable interface signatures from G2 and G3 and adjusts its contract before editing shared dispatch.

## 8. W5 — Real Windows installed-plugin acceptance

**Role:** Operator + Tester; Human closure  
**WHAT:** Confirm the selected Windows connector actually performs the user workflow on real Windows, not only the GitHub runner.  
**WHERE:** Explicitly authorized Windows host and test workspace/reference; selected Windows plugin (separate from Mac); installed candidate SHA and protected connector state.  
**CONSTRAINTS:** No destructive operations on user production projects; use disposable workspaces. Preserve other apps/processes, secrets, untracked files and any retained recovery versions. No reboot test in this round. No fabricated evidence when host unavailable.  
**DONE:** User-side installer/Open/Quit and tunnel reconnect; bind workspace/reference; file operations, directory copy/readback, native build/test, process cancellation, Git local, two projects, grant revocation and UNKNOWN behavior. Reporter lists PASS, BLOCKED, CHƯA KIỂM, exact selected-plugin receipts and limitations. Human accepts M6; subsequent bugs become Issues.

## 9. Tester acceptance matrix — mandatory negative cases

| Risk | Minimum Windows proof |
| --- | --- |
| Reparse/junction escape | Swap an intermediate segment between validation and mutation; no write outside granted root |
| Identity reuse/alias | Drive-letter change, casefold path, volume replacement, UNC ambiguity; stale authority rejected |
| Reference misuse | Read/copy out allowed; reference source move, delete, execute and destination copy denied |
| Partial copy/move | Source changes or destination appears; no unintended removal, conflict/UNKNOWN truthful |
| Journaling | Crash between effect and acknowledgment; readback reports uncertainty, no automatic retry |
| Process control | Child process stopped, unrelated same-name process remains running |
| Remote Git | No unauthorized network or implicit Git helper/token leakage; network disabled until proven |
| Secrets | API/runtime key excluded from log/artifact and not embedded in installer |
| Cross-platform compatibility | Existing Mac supported behavior and API schemas unchanged |
| UI scope | Open/Quit available; no Pause/Resume requirement or reboot gate |

## 10. Evidence and review report template

Each job persists a compact report under a Windows-specific evidence directory, e.g. `docs/reports/windows/Wn-ID-<YYYYMMDD>.md` (create only in implementation phase). Include:

- Task ID, role, branch, base/head exact SHA, changed file allowlist, existing upstream evidence.
- Commands/test suites and exact host (GitHub `windows-latest`, version/architecture; or real Windows). Result for **each** case: PASS / FAIL / CHƯA KIỂM / BLOCKED with source log/receipt.
- Negative case results, scope/neighbor preservation, hidden output/secret checks.
- Reviewer findings, fixes and retests, dependency status and unverified assumptions.
- Done/blocked disposition with reason; link commit, PR or issue and next owner.

No report may say full Windows accepted based solely on Mac PASS or on a GitHub Windows VM that did not exercise the selected host behavior. Runner evidence is useful but bounded.

## 11. Pre-code readiness and assignment policy

This Job Guide and companion documents are **drafts**, not approval to execute W1–W5. W0 Reviewer/Critic must inspect for missing file boundaries, feasibility blockers, contradictions and new unwanted requirements. If findings concern design rather than the approved Criteria, correct the design; do not call it a Criteria change. Once W0 receives approval, assign tasks in dependency order and continue automatically to DONE or a true human gate, with Planner refreshing provisional instructions when each upstream artifact is available.

**Current state:** Windows code NOT started in this phase; no Windows native test or selected-host acceptance claimed.
