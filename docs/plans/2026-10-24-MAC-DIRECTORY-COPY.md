# Mac bounded directory copy implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` for the assigned source task; use project role dispatch only at the review triggers below. Checkboxes are proposed steps, not harness completion state.

**Goal:** Implement one missing Mac directory-copy slice under existing criteria §§3/4/7/8: reference/workspace source to a new workspace destination, with bounded native traversal and honest interrupted outcomes.

**Architecture:** Add a separate, signed, read-only, single-root tree broker. Capture bounded file bytes and a canonical manifest through that broker, then compose the existing destination broker's exclusive mkdir/create operations. Keep the accepted base broker, its source/build pins and proof unchanged; separately validate the new tree artifact and installation before advertising directory capabilities.

**Tech Stack:** TypeScript ESM/Node >=20, Swift/Foundation/CryptoKit/Darwin/Security; existing dependencies only.

**Spec:** `docs/CRITERIA.md` §§3/4/7/8 and “Directory copy and destructive mutations remain separate” in `docs/plans/2026-10-19-MAC-FILE-BACKEND-PROGRESSION.md`.

## Global constraints

- This is proposed implementation detail of the existing approved Mac scope, not a new goal, milestone, criteria edit or Mac acceptance claim. Current direct user authorization covers routine implementation/testing; it does not create an attestation or change harness approvals.
- Preserve all existing work on `codex/mac-completion`; no branch changes, fetch, push, merge, rebase, VM/probe execution or live installation in planning. Push remains MANUAL_ONLY.
- No Node project-tree enumeration/read/copy, recursive path copy, source mutation, overwrite, cleanup rollback, retry or resume. Node filesystem access is limited to existing protected installation checks and the new protected metadata store.
- Keep `native/macos-files/broker.swift` and accepted base evidence byte-for-byte unchanged. Do not change recovery/history contracts, installed one-shot records, existing copy-file behavior, host shell/Git activation, permissions or global settings.
- Root/ancestor relocation and unavailable Apple ES remain separate unresolved Mac limitations. This slice cannot certify full rootguard, shell/Git or full Mac completion.
- Production new capabilities require exact changed-artifact native read-confinement evidence, protected installation binding and review. Unit/mock/build success cannot enable them. Missing or invalid tree proof must preserve available base capabilities.

## Review focus

1. An unsafe descendant, invalid filename or late over-budget entry rejects the entire source capture before destination effects; never silently skip it.
2. External source changes produce observed-change failure or a documented bounded observed capture; never claim an atomic whole-tree snapshot.
3. Existing/recreated destination entries survive. A replaced destination directory may receive exclusive additions before the change is detected; report the actual uncertainty without claiming rollback or absence of effects.
4. Revocation/root/role changes between capture and each write stop further work; already created entries remain reported.
5. Lost acknowledgement, process restart or durable-store failure preserves UNKNOWN and never replays a copy ID, including one whose last native create succeeded.

## Builder decisions and exact contract

The separate helper avoids invalidating the working base broker merely to add enumeration. Its narrower read-only entitlements apply to workspace sources as well as references. The cost is a separate artifact/proof and loader; do not generalize this into another file platform.

Use fixed v1 limits, accepted equally or lowered by callers only in a later change: depth 16 (source root depth 0), 1,024 entries **including root**, 8,388,608 aggregate regular-file bytes, 8,388,608 per-file bytes, 524,288 canonical manifest bytes, 12,582,912 total broker-response bytes, 15-second helper timeout. Empty directories count. Limit+1 rejects; no truncation. File contents are held only in bounded memory, never journaled or logged.

Paths use existing workspace-relative validation: nonempty, max 4,096 UTF-8 bytes, no absolute/empty/dot/dot-dot/backslash/NUL/`.gsa-trash` components. The sole exception is exactly `"."` for the directory source in `inspect_directory`, `copy_directory` and native capture: it means the selected bound root itself, opened by duplicating its verified root FD; never bind an unauthorized parent or use a raw-path fallback. Destination remains a nonempty child path and rejects `"."`; manifest root remains `""`. Restrict native names to valid round-tripping UTF-8; reject unrepresentable names, never normalize or replace them. Preserve case and UTF-8 byte ordering. Reject symlinks, regular files with link count other than 1, sockets/FIFOs/devices and descendants on a different device. Directory link counts are not regular-file hardlink checks. Do not preserve mode/ACL/xattr/resource-fork/sparse-layout/ownership metadata: destination dirs remain 0700 and files 0600, matching current primitives; document byte-content and directory-structure semantics.

Define in new `src/core/directory-copy.ts`:

```ts
type DirectoryEntry =
 {path:string;kind:"directory"} |
 {path:string;kind:"file";size:number;sha256:string};
interface DirectoryManifest {
 format:"gsa-directory-manifest-v1";
 entries:readonly DirectoryEntry[]; total_bytes:number; sha256:string;
}
interface DirectoryCapture {
 manifest:DirectoryManifest;
 files:readonly {path:string;bytes:Uint8Array}[];
 // Native root/directory/file identities and pre/post stat observations;
 // validated separately and excluded from the portable content digest.
 observations:readonly DirectoryEntryObservation[];
}
interface NativeDirectoryReader {
 capture(source:ScopedFileRef):Promise<DirectoryCapture>;
}
interface DirectoryCopyOutcome {
 copy_id:string; status:"APPLIED"|"CONFLICT"|"UNKNOWN";
 source:ScopedFileRef; destination:ScopedFileRef;
 manifest_sha256:string;
 acknowledged:readonly {path:string;kind:"directory"|"file"}[];
 pending_path:string|null;
 reason:string; committed:false;
 readback?:{status:"MATCH"|"DIFFERENT"|"ABSENT"|"UNAVAILABLE";
   manifest_sha256:string|null;reason:string};
}
```

`DirectoryEntryObservation` has exact fields `{path,device,inode,kind,size,mtime_ns,ctime_ns}`; device/inode/nanosecond timestamps are decimal strings, kind is file/directory, size a safe nonnegative integer. Root path is `""` in manifest/observations only; it cannot be passed as a scoped request path. Entries include root first and then sort by raw UTF-8 path bytes; require exactly one directory parent for each descendant, unique paths and no file ancestors. `directoryManifestDigest` canonicalizes entry order by raw UTF-8 path bytes without mutating its input; capture validation requires the received entries already have root-first canonical order. Digest is lowercase SHA-256 of UTF-8 `JSON.stringify(["gsa-directory-manifest-v1", tuples])`, without newline; directory tuple `[path,"directory"]`, file tuple `[path,"file",size,sha256]`. Hash excludes observations and `sha256` itself. Recompute all file hashes, byte totals and canonical encoding in TypeScript; reject extra/missing/duplicate payloads and unknown wire fields. Tests may pin literal contract values; no exported test-constant API is required.

`validateDirectoryCapture(value:unknown)` accepts exactly the JSON wire payload `{manifest,files:[{path,base64}],observations}` and produces the internal `DirectoryCapture` above with `files:[{path,bytes:Uint8Array}]`. Require canonical padded RFC4648 base64 (empty string permitted for an empty file), decode within the per-file/aggregate caps, and verify decoded size/hash against the manifest. Reject wire `bytes`, plain number arrays, noncanonical base64 and extra fields; there is no second internal-input validator form. Native success envelope is exactly `{ok:true,format:"gsa-directory-capture-response-v1",binding:{workspace_id,role,root,device,inode,revision,path},capture:<wire payload>}`. Native failure envelope is exactly `{ok:false,error:<bounded code>}`. The installation adapter validates envelope format/exact keys and matches all binding fields against its pinned request before passing only `capture` to the core validator; envelope fields never enter the portable manifest digest.

Add optional `directoryCopies?: NativeDirectoryCopies` to `NativeScopedFiles`; do not alter legacy required methods or infer support from an omitted `supportedOperations`. `NativeDirectoryCopies` provides `inspect(source):Promise<DirectoryManifest>`, `copy(copyId,source,destination,expectedManifestSha256):Promise<DirectoryCopyOutcome>` and `readCopy(copyId):Promise<DirectoryCopyOutcome>`. Add `"copy_directory"` to `NativeFileOperation`; inspection/readback use explicit extension capability flags, not a claim that every file operation is enabled.

MCP tools (strict exact keys, no arbitrary recovery/proof paths):

- `inspect_directory({workspace_id,path})` requires source read; returns manifest only.
- `copy_directory({copy_id,source_workspace_id,source_path,destination_workspace_id,destination_path,expected_manifest_sha256})` requires controller, source read, destination write. `copy_id` is a lowercase UUID matching existing transaction ID syntax, chosen before the request so a lost response is inspectable. It is an idempotency binding, never permission to replay.
- `get_directory_copy({copy_id})` requires controller plus current read grants on both bound roots; returns protected progress and current read-only destination observations. Revoked grants deny readback rather than restoring authority. Unknown IDs reject; never synthesize success.

## Task 1 — Bounded native source capture and typed contract

**Trace:** §§3/4 directory bytes and structure, §7 source boundary. **Owners:** Coder for source only; Tester for all RED/verification tests. This source/test ownership division applies to every task below; RED step placement does not assign tests to Coder.

**Files:** create `native/macos-files/tree-broker.swift`, `src/core/directory-copy.ts`, `test/directory-copy.test.ts`; add the optional extension types in `src/core/native-io.ts`. Tester later owns `native/macos-files/test-tree-broker.py`.

- [ ] Tester writes RED contract tests for canonical digest vectors (empty directory and nested Unicode filename), digest canonicalization versus validator ordering, selected-root source `"."` allowed/destination `"."` denied, every fixed limit at boundary/+1, strict wire base64→internal bytes conversion and rejection of `bytes`/number arrays/noncanonical encoding, malformed manifest/payload, empty dirs, unsupported names/types and duplicate paths. Run `npm run build` then `node --test dist/test/directory-copy.test.js`; expected RED is missing new module/interface, not an unrelated compile failure.
- [ ] Implement `validateDirectoryCapture(value:unknown):DirectoryCapture` and `directoryManifestDigest(entries:readonly DirectoryEntry[]):string` in the core file, with the exact contract above. No I/O in validation.
- [ ] Implement the one fixed native operation `capture_tree`: signed Info.plist pins workspace ID, role, root, revision, device/inode; require App Sandbox and **only** the exact single-root read-only absolute-path exception for either role. Accept the standard binding fields plus `path`; reject additional fields. For exactly `path:"."`, duplicate the verified bound root FD directly; other sources use validated descriptor-relative child traversal. Keep owner FD 3 CLOEXEC as current broker does.
- [ ] Traverse using `openat(O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC)`, `fdopendir` on an owned duplicate descriptor, `readdir`, `fstatat(...,AT_SYMLINK_NOFOLLOW)` and `fstat` on opened files. These APIs are declared in installed macOS SDK `usr/include/dirent.h` and `sys/stat.h`; check Swift import signatures when building, never replace them with recursive path APIs. Close every FD/stream on all branches. Do not trust `d_type`, follow aliases or silently skip entries other than `.`/`..`.
- [ ] Read bounded regular files with before/after stat/hash checks like existing `readFile`; retain per-directory before/after identity/ctime/mtime and compare child names/identities in a second bounded enumeration. Any observed substitution, addition/removal or content change rejects capture. A change outside the observed windows can evade detection; the manifest means the bytes/entries observed by this run, not a globally atomic snapshot. Return payloads only after successful complete capture and output-size check.
- [ ] Run focused typed tests; preserve native execution for Task 4. Snapshot task-owned files before editing. Do not modify base broker or generate production evidence.

## Task 2 — Exclusive copy coordinator and interruption truth

**Trace:** §§3/4 workspace destination, §7 grant checks, §8 durable uncertainty. **Owner:** Coder.

**Files:** create `src/hosts/macos-directory-copy.ts`, `src/local/directory-copy-store.ts`, `test/mac-directory-copy.test.ts`, `test/directory-copy-store.test.ts`. Reuse protected-storage invariants from `src/local/file-transaction-store.ts` without changing its replace/trash schema or history/readback behavior.

**Interface:** `createMacDirectoryCopies(registry,reader,base,store,authorize):NativeDirectoryCopies`, where base is existing `NativeScopedFiles`, authorize has existing `(workspaceId,permission)=>Promise<void>` shape, and store is `DirectoryCopyStore` below. Capture immutable caller arguments before any await.

Export these pure metadata types and `assertDirectoryCopyIntentBudget(intent:DirectoryCopyIntent):void` from `src/core/directory-copy.ts`; add no source I/O or changes to Task 1's capture validator. All fields/arrays below are recursively readonly, and all store inputs are cloned/validated before the first await; returned records are independent immutable clones.

```ts
interface DirectoryCopyPinnedRef {
 workspace_id:string; path:string; canonical_root:string;
 role:"workspace"|"reference"; revision:number;
 rootIdentity:{device:string;inode:string};
 permissions:readonly ("read"|"write"|"execute")[];
}
interface DirectoryCopyIntent {
 source:DirectoryCopyPinnedRef; destination:DirectoryCopyPinnedRef;
 expected_manifest_sha256:string; manifest:DirectoryManifest;
}
interface DirectoryCopyRecord {
 format:"gsa-directory-copy-record-v1"; copy_id:string; revision:number;
 intent:DirectoryCopyIntent;
 status:"PENDING"|"APPLIED"|"CONFLICT"|"UNKNOWN";
 acknowledged:readonly {path:string;kind:"directory"|"file"}[];
 pending_path:string|null; reason:string;
}
interface DirectoryCopyStoreApi {
 readonly rootDirectory:string;
 create(id:string,intent:DirectoryCopyIntent):Promise<{
   record:DirectoryCopyRecord;created:boolean}>;
 beginEntry(id:string,expectedRevision:number,path:string):Promise<DirectoryCopyRecord>;
 acknowledgeEntry(id:string,expectedRevision:number,path:string,
   kind:"directory"|"file"):Promise<DirectoryCopyRecord>;
 finish(id:string,expectedRevision:number,status:"APPLIED"|"CONFLICT"|"UNKNOWN",
   reason:string):Promise<DirectoryCopyRecord>;
 load(id:string):Promise<DirectoryCopyRecord>;
}
```

`src/local/directory-copy-store.ts` exports `class DirectoryCopyStore implements DirectoryCopyStoreApi` with `constructor(root:string)` and immutable `rootDirectory` exposing that normalized absolute protected root; coordinator accepts `DirectoryCopyStoreApi` so tests can inject store failures without a production fault API. `create` atomically publishes the unique ID under its protected lock: fresh record has revision 1, PENDING, empty acknowledgements, null pending path and reason `"INTENT_DURABLE"`, returning `created:true` only to that successful fresh creator. Existing identical intent returns current record and `created:false`; different intent rejects `DIRECTORY_COPY_INTENT_CONFLICT`. **Only the invocation receiving `created:true` may dispatch any namespace writes.** A duplicate projects existing PENDING as UNKNOWN in its response/readback without updating the active record or resuming it. This fresh-result rule, not independent per-entry locks, prevents concurrent same-ID copies. If fresh creation/acknowledgement is uncertain, no caller may infer freshness and continue.

The factory captures `store.rootDirectory` once and requires a normalized canonical absolute path. Before any store publication or namespace effect, check two-way lexical containment and physical device/inode ancestry separation against **every** current registry grant, including references and unrelated selected workspaces, using the existing `assertMacFileInstallationSeparated` pattern/helper. The protected store directory must already exist for this admission check; provisioning remains the trusted caller's responsibility and cannot create it inside a project first. The store independently verifies realpath, ownership/mode and protected ancestry on every operation. Injected fake stores must supply their own real private temporary root and undergo the same admission check; a structural interface supplies no trust bypass. Capture registry selection for admission, reject if it changes during the check, and recheck separation against the current full selection before each store publication/native write when scopes may have changed. This uses only root/ancestor metadata checks, never project enumeration or content reads. Missing, replaced, overlapping or unverifiable roots fail before effects (or stop UNKNOWN if earlier effects already occurred).

Each begin/ack/finish requires exact current `expectedRevision`, rejects stale revision with `DIRECTORY_COPY_REVISION_CONFLICT`, and increments by 1 only after durable publication. Terminal records are immutable: later begin/ack/finish reject `DIRECTORY_COPY_TERMINAL`; load never changes them. Begin/ack require PENDING. Derive the finite write schedule from intent: root directory `""` first, remaining directories sorted by depth then raw UTF-8 path bytes, then files sorted by raw UTF-8 path bytes. Acknowledgements must be a prefix of that schedule. Begin requires no pending entry and exactly the next scheduled path; ack requires matching pending path and manifest kind, appends that entry and clears pending. Finish APPLIED requires the complete acknowledged schedule and no pending entry; other terminal statuses preserve the acknowledged prefix and any pending path. Reasons are nonempty valid round-tripping UTF-8 <=256 bytes; other fields require exact keys and existing UUID/path/hash/pin/manifest bounds. Unknown ID rejects `DIRECTORY_COPY_NOT_FOUND`. Store errors carry a stable `code` string; structural/state failures use `INVALID_DIRECTORY_COPY`, oversize uses `DIRECTORY_COPY_RECORD_LIMIT`, stale lock uses `DIRECTORY_COPY_LOCKED`, and uncertain publication uses `RESULT_UNKNOWN`.

Intent pins are captured from actual registry grants, never trusted caller input: source requires read; destination role is workspace and permissions include read/write. Before every native write, coordinator matches both grants' canonical root, role, root identity, revision and permission set against pins and repeats durable/controller authorization; original namespace write checks still run in the base broker. Public outcome strips protected pin metadata and projects source/destination to `ScopedFileRef`. Record progress paths are relative to the copied root (`""` denotes its root); resolve each against the validated destination child path only.

- [ ] Tester writes RED tests: selected reference/workspace root `"."`→other-workspace child; nested sources; empty dirs; preexisting destination unchanged; hash mismatch no writes; unsafe descendant/overlap no writes; maximal serialized record over budget rejects before mkdir; revocation after root mkdir stops children; create timeout after actual effect yields UNKNOWN; no cleanup calls.
- [ ] Implement `DirectoryCopyStore` with the exact signatures/state rules above; every mutation is serialized per ID and fsynced before continuing. Private 0700 directory/0600 no-follow owner-only records, bounded <=1MiB, safe ancestry, atomic publication, record/root identity checks, and no stale-lock removal follow the existing store's safety pattern. Reject store/project overlap using existing installation separation pattern. No content bytes, credentials or arbitrary caller paths in records.
- [ ] `assertDirectoryCopyIntentBudget` validates intent and computes a conservative maximal serialized `DirectoryCopyRecord` envelope: full pins/manifest, all schedule acknowledgements, longest pending path, longest status, max-safe-integer revision and worst JSON-escaped <=256-byte reason (1,536 escaped bytes plus string quotes). Require <=1,048,576 UTF-8 bytes before publishing fresh intent and before first mkdir. Oversize is deterministic no-effect rejection; the manifest cap alone does not prove fit. Every later record also enforces <=1MiB; unexpected growth stops UNKNOWN before another write. Readback/destination observations belong to returned outcomes or bounded coordinator memory, not extra persisted record fields. No compact-index variant is needed for this slice.
- [ ] Store `PENDING` before effects; `beginEntry` durably records the next potentially effective syscall before dispatch. If this persistence fails, do not dispatch. `acknowledgeEntry` records successful acknowledgements, not proof the entry still exists. After lost acknowledgement/crash, PENDING is read as UNKNOWN with pending entry retained. If persistence fails after a native call, stop; return UNKNOWN using last durable state and observed current call without inventing a durable acknowledgement.
- [ ] Reject duplicate IDs with changed intent. Only `create(...).created===true` permits this invocation to write; false always returns existing outcome/readback (PENDING projected UNKNOWN), even with zero observed effects. Concurrent RED test holds the fresh invocation before mkdir, invokes the same ID again and proves only one mkdir/create schedule ever dispatches. Same ID with changed arguments rejects; existing/stale lock yields explicit uncertainty and no effects from the second caller. No automatic continuation.
- [ ] `copy` pins grants and validates source (`"."` or child path), destination (child path only) and hash; rejects lexical overlap using pinned canonical roots + relative paths in either direction (including destination inside selected source root across overlapping grants). Resolve source `"."` to its canonical root for this overlap comparison. Capture source fully, check manifest hash and maximal serialized-record budget before first mkdir. Recheck pinned grant identity/revision/role and durable/controller authorization before **each** destination mkdir/create; destination's base invoke retains its own checks. Make destination root exclusively first; existing root gives no-effect CONFLICT and no child calls. Create child dirs parent-first, then files in deterministic manifest order, using capture bytes only and existing `makeDirectory/createExclusive`. O_EXCL collisions preserve entries and stop further work; retain acknowledged progress and pending entry. No calls to copy-file, rename, trash or unlink.
- [ ] Read-only destination capture after all acknowledged creates must match portable content digest before APPLIED. Source capture observations are provenance, not destination identities. Retain any destination directory identities observed during progress and compare them in final inspection; an observed replacement or mismatch yields UNKNOWN/CONFLICT with explicit observations. Existing mkdir returns no created inode: a replacement before the first observation can evade detection, so never claim continuous destination identity or ownership. APPLIED means acknowledged exclusive creates and a final observed byte/structure match, not durable-fsync proof of every ancestor or immunity to later edits. Native existing mkdir has no namespace-fsync receipt; document that limit and use UNKNOWN after an interrupted run. A known collision/source conflict is CONFLICT; any ambiguous effect/transport/store/readback/identity outcome is UNKNOWN. Never equate CONFLICT with no mutation.
- [ ] `readCopy` returns immutable last-known progress and a separate `readback` object `{status:"MATCH"|"DIFFERENT"|"ABSENT"|"UNAVAILABLE",manifest_sha256:string|null,reason:string}` under current grants. It never changes UNKNOWN into APPLIED merely because equivalent bytes exist, overwrites a terminal receipt or performs writes. No recovery operation or retry is provided.
- [ ] Run the three focused test files after build, including restart from every begin/ack boundary, changed intent, stale lock, record substitution and fsync failure. Record exact outcomes.

## Task 3 — Isolated loader, truthful MCP routing

**Trace:** §§3/4 plugin API, §7 protected source activation, §8 structured outcome. **Owner:** Coder.

**Ownership/files:** Coder owns source only: create `src/hosts/macos-directory-installation.ts`, `src/hosts/macos-directory-evidence.ts`; minimally modify `src/mcp/catalog.ts`, `src/mcp/write-dispatch.ts`, `src/mcp/server.ts`, `src/mcp/runtime-bootstrap.ts` and `src/core/directory-copy.ts` only for public outcome validation. Tester owns `test/mac-directory-installation.test.ts`, `test/mac-directory-evidence.test.ts`, `test/mcp-directory-copy.test.ts` and affected capability/bootstrap tests. No `control-tools.ts` exists: the authoritative controlled set is `controlledToolNames` in `src/mcp/catalog.ts`, schema augmentation and token stripping are in `src/mcp/server.ts`. Preserve `src/hosts/macos-scoped-files.ts` and base broker/evidence unless a demonstrated dependency requires a separately reviewed minimal change.

Packaging correction: active `scripts/mac-desktop-install.mjs` `buildStage` copies compiled `dist/src`, seven fixed scripts and app resources; legacy `scripts/mac-package.mjs` copies compiled `dist/src/**/*.js`, two fixed scripts, Node and package.json. **Neither** carries native Swift sources. Coder may add exactly `native/macos-files/tree-broker.swift` to **both** builders' immutable source allowlists, exported as `runtimeNativeSources:readonly string[]` per builder and consumed by the respective existing stage/install file list; preserve all other entries, existing manifest formats and base evidence. Package it as source bytes only, private 0600 and SHA-256-bound in each runtime manifest. Do not add base `broker.swift`, compile Swift, include a candidate native binary/app/evidence, install or activate anything. Tester owns pure synthetic fixture tests for both builders (existing `scripts/test-mac-package.mjs` plus `test/mac-desktop-adapter.test.mjs` or a focused pure `test/mac-directory-package.test.mjs` if stage seam needs isolation): verify exact new allowlist entry, source presence/hash, changed/missing source rejection and no new native executable. Run `node --test scripts/test-mac-package.mjs` and the affected pure desktop/package test; never invoke actual buildStage/native build/install/upgrade. To preserve old runtime verification, require the source entry when a manifest contains new `dist/src/hosts/macos-directory-installation.js`; do not reject old runtimes solely for lacking the new loader/source. Source content must be manifest-bound through each builder's existing artifact path, not copied after manifest creation.

Runtime source pin resolves **only** `fileURLToPath(new URL("../../../native/macos-files/tree-broker.swift",import.meta.url))` from compiled `dist/src/hosts/macos-directory-installation.js`, which reaches `<runtime-root>/native/macos-files/tree-broker.swift`. Use protected bounded source read and SHA-256 equality with build.source_sha256; no cwd-relative, repository, parent-binding or environment fallback. Tests construct this exact compiled-layout fixture; source absence blocks tree extension alone. This packages the source needed to check a separately installed candidate binary; it does not bless that binary.

After Tester RED, a permitted parallel source split is disjoint: **Coder A** owns new directory evidence + installation modules and tiny source allowlist entries in both `scripts/mac-package.mjs` and `scripts/mac-desktop-install.mjs`; **Coder B** owns core public outcome validator, catalog, write-dispatch, server and runtime-bootstrap explicit bound facade. Tester owns all test files, including package tests. Neither Coder edits the other's files; both preserve concurrent work. This split is an execution option for the primary at the existing trigger, not an additional dispatch or milestone created by this plan.

### Task 3 exact source interfaces and installation layout

Export `DirectoryInstallationIO` and `loadCheckedMacDirectoryInstallation` from `src/hosts/macos-directory-installation.ts`:

```ts
interface DirectoryInstallationIO {
 readonly protectedRead:(file:string,max:number)=>Promise<Buffer>;
 readonly protectedDirectory:(directory:string)=>Promise<void>;
 readonly command:(executable:string,args:string[],input:string,max:number,
   ownerLockFD?:3)=>Promise<Buffer>;
}
function loadCheckedMacDirectoryInstallation(
 registry:WorkspaceRegistry, installationRoot:string, base:NativeScopedFiles,
 options:{ownerLockFD:3;authorize:(workspaceId:string,
   permission:WorkspacePermission)=>Promise<void>},
 io?:DirectoryInstallationIO
):Promise<NativeDirectoryCopies>;
function macDirectoryCopyActivation():Readonly<{
 available:false;reason:"Exact tree-reader native proof and installation review pending"
}>;
```

IO is a narrow explicit transport seam for protected-file/signature-command tests, not an activation API; no option for evidence bypass, candidate mode, host override or caller `verified/accepted` flag. Omitted IO uses private real protected-file/command implementations in the new installation module, following existing base conventions without exporting/refactoring its private helpers; bootstrap passes only options. Platform must be Darwin and FD 3 present; tree commands inherit FD 3, sanitized fixed environment, bounded I/O and 15-second timeout. Task 3 `macDirectoryCopyActivation()` is unconditionally false; **even a structurally valid fixture proof cannot return a production extension**. Loader validates installation/evidence and then fails `SECURITY_BLOCKED` with the activation reason before construction; this lets tests exercise validation without forging acceptance. Task 4 must make a reviewed exact-artifact activation/installation source change after actual evidence, not supply a JSON boolean. Do not create an otherwise unused second reader framework: the loader's private reader calls the single `capture_tree` wire protocol, validates its bound envelope and delegates to the existing Task 1 capture validator, then would compose Task 2's coordinator/store only after that activation boundary.

`installationRoot` is the separate canonical private `path.join(identityRoot,"directory-copy")`, with existing protected `copy-records/`, `proof-key` (32 bytes), `install.json` and `<grant-id>/TreeReader.app`. Parent/grants must be physically separated in both directions; every selected grant requires exactly one tree binding. The trusted installer in Task 4 provisions it; runtime loader never creates project/install directories or changes live installation. `install.json` is <=65,536 UTF-8 bytes and exactly `{body:string,hmac:string}`; HMAC-SHA256 over literal body uses this separate key. Body is exactly:

```ts
interface DirectoryInstallationProof {
 format:"gsa-directory-copy-installation-v1";
 hostRelease:string; arch:"arm64";
 build:DirectoryTreeBuild; grants:readonly DirectoryTreeBinding[];
 evidence_file:"native-evidence.json"; evidence_sha256:string;
}
interface DirectoryTreeBinding {
 id:string; root:string; rootIdentity:{device:string;inode:string};
 revision:number; role:"workspace"|"reference";
 artifacts:{"Contents/MacOS/tree-broker":string;"Contents/Info.plist":string;
   "Contents/_CodeSignature/CodeResources":string};
 presign_sha256:string; code_sha256:string;
}
```

All hashes are lowercase SHA-256; unknown/missing fields reject. `DirectoryTreeBuild` copies the exact `requireMacFileBuild` field names and bounded values (uuid, driver, sdk.path/version/settings_sha256, source_sha256, compiler_sha256, code_sha256, release_sha256, compiler_version, arguments, signing_profile, hostRelease, arch), but requires signing profile `gsa-directory-tree-readonly-single-root-v1`; no changes to the base validator/profile. Build source hash must equal the packaged `native/macos-files/tree-broker.swift` source hash, host/arch match actual runtime, arguments remain `['-O','-Xlinker','-reproducible']`; artifact/code hash checks use existing stripped-code normalization. Every bundle is private, no-follow, owner-checked and strict-codesign-verified before every command. Info.plist must pin `CFBundleExecutable:"tree-broker"`, `GSAWorkspaceID`, `GSAWorkspaceRole`, `GSAWorkspaceRoot`, `GSARevision`, `GSADevice`, `GSAInode`. Permit only App Sandbox true plus `com.apple.security.temporary-exception.files.absolute-path.read-only:[root+"/"]`, for both roles. No write, network, recovery-root or multiple-root entitlement. Validate grants/physical roots/current durable authorization both before command and after capture; never trust wire binding alone.

Export pure `requireMacDirectoryBuild(value:unknown):void` and `requireMacDirectoryEvidence(value:unknown,build:DirectoryTreeBuild):void` from `src/hosts/macos-directory-evidence.ts`, with the metadata types there. Evidence is **data validation, not independent attestation**. `native-evidence.json` is <=1,048,576 bytes, hash-bound by install proof, and exactly `{format:"gsa-directory-tree-native-evidence-v1",build,fixture,observations,unresolved}`. `build` exactly equals install build; `unresolved` must be an empty array for eligibility. Fixture is exactly `{stage,stageIdentity,hostRelease,arch,owner_fd:3,roots:[DirectoryTreeBinding],outsideCanaries:[{path,before_sha256,after_sha256}]}`: canonical private disposable stage, exactly one workspace and one reference root, outside canaries outside both roots and unchanged. These fixture roots are proof fixtures, not production grants; their code/presign/build identity must match the production tree code.

`observations` is exactly `{workspaceCapture,referenceCapture,unsafeSymlink,unsafeHardlink,unsafeSpecial,overLimit,staleBinding,ungrantedPath,invalidWriteRequest,relocation}`. First nine members are exactly `{request,response}` holding the raw bounded JSON request and native response; requests match the fixture binding and only fixed capture fields, except `invalidWriteRequest` has operation `"create"` to prove protocol rejection. Positive capture responses use the Task 1 exact success envelope, capture validator and root identity match; require source path `"."`, a nested regular file and empty directory among positive fixture entries. Negative responses are `ok:false` with precise native codes (`UNSAFE_FILE_TYPE`, budget-specific `*_LIMIT_EXCEEDED`, `GRANT_BINDING_MISMATCH`, `PATH_OUTSIDE_SCOPE`/`PATH_OR_ACCESS_DENIED`, or `INVALID_REQUEST`/`INVALID_OPERATION` as appropriate); no success or payload is permitted. The evidence validator checks raw protocol/response relations and all bounds, not a list of claimed PASS names. `invalidWriteRequest` proves the fixed protocol rejects writes; readonly entitlements establish the signed authority shape, not a fabricated native write-syscall test.

Relocation is exactly `{request,pid,fd,parentIdentity,relocatedIdentity,parentPath,relocatedPath,stopConfirmation,timeline,response,outside_content_returned}`. Request is real `capture_tree` against a fixture child directory; pid/fd identify that exact release artifact and opened directory. Stop confirmation is `{pid,signal:"SIGSTOP",state,fd,parentIdentity}` with stopped state beginning `T`. Timeline is strictly increasing finite timestamps for `{stopConfirmed,parentRelocated,resumed,responseObserved}`. Paths prove parent moved outside both fixture roots, identities match the retained directory, response is a native denied/conflict envelope with no capture bytes, and `outside_content_returned:false` is checked against that raw response rather than trusted alone. Independent report must verify actual release code/process/FD observation and moved canaries. A fabricated document can satisfy structural checks: only independently reviewed actual Task 4 evidence can justify changing the source activation block.

### Task 3 MCP composition, controls and exact results

Task3 testable composition details: both package builders export `directorySourceFiles():readonly string[]`, returning only `native/macos-files/tree-broker.swift`, and consume that inventory in their real copy loops. Pure tests exercise both inventories plus synthetic manifest/tamper behavior without invoking install/buildStage. In runtime-bootstrap export `withMacDirectoryCopies(base:NativeScopedFiles,directoryCopies:NativeDirectoryCopies):NativeScopedFiles` as a pure bound facade used after successful checked loading; it does not construct a native reader or bypass proof. For deterministic composition tests, an optional sixth `fileLoaders?:{base:typeof loadMacScopedFiles;directory:typeof loadCheckedMacDirectoryInstallation}` argument may inject existing typed loaders; actual production callers omit it and use checked defaults. This seam is not a public tool/config/environment switch or native attestation. Tests must label injected loaders as fake composition evidence.

- Add **all three** new tool names to `controlledToolNames`; native authorization requires current control even for inspect, so schema must say so. Existing `toolDefinitions()` adds required `control_token` and the outer wrapper strips it before strict argument validation. Each new handler also requires a non-null control store plus `requireProtectedState()`, preventing null-control test composition from silently enabling directory tools.
- Catalog exact schemas use required nonempty strings, UUID pattern for `copy_id`, lowercase 64-hex pattern for expected manifest hash, maxLength 4096 for paths, `additionalProperties:false`: inspect keys `workspace_id,path`; copy keys `copy_id,source_workspace_id,source_path,destination_workspace_id,destination_path,expected_manifest_sha256`; get keys `copy_id`. Validate actual UTF-8 byte/path rules in dispatch, not JSON Schema character length alone; source `"."` is allowed and destination `"."` is denied.
- `dispatchFileMutation` handles only `copy_directory` among these three; requires extension, source read and workspace destination write, then calls existing extension `copy`. Server handles inspect/get through extension `inspect`/`readCopy`; coordinator remains authority for bound-record readback grants. Never call Node list/read or cast outcomes to regular-file transactions.
- Add `validateDirectoryCopyOutcome(value:unknown):DirectoryCopyOutcome` to the pure core module: exact public fields from the established type, bounded UUID/hash/source/destination/ack/pending/reason/readback, statuses only APPLIED/CONFLICT/UNKNOWN, committed false, detached immutable clone. Server uses it for copy/get results before serialization. APPLIED returns `{ok:true,result:outcome}`; CONFLICT returns `isError:true` and `{ok:false,code:"DIRECTORY_COPY_CONFLICT",result:outcome}`; UNKNOWN returns `isError:true` and `{ok:false,code:"RESULT_UNKNOWN",result:outcome}`. Inspect success returns manifest only; no payload bytes/pins/proof paths. Thrown validation/auth/missing-proof errors retain existing structured error-code packaging without inventing progress.
- Capability source: `copy_directory` enters `allFileOperations` but is enabled only when `directoryCopies` exists **and** supportedOperations explicitly includes it; legacy omission cannot enable it. `directoryCopyAvailable`, `directoryInspectAvailable`, `directoryCopyReadbackAvailable` require extension, protected state and controller store; add `directoryCopyBlockedReason:string|null`. `list_capabilities.read` adds inspect/get only when available, `files` adds copy only when available, and all three stay in `blocked` otherwise. Existing full-write calculation includes unavailable operations and must remain truthful; directory attachment does not enable shell/Git/recovery or batch support for directory copies.
- `runtime-bootstrap.ts` `reloadFiles` remains the composition point: load accepted base first, then separately try tree loader with identityRoot/directory-copy, existing owner FD/authorize and narrow protected IO. Tree failure sets only a separate directory blocked reason; retain the same working base. Extend `fileBackendState`/status packaging to carry that separate reason and clear/reload it on bind/unbind. Successful future attachment constructs an explicit `NativeScopedFiles` facade with base methods bound to their receiver (including every required method and recoverable extension), copied capability subset plus copy_directory, and new directory extension. Never `{...base}` or prototype copying: class methods/private `this` must survive. No public production loader bypass is introduced for tests; unit/MCP tests can inject the already-public NativeDirectoryCopies interface.

Task 4 raw-helper collection does not need to weaken this loader: its separately scoped fixture script invokes the exact staged signed `TreeReader.app` binary directly with bound JSON and captures raw responses/process/FD observations, using disposable roots only. It can assemble evidence for independent review while production loader remains blocked. Producing/HMAC-wrapping a candidate evidence file never activates it. A concrete install/apply script and reviewed activation are later Task 4 scope, not Task 3 automation.

- [ ] Write RED tests for strict tool schemas/controller checks, ref source allowed/ref destination denied, absent/bad tree proof blocks only new tools, old base subset survives, inspect returns no payload bytes, UNKNOWN/CONFLICT structured progress survives MCP `isError` packaging, and duplicate IDs never reach native mutation.
- [ ] Implement `loadCheckedMacDirectoryInstallation(...)` using a separate `directory-copy/install.json` envelope and per-root `TreeReader.app`. Validate host/arch/source/build/code/artifact/signature/entitlement/root/role/revision bindings, protected ancestry/owner/size, physical separation from all grants, owner FD and callback requirements. Tree bundle has only read-only authority for its own root; no recovery root or destination union. Validate exact tree evidence format/observations; no fixture-name lists or caller booleans as proof. Reuse existing protected-check utilities through narrow dependency injection; no broad refactor of accepted base loading.
- [ ] Add optional attachment after successful base loading. Absent/invalid new installation returns no extension with a specific blocked reason and leaves base operational. At source handoff, new production activation stays explicitly blocked pending Task 4; tests may inject a reader/extension without claiming native acceptance. Do not add an env bypass/exported candidate constructor.
- [ ] Add the three catalog entries and routing; copy is controlled and appears in supported mutations only with verified extension. Inspect/readback availability is separately truthful; the full-write summary remains false while unrelated operations are blocked. Extend MCP error handling for copy IDs/status without casting directory outcomes into `FileTransactionOutcome`.
- [ ] Run build and focused directory/MCP tests, plus directly affected base capability/loading tests. Preserve old copy-file/recovery/history evidence; do not repeat unrelated VM tests.

## Task 4 — Exact artifact proof and bounded review handoff

**Trace:** §§7/8 activation evidence. **Owners:** Tester for execution/evidence, Reviewer for classification; Coder only for scoped repairs. This plan authorizes source/test construction; native fixture execution/installation must use the primary agent's explicitly assigned scope. Planner executes none.

**Files:** Tester owns `native/macos-files/test-tree-broker.py`, `scripts/test-mac-directory-copy-native.mjs` and a dated evidence report under `docs/reviews/`. No live identity, original media or existing one-shot record changes.

- [ ] Build one release tree-reader candidate on Mac ARM64 using existing reproducible Swift build/code hashing conventions; collect exact compiler/SDK/args/source/code/signing/host identities. Use a single finite disposable stage with source workspace, reference, destination workspace and outside canaries; candidate bundle/plist/entitlements/protected-store fixtures stay inside owned temporary stage. No installed owner replacement or live-plugin request is implied.
- [ ] Run real descriptor traversal fixtures: stable nested/empty copy; limits at/+1; Unicode and invalid UTF-8 name; symlink/hardlink/FIFO denial; mount/device boundary when available (otherwise UNVERIFIED); source changes; directory replacement before open and during enumeration; grant/revision/controller change between writes; collision/recreated dest; helper kill after create-before-ack; restart/readback no replay. Verify exact output bytes/dirs, unchanged source and unchanged outside canaries. Missing platform fixture remains UNVERIFIED and prevents claims for that boundary.
- [ ] Prove read confinement for the exact new signed artifact: ungranted file/ancestor traversal denied; reference and workspace tree helpers cannot write; retained source directory/ancestor relocation outside root between descriptor open and file read must not leak outside bytes. Include deterministic test-only pause instrumentation only in a distinct test build; release-artifact proof must observe the actual release or use the existing independently observed release-process method. Test-only PASS is not release proof. If release relocation is unresolved, leave production extension blocked and report it; do not reset one-shot probe records or infer success from App Sandbox alone.
- [ ] Reviewer examines native/helper + loader changes when ready, then final source integration with focused tests and native report. A BLOCKING finding cites violated §3/4/7/8 and reproduction; unrelated scope is OUT_OF_SCOPE, missing evidence UNVERIFIED. Follow current AGENTS.md §11: maximum five review/repair rounds per pair or30minutes of active work, whichever comes first; if unfinished preserve checkpoint, ask continuation and wait for explicit reply. Explicit user extensions may grant another window/round allowance; never silently reset. Critic only if existing configured larger trigger requires it; no new trigger/milestone is introduced.
- [ ] Primary reports source readiness separately from exact-native proof, installation/live-plugin acceptance and full Mac criteria. Production activation requires reviewed exact proof and a concrete reviewed installation step; do not forge proof, auto-install, sign harness user gates, stage unrelated files or push. Run existing harness verification appropriate to changed files and report every failure, including pre-existing failures. No manual task/gate checkbox completion.

## Planning evidence and self-review

Planner read current base broker, native I/O, scoped adapter, catalog/write-dispatch, server capability routing, bootstrap authorization and protected transaction-store patterns. SDK declarations confirm `fdopendir`, `readdir`, `fstatat`; Swift build/native behavior remains unverified. Gate reports M1/P01 AWAITING_USER with unavailable trusted approval adapter; planning does not edit that state. Preflight reports existing dirty `codex/mac-completion`, MANUAL_ONLY and no remote fetch. This plan preserves it.

Coverage: Task 1 owns all bounded source validation and source-change tests; Task 2 owns all five Review Focus failure classes including persistence; Task 3 owns plugin exposure/authority and preserving base availability; Task 4 owns changed-native proof and honest acceptance limits. This revision serves the original directory-copy requirement and avoids invalidating previously accepted base operations. No implementation/tests/native run occurred in planning.
