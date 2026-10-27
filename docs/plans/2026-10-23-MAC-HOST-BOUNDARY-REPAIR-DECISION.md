# Mac native boundary repair: prerequisite decision — 2026-10-23

Status: READ-ONLY DESIGN PROPOSAL, no entitlement, daemon, account, permission or policy changes authorized by this document. Existing product goal/criteria remain unchanged. This is not a verified implementation or a claim that Endpoint Security alone solves full native containment.

Prerequisite answer, 2026-10-24: user reports the Apple entitlement is absent or unknown. Treat this route as unavailable/unverified now. No ES implementation, signing, helper installation or privilege request follows from that answer. Continue the independent existing managed-process revocation source repair.

## Reproduced problem

Exact static v2 profile allows a previously opened FD to read24synthetic bytes after the named workspace root is moved outside. Native receipt `docs/reports/2026-10-23-mac-host-retained-fd-native.json`; independent classification BLOCKING for complete criterion7 acceptance. Repeating path allow-list variants cannot establish a missing lifecycle/root-change mechanism. All prior approved native slots are consumed.

A replacement design needs both pre-effect handling of scope/root transitions and complete owned-process termination/restart semantics. Merely polling paths, observing a process group, stopping a parent PID, or calling a parent's URL stopAccessing method does not establish those guarantees. Do not promote a candidate from compilation or mocks.

## Supported API direction to evaluate, prerequisites first

Apple documents [ES_EVENT_TYPE_AUTH_RENAME](https://developer.apple.com/documentation/endpointsecurity/es_event_type_auth_rename) as an authorization event before a rename. A prospective trusted guard could deny a protected root/ancestor namespace transition while its execution scope is active, rather than try to retract an already-open FD after the transition. This is a design hypothesis; complete coverage of unlink, replacement, mount/unmount, aliases, other namespaces and all relevant filesystem changes must be demonstrated before any acceptance.

Apple's [client documentation](https://developer.apple.com/documentation/endpointsecurity/client) reports missing entitlement, missing root privilege and missing user/TCC approval as client-creation failures. The [client entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.endpoint-security.client) must be requested from Apple. Adding a plist key or running sudo does not supply Apple's authorization. No existing entitlement is assumed, and no signing identity, account, provisioning profile or credential is read to find one.

## Concrete bounded preparation if the prerequisite is available

1. Obtain only a yes/no statement about an already-approved Endpoint Security entitlement. Do not request keys/certificates, enroll a developer account, send messages, or submit anything to Apple.
2. Prepare a source-only guard protocol and pure policy tests in a separate native candidate directory. Authenticate the existing connector/owner; bind only explicit disposable root identities and authorized managed-process identities. Do not activate an ES client during preparation.
3. Design explicit admit/quiesce/revoke states: freeze new work before transitioning authority; deny protected namespace changes while live work remains; report unconfirmed termination honestly. Specify complete descendant ownership before allowing arbitrary commands. Root/administrator authority does not itself establish that ownership.
4. Independent security/design review must resolve kernel event coverage, deadline/default-deny behavior, lost-client/crash behavior, other apps' unaffected operations, credential isolation, IPC authentication and restart recovery. No systemwide deny policy, broad data scan or unrelated app termination.
5. Before any signed entitlement/provisioning change, daemon registration, administrator request or native execution, present a concrete user-reviewed maintenance proposal with exact built artifacts, capabilities, disposable fixture, finite launch budget, prior-state preservation and rollback. Obtain explicit authorization. Never request installation approval for an unbuilt/unreviewed helper.

This work uses an existing Apple framework; it does not authorize a third-party dependency, a new VM, private API or permission change. If the prerequisite is unavailable, record this route as unavailable; do not silently weaken criterion7, substitute Linux for native Mac, or claim no other possible design exists.

## Existing authorization boundary

AGENTS.md Git/safety: no new dependencies, external plugins/MCP, permission changes or global configuration without approval. Current full-Mac continuation allows read-only investigation and preparation, not new root/TCC/Apple entitlement authority. Ask only the missing prerequisite question now; installation permission remains a later, separate decision after concrete reviewable artifacts exist.

Latest installed runtime d9e3eded-19ed-439f-8025-8cda6b00c5fb was verified RUNNING/CONNECTED; native host activation stays blocked, protected synchronous and asynchronous command history is installed, and Windows waits for full Mac acceptance.
