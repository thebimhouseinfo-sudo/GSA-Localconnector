# Native macOS offline writable guest smoke — 2026-10-16

Local continuation of PX-04/05 from source base b071308. These changes are uncommitted; this report does not claim a GitHub Actions run for them.

## Verified result

The final repository command `bash scripts/test-macos-vm-boot.sh --offline-smoke` completed successfully and emitted:

```json
{"state":"GUEST_SMOKE_PASSED_UNVERIFIED","imageVerified":true,"vmStarted":true,"diskMode":"disposable-clone","guestSmokeResult":"PASS","securityVerified":false,"executionAuthorized":false}
```

Serial evidence contained the fresh run challenge and guest checks:

```json
{"interfaces":["lo"],"nested_process":true,"nonce":"0f9da199fe8c624ab2515a266c0f02724762dde3f400ca38d3fa25110b777d7f","python_compile_run":true,"root_write":true}
```

The nonce-matching PASS line was observed, followed by `GSA_VM_PHASE=VM_STOPPED` and `GSA_VM_BASE_IMAGES_UNCHANGED`. A prior successful run was also observed graphically at `Ubuntu 24.04.5 LTS gsa-offline-smoke tty1`.

Scope of guest checks: write a temporary source file under `/var/tmp`, compile Python bytecode, execute it and compare output with the literal `42`, execute a nested shell and compare its output, and verify `/sys/class/net` contains only `lo`. Tests use already-installed tools and create no guest password or SSH authorization.

## Storage and bootstrap

- The source candidate is verified via an open descriptor. `fclonefileat` creates a distinct APFS copy-on-write disk in private scratch; the clone is rehashed before attachment. There is no full-copy fallback and no writable attachment of the source image.
- Only the private clone is writable. A locally generated `CIDATA` NoCloud ISO is attached read-only. ISO generation uses the existing macOS `hdiutil`, without downloading or mounting an image.
- The VM has 2 CPUs, 2 GiB RAM, zero network devices, zero host directory shares and no host credential channel. No live MCP execution backend is installed.
- NoCloud metadata explicitly selects `dsmode=local`. The initial network-mode trial stalled in network-online despite having no network device; local mode permits the offline bootstrap before network initialization.
- Host timeout is bounded at 120 seconds; the installed guest workload is bounded by `timeout 45`. Success stops the VM early. The first serial reader incorrectly treated current EOF as failure; it now waits for later output.
- After confirmed stop, working disk, seed and NVRAM are removed. If VM stop is unconfirmed, native scratch is retained and the command fails rather than claiming successful cleanup.

Post-run full-image hashes remained:

| Image | SHA-256 |
| --- | --- |
| Original RAW | `384f7eb9976ad155812b48efb1b780024c0748e35b5c3161c82c797578168e7e` |
| EFI fallback candidate | `9aca11f8edb5474df457c073dbfe140b27aa31f22e46ab1405bed089c5d57666` |

## Failure-path verification and review

An independent reviewer identified that `exit(2)` inside the scratch-owning scope skipped Swift defer on a guest FAIL/timeout. The opt-in native regression `scripts/test-vm-smoke-cleanup.py SIGNED_PROBE` deliberately submits a nonce different from the seed's nonce and boots for ten seconds.

Restoring the old exit in a temporary build reproduced `FAILED_SMOKE_SCRATCH_LEAK`. The corrected build returned:

```json
{"state":"FAILURE_CLEANUP_PASSED","vmStarted":true,"exitCode":2,"scratchRemoved":true,"securityVerified":false}
```

The intentional regression leak and the scratch directories from this continuation's early failed trials were removed. Pre-existing older crash artifacts were left alone.

## Final checks

- TypeScript build and `npm test`: 93 total, 91 passed, 0 failed, 2 skipped.
- Native fixture-only preflight: 6 passed; these terminate before constructing a VM.
- NoCloud rendering: 3 passed; validates offline/no-password configuration, challenge validation, per-run instance identity and guest script Bash syntax on POSIX.
- Existing EFI fixtures: 9 passed.
- Bash syntax and `git diff --check`: passed.
- Native successful smoke and explicit wrong-nonce failure/cleanup: passed.

Local logs: `.gsa/local-state/vm-smoke/offline-smoke-final.log`, `cleanup-red.log`, `cleanup-green.log`, `continuation-final-tests.log`. Local state is ignored by Git. CI source now includes the seed tests and macOS fixture-only disk preflight, but has not been run remotely for these uncommitted changes.

## Remaining plan gates

PX-04/05 is not globally complete. The guest PASS line is guest-controlled workload evidence, not independent proof of host containment. A real worker still needs an authenticated bounded control channel, cancellation/restart ownership, verified project-input transfer or narrowly scoped share, sibling/symlink/secret/evidence negative controls, stable helper/image identities, and independent Windows native evidence. SEC01 and live MCP shell/Git/CI remain BLOCKED.

Implementation references: Apple's installed SDK `sys/clonefile.h` for descriptor-based cloning; [Canonical NoCloud documentation](https://docs.cloud-init.io/en/latest/reference/datasources/nocloud.html) and [Canonical initialization flow](https://github.com/canonical/cloud-init/blob/main/cloudinit/cmd/main.py) for local datasource initialization. Native outcomes above come from this host's command and guest console evidence.
