# Track B — Coder Self-Review / Findings

## Scope, authority and review independence
Scope B1/B2/B3 only. Inspected existing workspace grant, process request, Git and journal contracts. This is CODER SELF-REVIEW, not an independent Reviewer or Critic PASS.

## Findings and dispositions
- B-R01 (CLOSED in source): Process and durable validators previously accepted only `.`; shared existing relative-path validator now accepts strict child cwd and rejects traversal.
- B-R02 (MITIGATED; host proof needed): Signal request must not be confused with physical stop. Adapter validates a live child group leader via Darwin `ps`, signals only its owned group, verifies group absence; failed proof returns UNKNOWN and avoids an unsafe guessed-PID signal. Actual host regression still pending CI.
- B-R03 (MITIGATED): Output cap could be mistaken for successful complete command; synchronous result carries `output_limited` and durable controller state becomes UNKNOWN on truncated output.
- B-R04 (OPEN / Integration): Native controller, existing durable journal and Git plan have not yet been composed into shared MCP host bootstrap; `server.ts`, `catalog.ts`, `runtime-bootstrap.ts` remain integration-only.
- B-R05 (OPEN / Evidence): GitHub-hosted Darwin jobs queued; do not claim verified native spawn/cancel behavior.
- B-R06 (OPEN / Contract): Explicit run identity/journal artifact/source-toolchain metadata incomplete for all Git/command routes; integration owner must decide minimal additive journal fields with backward compatibility.
- B-R07 (OPEN / Coverage): Post-launch revocation, restart/no-replay, spawn failure and executable environment-secret negatives require end-to-end integration test.
- B-R08 (OPEN / Platform): Host adapter is intentionally unavailable on Linux; local Linux test cannot substitute for Darwin.
- B-R09 (OPEN / Test): Confirm mandatory Track B native tests are never silently skipped in C-B gate. Current test file declares platform skip, which is appropriate for non-Darwin but must FAIL if skipped on Darwin G2 gate.

## Decision
NOT YET INDEPENDENT PASS. No merge/deploy, no release acceptance. Continue self-repair from actual runner feedback and hand to independent Reviewer once exact-revision CI evidence exists.
