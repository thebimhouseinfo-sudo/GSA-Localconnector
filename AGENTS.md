# GSA-Localconnector
Local MCP connector; TypeScript/Node, Python and native Swift/macOS.

## Commands and sources
- Build: `npm run build`; tests: `npm test`; no standalone linter configured.
- Full verification: `node harness/verify.mjs`; quick: add `--quick`.
- Harness self-test: `node --test harness/test/harness.test.mjs`.
- Start work: `node harness/gate.mjs status` and `node harness/git-admin.mjs preflight`.
- Profile: docs/PROJECT_PROFILE.md; workflow: docs/bootstrap/WORKFLOW.md.
- Role models and limitations: docs/bootstrap/AGENT_ASSIGNMENT.md.

## Workflow
1. Follow the user's current scope. Bootstrap changes only the working environment.
2. Keep approved GOAL/criteria immutable. Do not invent product plans or milestones.
3. Read only task-relevant docs and skills. Work on one scoped task at a time.
4. Before editing: `node harness/snapshot.mjs create <file...>`; patch hooks also snapshot.
5. Run verification, report exact evidence and all failures, including pre-existing failures.
6. Follow gate.next at approved milestones; the primary agent dispatches required roles.
7. Planner → Coder → Tester → Reviewer; Critic only at configured larger review triggers.
8. Reviewer has chat/project context. Critic gets only a minimal export in a fresh session.
9. Critic observations require Reviewer classification: BLOCKING / OUT_OF_SCOPE / UNVERIFIED.
10. BLOCKING needs a violated criterion and reproducible evidence; unrelated ideas go to BACKLOG.
11. Maximum two review/repair rounds per pair; then report the unresolved issue to the user.
12. Record a lesson if a bug takes more than one fix attempt. Never load all lessons by default.
13. No milestone configured means NOT_CONFIGURED; it is not a product completion PASS.
14. Never hand-edit harness/state.json or mark task checkboxes done; use the gate command.

## Roles and skills
- Project roles: .codex/agents/{planner,coder,tester,reviewer,critic}.toml.
- Use assigned model/effort; unavailable means BLOCKED. Request explicit escalation for demonstrated need.
- Routine work stays inline; dispatch roles only at relevant approved triggers. At most 2 subagents at once.
- Reuse brainstorming/writing-plans for planning; systematic-debugging/TDD for fixes.
- Use verification-before-completion and requesting/receiving-code-review as relevant.
- Project skills: gsa-finish-task for pending gates; gsa-review-lessons when requested.
- Role permissions are contracts. Hooks are guardrails, not a sandbox or identity system.

## Git and safety
- Target main; preserve existing codex/mac-completion work until integration is authorized.
- New work defaults to the target branch; do not create/switch branches automatically.
- MANUAL_ONLY push. Do not push/fetch, merge/rebase, rewrite history or delete branches on your own.
- Stage only task-owned files. Do not overwrite unrelated/uncommitted work.
- Never read/write secrets or print credentials; do not edit .env*, private keys or identity state.
- Do not modify original VM media. Native tests need explicit task scope and disposable disks.
- Do not weaken tests, invent API support or claim native PASS from preflight/unit tests.
- No new dependencies, external plugins/MCP, permission changes or global config without approval.
- Sensitive role/hook/policy changes require a concrete user-reviewed maintenance proposal.
- Configuration governance and honest enforcement limits: docs/bootstrap/WORKFLOW.md.
