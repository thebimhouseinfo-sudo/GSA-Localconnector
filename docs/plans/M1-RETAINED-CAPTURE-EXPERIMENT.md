# M1/P01 — retained-capture counterexample experiment

Status: **scoped manual research continuation approved; exact fixture patch must be reviewed before native execution**. This plan authorizes no production change or capability enablement. It implements the next experiment in [Mac boundary design](M1-MAC-HOST-BOUNDARY-DESIGN.md), not a production compare-and-swap algorithm. The valid [13-case broker characterization](../reviews/2026-10-18-MAC-BROKER-CHARACTERIZATION.md) is reused without rerun. Mac only; Windows waits for accepted M5.

## Deliverable and limits

Create only `native/macos-files/test-retained-capture.py`. Python standard library embeds one tiny C helper, writes/compiles it inside a new private temporary directory and orchestrates deterministic helper/writer subprocesses. No source module, production broker, dependency, VM media, mount, account, installation, network, global configuration, grant or harness state/config changes. No gate signing or task checkbox changes.

The fixture is deliberately ordinary unsandboxed test code manipulating synthetic files. It does not establish an authority boundary, protected recovery storage, atomic content CAS, complete move/Trash semantics or crash/power-loss durability. Recovery inside the private fixture models filesystem behavior only; a full-RW project process could access a recovery folder inside its workspace. Its success cannot enable `replaceIfHash` or complete M1.

This new fixture is outside the currently installed electronic gate path list. Report its reviewed source hash and manual evidence explicitly; do not claim existing gate hashes cover it or modify gate configuration to make that claim.

## Implementation contract

Use `tempfile.mkdtemp(prefix="gsa-retained-capture-")`, canonicalize and chmod0700, record its device/inode, and require the existing filesystem to report APFS. Each case gets fresh directories and known identities; all rename participants are on that existing volume. No attempt to provision/format a volume if unsupported. Fixture ordinary files use fixed small byte patterns and mode0600; no real projects or credentials are input.

Resolve existing clang with `/usr/bin/xcrun --find clang`; record launcher, resolved executable/canonical target/version and SHA-256 where readable, plus SDK path/version via the existing xcrun tool. Compile the embedded source into the private directory:

```text
<resolved-clang> -std=c11 -Wall -Wextra -Werror <private>/helper.c -o <private>/helper
```

Use only public headers/APIs: `open/openat`, `read/pread/write/pwrite`, `fstat/lstat`, `close`, `fsync`, `renameatx_np` with `RENAME_EXCL`, and process/stdio facilities. No RENAME_SWAP, private flags, shell execution, permissions manipulation of captured files or blanket rename-overwrite fallback. Record actual rename return value and errno immediately; ENOTSUP/unsupported behavior is a reported unsupported experiment, not a successful denial. Header availability alone is not runtime proof.

The C helper receives only fixture directory paths/expected identities and a fixed case operation, opens directories without following symlinks, then emits newline-delimited JSON events. Events include operation, phase, return/errno and device/inode/size where applicable. Use fixed protocol words and numeric fields to avoid a new JSON parser dependency: the parent sends newline acknowledgements on stdin; the helper emits READY/operation-result events and waits at named pause points. Python parses/checks every response, keeps stdout/stderr separate and records actual child exit/signal. Protocol parse failure is failure, never an expected filesystem denial.

Capture is `renameatx_np(sourceDirFD,"input",recoveryDirFD,"captured",RENAME_EXCL)`; publication is `renameatx_np(stageDirFD,"new",sourceDirFD,"input",RENAME_EXCL)`; restoration exclusively renames captured back only when the source name is absent. Directory/file names are fixed relative names in fresh case directories. Keep captured entries and open descriptors until observations complete. A second Python subprocess holds the original file descriptor for late writes or performs named external edits/recreations after receiving its barrier command. Synchronize with pipes/events, never timing sleeps.

## Cases and meaningful oracles

Each case records exact before/after small bytes (or base64), hashes, identities and namespace entries. Outcome labels describe observations: EXPECTED_EFFECTS, CONFLICT_OBSERVED, UNKNOWN/PARTIAL_OBSERVED, UNSUPPORTED or FAIL. No production APPLIED or coherent-snapshot verdict is invented.

| Case / deterministic ordering | Assertions against real OS effects |
| --- | --- |
| Stable capture/publish | Capture old input, stage new bytes, publish exclusively. Host pathname contains new bytes; recovery contains old bytes; inode identities show which entry moved. Both syscall successes and namespace changes must be recorded. |
| External edit before capture | Read expected initial hash; pause; writer replaces or edits input to different known bytes; acknowledge; capture. Captured bytes/hash mismatch expected; preserve captured user bytes. Restoration into an absent path may succeed exclusively and must restore the captured identity, not stale initial bytes. Never publish a false matching-content success. |
| Open-FD late write | Writer opens old input before capture and reports FD identity; capture/publish; writer pwrite/fsyncs through that FD. Recovery inode must receive late bytes while published inode remains separate. Keep recovery entry until writer closes. Failure if captured entry is deleted prematurely or reported immutable. |
| Writer during copy/hash | Initial bytes are `A0+B0`; parent reads first half `A0`, then writer writes first half `A1`, then second half `B1`, with acknowledgements; parent finally reads `B1`. Assert observed copied bytes `A0+B1` differ from every actual complete source state `A0+B0`, `A1+B0`, `A1+B1`. A hash matching the copied bytes proves only those bytes, not a coherent source snapshot. This counterexample must prevent any coherent-snapshot/APPLIED claim; no real snapshot primitive is implemented. |
| Recreate before publication | Capture old input, pause, external writer creates a new input with distinct bytes, then publish. Rename must fail with actual EEXIST; source user inode/bytes unchanged, staged new bytes and captured bytes retained. A publish success overwriting the recreated entry is FAIL. |
| Recreate before restoration | Force captured hash mismatch; before restoration external writer creates input. Restore must fail EEXIST, preserve user input and captured version, and report actual partial namespace effects. No overwrite rollback. |
| Crash after capture | Helper emits completed-capture identity/result then waits; parent terminates only that known helper, waits, opens a fresh readback process. Original name absent and captured entry retained. Report interrupted/partial state; do not replay or pretend no mutation. |
| Crash after publication | Helper emits publication result then waits; parent terminates/waits; fresh readback sees new input and captured old version. Readback identifies observed publication, not durable receipt or success of an interrupted higher-level operation. No automatic replay/rollback. |
| Root replacement | Helper pins root identity then pauses. Parent renames that fixture root and creates a distinct replacement at the old path. Before the next operation, revalidation must detect mismatch and stop, with replacement canary unchanged. Report blocked/UNKNOWN, not authority over replacement. |
| Ancestor relocation after validation | Pause with parent/root descriptors held; relocate a fixture ancestor, then resume the designated syscall. Record what the OS actually permits via held descriptors and where effects occur. If a mutation occurs in the relocated tree, report it as a boundary counterexample/UNKNOWN, never a successful containment denial. It may be an expected research observation while leaving production blocked. No assumption that the prior broker’s App Sandbox denial applies to this unsandboxed helper. |
| Resource failure | In a fresh case create a real colliding recovery name, or remove a required staging entry before its named syscall. Assert the resulting real EEXIST/ENOENT and unchanged unrelated input; retain/report any earlier capture. No synthetic errno injection or disk exhaustion. |
| Cleanup identity guard | Record a case cleanup target inode, relocate it and create a replacement canary. The cleanup routine must refuse the mismatched target and leave replacement bytes untouched. Report refusal. Subsequent fixture-wide cleanup may remove both only after independently identifying them as parent-created synthetic entries; no unsafe automatic target-path deletion. |

For edit-before-capture, choose one concrete variant in implementation and record it; do not treat both rename and in-place editing as covered by one observation. Additional variants need explicit cases. The hybrid-copy test’s writer ordering must record each full source state before acknowledging the next phase; merely asserting “a race happened” is inadequate.

These are experiment-specific oracles for overwrite/lost-entry/false-coherence errors, not tests written to mirror an unimplemented production algorithm. Expected research counterexamples may be recorded with a successful fixture exit only if their exact observations and adverse design verdict are explicit. A failed required oracle, missing case, unexpected signal/timeout, unsupported filesystem or incomplete cleanup cannot be flattened into all-cases PASS.

## Budgets, evidence and cleanup

Enforce a monotonic 60-second overall deadline and at most10 seconds for every child, including compile/metadata commands. A supervisor watchdog must terminate owned experiment subprocesses on deadline; do not rely solely on sequential wait timeouts. Track actual PIDs/handles, close pipes, wait and escalate only those owned children. Never kill by process name or touch the invoking environment’s other work. No child may outlive cleanup unnoticed.

**Reviewed implementation budget limitation:** the fixture currently applies 60 seconds to the experiment workload, then permits up to1 second to join the supervisor and a shared2-second stop-only grace for owned groups. It must not be described as enforcing a strict60-second total. No further experiment operations are allowed in teardown. Tester must report actual total elapsed time and treat an observed total over60 seconds as a budget failure against the design target, even if the fixture's internal `ok` is true. Strict end-to-end deadline enforcement remains unproven; the grace is for stopping/retaining resources safely, not permission to continue the workload or claim deadline compliance.

Use at most1MiB case data and a hard1MiB aggregate captured-output budget, including stdout/stderr/protocol/compiler output and final evidence. Bound output before appending/reading indefinitely; overflow is a recorded failure with owned-child cleanup. Size the synthetic patterns far below the ceiling. Report truncated diagnostics explicitly and never claim their missing contents were verified.

Final JSON records fixture/source/embedded-helper/binary hashes; timestamp; host/architecture/filesystem identity; toolchain/SDK identities; case inputs, syscall returns/errno, barriers, observed bytes/hashes/inodes/names; actual child exits/signals; explicit counterexamples, unsupported checks and limitations; and cleanup result/retained paths. Keep the existing broker artifact identities in linked evidence, not as hashes of this new helper. Capture report in bounded memory and emit once after cleanup status is known.

Cleanup must check the recorded private-root identity plus each expected created entry/type without following symlinks. Remove only owned fixture identities after all writers/helpers have stopped and evidence was captured. On mismatch or unknown external identity, retain that exact subtree and report its canonical location; do not recurse blindly or use wildcard deletion. Fault-injected replacement entries are still removable only if independently recorded as fixture-created. The fixture is not permitted to inspect or mutate original VM media, user project files, live grants, protected state or startup configuration.

## Review and execution sequence

1. Implement the single new fixture file, preserving all existing product files and valid evidence. Inspect syntax/static structure without native execution.
2. Review the exact patch, embedded C, helper protocol, budgets, ownership/cleanup, deterministic barriers and report-oracle mapping. Correct blocking issues before executing any compile/helper syscall. This respects the prior exact-patch review requirement.
3. After static acceptance, run exactly `python3 native/macos-files/test-retained-capture.py` once in the approved native context. A sandbox/toolchain-cache failure is an environment failure, not a containment result; any required execution escalation must be explicit. Do not run the old broker suite or broad source suite merely to repeat valid results.
4. Independently inspect actual evidence: all required observations, bytes/inodes/syscalls/errno, exits, cleanup, and scope limits. If repair is needed, identify changed/invalidated cases and rerun only justified scope; never conceal earlier failures.
5. Record a design verdict: retention/collision/open-FD observations and limitations, coherent-copy counterexample, actual relocation behavior, remaining protected-storage/UNKNOWN/interface work. No full M1 PASS, product capability activation, gate signing, publication or Windows work follows automatically.
