# Synchronous command history implementation plan

> Use executing-plans inline under the existing project workflow. Assigned Planner/Coder/Tester quotas are unavailable; primary prepares this routine continuation without switching their models. Independent Reviewer checks the bounded design and code. No native experiment is authorized here.

**Goal:** Make `run_command` receipts visible through existing process history and retain them across restart when protected persistence is configured.

**Architecture:** Journal the existing verified sandbox.execute path directly inside DurableProcessManager, before effects, preserving its full inline receipt. Reviewer rejected a wait-only alternative because controller.wait/output omit signal/timeout/cancellation/artifact information. Track live synchronous ownership separately from native-controller IDs; cancellation ACK never proves termination. Keep the legacy path only when no persistence is configured.

**Tech Stack:** Existing TypeScript, ProcessJournalStore, MCP dispatcher and fake verified controller tests. No dependency, endpoint, permission, native policy or installer change.

**Spec:** docs/CRITERIA.md §§6–8. Existing full-Mac continuation scope; no new product milestone or criteria change.

## Evidence

`server.ts` sends run_command to transient ProcessManager, but list/status/output choose DurableProcessManager when a native controller or persistence exists. Thus the synchronous receipt's process ID is absent from the very history API returned by that dispatcher and is lost on restart. The runtime's paired VM adapter already implements controller.wait; this wiring does not certify VM or native host containment.

## One task and tests

Own `src/core/durable-process.ts`, a shared validation export in `src/core/process-manager.ts`, the narrow run_command/metadata paths of `src/mcp/server.ts`, and new `test/mcp-command-history.test.ts`. Preserve unrelated dirty edits. Snapshot before editing. Reviewer confirms design before implementation.

1. Add failing fake-sandbox/real temporary protected journal tests for synchronous process visibility, terminal output/status after backend removal, sealed bytes across dispatcher recreation, pre-effect create failure, uncertain execution, scope isolation, and exactly one execute call.
2. Add a foreground run method to the durable manager. Validate requests and reserve the existing four-command bound before awaiting; persist intent and running state before exactly one sandbox.execute. Persist the exact bounded receipt output and existing lifecycle classification. Return its full original receipt. UNKNOWN/errors retain unconfirmed ownership and incomplete output; never replay. Current live synchronous status/output reads use its record, and cancellation uses only its sandbox hook with an unconfirmed ACK. Nonterminal null-native-ID records without a live mapping remain UNKNOWN and never query/stop the native controller.
3. Route run_command through that method only with processPersistence; preserve sandbox/grant/control checks. Metadata must clearly distinguish persisted run_command support from the legacy no-persistence path.
4. Run build and affected tests. Review exact source changes and failures; repair at most two rounds. Required final verification must not rerun prohibited native probes: any native check blocked by consumed scope must be reported honestly instead of silently launched.

## Limits

No production install, sandbox activation, native workload, recovery call, consumed-slot reset, VM/media provisioning, commit or push. This fixes retained command evidence; it does not establish native process ownership, safe revocation, desktop IDLE, or full Mac acceptance. Windows remains deferred.
