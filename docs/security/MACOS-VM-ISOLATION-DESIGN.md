# GSA-Localconnector — macOS alternate execution isolation

Status: **DESIGN CANDIDATE ONLY**. No executable or security approval.

## Decision
The production-restricted Seatbelt candidate SIGABRTs on the actual macOS 26.6.2 arm64 host; static profile changes and widened read paths did not make the legitimate /bin/cat read work. The replacement candidate is a separately signed Swift worker built on Apple's Virtualization.framework, with an **ARM64 Linux guest**. This permits portable build tools, not native macOS GUI programs or host Swift/Xcode-only workflows. A macOS guest would be a separate, significantly heavier design and is not included here. Apple's framework is documented at https://developer.apple.com/documentation/virtualization.

## Supervisor/guest boundary

1. GSA chooses one of the bound macOS Workspaces. Localconnector checks a trusted read/execute grant, stable lease and host identity.
2. Trusted macOS supervisor resolves the canonical root and constructs `planMacVmPolicy()`. This plan has `verified:false`, `executable:false` and grants no right to spawn a process.
3. Future notarized/signed Swift helper must validate the plan **again**, verify root identity against symlink/rename attacks, configure a Linux ARM64 VM, expose only the one authorized root through an explicitly verified VirtioFS directory share, no other host directories.
4. No virtual network device, no host socket path, no USB, no clipboard integration, and no ambient ChatGPT/OpenAI credentials in the guest. Guest OS installation/image integrity, persistent storage, image hash pins and updates must be independently reviewed.
5. Guest-side execution worker accepts allowlisted argv requests over one authenticated, bounded channel; toolchains execute inside the VM and the supervisor retains cancellation authority.
6. Filesystem operations from ChatGPT outside that VM still need an OS-native handle-relative path backend. VM isolation does **not** make Node pathname writes safe.
7. Guest build runs write into an isolated scratch copy where possible. Captured source manifest, hash evidence, logs and artifacts remain supervisor-owned, never guest-writable.
8. On crash/restart, the connector records UNKNOWN rather than declaring PASS; all stale guest processes/VMs must be stopped or fenced before new execution.

## Required native security proof (SEC01)
- Valid build/test inside the guest succeeds and has bounded CPU/memory/wall time.
- Reading and writing a sibling host directory, secrets, SSH keys, connector credentials and protected journal is impossible from the guest.
- Symlink outside the mounted Workspace cannot expose host siblings.
- Guest nested shell/processes inherit the same restrictions.
- DNS/socket/network attempts fail (no network adapter).
- Guest cannot get host OS privileges through shared folders, device mounts, sockets or helper API.
- Cancellation terminates the entire guest process tree; stale leases and reconnects cannot reuse an old VM.
- Exact install build and signed native helper are tested on the actual macOS ARM64 host.

## Hard gates
- Native Swift worker not implemented or signed.
- VM guest image not selected/provisioned; no download or installer without user approval.
- Virtualization entitlement, framework support, resource constraints, image lifecycle and Windows independent isolation remain unverified.
- `MACOS_SEATBELT_HOST_VERDICT` stays BLOCKED.
- `requireMacIsolationProof` always throws SECURITY_BLOCKED. No process/Git/Local CI permission is enabled by this design.

The existing Docker candidate is optional and separate; Docker Linux containers also cannot execute native macOS binaries.

## Worker protocol v1 — fail-closed handshake

Pure, unprivileged host contract is implemented in `src/hosts/macos-vm-handshake.ts`.
Before considering any worker data, a host-issued `boot_nonce` (64 lowercase hex)
and a workspace-specific policy fingerprint must match the worker claim;
the claim also states exactly one share, zero network devices, zero host socket
devices, ARM64 guest and READY state. A mismatch is `SECURITY_BLOCKED`.
Even a match returns `security_verified:false` and
`execution_authorized:false`: an untrusted worker claim cannot prove isolation,
root identity, image provenance or authority to execute. Native code-signature,
guest filesystem and process tests are still a hard gate.

This is not a functioning VM worker or a communications channel. A future
signed Swift worker must receive a freshly generated challenge from a trusted
host supervisor and prove actual VM measurements, host share controls, and
revocation independently. Never accept a user-provided nonce as host authority.

## User-approved image preparation (2026-10-16)

Human approved downloading/preparing a Linux ARM64 guest image **for the test project**.
Implementation: `scripts/prepare-ubuntu-arm64-image.mjs` is an explicit opt-in command on the
user's Mac (not run by the connector), downloads from Canonical's official Ubuntu 24.04
release endpoint over HTTPS, reads its contemporaneous SHA256SUMS, streams and verifies
the image into the connector-owned directory using no overwrite. No VM boot or system
install, login, entitlement, network bridge or privileged action occurs.

**Image format warning:** `ubuntu-24.04-server-cloudimg-arm64.img` is an Ubuntu cloud image
and must NOT be treated as a verified raw disk compatible with the earlier
`gsa-linux-arm64-raw-v1` manifest. Acquisition writes a separate
`gsa-linux-arm64-cloudimg-qcow2-candidate-v1` manifest marked
`boot_ready:false`; later image format validation/conversion, kernel/initramfs
(or verified EFI boot configuration), guest console/bootstrap, and SEC01 remain to do.
The release alias can change; provenance is HTTPS + downloaded SHA256SUMS, *not* an
independent signature verification or immutable distribution pin.

## Host image inspection PASS and offline RAW conversion gate — 2026-10-16

Actual MacBook verified the Canonical image checksum and recognized QCOW2 **v3**,
3,758,096,384-byte virtual disk, no backing file and no external data file.
This is not directly attachable to the current Apple VZ raw disk configuration.

Added `scripts/convert-ubuntu-arm64-image.mjs` for an explicitly invoked copy
conversion, using an already-installed Homebrew `qemu-img` at
`/opt/homebrew/bin/qemu-img`. It first checks the *exact* approved source digest,
file size, QCOW2 header and `qemu-img info` (rejects backing, external or encrypted
layout). It refuses overwrites and emits a separate RAW image plus manifest,
including the destination SHA256; it never modifies the source, boots a VM or
changes connector permissions. No `brew install` is performed by the script.
**Residual risk:** path-to-file races remain before qemu-img opens the source
and must be resolved for a production trusted conversion pipeline.
Raw output is `boot_ready:false`; Linux boot/kernel/EFI support and SEC01 are
separate gates.

**Human prerequisite:** MacBook must have `qemu-img` available. If missing,
stop and request explicit installation approval rather than installing tools
silently. CI syntax checks the converter but does not run a real conversion
or prove QEMU isolation.

## Bounded EFI VM boot probe — 2026-10-16 (experimental)
`native/macos-vm/BootProbe.swift` is an explicitly invoked, DEVELOPMENT-ONLY boot experiment. It validates the expected RAW bytes and SHA256 again, sets disposable EFI variable store, a 2-CPU/2-GiB VM, read-only disk, file-backed serial console, zero network adapters and zero directory shares. It requests VM stop after a 10–180 second observation window. The serial excerpt is untrusted guest data.
A VM start callback returning success is **not proof the Ubuntu guest reached Linux userspace**, and reporting `VM_STARTED_UNVERIFIED` does NOT certify guest boot, root confinement, persistent machine state, immutable image attachment or SEC01. The disk attachment API reopens a pathname after hashing; TOCTOU risk remains. Guest boot may fail when a read-only Ubuntu cloud image needs writable storage or EFI boot files are absent. This experiment is NEVER run in CI and is NEVER dispatched by connector shell tools; CI compiles/signs it only. Production worker must use a separately reviewed isolation and image lifecycle design.
