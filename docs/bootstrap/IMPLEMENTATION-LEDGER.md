# Bootstrap execution ledger
- 2026-10-17: user approved project harness setup, prohibited product code changes,
  then requested explicit role models. Existing branch and dirty tree preserved.
- Read approved proposal and executing-plans/TDD/skill-creator/verification workflows.
- Baseline: SHA-256 captured for 186 pre-existing non-harness files in ignored local state.
- Implemented Node standard-library harness: verify, snapshot/restore, Git read-only
  administration, gate hashes/dependencies/profile/limits, hook adapters and role resolver.
- Self-tests first failed for missing harness, then 19 passed. Four additional adapter
  tests failed (Stop, actual quick check, dirty integration, shell protected edits);
  corrected harness behavior and 23 tests passed.
- Binary snapshot test initially exposed a fixture writer serializing Buffer as JSON;
  corrected the fixture writer, preserved exact byte assertion.
- Ruling: reuse current branch/checkout — user approved proposal explicitly preserves
  pending Mac work; cost if wrong: harness files must be relocated before integration.
- Ruling: actual approval authentication is unavailable — live G0/G11 remain AWAITING_USER,
  simulated approval works only outside live root; cost: primary-agent guided workflow
  is required for real approved tasks, no fully autonomous/authenticated gate claim.
- Ruling: choose GPT-6 Sol high for Planner/Coder — GPT-6.1 Sol absent from installed
  CLI catalog at setup time; user authorized model selection; cost: possible quality/speed
  tradeoff, explicitly recorded rather than silent runtime fallback.
- Ruling: do not repair pre-existing product build failures — user said no code changes;
  cost: full product verify stays red until a separately scoped product task fixes them.
- Current five models/efforts are supported by CLI catalog; inference tested separately.
- Project hook discovery succeeded, exact hashes initially untrusted. No manual edits to
  global Codex trust/config or bypass flag used. Record final trust state in report.
- Product verify: npm test stops at compiler; TS18047 child streams possibly null at
  src/hosts/macos-scoped-files.ts:26 (4 diagnostics). Harness does not suppress failures.
- Actual inference probes: GPT-6 Sol/high, GPT-6 Luna/high, GPT-6 Astra/high and
  GPT-6 Astra/medium all INFERENCE_PASS; one shared Sol/high combination covers two roles.
- Used normal CLI /hooks interface to trust exactly the five project entries after
  inspecting runtime discovery. Re-read hooks/list: all trusted/enabled, no bypass flag.
- Actual CLI tool callback test: harmless git push --help denied by PreToolUse before
  execution. No network push occurred. Both local skills parsed/enabled by runtime.
- Python quick_validate helper unavailable (PyYAML missing); runtime skills/list is the
  stronger actual discovery check; no dependency installed just to run the helper.
- Independent final reviewer reproduced Important issues: staged-only paths omitted from
  scans/escalation; SIGTERM-handling timeout could exit zero and incorrectly PASS.
- One final repair pass: staged+unstaged union; explicit timedOut/code124; bounded SIGKILL
  fallback/process group handling. Regression tests watched fail then pass.
- Own final checks fixed snapshot manifest/read-size consistency (4MiB total source cap),
  empty simulated gate lists falsely PASSing, and private connector/agent snapshot paths.
- Final harness suite: 29 tests, 29 PASS, 0 FAIL. Actual permitted CLI node --version also
  completed exit0 through hooks. No second review dispatch; covering tests verify fixes.
- All Critical/Important review findings addressed. No deferred Minor remains: empty-gate
  validation was included in the final repair pass. Product build stays red by scope.
- 2026-10-17, user-authorized model tuning after upgrade to CLI 0.163.0: catalog now
  includes Sol 6.1; project main/Planner/Coder Sol 6.1 medium, Tester Luna medium,
  Reviewer Sol 6.1 high, Critic Astra low only at larger/high-risk triggers. Named role
  TOMLs and inventory updated together; max2 subagents, routine work inline.
- Strict-config doctor ok; four distinct inference combinations PASS; 29 harness tests
  PASS; original 186 file hashes unchanged. Details: MODEL-TUNING-0163.md.
