# ImageGen → Local Mac: direct file import

## Goal

Send original PNG, JPEG, or WebP bytes from a real ChatGPT-generated image directly into an already authorized macOS workspace through `gsa-lc-mac.import_image_file`. Verify bytes and SHA-256 after the write. A rendered preview in ChatGPT does not itself save a local file.

## Current mechanism (no extra plugin skill)

Since App-backed plugin **gsa-lc-mac v1.0.3 (2026-11-12)**, the obsolete `local-image-save` skill is deliberately **removed** from the plugin package and its source. The existing MCP tool `import_image_file` is the supported route; the ChatGPT host injects the genuine image into its `file` parameter via `_meta["openai/fileParams"]=["file"]`.

Do not introduce or invoke a separate Base64 image-saving skill, synthesize a placeholder, forge a file ID or URL, or assemble/copy an image's Base64 in the conversation. The existing `create_file_bytes` tool remains a general-purpose file operation, and internal byte encoding in `dispatchFileMutation` is an implementation detail, not a second ImageGen workflow.

## Operator procedure

1. Confirm `connector_status` and `list_workspaces`; reuse a verified writable workspace, with `fileBackendAvailable=true`, `fileWriteBackendAvailable=true`, and `fileGrantSyncState=CURRENT`. Do not rebind grants just to import an image.
2. Ensure the ChatGPT host provides a **real image artifact** and the callable `import_image_file` action. A standalone local/sandbox path or model-invented file ID is not the host's file parameter.
3. Acquire control, then call `import_image_file({workspace_id,path,file,control_token})` with the real host-provided `file` object. Use a new workspace-relative filename with an extension matching the source MIME. The native backend performs **exclusive create**, not overwrite.
4. Independently verify with `get_file_info` and `fetch_file_bytes`: source/import SHA-256, readback SHA-256, and byte lengths must all match. Release the control token in `finally`; a failed write or a missing file is never PASS.

## Security

- The importer accepts only temporary host-provided HTTPS file URLs from approved ChatGPT origins and **one-label Azure Blob Storage endpoints** matching `*.blob.core.windows.net`; it does **not** allow all of `*.windows.net`.
- No redirects, URL credentials, unexpected ports/fragments, local addresses or arbitrary model-supplied external URLs.
- Enforce the 8 MiB bound, check image signatures, MIME and extension, honor the current workspace grant and control lease, and write only through the signed native exclusive-create backend.
- Never disclose signed URLs, file tokens, raw Base64 or file bytes in logs or user-visible responses.
- If the app tool inventory has not refreshed, report `CATALOG_NOT_REFRESHED`; tool visibility and `tools/list` publication are distinct.

## Real macOS E2E acceptance — PASS (2026-11-12)

An actual ImageGen PNG artifact from a ChatGPT conversation was passed by the host to `import_image_file` and saved on macOS:

- Workspace: `/Users/nam/Desktop/Test`
- File: `imagegen-azure-blob-e2e-20261112.png`
- Format: `image/png`
- Original bytes and remote file size: **1,880,937**
- Importer's source SHA-256:
  `93b9bc7128539c9f89755724af5727ed90dd7f28e251f6d7a9b1bc96f40b13ff`
- Independent `get_file_info` and `fetch_file_bytes` returned the same SHA-256 and byte length; a second `get_file_info` after releasing the controller matched again.
- Runtime contained the approved Azure Blob origin restriction from source commit `cb7db2170832f5abb7d5428c6d29fbafd62109c3`.
- No manual/Base64 fallback was used by the ChatGPT agent.

**DIRECT_E2E_PASS** is verified for this real host-to-Mac transfer. Future file saves must still be individually verified; one successful import does not certify every client or workspace.

## Deployment

The app identity `asdk_app_6ad1a4b7fe8c8191a11f9b2354c818d9` and MCP tool `import_image_file` are unchanged. Plugin package v1.0.3 removes only the deprecated image-saving skill. Source and signed runtime updates are separate; do not treat a successful `git pull` or `install.sh doctor` alone as evidence that the exact updated runtime is active.
