# Bootstrap result — 2026-10-17

Configured the project working environment only. No product source/test/package/CI
modification was made during bootstrap; all 186 pre-existing non-harness file hashes
match the saved baseline. Existing pending Mac changes remain untouched. Nothing was
staged, committed, pushed, merged or fetched. Original VM disks and services untouched.

## Installed project files

- AGENTS.md (<60 lines), project profile, five runtime role TOMLs and roles.json.
- Node standard-library harness: verification, snapshot/restore, Git administration,
  gate status/hash/dependency/profile/repair limits and project lifecycle hook adapter.
- Two narrow project skills for GSA finishing/gate handoff and lesson review.
- Empty task/milestone/criteria templates, evidence/lesson templates, user decision ledger.
- Git ignores keep local credentials, VM media, tunnel binaries, caches, snapshots,
  harness state and raw verification logs out of ordinary staging. Source/config/templates
  and dependency lockfile remain eligible for version control.

## Configured models

| Role | Model | Reasoning | Evidence |
|---|---|---|---|
| Planner | GPT-6 Sol | high | Catalog supported; actual inference PASS |
| Coder | GPT-6 Sol | high | Same exact model/effort as Planner; inference PASS |
| Tester | GPT-6 Luna | high | Catalog supported; actual inference PASS |
| Reviewer | GPT-6 Astra | high | Catalog supported; actual inference PASS |
| Critic | GPT-6 Astra | medium | Catalog supported; actual inference PASS |

Initial GPT-6.1 Sol proposal was replaced explicitly during setup because the installed
CLI catalog did not list it. No runtime fallback is configured. Catalog support and a
small successful inference do not prove every role/task or future quota availability.

## Verification evidence

| Check | Result | Evidence |
|---|---|---|
| Harness fixture tests | 29 PASS, 0 FAIL | node --test harness/test/harness.test.mjs |
| Configuration/syntax | PASS | node harness/self-check.mjs |
| CLI config parsing | PASS | codex --strict-config doctor --json; config.load=ok |
| Model/effort smoke | 4 exact combinations PASS for 5 roles | harness/reports/model-probes.json (ignored) |
| Project hooks | Five discovered, enabled, trusted | node harness/runtime-check.mjs; CLI /hooks UI |
| Runtime allow callback | PASS | CLI node --version completed exit 0 through trusted hooks |
| Runtime deny callback | PASS | CLI git push --help blocked by PreToolUse before execution; no push attempted |
| Project skills | Both discovered/enabled; zero runtime parse errors | skills/list via runtime-check |
| Existing file hashes | 186 identical, zero changed | ignored .gsa/local-state/bootstrap/product-baseline.json |
| Product verification | FAIL, preserved and reported | existing npm test fails TS18047 in macos-scoped-files.ts:26 |

Fixture coverage includes exact binary restore, conflict rejection, symlink/traversal/
secret refusal, valid edits versus denied protected edits, hash/evidence expiry,
dependency-selective invalidation, automatic profile escalation, required next role,
repair and Stop limits, refusal to self-sign user approval, task advance, Git integrated/
unmerged/dirty states, non-Git handling, model unavailability and separate project profiles.
Fixtures never launch a VM, push to a remote or mutate real product files.
Final independent review found staged-only scan omission and timeout false-PASS;
both have failing-then-passing regression tests. Also fixed snapshot restore-size
consistency, empty simulated gate validation and known private-state snapshot refusal.

Current product build failure has four diagnostics: child.stdout, child.stderr and two
child.stdin accesses possibly null in src/hosts/macos-scoped-files.ts:26. It pre-existed
bootstrap and was not repaired because the user explicitly prohibited product changes.
No product test/native PASS is claimed by this report.

The optional skill-creator Python validator could not start because this host Python
lacks PyYAML; no dependency was installed. Both skills were instead parsed/discovered
without errors by the installed Codex runtime itself.

Raw logs are private under .gsa/local-state/bootstrap/ and harness/reports/.
They remain ignored; shared reports contain sanitized summaries rather than credentials.

## Operational limits

- CLI 0.158.0 already installed; no CLI installation/update was necessary.
- Exact five project hook hashes were trusted through the normal CLI /hooks interface;
  global model, permissions and MCP configuration were not changed. Modified hook
  definitions require trust again. No trust bypass startup flag is used.
- Desktop needs a new chat/reload to confirm discovery; current chat is not a proof of
  new lifecycle callback loading. CLI callback validation is the verified fallback.
- Review loop is GUIDED_ONLY: the primary agent dispatches roles. No autonomous daemon.
- No product milestone was invented; current gate state is NOT_CONFIGURED.
- No trusted human approval adapter exists; live G0/G11 remain AWAITING_USER. Agent
  self-reported signatures do not attest role identity. Do not fake approval with files.
- Role write scopes and Critic context limits are contracts until runtime isolation is
  actually established. Arbitrary shell/MCP mutations require explicit snapshot; hook
  regex checks cannot protect all programs or specialized tool paths.
- Git cleanup/recovery is non-destructive guidance; no automatic push. Local refs do
  not prove live remote synchronization.

## Daily use

1. Open a new project chat on Desktop, or `codex -C /Users/nam/GSA-Localconnector`.
2. Give the task normally; AGENTS.md directs preflight, profile and the right role.
3. Agent snapshots, implements only approved scope and runs verification with evidence.
4. Agent follows configured review steps without repeated user reminders; limits are explicit.
5. Request later harness changes normally; use WORKFLOW.md for recovery and trust review.

Detailed usage: docs/bootstrap/WORKFLOW.md; models: AGENT_ASSIGNMENT.md;
configuration decisions/limits: IMPLEMENTATION-LEDGER.md.

## Superseding model update after CLI upgrade
The model table above records initial bootstrap results. User upgraded CLI to 0.163.0
and requested a more economical configuration. Current settings/results are in
AGENT_ASSIGNMENT.md and MODEL-TUNING-0163.md; the earlier model table is historical.
