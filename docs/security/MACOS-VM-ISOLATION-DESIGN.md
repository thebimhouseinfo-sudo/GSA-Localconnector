# macOS backend status and design boundary

This document describes source baseline d29be709 and the limits of historical native evidence. [CRITERIA.md](../CRITERIA.md) remains the required user model: actual working roots read/write/execute, optional references read/search only, no connector task gates, and no ungranted project access through descendants. A Linux build copy alone does not meet that model.

## Implemented snapshot path

`src/hosts/macos-vm-runtime.ts`, `native/macos-vm/WorkerHost.swift`, `native/macos-vm/SourceCapture.swift` and `native/macos-vm/guest_worker.py` implement a bounded Mac supervisor/Linux ARM64 guest path. The source configuration uses zero host shares and no guest network adapters. Descriptor-native source capture transfers bounded, hash-checked bytes through a private read-only NoCloud seed. A disposable cloned disk holds the guest working copy and a protected source reference.

The trusted supervisor owns configuration and the serial channel. Guest jobs run under a low-privilege identity and private cgroup. Install proof binds helper/worker/seed/image hashes and host release; `loadMacVmRuntime` rejects non-darwin/non-arm64 hosts and missing/tampered proof. `bootstrapMcpTools` adds controller checks and persisted root-identity/revision checks. These source facts are not independent evidence that every descendant/reference case of the new model has been enforced.

The supervisor discards guest changes. Production command results explicitly identify `linux-arm64-vm`, `disposable-snapshot` and `host_workspace_mutated:false`. Host file mutation is unwired; host Git is blocked. A Linux toolchain result is not a macOS SDK/GUI result. No VirtioFS share or host-edit synchronization is introduced by this planning revision.

## Evidence boundaries

The [2026-10-17 worker report](../reviews/2026-10-17-NATIVE-WORKER-INTEGRATION.md) records exact installed-artifact positive/denial tests, low-privilege/cgroup execution, timeout/output caps, clean stop/backpressure cleanup, and authenticated local HTTP MCP integration. The [earlier VM smoke report](../reviews/2026-10-16-OFFLINE-VM-SMOKE.md) records disposable-clone workloads and unchanged image digests. These are historical exact-revision results; they do not certify later source, installed artifact refresh, host toolchains or the full working/reference contract.

Cross-platform source CI passes are recorded in [STATUS.md](../STATUS.md). They compile and exercise fixtures; no actual VM boot, complete host sandbox or live-plugin proof follows from them. New artifact-transfer, owner/restart and packaging source needs integrated exact-artifact evidence before claiming the complete capability.

## Required next design work

1. Define working/reference scope identities, revisions, overlap handling and revocation across direct tools and descendants. The current read-only bind/separate execute enrollment is an implementation gap, not a product requirement.
2. Select a candidate that can support actual workspace mutations and required native Mac tools under the same outside-boundary restrictions. Treat each candidate's capabilities as hypotheses until positive and adversarial fixtures establish them.
3. Preserve fixed-operation host file brokerage as a separately verified boundary; its existence cannot justify arbitrary host shell or Git hooks/filters. Verify content conflicts, descriptor races, cross-root roles and recoverable deletion before composition.
4. Preserve immutable CI inputs and source/workflow provenance while providing the declared writable build tree and bounded generated artifacts. If a backend operates on a copy, report that explicitly and define any host transfer as a separate validated mutation.
5. Integrate durable process/output state, prior-owner fencing, cancellation/revocation and launch lifecycle. No automatic replay of uncertain mutations or old authority on reconnect.

Concrete proposed outcomes, dependencies and feasibility decisions are in the [implementation plan](../plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md) and [traceability matrix](../plans/CRITERIA-TRACEABILITY.md). A failed host candidate blocks required capabilities; it does not waive the native Mac requirement or replace it with an unlock prompt. Windows remains a separate target with its own native proof.

## Historical experiments retained as evidence

The earlier VirtioFS sharing design was a proposal and is superseded by the current zero-share snapshot path. The old pure `macos-vm-handshake` planner cannot confer execution authority by matching a nonce or claim. Restricted Seatbelt positive-control failure, Docker plans, QCOW2 inspection, raw conversion, EFI fallback and boot-only probes remain historical experiments described in source/history and review reports; they are not a checklist to restart while planning.

Preserve original RAW/candidate digests and disks. The obsolete image preparation/conversion, EFI/boot probes and shared-root policy/handshake prototypes were removed on 2026-10-19. Retained worker/install/runtime fixtures are not a new testing requirement: keep Linux optional, assess it during real-project use, and remove connector support if that use fails. Never download, reconvert, re-provision, attach writable original media, create host shares or change installation proof merely to continue this plan. A later approved experiment must specify disposable inputs, exact artifact identity, positive/negative expectations and cleanup.
