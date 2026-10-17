# Daily use and configuration governance

1. Open this repository in a new Codex Desktop chat, or run `codex -C /Users/nam/GSA-Localconnector`.
2. Describe the task normally. Agent reads AGENTS.md and runs gate status + Git preflight.
3. Configured review triggers tell the primary agent which role to call; no reminder is needed.
4. Before editing use snapshot; before handoff run verify and report real outcomes/limitations.
5. To add/change a skill or model, request a scoped config change; recover using snapshot ID + current SHA256.

## Commands

```
node harness/gate.mjs status
node harness/git-admin.mjs status
node harness/git-admin.mjs audit
node harness/git-admin.mjs preflight
node harness/git-admin.mjs verify-integration <commit>
node harness/git-admin.mjs cleanup
node harness/git-admin.mjs recover
node harness/verify.mjs --quick
node harness/verify.mjs
node --test harness/test/harness.test.mjs
node harness/snapshot.mjs create src/path.ts
node harness/snapshot.mjs restore <snapshot-id> src/path.ts <current-sha256>
node harness/runtime-check.mjs
node harness/role.mjs reviewer
```

Cleanup/recover are dry-run/guidance only; no branch deletion, merge, reset or push.
Integration reports use local refs and explicit commit; remote stays UNVERIFIED without
an authorized fresh fetch. Dirty current work cannot receive default HEAD integration PASS.
Actual pushes require a separate explicit human request; harness never executes them.

## Hooks and Desktop/CLI

`.codex/hooks.json` defines project-local SessionStart/UserPromptSubmit status injection,
PreToolUse patch snapshot/protected edit guard, PostToolUse quick checks after recognized
edits, and bounded Stop continuation for configured pending gates.
No global Codex config, permissions, MCP configuration or original VM image is changed.

Codex CLI 0.158.0 is already installed. It discovers all five project hook definitions.
Non-managed hooks require trust of their exact hashes; review with `/hooks` in the CLI.
Changed definitions require review again. Restart/new chat is needed to test Desktop
loading; a currently running chat is not evidence that new hooks are active.
Do not use a hook-trust bypass as the daily startup command.

Patch edits have automatic per-file snapshots. Shell/MCP/other mutation tools receive
an explicit GUIDED_ONLY reminder; arbitrary programs cannot be fully analyzed by regex.
Recognized destructive commands and direct sensitive state/config shell writes are
blocked, but these are guardrails, not an OS sandbox or complete secret protection.
Explicit snapshot is required before shell-driven edits. Specialized tool paths may
bypass callbacks; do not claim universal enforcement. Hook errors/timeouts need visible
reporting. The harness never claims runtime isolation from prompt instructions.

Quick verification runs harness syntax/config checks and TypeScript noEmit. Full verify
runs harness self-tests then the existing npm test command, which builds and tests the
product. It stops at first failure. Staged and unstaged changes are both scanned. Commands are
bounded to at most 180 seconds each; a timeout is FAIL/code 124 even if the child
handles SIGTERM by exiting zero. A kill fallback handles ordinary process-group descendants.
This is not a sandbox for malicious verifiers that escape their process group. There is no separate linter. Reports are private in
harness/reports/verify.json. Task scope may be passed to the programmatic verify API;
the default reports changed paths and test changes without inventing an approved scope.

## Milestone approval and review loop

Bootstrap leaves `harness/milestones.json` at NOT_CONFIGURED and TASKS.md without tasks.
Planner may draft milestone input using the schema only from approved product logic.
Current gate's live approval adapter is deliberately unavailable: agent-writable JSON
cannot prove human approval. Live G0/G11 therefore remain AWAITING_USER. Human approvals
must be handled directly in the conversation and primary-agent workflow; this setup
must not be advertised as a fully authenticated, autonomous milestone engine.

The executable engine supports task source/evidence hashes, dependency expiry, profile
escalation, role next-step selection, two repair-round limits and completion marker
advance in disposable simulations. Simulated approval is rejected at the live root.
All agent gate signatures are SELF_REPORTED_UNAUTHENTICATED, not identity attestation.
The primary agent is the dispatcher; script status is GUIDED_ONLY. No background daemon
or unattended model loop is installed. Pending user decisions never cause Stop loops.

To use an approved live task now: primary agent follows the direct human approval,
scoped task and role contracts, collects evidence, and explicitly reports any gate whose
authenticated adapter is unavailable. Do not edit approval/state files to bypass this.
An authenticated approval adapter and real automatic orchestration are future harness
configuration work, requiring a separate concrete proposal and tests before claiming them.

## Role/skill changes and rollback

Inspect existing role/skill inventory before adding anything. Reuse installed skills
for planning, debugging, TDD, verification and code review. Project-specific finishing
and lesson-review skills live in .agents/skills/. No external plugin/MCP is installed.
Propose purpose, trigger, inputs/outputs, permissions, changed paths, valid/error tests,
maintenance cost and rollback. The user has approved this bootstrap configuration;
future sensitive changes require their own authorization when outside existing scope.
Update TOML and roles.json together; self-check detects model/effort drift.

Snapshots contain exact bytes/modes/root identity, with a 4 MiB total input cap per snapshot
so each manifest remains readable by the restore tool. Large scopes fail before publishing. Restore needs the current file hash
so it will not silently overwrite an unexpected later edit. New-file deletion is never
automatic. Symlinks, hardlinks, secrets, outside paths and protected state are refused.
Snapshots/state/logs are ignored, not part of shared project memory. Treat snapshots as
private local data and retain recovery copies until the relevant task is integrated.

If a harness operation lock survives a crash, inspect harness/local-state/operation.lock
and confirm no operation is active before removing that lock. No automatic stale-lock
reclamation is claimed. Do not remove .git locks or product ownership locks through this tool.

## Review scope control

Reviewer sees relevant chat and project memory; Critic receives only the product export,
minimal README/run instructions and no review debates. If chat/docs/AGENTS leaked into
its context or are accessible, report CONTEXT_ISOLATION_UNVERIFIED. A named agent with
full parent access cannot certify a blind review. Reviewer classifies observations by
approved criteria: BLOCKING, OUT_OF_SCOPE, UNVERIFIED. No blocking finding is valid.
Two failed repair rounds per pair require user decision. Never invent features to fix
an observation outside the approved goal. See templates in docs/reports/ and lessons/.

## Updated usage profile (CLI 0.163.0)
Current model assignments and invocation frequency are in AGENT_ASSIGNMENT.md.
Main/Planner/Coder: Sol 6.1 medium; Tester: Luna medium; Reviewer: Sol 6.1 high;
Critic: Astra low only at approved larger/high-risk triggers. Maximum two subagents.
Routine tasks stay inline. This avoids the cost of five new contexts per small edit
while retaining required independent reviews at the relevant approved milestones.
