# Mac desktop lifecycle addition — proposed design

**Deferred by the user on 2026-10-19:** implement this lifecycle addition only after the core connector functions are working and verified. Retain this design for that later stage; do not begin lifecycle implementation now.

2026-10-19. **Written proposal for human review; not activated.** This serves the user's persistent credential setup, login startup and Dock application; all sleep prevention is delegated to user-installed nosleep. It refines existing M4/P06 continuity and M5/P07 installed Mac acceptance; it creates no milestone and changes no criteria, gate state or Git policy. File and native command backend completion remains separate and must not be advertised as enabled by packaging.

## Existing behavior and proposed result

`scripts/mac-package.mjs` already installs a private versioned Node runtime and per-user LaunchAgent, but its `serve` starts HTTP MCP only. `start.command` starts the selected Mac stdio tunnel from the checkout, prompts for `CONTROL_PLANE_API_KEY` each run and requires Terminal. These are two different startup paths; merely hiding Terminal would leave that mismatch unresolved.

Provide **GSA Local Connector.app**, built with existing Swift/AppKit, backed by one per-user launchd supervisor. Bundle the existing tunnel-client and required Node/runtime files in the verified versioned installation. The selected tunnel starts the installed stdio MCP entrypoint through the existing owner launcher; it must not point at `dist` in a dirty development checkout. Preserve the selected Mac tunnel/plugin IDs and independent Windows/GPTWorker configuration. Give the Dock app a distinctive teal-badge adaptation of Lucide's `plug-zap` vector icon, vendoring the static SVG and ISC license in the future implementation with no icon dependency.

The Dock application shows connection/backend status, Pause/Resume, Quit and Start at Login. Closing the window hides it while the connector runs. Pause rejects new work, keeps the Dock UI available and lets already-owned work finish before reporting PAUSED. It does not freeze processes with SIGSTOP or kill them. Resume accepts work again using the same installation. Explicit Quit stops this connector's owned service, then exits the UI. It does not remove the login preference: a later login may start it again. Start at Login can be turned off independently. The Dock icon exists while the UI runs; permanent Dock pinning is the user's normal macOS action and is not silently changed.

## Service ownership, startup and shutdown

Use the existing `com.gsa-localconnector.mac` LaunchAgent label, upgraded explicitly rather than creating a competing HTTP-only service. A LaunchAgent controls one supervisor process; the UI is its status/control client, never a second tunnel launcher. On login it starts the service and opens the small Dock UI without Terminal. Startup is after user login, not before login or while powered off.

The supervisor acquires a dedicated installation lock and respects the existing MCP owner fence. It owns only its spawned tunnel, stdio MCP descendants. Existing checkout-started tunnels are detected and reported as a startup conflict; do not kill them by name or broadly match unrelated apps. Install/upgrade waits for owned work to stop and refuses an active unknown owner. PID alone is insufficient proof of ownership; use the retained child handle plus installation/session identity, and existing owner fencing for worker handoff.

Start is idempotent. Stop/Quit first disables launchd restart for this login session by booting out the known owned job, requests clean stop and reports any owned worker that cannot safely stop. A remaining trusted worker keeps the existing ownership fence. Subsequent Start bootstraps the same job. On service failure, launchd retries with throttling; invalid credentials stop repeated connection attempts and display a setup-required state. Restart and wake reconcile persisted operations before any potentially duplicate mutation, retaining UNKNOWN when evidence is incomplete (criteria §8).

## Sleep prevention is user-managed outside this connector

The user explicitly removed all sleep-prevention mechanisms and will independently install https://github.com/tmad4000/nosleep. Do not add caffeinate, Keep Awake controls, power assertions, privileged helpers or global power settings. Do not research, detect, install, control or test the external tool. No sleep-prevention or closed-lid acceptance check belongs to this plan. Respect deliberate Sleep/shutdown and Pause/Quit; after actual sleep/wake, reconnect and reconcile operations honestly.

## Credential setup — approved repository .env

The user explicitly chose **the repository's `.env`, ignored by Git**, on 2026-10-19, and confirmed that setup saves both tunnel ID and API key. For this checkout that is `/Users/nam/GSA-Localconnector/.env`. Store `GSA_LC_TUNNEL_ID` and `CONTROL_PLANE_API_KEY`; app/service reads them on every launch and never prompts again when valid. Validate the ID as `^tunnel_[a-fA-F0-9]{32}$`. `GSA_LC_TUNNEL_ID` is a connector wrapper convention: the verified client supports `CONTROL_PLANE_TUNNEL_ID`, not that custom name. Generate the nonsecret profile's `control_plane.tunnel_id` from the validated saved value and reference the key as `env:CONTROL_PLANE_API_KEY`. The installer contains setup logic, never a hardcoded personal key. Do not read, print or change an existing real `.env` while preparing this proposal.

Store the configured absolute `.env` path as nonsecret metadata in the per-user service configuration. Installed executables remain self-contained in the versioned runtime; access to the credential intentionally depends on that configured repository file. If the repository moves or the file disappears, report an actionable configuration error and let the user select its new location. Do not silently copy its credential elsewhere. A missing file on first install can be created through a secure one-time native setup field; never ask for the key in chat.

Require `.env` to be Git-ignored and untracked, owned by the current user, mode 0600, a regular single-link file opened without following symlinks. Validate before loading and refuse unsafe state. Parse it strictly as data: accept only `GSA_LC_TUNNEL_ID` and `CONTROL_PLANE_API_KEY`; no shell sourcing, evaluation, substitution or injection of `PATH`, `NODE_OPTIONS` or arbitrary environment names. Do not overwrite unrelated existing content implicitly. The key must never enter argv, LaunchAgent plists, logs, manifests, archives or public installer artifacts; use explicit packaging allowlists and exclude `.env` regardless of Git ignore rules.

Secure replacement after a rejected key preserves other host credentials. Upgrade retains the configured path. Uninstall removes owned executables and launch registration while preserving the repository `.env`, project data, grants, journals and logs; credential deletion is a separate explicit user choice. No Keychain or external credential copy is part of this design.

## Scoped implementation sequence after design approval

1. **Package/startup path:** extend the versioned manifest to cover the existing tunnel-client, installed stdio entrypoint, supervisor and AppKit launcher. Use a nonsecret managed tunnel configuration targeting that installation. Add integrity checks and exact installation ownership checks. Keep existing runtime/backend unavailability visible.
2. **Persistent setup:** implement the approved repo `.env` loader, ignored/untracked/private-file checks, secure first-run entry and per-child environment injection. Verify missing/invalid/moved/unsafe files, rotation, rejected environment injection, log redaction and artifact exclusion using synthetic keys and disposable configuration.
3. **Lifecycle/UI:** replace HTTP-only login startup with the selected Mac tunnel service; add Dock controls, duplicate-instance handling, clean Stop/Quit, throttled restart. Do not change system sleep settings, other login items or other tunnel configurations.
4. **Installation acceptance:** test a disposable per-user installation first. Before modifying the live LaunchAgent, credentials or installed runtime, present the exact installation/replacement action and get explicit approval. Then verify the selected live Mac plugin after refresh, plus login/restart/wake behavior. Preserve the development checkout and all unrelated applications.

The primary agent follows Planner → Coder → Tester → Reviewer at these scoped triggers. Packaging/credential/lifecycle changes receive source review before installation; native installed claims require actual-host evidence. Review findings need a violated approved requirement and reproduction, with at most two repair/review rounds per pair before reporting unresolved issues. No automatic push, merge, rebase, state change or G0/G11 signature.

## Required evidence

- Focused disposable tests: versioned artifact integrity, stdio target points into installation, no synthetic credential in manifest/plist/argv/log output, private-store boundary checks, duplicate Start, owned-child stop. Do not rerun unrelated valid suites or use a VM.
- Installed login launch without Terminal and Dock control of the same single tunnel; explicit Quit stays stopped for the session; deliberate Start works again. Reconnect/restart/wake preserves truthful operation results and does not repeat a write. Invalid key or missing/moved/unsafe `.env` reports an actionable setup error. Other applications/processes stay intact.
- Selected plugin reaches this exact installed Mac runtime after refresh. It reports file/shell capabilities according to their actual implementation; packaging success does not certify missing native backends or full M5 acceptance.

The user approved the overall design with the corrections above and subsequently removed all sleep-prevention work in favor of user-installed nosleep. The concrete implementation plan is [Mac desktop implementation](2026-10-19-MAC-DESKTOP-IMPLEMENTATION.md). No installation, actual credential access or system preference change has been performed by this proposal.
