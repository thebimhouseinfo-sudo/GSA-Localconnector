# Mac native completion checkpoint — 2026-11-09

## Scope and source state
- Current production-source branch: `main`.
- PR #11 (missing executable crash / asynchronous spawn error handler) merged as `1524e01`; PR #12 (bundled Node PATH in menu bar) merged as `854fb2d`.
- PR #13 (partial-safe recoverable file move) merged as `3ff813b`. Its exact-head GitHub macOS C0 and G3 CI passed, and postmerge run `42578746256` passed.
- PR #14 (allow Recovery eligibility only for exact independently pinned native report + signed checked loader) merged as `f65c8a4`; exact PR HEAD `37cb1a8` GitHub macOS C0 and G3 passed, with postmerge CI tracked separately.
- Never interpret source/hosted CI as installed Mac acceptance.

## Verified on the user-selected native Mac
- 2026-11-09: MCP connection, `node --version` (v24.21.0), `inspect` and Git local commands ran successfully; previous missing-executable server exit is no longer reproduced after installing `854fb2d`.
- Current selected host: Darwin 27.0.0, arm64, native shell unconfined (`command_confinement: none (user account)`).
- BASE file broker after `rebind-base`: signed loader active; `create_directory`, `create_file`, `copy_file`, UTF-8 read and SHA-256 verification PASS in `/Users/nam/Desktop/Test/gsa-lc-rebind-acceptance-20261109`.
- `edit_file_as_new_version` PASS on the same Test root; original source retained unchanged, new file SHA verified. Direct `delete_file` under BASE correctly returned SECURITY_BLOCKED without removing content.
- Mac27 Recovery archive local to the Mac passed authenticated/pinned inspection with `node scripts/repair-mac-recovery-archive.mjs`: `RECOVERY_ARCHIVE_BASE_INPUTS_EXACT`, both base evidence inputs VERIFIED_EXISTING.
- Independent disposable Recovery install on `/Users/nam/Desktop/Test/gsa-lc-recovery-install-fixture-20261109` succeeded: `SCOPED_FILES_RECOVERY_INSTALLED_NOT_ACTIVATED`, exit 0. This fixture uses its own `identity`, `work`, grant `fixture`, owner FD3 and protected journal. NOT the production identity.
- The checked signed Recovery loader on that disposable identity performed actual `replaceIfHash` and `trashIfHash` against a test file, returned `APPLIED` twice, confirmed source absent after trash and **two retained original versions**. Owner-fenced native process receipt `RECOVERY_DISPOSABLE_NATIVE_PASS`, exit 0; no user project files modified.
- Second disposable `BASE -> Recovery` upgrade fixture directory was prepared at `/Users/nam/Desktop/Test/gsa-lc-recovery-upgrade-fixture-20261109`. The BASE apply tool request was blocked at platform safety layer **before execution**. Do not reissue an equivalent command through another path to bypass the block. Upgrade-from-existing-BASE acceptance remains UNVERIFIED.
- Local `git_status` showed untracked `docs/proposals/`: preserve untouched.

## Required unfinished acceptance (not DONE)
1. **Production installation**: latest source from GitHub, active menu-bar app/owner must be stopped and fenced; independently verified exact native qualification; `apply-recovery` against active identity is not yet executed. Existing production remains BASE-only, so direct update/delete/move not enabled. Installer must preserve previous signed generation, grants, keys and any journal.
2. **Real selected-plugin end to end**: after authorized production install/restart, confirm `fileBackendAvailable`, exact enabled operation list, and run create/update/edit/patch/delete/move/transaction-readback exclusively under `/Users/nam/Desktop/Test`; verify retained old bytes, conflicts, interrupted/UNKNOWN readback, no duplicate writes. Do not attempt destructive operations on user projects.
3. **Directory copy**: native TreeReader proof/installation is absent or stale and `macDirectoryCopyActivation` source intentionally returns unavailable. The code and historical partial fixtures are not full installed containment/reader/restart acceptance. Never flip the flag without matching signed proof.
4. **Git remote**: `git_fetch/pull/push` are intentionally blocked by `src/core/git-engine.ts` unless a separate restricted network capability is implemented and reviewed. A workspace grant or user's remote-operation request is not itself a network sandbox. Do not route network Git through unconfined shell to defeat this gate.
5. **M4 continuity**: full power loss/after-capture relocation/unknown stop/reboot and wake still not proven. Native qualification itself states these limits.
6. **Desktop lifecycle**: hosted packaging and source tests PASS, but real login/reboot/wake/tunnel recovery and full UI lifecycle not yet observed on installed latest generation.
7. **VM retirement**: tracked source-only removal already completed in E2; see `docs/reports/TRACK-E2-VM-SOURCE-RETIREMENT-20261106.md`. User-owned old VM media/installed artifacts are not deleted. Do not recreate VM or claim physical removal.

## Guardrails
- Test roots only under user's explicitly assigned Test workspace.
- Do not modify untracked local files, refresh historical native attempts, forge qualification reports, grant broad network capability, or bypass signed loader/source-blocked activation.
- `UNKNOWN` means observations insufficient, not an automatic retry or success. Keep retained recovery versions.
- G4/M4/M5 remain not accepted until the matching installed source generation and interrupted runtime tests pass on Mac.


## Follow-up real-Mac acceptance — 2026-11-09 (reboot explicitly deferred)

**Live installed Mac BASE/Recovery status observed:** `fileBackendAvailable=true`, `fileTransactionReadbackAvailable=true`; enabled native operations `create_file, update_file, edit_file, apply_patch, create_directory, delete_file, copy_file, move_file`. `directoryCopyAvailable=false`; network Git still `local-only; network-blocked`.

**Direct selected-plugin acceptance on disposable Test files:**
- Root: `/Users/nam/Desktop/Test/gsa-lc-final-acceptance-20261109` (existing authorized workspace `ws-b152c830eed2592c`).
- `update_file` — `APPLIED`, retained transaction `4e19ae73-50e7-4524-a50c-598f065ea6e8`; content verified as `after update\n`.
- `delete_file` — `APPLIED`, retained transaction `f005056d-e691-43ef-abee-3e0ef1583ad8`; original entry removed via native recovery capture.
- `move_file` — `APPLIED`, destination content readback verified; source-trash transaction `2d24fb91-9447-435f-83f4-62e0be16606f`.
- `apply_patch` — `APPLIED`, retained transaction `b3460e74-8c50-4442-8177-77a46ba3e24e`; content readback verified as `hello\npatched\n`.
- Explicit `get_file_transaction` readback for **all four IDs** returned `APPLIED / VERIFIED_READBACK` with retained handles.
- `update_file` with an intentionally stale SHA-256 returned `HASH_CONFLICT`; a fresh read confirmed the existing content remained unchanged.
- Native process test: a disposable `node` process produced `GSA_PROCESS_LIFECYCLE_READY`, `stop_process` returned `stopped=true, state=CANCELLED`, and `process_status` confirmed `CANCELLED`. No unrelated process was targeted.
- `launchctl list` included login job `com.gsa-localconnector.mac` and Desktop app process. Local Git HEAD observed `8ed9840` before the latest PR #15 installation; untracked `docs/proposals/` was left intact.

**Desktop source delivery:** PR #15 merged to `main` as `42ae0b1`. The design exposes Pause/Resume controls using signals to the retained desktop adapter; privately writes owner-only pause state, and rejects **new** effectful MCP calls without interrupting in-flight commands. The PR's exact HEAD GitHub macOS C0/G3 passed, as did the merge commit run `42594472378`. **Actual UI Pause/Resume/Quit acceptance against that installed generation remains pending**. No disconnect/installer replacement was attempted from inside the live MCP owner.

**Remaining non-reboot work and precise blocking conditions:**
1. **Directory copy/inspect/readback:** Signed TreeReader native evidence and checked production installation remain unqualified. Source activation remains intentionally false, and the plugin truthfully reports `directoryCopyAvailable=false`. Do not turn it on using synthetic fixtures or descriptor-only reads as a substitute for required native boundary evidence.
2. **Git fetch/pull/push from the Mac plugin:** `src/core/git-engine.ts` requires a **separately authorized restricted network capability**. Current native command runner has `command_confinement: none (user account)` and does not provide a verified network restriction. Do not run remote Git through `run_command` to evade this guard. Local Git/status/commit tools and GitHub connector remote APIs remain separate.
3. **Desktop install + human-visible controls:** New commit `42ae0b1` has not been installed on the active user Mac. The desktop launcher owns the tunnel and replacement requires an exclusive stop/install gate; preserving active tasks is mandatory.
4. **Quit/continuity without reboot:** The Desktop adapter currently cannot reliably prove work is idle (`ownedWorkState` may return `UNKNOWN`); Quit must refuse to kill active/uncertain work. Full UI Pause/Resume/Quit and reconnect after a safe app restart require live verification.
5. **Reboot test:** Explicitly deferred by the user; **not an acceptance requirement for this iteration**. Do not claim it passed.

**Milestone status:** Native core Recovery operations and process lifecycle: PASS in the bounded observed paths. Full Mac M5: **NOT ACCEPTED**, pending directory-copy qualification, restricted network Git if required by selected workflow, installed Desktop UI and safe Quit/restart.
