# Model tuning — CLI 0.163.0, 2026-10-17
User request: reduce usage while retaining sufficient quality. Configuration only;
product source/tests, dependencies, CI, VM media and global Codex settings unchanged.

## Applied settings
- Project main, Planner and Coder: GPT-6.1 Sol / medium.
- Tester and unnamed subagents: GPT-6 Luna / medium.
- Reviewer: GPT-6.1 Sol / high at relevant independent-review triggers.
- Critic: GPT-6 Astra / low at approved larger/high-risk review triggers only.
- At most two concurrent subagents. Routine tasks stay inline, use narrow context,
  concise evidence and no duplicate research/redundant review loops.
- If demonstrated task complexity needs more reasoning, request explicit escalation;
  no silent fallback or automatic increase for all tasks.

Files: .codex/config.toml; .codex/agents/*.toml; harness/roles.json; AGENTS.md;
current role documentation in AGENT_ASSIGNMENT.md. Existing hook definitions unchanged.
The runtime checker now reports actual CLI version rather than its original hardcoded one.

## Evidence
- Installed runtime: codex-cli 0.163.0.
- Strict-config doctor: config.load=ok.
- Runtime model/list: all selected models and reasoning levels SUPPORTED.
- Real inference: Sol 6.1/medium, Sol 6.1/high, Luna/medium and Astra/low all PASS;
  four distinct combinations cover five named roles and the project default choice.
- Harness tests: 29 PASS, 0 FAIL. Harness self-check PASS, including TOML/inventory agreement.
- Five project hooks remain trusted/enabled after the CLI upgrade; hook definitions untouched.
- All 186 original non-harness file hashes still match the pre-bootstrap baseline.
- No product verification PASS is claimed; previously reported product build errors were
  not changed or re-tested solely for this model configuration update.
- Raw evidence ignored under .gsa/local-state/bootstrap/ and harness/reports/model-probes.json.
- Recovery snapshot before editing: 06716a52-7c8a-4b01-9f37-c62a18ad6c78.

## Why this profile
This is a project judgment informed by [official model-selection guidance](https://developers.openai.com/api/docs/guides/model-selection):
use Sol 6.1 for technical coordination and implementation, Luna for focused testing,
selective deeper Sol review, and occasional Astra observations. Lower settings and fewer
repeated contexts target usage reduction; actual savings/quality require observing real
tasks and account metering, not extrapolating from API prices or a tiny availability test.

Open a fresh project CLI session to use the new root settings:
`codex -C /Users/nam/GSA-Localconnector`.
An existing Desktop chat may retain its explicitly selected model; open a new project
chat and confirm the model picker before assuming project defaults are applied.
