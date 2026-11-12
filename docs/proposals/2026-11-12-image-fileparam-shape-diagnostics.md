# GSA-LC IMG-001 — Host file parameter shape diagnostics (Direct Agent)

## GOAL

Isolate the first missing or malformed ChatGPT-to-MCP file parameter boundary behind the live `INVALID_IMAGE_FILE` failure without accepting unsafe references or changing the user-approved original-PNG transfer behavior.

## Existing evidence

- Installed macOS runtime contains `FILEPARAM_UNRESOLVED` / `FILEPARAM_MISSING`; source CI G3 passed at `f9611e7`.
- Live ChatGPT tool inventory presents `file: string` even though MCP `tools/list` declares a top-level object with `download_url`, `file_id` and `_meta["openai/fileParams"]=["file"]`.
- A model-visible ImageGen file ID and a sandbox path both produced `INVALID_IMAGE_FILE` with the patched installed runtime, and the destination returned ENOENT.
- Official plugin reference confirms the existing object schema; the model-facing string need not equal the downstream server payload. Real host file injection is still UNVERIFIED.

## Scoped changes

- **MODIFY** `src/mcp/image-file-transfer.ts` — refine the input-only `source(value)` validation failure codes into a safe finite set: missing/null/non-object/array/empty/unresolved-ID/missing-field/unexpected-key/wrong-type/invalid-file-ID. No echoing unknown values, field names, URLs or tokens. Preserve required `download_url`/ `file_id` and origin, MIME, size, redirect and bytes validation. No arbitrary URL or local path input.
- **REUSE_AS_IS** `src/mcp/server.ts` — current `import_image_file` dispatch already validates workspace, controller, missing field, relative path, and native create-exclusive write; source exceptions pass through with finite code/message.
- **MODIFY** `test/image-file-transfer.test.ts` — test every malformed host input shape against a no-fetch stub, include positive object/byte digest control, and ensure no diagnostic leaks a token-like value.
- **MODIFY** `test/mcp-image-file-import.test.ts` — assert a representative null/incomplete file input returns a distinct code with zero downloads or writes; maintain existing success and readback oracle.
- **KEEP** `src/mcp/catalog.ts`, `_meta["openai/fileParams"]`, grants, signed native backend, and existing 8 MiB limit unchanged. No new dependency, plugin action, image quality conversion or Base64 fallback.

## Verification / acceptance

- Build: `npm run build` and source suites: `npm test` / hosted macOS C0 + G3 exact revision.
- Negative control: any raw model file ID, null or malformed file reference must not fetch a remote URL or create a local file.
- Positive control: a valid host-provided file object imports original PNG bytes unchanged with matching SHA-256.
- Real Mac E2E only PASS after the installed build receives a genuine ImageGen file object and file-info/fetch readback matches source bytes. Source/CI success is not real host handoff.
- Human-owned Mac install/restart, current authorization, and any host-side file injection gaps remain separate acceptance dependencies.
