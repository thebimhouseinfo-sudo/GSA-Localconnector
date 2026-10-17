---
name: gsa-finish-task
description: Complete a GSA task handoff when project gate status has pending steps or the agent is about to report a task finished; does not create product milestones.
---
Run `node harness/gate.mjs status` and `node harness/git-admin.mjs status`.
Follow gate.next using the assigned .codex/agents role and exact model/effort.
The primary agent dispatches roles; gate status alone is GUIDED_ONLY, not an orchestrator.
If NOT_CONFIGURED, report that explicitly; use the approved task criteria and actual
verification without inventing a milestone or claiming gate PASS.
If AWAITING_USER/BLOCKED, report the concrete decision/evidence required; do not self-sign.
For BLOCKING findings, repair only the approved task, reverify the changed scope, re-review
expired dependencies. Maximum two repair/review rounds. OUT_OF_SCOPE goes to backlog.
Run `node harness/verify.mjs`; report all failures, including pre-existing ones.
Write a sanitized evidence report using docs/reports/_TEMPLATE.md.
Only gate advance may update completion markers after configured gates pass.
Local success does not authorize push; report LOCAL_ONLY and actual integration status.
