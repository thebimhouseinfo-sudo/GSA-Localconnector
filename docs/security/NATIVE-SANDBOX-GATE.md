# Native shell/CI security gate — Windows and macOS

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
