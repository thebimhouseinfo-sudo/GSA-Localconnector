# Mac finish plan — check of Codex's progress and comments

Date: 2026-10-30 · Reviewer: Claude (read-only check; no product source changed) · Branch `main`

## Verified state (fresh)

- `npm run build` OK; `npm test` 585 total / 582 pass / 0 fail / 3 skipped (this is the working tree, 27 files uncommitted).
- Codex commits since the review: `bdae0c2` (review findings 1-16), `52401e3`, `dccd5c3` (Mac27 driver repair), `c81142a` (bind recovery loader to qualification). None pushed.
- `node harness/gate.mjs status`: still `AWAITING_USER` / `GUIDED_ONLY`, milestone **M1 / task P01**. No milestone has advanced since 2026-10-17.
- Per Codex's own docs, Mac is **not** accepted: recovery activation, installed plugin acceptance and P04 shell/Git are open.

## Why it is slow (evidence, not blame)

1. **Process weight.** Each source change goes Critic → Reviewer → Tester, inside 30-minute windows, with a separate human approval per commit. `2026-10-28-MAC-COMPLETION-CHECKPOINT.md` (134 lines) and `2026-10-29-MAC-COMPREHENSIVE-REVIEW.md` (87 lines) are mostly evidence bookkeeping. Real code progress per window is small.
2. **Scope drift off the critical path.** Useful fixes (edit overlap, BOM, CRLF, glob `..`, stale root, artifact pin, byte-safe read/write) are not on the path to M3-M5. They are real, but they are not what blocks "Mac done".
3. **The true blocker is not a code bug.** P04 (run commands/Git on the real Mac) cannot be finished by more review. See D1 below.

## What "Mac done" means (M2-M5, from MILESTONES.md)

| Milestone | Still missing (source: Codex's own review + STATUS) |
|---|---|
| M2 files | recoverable move; operation log / non-Git diff owner; directory move/rename decision (G4); installed recovery activation (step2b); installed plugin delivery |
| M3 execution | **P04 host command + Git inside the workspace boundary** (blocked) |
| M4 continuity | crash/restart/reboot tests on a real Mac; physical-stop provenance for process records |
| M5 acceptance | desktop lifecycle: Pause/Resume/safe Quit/Dock (G1); installed signed artifact; multiple concurrent projects |

## Decisions only the Human can make (Codex must not decide these)

**D1 — P04 command boundary (the real blocker).** CRITERIA §7 requires the safety limit to apply to every command, script and child process, and says an implementation that does not protect outside the workspace "is not yet meeting the product requirement". The repo's own evidence: Seatbelt and held-descriptor attempts do not give a safe fallback; the Endpoint Security entitlement is absent/unknown. Options:
- **A. Keep §7 as written.** Mac cannot be accepted until an OS-level boundary is found. Honest, but open-ended.
- **B. Amend §7 for personal use** (needs Advisor checkpoint, then your explicit approval): run commands as the logged-in user with cwd pinned to the workspace and no OS confinement, documented as accepted risk, reference roots never executable. This unblocks M3-M5 and matches the personal-use scope in §0. It must be written as a Criteria change, not slipped in as an implementation detail.
- **C. Best-effort Seatbelt (`sandbox-exec`) profile** with explicit documented gaps, as a stricter variant of B. Deprecated API; needs a short feasibility spike.

**D2 — directory move/rename.** The proposal excluded it; CRITERIA §4 lists full operations. Either implement it or amend the Criteria wording.

**D3 — review depth.** To finish, lower the per-change ceremony: keep one Reviewer pass per milestone slice instead of Critic+Reviewer+Tester on every sub-step, and approve commits in batches.

## Comments for Codex — fix list in order (after D1-D3 are answered)

1. Commit or drop the 27 uncommitted files in small, user-approved groups (Pack A R1-R3/R11/R8/R7/R6/R4, byte API R12, step1/2a recovery validator). Do not leave them uncommitted across windows.
2. **M2 first:** step2b (same-flock-owner publication + installer), recoverable `moveExclusive`, operation-log reader, then the installed-file delivery on the real Mac with disposable fixtures.
3. **M3 per D1:** implement the chosen command runner behind `VerifiedNativeSandbox` (`src/core/native-io.ts`) with: cwd pinned to the workspace (allow a validated relative cwd), timeout, output cap, owned cancel, and the process journal as the only run record. Update the `run_command` catalog text (it still says "disposable Linux snapshot").
4. **M4:** one real crash and one restart test against the process journal; define physical-stop evidence before releasing slots (review R5).
5. **M5:** Pause/Resume/Quit in `native/macos-desktop/App.swift` + adapter (G1), signed installed artifact, two concurrent projects.
6. Keep every native claim tied to a real Mac run with its source hash; unit/compile PASS is not native PASS.

## Prompt to hand to Codex after the Human answers D1-D3

```text
Read docs/reviews/2026-10-30-MAC-FINISH-PLAN.md. The Human decisions D1, D2, D3 are: <fill in>.
Goal: finish Mac (M2-M5). Work only on the fix list, in order. Commit the 27 existing uncommitted files first in groups I approve.
One Reviewer pass per slice. Report exact commands and results. No push. Ask before any Criteria or role change.
```

## Quyết định của Human (2026-10-31)

- D1 = B: CRITERIA §7 đã sửa (commit 202297c).
- D2: làm move/rename thư mục dạng tối thiểu: cùng workspace, cùng volume, rename(2) nguyên tử, không ghi đè; khác volume hoặc khác root thì từ chối và báo lý do. Không cần cơ chế recovery riêng, không đổi chữ Criteria.
- D3: mỗi lát việc một lượt Reviewer; việc nhỏ chỉ cần build + test; commit theo lô nhỏ; chỉ hỏi khi đổi Criteria hoặc vai trò; việc ngoài M2-M5 vào backlog.
