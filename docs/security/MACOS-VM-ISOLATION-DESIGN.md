# GSA-Localconnector — macOS alternate execution isolation

Status: **OFFLINE SNAPSHOT BACKEND NATIVE-TESTED ON MACOS**. Full cross-platform security/release remains incomplete.

## Current implementation — 2026-10-17

The implemented worker uses **zero host shares**, superseding the earlier VirtioFS proposal below. Descriptor-native source capture transfers bounded, hash-checked project bytes through a private read-only NoCloud seed. A descriptor-cloned disposable disk contains the guest working copy and an immutable root-owned source reference. Root supervision owns the serial channel; jobs run as UID/GID 65534 with no-new-privileges and private cgroup v2 containment. The VM has no network adapters.

Protected installation proof binds the exact tested helpers, guest worker, seed builder, image hash and host kernel. The production MCP bootstrap additionally checks durable controller leases and workspace root identity/revision, including persisted revocation while jobs run. Guest changes are discarded and never written back to the host workspace. Host file/Git mutations and native macOS SDK workflows remain blocked.

Actual native evidence includes positive Python builds, forbidden sibling reads/writes, nested execution, protected source/configuration, credential sentinels, timeout/output limits, escaped descendant cleanup, normal shutdown and deliberate stdout-backpressure cleanup. Six authenticated HTTP MCP VM boots also verified pinned CI/rerun and active lease/grant revocation. See `../reviews/2026-10-17-NATIVE-WORKER-INTEGRATION.md`.

Restart recovery, general artifact export, dependency network access, startup lifecycle and Windows native enforcement are separate uncompleted gates. The following candidate notes are historical context where superseded by this implementation.

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

## EFI fallback boot-chain experiment (2026-10-16)

Actual MacBook offline inspection confirmed the pinned RAW contains ARM64 EFI loaders,
a matching `EFI/ubuntu/grub.cfg` UUID (`5b886046-3262-4eca-a390-4cd88779a3c7`,
partition 16), and a fallback `EFI/BOOT/BOOTAA64.EFI` whose SHA256 is identical
to `EFI/ubuntu/shimaa64.efi`. The fallback directory lacks both
`grubaa64.efi` and `grub.cfg`. **This is a plausible shim lookup failure,
NOT a confirmed diagnosis** without the exact graphical UEFI error lines.

The optional `scripts/prepare-arm64-efi-fallback-candidate.py --prepare` is a
development-only hypothesis test. It requires a pinned 3.5 GiB RAW source digest,
makes an APFS CoW clone using macOS `cp -c` into a private temporary directory,
fails closed if CoW is unsupported, validates FAT32 copies and bounds, and
duplicates the exact SHA256-pinned Ubuntu signed GRUB ARM64 binary and GRUB
bootstrap config into the **clone's** `EFI/BOOT` directory. It rereads both
patched files and checks their digests before publishing a separate candidate
RAW and JSON manifest without overwriting existing outputs. This does not mount
volumes or modify the baseline RAW. The candidate and its manifest are
**not production-trusted artifacts**, and preflight/image verification still
does not prove guest userspace or SEC01.

The VM boot smoke script accepts `--fallback-candidate` explicitly to select
only this manifest-pinned test image; default behavior still uses the original,
read-only RAW. Even if EFI/GRUB progresses, the test guest disk remains attached
read-only and Linux might fail to mount or operate a writable root filesystem.
No cloud-init provisioning, host network, host share, credential pass-through,
or connector shell/Git/CI permissions are enabled. Inspect graphical boot
results before proposing a writable guest data-layer design.

## Local writable-guest offline workload — 2026-10-16

Native evidence supersedes the older boot-pending status above: the read-only fallback candidate reached Linux/systemd, and the explicit `--offline-smoke` mode now completed an installed-tool workload on a disposable APFS clone. The verified open source descriptor is cloned with `fclonefileat`, rehashed, and only the clone is writable. A local read-only NoCloud seed (fresh nonce, local datasource mode) provisions no passwords, SSH keys, package downloads, network adapter or host share. It compiles/executes Python, checks nested processes, temporary root writes and loopback-only networking, and reports a matching result over hvc0. Both baseline image hashes were verified unchanged after the final native run; the VM stopped and discarded its scratch. A wrong-nonce native timeout test confirms failure and cleanup. Default and `--fallback-candidate` modes remain read-only.

This is a development-only guest workload result, not a verified execution backend, host share proof, trusted guest attestation or SEC01 certification. Next native gates are a bounded authenticated worker channel, project-input transfer/share containment, negative host sibling/symlink/secret/evidence controls and cancellation/recovery. See `docs/reviews/2026-10-16-OFFLINE-VM-SMOKE.md` for exact evidence and remaining limitations.
