# MCP transport and bootstrap

[CRITERIA.md](../CRITERIA.md) governs the offline GitHub workspace/tool provider. GSA owns reasoning and orchestration; connector transports direct workspace/file/search/edit/process/Git/CI calls and truthful results, with no task/review/promotion approval gates.

Working workspaces permit full file operations, shell, Git, diff and build/test without separate unlocks. Explicit reference roots permit list/search/read and copy out into a workspace; no mutation/direct execution there, including through subprocesses. Ungranted project data stays inaccessible. Each host has its own plugin/tunnel and scope. GSA consumes these APIs through `gsa-lc-mac` or `gsa-lc`; the connector is not another reasoning agent.

Development and acceptance are sequential: complete the Mac user journey before starting Windows development. Each host's plugin is verified independently for personal use, with multiple-project isolation on that host; simultaneous multiple-machine acceptance is outside scope.

## Source entry points

- `src/mcp/cli.ts`: stdio; stdout is protocol output.
- `src/mcp/http-cli.ts` and `src/mcp/http.ts`: HTTP composition/authentication.
- `src/mcp/server.ts`: JSON-RPC handshake, discovery/dispatch and binding.
- `src/mcp/catalog.ts`: planned direct schemas; registration alone does not prove implementation.
- `src/mcp/runtime-bootstrap.ts`: native composition/evidence checks.

The historical three-tool empty bootstrap is not the current catalog. Inspect actual `tools/list` at the exact revision/installation. Long jobs use durable IDs and short status/log/output/cancel calls.

## Source contract and remaining gaps

| Surface | Current source behavior | Remaining contract work |
| --- | --- | --- |
| Binding | `bind_workspaces({roots:[{path,role}]})` persists explicit workspace/reference roles; legacy `{paths:[...]}` remains read-only and role-less. Bind/unbind reconcile a complete active snapshot into the shared registry. | Installed/live-plugin proof and real file/command backends remain separate. Role permissions are intent, not evidence that every backend operation works. |
| Read/search/metadata | Registry-relative bounded operations exist. | Distinguish working/reference roots, enforce identity/revocation, and prove race/escape protection at the actual backend. |
| File mutation | Bootstrap conditionally loads an existing scoped Mac installation within the owner lifetime. The current adapter declares only create/mkdir/copy; copy uses source-read plus exclusive destination-create across scoped roots. Missing/stale installation stays unavailable. | Recoverable replace/edit/patch/delete routing, coordinator, checked installation constructor and guarded loader wiring exist in source. Three new signed-helper adapter journeys passed on disposable Mac roots; production recovery activation remains false. Missing relocation/crash/fsync evidence and reviewed installation/live proof remain prerequisites. Move/rename and directory copy are still unfinished. |
| Git | Catalog and engine exist, but production `hostGit` calls return `SECURITY_BLOCKED`. | Actual in-workspace Git, plain-folder behavior and hook/filter/child-process confinement. |
| Commands/CI | A matching installed Mac runtime can run Linux ARM64 disposable snapshots. Returned metadata explicitly says host workspace was not mutated. | In-place workspace semantics, native Mac toolchains where required, permitted reference reads and complete descendant enforcement. |
| Long work/recovery | CI records, process interfaces, controller leases and Mac ownership fencing exist; process-journal integration remains incomplete. | Durable status/output/cancel across actual transport interruption and restart, without replay or fabricated success. |
| Windows | Protected storage is unavailable; startup is status-only. | Independently verified ACL/state/native execution path with the same user meaning. |

Catalog presence, dependency-injected tests and a source build do not establish these capabilities in an installation. A planned schema must never be documented as a callable API before implementation.

## Syntax and capability supplied to GSA

Connector supplies structured MCP tool schemas and runtime capability results. GSA owns its project configuration, fills workspace/reference placeholders, selects the plugin and orchestrates calls; no GSA renderer, project manager or integration bridge is implemented here. The intended notation is recorded in the [scope note](../plans/FUTURE-GSA-INTEGRATION.md); actual wire calls remain JSON MCP requests.

GSA inspects `tools/list` for syntax, `connector_status({})` for host state and `list_capabilities({})` (optionally with `workspace_id`) for backend availability. Binding uses `roots:[{path,role}]` with `role: "workspace" | "reference"` and the current controller token; subsequent scoped tools use returned workspace IDs and relative paths. See the [binding examples](../workspaces/LOCAL-ENROLLMENT.md).

Current file reporting adds:

- `fileBackendAvailable`: whether the dispatcher has a loaded file backend.
- `fileOperations`: mutation tool names that backend declares supported.
- `hostFileWrites`: true only for the complete legacy mutation set; false for the partial create/mkdir/copy Mac adapter.
- `fileBlockedReason`: missing installation or partial-backend explanation.
- `list_capabilities.files`: enabled file-tool subset; `blocked` retains unsupported mutations and batch operations.
- `fileTransactionReadbackAvailable`: true only with a loaded adapter readback method, protected storage and controller store. When true, `get_file_transaction` appears in `list_capabilities.read`; otherwise it remains blocked.

Backend capability does not grant authority. GSA combines it with the selected root's role/permissions; a reference destination remains denied even if the host supports create/copy for working roots. A workspace role does not enable an absent backend. Errors and uncertain outcomes must be returned honestly; a catalog name or source capability field is not installed/native proof or evidence that an operation occurred.

## Binding API

Use exactly one form after supplying the current `control_token` required by the production dispatcher:

```json
{"roots":[{"path":"/absolute/project","role":"workspace"},{"path":"/absolute/reference","role":"reference"}],"control_token":"<current-controller-token>"}
```

Legacy clients may continue sending `{"paths":["/absolute/project"],"control_token":"<current-controller-token>"}` for read-only, role-less enrollment. This form cannot silently downgrade an explicitly assigned role. Both forms require 1–16 existing absolute directory paths; do not send both forms or extra root fields. Canonical matching roots keep their IDs; identical explicit reselection keeps its revision. Incompatible working/reference overlap is rejected without partially publishing a batch. Reference-source copy is intended only toward a working destination; native copy support is still a separate backend requirement.

Bind results include `workspace_id`, canonical `root`, `role`, `permissions` and `revision`; legacy role is `null`. `list_workspaces`/`get_workspace` expose role alongside permissions/revision. `connector_status.workspace_roles` lists the two role values; `workspace_role_semantics` states that they express grant intent. Existing backend readiness flags remain authoritative and may remain blocked.

Bindings persist on the selected host. If publication succeeded but reconciliation or readback is uncertain, return `RESULT_UNKNOWN`, do not auto-repeat the mutation, and reject further scope-dependent calls on that dispatcher. Diagnose with status/control tools and reload a fresh dispatcher from validated protected state; invalid root identities still require repair or explicit reselection. Existing owned stop/cancel retains its controller and permission checks. No cross-process atomic transaction spanning disk and registry memory, OS confinement, or live-plugin completion is claimed by this source API.

## Target request and result obligations

- Resolve every request to the selected host installation and explicit scope identities/revisions. No inherited authority from the other host or an inferred parent root.
- Separate a working root from a read-only reference in persisted scope and execution inputs. Binding grants the working scope as a whole; no later read/write/execute unlock or task approval is introduced.
- Use explicit source/destination scopes for cross-root copy/move. A reference may be a copy source; a move needs writable source and destination. Mutations retain expected-content checks and per-operation results.
- Commands, Git hooks/filters, build steps and descendants obey the same boundary. Reference content is data to inspect; reading it does not authorize execution in that reference or ambient access to other project data.
- Long calls return owned identifiers and bounded polling/log/output/artifact results. Cancellation needs actual owned-tree stop evidence; uncertain outcome is UNKNOWN, never PASS. Transport loss does not silently replay a mutation.
- Report actual backend, source/workflow identity and enabled capabilities. Linux guest output must not be presented as a native Mac build or a host file edit.

These obligations are requirements for the [implementation plan](../plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md), not new runtime interfaces. [Criteria traceability](../plans/CRITERIA-TRACEABILITY.md) ties them to deliverables and evidence. Authentication, controller ownership and OS scope enforcement protect access; they do not constitute connector task-approval gates.

See [source status](../STATUS.md) and [protected state](../security/PROTECTED-STATE-PLATFORMS.md). This planning update changes no runtime and claims no new native, live-transport or protocol/SDK conformance.


## Explicit file transaction readback

The source dispatcher implements `get_file_transaction({transaction_id, control_token})`. Use the opaque UUID returned by a recoverable mutation; no workspace, path or recovery directory is accepted. The adapter derives and authorizes the original workspace from its protected journal. This call observes/reconciles a transaction; it never retries a mutation or restores a file.

Check `fileTransactionReadbackAvailable` before calling. The production Mac recovery activation remains false, so this source implementation is not a claim that the installed plugin currently enables the tool.

An `APPLIED` result uses `{ok:true,result:outcome}`. `CONFLICT` and `UNKNOWN` use MCP `isError:true` with `{ok:false,code:"FILE_TRANSACTION_CONFLICT"|"RESULT_UNKNOWN",result:outcome}`. Preserve the original ID, observations, reason and retained handles. A failed authorization or invalid result discloses no transaction outcome. `UNKNOWN` does not mean no effect: inspect explicitly before deciding what to do next, without automatically resending the mutation.
