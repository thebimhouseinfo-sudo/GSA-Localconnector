# Proposed single Mac host bootstrap variant — 2026-10-23

**Status: ONE EXPLICITLY APPROVED SUITE CONSUMED; STOPPED AT GIT STARTUP. DO NOT RERUN.** The user approved the exact driver and exposures below. One execution stopped after three native commands: workspace read/write succeeded, then Git failed opening `/dev/null` for reading and writing. Remaining nine cases were not executed. See `docs/reports/2026-10-23-mac-host-bootstrap-native.md`. No production activation or full feasibility PASS follows. The fixed reservation must remain intact; any changed profile or additional suite needs separate concrete review and explicit approval.

Prepared driver: `scripts/test-mac-host-bootstrap.mjs`, SHA256 `6535b3f7b6519b9ebd6d26f24402a356260d9656f6987ff580a5b091b0749bac`. Exact proposed command: `node scripts/test-mac-host-bootstrap.mjs --run --ack-reviewed-bootstrap-variant`. Syntax, read-only plan, and six nonnative tests pass. Independent Reviewer found no remaining BLOCKING source issue after the first review repair; no native launch or slot consumption occurred. Preparation evidence: `docs/reports/2026-10-23-mac-host-bootstrap-preparation.md`.

## Existing evidence supporting one changed hypothesis

Already-generated crash `/Users/nam/Library/Logs/DiagnosticReports/cat-2026-10-23-162901.ips` records cat PID53035, parent node PID53018, SIGABRT, namespace0x23/code2, and ignition_halt → boot_boot → CacheFinder frames. Parent's existing PID-filtered log read recorded denied sysctl-read `security.mac.lockdown_mode_state`, sysctl-read `kern.bootargs`, and file-read-data `/`. No new policy call was made to obtain this proposal.

[Apple XNU reason.h](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/sys/reason.h) maps namespace35/0x23 to OS_REASON_LIBIGNITION. Code2 alone does not establish the individual denied operation that caused termination. The three denials support this bounded hypothesis, not a proven repair.

Installed Apple profile data directly supports the syntax and root-open hypothesis:

- `/System/Library/Sandbox/Profiles/dyld-support.sb:53–56` says libignition opens `/` as an openat root and permits literal `/` reads.
- `/System/Library/Sandbox/Profiles/colorsyncd.sb:17` uses `(allow file-read-metadata file-read-data (literal "/"))`.
- `/usr/share/sandbox/com.apple.spotlightknowledged.importer.sb:84` demonstrates sysctl-read with exact sysctl-name filters; `container.sb:144` names kern.bootargs. This verifies installed grammar, not future enforcement or availability of either value.
- Installed sandbox-exec man page marks the tool deprecated. This experiment does not replace that limitation or rely on an invented sandbox_init API.

## One immutable variant

Use one independent test profile; never edit `src/hosts/macos-seatbelt-candidate.ts` or upgrade its rejected verdict. The only new bootstrap exceptions are exact literal-root read and two named read-only sysctls:

```scheme
(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow file-read-metadata file-read-data (literal "/"))
(allow sysctl-read (sysctl-name "security.mac.lockdown_mode_state"))
(allow sysctl-read (sysctl-name "kern.bootargs"))
(allow file-read* (subpath (param "WORKSPACE"))
  (subpath "/System/Library") (subpath "/usr/lib")
  (subpath "/usr/libexec") (subpath "/usr/bin")
  (subpath "/usr/sbin") (subpath "/bin") (subpath "/sbin")
  (subpath "/Library/Developer/CommandLineTools")
  (literal "/dev/null") (literal "/dev/urandom"))
(allow file-write* (subpath (param "WORKSPACE")))
(deny network*)
```

This declared system/toolchain set deliberately excludes broad `/Library`, `/usr`, `/usr/local` and `/System` ancestors from the old candidate. Resolve/record these installed system paths as data before run review; if symlink/volume aliases broaden them into project/user/private data, stop BLOCKED rather than adding permissions. Missing toolchain paths/tools also block preparation; no installation is allowed. The two bootstrap exceptions are the hypothesis; simultaneous narrowing means a failure does not identify either exception individually.

**Root-name exposure:** file-read-data on literal `/` may allow listing immediate root directory entries. That is an explicit exposure to review, not access to all descendants. Never replace literal with subpath `/`. Include the names-only observation below and disclose that root-name visibility may still conflict with the required project-data boundary; the reviewer/user must decide before this profile could be considered further. A root FD may support relative lookups, so actual outside-descendant denials remain mandatory. No root entry names need be printed in chat/logs: persist only bounded entry count/hash and whether synthetic descendant bytes remained denied.

Do not explicitly read or print kern.bootargs or lockdown values. Boot code may read these two values under the proposed allow rules; grant no sysctl-write, name-prefix or blanket sysctl access. No inherited host credentials, project configuration, connector state or extra open descriptors; the trusted driver retains any owner fence, and the sandboxed test child gets only stdin/stdout/stderr.

## Concrete preparation task before requesting approval

Primary may prepare inline because assigned Coder quota is unavailable; record that role limitation honestly. Own only new `scripts/test-mac-host-bootstrap.mjs` and a focused test under `test/`, with snapshots. No native product/policy/installer changes. Default/no args and `--plan` are read-only and print the fixed profile, command templates, limits and approval-pending status. `--run` must be explicit; no native call during preparation/unit tests. An injected spawn runner is for deterministic test verification only, never native PASS.

Driver creates a private synthetic fixture with sibling workspace W, outside U and reference R; all are unique, canonical, same-volume directories under private temp storage. W includes allowed.txt, a simple Makefile, private HOME/tmp, and a symlink to U/world.txt. U/world.txt and R/source.txt contain unique known markers and are world-readable; independent canaries/hash/inode checks cover each sibling. Use no real Test/project/installed identity or VM media. The Node driver owns a loopback-only ephemeral listener for the network control; no Internet/DNS access.

For every case use `/usr/bin/sandbox-exec -p FIXED_PROFILE -D WORKSPACE=W EXEC ARGS` with cwd W, a minimal fixed PATH, HOME=W/home and TMPDIR=W/tmp. Disable ambient Git config/credentials via explicit empty test environment and W-private config paths. No shell interpolation of untrusted paths; command strings below are fixed with positional arguments. Each sandbox invocation has 5s timeout and combined output cap16KiB; whole suite ≤60s. Stop on the first positive failure, escape, timeout, output cap or unclassified denial. Never ladder/tune/retry the profile.

Fixed ordered cases, maximum12 sandbox-exec launches, each once:

1. `/bin/cat W/allowed.txt`: exact allowed bytes, exit0, no signal.
2. `/bin/sh -c 'printf owned > "$1"; /bin/cat "$1"' fixture W/created.txt`: exact created/read bytes, exit0.
3. `/usr/bin/git --version`: bounded version output/exit0; this tests tool startup only, no live Git mutation or remote.
4. `/usr/bin/make -f W/Makefile`: Makefile uses fixed `/bin/sh` printf to create W/built.txt; exact bytes/exit0. This is a synthetic existing-script shape, not SDK/app build acceptance.
5. `/bin/ls -1 /`: record bounded names-only count/hash, not descendant contents; this observation cannot be labeled outside-read denial.
6. `/bin/cat U/world.txt`: marker inaccessible, U hash/inode unchanged.
7. `/bin/sh -c '/bin/cat "$1"' fixture U/world.txt`: same denial through a descendant.
8. `/bin/cat W/outside-link`: same denial through the workspace symlink.
9. `/bin/sh -c 'printf escape > "$1"' fixture U/new.txt`: denied, destination absent and U canary unchanged.
10. `/bin/sh -c 'printf escape > "$1"' fixture R/new.txt`: denied, R source/canary unchanged.
11. `/bin/sh R/script.sh`: R/script.sh would emit its known marker; direct reference script remains unreadable/unexecuted. Reference reading/copy remains broker-only in this host feasibility profile.
12. `/usr/bin/nc -G 1 -w 1 127.0.0.1 PORT`: network denied and listener receives zero bytes/connections. Driver validates its own listener before the suite without sandbox-exec; no external host is used.

For negative cases require attributable expected denial evidence and unchanged namespaces/bytes, with no marker output. SIGABRT, startup failure, generic nonzero exit or an unusable nc do not constitute a denial PASS; mark INCONCLUSIVE/UNVERIFIED and stop. Collect only bounded PID-specific sandbox-denial diagnostics if needed, never broad logs/sysctl values. Preserve raw receipts and fixture on failure; cleanup only owned child/fixture identities, no global process scanning/killing.

Before the first sandbox child launch reserve fixed repo path `docs/reports/.mac-host-bootstrap-v1.attempt.json` using O_CREAT|O_EXCL|O_NOFOLLOW, mode0600, fsync file and directory. Record driver/profile hashes, source/host/tool paths, fixture identities and planned12case budget. The path is not configurable; no auto-delete/reset/recovery execution. Existing slot means no run. Slot consumption survives spawn failure/crash. Record each case reservation before its launch; interrupted execution cannot resume missing cases. This new slot does not reset any historical Seatbelt or recovery allowance.

Unit checks verify exact profile filters, fixed case order/budget, no-run default, exclusive guard, stop-on-first-failure, invalid paths/output/timeout handling, child cleanup and no implicit retry. Review actual driver/profile hashes, guard path, exact run command and disclosure of root-name/sysctl exposure before asking the user to approve this one suite. A paper plan is not authorization or evidence of driver readiness.

## Result boundary

A completed suite establishes at most feasibility of this exact profile/host/toolchain for these12observations. It does not activate shell/Git or create VerifiedNativeSandbox. Native process ownership, setsid/double-fork escape, root replacement/relocation races, revocation of already-open handles, durable timeout/cancel and restart reconciliation remain UNVERIFIED regardless of feasibility PASS. No claim that root names are hidden, no weakened criteria, no production rollout and no Windows development until full Mac acceptance.
