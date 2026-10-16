# GSA-Localconnector — Architecture and Implementation Plan

## GOAL

Build **GSA-Localconnector**, a standalone Windows **Local MCP Connector** for GSA, by reusing proven local execution code from [chatgpt-local-worker](https://github.com/thebimhouseinfo-sudo/chatgpt-local-worker) and adopting the machine-first MCP-tool ergonomics of GitHub Connector.

GSA must be able to read, edit, patch, search, run terminal commands, inspect processes, build, test, and use local Git across **multiple explicitly authorized folders simultaneously**. The connector has **no Job Pack, Builder, Planner, Coder, fake CLI, or local Job lifecycle**. GSA alone owns reasoning, Project/Job/Task/Run, review and test decisions; its existing private online GitHub Memory Repo remains the durable control plane.

**Scope of this document:** architectural baseline, two-repository implementation/migration plan, exact acceptance criteria. **No source implementation has been performed by writing this plan.**

**Reviewed source baselines:** GPTWorker `thebimhouseinfo-sudo/chatgpt-local-worker` and GSA `thebimhouseinfo-sudo/GPT-supper-agent` on their default branches, investigated 2026-10-16. Re-check exact SHAs, interfaces and callers before coding.

## 1. Decisions — approved design direction

1. This is a **new repository/application**, `GSA-Localconnector`; do **not** destructively replace the installed GPTWorker. Reuse or selectively port its execution core. Avoid maintaining two copied core implementations indefinitely; decide consolidation only after passing integration tests.
2. Expose **independent, discoverable MCP tools with their own schemas** (GitHub-connector pattern), not a generic `work_tool(tool, arguments)` facade.
3. **Reuse identical GitHub tool names when operation semantics really correspond**: for example `fetch_file`, `create_file`, `update_file`, `delete_file`, `search`, `compare_commits`, `create_branch`. Namespace `GSA-Localconnector` distinguishes them from `GitHub`. Do not copy GitHub-only PR/issues/Actions APIs or pretend local file edits automatically create Git commits.
4. Local scope is a **set of authorized Workspaces**, not one active Job and not one mutable global cwd. Each tool invocation carries `workspace_id`, with paths **relative to that Workspace**, validated server-side. Multiple roots may be used concurrently.
5. GSA Project Memory stores local execution-target declarations; the **Windows connector independently authorizes** its actual canonical roots and permissions. The GSA manifest alone must never grant arbitrary host-filesystem access.
6. Shell commands execute with `cwd` inside the selected Workspace; requested subdirectories and explicit shell-directory changes outside the registered root must be denied. This is a **working-directory/path-policy boundary, not an OS sandbox**: arbitrary processes run with the Worker Windows user's OS privileges; do not claim that cwd checks prohibit all external I/O.
7. Ordinary in-scope tool calls require no additional human confirmation loop. Human consent is for initial root authorization, expansion of authority, and genuinely consequential/destructive actions under GSA governance.
8. No specialized CadGPT/RevitGPT/custom-job logic is built into GSA-Localconnector. AppData, scripts, source repos and test folders are all just ordinary independently authorized Workspaces.
9. Delete means **move to Recycle Bin by default** on Windows. Permanent removal is an explicitly different destructive operation, never silently substituted.
10. Direct MCP tool schemas are the source of truth. **GSA does not hardcode or duplicate the connector's tool catalog.** GSA only needs deterministic Project-target resolution, scope checks and capability discovery.

## 2. GitHub Connector comparison and target API

| Dimension | GitHub Connector | Legacy GPTWorker | GSA-Localconnector target |
| --- | --- | --- | --- |
| Location selector | `repository_full_name` | confirmed Job/Workspace | `workspace_id` |
| File selector | repository-relative `path` | absolute path | workspace-relative `path` |
| Tool discovery | direct named MCP tools | predominantly `work_tool` gateway | direct named MCP tools |
| Authorization | GitHub installation/repo permissions | `job_select`/work handle | server-owned authorized Workspace registry |
| Concurrency | many repositories | one Workspace per Job | many concurrent authorized Workspaces |
| Source mutation | GitHub API and commit SHA | local file mutation | local file mutation and local content revisions |
| Terminal/process | not local | shell/process tools | direct shell/process tools |
| Reasoning/harness | external Agent | Job-specific packs | GSA only |

### 2.1 Initial tool surface

**Workspace/control (read-only unless explicitly configuring):**
- `list_workspaces()`: current authorized Workspace IDs, canonical path or human-readable label, permissions, host status.
- `get_workspace(workspace_id)`: exact Workspace metadata, capabilities, optional Git root/HEAD.
- `connector_status()`: server/host/build information and capability availability.

**File/search tools (GitHub-like names wherever semantically safe):**
- `fetch_file(workspace_id, path, offset?, limit?, encoding?)`
- `create_file(workspace_id, path, content, expected_absent=true)`
- `update_file(workspace_id, path, content, expected_content_hash)`
- `delete_file(workspace_id, path, expected_content_hash?)` — Windows Recycle Bin by default.
- `search(workspace_id, query, glob?, limit?)`, `list_directory`, `glob`, `apply_patch`, `edit_file`, `copy_file`, `move_file`, `create_directory`.

**Execution tools:**
- `run_command(workspace_id, command, working_directory?)`
- `start_process(workspace_id, command, working_directory?)`
- `process_status(workspace_id, process_id?)`
- `process_output(workspace_id, process_id, tail_chars?)`
- `stop_process(workspace_id, process_id)`

**Git tools, when a Workspace is actually a Git repository:**
- Prefer dedicated typed operations for frequent low-risk actions: `git_status`, `git_diff`, `git_log`, `git_fetch`, `git_commit`, `git_push` and GitHub-aligned `compare_commits`, `create_branch` where sensible.
- No Git operation is required for plain folders; `run_command` remains available for repository-specific build/install scripts and other CLIs.
- Never automatically stage unrelated changes, reset dirty changes or force-push. Commits/push must meet GSA's approval/scope requirements.

**Important semantics:** GitHub `update_file` creates a remote commit; local `update_file` only changes bytes. Return an exact local hash/revision and explicitly indicate `committed=false`. Do **not** return a fake `commit_sha`. Likewise, local `delete_file` sends to Recycle Bin rather than deleting a GitHub blob. If identical tool names would dangerously imply identical side effects, document the difference and use an explicit local-specific name instead.

All listed tool names and argument shapes are **proposed API contracts**, not claims that they exist yet. During coding, derive each final tool schema from the real local tool implementation and test it through MCP `tools/list`.

### 2.2 Structured result contract

Every operation must supply:
- typed `ok` / status and stable machine-readable error code;
- `workspace_id`, resolved target (relative path or cwd), and operation name;
- mutation's prior/next content hash or Git revision when applicable;
- process/command output: `exit_code`, bounded `stdout`, `stderr`, `cwd`, `process_id` and completion state where relevant;
- no secrets/authority credentials in logs or normal responses.

Unknown/ambiguous tool outcomes must be reported as unknown until authoritative read-back, not automatically retried.

## 3. Multi-Workspace authorization model

### 3.1 Registration and use

Local Connector keeps a trusted local registry of authorized canonical folders. Enrollment is a separate local administrator/user configuration action, **not** a way for an Agent to supply any arbitrary path to a file tool.

Example configuration (illustrative, not a live machine configuration):

```json
{
  "workspaces": [
    {
      "id": "cadgpt-source",
      "path": "D:\\00 Other Works\\Vibecode\\Cadgpt",
      "permissions": ["read", "write", "execute"]
    },
    {
      "id": "cadgpt-custom-jobs",
      "path": "%LOCALAPPDATA%\\CadGPT\\workspace",
      "permissions": ["read", "write", "execute"]
    },
    {
      "id": "cadgpt-results",
      "path": "%LOCALAPPDATA%\\CadGPT\\drawings",
      "permissions": ["read", "write"]
    }
  ]
}
```

- Environment-variable expansion occurs on Windows during trusted enrollment/registry loading; persist/compare the resolved canonical folder identity.
- Registering a directory does not recursively register its parent or adjacent siblings.
- Each operation resolves `workspace_id` from the *server registry*, checks permission and revalidates canonical path/junction/symlink boundaries.
- Direct file paths should be Workspace-relative. Reject traversal (`..`), absolute file paths presented as relative paths, and unsafe alternate-path encodings.
- Cross-Workspace copy/move uses **explicit source and destination workspace IDs**, validating both ends and each side's permission; no implicit cross-root access.
- Keep process ownership bound to the originating Workspace; process status/output/stop cannot be used to access another Workspace's process.
- Concurrent requests must use request-local scope (existing `AsyncLocalStorage` pattern), not a process-global mutable `defaultCwd`.

### 3.2 Shell boundary

`run_command` and `start_process` choose exactly one registered Workspace per call:
- default `cwd = canonical_workspace_root`;
- optional relative `working_directory` resolves to a contained subfolder;
- reject noncontained cwd, explicit directory-switch attempts outside root, and known out-of-root paths/redirections under the existing shell guard;
- preserve `windowsHide`, bounded logs, exit codes and managed process tracking;
- test nested PowerShell/CMD invocations, Git `-C`, junctions, process inheritance and concurrent shell calls;
- allow commands required by real build/test/install workflows; report policy incompatibilities explicitly rather than silently broadening scope.

**Threat boundary:** shell parsing cannot prove all possible PowerShell/CMD/native-program filesystem accesses. If a future requirement demands enforced read/write containment, that is a separate OS-level isolation project. This iteration guarantees selection of an allowed cwd and best-effort rejection of visible escape attempts, without falsely advertising a strong sandbox.

### 3.3 Memory and authority separation

- **GSA Memory Repo:** unchanged, remains private GitHub-backed Project/Job/Run/Verification/Checkpoint control plane.
- **GSA Project execution targets:** may be GitHub repositories, local folders, or both.
- **Windows trusted allowlist:** authoritative local filesystem grant; must match the Project target's intended Worker and canonical root before execution.
- Project LOCAL-only is valid without `.git` or a source GitHub repo.
- A Workspace that is unregistered, missing, ambiguous, inaccessible, or denied is a hard error. Do not silently switch target or expand permissions.

## 4. Source reuse and migration inventory

Source: `thebimhouseinfo-sudo/chatgpt-local-worker`.

| Existing file/module | Decision | Implementation note |
| --- | --- | --- |
| `src/tools/filesystem.ts` | PORT/ADAPT | Direct MCP tools, relative paths and explicit Workspace context |
| `src/tools/shell.ts` | PORT/ADAPT | Workspace-scoped cwd and managed processes |
| `src/tools/context.ts` | PORT/ADAPT | Context reads scoped to selected Workspace |
| `src/lib/path-security.ts` | PORT/ADAPT | Canonical realpath/junction checks, fail closed without scope |
| `src/lib/shell-workspace-guard.ts` | PORT/ADAPT | Directory/redirect checks; document non-sandbox limits |
| `src/lib/patch.ts`, `file-search.ts` | PORT/ADAPT | Keep functionality, validate all affected paths |
| `src/lib/mcp-session-manager.ts`, MCP HTTP transport | KEEP/ADAPT | Preserve stable session/recovery behavior |
| `src/lib/activity-log.ts`, `tool-result.ts` | KEEP/ADAPT | Structured evidence and redaction |
| Windows tray/startup and secure tunnel | KEEP/ADAPT | Independent application identity/config, no collisions with installed GPTWorker/CadGPT/RevitGPT |
| `src/tools/work-gateway.ts` | REPLACE interface | Register each tool separately; no `work_tool` gateway |
| `src/server-factory.ts` | REWORK | Direct schema-based MCP registration; no Job wrapper |
| `src/lib/work-registration.ts` | REPLACE | Trusted multi-Workspace registry; no Job/work-handle lifecycle |
| `src/tools/jobs.ts`, `src/jobs/**` | OMIT | No Job Packs or Job confirmation API in new connector |
| `jobs/dev-coding`, `jobs/dev-planing`, `jobs/layla`, `jobs/mto` | OMIT from new connector | Leave original GPTWorker repo untouched |
| `shared-harness/**` and Job-only preload | OMIT | GSA supplies the Agent reasoning/harness |
| Browser tooling | DEFER | Reassess as a separate declared capability; never inherit `dev-coding` browser permissions implicitly |

**Provenance:** preserve source authorship, licenses, applicable third-party notices, and attribution when porting. Do not clone history and strip legal notices.

## 5. Phased implementation

### Phase 1 — Standalone connector bootstrap
#### GOAL
Create independent `GSA-Localconnector` application without altering installed GPTWorker.

Tasks:
- [ ] Import only required portable modules and corresponding tests, preserving license and provenance.
- [ ] Establish distinct npm package, runtime identity, config files, tray/startup identity, ports and tunnel settings.
- [ ] Retain MCP transport/reconnect and verify `initialize` and `tools/list`.
- [ ] Add CI build/typecheck/unit-test skeleton and a concise Windows install/upgrade/uninstall guide.

Exit: connector runs independently, reports correct identity and does not interfere with original GPTWorker startup/tunnel/registry entries.

### Phase 2 — Direct MCP tool interface
#### GOAL
Make the connector as straightforward for GSA to discover/use as GitHub Connector.

Tasks:
- [ ] Register independent tools with typed input/output schema and accurate MCP annotations.
- [ ] Implement GitHub-aligned file/search names with explicitly local mutation semantics.
- [ ] Retain code-editing capabilities: read/write, exact edit, structured/multi-file patch, grep/glob, directory operations and safe file copy/move.
- [ ] Add typed Git read/commit operations where useful, keeping shell for arbitrary project CLIs.
- [ ] Return stable errors and evidence; remove public `job_*` and `work_tool` interfaces.

Exit: all planned tools appear individually in `tools/list` and work without Job activation.

### Phase 3 — Multi-Workspace registry and path security
#### GOAL
Allow simultaneous operation on any number of explicitly authorized local folders, without leaking scope.

Tasks:
- [ ] Implement trusted Workspace registry, stable IDs, canonical path and permissions.
- [ ] Fail closed for absent/invalid `workspace_id` or missing request scope.
- [ ] Route each file/search/patch/tool call through request-local Workspace resolution.
- [ ] Validate source and destination independently for cross-Workspace operations.
- [ ] Implement process ownership per Workspace and concurrent-request isolation.
- [ ] Preserve Windows Recycle Bin default and opt-in permanent delete.

Exit: two or more folders can be accessed concurrently; every out-of-scope file operation is denied.

### Phase 4 — Shell, Git and live Windows verification
#### GOAL
Provide practical full local coding/build/test capabilities while enforcing selected working-directory boundaries.

Tasks:
- [ ] Enforce server-resolved cwd per `workspace_id`; deny outside-root cwd and known directory-switch escapes.
- [ ] Preserve stdout/stderr/exit code, foreground and background process handling.
- [ ] Exercise npm, dotnet, Python and other actually installed toolchains based on project requirements (do not assume all are installed).
- [ ] Check Git dirty status/branch/diff before mutation, with no reset/force push of unrelated data.
- [ ] Validate Windows path behavior (case-insensitivity, junctions, UNC, env vars, spaces, nested shells).
- [ ] Run smoke on a disposable clone/workspace, not production app data first.

Exit: real local source edit → build → test → review diff succeeds; policy violations return precise errors.

### Phase 5 — GSA integration / Project target migration
#### GOAL
Add Local Connector as a first-class execution target while leaving GSA online memory and Agent/Job lifecycle unchanged.

Source: `thebimhouseinfo-sudo/GPT-supper-agent`, primarily `supabase/functions/gsa-mcp/index.ts` and related tests/contracts.

Tasks:
- [ ] Extend Project target schema and parser for REMOTE, LOCAL and HYBRID; permit LOCAL-only Projects without mandatory `repository_url`.
- [ ] Store Worker identity, selected `workspace_id`, expected canonical root and allowed operations for each Local target in Project Memory.
- [ ] Extend Project read/write authorization for Local target relations (OWNED/REFERENCED or equivalent) independently of GitHub claims.
- [ ] Resolve Project target deterministically before any local mutation; verify registered target against connector-reported Workspace metadata.
- [ ] Use existing ChatGPT/MCP client tool discovery for the connector's direct tools. **Do not mirror its entire tool catalog in GSA.**
- [ ] Maintain Planner/Coder/Reviewer/Tester boundaries and immutable revision-bound evidence; for non-Git folders use content hashes/verified snapshots, not invented Git commits.
- [ ] Keep GitHub-only Project behavior and all GSA Memory Repo operations unchanged.
- [ ] If a tool call cannot be routed from the current GSA invocation surface, diagnose the actual connector/client boundary; do not assume GSA's Supabase MCP server can transparently call another MCP server.

Exit: GSA can execute authorized local-only and hybrid work, while existing online Projects and Memory paths remain functional.

### Phase 6 — End-to-end regression and release
#### GOAL
Prove the new connector is reliable and can replace manual copy/paste terminal workflows without destabilizing existing applications.

Acceptance tests:
- [ ] T01: GitHub-only GSA Project runs unchanged.
- [ ] T02: LOCAL-only GSA Project with a normal folder lacking `.git`.
- [ ] T03: HYBRID Project has independent remote and local targets; no unrequested sync/fallback.
- [ ] T04: Three distinct Workspace roots, read/write policy per root, concurrent requests without cwd leakage.
- [ ] T05: Allowed in-root read/edit/patch/search/copy/move; traversal, external absolute paths and junction escapes blocked.
- [ ] T06: Shell cwd chosen from registered Workspace, inside-subdir allowed, outside cwd/directory switches denied.
- [ ] T07: Shell build/test returns exact stdout, stderr, exit code; background process status/output/stop is Workspace-owned.
- [ ] T08: Local Git dirty/branch handling preserves unrelated changes; explicit commits/pushes affect approved scope only.
- [ ] T09: Recycle Bin delete recoverable; permanent delete requires explicit distinct authorization.
- [ ] T10: Restart/reconnect resets stale request/process authority safely; no Workspace crossover.
- [ ] T11: New tray, startup, port and tunnel are independent from GPTWorker/CadGPT/RevitGPT.
- [ ] T12: GSA uses discovered direct tools (no Job Pack, no `job_select`, no generic `work_tool`).
- [ ] T13: No local-target write or permission escalation when target is unregistered, revoked, ambiguous or offline.
- [ ] T14: Online GSA Memory Repo records and review/test governance remain unchanged.
- [ ] T15: Integration smoke on a real Windows development repository completes source inspection → edit → build → test → evidence without human terminal copy/paste.

Exit: evidence-backed PASS for the acceptance matrix, documented unresolved limits, and independent release/install verification.

## 6. Safety and compatibility invariants

- An Agent must not broaden Windows filesystem authority by specifying a new root in a tool argument.
- Local Connector never manufactures GSA Project/Job/Run or human approval.
- The GSA repo claiming a local target is **not itself** a Windows allowlist grant.
- A session/transport connection is not permission to access all local files.
- Paths must be rechecked at point of use, including multi-file patches and post-directory-creation writes.
- No global mutable cwd may leak across simultaneous calls.
- Shell cwd restrictions are real and tested; full OS confinement is out of scope.
- A local edit does not imply remote sync, branch commit, reviewed PASS, or deployed application.
- Never label missing tests as PASS.
- No extra gate for ordinary pre-authorized in-scope operations; preserve explicit authorization for destructive or wider-scope actions.
- Do not alter old GPTWorker unless a **separate, explicitly authorized** migration/removal is undertaken.

## 7. Code ownership and probable modification surfaces

**New repository: GSA-Localconnector**
- MCP transport and server initialization;
- independent tool declarations (filesystem/search/patch/shell/process/context/Git);
- Workspace registry / path authorization / request-local scope;
- tests, Windows packaging/installation, tunnel/tray and documentation.

**Existing GSA repo: GPT-supper-agent**
- Project manifest schema/parser/creation and scope authorization;
- Execution-target selection in Project/Run logic;
- capability discovery/routing rules;
- documentation/tests for LOCAL-only and HYBRID;
- no replacement of Memory Repo, Agent Harness, Reviewer or Job Runtime.

**Original GPTWorker repository**
- Source reference only at first. Keep existing functionality installed and working; explicitly avoid breaking Layla/MTO and other users of the old runtime.

## 8. Implementation order and checkpoints

```text
Document baseline
  → isolated Local Connector bootstrap
  → direct MCP tools
  → multi-workspace + path protection
  → Windows shell/Git smoke
  → GSA Project target integration
  → cross-connector regression
  → release
```

Every phase must produce source revision, actual executed tests and a short verification report before moving to the next. Critical auth/path/registry changes follow GSA's existing independent review requirements. Review must not invent additional domain Job Packs, Builder workflows, bespoke CadGPT integration or a second GSA tool registry.

## 9. Non-goals

- Replicating GitHub PR/issues/Actions endpoints locally.
- Porting GPTWorker's Dev Coding, Dev Planning, Layla or MTO Job Packs.
- Building a new AI/Agent or duplicating GSA planning/review/test orchestration.
- A Git Sync Manager, Deployment Manager or automatic cross-target synchronization.
- New app-specific workflows for CadGPT/RevitGPT.
- Claiming OS sandbox guarantees from cwd validation.
- Changing the configured online GSA Memory Repo.

## 10. Current status

- **DESIGN PLAN ONLY** — no implementation, CI pass, Windows smoke, connector connection or GSA migration is claimed.
- New repo is the planned implementation home.
- Begin coding only after reviewing current upstream source revisions and approving this architecture's implementation scope.
