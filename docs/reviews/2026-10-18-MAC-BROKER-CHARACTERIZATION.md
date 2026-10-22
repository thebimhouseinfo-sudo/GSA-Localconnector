# Mac fixed-operation broker characterization — 2026-10-18

The disposable native file-broker fixture completed on macOS 26.6.2 (25G83), arm64, with exit 0, 13 observed cases and confirmed cleanup. This is a narrow broker result, not complete M1 or Mac acceptance. No production installation, grant or execution backend was enabled.

## Tested input and environment

- Evidence captured at 2026-10-18 02:47:58 UTC. Checkout HEAD `9066e01f61f7cddce17c9c23f9ce3d9105685928` retains existing WIP; merged product baseline is `d29be7093942d739e471c62d05cf8dbbdf7eaff5`. Only the native test fixture changed among the 162 audited source/script/test/CI/package paths.
- Command: `python3 native/macos-files/test-broker.py`, executed outside the development-tool sandbox so Swift could access its existing module cache.
- Broker source SHA-256: `6487ab6ad0447a4e63a9a727ca08ed2276ea5e150445c3f497650266745edb45`.
- Fixture SHA-256: `96159f0e05e878ffe882b5302ffe1fbb26f81dd35eeefa6a5c219d6b48ce4a0e`.
- Compile launcher: `/usr/bin/swiftc`, SHA-256 `b8763cf250e607a778bb4603cecb5b90338814d0a3dfcba0d57b1de242f610e9`. This is the launcher hash, not the compiler hash.
- `/usr/bin/xcrun --find swiftc` selected `/Library/Developer/CommandLineTools/usr/bin/swiftc`; canonical compiler `/Library/Developer/CommandLineTools/usr/bin/swift-frontend`, SHA-256 `cf81104bf554eef05e28a8bb5285c763f1323b4511b944d755d8bdd6cb8db717`. Apple Swift 6.4, swiftlang-6.4.0.34.1 / clang-2100.3.34.1.
- Signed binary SHA-256: `a460a7e56047201ad388ad7a9e4abb7a50b502d3da7e85b0b16f395131aa9276`; CDHash `4dbeba622660eb5e396bc92c31e1f0eb061a3f76`. Ad-hoc signing and strict signature verification both exited 0.
- Entitlements SHA-256: `87404d1b80307cba6753909e01c3f2d728a5748def90c2d59512a16c14dfe1cc`; Info.plist SHA-256: `9a0c3e03dc6cdedb028d545a780fa11ad487b68bc866a906edbbb7968cc77cb1`. App Sandbox and the single disposable working-root read/write exception were preserved.
- Disposable fixture `/private/var/folders/53/xn00lg253n131b1q88ydpdcr0000gn/T/gsa-scoped-files-9i0ddse8`, device 16777229, inode 2789663; working root inode 2789664, outside canary inode 2789665, on the same device. The fixture directory was removed after the run.

## Actual results

All broker processes returned 0 with valid JSON and no timeout. Denials below are actual broker errors, not crashes or process failures. The fixture retains assertions for read/copied bytes, exclusive creation and unchanged outside-canary bytes.

| Case | Broker result | Process exit |
| --- | --- | ---: |
| `native-read` | Allowed | 0 |
| `traversal-denied` | PATH_OUTSIDE_SCOPE | 0 |
| `symlink-denied` | PATH_OR_ACCESS_DENIED | 0 |
| `hardlink-denied` | UNSAFE_FILE_TYPE | 0 |
| `read-cap` | READ_LIMIT_EXCEEDED | 0 |
| `create-exclusive` | Allowed | 0 |
| `create-duplicate-denied` | ALREADY_EXISTS_OR_DENIED | 0 |
| `mkdir` | Allowed | 0 |
| `symlink-create-denied` | ALREADY_EXISTS_OR_DENIED | 0 |
| `hash-conflict` | HASH_CONFLICT | 0 |
| `copy-exclusive` | Allowed | 0 |
| `ancestor-relocation` | PATH_OR_ACCESS_DENIED | 0 |
| `root-identity` | ROOT_UNVERIFIED | 0 |

The ancestor-relocation case reached its READY pause, moved the disposable ancestor outside the allowed root and then returned PATH_OR_ACCESS_DENIED. The replaced-root case returned ROOT_UNVERIFIED. The fixture records requests, responses, exits and artifact identities before removing temporary data, then reports the actual cleanup result.

## Failures and limits

The initial development-tool-sandbox run failed compiling because the Swift module cache was not writable; the same unchanged native fixture succeeded outside that sandbox. During evidence instrumentation, a closed-stdin subprocess-control error was reproduced, fixed and rerun successfully. Neither failure was counted as a successful security denial.

This proves the observed single-root fixed-operation subset only. Correct-hash replace/move/trash remain blocked; cross-root and reference-source copy remain adapter gaps. There is no production installation proof, arbitrary shell/descendant containment, reference interpreter/import/build enforcement, native SDK workload, recovery or live-plugin proof. The fixture's generic denial assertions do not certify untested cases; the specific observed errors above define this claim.

Retain this broker subset as a candidate for subsequent multi-root authorization and safe mutation design. Do not enable host execution from it. Host-command/native-SDK mechanism research remains a separate unresolved M1 prerequisite; Windows work waits for complete accepted Mac M5.

