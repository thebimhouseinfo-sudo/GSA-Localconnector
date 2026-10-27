# Implementation Plan — GSA-Localconnector

Status: ACTIVE

Derived from the approved [CRITERIA.md](CRITERIA.md) (Status: APPROVED, kept unchanged by the user). It reorganizes the already reviewed sequence in [MILESTONES.md](MILESTONES.md) and the detailed [implementation plan](plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md) into GOALs; it adds no new product scope, milestone or task. Facts: [PROJECT_PROFILE.md](PROJECT_PROFILE.md), [ARCHITECTURE.md](ARCHITECTURE.md), current state: [STATUS.md](STATUS.md). CRITERIA has no per-requirement IDs, so references use `CRITERIA §N` (its numbered sections 1–10 and the 2026-10-18 scope confirmation, `§0`).

**GOALMAP is inside this Plan.** Milestone IDs are kept as the reviewed identities; State is only a pointer to evidence in STATUS.md, never a completion claim. Gate state is owned by `harness/gate.mjs`; nothing here advances it.

## GOALMAP

| Goal ID | Observable result | Approved CRITERIA | Dependencies | Plan section | State |
|---|---|---|---|---|---|
| M1 | A concrete Mac boundary decision: what the existing broker proves, its limits, and what stays blocked | §0, §4, §7 | none | PLAN-M1 | Docs decision exists; native host scope BLOCKED by retained-FD authority survival after root relocation |
| M2 | GSA edits real projects on the selected Mac across multiple working/reference roots with no per-operation approval | §1–§4, §7 | M1 | PLAN-M2 | IN PROGRESS: source slices have evidence; installed/native file delivery pending |
| M3 | GSA runs real commands, Git and existing project scripts on this Mac and gets truthful status, logs and outputs | §4, §5, §6 | M1, M2 | PLAN-M3 | PENDING: actual Mac shell/Git not started |
| M4 | Disconnects, crashes and reboots never produce false results or duplicate mutations | §6, §8 | M3 | PLAN-M4 | PENDING |
| M5 | The full Mac journey is accepted per host, including several independent projects | §1–§8, §10 | M2, M3, M4 | PLAN-M5 | PENDING |
| M6 | The same journey works on Windows, built only after M5 is accepted | §9, plus §1–§8 on Windows | M5 | PLAN-M6 | NOT STARTED by design |

No M0 item is planned: the baseline/design milestone is planning evidence only.

## Plan items

No `docs/discussions/` DEC files exist, so no accepted Decision is linked below; the settled scope decisions live in [DECISIONS.md](DECISIONS.md) and CRITERIA §0.

### PLAN-M1 — GOAL: a documented Mac boundary decision that says what is proven and what stays disabled

- **CRITERIA references:** §0, §4, §7
- **Current state / gap:** [M1 feasibility](plans/M1-MAC-BOUNDARY-FEASIBILITY.md), [design](plans/M1-MAC-HOST-BOUNDARY-DESIGN.md) and [decision](plans/M1-MAC-BOUNDARY-DECISION.md) exist with broker and retained-capture evidence. The reproduced retained-FD authority survival after root relocation is unresolved; the Apple Endpoint Security entitlement is reported absent/unknown and nothing is assumed about it.
- **Implementation:** keep the existing broker characterization; do not invent a native supervisor or an unrestricted fallback. A failed mechanism needs a revised design and user review, not a waiver.
- **Dependencies:** none
- **Acceptance:** blocked mutation, cross-root and reference-copy paths stay explicitly disabled until a reviewed mechanism is proven.
- **Verification:** reviewed documents plus the recorded signed-broker native runs; no new native run is required by this Plan.
- **Limitations / non-goals:** broker success is not command-boundary or full Mac acceptance.

### PLAN-M2 — GOAL: GSA works on real Mac projects in several granted roots, with workspace full-access and reference read/copy-out only

- **CRITERIA references:** §1, §2, §3, §4, §7
- **Current state / gap:** registry, persistence, explicit role binding, regular-file recoverable operations, transaction readback, directory copy and installed-file delivery slices have source/bounded native evidence ([STATUS.md](STATUS.md), [Mac core resumption](plans/2026-10-19-MAC-CORE-RESUME.md)). Remaining: installed native file delivery, move/rename, remaining directory cases and live-plugin routing proof. Production activation of recovery stays false.
- **Implementation:** continue the existing slices (`src/core`, `src/local`, `src/hosts/macos-*`, `native/macos-files`) in the order of the resumption plan; reuse completed evidence, do not repeat it.
- **Dependencies:** M1
- **Acceptance:** list/search/read, create, write/edit/patch/binary, copy/move/rename/delete, diff and logs in working roots; A↔B copy/move between workspaces; reference read/copy only; invalid or overlapping roots, races, TCC, revocation and no widening are rejected.
- **Verification:** `npm run build`, `npm test` (verified in `harness/common/checks.json`) for source; matching real-Mac disposable-fixture runs for native claims. Unit tests never certify native behavior.
- **Limitations / non-goals:** no command-completeness claim; Windows is out of scope.

### PLAN-M3 — GOAL: GSA runs real project commands, Git and existing scripts on this Mac and reads back honest results

- **CRITERIA references:** §4, §5, §6
- **Current state / gap:** process journal and history source exist; actual Mac shell/Git/script execution under the boundary is not implemented or proven.
- **Implementation:** reuse the existing process manager and logs; run the project's own scripts on the selected host. No connector CI/DAG engine, VM runner or multi-OS matrix.
- **Dependencies:** M1 host/native-toolchain feasibility, M2
- **Acceptance:** pass/fail, stdout/stderr/exit and outputs; timeout and owned cancellation; dirty-Git and non-Git behavior; no stale-result claims.
- **Verification:** real commands on the Mac with recorded evidence; relevant working/reference boundary checks.
- **Limitations / non-goals:** unresolved command-boundary behavior stays a gap, never an unrestricted fallback.

### PLAN-M4 — GOAL: operations stay truthful across disconnect, service failure and reboot

- **CRITERIA references:** §6, §8
- **Current state / gap:** pending after M3; interruption evidence exists only for the file-recovery adapter.
- **Implementation:** owner fencing before reconciliation, immutable terminal results, UNKNOWN instead of guessing, no duplicate mutation.
- **Dependencies:** M3
- **Acceptance:** competing/expired/revoked controllers rejected; real crash, restart, reboot and wake behave as recorded; unrelated processes untouched.
- **Verification:** actual-host crash/restart/reboot runs.
- **Limitations / non-goals:** power-loss and failed-fsync durability remain unverified until separately tested.

### PLAN-M5 — GOAL: the complete Mac journey is accepted, including multiple independent projects

- **CRITERIA references:** §1–§8, §10
- **Current state / gap:** pending; the desktop lifecycle (saved setup, login startup, Dock UI, Pause/Resume/Quit) follows only after core Mac functions are verified.
- **Implementation:** installed artifact with signature identity, background lifecycle without Terminal, selected-plugin routing and control, non-Git local-only and hybrid flows.
- **Dependencies:** M2, M3, M4
- **Acceptance:** every required Mac criterion has current proof; no required Mac capability unresolved.
- **Verification:** fresh installed-artifact runs with source, artifact and toolchain identity recorded.
- **Limitations / non-goals:** Mac evidence does not certify Windows.

### PLAN-M6 — GOAL: the same tool groups and journey work on Windows

- **CRITERIA references:** §9 and §1–§8 on Windows
- **Current state / gap:** deliberately not started; no Windows feature work or native feasibility before M5 is accepted.
- **Implementation:** to be planned only after M5; needs its own Windows ACL, storage, process and package implementation.
- **Dependencies:** M5
- **Acceptance:** Windows-specific evidence per host; three-OS source CI is regression evidence only.
- **Verification:** actual Windows runs.
- **Limitations / non-goals:** skips are not native passes.

## Technical direction

TypeScript ESM on Node >=20, existing Swift helpers and Python guest tools; no new dependency or platform capability is presumed. The Linux VM worker stays optional and is removed from the connector if it fails in real use, per the 2026-10-19 rule. Original VM media stays untouched.

## Open Human questions

None required for steps 2–6 now. Domain or scope escalations (for example a path that would need the Endpoint Security entitlement) will be raised when they arise, not assumed.
