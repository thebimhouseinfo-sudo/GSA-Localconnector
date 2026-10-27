# Mac core resumption — 2026-10-19

User instruction: update the plan/milestones to the confirmed scope, then continue using the established manual harness workflow. This is a revision of remaining P03/P04/P05/P06/P07 work, not new milestones or a request to repeat accepted work. Criteria remains unchanged.

## Delivery order and existing evidence

1. Remaining Mac files: recoverable regular-file update/edit/patch/delete, move/rename, directory copy, then verified installed/native-plugin delivery. Registry/persistence/binding, bounded source-copy and partial capability slices already exist; retain their evidence.
2. Actual-host Mac shell/Git and existing project scripts, with owned process state/log/output/timeout/cancel. Reuse process components; no new CI/DAG engine, workflow manifest requirement or local Project/Job manager.
3. Required interrupted-operation/process reconciliation without duplicate effects. This is core continuity, not a new lifecycle framework.
4. After core Mac works, implement deferred setup/.env, background login startup, Dock Pause/Resume/Quit and full installed Mac acceptance.
5. Windows starts after Mac acceptance. No simultaneous-machine acceptance. Existing source compatibility CI does not certify native behavior.

Keep Linux VM optional; no dedicated VM tests, repair campaign, new guests/media or provisioning. Remove connector support if real-project use fails. No anti-sleep code or external-app integration. GSA receives workspace/ref syntax/schema, actual capability and results only. Harness remains local Codex development configuration and is excluded from GitHub.

## Next bounded coding task: recoverable results through existing file tools

**Goal:** stop discarding transaction observations at the file-tool boundary. Reuse src/core/file-transactions.ts and src/local/file-transaction-store.ts. Provide update/edit/patch/delete through an optional typed recovery adapter while preserving the existing legacy adapter contract and blocked production behavior when the verified native adapter is absent.

**Owner paths:** src/core/native-io.ts, src/core/write-engine.ts, src/mcp/write-dispatch.ts, src/mcp/server.ts for truthful non-success envelopes, and src/mcp/batch-dispatch.ts for per-item outcomes and stop-on-uncertainty; one focused new test file under test/. Native recovery adapter implementation, signed installation binding and native evidence follow as separate dependent slices; do not simulate them as production support.

**Interface:** add an optional recoverable-mutation capability to NativeScopedFiles using the existing FileTransactionOutcome/FileTransactionIntent types. Regular-file replacement accepts the scoped ref, bytes and expected hash; trash accepts the scoped ref and expected hash. A readback entrypoint, if needed, uses an opaque transaction ID. Do not accept arbitrary recovery paths or invent filesystem effects. Avoid changing legacy void methods globally.

**Behavior:** create/copy/mkdir retain existing behavior. For update/edit/patch/delete, select the optional typed path when provided and propagate the full outcome, including transaction ID, status, observations, retained handles and reason. Only APPLIED with verified readback may produce the old success semantics; CONFLICT/UNKNOWN must preserve actual effects and never claim unchanged files, auto-retry or become a generic success. Direct tools use isError:true and {ok:false,code,result:outcome}, with RESULT_UNKNOWN or FILE_TRANSACTION_CONFLICT. Batch items use the same failure code and retained result, stop before the next mutation and report partial/completed truthfully. Capture validated primitive file references before the first await and the intended output hash before handing mutable bytes to the adapter. Keep expected-hash and edit/patch validation before effects. The native adapter owns durable intent before native mutation; the write engine must not invent an intent after the effect.

**Focused checks:** new typed-backend replacement/trash APPLIED outcomes reach the tool caller; CONFLICT/UNKNOWN retain observations/handles and do not fall through to legacy mutation; edit/patch precondition failure starts no transaction; absent optional adapter retains legacy behavior. Use disposable fakes for routing only and do not count them as native/installed acceptance. Existing valid file-transaction/copy/registry/native tests are not rerun unless changed behavior invalidates them. Build is an appropriate changed-source check.

## Dependent file slices

- Implement the Mac recovery adapter against the candidate protocol, validating transaction ID/intent/observations and persisting/readback-mapping uncertainty. Integrate only under a verified root/revision/recovery/artifact-bound installation; missing proof stays blocked. No live credential/state/entitlement writes during source development.
- Close the specific native containment/crash/readback evidence gaps for that adapter using disposable actual-Mac fixtures, reusing unchanged candidate evidence. Then provide a reviewable installation action and refresh the selected plugin for real file operations.
- Add move/rename and bounded native directory enumeration/copy under the approved cross-workspace/reference rules. No ambient recursive Node file operations outside the verified broker.

## Workflow and limits

Manual Planner → Coder → Tester → Reviewer at relevant triggers; one scoped task at a time. Preserve the current branch/dirty work, snapshots before edits, no gate state/signature/checklist completion edits. No push/merge/branch change as a side effect of implementation. Reviewer usage was previously unavailable; record any continued role unavailability rather than silently replacing its assigned model or claiming independent approval. User has explicitly instructed continuation after these scope corrections; do not reopen settled design/execution choices.

Source evidence checkpoint, 2026-10-19: typed recoverable tool routing is implemented and accepted after repair round 1, build exit 0 and 14 focused affected cases passed (0 failures/skips). This is not native recovery or installed file acceptance. Resume at the dependent Mac native recovery adapter/verified installation slice; do not repeat routing, registry/copy tests or Linux VM tests unless later source changes invalidate the specific evidence. No milestone completion marker or gate state is changed.


Recovery adapter checkpoint, 2026-10-21: the coordinator, protected checked installation constructor and guarded loader wiring have passed bounded source review. Constructor repair rejects installation/journal/recovery overlap with every workspace/reference scope, including scopes added later. Production activation remains false; no live installation, identity or plugin capability was changed. A new disposable real-Mac fixture passed signed-helper replace with retained bytes, dropped-acknowledgement UNKNOWN → inspect → APPLIED without replay, and trash with retained bytes. Outside canaries remained unchanged and temporary roots were removed. This is three bounded adapter journeys, not complete confinement/crash/fsync or installed-plugin acceptance. Reuse the existing scoped test logs; do not repeat them. See [native adapter evidence](../reports/2026-10-21-recovery-installation-native-test-report.md) and [constructor audit](../reports/2026-10-21-recovery-installation-test-audit.md). Next: expose authorized transaction-ID readback through MCP, finish missing native evidence and prepare a concrete reviewed installation action; move/rename, directory copy and actual Mac shell/Git remain pending. No milestone or gate is advanced.
