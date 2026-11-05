# Track E1 — VM Dependency Map (actual caller → callee)

## GOAL
Freeze evidence-backed runtime, test and packaging edges at source HEAD `1cb77c271328bf20dd466875bda5c6575762fb90`. Every arrow below is supported by a named import/reference in the corresponding tracked file. Absence of a listed edge is **not** proof of global absence.

## Production graph
| Actual caller → callee | Classification | Evidence path / location | Action owner |
|---|---|---|---|
| `src/mcp/cli.ts` → `src/mcp/runtime-bootstrap.ts:bootstrapMcpTools` | stdio production entry | `src/mcp/cli.ts:4,14` | integrator |
| `src/mcp/http-cli.ts` → `src/mcp/http.ts:startHttpMcp` → `src/mcp/runtime-bootstrap.ts:bootstrapMcpTools` | **HTTP production entry; Mac branch**, previously omitted | `src/mcp/http-cli.ts:1`; `src/mcp/http.ts:7,119,123` | integrator |
| `src/mcp/runtime-bootstrap.ts` → `src/hosts/macos-vm-runtime.ts:loadMacVmRuntime` | **ACTIVE VM** | `src/mcp/runtime-bootstrap.ts:6,69,94` | integrator E2 only after G4 |
| `src/mcp/runtime-bootstrap.ts` → `src/hosts/macos-vm-ci.ts:MacVmCiExecutor` | **ACTIVE VM CI** | `src/mcp/runtime-bootstrap.ts:8,96` | integrator |
| `src/mcp/runtime-bootstrap.ts` → `src/mcp/server.ts:createReadOnlyTools` | shared service | `src/mcp/runtime-bootstrap.ts:20,97` | integrator retain |
| `src/mcp/runtime-bootstrap.ts` → `src/hosts/macos-scoped-files.ts:loadMacScopedFiles` | shared native file | `src/mcp/runtime-bootstrap.ts:7,81` | A/integrator retain |
| `src/mcp/runtime-bootstrap.ts` → `src/hosts/macos-directory-installation.ts:loadCheckedMacDirectoryInstallation` | shared native directory | `src/mcp/runtime-bootstrap.ts:2` | A/integrator retain |
| `src/mcp/runtime-bootstrap.ts` → `src/local/ci-{store,snapshot-store,log-store,artifacts}.ts` | shared CI persistence in active bootstrap | `src/mcp/runtime-bootstrap.ts:13,15-17,54-57` | integrator/E2 classify |
| `src/mcp/runtime-bootstrap.ts` → `src/local/process-store.ts`, `control-lease.ts`, `mac-owner.ts` | shared safe ownership | `src/mcp/runtime-bootstrap.ts:12,14,19,68` | B/integrator retain |
| `src/mcp/server.ts` → `src/core/ci-{dag,manifest,source-capture,run-service}.ts` | public CI consumers | `src/mcp/server.ts:16-17,24-25,151-153,274-352` | integrator/E2 reevaluate |
| `src/mcp/server.ts` → `src/local/ci-{store,artifacts,log-store,snapshot-store}.ts` | public CI persistence consumers | `src/mcp/server.ts:20-23,277-324` | integrator/E2 reevaluate |
| `src/mcp/server.ts` → `src/core/{process-manager,durable-process,git-engine,native-io}.ts` | non-VM reusable command/Git | `src/mcp/server.ts:26-28,31` | B/integrator retain |
| `src/mcp/server.ts` → `src/mcp/catalog.ts` | capability schema includes VM wording | `src/mcp/server.ts:15`; `src/mcp/catalog.ts:44,62-72` | integrator |
| `src/hosts/macos-vm-ci.ts` → `src/hosts/macos-vm-runtime.ts:MacVmRuntime` | **VM exclusive** | `src/hosts/macos-vm-ci.ts:10,27,31` | E2 |
| `src/hosts/macos-vm-ci.ts` → `src/core/ci-{dag,manifest,snapshot,journal,run-service}.ts` | shared library reached from VM | `src/hosts/macos-vm-ci.ts:2-6` | inspect per consumer |
| `src/hosts/macos-vm-ci.ts` → `src/local/ci-{snapshot-store,log-store,artifacts}.ts` | shared store reached from VM | `src/hosts/macos-vm-ci.ts:7-9` | inspect per consumer |
| `src/hosts/macos-vm-runtime.ts` → `src/core/ci-dag.ts` / `ci-source-capture.ts` / `native-io.ts` | VM host using shared interfaces | `src/hosts/macos-vm-runtime.ts:1,12-13` | E2 retain shared |
| `src/core/ci-run-service.ts` → `ci-journal.ts`, `ci-manifest.ts`, `ci-source-capture.ts`, `../local/ci-store.ts`, `ci-snapshot-store.ts` | shared CI internals | `src/core/ci-run-service.ts:1-9` | reevaluate |
| `src/core/ci-source-capture.ts` → `ci-snapshot.ts`, `ci-journal.ts`, local snapshots/journal | shared immutable input | `src/core/ci-source-capture.ts:1-5` | reevaluate |
| `src/core/ci-scheduler.ts` → `ci-evidence.ts`, `ci-journal.ts`, `ci-dag.ts`, `native-io.ts` | optional old DAG scheduler; not established production entry | `src/core/ci-scheduler.ts:1-10` | E2 classify after broad search |
| `src/local/ci-working-copy.ts` → `src/local/ci-snapshot-store.ts` | working-copy helper; current runtime caller **not verified** | `src/local/ci-working-copy.ts:5,27` | E2 search/decide |
| `src/local/ci-snapshot-store.ts` → `src/core/ci-snapshot.ts` | shared snapshot hash | `src/local/ci-snapshot-store.ts:6` | E2 reevaluate |
| `src/local/ci-store.ts` → `src/core/ci-dag.ts`, `ci-journal.ts` and local snapshot store | shared journal | `src/local/ci-store.ts:2,7-8` | E2 reevaluate |

## Installer, VM test and workflow graph
| Actual caller → callee | Classification | Evidence path | Action |
|---|---|---|---|
| `scripts/install-native-vm.mjs` → `native/macos-vm/WorkerHost.swift`, `Virtualization.entitlements`, `SourceCapture.swift` | VM installer compile/sign | `scripts/install-native-vm.mjs:64-67` | E2 after native proof |
| `scripts/install-native-vm.mjs` → `native/macos-vm/guest_worker.py`, `scripts/prepare-vm-worker-seed.py`, `test-vm-guest-worker.py`, `test-vm-worker-native.py` | VM installer seed/test | `scripts/install-native-vm.mjs:60-76` | E2 |
| `scripts/prepare-vm-worker-seed.py` → `native/macos-vm/guest_worker.py`, `scripts/test-vm-guest-worker.py` | guest seed | `scripts/prepare-vm-worker-seed.py:27,40-43` | E2 |
| `scripts/test-vm-worker-native.py` → `WorkerHost.swift`, `Virtualization.entitlements`, `SourceCapture.swift`, `prepare-vm-worker-seed.py` | VM test | `scripts/test-vm-worker-native.py:14-20` | E2 |
| `scripts/test-vm-runtime-native.mjs` → `dist/src/mcp/runtime-bootstrap.js` | installed VM integration fixture | `scripts/test-vm-runtime-native.mjs:12,15,28` | E2 |
| `test/macos-vm-runtime.test.ts` → `src/hosts/macos-vm-runtime.ts` | VM unit | `test/macos-vm-runtime.test.ts:8` | E2 |
| `test/macos-vm-ci.test.ts` → `src/hosts/macos-vm-ci.ts`, runtime type | VM unit | `test/macos-vm-ci.test.ts:8,13` | E2 |
| `test/macos-vm-artifacts.test.ts` → `src/hosts/macos-vm-runtime.ts` | VM unit with shared helper assertions | `test/macos-vm-artifacts.test.ts:4-6` | migrate useful helper assertions to non-VM tests |
| `.github/workflows/ci.yml` → `dist/test/*.test.js` EXCLUDING `macos-vm-*` | non-VM test selection | `.github/workflows/ci.yml`, Run non-VM source tests | C |
| `.github/workflows/ci.yml` → `scripts/test-native-source-capture.py` → `native/macos-vm/SourceCapture.swift` | **NON-VM CI STILL VM-PATH-COUPLED** | workflow last step; `scripts/test-native-source-capture.py:20` | C plus E2 migrate fixture |
| `test/runtime-bootstrap.test.ts` → `src/mcp/runtime-bootstrap.ts` | shared regression, VM absence assumptions | `test/runtime-bootstrap.test.ts:8,15-21,46` | integrator migrate expectations |
| `src/mcp/cli.ts` → bootstrap and `src/mcp/http-cli.ts` → `src/mcp/http.ts` → bootstrap on macOS | **both entry routes verified** | `src/mcp/cli.ts:4,14`; `src/mcp/http-cli.ts:1`; `src/mcp/http.ts:7,119,123` | keep both routes in E2 post-integration static gates |

## Classification rule and coverage bounds
Direct edges are observed import/reference pairs, not speculative linkage. No full AST-based repository-wide import closure was executed; GitHub recursive tree and targeted source reads were performed. At E2 take exact candidate HEAD after A/B/C/D integration, run static import/reference graph over `src/**`, `scripts/**`, `test/**`, `.github/**`, `native/**`, `package.json`, and inspect JS dynamic `import()`, `require`, subprocess invocations and generated files. Record **zero product VM paths/callers**, preserving historical docs as deliberate exceptions. Newly introduced graph edges invalidate this snapshot.

## Post-E1 branch reconciliation (2026-11-05)
Later branch head `2affed17e556d7436efb8170d1bfaa9f301abb73` was independently inspected, with 467 recursive tree nodes (`truncated=false`). `src/mcp/runtime-bootstrap.ts` continued importing the VM runtime and CI executor, while `.github/workflows/ci.yml` had acquired C-A/C-B/C-G3 required steps and still called the source-capture fixture. E1's original source pins remain authoritative for its **snapshot**; these newer branch observations do not establish G4 or authorize E2. This updated map explicitly verifies the previously uncertain HTTP entry. Recompute all paths at the actual E2 candidate head, because multiple tracks concurrently write this branch.
