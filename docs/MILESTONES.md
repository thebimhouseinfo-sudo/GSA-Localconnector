# Milestone configuration
Status: NOT_CONFIGURED. Planner owns product milestone content; user approves it.
Runtime input: harness/milestones.json, schema: harness/milestones.schema.json.
Bootstrap leaves milestone=null. Do not infer approval or completion from existing plans.
A proposed milestone needs id, immutable goal/criteria reference, task scopes, observable
review event, role, required gates/dependencies, evidence, repair limit and push policy.
Push is MANUAL_ONLY unless separately authorized; current harness never executes pushes.
G0/G11 cannot be authenticated by an agent-writable file. They stay AWAITING_USER.
Review trigger simulation is restricted to disposable fixture roots, not this live project.
See docs/bootstrap/WORKFLOW.md for manual approval handoff and enforcement limitations.
