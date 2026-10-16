import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHostAdapter } from "../src/hosts/index.js";
import { ConnectorError } from "../src/core/contracts.js";
import { WorkspaceRegistry } from "../src/core/workspace.js";

test("host adapters fail closed for unsupported platforms and shell/CI", () => {
  for (const host of ["win32", "darwin"] as const) {
    const c = createHostAdapter(host).capabilities;
    assert.equal(c.shellIsolation, "blocked");
    assert.equal(c.localCi, "blocked");
  }
  assert.throws(() => createHostAdapter("linux"), (e: unknown) => e instanceof ConnectorError && e.code === "UNSUPPORTED_PLATFORM");
});

test("workspace read resolver rejects traversal and symlink escapes", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "gsa-test-"));
  try {
    const root = path.join(base, "allowed"); const outside = path.join(base, "outside");
    await mkdir(root); await mkdir(outside);
    await writeFile(path.join(root, "good.txt"), "ok");
    await writeFile(path.join(outside, "secret.txt"), "private");
    const registry = new WorkspaceRegistry();
    await registry.enrollTrusted("a", root, ["read"]);
    assert.equal(await registry.resolveExistingRead("a", "good.txt"), path.join(root, "good.txt"));
    await assert.rejects(registry.resolveExistingRead("a", "../outside/secret.txt"), /Unsafe relative path/);
    await assert.rejects(registry.resolveExistingRead("a", path.join(outside, "secret.txt")), /workspace-relative/);
    try { await symlink(outside, path.join(root, "link"), process.platform === "win32" ? "junction" : "dir");
      await assert.rejects(registry.resolveExistingRead("a", "link/secret.txt"), /escapes workspace/);
    } catch (error) { if (process.platform !== "win32") throw error; }
    assert.equal(registry.requireGrant("a", "read").revision, 1);
    assert.throws(() => registry.requireGrant("a", "write"), /Permission not granted/);
    registry.revoke("a");
    assert.throws(() => registry.requireGrant("a", "read"), /Unknown workspace/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
