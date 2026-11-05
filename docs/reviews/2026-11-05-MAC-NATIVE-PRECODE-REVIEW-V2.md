# GSA-Localconnector — Mac-native pre-code plan / milestone / technical review V2

Date: 2026-11-05. Scope: DOCUMENT REVIEW ONLY, before product implementation. Repository branch: `plan/mac-native-ci-vm-retirement-20261105`. Source tree and docs were read from this branch; a currently dirty Mac checkout was **not** inspected directly and no installed connector was touched.

## Authority and baseline

- Criteria: `docs/CRITERIA.md` (including 2026-10-31 §7 exception). VM freeze/retirement and GitHub-hosted macOS preinstall CI: 2026-11-05 human direction, `docs/DECISIONS.md`.
- Source paths examined via Git tree and docs: `src/mcp/*`, `src/core/native-io.ts`, `src/core/{process-manager,process-journal,git-engine}.ts`, `src/hosts/macos-* / native/macos-files/*`, `native/macos-desktop/*`, `.github/workflows/ci.yml`.
- Historical `docs/MAC-QWEN-HANDOFF.md` (2026-11-02) says the Mac fixture child physical-stop cleanup remains unverified. Treat current local state as requiring independent inspection.
- GitHub Actions PR #4 `28f96118588acf9e78c230c0870e514e8af42fa6`: hosted macOS workflow `42009660198` completed SUCCESS for its configured suite. This was **before V2 docs** and is not proof of native direct-host commands, installed plugin, Mac lifecycle, or later SHA.
- M2 is in progress; M3–M5 have no current accepted native integration evidence; M6 deferred. No GSA independent Critic/Reviewer V2 verdict was recorded.

## Review findings and disposition

| ID | Severity | Before | Correction | Check |
|---|---|---|---|---|
| F01 | BLOCKING to parallel dispatch | M3 hard-dependent on all M2 | Split short G0 interface gate from M2 full native acceptance; host-runner source and file backend parallel after G0 | Plan and Milestones DAG consistent |
| F02 | BLOCKING to VM work | Optional old VM still described as fallback | Freeze VM immediately; map imports; schedule complete separate deletion PR after Mac replacement evidence | Decisions + Plan + Milestones + Technical V2 |
| F03 | BLOCKING to actual-Mac install | Prior source CI could be mistaken for native/local proof | exact-SHA GitHub-hosted macOS pre-install gate then reviewed separate local installed-plugin proof | G3 → G4 |
| F04 | HIGH | No multi-agent file ownership | A(files), B(native command/Git), C(CI), D(desktop), E(VM inventory) separate branches; shared MCP files single integrator | Track matrix |
| F05 | HIGH | Contradictory old confinement requirements | Criteria §7 commands unconfined user account, API scoped; expose honest warnings and exact owned cancellation | Technical B/T0 |
| F06 | HIGH | Historic fixture/installer could be rerun with unsafe cleanup | Preserve prior dirty history; first fix child bounded lifetime and physical stop, never kill neighbor | M2-A1 precondition |
| F07 | HIGH | VM-only tests and new native proof conflated | Preserve history, exclude VM-required suites from Mac acceptance, require explicit missing-test classifications | CI-C1/C2 |
| F08 | HIGH | Source merges could conflict | Branch-owned files, serialized `src/mcp/*` final integration, every new SHA triggers CI | G0/G1/G2 |
| F09 | MEDIUM | Legacy sections still described optional VM and M3 serial sequence | Corrected current main Plan and Milestone statements; dated legacy detail only historical | 2026-11-05 V2 precedence |

## Independent-review readiness (not a Critic PASS)

Static self-review against Criteria scope, architecture, task DAG, interfaces, role overlap, native evidence, CI and deployment conditions found no new documented blocker to **issuing G0 pre-code task assignments**. This is not external independent review or proof of implementation feasibility. Open independent checks before implementing:
1. Check actual Mac repository dirty tree and unpublished branches; preserve work.
2. Inspect types/signatures in `src/core/native-io.ts` and `src/mcp/runtime-bootstrap.ts` and confirm minimal G0 contract.
3. Review actual runtime import graph before VM deletion or enabling a native host adapter.
4. Independently review B1 process group owned-cancel and §7 warning semantics, and A1 retained-FD/cleanup limits.
5. Ensure the hosted macOS workflow tests the exact candidate, and treat unexpected mandatory SKIPs as BLOCKED.

## Canonical dispatch and exit

Follow `docs/IMPLEMENTATION_PLAN.md` PRE-CODE REVIEW V2, `docs/MILESTONES.md` TASK DAG V2, `docs/TECHNICAL_PROPOSAL.md` V2. Wave 0 freezes shared interfaces; Wave 1 parallel A/B/C/D/E; Wave 2 serialized integration with hosted CI; Wave 3 real Mac after green CI, recovery/VM retirement and full M5 acceptance. No Windows before M5. Do not install locally or merge/deploy based on this review alone.

**Review outcome:** DOCUMENT CONSISTENCY PASS (self-review), INDEPENDENT CR NOT RECORDED, MAC CODE ACCEPTANCE NOT CLAIMED, LOCAL INSTALL NOT AUTHORIZED.
