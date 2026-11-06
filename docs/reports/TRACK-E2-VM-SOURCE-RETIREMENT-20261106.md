# E2 — Linux VM tracked-source retirement checkpoint (2026-11-06)

## Result and exact source authority

**Result: SOURCE-ONLY REMOVAL PASS on GitHub-hosted macOS. NOT local VM uninstall and NOT native Mac G4/prelocal acceptance.**

- Repository: `thebimhouseinfo-sudo/GSA-Localconnector`.
- Only working branch: `plan/mac-native-ci-vm-retirement-20261105`.
- Exact integrated candidate SHA: `ab4d7155030183eeb63f28cc0e2f1f7aba0a1501`.
- User's latest request explicitly brought forward source retirement. The originally approved E1/E2 plan placed the broader E2 retirement after G4 real Mac proof. This early source-only removal is deliberately reversible; **no claim is made that G4 was met or the installed VM retired**.
- Source removal tree commit `e5ad506742429a364670eec169ecaa6a039abb5b`; migrated artifact regression fix `de23dd6b31385728f20da6df5a9bb4f337e920f2`; obsolete installed-VM probe cleanup `ab4d7155030183eeb63f28cc0e2f1f7aba0a1501`.

## Removed from the active Git tree

- `src/hosts/macos-vm-runtime.ts`
- `src/hosts/macos-vm-ci.ts`
- `native/macos-vm/WorkerHost.swift`
- `native/macos-vm/Virtualization.entitlements`
- `native/macos-vm/guest_worker.py`
- `native/macos-vm/SourceCapture.swift` (relocated verbatim into native-owned path)
- `scripts/install-native-vm.mjs`
- `scripts/prepare-vm-worker-seed.py`
- `scripts/test-vm-guest-worker.py`
- `scripts/test-vm-runtime-native.mjs`
- `scripts/test-vm-worker-native.py`
- `scripts/test-vm-worker-seed.py`
- `test/macos-vm-artifacts.test.ts`
- `test/macos-vm-ci.test.ts`
- `test/macos-vm-runtime.test.ts`

Preserved the active source-capture helper at `native/macos-source-capture/SourceCapture.swift`, updated `scripts/test-native-source-capture.py`, preserved generic artifact-path regression in `test/native-artifact-paths.test.ts`, removed the obsolete VM source-test exclusion, updated `src/mcp/runtime-bootstrap.ts` to stop defaulting to a `native-vm` installation, and removed obsolete VM state probing from `scripts/mac-package.mjs` without attempting any local deletion.

## Real GitHub-hosted macOS regression proof

**Run [#42167492972](https://github.com/thebimhouseinfo-sudo/GSA-Localconnector/actions/runs/42167492972) — overall SUCCESS on exact candidate SHA `ab4d7155030183eeb63f28cc0e2f1f7aba0a1501`.**

- `c0-source`: PASS — TypeScript build and compiled tests, reported `# fail 0`; Dart? no. The migrated `native-artifact-paths.test.ts` test now runs, rather than being excluded as a VM-only suite.
- `C-VM`: PASS — `scripts/ci-mac-vm-absence.mjs` returned `zero active Linux VM source/install/test/CI references`. It scans `src`, `native`, `scripts`, `test`, `.github/workflows` and `package.json`, excluding only its own checking script and documentary history.
- Native source-capture fixture: executed in C0 against the new native-owned path.
- `g3-preinstall`: PASS — C-A signed broker + journal + direct-owner interruption checks, C-B Darwin command/Git and C-G3 disposable packaging/desktop checks all completed with successful required steps.
- C-G3 manifest proof on source SHA: `manifestFileCount=86`, `uiCdhash=172fe414870a8166c1e2be3f8c6c975e39164c39`, `installedOnUserMac=false`.
- Initial after-deletion run `#42167013347` failed due to a migrated test's YAML escape literals, fixed in `de23dd6b`. Follow-up `#42167096242` failed because `scripts/mac-package.mjs` still contained a diagnostic/probe for old `native-vm` assets; fixed in `ab4d7155`. Both fixes were rerun at the exact final successful SHA.

## Preserved assets, limits and stop conditions

- **No VM image/media, guest ISO, old installed `native-vm` directory, historical source history, saved state, grants, user keys, journals, workspace data or local dirty checkout was deleted or inspected.**
- No Mac VM was started, repaired, reinstalled or physically uninstalled. No user's actual Mac or selected connector plugin was contacted.
- Historical `docs/security`, `docs/reviews`, legacy handoffs and E1 review/inventory remain available for audit.
- Restoration of tracked source is possible by a reviewed revert of the source-only commit(s); reverting source must not automatically reenable a VM backend or mutate the Mac.
- Real Mac installer/selected-plugin acceptance is **PENDING USER REQUIRE**. PL-R01–R05 remain open in `docs/reviews/2026-11-06-PRELOCAL-READINESS-REVIEW.md`; this source retirement does **not** change the `NOT_READY_FOR_LOCAL_TEST` verdict.
- Installed VM cleanup, if wanted later, is a separate, explicit host-side operation after inspecting actual user-owned files and obtaining authorization for exact targets; never perform blanket `rm -rf` of unknown media.

## Reviewer / acceptance disposition

**PASS** for exact-source **tracked Linux VM module removal and hosted non-VM regression**. **NOT DONE** for broad E2 G4-dependent retirement of an actual installed VM or complete prelocal-ready Mac product acceptance. The most recent instruction advanced source cleanup only; no authorization to touch the user's Mac was inferred.
