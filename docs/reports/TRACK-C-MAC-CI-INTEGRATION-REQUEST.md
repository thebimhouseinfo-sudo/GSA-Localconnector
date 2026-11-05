# Track C — integration request to Track A, B, D and serial integrator

## Gate contract
Do not modify shared test registry or source owners from Track C. After reviewed A/B/D source is integrated, request CI-owner revision on the **same named branch**. Coordinate Git HEAD and do not overwrite parallel commits.

**Track A / C-A:** provide exact native API/test entrypoints for signed disposable file broker, workspace/ref allow/deny, race/CAS/UNKNOWN, interruption/no replay, owned helper physical termination and neighbor/canary preservation. CI owner will implement `scripts/ci-mac-a-acceptance.mjs` with non-skippable objective assertions. Existing source-only tests alone do not satisfy native broker proof.

**Track B / C-B:** provide actual host adapter and public invocation path for a Darwin process; test root and child cwd, reference rejection, sanitized environment, local dirty Git, non-Git scripts, output/exit, timeout, verified owned group cancellation with unrelated live neighbor, journal/history/UNKNOWN. CI owner will implement `scripts/ci-mac-b-acceptance.mjs` when that integration is real.

**Track D / C-G3:** provide deterministic package and manifest/entitlement verification and no-install startup/shutdown smoke (hosted runner temporary paths only). CI owner will implement `scripts/ci-mac-g3-acceptance.mjs`; require C0/C-A/C-B and exact candidate identity before G3 acceptance.

**Integrator:** reserve shared `src/mcp/*` owner; communicate exact commit SHA and exported interfaces, run G1/G2/G3 independently at each candidate HEAD. Do not assert G3 PASS from one existing green source workflow or install on user host. If shared `package.json`/test registry needs editing, route via this integration request rather than editing from C.

No changes requested to the approved Criteria/Decisions. This is a concrete dependency report, not a claim that upstream work has been completed.
