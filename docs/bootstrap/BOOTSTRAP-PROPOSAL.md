# Bootstrap GSA-Localconnector — đề xuất cấu hình

Ngày khảo sát: 2026-10-17. Trạng thái: **APPROVED_FOR_HARNESS_SETUP** (người dùng duyệt 2026-10-17).
Nguồn yêu cầu: `harness-bootstrap-prompt-v6.md` do người dùng cung cấp.
Đây là đề xuất môi trường coding agent; không phải kế hoạch phát triển sản phẩm.

## Phạm vi và hiện trạng

Trường hợp A: dự án đã có code. Giữ TypeScript/Node, Python và Swift hiện hữu.
Ưu tiên Mac theo yêu cầu trước đó; phiên bootstrap không tiếp tục sửa sản phẩm,
khởi động VM, kích hoạt LaunchAgent hay chỉnh tunnel.
Các thay đổi Mac đang làm được giữ nguyên, không tự stage/commit hoặc hoàn tác.

| Năng lực | Bằng chứng khảo sát | Quyết định đề xuất |
|---|---|---|
| Git | origin: thebimhouseinfo-sudo/GSA-Localconnector; origin/HEAD → main | Nhánh đích main; push MANUAL_ONLY |
| Working tree | codex/mac-completion; HEAD 19dac16; 1 commit trên main; còn thay đổi chưa commit | Không checkout, merge, rebase, xóa branch hoặc tạo branch mới trong bootstrap |
| Remote | Chỉ đọc remote-tracking refs hiện có, chưa fetch trong phiên này | Trạng thái remote thực tế UNVERIFIED; không tuyên bố đã đồng bộ |
| Ngôn ngữ | TypeScript ESM, Python 3, Swift/Virtualization.framework | Không áp dụng profile CAD/Revit/web frontend |
| Runtime | Node v24.21.0; package yêu cầu >=20; CI Node 22 | Giữ engines và CI hiện hữu; không đổi stack |
| Compiler | TypeScript 5.9.3 đang cài; Swift 6.4 arm64 | Tách type-check và native compile khỏi native VM test |
| Python | Python 3.9.6 đang có | Harness tránh thêm dependency Python |
| Build/test | npm run build; npm test; npm run check là alias test | Tái dùng, không viết bộ test sản phẩm trùng lặp |
| Lint | Không có script/config linter riêng trong package.json | NOT_CONFIGURED; không báo lint PASS, không tự cài ESLint |
| CI | .github/workflows/ci.yml; Ubuntu/Windows/macOS; native preflight trên Mac | Giữ CI; build/preflight không đồng nghĩa guest boot PASS |
| Agent | Codex desktop; CLI 0.158.0; phiên có công cụ subagent | Không giả định CLI config áp dụng ngay cho desktop đang chạy |
| Hook | Tài liệu chính thức có project hooks và trust review | Chỉ bật sau duyệt cấu hình và thử thực tế trên phiên mới |
| Model | Phiên cung cấp danh mục model; chưa gọi thử từng vai trong bootstrap | Kế thừa model/reasoning của phiên; không ghim model ID chưa thử |
| MCP | Source có stdio và HTTP MCP; connectors được phiên cung cấp | Kết nối live chưa kiểm lại; không báo transport/plugin PASS |
| Harness | Chưa có AGENTS.md hay thư mục harness được quản lý Git | Dựng tối thiểu theo cấu hình dưới đây sau duyệt |

Lệnh đã chạy để khảo sát: `git status --short`, `git branch -vv`,
`git worktree list`, `git symbolic-ref refs/remotes/origin/HEAD`,
`git rev-list --count main..HEAD`, `git merge-base --is-ancestor HEAD main`,
`codex --version`, `node --version`, `npm --version`, `npm ls --depth=0`,
`swift --version`, `python3 --version`, `uname -m`.
HEAD chưa nằm trên main theo ancestry; không tự tích hợp thay đổi trong bootstrap.

## Thành phần sẽ dựng sau duyệt

| Thành phần | Chống lỗi gì / cách thực hiện |
|---|---|
| AGENTS.md dưới 60 dòng | Một nguồn hướng dẫn, trỏ tới profile/quy trình thay vì chép tài liệu dài |
| docs/PROJECT_PROFILE.md | Tách kiến thức TypeScript/Swift/macOS/Python khỏi role dùng chung |
| docs/bootstrap/AGENT_ASSIGNMENT.md | Công khai vai, model, quyền thực tế và phần UNVERIFIED |
| harness/verify.mjs | Gọi compiler/test có thật, dừng ở lỗi đầu, báo phạm vi diff và test bị sửa |
| harness/snapshot.mjs | Sao lưu file được chỉ định trước sửa; restore có đối chiếu hash, không ghi đè thay đổi mới âm thầm |
| harness/git-admin.mjs | status/audit/preflight/verify-integration/cleanup/recover; mặc định chỉ đọc hoặc dry-run |
| harness/gate.mjs | status/check/sign/advance; hash phạm vi và dependency để hết hạn gate đúng phần bị đổi |
| harness/policy.json | Đường dẫn nhạy cảm, ngưỡng diff, giới hạn vòng; là cấu hình chia sẻ được review |
| docs/MILESTONES.md và schema cấu hình | Khuôn trống NOT_CONFIGURED; Planner/người dùng mới điền và duyệt |
| docs/reports/_TEMPLATE.md, lessons/_TEMPLATE.md | Báo cáo có lệnh và bằng chứng; ghi lỗi cần hơn một lần sửa |
| docs/BACKLOG.md và docs/DECISIONS.md | Giữ finding ngoài phạm vi và quyết định có nguồn; không tự thay GOAL |
| .codex/agents/*.toml | Năm role tối thiểu; chỉ cài sau kiểm schema và được duyệt cấu hình tool |
| .codex/hooks.json | Adapter sự kiện gọi harness; chỉ bật sau duyệt và kiểm tra trust/runtime |

Không tạo GOAL/criteria/milestone sản phẩm mới. Tài liệu plan, security, review và
checkpoint hiện hữu tiếp tục là nguồn tham khảo; không chuyển trạng thái của chúng
thành milestone được duyệt bằng suy đoán. Không tạo daemon riêng.

## Ma trận vai và kỹ năng

Đề xuất ban đầu kế thừa model đã được thay bằng phân vai cụ thể theo yêu cầu
của người dùng ngày 2026-10-17. Cấu hình cuối ở docs/bootstrap/AGENT_ASSIGNMENT.md.
Khả năng chạy thật từng role là **UNVERIFIED** đến khi thử sau duyệt;
thiếu quyền/quota thì báo BLOCKED, không âm thầm đổi model.

| Vai | Đầu vào / phạm vi ghi | Skill tái sử dụng |
|---|---|---|
| planner | Yêu cầu + tiêu chí đã duyệt; chỉ soạn docs/ và TASKS.md | brainstorming, writing-plans |
| coder | Một task + project profile; sửa source thuộc task | systematic-debugging, test-driven-development |
| tester | Tiêu chí + cách chạy; sửa test và báo cáo, không source | verification-before-completion |
| reviewer | Chat + bộ nhớ + diff; chỉ cập nhật lessons/backlog/decisions | requesting-code-review, receiving-code-review |
| critic | Bản xuất source/diff/README tối thiểu trong phiên mới, không chat/bộ nhớ | Contract quan sát độc lập; reviewer phân loại kết quả |

Không viết lại năm skill đã có dưới tên khác. Chỉ bổ sung workflow dự án như
finish-task/review-lessons nếu bản đồ skill cho thấy thiếu và nằm trong cấu hình
được duyệt. Không cài plugin/MCP bên ngoài. Skill/model/hook mới về sau phải có
mục đích, phạm vi file/quyền, test hợp lệ/lỗi, rollback và duyệt nếu đổi quyền/tool.

Quyền đường dẫn theo role trong bảng là contract cho đến khi có enforcement
thực tế. Phiên hiện tại có filesystem unrestricted, nên không tuyên bố prompt
hoặc file role tạo được sandbox chỉ đọc. Critic cần bản xuất giới hạn; nếu runtime
vẫn đọc được bộ nhớ thì đánh dấu CONTEXT_ISOLATION_UNVERIFIED.

## Review/gate và Git policy

- Ban đầu NOT_CONFIGURED: không tự tạo M1, không phát review/push giả.
- Planner định nghĩa trigger/event quan sát được, scope, role, bằng chứng,
  giới hạn vòng và điều kiện PASS; người dùng duyệt trước kích hoạt.
- Khi trigger tới, gate nêu bước bắt buộc; agent chính gọi vai tương ứng.
  Ban đầu GUIDED_ONLY, chỉ đổi AUTOMATED sau bài thử điều phối thực tế.
- Finding CHẶN phải trỏ criterion/GOAL và có bằng chứng; NGOÀI PHẠM VI vào backlog;
  CHƯA KIỂM CHỨNG cần thu thập bằng chứng. Không có finding CHẶN là hợp lệ.
- Tối đa 2 vòng review/sửa mỗi cặp; tối đa 3 lần Stop tiếp tục do lỗi verify.
  Hết giới hạn báo người dùng, không vòng vô hạn.
- Source đổi làm hết hạn gate dựa trên hash/dependency; không bắt chạy lại phần
  độc lập. Diff >=150 dòng/5 file nâng chuẩn; >=400 dòng/12 file hoặc chạm quyền,
  grant, lease, native isolation, credential, installer hay dependency nâng nặng.
- G0/G11 không nhận PASS từ file agent tự ghi. Chưa có kênh xác nhận đáng tin
  thì AWAITING_USER; không tuyên bố chống giả mạo chỉ nhờ JSON.
- Git Admin kiểm tra task/baseline/đích cụ thể; patch tương đương chưa đủ chứng
  minh thì POSSIBLY_EQUIVALENT. Ref cũ không chứng minh trạng thái remote mới.
- Giữ branch hiện tại vì có công việc dở; chính sách single-main áp dụng cho
  công việc mới sau khi người dùng quyết định cách tích hợp branch hiện tại.
- MANUAL_ONLY: không tự fetch/push, merge, cleanup hay sửa branch protection.
  LOCAL_ONLY/DONE_LOCAL phân biệt với PUSHED_VERIFIED. Hook phía client có thể
  bị bỏ qua; không xem nó là bảo vệ tuyệt đối cho mọi đường push.

## Hook dự kiến và giới hạn

SessionStart/UserPromptSubmit gọi gate status; PreToolUse cho các tool đã nhận
diện để snapshot và chặn đường dẫn/lệnh nhạy cảm; PostToolUse chạy quick check
liên quan; Stop gọi gate check/verify với số lần tiếp tục có giới hạn.
Không chặn/bootstrap chính nó vì chưa có milestone sản phẩm được duyệt.
Phải thử các đường sửa thực tế (apply_patch, shell, tool khác); đường chưa được
adapter bảo vệ phải báo GUIDED_ONLY. Không sửa ~/.codex hoặc quyền hệ thống.

Tài liệu chính thức đã mở khi khảo sát:
- [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Hooks](https://learn.chatgpt.com/docs/hooks)

Tài liệu xác nhận model/reasoning kế thừa khi không override, hooks có trust
review, và custom agent không tự override sandbox của parent. Cần test runtime
desktop thực tế; không suy ra hỗ trợ từ việc một file TOML hợp cú pháp.

## Dữ liệu đưa vào Git

Giữ source, test, workflow CI, native entitlements, package-lock.json, tài liệu
chia sẻ, script harness, schema, policy và template role/hook được duyệt.

.gitignore đã được bổ sung theo yêu cầu trực tiếp: dependency/build/cache/log,
.env và biến thể (chừa template), khóa/chứng chỉ riêng, .continue/, tunnel binary,
.gsa/local-state/, VM media, harness snapshot/state/report cục bộ. Không đọc nội
dung credential để phân loại. Không ignore toàn bộ .gsa/, .codex/, bin/ hay docs/.

Ignore chỉ ngăn Git thêm file thông thường; không xóa file đã track/lịch sử và
không ngăn git add -f. Kiểm tra tracked-ignored và quét secret theo nội dung là
hai bước khác nhau; phiên này không tuyên bố đã quét sạch toàn lịch sử.

## Kiểm chứng sau khi được duyệt

1. Verify: fixture hợp lệ PASS, fixture lỗi FAIL, báo test/scope thay đổi đúng.
2. Snapshot: restore đúng byte/hash; chặn traversal/symlink và ghi đè xung đột.
3. Gate: thiếu/expired gate chặn; diff nâng profile; không tự ký G0/G11.
4. Trigger: mốc chưa duyệt không chạy; trigger hợp lệ gọi đúng role; CHẶN trả
   coder; PASS không lặp; hết vòng dừng; source đổi chỉ hết hạn dependency.
5. Role: chọn đúng profile, không rò hai project fixture, model thiếu báo
   UNVERIFIED/BLOCKED; không báo quyền đọc/ghi enforced nếu chưa chứng minh.
6. Git Admin: repo fixture có commit chưa merge/đã merge/cherry-pick, remote
   không truy cập, dirty worktree; cleanup dry-run không xóa, policy không push.
7. Hook: thử hợp lệ/vi phạm qua tool thực; cần phiên mới thì ghi rõ. Không thử
   phá hủy hoặc push trên repo thật. Hook/config rollback bằng snapshot.

Chi phí duy trì: Node script dùng thư viện chuẩn, không dependency mới; chạy
quick check sau sửa, full verify ở mốc, native VM chỉ khi task thực sự cần.
Các bài thử harness chạy trên fixture tạm; không sửa sản phẩm trong bootstrap.

## Phần cần người dùng duyệt

Duyệt bộ thành phần, kế thừa model/reasoning, giới hạn enforcement nêu trên và
project-local role/hooks dự kiến. Sau duyệt mới dựng và test harness. Không cần
người dùng đọc code; báo cáo kết quả theo test/bằng chứng và giới hạn thực tế.

## Thực thi sau duyệt
Người dùng đã duyệt cấu hình, nhấn mạnh không đổi code sản phẩm và yêu cầu model
riêng theo vai. Xem WORKFLOW.md, AGENT_ASSIGNMENT.md và BOOTSTRAP-REPORT.md để biết
phần đã dựng, kết quả kiểm chứng và giới hạn. Các bảng đề xuất ở trên giữ để truy vết.
