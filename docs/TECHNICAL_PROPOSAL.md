# Technical Proposal — Coder-owned, whole Plan

Status: FINAL (revision 2, Critic CR PASS)
Critic CR: PASS

**Descriptive only.** No source, stub or test files are created by this proposal. It covers every milestone and Task of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), written bottom-up from the Tasks (P-IDs from [MILESTONES.md](MILESTONES.md)). It adds no scope: it describes how the already reviewed sequence maps onto existing code. "VERIFIED" = path/behavior seen in this repository; "PROPOSED" = new design; "UNVERIFIED" = depends on a host fact not yet proven. No accepted DEC files exist under `docs/discussions/`, so none is linked.

## Proposal by milestone

### MILESTONE-M1 — documented Mac boundary decision (Plan PLAN-M1)

#### TASK-P01 — a docs-only decision on what the Mac broker proves and what stays disabled
- **Plan / Criteria / decision refs:** PLAN-M1; CRITERIA §0, §4, §7
- **Files:** REUSE_AS_IS (VERIFIED): `docs/plans/M1-MAC-BOUNDARY-FEASIBILITY.md`, `M1-MAC-HOST-BOUNDARY-DESIGN.md`, `M1-MAC-BOUNDARY-DECISION.md`, `native/macos-files/{broker,tree-broker,recovery-broker}.swift` and their `test-*.py` characterizations. No new files.
- **Functions / interfaces:** none new. Consumers of the decision are P02/P03 (file mechanisms) and P04 (command boundary).
- **Shared dependencies / state / host constraints:** retained-FD authority survives root relocation (reproduced, unresolved); Endpoint Security entitlement absent/unknown — nothing assumed.
- **Tests:** none added; existing signed-broker native runs are the evidence.
- **Exclusions:** no native supervisor, no unrestricted fallback, no entitlement or administrator assumption.

### MILESTONE-M2 — Mac multi-root files (PLAN-M2)

#### TASK-P02 — role-bound roots, full file tool surface, recoverable move and workspace operation log
- **Plan / Criteria / decision refs:** PLAN-M2; CRITERIA §1–§4, §7 (and the "Theo dõi" row: operation logs and diff per workspace)
- **Files:** REUSE_AS_IS (VERIFIED): `src/local/{grants,workspace-cli,identity,mac-owner,file-transaction-store,protected-state}.ts`; `src/core/{workspace,workspace-read,workspace-path,write-engine,file-transactions,edit-guards,unified-patch}.ts` (list/search/read/glob, hash-guarded edit and patch conflict detection); `src/hosts/macos-{scoped-files,file-code,file-evidence,file-recovery,recovery-installation}.ts`; `src/mcp/{server,catalog,write-dispatch,batch-dispatch,runtime-bootstrap}.ts`. MODIFY: `macos-file-recovery.ts`, `native/macos-files/recovery-broker.swift` and the `recoverableMutations` facade in `src/mcp/runtime-bootstrap.ts` (currently only `replaceIfHash`, `trashIfHash`, `readTransaction`).
- **Functions / interfaces:** `move_file` already exists (`catalog.ts`, `write-dispatch.ts`, `write-engine.moveFile`; `FileTransactionOperation` already includes `"move"`). The remaining work is a **recoverable `moveExclusive`** added to `recoverableMutations`, following the move recovery contract that `docs/plans/M1-MAC-BOUNDARY-DECISION.md` still lists as disabled; it stays disabled until that contract is met. Workspace operation log: the criterion is met by a bounded read of `file-transaction-store` and `directory-copy-store` records through the existing `get_file_transaction`/`get_directory_copy` readbacks; a list-style operation-log reader over those same stores is PROPOSED (no new store), and diff outside Git has no owner yet — recorded as an open gap, not claimed.
- **Shared dependencies / state / host constraints:** one authority model (below). Production recovery activation stays false until installed proof exists. APFS races/TCC on installed artifacts UNVERIFIED.
- **Tests:** existing suites VERIFIED present in `dist/test` and run by `npm test`: `grants-roles`, `workspace-roles`, `mcp-workspace-roles`, `workspace-read`, `file-transactions`, `mac-file-code/evidence/recovery`, `mcp-file-transaction-readback`, `recoverable-write-routing`; new cases for recoverable move and the log reader; real-Mac fixture runs for native claims. Negatives: overlap, widening, revocation, reference mutation.
- **Exclusions:** no command execution; no Windows.

#### TASK-P03 — directory copy and working-root A↔B transfers
- **Plan / Criteria / decision refs:** PLAN-M2; CRITERIA §2–§4
- **Files:** REUSE_AS_IS (VERIFIED): `src/core/directory-copy.ts`, `src/local/directory-copy-store.ts`, `src/hosts/macos-directory-{copy,evidence,installation}.ts`, `native/macos-files/tree-broker.swift`. Directory **move** has no interface today (`catalog.ts` exposes `copy_directory` only) and is **not** proposed; it is out of this Task unless CRITERIA requires it.
- **Functions / interfaces:** copy through the tree broker; reference → workspace copy-out only; no writes into references. Shares broker identity, grants and installation separation with P02.
- **Shared dependencies / state / host constraints:** held-parent ancestry races UNVERIFIED.
- **Tests:** existing `directory-copy*`, `mac-directory-*`, `mcp-directory-*` suites (VERIFIED); native interruption/destination suites already recorded, not repeated.
- **Exclusions:** no directory move, no cross-OS copy, no VM shared roots.

### MILESTONE-M3 — Mac execution and evidence (PLAN-M3)

#### TASK-P04 (absorbs P05) — one host command run record: execution, Git and evidence
- **Plan / Criteria / decision refs:** PLAN-M3; CRITERIA §4, §5, §6. The reviewed milestone IDs P04/P05 are kept in MILESTONES.md; this proposal designs them as one Task because they share one record type.
- **Files:** MODIFY (VERIFIED existing): `src/core/native-io.ts` (the seam: `SandboxedProcessRequest`, `VerifiedNativeSandbox`), `src/core/{process-manager,durable-process,process-journal,git-engine,git-plans}.ts`, `src/local/process-store.ts`, `src/mcp/{server,catalog,runtime-bootstrap}.ts`. `server.ts` enables execution tools only when `sandbox?.verified`; `runtime-bootstrap.ts` currently wires them to `src/hosts/macos-vm-runtime.ts` and `docker-sandbox.ts`. A Mac host implementation of `VerifiedNativeSandbox` is PROPOSED as a new file under `src/hosts/` only after M1 selects a mechanism.
- **Functions / interfaces:** one interface — `VerifiedNativeSandbox.execute/start` — with a Mac host implementation behind it, **fail-closed (BLOCKED) until a boundary mechanism is proven**. `executeGit` is reused as a thin command planner over the same interface (not "no engine"): `git_*` tools keep routing through `git-engine.ts`, but its hard-coded `network_allowed:false`, 30 s limit and 1 MB cap are replaced by request-level settings. fetch/pull/push network and credential use is UNVERIFIED and stays a separately permitted capability per CRITERIA §4/§5; until then those plans remain refused.
- **Run record:** the process journal (`process-journal`/`process-store`) is the single owner of command, cwd, inputs, exit, ordered stdout/stderr, outputs and explicit uncertainty; `process_output` reads it. The `ci-store`/`ci-log-store`/`ci-artifacts` modules are REUSE_AS_IS and left untouched, used only for source and artifact capture; the `ci_*` tools and `ci-run-service`/`ci-dag`/`ci-scheduler` stay present but are **not extended and not exposed for Mac host runs** (decision: dormant, not removed, because the Linux CI path is preserved). No connector CI/DAG engine is added.
- **Behavior change and regression oracle:** today `run_command` runs on a disposable Linux snapshot and never copies edits to the host (`catalog.ts` description). After this Task, on Mac, command effects land in the granted host workspace. The catalog description is updated accordingly; the Linux snapshot path remains the optional VM path, and per the 2026-10-19 rule is removed rather than repaired if it fails in real use.
- **Shared dependencies / state / host constraints:** the boundary mechanism is UNVERIFIED (host-command/native-SDK research pending). The gap is a blocker, never an unrestricted fallback.
- **Tests:** timeout and owned cancellation; dirty-Git and non-Git; exit/stdout/stderr truthfulness and no stale results; git planner network refusal; a test that BLOCKED is returned when no verified sandbox exists; real-Mac runs once a mechanism exists.
- **Exclusions:** no connector CI/DAG engine, no VM runner, no multi-OS matrix, no universal test generator.

### MILESTONE-M4 — Mac continuity (PLAN-M4)

#### TASK-P06 — owner fencing, crash/restart/reboot reconciliation
- **Plan / Criteria / decision refs:** PLAN-M4; CRITERIA §6, §8
- **Files:** MODIFY (VERIFIED base): `src/local/{control-lease,process-store,protected-state}.ts`, `src/core/durable-process.ts`, `src/mcp/startup-registry.ts`. `src/core/session-lease.ts` (`SingleControllerLease`) is referenced only by `test/session-lease.test.ts`, not by `src`: it is a leftover duplicate of `control-lease.ts`; PROPOSED REMOVE together with its test so owner fencing has one owner (it changes no runtime path).
- **Functions / interfaces:** fence the prior owner before reconciliation; terminal results immutable; unreconciled work reported UNKNOWN, never replayed. Reuses P02 journal/readback semantics and the P04 run record.
- **Shared dependencies / state / host constraints:** power-loss and failed-fsync durability UNVERIFIED.
- **Tests:** competing/expired/revoked controllers; real crash, restart, reboot, wake.
- **Exclusions:** no automatic mutation replay.

### MILESTONE-M5 — complete Mac acceptance (PLAN-M5)

#### TASK-P07 — installed artifact, background lifecycle and per-host acceptance
- **Plan / Criteria / decision refs:** PLAN-M5; CRITERIA §1–§8, §10
- **Files:** REUSE / MODIFY (VERIFIED existing): `scripts/mac-package.mjs`, `mac-desktop-*.mjs`, `desktop-*.mjs`, `install-mac-scoped-files.mjs`, `start.command`, `native/macos-desktop/`, `native/macos-files/`; related `test/mac-desktop-*`, `test/desktop-*`.
- **Functions / interfaces:** signed installed package, post-login background start without Terminal, saved setup, Pause/Resume/Quit, selected-plugin routing.
- **Shared dependencies / state / host constraints:** begins only after P02–P06 are verified; TCC identity repair history is in `docs/plans/2026-10-26-MAC-DESKTOP-TCC-IDENTITY-REPAIR.md`.
- **Tests:** fresh installed-artifact acceptance recording source, artifact and toolchain identity; multiple concurrent projects; non-Git and hybrid flows.
- **Exclusions:** no Windows evidence.

### MILESTONE-M6 — complete Windows acceptance (PLAN-M6)

#### TASK-P08 — Windows implementation after Mac acceptance
- **Plan / Criteria / decision refs:** PLAN-M6; CRITERIA §9
- **Files:** NOT PROPOSED. By the approved sequence there is no Windows feasibility or detailed design before M5 is accepted; `src/hosts/windows-appcontainer-candidate.ts` is VERIFIED existing but only a historical candidate.
- **Functions / interfaces:** the same MCP tool groups; the Windows backend is designed after M5.
- **Shared dependencies / state / host constraints:** all Windows host facts UNVERIFIED.
- **Tests:** deferred.
- **Exclusions:** everything until M5 acceptance.

## Cross-milestone view
- **One authority model:** grants/identity/`control-lease`/protected state are shared by P02, P03, P04 and P06 (`session-lease.ts` removed as unused); no task introduces a parallel permission or ownership store.
- **One process model:** P04 (with P05) and P06 share `process-manager`/`durable-process`/`process-store`; the process journal is the only run/log record.
- **Ordering:** P01 → P02/P03 → P04 (incl. P05) → P06 → P07 → P08, matching the milestone dependencies. P04 is the highest-risk task because its boundary mechanism is not selected.
- **Risks:** retained-FD relocation (P01/P02/P03); command boundary without a proven mechanism (P04); durability beyond process interruption (P06); installed-artifact behavior differing from source tests (P07).
- **Preserved, not extended:** the Linux VM worker (`src/hosts/macos-vm-*`) stays optional and unverified; original media untouched.

## Critic CR record
**Round 1 — CHANGES_REQUIRED** (independent Critic, PRE_CODE_TECHNICAL, revision 1). Findings, all checked against source and accepted:
1. P04 omitted the real chain (`native-io.ts`, `git-engine.ts`, `git-plans.ts`, `server.ts`/`runtime-bootstrap.ts`, catalog descriptions) → revision 2 lists them, reuses `executeGit` as a planner and keeps network/credential Git gated.
2. P04/P05 duplicated ownership and left the `ci_*` engine undefined → merged into one run record owned by the process journal; `ci_*` dormant.
3. Move was already implemented; the real gap is recoverable move; P03 title promised directory move → P02 restated, directory move dropped.
4. "Theo dõi" operation-log/diff obligation had no owner → P02 owns a log reader over existing stores; non-Git diff recorded as open gap.
5. `session-lease.ts` duplicate → proposed REMOVE.
6. P04 lacked a design → minimal interface, fail-closed, regression oracle added.
7. Test set → itemized; the named suites exist in `dist/test` and run by `npm test`.
**Round 2 — PASS** (same independent Critic, revision 2). All seven fixes re-verified against source; no blocking finding. Non-blocking notes carried into implementation:
- Non-Git diff has no owner; report it to the user as an open gap at M2 acceptance, never silently.
- `ci-*` stores are untouched (REUSE_AS_IS), as now stated in P04.
- The operation-log reader is a read-only tool, added to the read-tool list near `server.ts:351` so it needs no execute grant.
- If M1 finds no boundary mechanism, P04 raises HUMAN_ESCALATION; the boundary is never relaxed.

## P02 continuation — exact accepted Mac27 recovery evidence linkage (2026-10-28)

Delta Critic CR: PASS — step1 only, independent PRE_CODE_TECHNICAL review2026-10-28. Step2 remains descriptive/PENDING and requires its finalized layout/CR before source. Existing whole-plan approval above remains historical. This continues the existing regular-file recovery/installer outcome, not a new product goal or milestone. Criteria remain immutable.

Authority: docs/plans/2026-10-27-MAC27-RECOVERY-QUALIFICATION.md, especially “Required verifier and installer integration after qualification”; actual independently accepted native evidence docs/reports/2026-10-28-mac27-recovery-native.md and its retained archive. Human explicitly authorized one disposable native run; it completed once, slot consumed, no production activation. The next source work is ordinary authorized completion; any production maintenance or additional native run remains separately bounded.

### Current facts and smallest delivery order

The production checked recovery constructor already verifies HMAC, BASE evidence, exact grant/root/revision/inode, signed recovery artifacts, entitlements, FD3 and final durable authorization. It does not consume a recovery qualification certificate. macFileRecoveryActivation() currently always returns false. The installer only publishes BASE support. We must bind existing recovery to the exact accepted native artifact without creating a general evidence framework or weakening BASE checks.

1. First implement/test a small pure exact-evidence validator only. Keep production activation false and every existing loader behavior unchanged in this delivery. Its downstream consumer contract is defined below so it cannot become a claimed activation flag.
2. Next wire that validator into the existing checked loader and stopped-owner installer together, then qualify the installed plugin with disposable roots. No claim that step1 alone completes recovery/Mac. Do not automatically re-enroll stale user roots or change the approved host shell/Git boundary.

### Step1 code structure and contract

CREATE src/hosts/macos-recovery-evidence.ts and test/mac-recovery-evidence.test.ts. Export requireMacRecoveryQualification(reportBytes: Uint8Array, build: unknown), returning a readonly qualified build/qualification digest and explicit limitations. This is a bounded pure validator with zero I/O/process/signing/secret/activation effects. Reuse crypto SHA256 and util equality; no dependency.

Input must be at most512KiB before parse/hash, valid UTF8 JSON, and exactly match the reviewed worker-report bytes SHA256 ee918da1ad707489454f49e2180fe048659859a53c213555e23aa62e9c46471b. That immutable accepted report is the narrow trust anchor, not a caller-supplied report hash, boolean, check-name list, or a generic certificate registry. Tests use the exact archived synthetic report as a versioned test fixture (CREATE test/fixtures/mac27-recovery-qualification.json); no production keys/identity or receipts are embedded. Raw native receipts were independently hash-checked and remain archived; runtime does not rerun a22MiB receipt audit on every mutation.

Validate the pinned report's format/state/phase/activation:false, setupComplete/controlReleased, empty unresolved, worker134-child counts/17broker schedule (the independent owner audit observed135 merged children; this is historical acceptance provenance, not a worker-report field) and production-vs-diagnostic distinction. The caller's build must exactly equal report.builds.production and match accepted source6b5debec…fe0fab8/release95817c08…1b5a8a31/code04682024…5a596205, darwin27.0.0/arm64 and two-root signing profile. Reject diagnostic/recompiled/drifted build, omitted fields, malformed/oversized/trailing/non-UTF8 input, caller-selected hashes and any report byte change. Do not accept the report merely because its state string is green. Return limitations as fixed facts: relocation pre-capture-read denial with zero claimed capture/publication/restoration syscalls; constructed states structural only; injected sync diagnostic only; private compiler descendants/power-loss UNVERIFIED. No native rerun or installation during tests.

Test-first: fail missing validator interface honestly as an interface gap, then positive exact accepted input and adversarial mutations of bytes/build/diagnostic/size/limitations; final build/npm test. Existing tests remain untouched. Error code RECOVERY_EVIDENCE_INVALID. A returned value confers no filesystem authority.

### Defined downstream consumers — step2, not source implementation in step1

MODIFY src/hosts/macos-recovery-installation.ts: require proof.recoveryQualification as the exact report string plus proof.recoveryBuild; call validator before accepting any recovery binding. Keep original BASE validators and every scope/ancestry/revision/signature/FD3/durable-authorization check. A missing certificate preserves only BASE support in the outer loader. Reference bindings still cannot have recovery metadata. Existing synthetic positive-loader fixtures will gain the exact accepted report/build; all existing negative assertions remain.

MODIFY scripts/install-mac-scoped-files.mjs: add a supported stopped-owner recovery publication path which reads a reviewed retained qualification archive (bounded owned regular non-symlink files), validates exact worker report and production build/release hash, copies the exact qualified binary rather than recompiling, signs per selected writable-root binding using only existing two-key App Sandbox profile, checks signature/normalized code/artifact hashes and same-volume private recovery/root separation, and publishes ordinary HMAC v2 metadata with rollback under the same held owner fence. Preserve valid BASE build/evidence and reference restrictions. Fail before publication on source/build/code drift, stale grants or lost fence. Reuse current installation publication/rollback and private-journal conventions, no hand-copying live keys/proofs or global permission changes. Physical recovery roots use deterministic private children outside every grant, validated by inode/ancestry; exact naming/layout and crash publication ordering must be finalized with the existing installer source before step2 CR/source, rather than improvised here.

MODIFY src/hosts/macos-scoped-files.ts in step2 only: replace blanket recovery hold with capability through the checked qualification-backed constructor; advertise update/edit/patch/delete only when that actual constructor succeeds, preserving BASE fallback and transaction readback. No boolean-only activation, no move/directory/shell/Git enablement. Update focused evidence/loader/installer/facade tests and independent review before any supported production maintenance/native installed journey. Those changes require step2's completed descriptive source layout/CR; this proposal intentionally authorizes only the complete small step1 validator now.

Exclusions: no Criteria edit, new milestone, native retry/allowance reset, BASE rebuild, unrestricted shell/VM, production installation mutation, API expansion or general provenance service. P04 and full installed Mac acceptance remain pending.

## P02 continuation step2a — checked loader qualification and code binding (2026-10-29)

Step2a Critic CR: PASS — independent PRE_CODE_TECHNICAL round3, including both appended test-design corrections. Scope is the next small deliverable of the existing P02 recovery linkage. Step1 code has independent Reviewer PASS, activation remains false. No installer publication or new native journey is authorized by this source task. Step2b's installer layout/publication remains separately pending; no product completion claim from step2a.

### Exact source changes and callers

MODIFY src/hosts/macos-recovery-installation.ts: extend its internal trusted RecoveryInstallationIO with required normalizedCodeSha256(binary:string):Promise<string>. Existing protectedRead/protectedDirectory/command/authorize remain. The caller owns this IO authority already; this is a code-verification primitive, not a caller-selected evidence or production test switch. Every manifest read must require proof.recoveryQualification as the exact accepted report string (UTF8 bytes <=512KiB), proof.recoveryBuild and requireMacRecoveryQualification; require its host_release/arch to equal the current proof/runtime host. BASE validators unchanged. Recovery bindings gain code_sha256, required equal to qualified production code digest. Retain existing artifacts/signature/two-root-entitlement/physical ancestry and same-volume checks. checked(id) must call normalizedCodeSha256 for the actual fixed RecoveryBroker executable and compare to the qualification code hash, then perform existing manifest/root rechecks and final authorize fence before broker dispatch. HMAC-valid report/build/code rewrites, wrong binary code or code changes after construction fail before broker dispatch. No replay, no root widening.

MODIFY src/hosts/macos-scoped-files.ts: extract the existing private BASE validation scratch-copy/codesign-remove-signature/normalizedStrippedMacFileCode logic into private normalizedCodeSha256(binary). It uses a canonical owned0700 temporary directory, exclusive copy, fixed codesign command, bounded protected byte read and finally cleanup of its explicit scratch only. Reuse for BASE validation and pass as trusted IO to recovery constructor. Preserve global macFileRecoveryActivation().available:false throughout step2a. The production facade therefore cannot advertise recovery yet. No new exported host permission, plugin API or generic service.

MODIFY test/mac-recovery-installation.test.ts: existing synthetic fixture loads the exact accepted versioned report from test/fixtures/mac27-recovery-qualification.json independent of cwd, supplies exact build and qualified recovery.code_sha256; its trusted fake normalizedCodeSha256 returns that fixed code digest by default, can be changed for negative cases, and records actual binary argument. These remain explicitly synthetic IO tests, not native code-signing evidence. Preserve all existing positive/negative assertions, HMAC/root/grant/artifact/FD3/revocation/race tests. New test-first negatives: missing/changed report, diagnostic build, wrong/missing binding code, oversized certificate, actual-code mismatch at construction, actual-code drift after construction, certificate rewrite during awaited code verification and durable revoke during code verification. A positive verifies the fixed executable was independently code-checked. Existing outer-activation-false assertion remains.

REUSE src/hosts/macos-recovery-evidence.ts and normalizedStrippedMacFileCode unchanged. No dependency, Criteria, policy, state or native Swift changes. Legacy native qualification drivers are retained as historical versioned evidence recipes: their old proof/IO cannot bypass the new qualification requirement; do not rewrite or rerun the exhausted Mac27 recipe merely to adapt its direct constructor calls. The audited production Swift artifact/code remains unchanged.

### Downstream installer boundary (still pending step2b design/source)

The supported installer must publish qualification report/build plus recovery.code_sha256 only after it copies the exact qualified release and verifies signature/normalized code for each root, all-scope/same-volume separation, private journal/recovery roots, current durable grants and stopped-owner fence. Proposed deterministic private recovery roots belong to an installation generation outside all selected grants; different-volume cases require an explicitly supplied eligible private recovery root or fail closed. Staging/publication must preserve historical recovery journals and retained evidence across replacement; do not delete previous generation trees, auto-reenroll stale roots or replace active owner state. Full crash-order/rollback layout and CLI/desktop consumer will be finalized for step2b before its CR/source. Global activation remains false until that complete path is tested and reviewed.

### Verification and exclusions

Run red integration tests against old constructor, minimal change, build, focused existing recovery/BASE/validator suites and full npm test. Independent Tester and Reviewer check exact invocation ordering and no bypass. Real codesign/installer/plugin effects remain UNVERIFIED; no repeat of consumed native attempt. No milestone or per-task checkbox completion. This is normal implementation of accepted P02, not a new theory/design choice for Human.

### Step2a CR round1 response — portable synthetic host tests

Critic identified that exact27.0.0/arm64 qualification would make existing synthetic success/race fixtures reject on other Darwin hosts. Classification for code delivery: test-design gap to resolve, not grounds to relax runtime host checks. User explicitly prohibits weakening existing tests; prefer preserving their execution and assertions over skipping their coverage on other Mac releases.

The existing constructor fixture already mocks signatures/entitlements/native execution and cannot claim real host acceptance. Make its synthetic host equally explicit: t.mock.method(os,"release",()=>"27.0.0") at fixture entry; capture/restore process.arch's configurable descriptor with Object.defineProperty in test-only setup/teardown to provide arm64 consistently on supported Node22 (no production host override, no mock.property dependency). Tests in this file are sequential; t.after restores the original descriptor and mock tracker restores os.release after each test. Existing non-Darwin skips remain unchanged; do not add new skips. Rename the existing positive host-test wording to say synthetic qualified host and retain its checks against the fixture's simulated runtime. Add explicit mismatching-release and mismatching-architecture negatives after fixture setup: restore/set a different runtime field and assert rejection before signing/broker dispatch. Do not execute a native binary or signing tool inside this fixture. The pure validator tests stay portable without host mocking. Production constructor continues to compare actual runtime/proof/qualification fields with no injectable override.

### Step2a CR round2 response — one fixture-host restoration per test

Critic reproduced a teardown leak when fixture(t) is called twice in one test. Correct the description: a test-local module WeakSet keyed by the TestContext makes qualifySyntheticHost(t) idempotent. On the first call only, capture the ORIGINAL process.arch descriptor, register exactly one t.after restoration and one t.mock.method(os,"release",...). Additional fixture(t) calls in the same test do not capture/mock/register again. Existing repeated-fixture test continues to run all assertions. Add an explicit nested/disposable test of the setup helper or equivalent test-only lifecycle assertion that two fixture setups register only one restoration and leave original architecture after the test. No host override in production. Reviewer classified round1 host-fixture issue BLOCKING for the old test design against Criteria5/8, not a current runtime bug; runtime checks stay strict. Round2 teardown issue is likewise a test-design correction, with its concrete two-capture reproduction retained; source still untouched before final CR.

### Step2a implementation integration correction

Full verification exposed an existing test-only caller absent from the first focused run: test/helpers/mac-scoped-candidate.ts makes an in-memory module copy and replaces the old BASE hash comparison for signed synthetic C adapter fixtures. Extracting normalization moved that exact literal, so17 BASE/copy/separation positives failed Broker release code changed (full560/540/17/3). MODIFY that helper only to match the new comparison exactly once, retaining the actual awaited normalizer and skipping only the synthetic zero-code-hash comparison as before. Fail explicitly if the unique source boundary is absent. No production candidate flag, weakened runtime verification or removed assertion. This is a test-consumer adaptation, not installer/activation scope. Include all three signed-C adapter suites in final focused and independent retest. The release-mismatch negative is strengthened to demonstrate a valid BASE26.0.0 evidence before the immutable recovery27.0.0 comparison rejects it. Record both initial failure and final retest, with native C adapter effects distinguished from Swift qualification.
