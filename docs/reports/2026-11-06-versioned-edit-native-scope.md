# macOS native — non-destructive versioned text edit

## Purpose
Provide a usable text-edit workflow **without activating** the unqualified native recovery broker. This is **not** direct update, edit, move or delete.

## Operation
`edit_file_as_new_version` accepts `source_workspace_id`, `source_path`, `destination_workspace_id`, `destination_path`, `old_text`, `new_text` and `expected_sha256`. Controller lease is required. Source needs a read grant and destination a write/workspace grant. The BASE broker must support exclusive file creation.

- Enforces an exact SHA-256 precondition on the bounded (8 MiB) source snapshot.
- UTF-8 text decoding must succeed, the match must be nonempty and occur exactly once.
- Rechecks the source SHA-256 before publication; destination must be a distinct path.
- Uses qualified native exclusive-create; never invokes replace, trash or move.
- Reads back the new file and compares SHA-256. A failed verification after create returns `RESULT_UNKNOWN`, **does not retry**, and requires explicit user inspection.
- Source is unchanged by this operation. A concurrent edit after the second SHA check is not atomic with creation; output derives from the pinned snapshot, and no 'current source remains unchanged' guarantee is claimed.

## Security and boundaries
No native recovery activation, signed tree-reader activation, or directory-copy activation is changed. Source and destination native operations remain contained by already-installed verified BASE broker. The current source and destination must be bound grants. No overwrite, update, move, delete or transaction commit is implied by `committed:false`.

## Validation
Regression tests in `test/mcp-versioned-edit.test.ts`: valid unique edit with retained source and SHA match, SHA mismatch, nonunique match, destination conflict, native capability missing, uncertain post-create readback with single create and no retries. Exact-head GitHub macOS CI is required before merge. Real Mac testing follows installation by user.
