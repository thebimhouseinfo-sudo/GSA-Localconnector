# Workspace làm việc và thư mục tham khảo

[CRITERIA.md](../CRITERIA.md) là chuẩn sản phẩm. Connector cung cấp nơi làm việc và công cụ theo mô hình GitHub offline, không quản lý gate phê duyệt công việc.

Người dùng chọn plugin Windows hoặc Mac và cung cấp đường dẫn tuyệt đối. Mỗi máy quản lý phạm vi riêng. Không suy ra thư mục cha, thư mục bên cạnh, quyền trên máy còn lại; không yêu cầu tạo Job local hay đăng ký Terminal trước luồng sử dụng bình thường.

- **Workspace làm việc:** đọc, tìm kiếm, tạo file/thư mục, ghi/sửa/patch, copy, di chuyển, đổi tên, xóa, diff, Git, shell, tiến trình và build/test; không xin mở khóa đọc/ghi/thực thi riêng.
- **Thư mục tham khảo được cấp:** liệt kê, đọc/tìm kiếm và copy sang workspace để sử dụng; không ghi, sửa, xóa, di chuyển nguồn, chạy lệnh hay build/test trực tiếp tại ref.
- **Dữ liệu chưa được giao:** không truy cập; không tự nâng thư mục tham khảo thành workspace.

Ví dụ, GSA đọc knowledge ở B để sửa/build/test dự án A. Có thể sao chép nội dung từ B vào A; không di chuyển khỏi B vì việc đó xóa dữ liệu nguồn. Di chuyển giữa hai workspace làm việc được phép trong phạm vi đã giao. Công cụ trực tiếp, lệnh và tiến trình con đều tuân thủ ranh giới; cwd, symlink và script không được dùng để vượt quyền.

Xác thực, kiểm tra danh tính thư mục, xung đột nội dung và thu hồi phạm vi là bảo vệ dữ liệu, không phải gate phê duyệt từng thao tác.

## Syntax để GSA sử dụng

Người dùng chốt: connector chỉ cung cấp syntax/API và capability; GSA tự lấy cấu hình, điền placeholder và điều phối. Không xây thêm phần tích hợp GSA trong repository này. Mẫu dự kiến là lời gọi của GSA, không phải câu người dùng phải nhập lại:

```text
@gsa-lc-mac workspace({{workspace_paths}}) ref({{ref_paths}})
```

GSA tự điền hai placeholder bằng danh sách đường dẫn local đã cấu hình cho đúng dự án và máy. Không dùng trí nhớ hội thoại để dựng lại đường dẫn, không đoán thư mục, không bắt người dùng đăng ký thủ công mỗi lần. Danh sách được giữ ở dạng dữ liệu có cấu trúc, không nối chuỗi để chạy shell. Đường dẫn có khoảng trắng/dấu phẩy vẫn là một phần tử; URL web không đăng ký được thành root.

GSA sẽ dùng phiên điều khiển và `bind_workspaces` có sẵn, ánh xạ ref thành role API `reference`, rồi đối chiếu kết quả với cấu hình. Wire API connector vẫn là JSON; không thêm parser shell/chat hay kho cấu hình dự án vào connector. Xem [ghi chú ranh giới trách nhiệm](../plans/FUTURE-GSA-INTEGRATION.md). API binding hiện có; phần tự lấy cấu hình/điền template do GSA đảm nhiệm, chưa được triển khai hay kiểm chứng trong thay đổi connector này.

## API source hiện có — binding và giới hạn backend

Source trong `src/mcp/server.ts` nhận dạng mới `bind_workspaces({roots:[{path,role}]})`; `role` là `workspace` hoặc `reference`. GSA dùng dạng này để giao nhiều thư mục với vai trò rõ ràng qua plugin của máy đã chọn. Production yêu cầu `control_token` hiện tại; đây là xác thực phiên điều khiển, không phải phê duyệt công việc.

```json
{"roots":[{"path":"/absolute/project","role":"workspace"},{"path":"/absolute/reference","role":"reference"}],"control_token":"<current-controller-token>"}
```

Mỗi lần chọn 1–16 thư mục có sẵn bằng đường dẫn tuyệt đối, không gửi thêm ID hay trường khác. Dạng cũ `{paths:[...]}` vẫn chỉ đọc, không có role; không tự nâng thành workspace và không làm mất một role đã gán rõ ràng. Bind trả ID, canonical root, role, permissions, revision; list/get cũng trả role. Đường dẫn tương đương giữ cùng ID; chọn lại cùng role/danh tính giữ revision. Cả batch được lưu và áp dụng nguyên khối vào registry đang dùng; lỗi trước khi lưu không xuất bản một phần danh sách.

Role workspace mô tả phạm vi toàn quyền dự kiến, không chứng minh backend đã ghi file/chạy shell/Git được. Đọc `connector_status` để biết khả năng thực tế; các backend còn thiếu vẫn bị chặn. Các phép thử source không thay thế gọi plugin đang cài hoặc kiểm chứng native.

### Workspace reauthorization — P1

`inspect_workspace_recovery(control_token:"...")` reads a diagnostic inventory from the protected grant store, requiring the **current controller lease** because it reveals prior explicitly selected private root names. It reports `ACTIVE`, `STALE`, `REAUTH_REQUIRED`, `REVOKED`, with reasons such as `ROOT_INODE_CHANGED`, `ROOT_DEVICE_CHANGED`, `ROOT_CANONICAL_CHANGED`, `ROOT_NOT_FOUND` and `ROOT_PERMISSION_DENIED`. This inventory never grants authority.

When a user explicitly selects the current absolute root with `bind_workspaces({roots:[{path:"/absolute/root",role:"workspace"}],control_token:"..."})`, its new device/inode can replace an old pin for the **same canonical root and trusted ID**, with revision advanced. If another old root remains stale, binding fails atomically with `WORKSPACE_REAUTH_REQUIRED`. The user can select every required root, or explicitly retire only confirmed stale IDs in the same operation: `bind_workspaces({roots:[...],revoke_stale_ids:["old-id"],control_token:"..."})`. No active or unverifiable grant can be retired this way.

After durable readback, `list_workspaces` and a restart reflect the newly selected workspace. Native write operations remain **blocked** until the signed grant set has been qualified and reinstalled with the **connector owner stopped**. If `fileGrantSyncRequired` is true and `fileGrantSyncAction=STOP_OWNER_AND_APPLY_QUALIFIED_RECOVERY`, follow the reviewed `apply-recovery` flow; do not bypass the signed broker, replace Recovery with BASE, or delete the journal. A successful bind is not proof of available native writes.

### Scoped files: trạng thái đọc và ghi khi thay đổi grants

- `fileBackendAvailable` giữ ý nghĩa cũ: signed native mutation backend, không phải khả năng của tất cả API đọc.
- `fileReadAvailable` và `fileReadOperations` mô tả read API và phạm vi có grant đọc; đọc từng đường dẫn vẫn kiểm tra root identity và không được vượt scope.
- `fileWriteBackendAvailable` và `fileOperations` biểu thị backend ghi native có thể dùng; ghi thực tế vẫn phụ thuộc role, revision, authorization và protected state.
- `fileGrantSyncRequired=true` / `fileGrantSyncState=REQUIRES_SIGNED_REINSTALL` nghĩa là tập grants đã khác chứng thực native. Phải dừng connector owner an toàn, đồng bộ signed installation theo đúng generation rồi restart; không dùng shell để bypass file broker.
- `node scripts/install-mac-scoped-files.mjs rebind-base` chỉ hợp lệ với BASE, không có Recovery journal. Nếu đang dùng Recovery, phải theo qualified `apply-recovery` và bảo toàn journal.
- Khi role trái nhau chồng lấn thật, lỗi phải nêu ID, role và canonical path của cả hai grant; không tự thu hồi grant cũ.
`src/local/workspace-cli.ts` vẫn có `list`, `enroll-read`, `enroll-execute`, `revoke` cho quản trị cũ; đây không phải bước bắt buộc trước mỗi dự án. Các API đăng ký cũ không được làm mất role trên ID đã gán rõ ràng; dùng dạng role để chọn lại phạm vi đó.

Nếu quyền đã được lưu nhưng đọc lại/cập nhật registry không chắc chắn, API trả `RESULT_UNKNOWN`, không tự chạy lại và chặn các thao tác phụ thuộc scope trong dispatcher đó. Dùng status/control để kiểm tra rồi nạp lại dispatcher từ trạng thái đã xác minh; root đổi danh tính vẫn cần được sửa hoặc chọn lại rõ ràng. Lệnh dừng/hủy công việc đang sở hữu giữ nguyên kiểm tra quyền và token.

Xem [protected state](../security/PROTECTED-STATE-PLATFORMS.md) và [source status](../STATUS.md) cho giới hạn nền tảng/revision. Nếu bảo trì runtime cũ cần nạp lại grant, chỉ restart đúng connector/tunnel; không tác động GPTWorker hoặc máy còn lại. Tài liệu không tự cho phép đăng ký, thu hồi hay nâng quyền.

## Kiểm chứng khi triển khai

Kiểm tra luồng plugin → giao workspace/tham khảo → đọc tham khảo → sửa/chạy trong workspace → lấy kết quả, không gate nội bộ. Từ công cụ trực tiếp và tiến trình con: workspace đọc/ghi/thực thi được; tham khảo đọc được nhưng ghi/xóa/thực thi bị từ chối; dữ liệu chưa giao không đọc được. Thu hồi/thay thế thư mục không để quyền cũ tồn tại. Dùng fixture trong phạm vi test được giao.

## Những trường hợp thiết kế phải giải quyết trước triển khai

Phạm vi phải mang vai trò và danh tính gốc rõ ràng, cùng revision có thể thu hồi. Mã dự án, symlink, đường dẫn tương đối và descriptor kế thừa không được tự thay vai trò hoặc mở rộng phạm vi. Quyền toolchain hệ thống không được biến thành quyền đọc mọi dữ liệu cá nhân trên máy.

Binding từ chối chồng lấn trái vai trò (workspace chứa ref hoặc ngược lại), tên khác nhau cùng một canonical root giữ một ID, và không suy ra quyền ghi/thực thi từ ref. Thu hồi và đổi quyền được lưu theo revision; quyền cũ không được dùng để xác nhận lần chạy mới. Ranh giới của lệnh/tiến trình con và các race filesystem ở backend vẫn cần bằng chứng riêng theo [plan](../plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md).

Đọc source/script ở reference để hiểu hoặc sao chép dữ liệu vào workspace được phân biệt với dùng reference làm nơi chạy, build hay sinh output. Việc gọi interpreter từ workspace không được dùng để lách quyền non-execution của reference. Thực thi bản sao đã đưa vào workspace vẫn phải bị giới hạn trong các workspace/tham khảo được cấp và chính sách mạng/bí mật tương ứng.

Người dùng đã xác nhận trong lần review kế hoạch này: được sao chép và sử dụng nội dung tại workspace, không dùng trực tiếp ở ref folder. Vì vậy không đặt yêu cầu cấm mọi thực thi dựa trên nguồn gốc byte sau khi đã sao chép hợp lệ. Bằng chứng cho việc chặn chạy/import/build trực tiếp từ reference vẫn là một hạng mục kiểm chứng cơ chế, không được suy ra chỉ từ read-only/noexec.

Chấp nhận backend cần cả thao tác thành công trong workspace thật và từ chối truy cập ngoài phạm vi. Chạy build trên một bản sao rồi bỏ thay đổi không chứng minh sửa được workspace trên host. Kết quả Linux trong VM không thay thế bằng chứng cho toolchain macOS hoặc Windows.

Xem [criteria traceability](../plans/CRITERIA-TRACEABILITY.md) và [milestone sản phẩm](../MILESTONES.md). Việc viết/sửa kế hoạch không đăng ký thêm root, nâng grant hay chạy native test.
