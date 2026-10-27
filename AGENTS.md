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
11. Maximum five review/repair rounds per pair or 30 minutes per active work window, whichever comes first. If unfinished, preserve the checkpoint, report blockers and ask the user whether to continue; wait for an explicit reply, never silently exit, abandon the task, reset counters or assume consent. Track elapsed wall time from the start of work, including delegated work; check at each tool/agent boundary. An explicit continuation starts a new 30-minute window and may extend the round allowance as stated by the user.
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


---

# Bootstrap official workflow (merged from AGENTS.bootstrap.md)

> Precedence: the project rules above and the user's current scope win on any conflict (MANUAL_ONLY push, no automatic branch changes, no invented plans/milestones, immutable approved CRITERIA, review-round limits). "Continue automatically" in the main path below applies only inside the user-approved scope. The legacy Node harness (`harness/*.mjs`) stays available for the commands listed above; `harness/common/*.py` is the official Bootstrap harness.

This is a reusable workflow. `docs/CRITERIA.md` is the **only approved product-theory source**, including use/scope/security exclusions; `docs/PROJECT_PROFILE.md` records verified host/stack/API; `docs/IMPLEMENTATION_PLAN.md` owns GOALMAP and implementation goals; `docs/MILESTONES.md` organizes approved plan deliverables; `TASKS.md` records approved task scope. Use matching generic role and skills under `.agents/`.

**Planner owns discovery.** Ask whether this is personal-only, team/internal or commercial/market use, real and approved future scale, required behavior, trusted environment, data risks, proportionate security/reliability and explicit non-goals. A user analogy (e.g. "offline GitHub") is not architecture approval. Initial CRITERIA is a draft until authorized. For a human-requested change to approved theory, Planner **discusses and settles the delta with human first, without modifying CRITERIA**.

**Discussion mode and the Secretary:** When Human calls a discussion ("mở discussion", "open discussion", "/discussion") or asks to discuss something in chat, Discussion mode is on at once: the chat agent acts as **Secretary** and follows .agents/skills/record-decisions/SKILL.md. It creates a new folder `docs/discussions/<YYYY-MM-DD>-<topic>/`. When Human asks to settle a point, the Secretary drafts the **full** solution in chat (no summary), asks whether it is exactly right, and only after Human confirms writes it unchanged as a DEC file and reads it back. The Secretary is the main chat agent, never a subagent, because only it sees the conversation. Planner links the DEC files from the Plan items and Tasks they govern; Coder implements a linked decision as written and asks Human instead of inventing another solution; Critic rejects a proposal or code that departs from one. Recording never changes CRITERIA.

**Generic setup contract:** the installer only copies portable files; Environment Architect **must read `.generic/ADAPTER_REQUIREMENTS.md` and `.generic/HOST_NATIVE_LAYOUT.md`, migrate the `.generic` host-facing content into the host's native config directory, and write/register/test host-native agent/skill/hook scripts** where supported before handoff. Do not defer this to Human or skip the port because the installer emitted `PORT_REQUIRED`. If the host lacks a feature, explain the evidence and mark only that capability GUIDED_ONLY.

**Pre-write gate limitation:** Planner must prepare a read-only proposal and, after Human requests its final write, call Technical Advisor before changing Criteria unless the exact proposal was already advised and Human decided afterward. Only Human can make the post-advice decision; Planner records it. Generic hosts have no shipped native hook. Copilot and Continue CLI have packaged Criteria adapters; follow their native setup guides and verify actual event dispatch. Continue IDE remains GUIDED_ONLY for protected editor writes. Neither prompt rules nor current Codex warning hooks authenticate Human approval or prevent all file-write tools. Do not claim an automated Criteria guard from Standard tier alone.

**Technical Advisor advises the human, not Reviewer/CR.** CRITERIA alone defines what the human asks for; Advisor may consult verified current architecture, environment and narrowly relevant source **only when needed** to assess feasibility, technical prerequisites, complexity/cost and realistic impact on completed capabilities. Reading existing source for technical facts is not reviewing code quality. Advisor does **not** read/review Plan, Code diffs or review reports, issue PASS/FAIL, or audit Planner compliance. INITIAL: consult on the **entire CRITERIA draft** before first approval. CHANGE: after the human and Planner settle a delta and the human requests its application, consult on **approved CRITERIA + delta before any edit**. Explain feasibility, fit and possible cascading subsystem changes, clearly marking unverified estimates. Compare Tạm dùng / Ổn / Nâng cao **only if multiple useful options exist**, never force three. Human chooses; Planner applies the authorized decision. No standing Advisor loop.

**Git branch authority (all tiers using Git):** `harness/common/branch_authority.py status` reads the only locally effective active/frozen/work-branch policy from Git's **common directory**. Planner uses the declared active branch as integration target, not Git default `main`; Coder runs `check-write` before edits, `check-create` before new branches, and `check-merge`/`check-push` before Git actions. Unknown policy, detached HEAD, wrong branch, or frozen target → BLOCKED; ask Human, never guess. Codex hooks check direct apply_patch only, **not** arbitrary shell/MCP/GitHub actions. Do not edit branch policy without explicit Human instructions; branch choice is operational configuration, not product CRITERIA.

**Reviewer** checks plans/code/tests against approved scale, security risk, expected behavior and exclusions; flag BOTH unrequested overengineering and missing capability for approved commercial scope. **Critic** performs final independent PRE_CODE_TECHNICAL design review with scoped Criteria/Decisions/Plan/source access; in PUBLIC_ARTIFACT mode Critic sees only public product/README and never reads private Criteria or Plan. These modes must not leak context. No extra independent Reviewer or Human technical-layout approval after CR PASS. Coder and Tester execute the smallest approved task with true evidence and optional relevant knowledge packs.

Give a vibe-coder outcome-focused summary: **what works, what is intentionally not built, cost/maintenance/risks, and what choosing changes**. Do not require human to read diffs or detailed engineering P1/P2/P3 plans. Preserve unrelated work. No unapproved product features, destructive Git, secret leaks, dependency installs or fabricated tests/approvals.

Shared verification: `harness/common/checks.json` and `harness/common/verify.py` only run configured commands. **Google Antigravity IDE** natively executes workflows via `.agents/skills/*` and `.agents/roles/*`, using portable Python primitives under `harness/common/`; lifecycle hooks are in `.agents/hooks.json`. Codex hooks (`harness/codex/hook.py`) and the Claude Code adapter (`harness/claude/hook.py`) reuse the same Python primitives; both require live native host trust/event verification before claiming ENFORCED. Full signed gates, authenticated approvals, full TRACE and automatic orchestration remain NOT_CONFIGURED. An ACTIVE approved task and verified checks are required for Stop verification; never invent goal IDs or claim ENFORCED without actual host tests.


## Main path — every project, with or without code or Criteria

After the harness files are installed (staged), go through these steps in order and continue from one to the next automatically. There is no separate approval stop between steps.

1. **Criteria.** No approved `docs/CRITERIA.md` → Planner discovery and the Advisor pre-write checkpoint. Approved Criteria already present → Planner summarizes it (with verified gaps against existing code) and asks Human once: keep or edit. Keep → continue at once. Edit → settle the delta, Advisor pre-write checkpoint, write, continue.
2. **Plan** — `docs/IMPLEMENTATION_PLAN.md` with GOALMAP and technical direction; each section starts with an observable GOAL tied to Criteria IDs.
3. **Milestones** — `docs/MILESTONES.md`, with verification inside each milestone (Lite tier: skip).
4. **Specialize Coder/Tester for this project** — project knowledge packs in `.agents/knowledge/`, relevant skill references, verified build/test commands in `harness/common/checks.json`, facts in `docs/PROJECT_PROFILE.md` and `docs/ARCHITECTURE.md`.
5. **Technical Proposal for the whole Plan** — Coder writes `docs/TECHNICAL_PROPOSAL.md` bottom-up across every milestone and Task; descriptive only, no source files.
6. **Critic CR, top-down** — Critic reads Plan and milestones first, then the proposal, looking for Tasks to merge, shared modules and a simpler overall direction. Coder revises the proposal until `Critic CR: PASS`; that file is the final proposal.
7. **Setup lock, then code** — `harness/common/setup_lifecycle.py` audit/smoke/host-test and the Human activate/finalize steps, then Coder implements milestone by milestone from the final proposal, with Tester and Reviewer per milestone.

**Human questions in steps 2–6 — ask immediately, otherwise keep going:** (a) a professional/domain solution that Criteria and accepted decisions do not settle (e.g. AutoCAD host behavior for an AutoCAD add-in); (b) **Small Function → Big Solution** — a small function whose proposed solution is disproportionate. Ordinary engineering choices are not Human questions. A material problem found later goes back to the affected step (Plan → proposal → CR), not straight into code. Do not retroactively move implementation goals into approved product theory. The setup tab stays open until live tests and post-lock verification complete.
