# M1/P01 — Mac host boundary and mutation design

Current scope correction,2026-10-18: the VM/guest investigation in this document is preserved historical research, outside active personal-use delivery. Focus on existing local file/Git/process tools and project scripts on the actual host; cross-OS testing belongs to a project's GitHub CI when needed. Do not continue guest provisioning or isolation-lab expansion by default. Unproven capabilities remain unproven; the workspace/reference contract is unchanged.

Status: **design/research proposal, 2026-10-18**. No product implementation, native experiment, installation or capability enablement is performed by this document. Mac only; Windows starts after complete accepted M5. Authority: [criteria](../CRITERIA.md), [master plan](GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md). This makes concrete design decisions without claiming complete M1.

## Evidence reused and separate verdicts

Reuse [the 13-case characterization](../reviews/2026-10-18-MAC-BROKER-CHARACTERIZATION.md); do not rerun valid tests. It establishes the recorded signed single-root fixed-operation subset on macOS 26.6.2/arm64, including actual denial responses and cleanup.

| Recorded artifact | SHA-256 |
| --- | --- |
| Broker source | `6487ab6ad0447a4e63a9a727ca08ed2276ea5e150445c3f497650266745edb45` |
| Instrumented fixture | `96159f0e05e878ffe882b5302ffe1fbb26f81dd35eeefa6a5c219d6b48ce4a0e` |
| Signed disposable binary | `a460a7e56047201ad388ad7a9e4abb7a50b502d3da7e85b0b16f395131aa9276` |
| Entitlements | `87404d1b80307cba6753909e01c3f2d728a5748def90c2d59512a16c14dfe1cc` |

The removed disposable binary cannot become an installed backend by reusing its hash. The linked report supplies compiler/front-end identity, CDHash, root/device/inode and failure history.

| Component | Current verdict |
| --- | --- |
| Single-root file read/create/mkdir/copy | NARROW OBSERVED SUBSET; no new runtime claim. |
| Working/reference and cross-root broker | DESIGN CANDIDATE; current adapter forbids cross-root destination and requires source write for copy. |
| Replace/move/Trash preserving external edits | BLOCKED; current compare mutations always fail closed. Retention proposal below is not content CAS. |
| App Sandbox general host supervisor | REJECTED AS THE FULL BOUNDARY: public baseline authority does not establish denial of ungranted world-readable data. Keep fixed-operation broker only. |
| macOS guest with explicit directory shares | FALLBACK RESEARCH OPTION; prioritize existing host/toolchain/components. Guest resources and share confinement remain unverified; no guest is required for the next host assessment. |
| Native macOS SDK/reference-script enforcement | UNVERIFIED; no runnable production backend or acceptance proof. |

## Source anchors and interface gaps

`src/core/workspace.ts::WorkspaceRegistry` pins id/canonicalRoot/device/inode/revision with permission arrays; it lacks explicit working/reference roles and atomic multi-root transactions. `src/local/grants.ts` persists legacy enrollment. `src/mcp/write-dispatch.ts::dispatchFileMutation` distinguishes read-source/write-destination, but `src/hosts/macos-scoped-files.ts::loadMacScopedFiles`/`invoke` requires source write for copy and rejects differing destination workspace IDs. `native/macos-files/broker.swift::run` handles one Info.plist-pinned root and rejects correct-hash replace/move/trash with `SECURITY_BLOCKED_ATOMIC_COMPARE_UNAVAILABLE`. Production `bootstrapMcpTools` supplies no file backend.

`NativeScopedFiles` mutation methods return `Promise<void>`; `MutationReceipt` has before/after hashes, `committed:false` and `file_mutated`, without transaction identity, partial effects or retained recovery handles. `write-engine.ts` synthesizes success after void calls. A recovery-capable design needs an explicit result/error contract before implementation; neither success nor a generic exception may hide partial namespace changes.

## Multi-root fixed-operation broker: selected direction

Use a trusted coordinator with short-lived fixed-operation helpers. No arbitrary script or shell execution in the broker. Each request pins the authenticated host/controller, operation, participating root identities/revisions and relative paths. Project content cannot enroll roots or change roles.

| Operation | Source authority | Destination authority |
| --- | --- | --- |
| read/search | working or reference, read | none |
| create/replace/Trash | working, write where applicable | working, write |
| copy | working or reference, read | working, write |
| move | working, read/write | working, write |

Reference→working and working A→B copy must work without extra approval; move never consumes a reference. A helper receives only participating roots, not every project. Keep independent/concurrent projects and per-request cwd. Lock connector transactions in sorted host/root-ID order; this prevents connector races, not edits by unrelated applications. D1 incompatible-role overlap remains proposed atomic rejection pending contract review; no silent role promotion or inferred parents.

Use no-follow root/parent descriptors, reject unsafe links/types, and revalidate root identity/revision at I/O boundaries. Path exceptions and descriptor-relative operations solve different problems: root/ancestor relocation can occur after validation. Existing single relocation denial is not proof of all multi-root/revocation races. No new workspace permission tier is introduced.

## Mutation decision: retain displaced entries, never promise content CAS

Apple documents same-volume replacement with an optional retained backup. This helps retention but does not document expected-content comparison or exclude arbitrary writers. Use unique backup names because existing backup names can be removed. [Apple FileManager replacement](https://developer.apple.com/documentation/foundation/filemanager/replaceitemat(_:withitemat:backupitemname:options:)).

File coordination notifies registered file presenters; infer no mandatory lock over arbitrary writers or already-open writable descriptors. [Apple NSFileCoordinator](https://developer.apple.com/documentation/foundation/nsfilecoordinator).

The local public SDK `MacOSX.sdk/usr/include/sys/stdio.h` declares `renameatx_np`, RENAME_EXCL and RENAME_SWAP. It also defines RENAME_NOFOLLOW_ANY/RENAME_RESOLVE_BENEATH, but header presence is not runtime availability or safe semantics on the tested host. Apple exposes volume support for swap-renaming; neither APFS branding nor a header certifies a transaction. [Apple volumeSupportsSwapRenaming](https://developer.apple.com/documentation/foundation/urlresourcevalues/volumesupportsswaprenaming).

Investigate **capture the current entry and retain it; publish only into an absent name**. It prefers explicit conflict/UNKNOWN to overwriting an intervening external entry. It does not yet satisfy production replace semantics.

1. Validate expected hash on a stable bounded read and pin file/root identities. Reserve transaction ID, durable intent and fresh same-volume recovery/staging locations before namespace changes. Recovery must be connector-owned and inaccessible to project commands. A hidden nonce folder inside a fully writable workspace is not protected storage. On an external volume there may be no approved protected location on that same volume; never infer parent access or provision one silently. Without this prerequisite, mutation stays blocked.
2. Exclusively rename the source entry into reserved recovery storage, without replacing any existing entry. This captures the inode occupying the path at that instant, potentially changed since validation. Revalidate/hash it. Preserve its descriptor and directory entry; an external writer may still write that inode. Do not change its permissions, unlink it or call a one-time copy a final immutable record of later writes.
3. On mismatch, report conflict. Restore only by exclusive rename into an absent original name after identity checks. If another app recreated that name, preserve both entries and report recovery handle/actual effects. Never overwrite the recreated entry as rollback.
4. On a matching capture, stage complete new bytes on the destination volume and publish with exclusive/no-replace semantics. If a concurrent editor recreated the target, preserve staged/captured/user entries and report conflict/UNKNOWN. On publish success retain captured entry and record new identity/hash. Keep displaced inode available for continued open-FD writes; no automatic garbage collection until retention/recovery policy is designed and proven.
5. Crash/lost acknowledgement/durability failure or unverified post-publication state yields UNKNOWN or a verified partial-state receipt. Reconcile names/identities/hashes before any retry. A completed namespace operation does not prove power-loss durability. Never automatically repeat mutation or restore over user content.

Capture may temporarily remove the original pathname and preserve bytes elsewhere. That is a side effect even if publication fails. Its acceptability/recovery presentation needs review against criteria §4; if zero namespace change on any content conflict is required, this proposal is insufficient. It cannot implement strict content CAS against arbitrary external writes or prevent another application destroying its own bytes. Keep production replace/move/Trash blocked until the chosen contract is proven.

Proposed outcome contract, not an existing API: APPLIED / CONFLICT / UNKNOWN, transaction ID, verified affected identities/hashes, actual partial effects and scoped retained-version handles. After capture, reporting `file_mutated:false` is false. Recovery handles must not expose arbitrary private paths or grant project scripts journal access. Exact Swift/TypeScript changes require a later implementation plan.

“Stable bounded read” above is a required property, not an available atomic snapshot primitive. Repeated metadata checks or matching hashes cannot prove a coherent source snapshot against arbitrary concurrent writers. Copy therefore needs independently verified source-snapshot semantics before reporting APPLIED/coherent content. Without them, report CONFLICT/UNKNOWN as justified by actual effects or keep the operation blocked; do not turn a best-effort byte read into a snapshot claim. Reference-source copy must confer no source-write authority. Partial failed output may be removed only after proving ownership/identity, otherwise report it.

Same-volume move also remains blocked: no retained-source mechanism is selected. Renaming a captured recovery entry to the destination consumes that recovery name; copying bytes instead creates different inode/open-FD semantics. Generic capture/publish does not establish retained late writes for move. Select and verify the precise retention, late-open-FD-write and outcome/recovery contract before any move implementation. Cross-volume move is unsupported in this first design and must fail before mutation, not silently copy+delete. Cross-volume copy needs separate source-snapshot/hash/partial-output design. A private recovery folder is not macOS Trash; Trash remains a separate native requirement.

## Host runtime decision from public Apple APIs

Foundation `Process` supports launching/configuring subprocesses, and Apple documents child sandbox inheritance. A bundled inherit helper has specific entitlement restrictions; this does not justify re-signing system tools or assuming dynamic permissions reach every descendant. [Apple Process](https://developer.apple.com/documentation/foundation/process), [Apple inheritance reference](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html).

Absolute-path exception entitlements add access to a default sandbox baseline, which Apple’s reference includes POSIX world-readable locations. Therefore listing only working W does not establish that world-readable U/R is unreadable. **Reject App Sandbox alone as the required general-command boundary.** Existing broker request validation is a different, fixed-operation boundary. Do not rerun/widen the known restricted-read Seatbelt SIGABRT policy. [Apple temporary exceptions](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/AppSandboxTemporaryExceptionEntitlements.html).

Security-scoped bookmarks have public lifetime/access APIs; a plugin-provided path is not a system-mediated user-selected grant. Bookmarks do not subtract default readable authority or distinguish reading bytes from interpreting them. Do not replace the ungated absolute-path product flow with mandatory per-folder Open panels. [Apple sandbox file access](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox).

Endpoint interception or another OS account is not selected: no approved privilege/entitlement provisioning or proven read boundary exists here. No private/custom sandbox API is presumed. The existing Linux guest remains portable-only evidence, never native macOS SDK proof.

## Fallback macOS guest: explicit resource choice

Latest user priority is to use existing resources first. Continue assessment of the actual Mac, installed toolchain and project components. The guest design below is a fallback after a demonstrated host limitation, not the default next step. Existing direct-host tests remain valid; neither their results nor this priority establishes arbitrary-command confinement.

Apple documents macOS guests on Apple silicon using VZMacPlatformConfiguration and compatible restore-image hardware requirements. Installation needs a restore image, guest storage/auxiliary state and compatible configuration; an existing local image can be used. No macOS image or guest SDK installation is assumed present or approved. [Apple macOS virtualization](https://developer.apple.com/documentation/virtualization/virtualize-macos-on-a-mac), [Apple macOS installation](https://developer.apple.com/documentation/virtualization/installing-macos-on-a-virtual-machine).

VZVirtioFileSystemDeviceConfiguration exposes named directories; VZSharedDirectory has a readOnly setting. Apple documents macOS guest automounting on supported versions and runtime share updates. These APIs do not promise pinned host-root identity, safe symlink/ancestor traversal or immediate revocation of existing handles. [Apple filesystem-sharing configuration](https://developer.apple.com/documentation/virtualization/vzvirtiofilesystemdeviceconfiguration), [Apple shared directories](https://developer.apple.com/documentation/virtualization/shared-directories).

**Resource choice required only if this fallback experiment is pursued:** provide an approved local compatible macOS restore image/prepared disposable guest and guest-installed toolchain, or explicitly approve separately scoped acquisition/install/storage work. Record image/source/version/hash, hardware requirements, available disk/RAM, install interaction and toolchain provenance. No download, installation, disk creation, account/config change or existing-media mutation is authorized here. Without approved resources this guest experiment is BLOCKED_PENDING_RESOURCES; that does not block assessment of existing host resources.

The proposed guest is a tool executor, not a local reasoning agent/project Job system. Each execution instance has a disposable private OS/work disk and selected explicit host shares, no host home/credentials/identity/journal/evidence/device passthrough or network device. Guest OS/runtime resources are declared execution resources, not additional host-project grants. A valid macOS SDK build in that guest is a macOS workload, but still not execution by the host’s exact installed SDK/application environment; results must identify the distinction. Host-only GUI/device-dependent tools remain unsupported until separately proven.

| Resource | Proposed access / proof obligation |
| --- | --- |
| Working A, optionally B | Share only exact roots selected for that run, read/write. An A-only instance cannot read B. Ordinary commands must change actual shared host projects, not a silent disposable source copy. |
| Reference R | Trusted host broker reads/searches/copies R→A; no direct R guest share or host descriptor. User confirmed this capability split is sufficient on2026-10-18. Before/after hashes compare observed bytes only; they cannot prove absence of transient mutation or attribute changes when external writers exist. Separately prove that broker operations confer no R-write authority. |
| Ungranted U / synthetic credentials / protected evidence | Never share; world-readable host canary still must be unreachable through guest, symlinks, aliases and descendants. |
| Guest toolchain/runtime/cache | Installed guest SDK/toolchain version pinned; private disposable caches/temp. No inherited host environment, keychain, agent socket or bookmark. |
| Network / clipboard / extra devices | No network or clipboard integration; only explicitly required boot/console and filesystem devices. No broad host mount. |
| Recovery and artifact evidence | Protected host coordinator state never shared. Output transfer validates paths/type/quota/hash/run identity/clean stop. Shared-project edits remain real edits with concurrent-host conflicts. |

Shared-directory APIs alone cannot provide descriptor-pinned host root semantics. If a root moves/replaces while shared, a host-side stat poll is insufficient. Future proof must show no access to replacement/relocated outside content, or choose a mediation mechanism; removing a share or stopping a guest is not assumed to revoke already-open I/O instantly. On uncertain revocation stop the owned instance, report UNKNOWN and block retry until readback; never touch neighboring processes. No guest-share capability is enabled from the old zero-share Linux proof.

CI may deliberately run an immutable source snapshot plus writable build copy and export outputs, with explicit source/environment/provenance and conflict-safe import. That does not fulfill ordinary command edits on actual W. A guest-copy-only fallback cannot claim the working-project requirement is met.

## Reference execution: resolved intent and capability split

D2 permits copying reference material to working W and using/executing that copy; direct R script/import/build is prohibited. User confirmed on2026-10-18 that connector-mediated reference read/search/copy is sufficient; commands do not need direct R access. Select broker-only R access plus working-scope command inputs: do not share R with the proposed guest. Copied bytes are regular W inputs. No noexec or arbitrary content-provenance claim is made.

Under this clarified contract, broker read/search/copy provides reference use; command/child denials still need proof, including symlink, import and indirect-share bypasses. A read-only guest share alone would permit reading scripts and is not a substitute. This resolves the capability question, not the implementation or native confinement proof. Criteria remain unchanged.

## Retained-capture experiment status and historical contract

**Current status:** the separately reviewed `native/macos-files/test-retained-capture.py` fixture was implemented and run once, producing12 research observations; see the [characterization and its limits](../reviews/2026-10-18-RETAINED-CAPTURE-CHARACTERIZATION.md). Its adverse coherent-copy and ancestor-relocation observations leave production mutations/confinement unproven. Do not rerun valid evidence from this status update. The next decision is the [resource proposal](M1-MAC-BOUNDARY-DECISION.md), with the user-confirmed broker-only reference split and guest-resource choice still unprovided.

The following fixture description and case table preserve the **historical reviewed experiment contract**, not pending implementation or a rerun recommendation. The fixture compiled a disposable public renameatx_np/RENAME_EXCL helper and orchestrated deterministic second-writer pause points; no production broker edits were part of it. Actual observations and any unverified limits are reported in the characterization rather than inferred from these planned oracles.

Use a private mode0700 TemporaryDirectory on the existing host APFS temporary volume: A/input, staged-new, recovery, unrelated-control and one second-writer process. Its recovery directory models only filesystem behavior; it is **not** production-protected storage if a full-RW project process can reach it. No new mount/volume/account/dependency. Record actual filesystem support, helper/source/SDK hashes and every inode/hash/namespace effect. Limit children to 10s, experiment to 60s, output to 1MiB and case data to 1MiB. Unsupported semantics fail honestly; no disk formatting or permission expansion.

| Future case | Required observation |
| --- | --- |
| Stable expected bytes | Old entry retained; exclusive publish shows new bytes; both identities and namespace effects recorded. |
| Rename/edit before capture | Mismatch retained/reported; no external entry overwritten by restoration. |
| Open-FD write after capture | Retained inode receives later writer bytes; no false immutable-backup or early deletion. |
| Writer during source copy/hash | Deterministic pauses permit writes between chunks and validation steps; metadata/repeated hashes must not manufacture a coherent-snapshot/APPLIED verdict. Without independently verified source-snapshot semantics, keep blocked or report actual CONFLICT/UNKNOWN effects. |
| Recreate before publish/restore | Exclusive operation refuses existing name; preserve both user entries, report conflict/UNKNOWN/recovery handle. |
| Crash after capture / after publish | Readback distinguishes states, no automatic replay or overwrite rollback. |
| Root/ancestor replacement | Fail/UNKNOWN without deleting replacement-owned entries or claiming unchanged scope. |
| Resource/cleanup failure | Retain/report exact owned paths and hashes; do not claim no side effect. |

Capture evidence before cleanup; stop owned writers, remove only identity-verified fixture entries. On ambiguity retain that exact directory for scoped manual cleanup. No original VM media is opened; no existing workspace/grant/startup/global setting changes. Power-loss durability and actual protected same-volume recovery remain unverified.

**Separate conditional guest experiment, only after resource approval and exact fixture review:** configure VZMacPlatformConfiguration/boot/storage against the approved macOS image requirements, one disposable guest instance, no network, named A share and guest-installed toolchain. No runnable fixture exists yet; do not invent an executable command for it. Require reviewed source/configuration, launch/stop protocol and exact hardware/disk ceilings before execution. Initial guest build control: resolved guest Swift compiler with `-sdk <guest-sdk> -module-cache-path <private-guest-cache> <shared-A>/main.swift -o <shared-A>/out`, then run that binary and verify actual host A output hashes. Test imported Foundation to establish macOS SDK usage.

Pair that positive with: U world-readable read/write; R direct script/interpreter/import/build; unshared B access; host credential/evidence access; symlink/hardlink/ancestor/root-replacement and already-open-handle revocation; nested child escapes; guest network attempt; concurrent independent A/B instances and cancellation preserving the unrelated instance. Broker-copy R→A then execute A/copy is D2 positive. Any outside access, unknown root transition or failed owned stop blocks adoption; never replace these controls with unreadable canaries or broaden shares to make the build pass. At most one instance for initial feasibility; additional per-host concurrency fixtures require their own scoped review. Stop on first escape, preserve evidence/owned resource identities, clean only disposable instance state; restore-image/original media remain immutable.

## Decision record and acceptance boundary

Retain fixed broker; investigate protected retained-version mutation with explicit effects/UNKNOWN first. Reject App Sandbox alone for full host commands. Prioritize assessment of the existing host/toolchain/components. Keep public macOS virtualization as a fallback after a demonstrated host limitation and reviewed cost/resource choice; guest share-boundary proof would still be required. No supported native command mechanism is proven by this research.

Open decisions: acceptable namespace changes on conflicts; protected same-volume recovery placement/retention; actual-host toolchain access (macOS guest development is dropped); share root identity/revocation and durability. The user-confirmed broker-only reference split is recorded in [decisions](../DECISIONS.md). Full M1 remains pending. Later implementation/native work needs separate exact reviewed scope; no valid characterization test was rerun for this document and no gate is added inside user-bound workspaces.
