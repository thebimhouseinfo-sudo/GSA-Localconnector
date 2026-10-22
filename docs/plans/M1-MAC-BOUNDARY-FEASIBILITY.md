# M1 — Mac boundary feasibility contract

Status: **scoped execution authorized on 2026-10-18; complete M1 acceptance pending**. The reviewed disposable characterization has run on the Mac host. Its first aggregate-only output exposed missing transient evidence, so the existing fixture received a focused evidence-capture repair without changing broker permissions or operations. No new reporting module or test framework is needed: `src/hosts/security-probe.ts::evaluateSecurityProbes` already detects fixed-ID omissions/duplicates/outcome mismatches and always returns `unverified:true`. Broker-subset observations do not establish host-command/native-SDK feasibility.

**Platform scope:** Mac only. Complete and accept the full Mac M5 before starting Windows feature work, native feasibility or detailed implementation. No simultaneous/multiple-machine test matrix is required; independent/concurrent projects on the selected host remain required.

**Goal:** Characterize the existing fixed-operation Mac file broker narrowly, expose known mutation/copy limitations and choose the next design work needed for actual project tools. Native command supervision/macOS SDK execution has no selected runnable candidate and remains design research pending; this contract does not pretend the broker can prove it.

Observed result: [2026-10-18 Mac broker characterization](../reviews/2026-10-18-MAC-BROKER-CHARACTERIZATION.md). The supported subset remains a candidate for subsequent multi-root/safe-mutation design; complete M1 and host execution remain pending.

**Spec:** [criteria §§3,4,7,9](../CRITERIA.md), [main plan D1–D6](GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md). User clarification resolves D2 intent: copying reference material into a working root and using/executing that copy is allowed; direct execution/import/build from the reference folder is not. Enforcement feasibility is still unverified.

## Selected narrow hypothesis and known limits

Hypothesis H1: on the recorded Mac host, the existing signed App Sandbox fixed-operation broker permits ordinary-file read, exclusive create, mkdir and same-root exclusive copy in its one pinned disposable working root, while rejecting tested traversal, symlink/hardlink and root/ancestor-replacement cases. A passing run establishes only those observed fixed operations on that artifact/host.

Known source outcomes, not hypotheses to disguise as missing evidence:

- `native/macos-files/broker.swift::run` validates expected content for `replace`, `move` and `trash`, then always returns `SECURITY_BLOCKED_ATOMIC_COMPARE_UNAVAILABLE`. Correct expected hash does not enable compare-and-mutate. Wrong hash fails earlier with `HASH_CONFLICT`.
- `src/hosts/macos-scoped-files.ts::loadMacScopedFiles`/`invoke` requires source write permission for every non-read operation, including copy, and rejects a destination whose workspace ID differs. Thus reference-source copy and cross-root working copy are not implemented by this adapter, despite higher-level dispatcher permission checks.
- Broker source supports one root; it is not a command supervisor. No descendant/native SDK/network claim follows from fixed-operation behavior.
- The original `native/macos-files/test-broker.py` exercised ancestor relocation but omitted `ancestor-relocation` from its printed checks. The scoped evidence repair includes that label and actual response. The adapter also requires separately protected installation/HMAC/artifact bindings. Script output is not an install proof, and production bootstrap still injects no file backend.

## Exact reviewed experiment scope

The first characterization used the existing `native/macos-files/test-broker.py` unchanged. The subsequent focused repair retains the same synthetic paths, assertions, signing policy and fixed operations, while capturing identities, hashes, subprocess responses/exits and cleanup. It creates a Python TemporaryDirectory with prefix `gsa-scoped-files-`, canonicalizes its path, and confines fixtures to that private directory: `root/input`, `root/new`, `root/dir`, `root/copied`, `root/escape`, `root/hardlink`, a world-readable `outside` canary, relocated/renamed roots and a disposable Broker.app. No existing workspace, home project, identity directory or VM disk is an input.

Reviewed execution commands from repository root:

```sh
/usr/bin/sw_vers
/usr/bin/uname -m
/usr/bin/xcrun --find swiftc
python3 native/macos-files/test-broker.py
```

The existing script supplies the exact compile/sign/run implementation:

```text
swiftc -D CONTAINMENT_TESTS native/macos-files/broker.swift -o <private-fixture>/Broker.app/Contents/MacOS/broker
/usr/bin/codesign --force --sign - --entitlements <private-fixture>/entitlements.plist <private-fixture>/Broker.app
<private-fixture>/Broker.app/Contents/MacOS/broker   # one JSON request on stdin per invocation
```

Resolved `swiftc` identity/version and binary/source/policy/entitlement hashes must be recorded. The script signs ad hoc with `com.apple.security.app-sandbox=true` and exactly one temporary-exception absolute read-write path, `<canonical-root>/`. Info.plist binds root/device/inode/revision and a random fixture-only bundle ID. The test process is a disposable fixed-operation app, not unrestricted project code. It uses no network, privileged account or persistent installation; no generic toolchain directories are granted to a project runtime by this experiment. The fixture itself is compiled using the already installed Swift toolchain.

## Observations to record

| Existing case | Required observation and scope |
| --- | --- |
| read input | ALLOWED, bytes `old` / base64 `b2xk`, bounded by maxBytes. |
| exclusive create new / mkdir dir | ALLOWED; second create denied, no overwrite. |
| same-root copy input→copied | ALLOWED with correct hash; copied bytes equal `old`; not cross-root or reference-source capability. |
| traversal ../outside, escape symlink, hardlink | DENIED; unchanged outside bytes. This proves request-level fixed-operation cases only. |
| read input with maxBytes=2 | DENIED, not a successful truncated read. |
| wrong-hash replace | DENIED; script tests conflict, not successful replace. |
| ancestor relocation during testPause | DENIED; retain actual response, not just final checks list. |
| root replaced at same path | DENIED by pinned identity; new root content never read as old authority. |

Record stdout/stderr and actual return code. An error, abort, hang or missing observation is FAILED/UNVERIFIED, never a successful denial. Existing test assertions supply some results only as aggregate success; do not invent per-case logs it does not emit. If case-level instrumentation is necessary, propose that focused change after a demonstrated evidence need; no new reporter by default.

The following cases are source-established feature limits, not positive controls: correct-hash replace/move/trash remain blocked; adapter cross-root destination denied; adapter reference-source copy denied by source-write requirement. Their exact future runtime characterization, if needed, must use a separately reviewed disposable fixture because the current script does not exercise all of them. Do not claim they passed or silently expand this run. P03 must design safe mutations and cross-root/reference copy rather than merely install the existing broker.

## Cleanup and evidence integrity

TemporaryDirectory cleans its own fixture tree on normal exception/exit; capture report/hashes into a separately reviewed private report directory before cleanup if required. On abnormal interruption, inspect recorded fixture identity and remove only that exact disposable directory after scope confirmation; never use broad wildcard deletion. No existing grants, global configuration, launch services, real credentials or identity files are touched. No VM image is opened or modified; original media paths/digests are outside this experiment. Record cleanup outcome and remaining fixture paths honestly.

Record exact commit plus dirty source hashes, host version/architecture, resolved toolchain, signed artifact/policy hashes, fixture root identities, commands/exits and expected/actual observations. `CONTAINMENT_TESTS` artifact evidence does not certify a production build or authenticated installed adapter. App Sandbox code signing is not general-shell confinement.

## Decision output and remaining research

Current docs-only continuation: [Mac host boundary and mutation design](M1-MAC-HOST-BOUNDARY-DESIGN.md) reuses valid 13-case evidence without rerunning it. It selects multi-root fixed-operation brokerage and a retained-version mutation investigation, rejects App Sandbox alone for full host commands, and identifies public macOS virtualization as a conditional direction blocked on explicit resource choice and shared-root proof. No capability is enabled and complete M1 is not established.

Return separate findings for supported broker operations, compare-and-mutate, cross-root/reference copy and host execution. Current design disposition: supported broker subset has the narrow recorded observations; compare-and-mutate and cross-root/reference copy are known GAPs; native SDK execution, guest share confinement and reference execution enforcement remain UNVERIFIED. No generic host Process supervisor is accepted from the broker proof.

After the fixture result, choose the next concrete design task: safe compare-and-mutate/concurrent-writer semantics and multi-root broker authorization, or a replacement broker design if H1 fails. A broker-only result may inform P02/P03 design but cannot complete those features or unblock P04. Host-command research must select an actual mechanism and scoped resource contract with paired native SDK success/outside-reference-child denials before proposing runnable commands. Existing Seatbelt abort and Linux VM limits remain explicit; no invented native backend/API.

For D2, future execution tests must pair reference read/copy success with direct script/interpreter/import/build-from-reference denial and copied-in-working execution success. Noexec alone cannot prevent allowed interpreters reading then evaluating bytes; the clarified operation/path intent does not create arbitrary byte-provenance tracking. Record unsupported bypass behavior as a feasibility failure, not a waived criterion.
