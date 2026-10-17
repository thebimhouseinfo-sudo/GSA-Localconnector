# Protected grant and controller storage

## Required model and implementation status

[CRITERIA.md](../CRITERIA.md) requires distinct working roots (read/write/execute, no per-tool approval) and explicit reference roots (read/search only, no mutation/execution or silent promotion). Persist scope identity/revision and revocation safely. Protect credentials, scope records and evidence from project code; storage protection is not a task approval flow.

Windows status-only behavior and legacy execution authorization below are implementation limitations, not the desired user workflow. This update changes no ACLs, grants, credentials or runtime enforcement.

macOS uses the POSIX storage backend: owner UID checks, private directory and file modes, regular-file and no-follow checks, exclusive mutation locks, and atomic durable replacement. Linux unit tests exercise these primitives with explicit temporary storage directories; this does not enable Linux as a connector host.

Windows ACL protection has not been implemented or verified. Unix permission bits and the absence of `process.getuid()` do not establish Windows DACL ownership or access protection.

On Windows the connector starts in status-only mode. It loads no persisted Workspace grants. Persistent enrollment, revocation, execution authorization, and controller acquisition/renewal/release return `SECURITY_BLOCKED` before creating protected state. `connector_status` and `list_capabilities` expose `protected_state_available: false` and the Windows ACL limitation. Existing unverified grant files remain untouched. Host execution and file mutation remain blocked.

POSIX storage tests are explicitly skipped on Windows. Windows-specific tests instead require status startup, an empty imported grant registry, blocked enrollment/controller operations, and no new state files. These tests do not certify Windows ACLs, native isolation, or command execution.
