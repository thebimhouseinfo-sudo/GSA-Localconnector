# Offline writable guest smoke — implementation continuation

Goal: advance PX-04/05 beyond graphical read-only userspace to a bounded offline workload inside an independent writable guest disk. This is an experimental native probe, not a production worker or SEC01 certification.

Constraints: keep baseline RAW and EFI candidate unchanged; no host Workspace shares, network adapters, credentials, login passwords, package downloads or live MCP execution backend. Retain the previous local bug fixes.

Implementation:
- [x] Add native disk preflight regression coverage: default read-only, descriptor-based APFS clone, source unchanged, malformed mode/seed rejected. Fixtures never start VMs.
- [x] Extend BootProbe with explicit disposable-clone mode; use fclonefileat on a verified source descriptor into private scratch. Rehash the clone, attach only that copy writable, and fail without a full-copy fallback. Add fixture-only preflight termination before VZ configuration.
- [x] Prepare a local read-only NoCloud ISO using bundled hdiutil. Payload uses a fresh nonce and only installed guest tools to test root writes, Python compile/run, nested subprocesses and absence of non-loopback network interfaces. Emit bounded results over hvc0. No host directory is exposed.
- [x] Add --offline-smoke to the wrapper; preserve existing default read-only and --fallback-candidate behavior. Recheck the candidate and baseline digests after the VM stops. Keep disk, ISO and NVRAM disposable.
- [x] Verify source tests, native fixture preflight and script syntax; then run native offline-smoke, observe graphics and serial, confirm owned VM stop and base-image integrity.
- [x] Independent code review, fix important findings, retest, update checkpoint with exact result and next PX-04/05 blocker.

Ruling: the next bounded increment is disposable guest storage plus NoCloud smoke, not live shell/CI wiring. The previous result exposed read-only root and no-input limitations; the main plan requires a valid in-guest workload before native isolation certification. Cost if this assumption is wrong: this diagnostic increment remains removable and confers no connector authority.

Sources: Apple SDK sys/clonefile.h and Virtualization API; Canonical NoCloud documentation at https://docs.cloud-init.io/en/latest/reference/datasources/nocloud.html.

Completed locally on 2026-10-16, based on b071308 plus uncommitted changes. Native success and wrong-nonce timeout/cleanup verified; no remote CI or SEC01 PASS claim.

Execution ledger:
- Native preflight fixtures: RED (preflight mode absent) -> GREEN, 6/6. Explicitly terminate before VM configuration.
- NoCloud seed fixtures: RED (builder absent) -> GREEN, 3/3.
- First native trial exposed nil-at-EOF handling in the serial poll; nil now means wait for future guest output.
- Second native trial reached userspace but waited for network-online. Canonical's local datasource mode runs initialization before the network stage; adding metadata dsmode=local made the offline workload complete.
- Reviewer finding: exit(2) bypassed scratch defer on normal failed smoke. Confirmed by the native wrong-nonce regression with the old exit restored in a temporary build (RED: leaked scratch). Fixed code leaves the scope before exiting (GREEN: FAILURE_CLEANUP_PASSED). Scratch is intentionally retained if VM stop is unconfirmed.
- Final repository wrapper: GUEST_SMOKE_PASSED_UNVERIFIED, guestSmokeResult=PASS, clean VM_STOPPED, both pinned base images unchanged.
- Full suite: 93 tests, 91 pass, 0 fail, 2 skipped. Additional Python tests: 6 native preflight + 3 seed + 9 EFI fixture tests pass. Native cleanup test passes separately.
- Ruling preserved: this increment proves a bounded offline guest workload, not Workspace-share containment, a production worker, Windows isolation, or authorization to enable MCP execution. Cost if the selected next step is wrong: diagnostic-only code remains removable.
