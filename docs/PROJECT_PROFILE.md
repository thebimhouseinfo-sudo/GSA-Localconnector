# Project technical profile
- Product: local MCP connector, stdio and HTTP; current development priority macOS ARM64.
- TypeScript ESM / Node >=20; tsconfig.json is authoritative. Current local Node 24.21.0,
  TypeScript 5.9.3; existing CI runs Node 22 on macOS, Ubuntu, Windows.
- Native host: Swift with Apple's Virtualization.framework and code-signing entitlements.
  Current host compiler Swift 6.4, arm64. Python 3 guest/seed utilities; local Python 3.9.6.
- Source: src/core contracts/policies; src/local protected persistence; src/hosts native
  adapters; src/mcp transport/dispatch; native/ Swift and guest Python; scripts/ native tooling.
- Build: npm run build. Tests: npm test. npm run check is a test alias.
- No separate linter configured. Do not report lint PASS or add a dependency silently.
- Native proof requires the relevant actual Mac/guest run; TS tests or Swift compilation alone
  do not certify boot, App Sandbox, restart recovery, SEC01 or a live MCP connector.
- Preserve the immutable Ubuntu RAW and its pinned digest. Use isolated candidate disks only.
- Source grants, revocation, lease fencing, root identity, confinement and clean stop are
  security-sensitive; see docs/security/ and the existing implementation plan/checkpoint.
- Host App Sandbox is not proof of arbitrary-shell confinement. Guest jobs remain separate.
- Windows integration is not certified by Mac tests. Do not import CAD/Revit/API assumptions.
- Approved product scope/criteria stay in existing plans and explicit user decisions.
  Bootstrap does not replace or auto-approve those documents.
- Official documentation: typescriptlang.org/docs, nodejs.org/api, docs.python.org/3,
  developer.apple.com/documentation/virtualization. Consult the correct host/version as needed.
- Skills: planning → existing brainstorming/writing-plans; Coder → systematic-debugging/TDD;
  Tester/Reviewer → verification-before-completion and code-review skills. Load per task only.
- Unknowns: live plugin health and pending Mac integration must be tested by future product
  tasks; bootstrap makes no new product success claims.
