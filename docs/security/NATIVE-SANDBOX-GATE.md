# Native shell/CI security gate — Windows and macOS

## Current product meaning — 2026-10-17

[CRITERIA.md](../CRITERIA.md) governs design: working workspaces permit read/write/execute without connector approval gates; explicitly granted design/knowledge references permit read/search only, no mutation/execution; ungranted project data stays inaccessible. Enforce through tools and descendants. Approved system toolchains remain execution infrastructure.

“Gate” in this legacy filename means an engineering verification obligation, not a user permission unlock. The remaining candidate notes are historical observations, not product permission requirements. New native proof must include positive reference reads and rejected reference writes/execution, as well as workspace execution and outside-boundary denials.

Status: Docker candidate coded, NOT VERIFIED. Human environment decision and native security proof required.

## Required isolation
Workspace cwd, regex parsing and canonical paths cannot isolate subprocesses. Shell, Local CI, Git execution and write operations remain blocked until host enforcement is tested.

## Docker Desktop candidate
- Mount only the explicitly bound canonical Workspace at /workspace, not its parent or host home.
- Pinned image digest, pull=never, network=none, read-only root filesystem, cap-drop=ALL, no-new-privileges, unprivileged UID and bounded resource limits.
- No Docker socket or secrets/ambient credentials inside containers; runtime flags owned by trusted supervisor.
- Exact per-root bind mount, resource quotas, separately verified cancellation, protected evidence and snapshot store.
- See src/hosts/docker-sandbox.ts: it is an unverified candidate, not an active VerifiedNativeSandbox.

Reference: https://docs.docker.com/reference/cli/docker/container/run/

## Limitation and explicit choice
Docker Linux containers cannot run Windows-specific GUI/AutoCAD/Revit tooling or macOS-only native apps. Projects requiring those must use a separate, OS-native verified sandbox. Docker Desktop may not be installed; never assume.

## Human gate — environment detection only, no secrets
Windows PowerShell:
    docker version --format '{{.Server.Os}}/{{.Server.Arch}}'
    docker info --format '{{.OSType}}'
macOS Terminal:
    docker version --format '{{.Server.Os}}/{{.Server.Arch}}'
    docker info --format '{{.OSType}}'

If Docker is absent or daemon inaccessible, report the error; do not install blindly. No GSA tunnel restart or GPTWorker/CadGPT/RevitGPT changes needed.

Native gate requires forbidden sibling file read/write failures, nested shell escapes denied, host secrets and daemon socket unavailable, safe symlink handling, and legitimate compile/test/build inside bound Workspace. Static CI contracts do not certify OS sandbox PASS.

## macOS 26.6.2 host verdict — Seatbelt candidate is BLOCKED (2026-10-16)

Actual ARM64 MacBook repeatedly launched an `allow default` profile successfully, while the
deny-default **restricted file-read** profile aborted with `SIGABRT`, even when
the policy added `/dev`, `/private/etc`, `/private/var/db`, the combined paths,
or the broad `/private` tree. Broader write and network rules did not resolve this.
No read/write denial controls executed because the legitimate read positive-control
failed first. These runs establish **nonviability of this exact profile on this host**;
they do not prove the OS cannot implement any other native isolation mechanism.

**Decision:** do not widen filesystem allowances further, do not classify crash as a
security denial, and do not use `sandbox-exec` as the production execution substrate
without a new independently reviewed OS-native design. The candidate remains source-only,
`verified:false`. Shell, Git subprocesses and Local CI stay `SECURITY_BLOCKED`.

**Next design path:** prototype a separate native macOS worker with OS-supported
sandboxing/virtualization or a dedicated isolated account with OS-enforced deny semantics.
An account alone or POSIX permissions must not be mistaken for root isolation;
the worker must demonstrate SEC01 forbidden sibling/secret access, symlink and
nested-process escape denial, network control, and in-root SDK builds. Windows requires
a separate native worker and proof. Until then, keep file reads and planning tools
independent of native process execution.
