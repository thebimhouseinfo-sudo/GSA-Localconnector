# Track B — Pre-code Technical Proposal (2026-11-05)

## GOAL
Implement native macOS command and local Git execution using the existing process contracts and one durable journal, without Linux VM, OS confinement claims, MCP edits or background replay.

## Evidence and ownership
GitHub branch baseline: 1cb77c271328bf20dd466875bda5c6575762fb90. Read docs/CRITERIA.md, DECISIONS.md, IMPLEMENTATION_PLAN.md, MILESTONES.md, TECHNICAL_PROPOSAL.md; inspected src/core/native-io.ts, workspace.ts, workspace-path.ts, process-manager.ts, durable-process.ts, process-journal.ts, process-store.ts, git-engine.ts and git-plans.ts plus direct tests. Existing process/request and workspace registry contracts are source of truth.

## Change decisions
- CREATE src/hosts/macos-host-commands.ts using the existing VerifiedNativeSandbox and VerifiedNativeProcessController. Bind workspace to a current execute grant, pin root identity and check realpath for cwd. Spawn argv without shell and with a detached owned process group; collect bounded output, persist completion through DurableProcessManager. Unknown group identity must not trigger a guessed kill.
- MODIFY src/core/process-manager.ts and src/core/durable-process.ts to accept validated relative subdirectories using the existing workspace-path validator; reject invalid paths. Keep access/revocation checks in host adapter, not a second queue.
- KEEP src/core/native-io.ts shared interface unless proved impossible; KEEP existing journal/store. Reuse executeGit/gitPlan, preserve dirty files; leave network Git operations blocked pending separately approved credentials/network contract.
- CREATE targeted Track B tests for cwd, rejected paths, non-Git script, output bounds, exit, process ownership, cancellation, local Git; require real Darwin hosted CI evidence before claiming Mac PASS.
- DO NOT MODIFY src/mcp/*; integration owner alone handles server.ts, catalog.ts, runtime-bootstrap.ts, Git admission and capability reporting.

## Constraints and unresolved proof
Commands run as current user, not confined; claim command_confinement=none (user account), state_integrity_vs_commands=not_protected. Acknowledging SIGTERM is never physical stop proof. The output of a lost host session or unconfirmed group is UNKNOWN and never replayed. GitHub-hosted macOS runner and installed plugin execution remain separate acceptance gates.
