# Product decisions

## Settled operating logic — 2026-10-17

- Criteria describes settled desired user operation; all designs must satisfy it. Contracts, tests and implementation status belong in plans/evidence.
- Connector is an offline GitHub workspace/tool provider. GSA owns reasoning/orchestration; connector adds no task/review/promotion approval gates.
- Working workspace permits read/write/edit/delete, version control, commands/processes and build/test without separate permission unlocks. This supersedes read-only binding followed by separate execution grants.
- Extra explicit reference directories permit read/search for design/knowledge lookup only; no mutation/execution or implicit promotion. Ungranted project data stays inaccessible, including through descendants.
- Windows/Mac use independent simultaneous plugins/tunnels with host-local state and one controller per host. This supersedes the shared-plugin/shared-tunnel design.
- Normal activation supplies absolute paths through the selected plugin. Terminal enrollment is a legacy implementation detail, not a prerequisite.
- Repository contains product source, build/test/install scripts and project documents. Agent environment, harness, skills and Codex-only workflow scripts stay local and ignored.
- Current order: fix/review baseline defects and publish product source; only then reassess, revise plan/milestones and implement by milestone. Fresh start preserves history and local work.

Authority: [CRITERIA.md](CRITERIA.md). Evidence/limitations: [STATUS.md](STATUS.md). A source checkpoint is distinct from a production release.
