# Connector bug fixes and native VM smoke — 2026-10-16

Base pulled with `git pull --ff-only origin main`: b071308dae2d264473944c40423dcdd85cf8235c.
Changes described here are local and uncommitted; no remote CI run is claimed.

## Connector fixes

- `move_file` now requires write permission on its source in addition to source read and destination write. Copy retains read-only source support.
- Unified patches use the correct old-line offset for zero-length ranges, including insertion into an empty file.
- HTTP startup loads the saved trusted registry on supported hosts, matching stdio startup behavior.
- `ci_logs` and native `process_output` expose optional cursor/limit arguments in both their schemas and dispatcher. Bounds and Workspace ownership remain enforced. Legacy non-native output still returns its existing full bounded record; explicit pagination there fails closed.
- Native process capacity tracks active processes and pending starts. Terminal statuses release slots while retained IDs still allow historical output. Native start failure releases its reservation. Concurrent starts cannot both consume the last slot.
- Snapshot verification shares the same path validator as persistence, accepting embedded dots such as `release..txt` while rejecting traversal.
- Stdio integration tests use an isolated temporary user profile instead of reading the operator's real grants.

`test/review-regressions.test.ts` exercises these behavior boundaries, including real HTTP CLI startup under an isolated profile. Native capability dependencies use test-only controllers; these tests do not certify OS containment.

## Validation

- `npm test`: 93 tests, 91 passed, 0 failed, 2 skipped; TypeScript build passed.
- Existing skipped checks: Windows-only capability probe; Seatbelt native policy cannot launch its allowed command on this host (SIGABRT), so containment remains unverified.
- `python3 scripts/test-efi-fallback-candidate.py`: 1 passed.
- `python3 scripts/test-efi-fat32-inspector.py`: 8 passed.
- `bash -n scripts/test-macos-vm-boot.sh`: passed.
- `git diff --check`: passed.
- Independent review of connector changes and subsequent probe changes found no actionable regression.

## Native probe correction

The original probe could start and stop the VM but did not dispatch AppKit keyboard/window events while spinning `RunLoop.main`. A temporary experimental build with `NSApplication.finishLaunching()` and `nextEvent/sendEvent/updateWindows` became observable and accepted Enter at the GRUB prompt. The correction was then applied to `BootProbe.swift`; the smoke wrapper packages and signs a temporary `.app` so the running window can be located normally. The event pump is bounded during start, observation and stop.

The final repository wrapper was compiled/signed and run again with:

```bash
bash scripts/test-macos-vm-boot.sh --fallback-candidate
```

Graphical observation of this final build confirmed keyboard input and the same Linux/systemd progression. It stopped cleanly after its 30-second observation window.

## Disk and guest evidence

The offline preparation command returned `OFFLINE_FALLBACK_CANDIDATE`, adding exactly `EFI/BOOT/grubaa64.efi` and `EFI/BOOT/grub.cfg` to the independent CoW candidate.

Post-run hashes were verified by streaming both complete images:

| Image | SHA-256 | Post-run result |
| --- | --- | --- |
| Original RAW | `384f7eb9976ad155812b48efb1b780024c0748e35b5c3161c82c797578168e7e` | Unchanged |
| Fallback candidate | `9aca11f8edb5474df457c073dbfe140b27aa31f22e46ab1405bed089c5d57666` | Unchanged |

Guest display observed through Computer Use:

1. GRUB reported `error: failure writing sector 0x8eb30 to 'hd0'` twice and `Press any key to continue...`.
2. Clicking the guest and pressing Enter progressed into Linux and systemd userspace.
3. Visible successful units included journald, udevd, sysctl, kernel filesystems and device discovery.
4. `systemd-remount-fs.service` failed; later displays included failures in logind, GRUB state services and snapd, and a wait-online job. The read-only root and absent network are material experiment limitations; not every service failure was independently diagnosed.
5. Final wrapper emitted `VM_STOPPED` and `VM_STARTED_UNVERIFIED`, with `imageVerified:true`, `vmStarted:true`, `securityVerified:false`, `executionAuthorized:false`. Serial log remained empty; userspace evidence came from the graphical display, not serial output.

Local command logs and post-run hash evidence are in `.gsa/local-state/vm-smoke/` (ignored by Git).

Outcome: EFI/GRUB -> Linux/systemd userspace observed; a healthy login-ready Ubuntu guest is not established. SEC01 remains blocked and no connector execution capability was enabled.
