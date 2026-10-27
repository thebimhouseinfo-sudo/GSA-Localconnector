# Persist sandbox-only asynchronous process ownership

Goal: repair the previously recorded persistence+sandbox/no-controller fallback: start_process returns a transient ID while history/stop use the durable manager. Existing criteria6/8 apply; no new milestone or native execution scope.

Reuse the protected command execution path already installed for run_command. Split its internal implementation so an asynchronous starter can return after the RUNNING record is durable, while execution/receipt finalization continue once in the background. Keep a full foreground run API. Snapshot requests before awaits; reserve the shared four-command bound; never start if the journal cannot record intent. Background failure remains UNKNOWN/unconfirmed in history, never a replay or false stop.

Owned files: src/core/durable-process.ts, narrow server start_process/metadata routing and focused existing history tests. No native policy, helper, installer, permission, dependency, VM, original media, gate-state, secret, branch or push changes. Primary routine implementation stays inline due assigned role quotas; independent review at code readiness. This fixes history/control wiring, not native root/descendant containment.

TDD: add failing nonblocking persisted-start, same-ID list/status/stop, terminal receipt sealing, pre-effect journal failure and shared start/run quota tests with a fake sandbox and real disposable journal. Implement minimal routing/internal split; run affected tests, review up to two rounds and project verification excluding the prohibited old native Seatbelt case. Preserve all prior consumed native slots. Runtime update is a later reviewed idle-maintenance step if needed.
