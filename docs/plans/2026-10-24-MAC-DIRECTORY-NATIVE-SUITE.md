# Task 4 reader evidence: finite disposable execution scope

This executes the existing directory-copy plan, not a new product milestone. The user authorizes autonomous Mac coding and tests. No further permission question is needed for this disposable suite. Concrete driver review and evidence collection remain required; neither this document nor a synthetic proof activates production.

## Ownership and fixed budget

Tester owns `scripts/test-mac-directory-copy-native.mjs`, `native/macos-files/test-tree-broker.py`, `test/mac-directory-native-driver.test.mjs` and its preparation/evidence reports. Reviewer independently examines this driver before execution. Primary runs only the exact reviewed driver, records its hash and outcome, then continues remaining Task4 work. Product source repairs retain Coder ownership.

One canonical private `/private/tmp/gsa-directory-native-*` stage, synthetic workspace/reference data and canaries only. One optimized reproducible tree-reader compilation; at most two root-specific ad hoc signed bundles; at most24 tree helper launches; at most3 observer invocations; at most1 disposable directory relocation. No automatic retry. The observer's bounded internal polling is part of one invocation, not an extra helper launch. All process I/O and lifetimes are bounded and accounted for.

The new once-only attempt slot is `docs/reports/.mac-directory-native-v1.attempt.json`, created exclusively at native execution opt-in. Existing recovery/host/retained-FD slots and fixtures are unrelated, consumed and immutable. Imports, dry runs and pure tests must not compile, sign, spawn a native candidate or consume the slot. A failed native attempt is preserved rather than silently repeated.

## Exact candidate and confinement

Initial tree source SHA256: `b63fa083b40bc23e0863f401c8aff917b8b2e4ecf2d1739c0e9e5bd255ab352d`. Record actual source, compiler, SDK settings/version/path, arguments `-O -Xlinker -reproducible`, release UUID/binary and normalized stripped code hashes, host and architecture. Both bundles use App Sandbox plus exactly their own root's read-only temporary exception, for both roles. Capture actual signed artifacts, plist binding and entitlement verification. Never import a live installer or read real identity/proof keys/configuration.

The inherited FD3 belongs only to a synthetic private fixture owner file. No installed connector process, owner fence, trusted grants, launchd job, credentials, global policy, entitlement account or original VM media changes. No release helper instrumentation, exported activation bypass or public loader weakening. Production activation stays unconditionally false.

## Cases and limits of conclusions

Within the fixed launch budget collect raw bound request/response pairs for workspace and reference nested/empty/Unicode captures, strict TypeScript digest/byte parity, unsafe symlink/hardlink/FIFO, invalid UTF8 names, at/over depth/entry/byte limits, stale revision, ancestor escape and invalid write operation. Verify source and outside canary content before and after. An invalid write protocol request proves protocol rejection; it does not prove a native write syscall was attempted and denied.

Release relocation observation must identify the exact owned child's PID, parent, birth, executable and held directory FD device/inode before SIGSTOP; confirm the same stopped identity/FD, relocate that directory once outside both roots within the stage, then resume only the same owned process. Record all raw observations and ordering. Lack of the observation is INCONCLUSIVE. A leaked capture is BLOCKING. Never infer timeout means death, or signal an unrelated/reused PID. Keep the stage if any process exit or cleanup is uncertain.

Unavailable mount/device fixtures remain UNVERIFIED. This suite covers the reader candidate only; destination copy/collision, journal interruption/readback, cancellation, installation and live-plugin directory-copy acceptance remain separate obligations. Actual evidence must be classified independently before any exact-artifact activation or installation source change. No full Mac or Windows acceptance follows from a reader PASS.
