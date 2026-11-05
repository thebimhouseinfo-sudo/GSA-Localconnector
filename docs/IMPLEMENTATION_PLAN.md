# Implementation Plan — GSA-Localconnector, Native Mac V3 (2026-11-05)

## GOAL

Enable online GSA to operate the user's existing macOS workspace directly through `gsa-lc-mac` with full scoped file operations, reference-only read/copy, native shell/Git/build/test/process/logs, real evidence and truthful recovery. **No product VM.** GitHub-hosted macOS build/tests must PASS for the exact installation candidate *before* considering any change to the user's Mac. Retire old VM integration completely after native replacement proof. Mac M5 before Windows M6.

**Status:** PRE-CODE DOCUMENT REVISION. Approved source of requirements: [CRITERIA](CRITERIA.md) §0–§10 including the 2026-10-31 unconfined-user-account command exception and 2026-11-05 VM retirement decision in [DECISIONS](DECISIONS.md). Task assignment: [MILESTONES](MILESTONES.md). Exact implementation design and CI matrix: [TECHNICAL PROPOSAL](TECHNICAL_PROPOSAL.md). Superseded technical proposal archived at `docs/archive/TECHNICAL-PROPOSAL-LEGACY-PRE-20261105.md`. Older linear/optional-VM instructions do not apply.

### Baseline facts and gaps

- M0/M1 have bounded design/native broker evidence; M2 in progress, M3/M4/M5 NOT accepted, M6 deferred. No source-only or historical fixture PASS establishes current installed-plugin Mac acceptance.
- Existing `runtime-bootstrap.ts` invokes VM runtime/CI; `server.ts` and `catalog.ts` retain VM descriptions and Git denial; command cwd is currently limited to `"." `. Native Mac runner is a missing product capability, not a current PASS.
- Existing native file brokers, owner/grants/journals, process journal and desktop components are reusable candidates. Previously reported retained-FD relocation and fixture physical-stop limitations remain open and may block affected operations.
- First PR #4 source-only GitHub macOS CI PASS for old SHA `28f96118588acf9e78c230c0870e514e8af42fa6` is narrower than mandatory future native command/file suite. CI results must bind to each **new** exact commit.
- Dirty/unpushed Mac work described by `MAC-QWEN-HANDOFF.md` must be inspected and protected; GitHub branch is not proof of local state.

## PHASE 0 — Freeze interfaces and protect existing work (SEQUENTIAL)

### GOAL

Create one precise source/contract baseline to permit parallel feature work without corrupting state or changing Criteria.

| Task | Owner | Work | Exit |
|---|---|---|---|
| P0-01 | Planner/integrator | Read exact repository/branch, uncommitted Mac changes, existing installed plugin and acceptance gaps; preserve all dirty files | Exact git HEAD/status and unverified host facts recorded; no reset/loss |
| P0-02 | Integrator | Pin grant/controller/owner revision contracts, native file/process interfaces and single MCP shared-file ownership; no second installer/journal/agent | Reviewed interface/caller map; no overlapping writer |
| P0-03 | VM inventory agent | Freeze all VM work; classify dependency graph as VM-only/shared/historical/user media | Immutable retirement inventory and deletion prerequisites |
| P0-04 | Planner | Align current GSA Project Job/Task topology with this approved Criteria + V3 plan; previous READY linear M2→M3 is historical | New exact-revision review evidence and project Job reconciliation before dispatch |

**No product code before full Plan/Milestones/Technical Proposal review PASS and subsequent Human authorization.** G0 interface freeze is the only sequential preparation for independent development tracks; do not make M3 *source development* wait for M2 completion.

## PHASE 1 — Parallel workstreams AFTER G0

### GOAL

Use independent branches/file owners to advance usable Mac capabilities in parallel, while preserving deterministic integration.

| Track | Tasks | Source writer scope | Can run alongside | Conditions |
|---|---|---|---|---|
| A — Mac files | A1 installer/recovery; A2 file move/log/diff; A3 directory copy/rename | `src/hosts/macos-{scoped-files,file-recovery,directory-*}.ts`, `native/macos-files/*`, file stores and tests; own existing installer | B, C, D, E inventory | A1 fixture stop and journal preservation; A2/A3 subwork parallel only on disjoint files |
| B — Native command/process/Git | B1 host adapter; B2 cwd/owned stop; B3 journal and Git; B4 MCP integration (integrator-only) | `src/hosts/macos-host-commands.ts` candidate, `src/core/{native-io,process-manager,durable-process,process-journal,git-*}.ts`, process tests | A, C, D, E inventory | B2/B3 require B1 seam, no actual host activation before source tests |
| C — GitHub-hosted macOS CI | C1 workflow, C2 native safe fixture suites | `.github/workflows/ci.yml`, CI-only scripts/test | A, B, D, E | exact SHA, mandatory tests fail when absent/unexpected skip; no VM tests |
| D — Desktop lifecycle prep | D1 Mac Dock/login/env/quit tests | `native/macos-desktop/*` and desktop-specific scripts/tests | A, B, C, E | No hosted workflow modifies local login or real installed app |
| E — VM retirement inventory | E1 classify/remove map (docs-only); E2 deletion code PR deferred | E1 documents; E2 VM-only source and registries, controlled by integrator | E1 with A–D | E2 only after accepted native host replacement evidence (G4) |

**Shared files** `src/mcp/{server,catalog,runtime-bootstrap,write-dispatch,batch-dispatch}.ts` are written by ONE integration agent, **never in competing A/B/D branches**. Staging source branches from the same reviewed G0 base avoids cherry-pick of unreviewed shared runtime edits. Cross-track changes to `native-io.ts` need integrator contract review before merge. No source edits against `main`; product and test source changes start only after separate Human execution authorization.

## PHASE 2 — Sequential integration and GitHub macOS test gates

### GOAL

Merge reviewed work deterministically with continuous exact-revision macOS checks before exposing any version to the user's Mac.

| Gate | Dependencies | Action | Required result |
|---|---|---|---|
| G0 | P0-01/02/04 + reviewed planning | Confirm interface, branch, owner contracts | one immutable integration baseline |
| G1 — M2 | reviewed A1/A2/A3 + C file-fixtures | Integrate Track A *serially*, run hosted macOS C0+C-A | M2 file contracts pass on exact commit; blocked functionality labeled |
| G2 — M3 | G1 grant surface + reviewed B + C command-fixtures | Integrate native Mac runner into shared MCP *serially*; prohibit VM fallback | hosted C0+C-A+C-B pass and capability reports truthful |
| G3 — pre-install | G2, applicable D source prep, package identity | Full hosted `macos-latest` suite C-G3 at exact installation candidate and artifact | all mandatory tests PASS, no unexplained skips, no secrets, no destructive fixture |
| G4 — user's real Mac | **G3 PASS + separately reviewed/authorized installer action** | Install matching artifact only through a controlled action; test plugin with disposable roots | actual native selected-plugin files, scripts, Git, process/log/stop and canary observations |
| G5 — recovery + retirement | G4 native replacement proof; M4 source may prep earlier | Verify real Mac crash/restart/UNKNOWN/revocation; separately remove VM-only code and hosted C-VM regression | recovery proof + no shipped VM import; original user media untouched |
| G6 — M5 | G4+G5, completed D | Observe installed background/Dock/setup and concurrent independent projects | full Mac Criteria met, no required capability UNKNOWN |
| G7 — M6 Windows | M5 accepted | Only now plan/build Windows | separate Windows evidence, not reused Mac test |

A/B/C/D/E can research/design in parallel, but the gates **G0→G6 remain sequential for integrated acceptance**. M4 source tests may start after B run semantics freeze in parallel to integration; restart/reboot proof requires G4. E2 VM deletion is independent/reversible after native replacement and has its own SHA-pinned CI; on failure revert only E2 PR, never automatically reactivate VM. No automatic production installation or connector state migration based on CI status.

## PHASE 3 — Evidence, safety and acceptance

### GOAL

Prove each required capability without misrepresenting source, hosted Mac, historical VM or installed Mac observations.

**C0 source CI:** GitHub `macos-latest`, Node 22, `npm ci --ignore-scripts`, `npm run build`, all non-VM source suites; existing `scripts/test-native-source-capture.py`; record commit/lockfile, host OS/arch/Xcode/Swift, command exits and skipped suite list. A static check disallows new runtime VM imports on post-retirement builds. Frozen old VM tests not counted as native acceptance.

**C-A file fixture on hosted Mac:** disposable signed native broker and file tests, reference-denial, A↔B transfer, CAS change, atomic rename, journal readback/UNKNOWN and owned helper shutdown; fixtures retained on unproven stop, never kill unrelated process. **C-B command fixture on hosted Mac:** actual macOS `uname`/`node`/`swiftc`/Git, non-Git script, cwd subdir and reference denial, pass/fail/stdout/stderr, output cursor and cap, timeout, exact owned process stop with neighboring process unchanged. **C-G3** requires C0+C-A+C-B plus package/manifest checks. If a required suite is missing or skipped, treat gate **BLOCKED**, not PASS. The exact eventual entrypoint commands are delivered/tested by responsible C/A/B coders; do not invent their presence now. Native-safe cloud proof is not Mac-local TCC, identity, tunnel, sleep/wake or Dock acceptance.

**Real host:** only after G3 review and separate install authorization; use disposable roots, file canaries, source/build/install hashes, signed identity, owner/lease/grant revisions, run ID/argv/cwd/exit/stdout/stderr/artifacts, timeout/cancel, unknown/recovery and data preservation. Preserve GPTWorker/CadGPT/RevitGPT/other processes. `command_confinement: none (user account)` and `state_integrity_vs_commands: not_protected` are mandatory; command descendants can access outside roots with user's permissions; API/file broker must not. Do not claim sandbox protection for arbitrary shell.

**E2 retirement and rollback:** native Mac replacement first, hosted and selected-plugin evidence; separate VM deletion branch/PR with deletion map and full hosted regression. No user media deletion, no recovery journal rewrite, no original VM asset deletion. On CI failure keep E2 unmerged; if already integrated and regression red, roll back only its commits while preserving native execution and user artifacts. A rollback of installed Mac release is a *separate explicit* reviewed/human-approved operation, never automatic VM fallback.

## PHASE 4 — Planning review closure and dispatch boundary

### GOAL

Deliver implementation-ready, task-sized artifacts without performing product implementation during document review.

Reviewer independently checks: all approved Criteria §0–§10, M0–M6 coverage and task dependencies; exact file/function/caller mapping and expected outputs in [Technical Proposal](TECHNICAL_PROPOSAL.md); branch ownership, shared MCP integration, File/Process UNKNOWN/no-replay, unconfined command declarations, hosted pre-install vs local acceptance, staged VM retirement/rollback and protected uncommitted Mac work. Every finding must have evidence, owner and closure. Update durable GSA planning Job/Review only through authorized CAS/readback and exact source SHA; previous 2026-10-22 READY Job Reviewer PASS does not approve this V3.

**Current state:** V3 documents are prepared for Reviewer; no product source changed and no Mac installation performed. Only a verified Reviewer PASS on exact V3 (and, if requested, later CR) counts as review closure. Human approval is still required before coding.

