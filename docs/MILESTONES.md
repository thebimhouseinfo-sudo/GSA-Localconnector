# Product milestone proposals

Status: proposed, not implemented or approved as complete. These are product deliverables, not connector approval gates. Working workspace read/write/execute is ungated; explicit references are read-only/non-execution. See [criteria](CRITERIA.md).

The earlier T00–T08 / M0–M5 sequence is retained as a proposal inventory only. Per the current user direction, reassess the published source baseline before revising execution plans or milestones.

| ID | Tasks / dependencies | Observable deliverable | Required product evidence |
| --- | --- | --- | --- |
| M0 | T00 / draft review | Baseline and contract assessment | Source/schema/license inventory and trace to criteria. |
| M1 | T01,T02 / M0 | Mac confinement and recovery | Actual native feasibility, ownership/crash, workspace bind/revoke, sealed-journal proof and SEC01/AUTH01/PROC01/root-safety checks. |
| M2 | T03,T04 / T02; T03 before T04 | Mac CI and artifact transfer | Actual guest CI/artifact positive and adversarial proof for CI01–04, bound to exact source/receipt revision. |
| M3 | T05,T06 / M1,M2; T05 disposition before T06 | Mac working-tool integration | Native file/Git/lifecycle without connector approval prompts inside bound workspaces, outside-boundary denials, fresh local/remote evidence and capability matrix. |
| M4 | T07 / M3 disposition | Windows parity | Independent Windows native positive/denial/lifecycle and Mac/Windows/Ubuntu source results, including parity/regressions. |
| M5 | T08 / M3,M4 + all required evidence | Cross-platform release assessment | Simultaneous plugins, GSA regressions and both native releases; every criterion tied to a tested revision. Release decision remains separate. |


Each deliverable needs observable workspace/reference behavior, exact source revision, platform/backend, commands/exits, relevant scope/workflow revisions, log/artifact hashes and remaining gaps. Source tests, native evidence and live-plugin connectivity are separate facts. See [source status](STATUS.md) and [implementation plan](plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md).

A failed boundary mechanism is an implementation gap; no requirement is waived. No product completion or release readiness is claimed here.
