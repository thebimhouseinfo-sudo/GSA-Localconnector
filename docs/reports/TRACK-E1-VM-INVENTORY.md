# Track E1 — VM Dependency Inventory

## GOAL
Identify legacy product VM assets and their current shipping callers without executing or deleting VM components. E2 is prohibited until G4 proves installed native Mac replacement. Inventory baseline: branch `plan/mac-native-ci-vm-retirement-20261105`, HEAD `1cb77c271328bf20dd466875bda5c6575762fb90` (2026-11-05). Tree query `git/trees/<SHA>?recursive=1` returned 436 entries, `truncated=false`. This is a **source snapshot**, not installed-host proof.

## Authority
- `docs/CRITERIA.md` (APPROVED): run existing commands/scripts on the actual host; no new product VM or proprietary local CI/DAG orchestrator.
- `docs/DECISIONS.md`, 2026-11-05 supersession: freeze all VM development/repair/tests; remove integration only after proven native replacement; retain historical evidence and user media.
- `docs/IMPLEMENTATION_PLAN.md`, `docs/MILESTONES.md`, `docs/TECHNICAL_PROPOSAL.md`: E1 parallel read-only inventory, E2 after G4, separate reversible deletion PR and hosted macOS CI.
- `docs/reviews/2026-11-05-P0-SOURCE-SEAM-VM-AUDIT.md`: preliminary candidate inventory, not a final removal permission.

## Classification / disposition
| Class | Exact tracked assets or seam | Current evidence | E2 disposition |
|---|---|---|---|
| VM-exclusive source | `src/hosts/macos-vm-runtime.ts`; `src/hosts/macos-vm-ci.ts` | former defines `loadMacVmRuntime`, VM manifest/image and worker protocol; latter defines `MacVmCiExecutor` depending on `MacVmRuntime` | DELETE only when integration no longer imports/uses either |
| VM-exclusive native host/guest | `native/macos-vm/WorkerHost.swift`, `Virtualization.entitlements`, `guest_worker.py` | installer builds/signs host and seeds guest script | DELETE tracked code after independent native proof; no executing |
| Coupled source-capture | `native/macos-vm/SourceCapture.swift` | installed as `bin/source-capture`; **also** referenced by `scripts/test-native-source-capture.py` in current macOS CI | MIGRATE source-capture into native-owned path or replace fixture first. **DO NOT BLIND-DELETE** |
| VM install/bootstrap | `scripts/install-native-vm.mjs`; `scripts/prepare-vm-worker-seed.py` | installer writes `native-vm` installation, compiles WorkerHost/SourceCapture; seed prepares guest data ISO | DELETE after native route and source-capture migration |
| VM-only test scripts | `scripts/test-vm-guest-worker.py`, `scripts/test-vm-runtime-native.mjs`, `scripts/test-vm-worker-native.py`, `scripts/test-vm-worker-seed.py` | test guest/worker, native virtualization and installed VM runtime | DELETE tracked tests in E2; never run under E1 |
| VM-only test files | `test/macos-vm-artifacts.test.ts`, `test/macos-vm-runtime.test.ts`, `test/macos-vm-ci.test.ts` | direct imports of `macos-vm-*` | DELETE after equivalent native acceptance coverage; no existing E1 execution |
| Runtime composition | `src/mcp/runtime-bootstrap.ts` | imports `loadMacVmRuntime` L6, `MacVmCiExecutor` L8; constructs `native-vm` root L51, runtime L94, executor L96, dispatch L97, Linux metadata L122 | MODIFY by single integrator after A/B; retain native file + owner/control/process requirements |
| Public MCP exposed behavior | `src/mcp/server.ts`, `src/mcp/catalog.ts` | `server.ts` CiRunService/source-capture and ci_* handlers; status `linux-arm64-vm` L192; `catalog.ts` Linux snapshot description L44 | MODIFY carefully; preserve compatible actual host commands, process controls, truthful capability/status |
| Shared CI engine (not safely VM-exclusive) | `src/core/ci-dag.ts`, `ci-evidence.ts`, `ci-journal.ts`, `ci-manifest.ts`, `ci-run-service.ts`, `ci-scheduler.ts`, `ci-snapshot.ts`, `ci-source-capture.ts` | CI classes also imported by MCP server/services and unit tests, not just VM executor | REVIEW EACH exact consumer; product decision says no bespoke DAG; retain only useful command-status/log/artifact/recovery contracts or compatibility needed, not wildcard removal |
| Shared CI stores | `src/local/ci-artifacts.ts`, `ci-log-store.ts`, `ci-snapshot-store.ts`, `ci-store.ts`, `ci-working-copy.ts` | first four imported directly by server/bootstrap; `ci-working-copy` references `CiSnapshotStore` and may be test-only; presence alone is insufficient deletion proof | DECIDE per module after native architecture and consumers are traced; preserve user state/schema/readback |
| Shared process/file framework | `src/core/native-io.ts`, `process-manager.ts`, `durable-process.ts`, `process-journal.ts`; `src/local/process-store.ts`; `src/hosts/macos-scoped-files.ts`, `macos-directory-*.ts`; `src/local/mac-owner.ts` | runtime, server and native host paths use process/native interfaces and owner fence | RETAIN for A/B integration; legacy interface names do not imply VM confinement |
| CI workflow | `.github/workflows/ci.yml` | `macos-latest`, build, non-VM suites (excludes `macos-vm-*`) AND native Swift source-capture fixture | MODIFY only by C owner at integration/E2: remove stale VM-specific assumptions, preserve/replace useful capture test |
| History | `docs/security/MACOS-VM-ISOLATION-DESIGN.md`, `docs/reviews/2026-10-16-OFFLINE-VM-SMOKE.md`, `docs/superpowers/plans/*vm*`, archived technical proposals and earlier reports | documentary records, not active authority | RETAIN unchanged, mark historical by newer docs; no mass deletion |
| External user media | `~/.../images/*.raw`, guest images/ISO, Mac27 retained archives, saved grants/keys, installed connector state, run logs | installer references `images/ubuntu-24.04-arm64-efi-fallback-candidate.raw`; **local existence/ownership not inspected** | ABSOLUTE NO DELETE/ALTER, including scripts, cleanup commands or CI. User-held artifacts remain outside E2 |

## Operational prohibitions
No VM compile, smoke, provisioning, QEMU, guest boot, installer repair, VM test or user-machine inspection performed. Do not reinterpret source tree evidence as native Mac acceptance. Do not touch existing dirty/unpushed local checkout. Dynamic imports, built dist artifacts, user-local configuration and future concurrent A/B/C/D changes require re-scan at E2's exact candidate SHA.

## Findings / unresolved verification
- **E1-F01 (blocking E2, not E1):** `SourceCapture.swift` and `scripts/test-native-source-capture.py` are still bound to VM directory despite non-VM CI; migrate/replace safely before deletion.
- **E1-F02 (blocking E2):** production bootstrap imports VM runtime/CI, advertises guest semantics; native replacement/G4 proof absent at E1.
- **E1-F03 (E2 classification work):** shared CI services/stores are partly exposed via MCP; no automatic file-level deletion decision without reconciled consumers and state retention.
