# Mac Native — User Acceptance Closure (2026-11-09)

## Disposition

**Milestone: PASS — ACCEPTED BY USER.**

The user explicitly accepts the Mac portion as complete for the current intended workflow. Remaining bugs discovered in normal use are handled as new or reopened GitHub Issues, not as a reason to keep this milestone in endless acceptance.

## Accepted scope

- Mac connector and native scoped file operations, including Recovery.
- Native TreeReader / directory copy: qualified and tested in isolated real-Mac fixtures, with user confirmation of satisfactory behavior in another repository.
- Local Git, shell and owned-process lifecycle.
- Desktop application: **Open and Quit only**. Pause/Resume are **not required**; code added for them in PR #15 is surplus to product requirements. Do not add those controls to the UI or treat absence as an acceptance failure.
- Reboot / post-reboot test is explicitly **excluded** from this acceptance.

## Evidence boundaries

- Source/native CI evidence: PR #10 and PR #19; exact native captures and bounded receipts in the qualification workflow, plus prior real Mac tests.
- A user acceptance decision is distinct from comprehensive test evidence. Do **not** represent unobserved operations as technically tested.
- Git remote fetch/pull/push through the Mac connector remains subject to the restricted-network capability guard and was **not** technically accepted as working. This is outside the current accepted Mac milestone; see Issue #17 if development is later requested.
- Production installer lifecycle and crash/reboot scenarios are not retrospectively marked tested.

## Maintenance policy

1. Mark the scoped Mac milestone complete per the user's acceptance.
2. When a real failure is encountered, open a concrete Issue including reproduction, expected/actual result and available logs.
3. Do not add Pause/Resume solely because an implementation exists; Open/Quit is the requirement.
4. Preserve signed native grants, recovery journals and fail-closed network boundaries. Do not bypass safeguards to manufacture a PASS.
