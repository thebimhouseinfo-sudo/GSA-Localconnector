# Mac27 installed BASE refresh plan

Status: PROPOSED / pending evidence and maintenance review. No installation, signing, build, controller acquisition or native process was run by this planning task.

Goal: replace the installed connector's stale-host scoped-file binding with the exact current-host BASE/READ build already exercised through the strict public loader, then verify the selected real workspace through gsa-lc-mac. This serves existing criteria1–3,7–8; it does not change GOAL, criteria, gates or add a milestone.

Architecture: reuse the existing stopped-owner scoped-file installer and standard desktop updater. Retain exclusive authenticated control until the verified idle tunnel exits; publish only after the installer obtains the genuine kernel owner fence. Preserve previous scoped files and desktop runtimes. This is the same maintenance pattern reviewed in `docs/reports/2026-10-23-mac-rebind-maintenance.md`, updated for the current host/build and user-selected child.

Tech stack: existing Node ESM installers, supported connector APIs, macOS launchd/codesign/Swift tools and metadata-only process inspection. No new dependency, helper, permission, entitlement, global setting or source change.

Authority: the user requested finishing the installed Mac app and testing it, selected the child inside Test, and most recently requested continuing until finished while away. These task instructions authorize ordinary reviewed repair/update of the already intended BASE subset. The separate one-run native approval was consumed only by that experiment and is not reused as installation authority. No routine time-extension question is introduced by this plan. The primary records real rounds/time and current explicit user steering; no role may silently reset counters. MANUAL_ONLY push remains unchanged.

## Fixed inputs and observable result

- Repository: `/Users/nam/GSA-Localconnector`; preserve the dirty `codex/mac-completion` checkout. No fetch/pull/merge/rebase/stage/commit/push/branch change.
- Selected root: `/Users/nam/Desktop/Test/GSA-Workspace-20261025-2049`, id `ws-eebfc54d79b7348c`, workspace revision1. Last recorded identity16777231/5230710 is historical until supported inspection confirms it; do not repin if changed.
- Identity/installation root, from existing `identityDirectory()` on this host: `/Users/nam/Library/Application Support/GSA-Localconnector`.
- Evidence: `/private/tmp/gsa-mac27-base-3eae0d4bfed255ac7ba20ef0/native-evidence.json`; native report `docs/reports/2026-10-26-mac27-native.md`. Evidence must remain byte-for-byte unchanged and pass independent Reviewer classification before use. A reviewed durable copy may be substituted only if byte digest equals this original.
- Expected build: host27.0.0/arm64; releaseSHA `3c540b7f5e151ad74c313c758aa12b1f249524db8a367b8692b5f33e24c00aea`; normalized codeSHA `6327855b5793d3a66ab2f937c2cc16f89ec7d24303ff524889c80fd15a9abf74`; sourceSHA `865042b5a685f3af271394e8f65aee799b87844dd8623db1d610741661ebdc50`; signing profile `gsa-scoped-files-adhoc-single-root-v1`. All other build fields must match through unchanged validator, not a subset comparison.
- Current live symptom: fileBackendAvailable=false / Invalid scoped file binding. Desired delivered result: current app RUNNING/CONNECTED; same selected grant and no new selection warning; fileBackendAvailable=true with exactly create_file/create_directory/copy_file, and successful plugin read/create/mkdir/copy readbacks. hostFileWrites may remain false because the complete product file-operation set is still unavailable.

## Review focus and stop conditions

Active/unknown work, unexpected managed descendants/orphans, drifted PID/birth/executable/parent/FD, lease expiry, grant/root drift, mismatched evidence/build, unsafe private metadata, fence loss, failed installer rollback, and unknown mutation outcome all block further destructive steps. Preserve evidence, classify the concrete issue and repair within existing authority; do not continue by guessing, repinning, killing broadly or retrying a mutation.

Do not read/print `.env`, proof keys, tokens, owner lock contents or raw grant-store files. Supported APIs/installers may use their own protected state internally. Read only whitelisted nonsecret desktop metadata through `createMacPrivateFile().readVerified`, and verify manifests with the existing release verifier. Never print controller tokens. Do not use `launchctl print` or process argv/environment dumps.

## Task 1 — confirm evidence and prepare maintenance

Owner: primary with independent Reviewer; no source/Coder work required. Review trigger A is the complete evidence plus this concrete procedure, not a new native run.

1. Reviewer inspects native-evidence/build/reports/raw receipts only, checks unchanged requireMacFileEvidence and six-phase relocation/actual denials/readbacks. It must accept only current exact BASE+READ fixture evidence. No old probe or consumed reservation is repeated.
2. Use the supported read-only installer inspection:

```sh
node scripts/install-mac-scoped-files.mjs inspect
```

Expected SCOPED_FILES_PLAN, exactly the current selected child/role/revision/root identity. Compare to plugin list_workspaces/get_workspace; any mismatch is a blocker. Do not pass `stage` or `apply` yet.
3. Through existing metadata readers, verify desktop/runtime-current.json, desktop/config.json and desktop/status.json agree on the current installation; verify its manifest and the owned Applications alias. Record paths/IDs/status only, never env bytes.
4. Confirm the compiled `dist/src` graph remains the exact graph hashed by the accepted native report/preceding666-test batch. Desktop buildStage first runs the existing TypeScript compiler and then copies dist (mac-desktop-install.mjs:133–134). The preceding statement in the initial plan that it only copies dist was incorrect. Recheck the packaged compiled hashes after update against the accepted graph. If source/dist drift is found, investigate before installation; run the appropriate guarded verification only for actual new product changes. Do not repeat the accepted666 checks merely because this plan exists.

## Task 2 — exclusive-control idle stop

Owner: primary; Reviewer approves the captured fresh metadata/process map before the single stop. Reuse prior maintenance steps2–6 without reusing their old PIDs.

1. Acquire exclusive control via gsa-lc-mac. Keep the token private and renew the lease through final inventory and verified tunnel exit. Recheck selected workspaces, list_processes and ci_list_runs. Require empty/terminal work with no pending/unknown ownership for the selected scope; active or ambiguous work blocks maintenance.
2. Inventory the entire owned app subtree and all processes whose executable resolves inside this managed runtime outside that subtree. Use PID/PPID/start identity/comm-executable metadata only. The known idle shape is app → bundled Node supervisor → Python desktop-owner guard and tunnel client → two retained CLI Node children. Verify every node from current manifest/config, not by a process-name match.
3. Resolve the app's Applications alias to the verified executable. The guard can be the root-owned signed CommandLineTools Python.app rather than literal /usr/bin/python3; verify its executable/parent and open FD3 path to desktop/desktop-owner.lock without reading bytes. Any extra worker/broker/Python/unknown descendant or managed orphan is a blocker; a read-only inventory may observe transient activity later, but must not force it away.
4. Verify the current owned LaunchAgent plist at `/Users/nam/Library/LaunchAgents/com.gsa-localconnector.mac.plist`: Label exactly `com.gsa-localconnector.mac`, ProgramArguments.0 exactly `/Users/nam/Applications/GSA Local Connector.app/Contents/MacOS/GSA Local Connector`, and private safe metadata. Use targeted plutil extraction, not full job/environment output.
5. Immediately before signalling, recheck lease validity, full idle map, exact retained tunnel PID/start/executable/parent and managed-orphan absence. Signal ONLY that verified tunnel PID with one SIGTERM. A PID value must be inserted from the just-reviewed inventory, never from this plan/history. Wait at most30 seconds for tunnel/CLI children/supervisor/guard to exit naturally. No SIGKILL, process-name kill or lock deletion. Timeout/uncertain exit stops here and preserves UNKNOWN.
6. Only after all those children are confirmed absent, retire the exact verified application job:

```sh
/bin/launchctl bootout gui/<verified-current-uid>/com.gsa-localconnector.mac
```

The uid is obtained from the executing user's process.getuid(), not invented or copied from another host. Confirm old app/descendants absent and the job absent using `launchctl list`. The next installer must acquire its genuine stopped-owner lock normally. The held controller prevents another authenticated start until actual tunnel exit; normal next owner startup invalidates the old lease.

## Task 3 — existing strict apply and desktop update

Owner: primary; Tester records exact command exits/reports. No custom copying of signed installations or manual proof/grant/pointer edits.

Run once, sequentially, from the repository:

```sh
node scripts/install-mac-scoped-files.mjs apply --evidence /private/tmp/gsa-mac27-base-3eae0d4bfed255ac7ba20ef0/native-evidence.json
```

The existing applyMacScopedFiles acquires the stopped-owner fence, builds a fresh reproducible release, re-signs only the already selected roots, and calls unchanged requireMacFileEvidence against the COMPLETE fresh build before publication. It then rechecks grants/separation/fence and publishes by rename, retaining scoped-files.previous-*. Expected SCOPED_FILES_INSTALLED_PARTIAL / recovery:false / exactly three supported write operations. A build mismatch or any failure is not permission to alter the evidence, skip validation or retry blindly. Preserve previous/staged artifacts and determine publication state.

After successful apply, run the standard updater:

```sh
bash /Users/nam/GSA-Localconnector/install.sh update
```

It reuses valid saved configuration, packages the accepted current compiled source including the nine-group source batch, verifies its manifest, retains the previous runtime, updates the owned alias/metadata and restarts the owned app/login registration. Expected JSON state INSTALLED, followed by matching new installationId/RUNNING/CONNECTED. Do not request/re-enter keys or force setup; a configuration error stops normally and is diagnosed without exposing secrets. The update's compiler/signing/build work is ordinary existing installation work, not another relocation experiment or reuse of the native attempt quota.

If apply succeeds but desktop update fails, record that split state. Do not call it delivered. If update succeeds but the connector is unavailable, use bounded read-only diagnosis, not repeated update/apply or mutation replay.

## Task 4 — actual plugin acceptance and closeout

Owner: primary/Tester; independent Reviewer classifies the final installed evidence against the narrow result above.

1. Allow up to30 seconds of bounded read-only connector_status/list_workspaces polling. Require new desktop installationId, RUNNING/CONNECTED and exactly the intended BASE operations. Record all transient failures truthfully. Do not use fixture success as the installed result.
2. Acquire a fresh controller. Through gsa-lc-mac only, create one unique `gsa-file-check-20261026-<nonce>` child under the already selected workspace; create `original.txt` with fixed nonsecret UTF-8 content; fetch/get_file_info it; copy to `copy.txt` using the actual expected SHA; fetch/hash both. Require exact byte/hash equality.
3. Attempt one exclusive create collision and one wrong-expected-hash copy; require expected denial, unchanged original/copy and absent wrong-hash destination. Attempt one unsupported move; require SECURITY_BLOCKED and absent destination. Read final directory contents. A mutation with UNKNOWN is not replayed. Retain files for inspection and release the controller normally.
4. Write one sanitized installed report with exact current runtime ID, grant/identity/revision, build/evidence digests, previous-installation recovery paths, command results, plugin readbacks and all failures. Classify narrow BASE acceptance only. Recovery, directory/tree operations, host shell/Git, retained-FD host containment and full Mac remain separate incomplete work. Windows still waits for full Mac acceptance.

## Failure preservation / recovery

Before publication failure, the old scoped installation remains. Publication rename failure invokes the installer's own rollback; preserve its actual result. Desktop failure uses built-in rollbackStage; verify and report whether old alias/pointer/config were restored. Do not hand-repair proofs/pointers or remove previous runtimes. If an administrative recovery action beyond these existing rollback paths becomes necessary, prepare the exact observed corrective action for review first; do not infer success or delete ambiguity.

Review checkpoints: A accepted native evidence and plan; B fresh held-lease idle map immediately before one tunnel signal; C apply/update result; D actual plugin acceptance. Maximum five review/repair rounds per pair; primary tracks the user's latest explicit continuous-work instruction and real elapsed time, keeps checkpoints, and does not self-reset counters or mark harness completion. Gate remains GUIDED_ONLY/AWAITING_USER; no self-signature/checkbox change. This plan revises the older Test-parent maintenance inputs to the explicitly chosen child and current Mac27 exact release; it introduces no product feature or gate.

## Unverified until execution

Current PID/start identities and installationId, controller/idle state, current grant/root identity, fresh compiled graph equality, current launchd ownership, reproducibility of the installer's fresh build, successful rollback behavior if triggered, and actual post-update plugin calls are all UNVERIFIED. These are observations to obtain through the steps above, not facts supplied by the native fixture and not reasons to weaken the existing checks.
