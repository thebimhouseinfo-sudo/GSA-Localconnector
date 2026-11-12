# Windows Native Connector — Milestones and Job DAG

**2026-11-12 · Status: V3 RELIABILITY DELTA / REVIEW PENDING**  
**Branch:** `feat/windows-native-connector-20261109`  
**Branch fork SHA:** `41102fa3e9d2a187c8373b1474e9377b737c66b1` · **Mac read-only reference:** `main@9d66c60c4f31cae6cfed64838468b5558973ab0c` (not a merge target)

**GOAL:** Deliver the Mac-accepted GSA-Localconnector user workflow natively on Windows, retaining shared MCP schemas and user-approved workspace/reference semantics. Windows development and acceptance are sequentially *after* the user's Mac PASS; macOS source remains protected. No VM, separate AI, connector-level CI engine or Pause/Resume. See `WINDOWS_IMPLEMENTATION_PLAN.md` (WHAT/sequence), `WINDOWS_TECHNICAL_PROPOSAL.md` (design) and `WINDOWS_JOB_GUIDE.md` (handoff contracts).

## GOAL

Deliver the existing Mac-accepted GSA LocalConnector workflow natively on Windows through the same MCP schemas, with separately proven Windows file boundary, command/process control, installer and actual plugin E2E; preserve Mac regression behavior and honest blocked/unknown states. Do not add a product VM, local AI, new CI engine, Pause/Resume or per-call work approval.

**V3 tracking:** The 2026-11-12 nine-defect reliability guide and 16 subsequent Mac/shared source commits are additionally assessed. Existing shared implementations require Windows-host requalification; macOS-only pause code is not Windows scope. **V2 change tracking:** Four documentation additions already existed on this Windows branch; no Windows implementation source was observed at the branch fork. The newer `main` includes workspace/grant recovery, backend sync diagnostics, image binary transfer and desktop fixes. These are assigned below as **Windows work to qualify**, not completed Windows features. `J-F33D` is a distinct historical Mac planning record; old Mac evidence is not Windows PASS. Project branch authority was updated with readback to this Windows branch on 2026-11-12. Mac lessons extraction and independent planning review remain pending; no main merge is planned or required.

## Legend

- **P**: authorable in parallel after W0 review; changes must have exclusive source ownership.
- **S**: sequential dependency / prerequisite.
- **I**: integration or acceptance gate on exact commit with required GitHub Windows runner tests.
- **H**: human gate (only where actual approval or selected host is genuinely required).
- **BLOCKED**: not implemented / not proven; never represented as PASS.

No build/test result is inherited from macOS; actual Windows evidence is mandatory.

## W0 — Planning / decision gate

### GOAL

Reconcile current Windows branch with newer Mac/common source and produce four reviewed source-revision-bound planning documents before any Windows product implementation.

| ID | Work owner / scope | Dependency | Done and evidence |
| --- | --- | --- | --- |
| W0-00 | Planner/GSA: change Project Memory development target to existing Windows branch (completed) | User's 2026-11-12 explicit instruction | CAS/readback of PROJECT.md; preserve historical Mac Job without changing its status |
| W0-01 | Planner: read Criteria, Decisions, current Mac source + acceptance and Windows candidate | Mac user acceptance | Document reusable contracts, Windows gaps and latest Open/Quit-only decision |
| W0-02 | Planner: Windows Plan and acceptance fixtures | W0-01 | Trace Criteria §§1–10, clarify trust/unconfined commands, remote Git and reboot exemption |
| W0-03 | Planner: Windows Technical Proposal | W0-02 | Chosen alternatives and negative tests, no unjustified AppContainer `verified` claim |
| W0-04 | Planner: Windows milestones + job instructions | W0-02/W0-03 | Every job has owner, required inputs/outputs, constraints, evidence and blockers |
| W0-05 | Planner/Technical Reviewer: inspect Mac code/bugfixes from `main` **read-only** and extract Windows design lessons | W0-01; pinned Mac reference SHA | Root cause -> expected behavior -> Windows-native mechanism -> negative test traceability table; **NO merge/rebase/cherry-pick or main modification** |
| W0-07 | Planner/Tester: classify nine Mac reliability fixes into behavior/contracts to emulate, Windows-native mechanisms and Mac-only exclusions | W0-05; read-only Mac reference `9d66c60` | Traceability rows and negative tests in four documents; no implicit import of Mac source or inherited Windows PASS |
| W0-06 | Planner + role-isolated Reviewer: review Windows-only design and task traceability; no source synchronization prerequisite | W0-02..05 + W0-07 | PASS evidence for exact planning revision; no main merge; Human implementation approval still required |
| **W0-G** | **Reviewer/Critic then Human** | W0-01..07 | Consistency review complete, **explicit implementation approval**; do not start Windows code earlier |

## W1 — Windows runtime foundation / owner / grants

### GOAL

Make Windows root identity, controller/grants and selected-only grant reauthorization safe and durably observable, without mistaking enrollment for native-file readiness.

| ID | Owner & files (indicative) | Mode | Depends | Acceptance |
| --- | --- | --- | --- | --- |
| W1-01 | Coder / Windows owner, private state and grant adapters; match approved workspace interface of Windows branch, informed by read-only Mac reference | P | W0-G | One owner only; protected durable Windows grants, per-root identity, roles/revision and revocation |
| W1-02 | Coder / Windows read-only host probe, root/reparse/volume tests | P | W0-G | Drive-letter, case aliases, junctions, symlinks, UNC/non-existing inaccessible roots explicitly classified |
| W1-03 | Tester / GitHub `windows-latest` baseline CI and fixture harness | P | W0-G | Node build+existing tests, genuine Windows host metadata, no false skips; isolate synthetic `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, TEMP and connector identity |
| W1-04 | Coder/Tester: qualified file-grant synchronization and recovery-state contract | S | W1-01+W1-02 | `ACTIVE/STALE/REAUTH_REQUIRED/REVOKED` selected-only rebind; other stale grants retained; backend mismatch remains fail-closed and actionable; old installed generation/journals preserved |
| W1-05 | Coder/Tester: Windows-native grant-store lock owner/fence recovery and diagnostic; learn behavior from Mac reference, implement independently | S | W1-01+W1-04 | Old verified fenced server lock can recover; active desktop/unowned/unparseable lock never auto-deleted; malformed lock gives `GRANT_STORE_RECOVERY_REQUIRED`, not indefinite generic busy; concurrent writers isolated |
| W1-06 | Coder/Tester: controller lease survives verified owner restart while unexpired | S | W1-01 | Existing hashed lease, token renewal after restart, `SESSION_BUSY.expires_at`, expiration/release; no takeover UI |
| **G1** | **Integrator + Reviewer** | **I** | W1-01..06 | Exact-head Windows suite PASS for owner/grants/path negatives; no production mutation |

## W2 — Native scoped files / recovery / directory

### GOAL

Prove Windows-native scoped text/binary/file/directory operations with CAS, recovery and honest `UNKNOWN`, including the existing host-injected image importer and SHA-256 readback.

| ID | Owner & files (indicative) | Mode | Depends | Acceptance |
| --- | --- | --- | --- | --- |
| W2-01 | Coder / Win32 file broker and verified scoped reads/create | P | G1 | Handle-relative/reparse-safe containment, root identity checks, exclusive create, bounded read/search |
| W2-02 | Coder / Windows durable replace/delete + CAS, local recovery/readback | S | W2-01 | `APPLIED/CONFLICT/UNKNOWN` with journal, retained state and no automatic retry |
| W2-03 | Coder / copy/move across authorized workspace/ref roles | S | W2-02 | Reference cannot be destination/source of move; copy into workspace only, SHA verified |
| W2-04 | Coder / Windows tree reader, directory manifest/copy+readback | P after W2-01 | W2-01 | Reparse loops/junction escapes denied; bounded traversal, journal and conflict tests |
| W2-05 | Coder/Tester: Windows binary transfer and image fileParam import adapter using shared parser | S | W2-01+W1-04 | Real Windows exclusive-create, `create_file_bytes`/`fetch_file_bytes`/`import_image_file`; MIME+signature+extension, 8MiB, allowed HTTPS/no redirects, reference denial, stale grant, no secret log, collision, SHA-256 source/readback |
| **G2** | **Integrator + Tester/Reviewer** | **I** | W2-02..05 | Exact SHA `windows-latest` native file+tree suite, negative cases and provenance retained; unsupported operations remain blocked |

## W3 — Native commands, Git and owned processes

### GOAL

Use the Windows logged-in user and native Job Objects to execute/observe only owned work, while disclosing no OS confinement and leaving remote Git blocked without separate capability proof.

| ID | Owner & files (indicative) | Mode | Depends | Acceptance |
| --- | --- | --- | --- | --- |
| W3-01 | Coder / Windows logged-in user process adapter | P | G1 | PowerShell/CMD/node/test script; workspace or child cwd; explicit no-confinement flags |
| W3-02 | Coder / Job Object lifecycle and process journal | S | W3-01 | Start/status/output/cancel, timeout/output cap, stop only owned descendants, neighbor survives |
| W3-03 | Coder / local Git and bounded diff integration | S | W3-01 | Local status/diff/log/commit in disposable repository, dirty files not lost |
| W3-04 | Technical reviewer / separate network Git capability feasibility and threat model | P | G1 | Positive network proof or recorded `BLOCKED`; no unconfined shell bypass |
| W3-05 | Coder/Tester: Windows process journal retry and degraded-read diagnostics (Mac behavior as test oracle, no source import) | S | W3-02 | Transient store load failure retries, permanent failure yields `PROCESS_JOURNAL_UNAVAILABLE` for process tools while status/list capabilities remain available and `processHistoryState=DEGRADED`; two concurrent callers share one load |
| **G3** | **Integrator + Tester/Reviewer** | **I** | W3-02..05 and G2 | Hosted Windows native command+process+Git tests PASS; network Git advertised only if separately proven |

## W4 — Windows MCP integration / Desktop / CI

### GOAL

Publish only qualified Windows native capabilities through shared MCP, retain fileParam/grant error semantics and Mac regression, and provide a minimal per-user Open/Quit desktop installation.

| ID | Owner & files (indicative) | Mode | Depends | Acceptance |
| --- | --- | --- | --- | --- |
| W4-01 | **Single integrator** / `src/mcp/{runtime-bootstrap,server,catalog,write-dispatch}.ts` | S | G2+G3 | Platform selection without regressing Mac; identical MCP contract, fileParam/image routing, rebind/recovery diagnostic shape, process-journal DEGRADED reporting and truthful capabilities; diagnostics remain reachable |
| W4-02 | Coder / Windows background/tray app and user-mode installer | P | G1 | Open/Quit only, login startup, protected tunnel config, no admin requirement by default |
| W4-03 | Tester / Windows CI package/integration matrix and artifacts | P | W1-03 | Signed/verified provenance where applicable, exact SHA packages, no secrets |
| W4-04 | Integrator/Tester: HTTP/stdio MCP reliability and accurate errors on Windows | S | W3-05+W4-01 | Long tool (>30 s) returns JSON-RPC response; request/header deadlines remain; no raw path/token in error; map `-32600/-32601/-32602/-32603` correctly; no fake `SESSION_INVALID` |
| W4-05 | Coder/Tester: Windows tray retryable restart, owned-work Quit and confirmed Force Quit | S | W4-02+W3-05 | Retryable tunnel exit uses bounded backoff/attempts, never loops on auth/config/Quit; owned process journal proves IDLE/ACTIVE/UNKNOWN; normal Quit safe, force only with user confirmation and no neighbor kill; no Pause/Resume |
| **G4** | **Integrator + Reviewer** | **I** | W4-01..05 | `windows-latest` C0+files+process+desktop+packaging PASS; verify Mac CI remains PASS |

## W5 — Real Windows adoption and user acceptance

### GOAL

Verify the selected installed Windows plugin on disposable working and reference roots, including genuine host image artifact transfer, grant updates and independently read-back native effects.

| ID | Owner | Mode | Depends | Acceptance |
| --- | --- | --- | --- | --- |
| W5-01 | Operator/Tester | H/I | G4 | Install only reviewed candidate on explicitly selected Windows host; confirm exact hash/version |
| W5-02 | Operator/Tester | S | W5-01 | Plugin bind workspace/ref; read/edit/delete/move/directory copy; genuine host image `file` import + independent byte hash; real local script/build and Git |
| W5-03 | Operator/Tester | S | W5-02 | Two isolated projects, revoked/stale grants and selected-only rebind with native backend qualification; verified stale grant-lock and unparseable blocked diagnosis, unexpired control lease renewal; interrupted operation and truthful readback; neighbor process intact |
| W5-04 | Operator/Tester | S | W5-03 | Tray Open/Quit/tunnel stop/relaunch/login persistence without reboot; unexpected tunnel exit reconnect, retry ceiling, confirmed owned-only Force Quit, status while degraded, HTTP long tool and transient journal recovery; same unexpired control lease |
| **M6 ACCEPT** | **Human** | **H** | W5-01..04 | Accept user workflow; list all PASS/NOT_TESTED/BLOCKED accurately; issues used for later bugs |

**Reboot is explicitly excluded from current acceptance**. Do not quietly add as a gate; do not assert recovery after physical reboot is tested. Crash/service-restart tests can still be done in disposable fixtures.

## Cross-branch boundary (Human correction, 2026-11-12)

- `main` is **READ-ONLY reference** for observing Mac bug fixes, corrected behavior and tests.
- `feat/windows-native-connector-20261109` is the **only source-write branch** for Windows planning and subsequent Windows implementation.
- W0-05 is a research/evidence task, **not a merge, rebase, cherry-pick, shared-source import or dependency on Git history convergence**.
- All native Windows changes must be independently planned, implemented and tested on the Windows branch. Shared interface similarity is a target, not a reason to copy Mac code or mark Windows tests PASS.
- No additional approval gate, architecture or UI controls are created by observing Mac commits.

## Dependency and ownership rules

`W0-07 + W0-05 → W0-06 → W0-G → {W1-01,W1-02,W1-03} → {W1-04,W1-06} → W1-05 → G1 → {W2-01,W3-01,W3-04,W4-02} → {W2-02,W3-02} → {W2-03,W2-04,W2-05,W3-03,W3-05} → G2,G3 → W4-01 → W4-04; W4-02+W3-05 → W4-05; W4-03+W4-04+W4-05 → G4 → W5 → M6`. This is a summary, not an extra dependency; the task rows above are authoritative.

One owner modifies MCP integration files, serially. Independent backend/test/docs tasks may use the same development branch with file-level ownership and separate commits; **do not create alternative parallel branches unless explicitly approved**. Job instructions specify required input versions, expected evidence and allowed paths, not copied harness. Tasks that depend on another job's results must have their instructions enriched by the Planner when those inputs exist.

## Failure handling and no-false-PASS policy

- A task continues autonomously until its own Done criteria or a real blocked/human gate. Fix findings and retest, do not stop merely because the first CI run fails.
- If Windows GitHub runner or Windows user host cannot run an acceptance case, record `CHƯA KIỂM` / `PENDING USER REQUIRE` with exact reason; never mark PASS based on Mac evidence.
- A build-only test does not certify OS containment. Native sandbox candidate is disabled unless separately proven. Cross-volume copy/move uses explicit partial outcomes.
- Do not delete or rebind a user-owned workspace, credential, installed app or neighbor process for a fixture.
- Keep data, process and recovery journals separated across projects and Windows plugin identities.

## Planning sign-off checklist

- [x] Windows W0–W5 task graph and dependencies specified.
- [x] All tasks have owners, scope and evidence.
- [x] Open/Quit-only decision and reboot exemption carried forward.
- [x] Windows V2 added grant-sync and real fileParam/image acceptance, with Mac shared-source traceability.
- [x] Map the newest nine Mac reliability defects to Windows owners, tasks and proof requirements (planning mapping, not native PASS).
- [x] `main` is read-only design/test reference; no merge/rebase/cherry-pick into Windows and no modification of `main`.
- [ ] Review Mac lessons -> Windows implementation/test traceability without requiring any Git history sync.
- [ ] Independent Critic / Reviewer of complete Plan + Proposal + Guide.
- [ ] Human approves starting implementation.

**Planning documents exist; this check list does not falsely assert review, code delivery or Windows native tests.**
