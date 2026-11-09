# Windows Native Connector — Milestones and Job DAG

**2026-11-09 · Status: PRE-CODE / REVIEW PENDING**  
**Branch:** `feat/windows-native-connector-20261109`  
**Base SHA:** `41102fa3e9d2a187c8373b1474e9377b737c66b1`

**GOAL:** Deliver the Mac-accepted GSA-Localconnector user workflow natively on Windows, retaining shared MCP schemas and user-approved workspace/reference semantics. Windows development and acceptance are sequentially *after* the user's Mac PASS; macOS source remains protected. No VM, separate AI, connector-level CI engine or Pause/Resume. See `WINDOWS_IMPLEMENTATION_PLAN.md` (WHAT/sequence), `WINDOWS_TECHNICAL_PROPOSAL.md` (design) and `WINDOWS_JOB_GUIDE.md` (handoff contracts).

## Legend

- **P**: authorable in parallel after W0 review; changes must have exclusive source ownership.
- **S**: sequential dependency / prerequisite.
- **I**: integration or acceptance gate on exact commit with required GitHub Windows runner tests.
- **H**: human gate (only where actual approval or selected host is genuinely required).
- **BLOCKED**: not implemented / not proven; never represented as PASS.

No build/test result is inherited from macOS; actual Windows evidence is mandatory.

## W0 — Planning / decision gate

| ID | Work owner / scope | Dependency | Done and evidence |
| --- | --- | --- | --- |
| W0-01 | Planner: read Criteria, Decisions, current Mac source + acceptance and Windows candidate | Mac user acceptance | Document reusable contracts, Windows gaps and latest Open/Quit-only decision |
| W0-02 | Planner: Windows Plan and acceptance fixtures | W0-01 | Trace Criteria §§1–10, clarify trust/unconfined commands, remote Git and reboot exemption |
| W0-03 | Planner: Windows Technical Proposal | W0-02 | Chosen alternatives and negative tests, no unjustified AppContainer `verified` claim |
| W0-04 | Planner: Windows milestones + job instructions | W0-02/W0-03 | Every job has owner, required inputs/outputs, constraints, evidence and blockers |
| **W0-G** | **Reviewer/Critic then Human** | W0-01..04 | Consistency review complete, **explicit implementation approval**; do not start Windows code earlier |

## W1 — Windows runtime foundation / owner / grants

| ID | Owner & files (indicative) | Mode | Depends | Acceptance |
| --- | --- | --- | --- | --- |
| W1-01 | Coder / Windows owner, private state and grant adapters; reuse `src/core/workspace.ts` | P | W0-G | One owner only; protected durable Windows grants, per-root identity, roles/revision and revocation |
| W1-02 | Coder / Windows read-only host probe, root/reparse/volume tests | P | W0-G | Drive-letter, case aliases, junctions, symlinks, UNC/non-existing inaccessible roots explicitly classified |
| W1-03 | Tester / GitHub `windows-latest` baseline CI and fixture harness | P | W0-G | Node build+existing tests, genuine Windows host metadata, no false skips |
| **G1** | **Integrator + Reviewer** | **I** | W1-01..03 | Exact-head Windows suite PASS for owner/grants/path negatives; no production mutation |

## W2 — Native scoped files / recovery / directory

| ID | Owner & files (indicative) | Mode | Depends | Acceptance |
| --- | --- | --- | --- | --- |
| W2-01 | Coder / Win32 file broker and verified scoped reads/create | P | G1 | Handle-relative/reparse-safe containment, root identity checks, exclusive create, bounded read/search |
| W2-02 | Coder / Windows durable replace/delete + CAS, local recovery/readback | S | W2-01 | `APPLIED/CONFLICT/UNKNOWN` with journal, retained state and no automatic retry |
| W2-03 | Coder / copy/move across authorized workspace/ref roles | S | W2-02 | Reference cannot be destination/source of move; copy into workspace only, SHA verified |
| W2-04 | Coder / Windows tree reader, directory manifest/copy+readback | P after W2-01 | W2-01 | Reparse loops/junction escapes denied; bounded traversal, journal and conflict tests |
| **G2** | **Integrator + Tester/Reviewer** | **I** | W2-02..04 | Exact SHA `windows-latest` native file+tree suite, negative cases and provenance retained; unsupported operations remain blocked |

## W3 — Native commands, Git and owned processes

| ID | Owner & files (indicative) | Mode | Depends | Acceptance |
| --- | --- | --- | --- | --- |
| W3-01 | Coder / Windows logged-in user process adapter | P | G1 | PowerShell/CMD/node/test script; workspace or child cwd; explicit no-confinement flags |
| W3-02 | Coder / Job Object lifecycle and process journal | S | W3-01 | Start/status/output/cancel, timeout/output cap, stop only owned descendants, neighbor survives |
| W3-03 | Coder / local Git and bounded diff integration | S | W3-01 | Local status/diff/log/commit in disposable repository, dirty files not lost |
| W3-04 | Technical reviewer / separate network Git capability feasibility and threat model | P | G1 | Positive network proof or recorded `BLOCKED`; no unconfined shell bypass |
| **G3** | **Integrator + Tester/Reviewer** | **I** | W3-02..04 and G2 | Hosted Windows native command+process+Git tests PASS; network Git advertised only if separately proven |

## W4 — Windows MCP integration / Desktop / CI

| ID | Owner & files (indicative) | Mode | Depends | Acceptance |
| --- | --- | --- | --- | --- |
| W4-01 | **Single integrator** / `src/mcp/{runtime-bootstrap,server,catalog,write-dispatch}.ts` | S | G2+G3 | Platform selection without regressing Mac; identical MCP contract and truthful capabilities |
| W4-02 | Coder / Windows background/tray app and user-mode installer | P | G1 | Open/Quit only, login startup, protected tunnel config, no admin requirement by default |
| W4-03 | Tester / Windows CI package/integration matrix and artifacts | P | W1-03 | Signed/verified provenance where applicable, exact SHA packages, no secrets |
| **G4** | **Integrator + Reviewer** | **I** | W4-01..03 | `windows-latest` C0+files+process+desktop+packaging PASS; verify Mac CI remains PASS |

## W5 — Real Windows adoption and user acceptance

| ID | Owner | Mode | Depends | Acceptance |
| --- | --- | --- | --- | --- |
| W5-01 | Operator/Tester | H/I | G4 | Install only reviewed candidate on explicitly selected Windows host; confirm exact hash/version |
| W5-02 | Operator/Tester | S | W5-01 | Plugin bind workspace/ref; read/edit/delete/move/directory copy; real local script/build and Git |
| W5-03 | Operator/Tester | S | W5-02 | Two isolated projects, revoked grants, interrupted operation and truthful readback; neighbor process intact |
| W5-04 | Operator/Tester | S | W5-03 | Tray Open/Quit/tunnel stop/relaunch/login persistence without reboot |
| **M6 ACCEPT** | **Human** | **H** | W5-01..04 | Accept user workflow; list all PASS/NOT_TESTED/BLOCKED accurately; issues used for later bugs |

**Reboot is explicitly excluded from current acceptance**. Do not quietly add as a gate; do not assert recovery after physical reboot is tested. Crash/service-restart tests can still be done in disposable fixtures.

## Dependency and ownership rules

`W0-G → {W1-01,W1-02,W1-03} → G1 → {W2-01,W3-01,W3-04,W4-02} → W2-02/W3-02 → W2-03/W2-04/W3-03 → G2,G3 → W4-01/W4-03 → G4 → W5 → M6`.

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
- [ ] Independent Critic / Reviewer of complete Plan + Proposal + Guide.
- [ ] Human approves starting implementation.

**Planning documents exist; this check list does not falsely assert review, code delivery or Windows native tests.**
