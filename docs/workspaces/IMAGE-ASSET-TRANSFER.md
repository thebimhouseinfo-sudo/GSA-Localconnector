# Local Image Asset Transfer — gsa-lc-mac

## Goal

When the user explicitly asks GPT to create/edit an image and store it in an authorized Mac folder, the agent should transfer **actual image bytes**, write once through the signed workspace file backend, read back the file, and compare digests before reporting success. Rendering an image in chat does not save it on the Mac.

## Architecture

1. The **ChatGPT image generation** surface produces an image file. It must be accessible as a real file; a preview, sandbox pathname, or invented file ID is not an export.
2. The **gsa-lc-mac plugin Skill** `local-image-save` instructs the model to use a previously enrolled writable workspace, avoid repeated binding, and use file import when the host supports it.
3. The new MCP tool **`import_image_file`** advertises `_meta["openai/fileParams"] = ["file"]`. ChatGPT supplies the actual file parameter, with `download_url` + `file_id` and optional MIME/name, **when that artifact is exposed to the connector by the host**. The tool never accepts an arbitrary public URL in place of that file input.
4. The bounded `src/mcp/image-file-transfer.ts` helper verifies a trusted HTTPS content origin, avoids redirects, reads at most 8 MiB, checks PNG/JPEG/WebP magic bytes, matches file type to extension, and creates no new workspace grant. URL/transport secrets are omitted from errors. An unrecognized host domain is a hard stop; review host evidence before adding any origin to the allowlist.
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
