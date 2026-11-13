# Windows Native Connector — Job Guide / Task Contracts

**Updated:** 2026-11-13 (V4 FIR-01..08 repair + reviewer handoff)  
**Status:** PRE-CODE / NOT AUTHORIZED TO IMPLEMENT  
**Development branch (single):** `feat/windows-native-connector-20261109`  
**Branch fork SHA:** `41102fa3e9d2a187c8373b1474e9377b737c66b1` · **Mac READ-ONLY source reference:** `main@9d66c60c4f31cae6cfed64838468b5558973ab0c` (not a merge target)  
**Project:** `thebimhouseinfo-sudo/GSA-Localconnector`

## GOAL

Give each bounded Windows W0–W5 Job a single contract covering WHAT, WHERE, constraints, dependencies, expected native evidence and safe stopping conditions, using the existing Mac-accepted shared MCP behavior without inheriting Mac test PASS. No product VM, new agent, Pause/Resume or uncontrolled local-file fallback.

## 2026-11-12 V2 context and work boundary

The Windows branch initially contained four planning-document commits and no Windows native feature diff. Mac reference `main@9d66c60` includes 16 newer reliability fixes after `bce1875`. **This comparison is read-only research; W0 does not require or permit merging, rebasing or cherry-picking Mac `main`.** GSA branch authority permits documentation work on the Windows branch. Earlier Mac Planning Job `J-F33D` is historical and does not authorize Windows coding.

Mac reference describes selected-only reauthorization, file-backend sync, fileParam validation and desktop lifecycle. **They are not all present in the Windows branch.** W0-08 pins Windows source: existing MCP byte create/fetch interfaces need native adaptation; selected-only recovery, `fileGrantSyncState`, `import_image_file` and `src/mcp/image-file-transfer.ts` are MISSING; controller lease/journal/HTTP need updates; Windows native bootstrap is absent. Never assign a job with a missing local function listed as a reusable local import.

## Windows-only source rule (corrected Human intent)

- **Read/reference:** `main` is used to study Mac production bugs, fixes, tests and acceptance decisions. The read-only reference SHA may advance; changes in `main` are not mandatory imports.
- **Write/implement:** all Windows plans, native adapters, tests, CI and eventual application code belong exclusively to `feat/windows-native-connector-20261109`.
- **Prohibited:** changing `main`; merging, cherry-picking or rebasing from `main`; requiring Git history convergence for W0, W1 or acceptance; copying Mac-only POSIX/Swift runtime.
- **Deliverable:** each Mac lesson has a Windows behavior, owner, implementation mechanism and Windows-run test. Existing identical code on the Windows branch may be used after inspection; newer code on Mac is only a design reference, not assumed present locally.
- **Evidence:** Windows CI and selected installed Windows plugin must pass independently; no Mac test inheritance.

## 2026-11-12 V3 — Additional bounded Job instructions for Mac reliability parity

**Baseline and provenance:** `main@9d66c60` was inspected; reliability guide `docs/reviews/2026-11-12-RELIABILITY-FIX-GUIDE.md`, 16 latest commits and relevant source/test bodies support the map. Guide snippets are historical repair instructions, **not proof of actual Windows delivery**. Mac lessons review (W0-05), independent V3 planning review (W0-06) and separate Human implementation approval remain the planning gates. Each Coder must use the current Windows branch HEAD; there is no merged-main prerequisite.

| Task | WHAT / source-owner boundary | WHERE / minimum evidence and stop rule |
| --- | --- | --- |
| **W0-07** Reliability source classification | Planner/Reviewer map nine Mac defects: shared reuse, Windows-native port or Mac-only, and link each to an existing or new Windows test | READ `src/core/durable-process.ts`, `src/local/{grants,control-lease}.ts`, `src/mcp/{http,server}.ts`, `scripts/{desktop-supervisor,mac-desktop-adapter}.mjs`, `native/macos-desktop/App.swift`, reliability guide; no source code changes; W0-06 uses this map |
| **W1-05** Windows grant lock owner/fence | Implement only Windows-specific lock primitives needed by trusted grant store; preserve common session/holder protocol | Native Windows owner/grant adapter and tests; stale fenced server recoverable, desktop/foreign/unowned/unparseable lock preserved, `GRANT_STORE_RECOVERY_REQUIRED` diagnostic, racing writers cannot both publish. Never infer stale from PID/age |
| **W1-06** Control lease after restart | Reuse existing hashed unexpired lease and `SESSION_BUSY.expires_at`; qualify with real Windows private identity | `src/local/control-lease.ts` contract and Windows owner adapter tests; same token renews after tunnel restart, expired released state handled correctly, no automatic takeover |
| **W3-05** Process-journal loading and degraded state | Reuse `ensureReady` retry and MCP diagnostic bypass; adapt native Windows Job Object reconciliation only | `src/core/durable-process.ts`, `src/mcp/server.ts` integration owner, Windows process persistence; fail-once/success-next, concurrent single load, permanent journal error returns `PROCESS_JOURNAL_UNAVAILABLE`, discovery and control release still work |
| **W4-04** HTTP/stdio reliability and errors | Reuse HTTP active-call timeout split and exact JSON-RPC error mapping; add Windows-host proof, not another transport | `src/mcp/http.ts`, `src/mcp/server.ts`, Windows tests; >30s benign tool still returns result; header timeout remains; invalid params `-32602`, internal errors `-32603`, invalid request `-32600`, missing method `-32601`; no secret/path leak |
| **W4-05** Windows tray restart & safe Quit | Implement bounded retryable tunnel restart, no retry on auth/config/explicit Quit; observe owned work and permit explicit confirm-force within Quit only | Windows tray/installer + Job Object adapter, tests: owner remains unique, retries capped, `IDLE/ACTIVE/UNKNOWN` honored, confirmed Force Quit stops only connector-owned tree; no Pause/Resume UI |

**Shared-edit ownership:** exactly one integrator modifies `src/mcp/{runtime-bootstrap,server,catalog,write-dispatch}.ts`. Windows feature owners prepare independent Windows adapters/tests and interface requests. Only avoid implementation when that capability **already exists on the Windows branch** and is checked at the pinned Windows source SHA. A Mac `main` fix is design guidance only and must be authored independently when missing. Add Windows-native checks and truthfully record platform limitations. Source changes and app installation remain gated separately.

**Test-host isolation:** synthetic `USERPROFILE`/`APPDATA`/`LOCALAPPDATA`/TEMP/identity for Windows tests; no real user grants, secrets, registry or installed connector modifications during hosted fixtures. No tests with Windows skips count as Windows native PASS. Preserve Mac CI on the same integration SHA.

**W5 final acceptance supplement:** actual selected Windows plugin must (a) recover after a disposable retryable tunnel failure without owner duplication, (b) preserve and renew the same unexpired controller lease across reconnect, (c) diagnose stale/malformed grant lock without unsafe deletion, (d) report a temporarily unavailable journal without disabling status/discovery and recover later, (e) complete a benign long tool call through HTTP with correct status/output, and (f) perform normal Quit and explicitly confirmed owned-only Force Quit without killing an unrelated neighbor. Do not require physical reboot or Mac Pause/Resume. If no Windows host is connected, mark these `CHƯA KIỂM / PENDING USER REQUIRE`, never PASS.

## V4 repair execution checklist — FIR-01..08 (2026-11-13)

**Scope:** amend only approved Windows-branch planning and later Windows implementation. Mac `main` remains READ-ONLY and will not be merged, cherry-picked, rebased or modified. Status below is **documentation repaired; product implementation unverified**.

| Finding | WHAT / owner / dependencies | DONE evidence (not inferred from Mac) |
| --- | --- | --- |
| FIR-01 | W0-08 exact Windows source audit first; W2-05 creates missing importer validator, W4-01 creates missing MCP `import_image_file`/fileGrantSyncState | Pinned Windows SHA, missing/available/adaptation table, native parser fixture G2, MCP schema+invocation G4 |
| FIR-02 | G2 native scoped files+parser; G3 owned process/local Git independently, both after G1; W4-01 integrates only after both | G2+G3 reports independently PASS; G4 executes real `tools/list`, `tools/call`, HTTP and stdio with installed native backends |
| FIR-03 | W1-04 simulated qualified grant update, W2-01 real native update, W4-01 status, W5 selected plugin | First install then bind/add/rebind/revoke without manual native reinstall; grant-set revision matches backend, failure preserves old signed generation and journal |
| FIR-04 | W3-04 remote Git **API** policy; W3-01 command runner user account | Prove restricted Git API or BLOCKED; capabilities explicitly say PowerShell/CMD user-run commands are not OS/network confined; connector secrets absent from child env |
| FIR-05 | W2-01..04 handle/root/file ID and grant revision, Win32 mutation backend | Native NTFS hardlink to ungranted file, reparse/junction/ADS, grant revoked mid-operation, concurrent rename/delete, identity swap, unsupported FS atomicity; no out-of-root effect |
| FIR-06 | W3-02/05 and G3 fixture, W5 real plugin | Two concurrent separate workspace jobs with independent paginated logs/cwd/argv/artifacts/exit, stop only one Job Object, disconnect/reconnect readback, no replay or neighbor kill |
| FIR-07 | W4-02/03/05 Windows installer+plugin registration, G4 packaging, W5 install | Keep Windows tunnel ID+runtime key in ignored `.env` data or documented protected state, explicit precedence, no secret in logs/artifacts, safe rollback, no reprompt or Mac plugin corruption |
| FIR-08 | W2-G2 and W3-G3 concurrently, both inputs to W4-G4 | DAG has no cross-edge G2→G3 or G3→G2; detailed per-task dependencies match aggregate DAG and tests match gates |

**Assignment safeguards:** Before code, W0-08 labels every referenced local import as PRESENT / MISSING; never let W2 owner edit integrator-owned `src/mcp/{server,catalog,runtime-bootstrap,write-dispatch}.ts`. W1-04 mock grant success is not real native G2 proof. A selected real Windows host is necessary only for W5 and not simulated by GitHub CI.

### Windows source reality (FIR-01)

- AVAILABLE as interface/handler: `create_file_bytes` and `fetch_file_bytes`; underlying qualified Windows-native file effects not proven.
- MISSING: `src/mcp/image-file-transfer.ts`, `import_image_file`, `fileGrantSyncState`, modern grant recovery and Windows-native MCP bootstrap.
- REQUIRES_ADAPTATION: old grant-store locking, controller lease reset/SESSION_BUSY expiry, process journal retry/DEGRADED, HTTP timeout/error semantics and Windows file/command backend.
- Confirm this classification again against exact current Windows source commit before writing; if it changed, revise task owners and acceptance without importing `main`.

### Reviewer criteria for W0-06 and later

Reject planning if source-absent APIs are treated as already reusable, G2/G3 depend on each other, normal plugin bind requires manual reinstall, remote Git API denial is misrepresented as full shell network sandbox, hardlink/TOCTOU negatives are missing, installer secret precedence/rollback is unspecified, or hosted tests are called selected-plugin proof. Record finding IDs, exact file lines, current branch SHA and disposition.

## 1. Purpose and how to use this guide

Windows development starts from the **existing Windows-branch codebase** and Mac-accepted behavior as read-only reference, not from a blank connector or a merge of newer Mac source. The Mac milestone has been accepted by the user; its implementations are patterns, **not** Windows verification. Windows Plan, Milestones, Technical Proposal and the approved Criteria are the authority. This guide tells each assigned GSA role **WHAT / WHERE / CONSTRAINTS / DONE** and the necessary reading, not how to reason or a second copy of GSA Harness.

A role performing a task must use its active GSA Harness and load only relevant Skills. Do not independently create a new project, overwrite `main`, merge, rebase or cherry-pick from `main` into Windows. Tasks remain on the single Windows branch unless the user changes branch governance.

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

**W0-00 branch authority (DONE, not code):** Explicit Human instruction changed the Project's development branch to `feat/windows-native-connector-20261109`; the Memory manifest was written with exact SHA and read back. Preserve Mac Jobs and their evidence. No new Windows source write is implied.

**W0-05 Mac bugfix study (READ-ONLY):** inspect selected commits, code, fix guides and tests on `main`, and map each defect to corrected behavior, a native Windows mechanism and a Windows test. Do not write `main`, merge, rebase, cherry-pick or synchronize its code into Windows. Before coding, pin the current **Windows** branch commit only.

**W0-08 source inventory (review pending):** immediately after W0-05 explicitly mark each Windows API AVAILABLE / MISSING / REQUIRES_ADAPTATION with exact file SHA and owner. **W0-07 reliability delta (mapped, not reviewed):** uses W0-08, inspects nine Mac fixes as reference and classifies Windows behavior/contracts, Windows-specific mechanisms/tests and Mac-only exclusions before W0-06. **W0-06** reviews both against the Windows design without any source-merge gate.

**W0-06 planning review (PENDING):** verify all four docs at their committed blobs, check Criteria §§1–10, exact dependency/acceptance traceability, and correct findings on this Windows branch. Present reviewed Plan for Human approval before starting Windows product coding.



**Role:** Planner → Reviewer/Critic  
**WHAT:** Preserve four Windows pre-code documents on the Windows branch, trace the accepted Mac architecture into Windows tasks, and reconcile source limitations and the latest Open/Quit-only user decision.  
**WHERE:** `docs/WINDOWS_{IMPLEMENTATION_PLAN,MILESTONES,TECHNICAL_PROPOSAL,JOB_GUIDE}.md`; reference `docs/CRITERIA.md`, `docs/DECISIONS.md`, `src/core/native-io.ts`, `src/mcp/runtime-bootstrap.ts`.  
**CONSTRAINTS:** Documentation only; do not reclassify incomplete Windows work as PASS; do not edit product code or `main`; no VM, per-operation approval, Pause/Resume or reboot requirement. Record any discrepancy with old Mac-era Criteria rather than silently making requirements.  
**DONE:** All four docs linked and mutually consistent; exact source revision, dependencies, file ownership, Windows negative tests and Windows-native evidence gates present. Independent review records findings and dispositions. Explicit Human approval before W1 implementation.

## 4. W1 — Owner / Windows grant / host capability contracts

**W1-04 qualified grant sync (new):** preserve `ACTIVE/STALE/REAUTH_REQUIRED/REVOKED` and selected-only stale-root reauthorization from common grants. Record separately whether the durable root was accepted and whether the native file backend is qualified for that root list. A mismatch must yield actionable blocked status, not pretend file mutations are permitted. Native update requires stopped-owner/qualified installer evidence and retained previous generation/journal. Test other stale grants retained, root identity changed, failed installer and safe retry-after-readback. **W1-04 DONE:** actual Windows owner/root/negative fixture receipts and a failure-state readback, not merely successful `bind_workspaces`.



**Role:** Coder + Tester, Reviewer at G1  
**WHAT:** One per-user Windows connector owner, protected durable grant store, Windows root identity and revision checks. Prove unsupported sandbox API is never advertised as verified.  
**WHERE:** Native Windows host/grant adapters (new files in `src/hosts/` or `src/local/`), `src/core/workspace.ts`, `src/hosts/windows-appcontainer-candidate.ts` as research only, `scripts/native-gate-windows.ps1`, Windows-specific tests.  
**CONSTRAINTS:** Maintain Mac code paths. Root identity cannot be a string path alone. Deny unapproved roots, overlapping workspace/reference, stale grant after rename/drive alias/reparse swap, private connector directory. No admin or VM assumption. Don't change MCP dispatch yet.  
**DONE:** GitHub `windows-latest` host probe and case-sensitive/casefold/drive/UNC/junction/reparse hostile fixtures; only proved operation flags enabled. Commit/push exact SHA and G1 test evidence.

**Instruction update trigger:** After host probe, Planner records supported Windows versions, native API availability and whether additional proof is necessary; revise W2 and W3 instructions before dispatch.

## 5. W2 — Native file/recovery/directory contracts

**W2-05 Windows bytes and NEW image import module (depends W2-01 and W1-04):**

- **WHAT:** connect existing Windows-branch `create_file_bytes` / `fetch_file_bytes` schema+handlers to a qualified Win32 broker, **author missing host fileParam validator/HTTPS image intake module**, and provide a typed import service. `import_image_file` does **not** yet exist on Windows; the single integrator adds its MCP tool/dispatch during W4-01.
- **WHERE:** NEW Windows-branch secure fileParam module (file path chosen in W2-05, not an already existing import), native file adapter and Windows tests. Mac `src/mcp/image-file-transfer.ts` + `docs/workspaces/IMAGE-ASSET-TRANSFER.md` are READ-ONLY examples; `src/mcp/server.ts`/catalog are W4-01 integrator-owned.
- **CONSTRAINTS:** real host injected `file` parameter; HTTPS origin allowlist, no redirects, no logs with URL/tokens, MIME/signature/extension, 8 MiB, native exclusive create, current controller + workspace role. No Base64 chat-workaround or unconfined `fs.writeFile` fallback. Windows-skipped POSIX tests do not satisfy this job.
- **DONE G2 only:** `windows-latest` adapter-level native file/byte tests + new image validator with simulated host metadata prove role denial, stale grant, allowed origin/redirect/MIME/signature/8MiB safety, path/ADS escape, interrupted transfer, collision and SHA-256 source/readback equality. **Not** actual MCP import. **DONE G4:** registered `import_image_file` schema/host fileParam and MCP dispatch test. **DONE W5:** selected Windows plugin real image artifact E2E.



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
**DONE:** Native PowerShell, CMD, node, non-Git script, Git local, timeout, stdout/stderr/exit, owned process tree stop, neighbor survival and UNKNOWN on unprovable kill, exact G3 Windows CI. Remote Git API either has independently reviewed restricted-network proof or remains explicitly blocked; document that unconfined PowerShell/CMD may independently reach network Git and API blocking is not OS-wide network confinement.

**Instruction update trigger:** After feasibility, Planner records whether remote Git is a separately approved follow-up; do not widen scope or weaken the command risk statement to make it pass.

## 7. W4 — MCP integration / Desktop / CI contracts

**V4 integration requirement:** compose only verified Windows native grant-backed file capability; IMPLEMENT missing `import_image_file` MCP schema/host fileParam dispatch, and implement `fileGrantSyncState`/blocked diagnostic status (currently missing on Windows), while retaining the existing Windows API naming and unconfined command-truth contract. The Windows desktop installer must preserve old state on failed update and must not mutate the Mac installation.



**Role:** Single Integrator (MCP), Coder (Desktop), Tester  
**WHAT:** Expose proven Windows backends over existing MCP calls, ship per-user Windows background/tray Open/Quit and trusted tunnel start/stop, preserve Mac behavior.  
**WHERE:** Integration owner only touches `src/mcp/{runtime-bootstrap,server,catalog,write-dispatch}.ts`. Desktop owner uses new Windows UI/installer scripts, package resources and tests. CI owner edits Windows workflow files.  
**CONSTRAINTS:** No new tool catalog or work approval layer. Don't claim Windows `verified=true` from AppContainer manifest alone. Open/Quit only; no Pause/Resume. No secret in published output; no global configuration changes. No update/kill of unrelated applications. Never alter Mac login app as a Windows side effect.  
**DONE:** Source typecheck, full core tests, exact SHA hosted Windows native suites, Windows desktop/package smoke, Mac regression, real MCP status exposes truthful capability and blocked reasons. Artifacts contain no secrets. Review findings corrected and rerun.

**Instruction update trigger:** Integrator obtains exact stable interface signatures from G2 and G3 and adjusts its contract before editing shared dispatch.

## 8. W5 — Real Windows installed-plugin acceptance

**V2 mandatory real-plugin cases:** choose a disposable Windows workspace and reference root; pass a genuine ImageGen artifact through the selected Windows plugin's `import_image_file` host fileParam, verify source/import/readback SHA-256 and file length, and refuse false PASS on a preview or a fabricated file ID. Bind a new root and verify selected-only rebind plus qualified file-grant status; report any installer refresh blocker without bypass. Run normal Open/Quit and owned-process checks separately; reboot remains excluded.



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
| Grant-lock recovery | Old fenced session may be recovered, active/foreign/unparseable/unowned lock preserved; no PID/age cleanup; recovery diagnostic is precise |
| Controller lease continuity | Unexpired hashed token survives verified reconnect; `SESSION_BUSY` reports `expires_at`; expiry/release preserve single controller |
| Journal unavailable | First failure retries; process tools report `PROCESS_JOURNAL_UNAVAILABLE`, diagnostic tools work with `DEGRADED`; no child replay |
| HTTP / JSON-RPC | >30s bounded tool completes, slow headers denied, precise error code classes and secret/path redaction |
| Desktop recovery / Quit | Retryable failures reconnect within bound, auth/Quit never trigger loop; only owned Job Objects can be force-stopped with user confirmation |
| Test isolation | Synthetic Windows user profile and identity; no host profile/registry/personal connector files changed |
| Grant refresh mismatch | Selected-only stale-root rebind does not enable stale/unsigned native file grants; blocked write with diagnosis and unchanged prior journal |
| Binary/image import | Genuine host fileParam, approved URL, MIME/size/extension, exclusive native create, stale grant/reference denial, byte/SHA-256 readback; no Windows skip-as-PASS |
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

No report may say full Windows accepted based solely on Mac PASS or on a GitHub Windows VM that did not exercise the selected host behavior. G2/G3 adapter-only PASS never means `import_image_file` or process controls passed over actual MCP; G4 and W5 have independent proof obligations. Runner evidence is useful but bounded.

## 11. Pre-code readiness and assignment policy

This Job Guide and companion documents are **drafts**, not approval to execute W1–W5. W0 branch authority update is complete; read-only Mac lessons and V4 planning review remain open. No merge of `main` is planned or required. The latest Mac reliability delta is incorporated as W0-07, W1-05/W1-06, W3-05 and W4-04/W4-05; none is Windows-native PASS. W0 Reviewer/Critic must inspect for missing file boundaries, feasibility blockers, contradictions and new unwanted requirements. If findings concern design rather than the approved Criteria, correct the design; do not call it a Criteria change. Once W0 receives approval, assign tasks in dependency order and continue automatically to DONE or a true human gate, with Planner refreshing provisional instructions when each upstream artifact is available.

**Current state:** Windows code NOT started in this phase; no Windows native test or selected-host acceptance claimed.
