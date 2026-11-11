# BUG-FGR-01 — Coder pre-code proposal (2026-11-11)

## GOAL
Make the signed-file-grant mismatch directly diagnosable without weakening Mac native file authorization. Preserve fail-closed behavior while production signed recovery remains an explicit stopped-owner maintenance operation.

## Original trigger and evidence
- User rebinds `/Users/nam/Projects/Kid eschool/Ke-chinhta`; registry grants read/write/execute with revision 10.
- `connector_status` then shows `fileBackendAvailable=false`, `fileGrantSyncState=REQUIRES_SIGNED_REINSTALL`, `fileBlockedReason="Scoped file grant set changed"`; `create_file_bytes` returns only `SECURITY_BLOCKED`.
- `src/hosts/macos-scoped-files.ts` compares the active trusted registry with the installed, authenticated per-root grant list. A mismatch must fail closed.
- `src/mcp/runtime-bootstrap.ts` correctly invalidates the previous backend and attempts reload after successful `bind_workspaces`.
- `scripts/install-mac-scoped-files.mjs` already provides `verify-recovery-archive` and fenced `apply-recovery`. A previously qualified Mac27 archive was reported on the real host; this does not attest its present validity or authorize an owner-live reinstall.
- Prior Mac native acceptance on 2026-11-09 proves a recovery-enabled prior installation, not today's new grant set. The current error must not be mislabeled a Base64 decoder defect.

## Ownership and smallest bounded source edit
1. **MODIFY `src/mcp/server.ts`**: When and only when the backend is missing due to `Scoped file grant set changed`, return a precise, structured `FILE_GRANT_RECOVERY_REQUIRED` error for blocked mutating file operations. Include operation, `REQUIRES_SIGNED_REINSTALL`, stopped-owner qualified recovery action and `retryable_before_recovery=false`. Leave all other `SECURITY_BLOCKED` cases unchanged; do not leak secrets.
2. **MODIFY `test/mcp-file-backend-refresh.test.ts`**: Model the mismatched grant set after a successful bind and check both status and fail-closed binary write denial; simulate a verified refreshed backend only through the explicitly injected loader fixture, and confirm that normal unsupported operations remain denied.
3. **KEEP unchanged** signed installer, archive verifier, recovery code and granted workspace registry. Their existing protections must not be bypassed to make a PNG test pass.
4. **KEEP unchanged** `qualified_archive_status="UNVERIFIED"` until a real host check is performed; this field is not a checked assertion that the archive is invalid.

## Integration/verification
- Source branch: `main` (human continuation acknowledged; Project Memory branch policy readback verified).
- Confirm exact source HEAD and test file blobs before changes; preserve unrelated work.
- Hosted CI: run repository's macOS qualification workflow and inspect executed steps/logs. Local Node tests if an authorized source execution surface is available.
- Real host signed archive verification, owner fencing, `apply-recovery`, restart, PNG 1x1 write/readback and SHA-256 remain **CHƯA KIỂM** until the authorized host workflow executes. No alternate shell/file API is permitted to defeat the connector's blocked file backend.

## Goal recheck
The source change improves actionable diagnosis; **BUG-FGR-01 remains open** until the signed installation actually matches durable grants and the real Mac file backend resumes.