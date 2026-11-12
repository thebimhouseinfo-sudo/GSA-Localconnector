# Local Image Asset Transfer — gsa-lc-mac

## Goal

When the user explicitly asks GPT to create/edit an image and store it in an authorized Mac folder, the agent should transfer **actual image bytes**, write once through the signed workspace file backend, read back the file, and compare digests before reporting success. Rendering an image in chat does not save it on the Mac.

## Architecture

1. The **ChatGPT image generation** surface produces an image file. It must be accessible as a real file; a preview, sandbox pathname, or invented file ID is not an export.
2. The **gsa-lc-mac plugin Skill** `local-image-save` instructs the model to use a previously enrolled writable workspace, avoid repeated binding, and use file import when the host supports it.
3. The new MCP tool **`import_image_file`** advertises `_meta["openai/fileParams"] = ["file"]`. ChatGPT supplies the actual file parameter, with `download_url` + `file_id` and optional MIME/name, **when that artifact is exposed to the connector by the host**. The tool never accepts an arbitrary public URL in place of that file input.
4. The bounded `src/mcp/image-file-transfer.ts` helper verifies a trusted HTTPS content origin, avoids redirects, reads at most 8 MiB, checks PNG/JPEG/WebP magic bytes, matches file type to extension, and creates no new workspace grant. URL/transport secrets are omitted from errors. The user approved additional Azure Blob Storage origins after a live fileParam yielded `host_suffix: windows.net`: only a **single storage-account subdomain** of `*.blob.core.windows.net` is permitted, not `*.windows.net` generally. The URL remains host-supplied, HTTPS-only, redirect-free, and is never accepted from arbitrary model-provided URLs. Unknown domains still fail closed.
5. The MCP dispatcher requires the **current controller lease** and an already verified writable workspace. It sends the unchanged bytes through existing `dispatchFileMutation("create_file_bytes")` and the **signed native exclusive-create** backend. It never uses local shell or unrestricted filesystem access.
6. The agent performs independent `get_file_info` + `fetch_file_bytes` and compares stored SHA-256/byte count with the source digest before reporting PASS.

## Required tools

`connector_status`, `list_workspaces`, `list_capabilities`, `acquire_control`, `import_image_file`, `get_file_info`, `fetch_file_bytes`, `release_control`.

For legacy versions, `create_file_bytes` accepts original canonical Base64 if and **only if the complete original image bytes can be read by the agent and passed in a real tool call**. The image-generation result is not automatically a Base64 string and may not be available to a generic tool in every ChatGPT host. No fake success, no silent image resize, no loss of original file quality.

Example conceptual tool call (host, not the model, supplies `file`):

```json
{
  "name": "import_image_file",
  "arguments": {
    "workspace_id": "<existing-writable-workspace-id>",
    "path": "assets/generated-scene.png",
    "file": {
      "file_id": "<host-provided-file-id>",
      "download_url": "<host-provided-temporary-HTTPS-URL>",
      "mime_type": "image/png",
      "file_name": "generated-scene.png"
    },
    "control_token": "<current-controller-token>"
  }
}
```

Placeholders are documentation only. Never invent these source fields or expose their values in the final user response.

## Security, limits and failure handling

- `import_image_file` is an **exclusive create** operation only. Existing destinations cause a conflict. Updating an asset requires an explicit separate hash-guarded version-update flow.
- Filename is relative to the enrolled root; never include `/Users/...` in the `path` argument. Reject path traversal and reserved workspace paths.
- `REQUIRES_SIGNED_REINSTALL` / `FILE_GRANT_RECOVERY_REQUIRED`: do not fetch/import. The user must safely stop owner and install verified signed Recovery; registry binding alone is insufficient. No automatic rebind for already enrolled folders.
- Reject unknown/unsigned file input, unapproved download domains, non-HTTPS, redirects, oversize content, invalid image bytes, MIME/extension mismatch and unattested writes.
- Full binary transfer from a newly generated ImageGen artifact **requires ChatGPT to expose the artifact via file params**. Source compilation and mocked fetch tests do not prove that particular ChatGPT host path works. Real Mac acceptance requires a fresh generated image import and independent readback.
- The file backend's 8 MiB limit applies. Do not lower image quality or discard metadata without instruction.
- Maintain existing owner/control, signed file transactions, process recovery and grant security. No new VM, Git network access, arbitrary URL importer or background task is introduced.

## Deployment and acceptance

The **existing gsa-lc-mac App-backed plugin** includes the `local-image-save` Skill (package 1.0.1), preserving the original App ID. Source tool `import_image_file` must be built, installed on the user's Mac and the ChatGPT tool catalog refreshed before it can be called. The Skill can be present even while that new server tool is not yet deployed.

Required evidence: (1) plugin source readback has Skill; (2) TypeScript build + focused/macos CI tests pass; (3) real Mac `fileGrantSyncState=CURRENT`; (4) host-exposed ImageGen image is accepted via `import_image_file`; (5) `get_file_info` and `fetch_file_bytes` match the exact original SHA-256 and file length. Keep any untested step `PENDING` instead of PASS.

## App tool discovery is separate from backend capability

A live macOS connector can report `import_image_file` in `list_capabilities()` even when an already connected ChatGPT app still exposes an older, approved `tools/list` snapshot. This is a **CATALOG_NOT_REFRESHED** condition, not proof the importer is broken. Direct image import is the preferred route, not Base64.

**Supported refresh (user/admin-controlled):** For a directly connected development MCP app, open the connection in ChatGPT **Settings → Plugins**, use **Refresh** to reload available tool definitions, and start a new chat with that app selected. For a published plugin, go to its **MCPs → connected server → Issues → Rescan** (or the applicable workspace admin **Refresh/Action control** flow), review findings and enable approved new actions. Exact UI and privileges vary by account; do not force-delete/recreate app identity or bypass reviews. A Skill package update alone does not refresh the app action snapshot.

### E2E evidence thresholds

- `SERVER_TOOL_LIST_PASS`: authenticated MCP HTTP `tools/list` returns `import_image_file` with all four file properties and `_meta.openai/fileParams=["file"]`; proves server publication only.
- `CHATGPT_TOOL_EXPOSED`: callable `import_image_file` genuinely appears in the model-facing app actions in a new chat after refresh.
- `HOST_FILEPARAM_PASS`: ImageGen creates a real file and ChatGPT supplies its file input to that tool; a forged `file_id` or URL does not qualify.
- `MAC_FILE_READBACK_PASS`: native exclusive creation succeeds; info/fetch match original SHA and bytes. Only all four qualify as **DIRECT_E2E_PASS**.

If the backend advertises the importer but the ChatGPT action inventory lacks it, mark `CATALOG_NOT_REFRESHED` and attempt supported refresh; do not immediately use Base64. Only after a real host-mediated import attempt fails due to fileParam unavailability, or a verified unrefreshable catalog gap in the current client, may `create_file_bytes` be used with independently available exact original bytes. Mark that as `BASE64_FALLBACK`, never `DIRECT_E2E_PASS`. If bytes are inaccessible, report BLOCKED.
