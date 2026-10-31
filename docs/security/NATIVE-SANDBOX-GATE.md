# Native boundary verification — Windows and macOS

[CRITERIA.md](../CRITERIA.md) is product authority. File tools and connector APIs enforce working and reference root scope. Under the 2026-10-31 §7 decision, host commands and descendants run as the logged-in user without OS confinement and can access data outside those roots, including connector state. Workspace cwd does not restrict their access. Use trusted projects and report the accepted risk.

The legacy filename uses “gate” for an engineering evidence obligation. It does not define a permission step in the user's connector workflow. This document is a planning/verification contract; it authorizes no native probe, grant, installation, account, policy or media change.

## Baseline and limitations

At source baseline d29be709, production composition can load the independently pinned Mac Linux-ARM64 snapshot runtime when installed proof matches. It passes no native file backend, blocks host Git and does not synchronize guest edits to host projects. Separate broker/packaging/journal code is not evidence of complete integrated capability. Windows remains status-only without verified protected ACL storage/native execution.

The [historical worker integration report](../reviews/2026-10-17-NATIVE-WORKER-INTEGRATION.md) records exact older native artifacts and tests. Current cross-platform source CI is recorded in [STATUS.md](../STATUS.md). Neither certifies the full working/reference model, in-place host operations or current live plugins.

## Required backend evidence

| Boundary | Positive proof | Negative/recovery proof |
| --- | --- | --- |
| Working roots | Actual read/edit/create/delete, command/build and permitted Git on an explicitly granted root, including a plain non-Git folder where applicable. | File tools and APIs reject ungranted access; commands have the user's ambient access. |
| References | Read/search and reference-to-workspace copy succeed without granting source mutation rights. | Connector APIs deny mutation and command launch with a reference cwd; unconfined commands can nevertheless access reference paths. |
| Root identity | Separate granted roots operate concurrently without shared cwd. | Symlink/rename/replacement/race, stale descriptor and mixed-role overlap cases cannot retain broader rights. |
| Process boundary | Host commands start with validated workspace cwd, minimal environment, time/output limits and owned cancellation. | Report no confinement and unprotected state; detect suspected external changes and do not trust suspect evidence. Same-account commands can access state and ambient data. |
| Ownership | Exactly one controller per host can manage its own concurrent operations. | Competing controller, expired/released credentials and old owner cannot mutate or reclaim authority; no global cross-host lock. |
| Stop/recovery | Actual timeout/cancel/revoke stops the owned work and retains logs/output. | Uncertain stop is UNKNOWN; crash/startup fencing prevents old descendants, duplicate replay and false success; unrelated processes stay alive. |
| Files/Git | Hash conflicts, binary data, recoverable deletion and dirty-tree preservation verified. | Git hooks and helpers inherit command access; uncertain file mutations are reconciled, not blindly repeated. |

Proof records exact source/helper/install revisions, host/backend/toolchain, scope identities/revisions, commands/exits, fixture hashes and stop receipts. Unit mocks, argv planners, compilation and a VM start callback are separate evidence classes, never native boundary PASS.

## Candidate disposition

- `src/hosts/macos-seatbelt-candidate.ts`: restricted profile failed its legitimate-read positive control on the historical tested Mac host with SIGABRT. Do not widen it or classify its crash as a successful denial. This is evidence about that exact candidate, not every possible macOS mechanism.
- `src/hosts/docker-sandbox.ts`: unverified candidate. A Linux container or guest does not establish native macOS/Windows toolchain support or host workspace mutation. No Docker installation is assumed or requested by this plan.
- Existing signed Mac snapshot worker: retain its bounded offline use/evidence while evaluating the required host working model. Do not substitute discarded guest edits for host changes or silently enable host shares.
- File boundary mechanisms require actual positive and adversarial proof. A command confinement mechanism is not required for the accepted personal-use host runner; Seatbelt remains a possible later supplementary layer, not acceptance evidence.

See the [implementation plan](../plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md), [criteria traceability](../plans/CRITERIA-TRACEABILITY.md) and [Mac backend description](MACOS-VM-ISOLATION-DESIGN.md). Windows proof is independent of Mac evidence. All future native experiments require an approved scoped task, disposable fixtures and unchanged original VM media.
