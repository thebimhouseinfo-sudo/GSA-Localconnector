# Role/model assignments — balanced usage, CLI 0.163.0
Updated 2026-10-17 at the user's request to reduce usage while preserving quality.
Runtime definitions: .codex/agents/*.toml. Inventory: harness/roles.json.
Project main model: .codex/config.toml. No global Codex settings or permissions changed.

| Role | Model | Effort | Activation |
|---|---|---|---|
| Main agent | gpt-6.1-sol | medium | Normal project sessions |
| Planner | gpt-6.1-sol | medium | Requirements/task planning when needed |
| Coder | gpt-6.1-sol | medium | Implementation in approved scope |
| Tester | gpt-6-luna | medium | Focused execution and evidence |
| Reviewer | gpt-6.1-sol | high | Independent review at relevant triggers |
| Critic | gpt-6-astra | low | Approved larger/high-risk milestones only |

Unnamed subagents default to Luna/medium, with at most two concurrent subagents.
Named roles keep their explicit TOML settings. Routine work stays inline; do not run
all five roles after every edit. Keep context narrow, reuse relevant task context,
return concise findings and avoid duplicate research, repeated polling or redundant review.
Use scripts to collect deterministic evidence instead of spending model turns on it.
Critic is an occasional independent check; it is not a permanent parallel worker.

Quality escalation: if a concrete reproduction shows medium reasoning is insufficient
for native/security/concurrency work, report the evidence and request an explicit higher
setting (first Sol 6.1/high; Astra only for justified difficult cases). Do not silently
replace an unavailable model or increase effort across every task. Approved review triggers
and existing test/evidence requirements remain in force. No promised percentage saving:
actual account usage depends on model, context, output, reasoning, tool calls and retries.

CLI 0.163.0 catalog includes GPT-6.1 Sol and all selected reasoning levels. The original
CLI 0.158 setup selected GPT-6 Sol because its catalog then lacked 6.1; that historical
choice is superseded. See MODEL-TUNING-0163.md for actual smoke-test results.

Run `node harness/runtime-check.mjs` to check catalog and hook discovery.
Optional `node harness/probe-models.mjs --run` consumes a small amount of account quota;
it runs each distinct configured model/effort once and never silently falls back.
A successful availability probe is not an evaluation of software quality on real tasks.

Contracts: Planner proposed docs/tasks; Coder scoped source; Tester tests/reports;
Reviewer lessons/backlog/decisions; Critic read-only minimal product export in a fresh
session. Parent permissions still apply; role instructions do not enforce path access.
Critic disables memory/apps/plugins features but cannot certify blind review solely from
its name. If project memory/chat remains accessible report CONTEXT_ISOLATION_UNVERIFIED.

Restart/new session to pick up project model configuration. Desktop may retain a model
selected in the UI for the current chat; check the displayed model rather than assuming
this file overrides an explicit session choice. CLI `codex -C /Users/nam/GSA-Localconnector`
uses project settings unless overridden by a command-line option or higher policy.

Rationale informed by [official model selection guidance](https://developers.openai.com/api/docs/guides/model-selection)
and [custom agent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents).
Sol 6.1 medium is the balanced default; Luna handles scoped work; deeper review is selective.
