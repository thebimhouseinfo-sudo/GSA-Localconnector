# GSA-Localconnector

Local capabilities and MCP APIs for GSA through `gsa-lc-mac` or `gsa-lc`. GSA owns reasoning and orchestration; the connector targets file/search/edit, Git, process and existing project build/test tools on the selected machine.

The target model gives working workspaces full file operations, including copy/move/rename/delete, shell, Git, diff and build/test without per-operation approval gates. Explicit references permit list/search/read and copy out into a workspace, never mutation or direct execution in the reference. Data outside granted scopes must remain inaccessible. Windows/Mac use separate plugins/tunnels; complete Mac before Windows development. Personal-use acceptance checks each host separately and keeps projects independent on that host. Tests use the current actual host and installed tools; cross-OS project checks can use GitHub CI when needed. No new VM or connector CI engine is required. This source checkpoint does not yet implement the full model; see [current gaps and verification](docs/STATUS.md).

The source binding API accepts explicit workspace/reference roles and retains the legacy read-only `paths` form. Role grants describe intended scope; they do not activate missing native backends. See the [binding contract and examples](docs/workspaces/LOCAL-ENROLLMENT.md).

## Project documents

- [User operating logic](docs/CRITERIA.md)
- [Decisions](docs/DECISIONS.md)
- [Source status](docs/STATUS.md)
- [Implementation plan](docs/plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md)
- [Criteria-to-source assessment](docs/plans/CRITERIA-TRACEABILITY.md)
- [Milestone proposals](docs/MILESTONES.md)
- [First Mac boundary feasibility plan](docs/plans/M1-MAC-BOUNDARY-FEASIBILITY.md)
- [Workspace model](docs/workspaces/LOCAL-ENROLLMENT.md)
- [ChatGPT ImageGen → local image asset transfer](docs/workspaces/IMAGE-ASSET-TRANSFER.md)
- [Transport setup](docs/tunnel/SETUP.md)

## Build and tests

Node >=20 is required; source CI uses Node 22. Install with `npm ci --ignore-scripts`, then `npm run build` and `npm test`.

Product code is in src/, native/ and scripts/; tests in test/ and product test scripts. Native tests require matching hosts/disposable fixtures. A source build does not certify native or live readiness.

This repository versions product source, CI/build/install/test scripts and project documents. Agent harness, skills and local Codex configuration are excluded; product tests do not require them.

## Dọn đăng ký workspace cũ trên macOS

Menu icon **GSA Local Connector** có mục **Dọn đăng ký cũ…**. Mục này chỉ compact các bản ghi workspace `STALE` (không còn trùng identity pin) và `REVOKED` (đã thu hồi) trong protected grant store, giữ nguyên các grants `ACTIVE`, các grant cần xác minh lại (`REAUTH_REQUIRED`), controller lease, tiến trình đang chạy, signed file backend và file transaction journal. Không có thao tác kill PID hay xóa file dự án.

Kết quả dọn được phản hồi qua status riêng của Desktop; nếu lỗi/không xác nhận, không báo đã dọn. Các thế hệ ID cũ không được tái sử dụng do revision floor được nâng cùng atomic publication. Việc dọn các bản ghi không còn hiệu lực **không** thay thế `unbind_workspace` cho một grant còn `ACTIVE`, cũng không thu hồi quyền từ một descriptor đã mở trước đó; hãy dừng tác vụ có liên quan rồi thu hồi một grant ACTIVE thông qua API được xác thực. Đừng xóa `trusted-workspaces.json`, `scoped-files`, `file-transactions` hoặc control/owner locks để “reset nhanh”.

Nếu một lần bind mới làm thay đổi tập grants còn ACTIVE, file backend vẫn yêu cầu `STOP_OWNER_AND_APPLY_QUALIFIED_RECOVERY` theo signed-recovery flow; dọn lịch sử cũ không thể bypass chữ ký đó. Source/CI không thay thế nghiệm thu trên ứng dụng Mac đã cài.
