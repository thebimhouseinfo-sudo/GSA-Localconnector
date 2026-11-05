# Track C — integration request to Track A, B, D and serial integrator

## Gate contract
Do not modify shared test registry or source owners from Track C. After reviewed A/B/D source is integrated, request CI-owner revision on the **same named branch**. Coordinate Git HEAD and do not overwrite parallel commits.

**Track A / C-A:** provide exact native API/test entrypoints for signed disposable file broker, workspace/ref allow/deny, race/CAS/UNKNOWN, interruption/no replay, owned helper physical termination and neighbor/canary preservation. CI owner will implement `scripts/ci-mac-a-acceptance.mjs` with non-skippable objective assertions. Existing source-only tests alone do not satisfy native broker proof.

**Track B / C-B:** provide actual host adapter and public invocation path for a Darwin process; test root and child cwd, reference rejection, sanitized environment, local dirty Git, non-Git scripts, output/exit, timeout, verified owned group cancellation with unrelated live neighbor, journal/history/UNKNOWN. CI owner will implement `scripts/ci-mac-b-acceptance.mjs` when that integration is real.

**Track D / C-G3:** provide deterministic package and manifest/entitlement verification and no-install startup/shutdown smoke (hosted runner temporary paths only). CI owner will implement `scripts/ci-mac-g3-acceptance.mjs`; require C0/C-A/C-B and exact candidate identity before G3 acceptance.

**Integrator:** reserve shared `src/mcp/*` owner; communicate exact commit SHA and exported interfaces, run G1/G2/G3 independently at each candidate HEAD. Do not assert G3 PASS from one existing green source workflow or install on user host. If shared `package.json`/test registry needs editing, route via this integration request rather than editing from C.

No changes requested to the approved Criteria/Decisions. This is a concrete dependency report, not a claim that upstream work has been completed.

## Concrete integration blockers observed during Track C continuation

- **A1/INT-A:** C-A now exercises the real ad-hoc-signed disposable Swift file broker using `native/macos-files/test-broker.py`, plus scoped file/CAS/UNKNOWN source tests. The required `scripts/ci-mac-a-interruption-proof.mjs` is intentionally absent until Track A/integrator supplies an integrated native interrupted-transaction/physical owner-stop proof; `src/hosts/macos-file-recovery.ts` still exposes `MAC_FILE_RECOVERY_ACTIVATION_BLOCKED`. Do not use source mocks as a replacement.
- **B/INT-B:** `scripts/ci-mac-b-acceptance.mjs` now runs actual Darwin subprocess/Git/timeout/neighbor and process journal suites without allowing SKIP. Integration must verify the path reaches the production MCP caller and persisted journal, not merely a candidate host adapter.
- **D/packaging:** `scripts/ci-mac-g3-acceptance.mjs` builds and verifies a disposable signed desktop stage using the existing installer buildStage/verifyStage API. The repository tree does not contain `bin/tunnel-client`. Track D/integrator must supply a genuine pinned tool with provenance, not a stub/fake binary, and ensure harmless startup/stop smoke is available. No real Mac installation.
- **Hosted runner:** dozens of concurrent pushes keep later GitHub macOS runs QUEUED. Use latest single candidate SHA after integration and confirm every required job/step executed rather than accepting an older source-only green run.
