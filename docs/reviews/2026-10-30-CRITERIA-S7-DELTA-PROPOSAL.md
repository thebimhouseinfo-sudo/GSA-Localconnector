# Đề xuất sửa CRITERIA §7 — chỉ là đề xuất, CHƯA ghi vào CRITERIA.md

Trạng thái: DRAFT chờ Technical Advisor, rồi quyết định của Human. Không file nào ngoài tài liệu này bị thay đổi.
Nguồn quyết định: Human chọn "B" cho D1 trong `2026-10-30-MAC-FINISH-PLAN.md` (dùng cá nhân; chấp nhận rủi ro có ghi rõ).

## Vấn đề

§7 hiện yêu cầu giới hạn an toàn áp dụng cho **mọi lệnh, script và tiến trình con**, và nói nếu chưa bảo vệ được ranh giới ngoài workspace thì đó là phần chưa đáp ứng. Trên Mac chưa có cơ chế hệ điều hành chứng minh được điều này (Seatbelt và held-descriptor không đủ; entitlement Endpoint Security vắng hoặc chưa rõ). Hệ quả: M3 (P04), M4, M5 không thể nghiệm thu.

## Đoạn hiện tại bị ảnh hưởng

> "Giới hạn an toàn áp dụng cho mọi công cụ, lệnh, script và tiến trình con: đọc/ghi/thực thi trong workspace; chỉ đọc ở các thư mục tham khảo được cấp; không truy cập dữ liệu dự án ở nơi chưa được giao."
> "Nếu triển khai chưa bảo vệ được ranh giới ngoài workspace thì đó là phần chưa đáp ứng yêu cầu sản phẩm, phải sửa thiết kế và báo đúng tình trạng."

## Đề xuất thay đổi (delta)

Giữ nguyên: workspace đầy đủ quyền; thư mục tham khảo chỉ đọc, không chạy lệnh, không làm đích ghi; công cụ **file** của connector (đọc, ghi, sao chép, di chuyển) vẫn bị giới hạn nghiêm trong thư mục đã giao bằng broker có chữ ký; thu hồi quyền / thay root thì chặn và báo lý do.

Thêm (thay cho yêu cầu "mọi tiến trình con"), dùng cho cá nhân trên một máy tin cậy:

1. **Lệnh, script và tiến trình con** chạy dưới tài khoản của người dùng đã đăng nhập, với thư mục làm việc bị khóa trong workspace đã giao. Connector **không** hứa ngăn một chương trình do người dùng/GSA chọn chạy tự đọc hoặc ghi ngoài workspace bằng quyền của tài khoản đó.
2. Connector vẫn bảo đảm: chỉ chạy khi có workspace hợp lệ (không phải tham khảo); giới hạn thời gian và đầu ra; hủy đúng tiến trình của công việc; môi trường tối thiểu (không truyền sẵn biến chứa bí mật của connector); mạng, tải thêm, bí mật cần cho phép riêng như §5.
3. Giới hạn này **được ghi rõ trong trạng thái** (capability/`list_capabilities`): `command_confinement: none (user account)`. GSA và người dùng thấy được điều này; không dùng chữ "an toàn tuyệt đối".
4. Người dùng chấp nhận rõ ràng rủi ro: mã dự án không đáng tin có thể đọc dữ liệu khác của tài khoản. Chỉ dùng workspace của dự án đáng tin.
5. Câu "Nếu triển khai chưa bảo vệ được ranh giới ngoài workspace thì đó là phần chưa đáp ứng" chỉ áp dụng cho **công cụ file** và việc chặn truy cập qua API connector; nó không áp dụng cho nội dung mà một lệnh tự làm với quyền tài khoản.

## Tác động lên triển khai (nếu được duyệt)

- Mở khóa P04: runner lệnh chạy trên host, cwd hợp lệ trong workspace (cho phép thư mục con), giữ process journal làm bản ghi duy nhất. Cập nhật mô tả `run_command` (hiện nói "snapshot Linux dùng một lần").
- Plan/Proposal: PLAN-M3, PLAN-M1 và `TECHNICAL_PROPOSAL.md` P04 cần cập nhật; milestone M1 "boundary decision" đổi từ "tìm cơ chế" sang "ghi nhận giới hạn chấp nhận".
- Không đổi: broker file, role workspace/reference, thu hồi quyền, fencing owner.
- Bằng chứng native vẫn phải chạy thật trên Mac; không dùng unit test để tuyên bố.

## Rủi ro và điều chưa biết (để Advisor đánh giá)

- Mã dự án (hoặc kết quả GSA tạo ra) có thể đọc khóa SSH, trình duyệt, dữ liệu cá nhân của tài khoản.
- Một lệnh có thể sửa cấu hình cấp quyền của connector nếu thư mục danh tính nằm trong tầm tài khoản; cần xác nhận thư mục này được bảo vệ bằng quyền file (0700) và kiểm tra tính toàn vẹn.
- Phương án C (Seatbelt best-effort) có thể giảm rủi ro mà không hứa tuyệt đối; chưa được thử.
- Có nên thêm danh sách cấm đường dẫn (ví dụ `~/.ssh`) cho bước bind workspace hay không (liên quan mục 17 của review).

## Việc cần Human quyết định sau lời khuyên của Advisor

Chấp nhận / sửa / từ chối delta trên. Chỉ khi có quyết định rõ ràng, Planner mới ghi vào `docs/CRITERIA.md`.

## Lời khuyên của Technical Advisor (2026-10-30, chỉ đọc, không sửa file)

- **Khả thi** cho một người dùng, một máy tin cậy, chỉ giao dự án tin cậy; mở khóa P04/M4/M5.
- **Thư mục danh tính không bảo vệ được khỏi lệnh cùng tài khoản.** `src/local/identity.ts` đặt state ở `~/Library/Application Support/GSA-Localconnector` (0700, gồm `mcp-token`, `trusted-workspaces.json`). Quyền 0700 chỉ chặn tài khoản khác; lệnh cùng UID đọc được token, sửa grant, sửa journal. HMAC không giúp vì khóa cũng cùng tầm. Chỉ UID riêng mới là ranh giới thật (nặng, cần admin); Seatbelt deny-list chỉ best-effort (`sandbox-exec` deprecated, chưa thử trên Darwin 27, UNVERIFIED); phát hiện-không-ngăn là phương án rẻ.
- **Câu Criteria còn mâu thuẫn nếu chỉ sửa §7 đoạn 1:** dòng 18, dòng 24, §3 dòng 50 và 54, §7 đoạn 1 ("Đặt thư mục làm việc đúng chỗ chưa đủ..."), và nặng nhất §7 đoạn 2 ("không được ... lấy thông tin đăng nhập, sửa cấu hình cấp quyền hoặc thay kết quả kiểm tra đã lưu"); §5/§8 chỉ còn đúng với hành vi connector.
- **Lan sang:** `docs/security/*` (NATIVE-SANDBOX-GATE, PROTECTED-STATE), mô tả `run_command`/capability; xét lại tunnel key trong `.env` (lộ thì bị điều khiển từ xa).
- **Cách viết tối thiểu an toàn:** "Công cụ file và API của connector bị giới hạn trong phạm vi đã giao. Lệnh, script và tiến trình con chạy bằng quyền tài khoản người dùng, cwd trong workspace; connector không ngăn chúng đọc/ghi ngoài workspace, kể cả dữ liệu của chính connector (token, grant, journal). Trạng thái báo `command_confinement: none (user account)` và `state_integrity_vs_commands: not_protected`. Connector phát hiện và báo khi state bị sửa từ bên ngoài, không tin kết quả bị nghi ngờ. Người dùng chấp nhận rủi ro này và chỉ giao dự án tin cậy."
- **Khuyến nghị:** phương án A (chấp nhận rủi ro) với cách viết trên và sửa đủ các chỗ mâu thuẫn; thử Seatbelt deny-list sau khi M3 chạy, chỉ làm lớp phụ không dùng để nghiệm thu; ghi UID riêng vào backlog nếu sau này chạy mã không tin cậy.

## Quyết định của Human sau lời khuyên (2026-10-31) — ĐÃ ÁP DỤNG vào CRITERIA.md

- Chấp nhận rủi ro lệnh đọc/sửa token, grant, journal; sửa **đủ chỗ**: dòng 18, dòng 24, §3 (dòng 50 và 54), §7 (đoạn 1, đoạn 2, đoạn 3, thêm đoạn "Ngoại lệ cho lệnh...").
- Seatbelt deny-list: để sau M3, chỉ là lớp phụ, không dùng để nghiệm thu.
- Tunnel key trong `.env`: ghi rủi ro, giữ nguyên (không đọc hay sửa `.env`).
- Chặn bind workspace vào `/`, thư mục home, `~/.ssh`, thư mục dữ liệu connector (review mục 17).

Việc lan sang, giao cho Planner/Coder: cập nhật `docs/IMPLEMENTATION_PLAN.md` (PLAN-M1, PLAN-M3), `docs/TECHNICAL_PROPOSAL.md` (P01, P04), `docs/security/NATIVE-SANDBOX-GATE.md` và `PROTECTED-STATE-PLATFORMS.md`, mô tả `run_command`/capability (`command_confinement`, `state_integrity_vs_commands`), và code deny-list khi bind.
