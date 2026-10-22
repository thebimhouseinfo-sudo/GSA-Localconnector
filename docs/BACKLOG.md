# Out-of-scope findings
Only the user promotes an item into a future product plan.
Format: date | source | observation + evidence | related goal | user decision: pending.

- 2026-10-22 | Single-probe pre-execution Reviewer | Legacy `node scripts/test-mac-scoped-files-installed.mjs --journey` no longer creates its outside canary: `journeyMode` reads the fallback `outside/canary.bin` before any operation, while that command's parent branch creates only the outside directory and supplies no canary environment. Static call-path review at script SHA `6d84eef890d8f55b3ff04f36a319d36ad5f06507bcda5ecc3551740e112de2e5` shows an ENOENT failure. The separately reviewed `--single-probe` branch creates/hashes the canary and passes its path/hash before using `journeyMode`, so this regression does not block that one authorized execution. No native rerun was performed. | Task B test utility; restore legacy command before relying on it again | user decision: pending.
