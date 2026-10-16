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
