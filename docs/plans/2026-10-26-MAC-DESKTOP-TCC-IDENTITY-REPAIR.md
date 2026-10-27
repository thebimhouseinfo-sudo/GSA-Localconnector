# Mac desktop TCC identity repair plan

Status: PROPOSED / source-only batch, pending independent review. This planning task did not build, sign, launch, stop or install anything; it did not read credentials, TCC databases or owner-lock contents.

Goal: preserve the already accepted desktop UI code identity across backend-only updates, then repair the current installed backend refresh through the standard installer. This serves existing criteria1–3,7–8 and the user's instruction to finish Mac; it changes no product goal, permissions, gate or native probe quota.

Architecture: treat the signed UI bundle as an immutable, independently reusable artifact. Future releases record UI intent and artifact provenance outside the signed bundle. Backend updates copy the entire verified compatible bundle without compilation, icon regeneration or re-signing. Narrowly pinned, explicitly reviewed legacy-artifact adoption preserves current508bf first, with preserved55ad only as a reviewed fallback; it must not claim historical source-to-binary attestation that was never recorded.

Tech stack: existing Node ESM installer/release verifier/private-file APIs, existing Swift/AppKit bundle and codesign validation. No dependency, signing certificate/key, entitlement, TCC setting or global configuration is created or changed.

## Confirmed root cause and bounded claim

The primary observed runtime508bf RUNNING/CONNECTED with68 compiled hashes matching the accepted current backend and fileBackendAvailable=true. A create_directory call timed out after15seconds; its target remained absent by independent ENOENT observation. A later list_directory returned READ_LIMIT_EXCEEDED after30seconds. These are not evidence that raising timeouts would fix the operation.

The primary's unified TCC log identifies responsible desktop bundle `com.gsa-localconnector.mac.desktop`, requesting broker, an old versus new code-requirement mismatch for DesktopFolder, and AUTHREQ_PROMPTING. Old55ad DR binds cdhash `a479648ab256361ace475c354c573e9a17352fc3`; new508bf binds `b6b8d4c24be7201385f7a77e9848b3d30860c093`. The updater recompiles App.swift, regenerates icons and ad-hoc signs the app on every backend update. Old/new bundle comparison changed the executable, icon.icns and CodeResources, while Info.plist/license/config-path bytes stayed identical.

Apple documents that macOS recognizes code updates through designated requirements; ad-hoc identity is specific to a code version. These sources support preserving the signed artifact, not weakening its requirement: [TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements), [TN2206](https://developer.apple.com/library/archive/technotes/tn2206/). The earlier failure remains valid root-cause evidence. The fresh October27 read described below changes which verified artifact should be preserved; it does not identify who resolved the prior prompt or promise an automatic grant.

App.swift reads the protected global desktop config, and startSupervisor selects `config.runtimeRoot/bin/node` and that root's scripts/mac-desktop-adapter.mjs. The UI therefore need not be rebuilt to launch a newly packaged backend. Keep the global config path and bundle identifier unchanged.

## Options and decision

1. **Recommended: immutable whole-bundle reuse plus honest legacy adoption.** Feasible with existing managed artifacts and dynamic runtimeRoot launch. It preserves all six signed bundle files, the code requirement and resource seal. Review must accept the pinned legacy compatibility profile before implementing/using it.
2. Adding only reproducible linker flags is insufficient: icons/resources also changed, and rebuilding with different SDK/toolchain need not reproduce the accepted identity. It does not repair today's old-TCC/new-DR mismatch.
3. Stable certificate-based identity could support future arbitrary UI changes, but credentials/certificates are not available or authorized for creation. Not part of this task.
4. TCC reset/database edits, identifier-only or weakened DR, new permissions, timeout increases, grant repinning and manual installed-file/pointer copies are excluded. They do not implement this source repair.

## Evidence and legacy provenance limits

Historical fallback candidate root: `/Users/nam/Library/Application Support/GSA-Localconnector/runtimes/55ad944c-1c1e-4fd0-aab0-b0010989d602`. Current508bf is now the preferred candidate under the amendment below; do not restore55ad merely because it was the earlier TCC identity.

Known full release manifestSHA `0c8f1d21ca9c5ab0c2040630737d347662121d99206d363c900688d5776bc947`. Verify the complete existing manifest and safe managed ancestry before considering any file. The adopted app inventory must equal these six entries, with no symlink, hardlink, special file or extra file:

| Bundle-relative path | SHA256 |
|---|---|
| Contents/MacOS/GSA Local Connector | ef1b4d5541b61269e55355976aea0bbe28e3a4b036c22c152618866346b25bc4 |
| Contents/Info.plist | 536113345f5e3969d80e752e73f89139506df0bc7f1b515bbf3f12c7686a8a32 |
| Contents/Resources/desktop-config-path.txt | c6967f43d9a43491bb2652fccebbf155dae5d454af4cbf63a43696104e09959c |
| Contents/Resources/GSAConnector.icns | 83ca802d9ce134f893a460fc8f7105151486bb58c1e18697dc1555f967bdd040 |
| Contents/Resources/Icon-LICENSE.txt | dde6b9ebb537c9640e9e385caf539e19be2edf87cf1c51156d3de39f2e38fe8e |
| Contents/_CodeSignature/CodeResources | 6557a8bced9c1c0f276ddee67bce0fb29b5e936bf52317dcca00b12d166301fd |

Current UI intent inputs:

- App.swiftSHA `edf9e28f8e00348d3f4b4784185dfab2f3891d4f1beee460dcabc9ce69ee34d9`.
- Info.plistSHA `536113345f5e3969d80e752e73f89139506df0bc7f1b515bbf3f12c7686a8a32`.
- scripts/build-desktop-icons.mjsSHA `524903571a9b4c8059ae0f6a700f2f1587d4970ea7c3c82d155e3f9f8eeacbe9`.
- assets/desktop/LICENSESHA `dde6b9ebb537c9640e9e385caf539e19be2edf87cf1c51156d3de39f2e38fe8e`.
- assets/desktop/plug-zap.svgSHA `5f1ba0585c27d8c8ba573d134a1566cd41a044b282769ccb8dd8486d04eda8ef`.
- Resource config path exactly `/Users/nam/Library/Application Support/GSA-Localconnector/desktop/config.json`; target arm64-apple-macos13.0 and existing bundle/signing recipe.

Snapshot `harness/snapshots/f96a7a95-63c7-4ca6-a097-a04da4732883/snapshot.json` records the same App.swift hash; its filemtime2026-10-22T15:48:03Z precedes the old app build. This is continuity evidence only. A release-v1 file manifest does not record UI source inputs or bind the old executable to that source hash. No snapshot timestamp or current-source equality may be relabeled as a build attestation.

The migration record must say `origin: reviewed-legacy-artifact-adoption`, `sourceBuildAttestation: unavailable`, and identify the exact pinned release/bundle and reviewed runtime-config protocol. Its desired-input fingerprint means the known artifact was intentionally accepted as compatible with these inputs now, not that those inputs were cryptographically proved to produce the old artifact. If Reviewer cannot accept that compatibility basis, return a concrete provenance blocker; do not fabricate metadata to bypass it.

## One source batch

Planner owns this document only. Coder owns the new UI-selection/copy module and narrowly dependent installer/release packaging changes. Tester owns focused fixture tests. Reviewer receives this plan, code, tests and actual root-cause evidence. User requested audit→batch fixes→one consolidated verification, so write all regression cases and source repairs before running the accepted check pass. No product milestone or completion checkbox is created.

Proposed files:

- Create `scripts/mac-desktop-ui.mjs`: input fingerprinting, strict provenance/legacy-profile validation, bounded managed candidate selection, verified whole-bundle copy and artifact metadata.
- Modify `scripts/mac-desktop-install.mjs`: select/reuse or build UI during buildStage; retain existing fenced activation, rollback and alias ownership checks. Include the new helper in packaged scripts if runtime verification/imports require it.
- Extend `test/desktop-install.test.mjs` and create `test/mac-desktop-ui.test.mjs`: ordinary temporary filesystem and fake-command tests. No compiler, codesign signing, production process or native probe in these guards.
- Change `scripts/desktop-release.mjs` only if required to bind/validate the new metadata under the current full inventory rules; do not loosen any existing manifest/path/secret-file validation.

### A. UI intent and provenance

Define the helper interfaces before implementation: `describeUiIntent({sourceRoot,configPath})`, `selectCompatibleUi({currentRelease,retainedReleases,intent})`, and `copyVerifiedUi({selection,destinationBundle})`. Selection returns a bounded decision (reuse/build/failure), exact source release/bundle paths, artifact hashes and provenance; it launches nothing. Copier returns the verified output artifact record and never signs or rebuilds.

Use one versioned canonical UI intent record: source/Info/icon-builder/license/SVG byte hashes, exact global config-resource path, target and recipe version. Canonicalize sorted keys/records with a defined byte order before hashing. Exclude backend source/runtime UUID and current host/toolchain version from the reuse key: backend or SDK upgrades alone must not replace an otherwise valid UI. Record actual toolchain/build metadata separately for a newly built UI; it is provenance, not a forced-rebuild trigger for the unchanged accepted artifact.

Place `ui-provenance.json` outside the signed .app inside each new runtime and include it in the complete release manifest. Bind its artifact file map to actual copied bytes and its UI intent fingerprint to the desired inputs. For normal new builds, record observed build provenance honestly. For legacy adoption, use the explicit unavailable-attestation origin above. Never add/modify metadata or config inside a reused signed bundle.

### B. Selection and byte preservation

Prefer a verified current UI whose recorded desired-input fingerprint matches. Legacy-v1 absence of provenance is not a match. Permit exactly the two reviewed legacy compatibility profiles recorded here: current508bf preferred, preserved55ad fallback. Resolve only their exact managed release IDs, with complete manifest verification; do not scan arbitrary runtimes or accept profile data from caller input. If current508bf matches its pinned profile and desired inputs, select it even though55ad also exists. Ambiguous or mismatched results refuse selection; they do not trigger a guessed fallback. A parameter accepting an arbitrary app path, CDHash-only allowlist or unverified bundle identifier is not acceptable.

Before adopting either pinned profile, require matching desired inputs, full release manifest digest, exact six-file app inventory/hashes, expected bundle identifier/config-resource path and that profile's exact designated requirement. Retain the old release. If absent, ambiguous, unsafe or mismatched, refuse adoption without rebuilding/re-signing a guessed replacement. The standard installer owns all writes; the operator does not copy files into an installed runtime or hand-edit pointers.

Copy each allowlisted regular file into the private stage and recheck its hash plus inventory; verify source remained unchanged. Preserve every signed byte and CodeResources. Consistent with private runtime packaging, normalize the executable to0500 and ordinary resource files to0400 under private directories; the source CodeResources may have0644. This is intentional restrictive mode normalization, not a claim of preserving POSIX metadata. DR/CDHash and signed content must remain identical. Run read-only strict signature/requirement validation on the copied bundle and compare its DR/CDHash to the selected artifact. Reuse must invoke zero Swift compilation, icon generation and codesign-sign operations. The usual new backend/release manifest still includes the copied bundle bytes and the new UI provenance file.

First installation with no previous artifact follows the existing UI build/sign path and records fresh metadata. A genuine UI intent change must never silently reuse stale UI. Keep the existing build path for that case, report UI identity change explicitly and make no promise that prior OS privacy choices survive. This task restores the unchanged-UI backend-update path; stable identity across arbitrary future UI source changes remains outside this ad-hoc repair.

### C. Regressions before the consolidated pass

Cover all cases in one batch:

1. Backend-only update changes dist/runtime UUID while copied UI files/DR record remain identical; no compiler/icon/sign command requested.
2. A second backend update reuses the already recorded adopted UI without re-searching or inventing historical source attestation.
3. A changed App.swift, Info, icon builder/asset/license/config-resource path changes UI intent and prevents stale reuse.
4. Legacy-v1 missing provenance, unknown legacy hashes, missing/duplicate candidates, wrong manifest digest/DR/config path, extra file, byte tamper, symlink/hardlink/special file and unsafe ancestry all refuse adoption before activation.
5. Copy/source-race or post-copy signature/manifest failure leaves active pointers, config and previous runtime untouched; rollback retains existing ownership/fence behavior.
6. Newly built UI records fresh provenance; legacy metadata remains explicitly unavailable-attestation. No test treats a snapshot timestamp as source-to-binary proof.
7. Existing installer fail-safe/config/login tests continue to pass; package manifest contains required new metadata/helper files and rejects unknown extras as before.

Test real file persistence/copy/hash behavior with synthetic bundles and inject only the existing command boundary for read-only code-requirement validation. Do not expose an arbitrary runtime admission callback or weaken production checks to make tests pass. A fake fixture proves the source contract, not TCC restoration.

## Review and installed verification

Trigger1: Reviewer accepts this compatibility/migration basis and the whole source batch before any production update. Trigger2: one consolidated affected MJS guard pass plus required build/guarded product verification for actual changed product scope, reporting every failure and existing warning. No old consumed broker/relocation experiment is replayed.

Trigger3: after source acceptance, reuse the previously reviewed held-controller/idle-tree maintenance procedure. Standard update/repair preserves the verified current508bf UI into a newly packaged backend runtime, keeping DR/CDHashb6b8d4c24be7201385f7a77e9848b3d30860c093 and using the current accepted scoped-file installation. Use55ad only if the separately reviewed fallback selection conditions apply; its earlier role is not a reason to replace the now-working current identity. No manual installed-file or pointer changes. Preserve both prior runtimes and all failed-operation evidence; do not replay the timed-out earlier mkdir by its old target/name.

Trigger4: verify fresh app ID/RUNNING/CONNECTED, same selected grant and file backend. Through the plugin use one new uniquely named file-check child and bounded create/read/mkdir/copy readbacks. Independently verify the old ambiguous target remains absent before choosing any new operation. Capture narrow TCC unified-log classifications for the responsible app: the old/new code-requirement mismatch must be absent for the new check; no credential/raw private log dump. A prompt, timeout, unknown result or new denial remains UNVERIFIED/BLOCKING as applicable; do not reset TCC or auto-click an OS grant.

Native TCC success is only established by this actual installed journey. Current backend evidence remains valid for its own exact build; it does not certify the UI/privacy journey. Full Mac, shell/Git containment, recovery/tree operations and Windows remain separate incomplete work. Manual-only push, no self-signed gate/state edits, real review-round/time tracking and checkpoints remain; primary applies the user's latest continuous-work instruction without silently resetting native quotas.

## Unresolved feasibility / honest limits

- Legacy source-to-binary provenance is absent. The proposed artifact compatibility adoption needs explicit Reviewer acceptance; it must be reported as such, not as historical build proof.
- Preserving the selected signed bytes is expected to preserve that code identity, but actual TCC policy/cache/path behavior must be observed after the managed update. This plan does not grant OS access.
- A genuine future UI change cannot retain the old ad-hoc cdhash by this method. Certificate/permission decisions are not smuggled into this repair.
- No permission change, TCC.db/reset command, certificate/key creation, weak explicit DR, original VM media or unrelated app/process is part of this plan.

## October27 fresh-read amendment — preserve current508bf

After the19:35→23:57 pause, the primary's actual plugin call around00:00Vietnam on2026-10-27 returned SUCCESS with entries[] for list_directory path`.` under current508bf. The earlier TCC prompt is no longer blocking this read. Who or what resolved it is unknown; do not infer user action, an automatic grant or a policy change. This is one successful read, not write/native/full-Mac acceptance and not permission to retry the old timed-out mutation.

Deployment strategy therefore preserves the currently working508bf UI rather than restoring55ad by default. The root defect remains unconditional UI regeneration during backend updates. This amendment changes selection/deployment strategy only; it creates no new native evidence, quota or mutation retry.

Preferred profile:

- Managed release ID `508bf766-23c5-4cac-9e8c-81731203957e`, resolved only below the existing owned runtimes directory.
- Full manifestSHA `07321da715be695758bc4838f304c992578214b727bf6afa88c393ad79fa9574`.
- Exact DR/CDHash `b6b8d4c24be7201385f7a77e9848b3d30860c093`.
- Contents/MacOS/GSA Local ConnectorSHA `9b119d1f2a4feab3dadf164440f34a53f430783e43c2c991b6281c20488c5784`.
- Contents/Resources/GSAConnector.icnsSHA `6348fd0ca8bfecf47729d71928c184374d2a94e764f224314f3b8c28c3d8c32c`.
- Contents/_CodeSignature/CodeResourcesSHA `ca1d22d5a89e61a089984abd559e2aff6ef5e2e8e2a5426843980979345b9036`.
- Info.plist, Icon-LICENSE.txt and desktop-config-path.txt retain exactly the three hashes already listed in the55ad table. The inventory must contain exactly these six files, not merely the three changed files.

The508bf artifact was built during this session; its manifest and68 packaged JS files were verified. That strengthens the available compatibility evidence, but no UI source-build receipt was recorded at build time. Its migration metadata therefore uses the same honest `origin: reviewed-legacy-artifact-adoption` / `sourceBuildAttestation: unavailable` representation. Do not backfill a cryptographic build attestation for either profile.

Selection tests must pin current508bf preference when both known releases exist, reject current-profile tamper/mismatches rather than silently downgrading identity, cover an explicitly eligible55ad fallback without arbitrary scanning, and preserve unavailable-attestation metadata for both. The initial Tester suite reported74 total /64PASS /10 fixture-or-metadata failures pending the Reviewer's complete classification. This amendment authorizes no implementation fixes or test assertion changes by the Planner; the whole classification must precede the next source/test repair batch.

## Consolidated review round1 repair classification

Independent Reviewer accepted the fresh-state amendment preserving known-current508bf first. It identified two additional source blockers: genuine UI changes on a valid known legacy current release must select the documented fresh-build path, while damaged/unknown unchanged legacy artifacts still fail closed; and bounded full-candidate inventory/byte checks plus early fixed manifest pins must precede the unchanged general verifier. These join current-profile preference as one three-group source repair batch.

The initial guard failures are fixture issues: intentional tamper writes need writable disposable copies; Unix socket fixtures need short Darwin-compatible paths. Legacy installed inspection/rollback remains supported, but newly built stages legitimately require UI provenance. Tests must move legacy acceptance to inspectCurrent and retain strict verifyStage, not weaken new admission. Persisted second-update reuse and current-profile preference require actual temporary-filesystem cases. No tests or deployment repeat until the entire repair batch freezes.
