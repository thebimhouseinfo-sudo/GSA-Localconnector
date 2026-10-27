# Mac Consolidated Batch Repair Implementation Plan

> **For agentic workers:** Use the assigned project roles and the existing approved execution method. This is a proposed maintenance plan; the primary records approval before activation. No source fixes occur during the audit phase.

**Goal:** Repair all confirmed, in-scope defects from the comprehensive audit while preserving the approved Mac product goal and criteria.

Current execution checkpoint13:41Z: all nine groups implemented with regression code; final static Reviewer ACCEPT. Latest explicit user continuation window13:33:38–14:03:38Z supersedes earlier08:22 deadline below. Single consolidated Tester pass now authorized; no source edits while it runs. Any failures are collected together before another repair batch, never repaired during the running pass.

Execution is authorized by the user's current audit-first/batch-fix instruction. Regression code may be written, but no build/test command executes until every assigned repair group is complete. The final verifier MUST retain the consumed-native exclusion: `NODE_OPTIONS='--test-skip-pattern=^Seatbelt.native.candidate.permits.own.workspace.and.denies.sibling.read/write$' node harness/verify.mjs .`; never invoke the unguarded shorthand below. Existing owned Node unit-test child lifecycles are permitted; consumed release-native probes are not.

**Architecture:** Keep existing connector interfaces and fail-closed authorization. Repair desktop component ownership and recovery, route workspace reads through one descriptor-based bounded reader, and repair local persistence and the historical test fixture. Complete every source/test-code change before one consolidated verification pass.

**Tech Stack:** TypeScript ESM / Node >=20, existing Python 3 standard library, existing macOS Swift sources; no dependencies added.

**Spec:** `docs/CRITERIA.md` §§3–8; existing approved goal and primary's audit classification; prior evidence `docs/reports/2026-10-25-whole-test.md` and `docs/reports/2026-10-25-whole-test-mjs.md`.

## Global Constraints

- User-required sequence: audit ALL first; batch-fix ALL confirmed in-scope bugs; ONLY THEN one consolidated test pass. Write regression test code during repairs, but do not execute TDD, builds, tests, or native probes during the repair phase.
- Preserve existing pending Mac changes. Snapshot each task-owned file before editing. No criteria, goal, milestone, harness-policy or permission changes; no checkbox completion by hand.
- No real grants, identity, secrets, `.env` access, production activation, installation, process control of live services, new dependencies, or external services.
- MANUAL_ONLY push. No push/fetch, merge/rebase, branch changes, history rewrite or automatic integration.
- Active window remains 07:52:13Z–08:22:13Z on 2026-10-25, including delegated work; maximum five review/repair rounds per role pair. At either limit preserve checkpoint, report remaining work, ask explicit continuation, and wait.
- Findings require a violated criterion and evidence. Static confirmation is not native acceptance. Never claim the reader repair establishes retained-FD host confinement or complete Mac acceptance.

## Audit Ledger and Acceptance

| ID | Confirmed defect / criterion | Observable acceptance |
| --- | --- | --- |
| L1 | Legacy package uninstall can remove the shared desktop runtime collection or control the shared launch label without verifying component ownership (§8). `scripts/mac-package.mjs:31`, desktop location `scripts/mac-desktop-install.mjs:128`. | Removal/control is restricted to verified owned legacy components; sibling desktop runtimes and foreign/shared registrations are preserved or operation refuses. |
| L2 | Private-file helper O_EXCL lock survives interruption, permanently returning FILE_BUSY (§8). `scripts/mac-desktop-private-file.mjs:99–104,145–159,189`. | Interrupted writer cannot strand future cooperating writes; live cooperating writers remain serialized; symlinks, unsafe files, changed identities and unsafe ancestors remain rejected. |
| L3 | Explicit setup rejects malformed but safely owned private configuration before prompting (§8). `scripts/desktop-terminal-setup.mjs:57–60`. | Explicit replacement repairs CONFIG_INVALID using verified original identity; unsafe files still refuse; cancellation/stale identity preserves original bytes. |
| L4 | Setup readiness omits installation-ID match because of boolean precedence (§8). `scripts/mac-desktop-install.mjs:183`. | Both RUNNING and SETUP_REQUIRED require current staged installation identity; mismatched status cannot succeed. |
| R1 | Protocol workspace read consumers reopen checked paths and perform insufficiently bounded reads (§§3,7). | Canonical root pin plus nofollow retained-directory walking, nonblocking bounded leaf reads and chain revalidation occur before returning bytes; changed roots/ancestors, symlinks and special files fail without output. |
| R2 | Glob/search limits can silently truncate observable results (§§4,5). | Responses explicitly communicate actual truncation while preserving existing schemas/behavior where complete; boundary cases distinguish exactly-at-limit complete results from omitted results. |
| P1 | Grant lock cleanup may unlink a replacement lock (§7). `src/local/grants.ts`. | Cleanup removes only its own verified lock identity; replacement remains intact and no foreign lock is removed. |
| P2 | FileTransactionStore.load accepts malformed UTF-8 through nonfatal decoding (§8). `src/local/file-transaction-store.ts`. | Invalid UTF-8 is rejected without creating a normal transaction result; valid records retain current behavior. |
| T1 | Historical MJS unit test depends on a lost temporary intent fixture (truthful verification evidence). | Unit test creates/owns its isolated fixture or uses a durable synthetic input; it has no dependency on an archived `/tmp` intent and does not invoke a native scenario. |

Audit IDs are plan-local labels for this batch; the primary retains final classification authority. No additional product features are introduced.

## Review Focus

- Interruption while holding a private-file write lock: later writes recover without taking over an active writer (Coder A regression code).
- Coexisting legacy and desktop installations: legacy operations preserve desktop runtimes and refuse unverified launch ownership (Coder A regression code).
- Root/ancestor/leaf replacement during reads: withhold output if any retained path chain changes (Coder B regression code).
- Special files and oversized input: bounded nonblocking reads never hang or emit excess content (Coder B regression code).
- Replaced grant lock, malformed transaction bytes and missing archived temporary input: preserve ownership and report truthful failures (primary regression code).

## Task 1 — Desktop Existing-Behavior Repairs

**Owner:** Coder A. **Files:** `scripts/mac-package.mjs`, `scripts/mac-desktop-private-file.mjs`, `scripts/desktop-config.mjs`, `scripts/desktop-terminal-setup.mjs`, `scripts/mac-desktop-install.mjs`, and focused desktop test code only.

**Interfaces:** Preserve current exported installer/private-file/config APIs and return envelopes. Repair L1–L4. If verified config identity must be carried internally, preserve credential redaction and do not expose credentials in reports.

- [ ] Snapshot owned files; implement narrowly scoped repairs for L1–L4, maintaining safe refusals.
- [ ] Write focused synthetic regression test code covering the acceptance rows; execute no tests/builds/native probes.
- [ ] Report exact files, acceptance coverage, assumptions and remaining limitations to primary. Do not edit another owner's files or revert their changes.

## Task 2 — Workspace Read and Truncation Repairs

**Owner:** Coder B. **Files:** new `src/core/workspace-read.ts`, read consumers and glob/search in `src/mcp/server.ts`, and focused read/glob/search test code only.

**Interfaces:** One internal TypeScript ESM helper supplies bounded workspace reads using embedded Python 3 standard library. Use existing workspace grants and explicit canonical-root identity pins; no invented private project APIs. All applicable protocol read consumers share this helper and retain existing public tool envelopes.

- [ ] Snapshot owned files; implement nofollow `dir_fd` directory walking, nonblocking bounded regular-file reads and retained chain/root revalidation before output. Reject symlink, root, ancestor or leaf substitutions and withhold any buffered output on failed revalidation.
- [ ] Route all relevant read consumers through the helper and repair glob/search truncation reporting without altering authority.
- [ ] Write regression code for ordinary reads, symlinks, temporary path replacement, FIFO/special-file handling, bounds and truncation; execute no builds/tests/probes.
- [ ] Report exact coverage and boundary limits. Descriptor retention does not prove host namespace containment against all future relocation; do not claim that architecture gap is solved.

## Task 3 — Persistence and Archived Fixture Repairs

**Owner:** Primary. **Files:** `src/local/grants.ts`, `src/local/file-transaction-store.ts`, related persistence test code, and the one historical MJS unit fixture/test identified in the whole-test report only.

- [ ] Snapshot task-owned files; make grant cleanup conditional on retained/visible identity and use fatal UTF-8 decoding for transaction loads.
- [ ] Replace the unit test's missing historical temporary intent dependency with a disposable synthetic fixture; preserve original native artifacts and historical evidence.
- [ ] Write corresponding regression code without executing builds/tests; consolidate ownership reports from Tasks 1–2.

## Task 4 — Single Consolidated Verification and Review

**Trigger:** All source changes and regression test code for Tasks 1–3 are complete and the primary has closed audit classification. No intermediate execution is authorized by this plan.

**Tester:** Assigned project Tester; **Reviewer:** assigned project Reviewer. They use configured models/efforts; unavailable means BLOCKED, not substitution.

- [ ] Tester runs one consolidated source pass: `node harness/verify.mjs`, harness self-test if not included, plus all relevant standalone MJS unit suites from the existing 19-suite inventory. Capture exact commands, counts, skips and failures, including pre-existing failures. Avoid duplicate execution when the full verifier already covers a check.
- [ ] No native test scripts, login registration, installation, live connector mutation or plugin authority changes. Source/unit results are not native or installed-plugin PASS.
- [ ] Reviewer compares the complete batch and saved Tester evidence with L1–T1 acceptance. Classify findings BLOCKING / OUT_OF_SCOPE / UNVERIFIED with source evidence and violated criterion. No new test/review loop merely to improve counts.
- [ ] Any failed required check or review blocker remains explicit. Primary may coordinate a bounded repair only within the active window and user sequencing; additional execution after the single pass requires explicit resolution of that conflict, not silent retesting.
- [ ] Primary records final evidence and pending gates using existing gate commands/finish workflow, without changing milestone configuration or declaring full product completion.

## Explicitly Unresolved / Outside This Batch

- Observed WORKSPACE_ROOT_CHANGED is expected fail-closed handling: current root device differs from historical identity. Do not auto-pin or renew grants, infer a boot cause, or claim identity continuity.
- Dock identity, Pause/Resume/Quit, robust native lifecycle restart and host execution containment are deferred feature/architecture gaps; they are not fixed by this maintenance batch.
- Optional VM executable-loss behavior remains separate from this batch and cannot be used to expand VM work.
- No assertion of native retained-FD containment, installed-plugin acceptance, full Mac completion or Windows support follows from source repairs.

**Why this revision serves the original goal:** It consolidates confirmed maintenance defects found before repair, preserves the user's audit-first/batch-fix/single-pass sequence, and keeps major deferred capabilities separate without weakening any approved criterion.
