# Native worker integration — 2026-10-17

Base revision: `b071308`. Changes are local and uncommitted. `git fetch origin main` confirmed no newer remote revision during this review.

## Verified native worker

The Apple Silicon host compiled and signed `WorkerHost.swift`, compiled `SourceCapture.swift`, and installed the exact tested artifacts into the private connector application-support directory. Installation is explicit: `node scripts/install-native-vm.mjs --install`. It refuses an existing destination and publishes with Darwin `RENAME_EXCL` after verification.

The worker boots an independent descriptor-cloned APFS disk and read-only NoCloud seed. It has zero network adapters and zero host directory shares. Project inputs are captured using descriptor-relative native filesystem reads; symlinks, hardlinks, special files, unsafe portable paths and changed source fail closed. The Linux supervisor keeps a root-owned immutable reference and runs jobs as UID/GID 65534 with empty supplementary groups, no-new-privileges, resource limits and a private cgroup v2 leaf.

Native execution passed:

- Python project compile/run and nested subprocess execution.
- Host canary read/write denial, including guest symlink and nested shell attempts.
- Immutable reference and root supervisor configuration write/read denial.
- No inherited fake host credentials; loopback-only interfaces and failed external connection.
- Partial-output timeout and bounded output overflow.
- Full 1 MiB NUL output, whose JSON frame expands to approximately 6 MiB.
- Thirteen worker unit cases inside Linux, with one non-Linux refusal case skipped. The privileged identity and escaped-descendant cgroup cases ran in the guest.
- Clean shutdown after normal execution.
- Deliberately unread stdout: bounded transport failure stops the VM, returns failure and removes its native scratch directory.

Protected installed artifacts and proof are bound to the host kernel, pinned image and SHA-256 artifact manifest. This local installer proof authorizes only the tested offline Linux VM implementation; it is not an independent Windows or full product security certification.

Local evidence: `.gsa/local-state/vm-smoke/worker-install-final.log`, `source-capture-final.log`; installed `native-vm/native-verification.log`. These files are local evidence and are not committed. The intentional backpressure case exits 2 and reports `NATIVE_BACKPRESSURE_PASSED`; that exit is expected failure behavior, not a failed installation.

## Bugs corrected during integration

- Native image hashing retained autoreleased read buffers across two 3.5 GiB scans. Per-chunk autorelease pools reduced observed worker RSS from approximately 7 GiB to 35 MiB before guest execution.
- Blocking stdout writes could prevent main-thread cancellation. Writes now use bounded nonblocking delivery and keep the main run loop responsive; a stalled client cannot keep the VM alive indefinitely.
- Native test cleanup now drains pipes during termination. Installer timeouts terminate the owned process group, escalate within a bounded grace period and bound pipe shutdown.
- Installer hashes artifacts before and after tests, uses fake host credential sentinels and refuses destination replacement at publication.
- Incomplete output with exit code zero could previously become process, Git or reference-CI success. Regression tests reproduce all three; truncated output now cannot produce success evidence.
- Workflow execution and reruns resolve the workflow from the verified source snapshot, with immutable workflow provenance and persisted artifact hashes.
- Controller leases use durable protected state and hashed tokens, and asynchronous work retains the authorization context needed to observe expiry and revocation.
- Stdio dispatch previously awaited each command before reading the next request, preventing timely release/renew/cancel. It now allows 32 ordinary calls plus four reserved control calls, with JSON-RPC IDs correlating out-of-order responses. Saturation and held-command regressions pass.
- Expired native history no longer permanently poisons new process capacity, and a confirmed native stop releases capacity even if its execution outcome remains UNKNOWN. Lost or uncertain outcomes never become invented success.

## Verified production runtime through MCP

`node scripts/test-vm-runtime-native.mjs --run` completed with exit 0 and `NATIVE_RUNTIME_MCP_TESTS_PASSED` across six sequential VM boots. It used the production bootstrap and an authenticated local HTTP MCP server with disposable grants, controller state, projects and evidence directories.

- MCP `run_command` returned 42; the host canary was inaccessible and `.env` was omitted from guest inputs.
- A two-step CI build shared its guest-generated file. Captured source printing 42 still ran after the host source was changed to print 99; the host generated file never appeared.
- A failed exit-7 workflow reran from its original pinned workflow after the host workflow was replaced with a passing one. The rerun remained FAILED and received a distinct run ID.
- Releasing the active controller lease stopped a running native job. Its result became UNKNOWN rather than success, and the stale token was rejected.
- Revoking the persisted workspace grant stopped another running job while the server's in-memory registry still held its original grant.
- Protected logs and `execution.json` were available through the CI tools, with artifact hashes included in journal evidence.

Exact local evidence is `.gsa/local-state/vm-smoke/runtime-mcp-final.log`. The stdio CLI and HTTP startup both compose the signed native runtime; a missing or invalid installation keeps execution blocked. Host file mutation and host Git tools remain explicitly blocked. Ordinary binding remains read-only; native execution additionally needs a trusted local execute grant and a current controller token.

## Final source verification

`npm test` completed with 140 tests: **137 passed, 0 failed, 3 skipped**. The skipped cases are explicitly platform/feasibility-specific; they do not establish Windows native success. Local evidence: `.gsa/local-state/vm-smoke/continuation-final-suite.log`.

Additional source fixtures passed: 12 native source-capture cases, 13 guest-worker cases on macOS (two privileged/Linux-only skips), four worker-seed cases, three smoke-seed cases and nine EFI cases. The actual Linux guest separately ran all privileged worker checks. Native source compilation, installer/runtime entrypoint syntax and `git diff --check` passed. Remote CI has not run against these uncommitted changes.

SHA-256 was reread after all six MCP native boots: original RAW `384f7eb9976ad155812b48efb1b780024c0748e35b5c3161c82c797578168e7e`, fallback candidate `9aca11f8edb5474df457c073dbfe140b27aa31f22e46ab1405bed089c5d57666`. Both match their initial values; exact local output is `image-hashes-after-native.log`.

## Scope and remaining gates

The VM executes a disposable **Linux** project copy. Guest edits do not modify the host workspace. Native macOS SDK execution, host file mutation, host Git mutation, dependency network access, general artifact export and Windows native security are separate capabilities. They must remain blocked where no implementation and native evidence exist.

Snapshot CI currently supports explicit executables/arguments and ordered DAG steps within one guest request, a 120-second overall job limit, and a 1 MiB combined output cap. The protected `execution.json` receipt is ingested as an artifact; arbitrary generated files are not exported. Shared CI snapshot metadata does not yet preserve executable bits, so project scripts must use an explicit interpreter. Process records do not provide restart recovery; interrupted execution cannot be reported as successful.

Legacy persisted workspace grants have no pinned filesystem identity or durable revision and are therefore ignored. A trusted local user must explicitly re-enroll them; `enroll-read` grants read only and `enroll-execute` grants read plus disposable VM execution. Ordinary MCP binding never grants execution. Revocation leaves a durable revision tombstone, and active native jobs recheck persisted permissions as well as their controller lease.

The connected Windows and macOS plugin status calls both returned `Session terminated` during this run. Local native and MCP tests do not establish that those remote plugin sessions are healthy. No existing Windows tunnel, neighboring application or user workspace was modified by the native tests.

Final source-test totals and exact outstanding release gates are recorded in the current checkpoint after their verification. No global plan PASS is implied by this worker evidence.
