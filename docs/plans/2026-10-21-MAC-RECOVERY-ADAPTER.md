# Mac recovery adapter implementation plan — 2026-10-21

**Goal:** connect existing recoverable file-tool routing to the fixed native replace/trash/inspect protocol without advertising unverified native support.
**Architecture:** a small Mac adapter normalizes native observations and persists protected transaction metadata; the existing scoped-files loader supplies only installation-bound transport. Existing runtime-bootstrap calls that loader, so this is an integration path, not a parallel service.
**Tech stack:** existing TypeScript ESM, Node APIs and signed Swift candidate; no dependencies.
**Spec:** [approved resumption plan](2026-10-19-MAC-CORE-RESUME.md), existing criteria for workspace/ref boundaries, recovery and honest capabilities.

## Constraints and review focus

- User already authorized this dependent implementation through manual Planner → Coder → Tester → Reviewer; no new goal, milestone, execution choice or completion checkbox.
- Preserve dirty work and snapshot explicit paths before edits; no state, secrets, live installation, entitlement changes or Git actions.
- Missing native containment/crash evidence remains an activation blocker; a manifest field named verified or a list of checks cannot supply that evidence.
- Lost/malformed replies, stale grants, incomplete observations, journal failures and repeated transaction IDs must never cause mutation replay or false APPLIED.
- Reference grants cannot mutate; readback must authorize the journal-bound workspace and cannot accept caller-provided native paths.

## Bounded coder task

**Source ownership:** create `src/hosts/macos-file-recovery.ts`; modify `src/hosts/macos-scoped-files.ts` and `src/core/native-io.ts` only. New focused test: `test/mac-file-recovery.test.ts`. Retain the accepted routing/store code.

1. Add `readTransaction(transactionId:string):Promise<FileTransactionOutcome>` to the optional `NativeRecoverableFileMutations` interface. Existing implementations/fakes must be accommodated without granting new capability; if compatibility requires it, make this method optional until all implementations supply it.
2. Implement `createMacFileRecovery({registry,store,authorize,invoke})` returning the optional recovery interface. `store` is the existing `FileTransactionStore`; `invoke(ref,request)` is a loader-owned fixed-protocol transport, never an arbitrary executable/path supplied by the caller. Concrete types belong in this module.
3. Capture primitive ref, bytes, hashes and immutable grant/root/revision before the first await. Validate relative path, regular-file size ≤8 MiB and SHA-256 syntax. Require current read/write workspace permissions and durable authorization before effects; recheck the captured binding immediately before native dispatch.
4. Generate a UUID and build the existing typed intent with operation replace/trash, captured source identity/revision, destination null, expected hash and replacement hash (trash after hash null). Await `store.create(id,intent)` before one native mutation invocation. Creation/publication uncertainty must return UNKNOWN with the generated ID and make zero native mutation calls; never retry automatically.
5. Encode only the candidate's accepted keys: protocol, operation, transaction_id, workspace_id, revision, path, expected_sha256 and replacement base64 only for replace. Native roots remain in the verified app binding, not the request. Candidate itself must persist its native intent/staged bytes before capture.
6. Normalize the actual `gsa-file-recovery-v1` envelope against the saved intent. Require exact transaction ID, operation, workspace ID, revision, path, expected/after hashes; native trash empty after hash maps to null. Reject unexpected keys/types, malformed hashes/identities/status/retained handles; candidate retained handles may only be this transaction UUID.
7. Initialize omitted typed observation fields to null, never false. Validate optional native `captured_sha256` and `restored_exclusively` separately; do not substitute captured hash for current source hash. A restored exclusive capture is historical and cannot establish a currently retained handle. Preserve current source/destination hashes and identities only where actually observed.
8. Normalize known HASH_CONFLICT to HASH_CONFLICT; known entry/capture/source-recreated/publication conflicts to ENTRY_CONFLICT; binding/root/authorization failures to AUTHORIZATION_CHANGED; other uncertainty to IO_UNCERTAIN. Only validated APPLIED with VERIFIED_READBACK and the existing typed validator's complete operation-specific evidence can produce APPLIED. Unknown reason values cannot certify success.
9. Persist valid observations with `store.update(...,explicitReadback=true)`; this flag is used only after validating native readback evidence, never as certification by itself. Lost/error/truncated/malformed reply returns UNKNOWN with saved intent/ID, preserves any prior proven effects/handles, and attempts to persist uncertainty. If persistence fails, retain the UNKNOWN envelope; no fallback void mutation or replay.
10. Implement explicit readback by loading the ID from the protected store first, deriving the workspace/ref from its intent, and authorizing/rechecking that binding. Send only `{protocol,operation:"inspect",transaction_id}` to the same bound broker. Reconcile PENDING/UNKNOWN using validated observations; terminal records stay immutable. Missing native journal, changed binding or inspection failure stays UNKNOWN without clearing prior proven effects/handles. Never inspect by caller-provided path or start a mutation.

## Actual loader hook and activation boundary

- In `loadMacScopedFiles`, construct the adapter only through a recovery-specific installation branch, using a fixed private journal below the protected installation directory and a separate bound Recovery Broker app. Existing three-operation installations retain create/mkdir/copy only.
- Validate protected manifest/artifacts, codesign, owner FD3, host/arch, exact workspace ID/root identity/revision, private same-volume disjoint recovery root identity and signed two-root entitlement binding at load and invocation. Preserve existing protected-read/command bounds; do not let recovery failure disable an otherwise valid legacy subset.
- The production branch must remain explicitly unavailable while the required native evidence below is absent. Do not activate it merely by accepting a newly invented proof format/check names, and do not manufacture any local proof/installation files in this task.
- Once evidence and a reviewed installation exist, attach `recoverableMutations` and add update/edit/apply_patch/delete to `supportedOperations` together. Runtime-bootstrap already consumes this object; existing file tools then use the accepted typed route. A public MCP transaction-inspection tool is a separately scoped follow-up; the adapter readback method is the concrete recovery path for that follow-up, not a claim it is already user-accessible.

## Focused evidence and handoff

- New tests: exact native request shape; protected intent exists before transport; replace/trash complete readback; sparse conflict mapping; wrong ID/intent/hash/type/extra field; captured/restored observations; transport loss; store failure before/after effect; stale/ref authorization; readback uses only journal ref; no replay and no terminal rewrite.
- Loader-focused cases: missing recovery installation keeps legacy operations; stale/mismatched recovery roots/artifact/evidence cannot advertise mutation support. Synthetic manifests/transports prove routing only, never native containment.
- Run `npm run build`, then only the new focused compiled test file (`node --test dist/test/mac-file-recovery.test.js`), plus specifically affected tests if interface changes invalidate them. Reuse valid store/routing/native evidence; no Linux VM tests or broad suite reruns.
- Tester records exact cases and limitations; Reviewer checks boundary/receipt/journal invariants and truthful disabled activation. Maximum two repair rounds; unresolved blocking findings return to primary/user.
- Before activation, actual disposable signed-Mac fixtures still need ancestor-relocation containment during effects, interruption/fsync/journal failure/readback mapping, private recovery binding and owner-fencing evidence against the exact artifacts. Reuse unchanged accepted candidate tests. Then prepare a concrete installer diff/action for review; selected-plugin live validation follows installation and refresh, never compilation or mocks alone.

## Implementation checkpoint and remaining loader task

The source coordinator/readback factory is accepted in bounded review with 16 unique passing cases across two runs; the subsequent checked installation constructor and concrete guarded loader wiring are now implemented and accepted after one source repair round. Preserve that evidence; production activation is still false. The instructions below record the implemented scope, not a request to repeat it.

Implement an internal protected recovery-installation loader, reusing existing HMAC-protected scoped-files grant metadata with an optional recovery binding (canonical root/device/inode and separate RecoveryBroker.app artifact digests). It must validate host/arch, per-workspace revision/root identity, same-volume private disjoint recovery ancestry, exact signed Info.plist binding, artifact integrity and codesign before each fixed-protocol invocation. Root and executable paths come only from protected installation data, never native request arguments. Use the existing command bounds and owner FD3. Construct FileTransactionStore at the fixed private file-transactions directory under the installation. Missing/invalid recovery data leaves the legacy subset usable.

Connect that constructor from loadMacScopedFiles behind the explicit production activation boundary; the boundary stays disabled until exact native evidence and reviewed installation exist. Test the lower-level checked installation constructor only in disposable fixtures; do not introduce a user-supplied bypass flag or generate a live proof. Capabilities add update/edit/patch/delete only together with an attached verified adapter; default production remains partial. This task includes concrete guarded wiring, not another diagnostic-only stub.

Review clarification: protected installation/journal ancestry and every recovery root must be physically disjoint from ALL selected workspace/reference scopes, not just the operation source workspace. Check both ancestor directions at construction and invocation, including aliases and scopes bound after construction. Otherwise another authorized scope can read or modify retained versions, proof artifacts or journal metadata. Reject duplicate grant IDs independently of whether a preceding grant has recovery metadata. This implements the existing protected-state/multi-project boundary, not a new product requirement.


## Disposable native evidence — 2026-10-21

The new signed-Mac adapter fixture passed replace/retention, dropped acknowledgement with explicit inspect reconciliation and no replay, and trash/retention. See [report](../reports/2026-10-21-recovery-installation-native-test-report.md). All-scope separation repair and scoped tests are documented in the [constructor audit](../reports/2026-10-21-recovery-installation-test-audit.md). This does not close the remaining native relocation/crash/fsync evidence or authorize live installation/production activation. Public transaction readback is the next dependent source slice; do not repeat accepted suites or Linux VM tests.
