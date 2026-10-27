# Product decisions

## Scope disposition confirmed — 2026-10-19

1. Stop expanding the connector CI/DAG engine; reuse only components needed for project command status/log/output/cancel.
2. Remove unused VM prototypes/provisioning tools. Keep the existing Linux worker as optional functionality without another dedicated verification or repair campaign. The latest user instruction supersedes the earlier pre-retention test condition: assess it when used on a real project; if it does not work then, remove its connector support. Do not delete original VM media through source cleanup.
3. Connector supplies workspace/ref syntax, schemas and capabilities only; GSA owns configuration substitution and orchestration.
4. Finish Mac before Windows; no multi-machine acceptance matrix. Existing source compatibility CI is not native multi-machine acceptance.
5. All sleep prevention is removed.
6. Desktop lifecycle is deferred until the main Mac functionality is working.
7. Harness is valid Codex development configuration, not excess product scope. Preserve it locally and exclude it from GitHub publication.

## Mac desktop lifecycle additions confirmed — 2026-10-19

Latest user decision supersedes all earlier keep-awake and OpenLid proposals: the user will independently install https://github.com/tmad4000/nosleep and explicitly removed **all sleep-prevention mechanisms** from this repository. No caffeinate process, Keep Awake toggle, power assertion, helper, app integration/detection or related acceptance test belongs to connector scope. Do not investigate or install the external tool. Recovery after actual sleep/wake remains required; do not change global power settings.

Confirmed remaining delivery: setup saves both tunnel ID and API/runtime key in the repository `.env` (Git-ignored), reuses valid saved settings without prompting, starts the selected tunnel in the background after login, and presents a distinctive free-vector Dock icon with Pause/Resume and Quit. Lucide Plug Zap (ISC) with a teal badge is the selected icon source, with license retained. `.env` is parsed as allowlisted data, never shell-sourced, and the key is never printed, tracked, logged or embedded in a shared installer. These explicit user preferences extend M4/M5 without adding a milestone or changing Mac-first order. Product implementation and live installation are separate from this design record.

## Capability/API contract confirmed — 2026-10-18

The user explicitly requested the matching criteria/plan revision and continued implementation. GSA invokes local connector APIs through `gsa-lc-mac` or `gsa-lc`; the connector supplies capabilities and real results, not another reasoning agent. Multiple working roots have full file operations including copy/move/rename/delete, shell, Git, diff and build/test under existing OS permissions. Multiple references allow list/search/read and copy out into working roots; no writes, move-source, output destination or direct execution in references. Copied workspace material is usable/executable there. Reuse existing components for current-host project scripts, process controls, output/logs and code diffs. No new VM, universal test lab, CI/DAG engine or professional configuration framework is required. Preserve outside-root boundaries and report implementation gaps honestly. Mac first, then Windows; existing source/native proof stays scoped to its recorded artifacts.

## Settled operating logic — 2026-10-17

Latest scope correction,2026-10-18: “offline GitHub” means practical personal-use local project tools, not a universal cross-platform test lab. Run a project's existing scripts/build/tests on the current Mac or Windows host. When that project needs other operating systems, use an appropriate GitHub CI workflow; cloud actions remain separately authorized. Android/iOS are app workload targets. Prefer available tools; no VM, image acquisition, automatic all-OS test generation or professional configuration framework is required in the current scope. Existing VM work is historical and preserved, not an active implementation prerequisite. This does not alter the settled workspace/reference boundaries or certify unresolved capabilities.

Offline-test scope confirmed: run only on the connected machine's actual OS, using the project's own command/script and installed tools. Return run status, stdout/stderr, exit code and outputs; allow stopping that run. The connector need not supply a separate CI/DAG engine or provision another OS. A project script may itself have multiple steps or parallel tests. Cross-OS GitHub CI is an external project workflow when requested, not a local test-runner dependency.

VM disposition clarified by the user: build, then keep the existing VM if a fresh run works; drop it from use if it fails, and drop new VM development. The 2026-10-18 TypeScript build passed, but Swift environment errors stopped the native fixture before VM boot; the escalation was aborted with no execution result. This does not establish a VM defect or a fresh PASS. Preserve the old Linux worker/media pending verification, do not depend on it for the local host runner, and do not start a repair campaign. The unimplemented macOS guest proposal is dropped from active development. See [recheck evidence](reports/2026-10-18-existing-vm-recheck.md); historical native/MCP proof does not certify current health.

- Criteria describes settled desired user operation; all designs must satisfy it. Contracts, tests and implementation status belong in plans/evidence.
- Connector is an offline GitHub workspace/tool provider. GSA owns reasoning/orchestration; connector adds no task/review/promotion approval gates.
- Working workspace permits read/write/edit/delete, version control, commands/processes and build/test without separate permission unlocks. This supersedes read-only binding followed by separate execution grants.
- Extra explicit reference directories permit read/search for design/knowledge lookup only; no mutation/execution or implicit promotion. Ungranted project data stays inaccessible, including through descendants.
- Clarification during plan review: content may be copied from a reference into a working workspace and used there, including executing the copy. Do not run/import/build directly from the reference folder; copying does not grant source mutation rights or access beyond selected roots.
- User clarification on2026-10-18: connector-mediated read/search/copy is sufficient for reference folders; commands do not need direct reference access. Reference roots need not be shared with the command runtime. Copied material may still be used/executed in working scope. This settles the D2 capability question without claiming its enforcement is implemented.
- User priority on2026-10-18: prefer the existing Mac, installed toolchain and existing project components. Continue direct-host feasibility assessment first; a VM is a fallback only after a demonstrated host limitation and a concrete cost/resource proposal. Existing broker/capture tests already ran on the host. This priority does not waive workspace boundaries or certify arbitrary-command confinement.
- User clarification on2026-10-18: Android/iOS testing concerns apps being developed inside a project, not additional platforms running the connector and not a requirement to operate GSA from a phone. Connector hosts remain Mac/Windows in the approved sequence. App-specific testing may use available local tools/devices or a separately authorized online testing integration; no cloud account, upload or new dependency is presumed.
- Windows/Mac use separate plugins/tunnels with host-local state and one controller per host. Complete and accept Mac before starting Windows development. Personal-use acceptance is per host; simultaneous Win+Mac, multiple Macs, multiple Windows machines or fleet-style matrices are outside scope. Multiple projects on one host still require independent scopes/processes/results. This supersedes both shared-tunnel handoff and simultaneous multi-host acceptance proposals.
- Normal activation supplies absolute paths through the selected plugin. Terminal enrollment is a legacy implementation detail, not a prerequisite.
- Repository contains product source, build/test/install scripts and project documents. Agent environment, harness, skills and Codex-only workflow scripts stay local and ignored.
- Baseline publication is complete at main d29be709. The current authorized stage is reassessing source against criteria and revising plans/milestones/related documents before any further product implementation. Fresh start preserves history and local work.

## Planning revision — proposed, not new settled requirements

The [revised plan](plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md), [criteria traceability](plans/CRITERIA-TRACEABILITY.md) and [milestones](MILESTONES.md) replace the earlier task inventory as reviewable proposals. They separate Mac boundary feasibility, actual host tools, evidence/recovery and complete installed Mac/GSA acceptance, followed only then by Windows parity and independent Windows/GSA acceptance. There is no simultaneous two-host acceptance milestone.

D1/D3–D6 in the plan remain proposed decisions/questions. D2's user intent is clarified above: copied content can be used in a working workspace, with no requirement to ban all future use of bytes because they originated in a reference. Preventing direct reference execution/import/build through interpreters and descendants still requires a concrete design and evidence; read-only/noexec alone is not proof. No requirement is waived; user review and concrete feasibility evidence are required before implementation relies on those choices. This document authorizes no code, native probe, grant/configuration change or publication.

Authority: [CRITERIA.md](CRITERIA.md). Evidence/limitations: [STATUS.md](STATUS.md). A source checkpoint is distinct from a production release.
