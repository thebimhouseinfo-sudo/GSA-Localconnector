# Workspace làm việc và thư mục tham khảo

[CRITERIA.md](../CRITERIA.md) là chuẩn sản phẩm. Connector cung cấp nơi làm việc và công cụ theo mô hình GitHub offline, không quản lý gate phê duyệt công việc.

Người dùng chọn plugin Windows hoặc Mac và cung cấp đường dẫn tuyệt đối. Mỗi máy quản lý phạm vi riêng. Không suy ra thư mục cha, thư mục bên cạnh, quyền trên máy còn lại; không yêu cầu tạo Job local hay đăng ký Terminal trước luồng sử dụng bình thường.

- **Workspace làm việc:** đọc, tìm kiếm, tạo, ghi, sửa, xóa, Git, chạy lệnh, tiến trình và build/test; không xin mở khóa đọc/ghi/thực thi riêng.
- **Thư mục tham khảo được cấp:** chỉ đọc/tìm kiếm để đối chiếu thiết kế hoặc knowledge; không ghi, sửa, xóa, chạy lệnh hay build/test tại đó.
- **Dữ liệu chưa được giao:** không truy cập; không tự nâng thư mục tham khảo thành workspace.

Ví dụ, GSA đọc knowledge ở B để sửa/build/test dự án A. Có thể sao chép nội dung từ B vào A; không di chuyển khỏi B vì việc đó xóa dữ liệu nguồn. Di chuyển giữa hai workspace làm việc được phép trong phạm vi đã giao. Công cụ trực tiếp, lệnh và tiến trình con đều tuân thủ ranh giới; cwd, symlink và script không được dùng để vượt quyền.

Xác thực, kiểm tra danh tính thư mục, xung đột nội dung và thu hồi phạm vi là bảo vệ dữ liệu, không phải gate phê duyệt từng thao tác.

## Runtime hiện có — khoảng thiếu so với criteria

Source hiện tại trong `src/mcp/server.ts` có `bind_workspaces({paths:[...]})`, kiểm tra đường dẫn tuyệt đối và dùng `enrollReadOnlyBatch`. Bind hiện còn chỉ đọc; thực thi còn phụ thuộc runtime/proof cũ. Đây là khoảng thiếu, không phải thiết kế quyền cuối cùng.

`src/local/workspace-cli.ts` có `list`, `enroll-read`, `enroll-execute`, `revoke`: các lệnh quản trị triển khai cũ, không phải bước bắt buộc trong luồng mục tiêu. Chúng chưa chứng minh runtime phân biệt workspace/tham khảo đúng criteria. Không bịa API hoặc tham số đăng ký tham khảo chưa được xác minh.

Xem [protected state](../security/PROTECTED-STATE-PLATFORMS.md) và [source status](../STATUS.md) cho giới hạn nền tảng/revision. Nếu bảo trì runtime cũ cần nạp lại grant, chỉ restart đúng connector/tunnel; không tác động GPTWorker hoặc máy còn lại. Tài liệu không tự cho phép đăng ký, thu hồi hay nâng quyền.

## Kiểm chứng khi triển khai

Kiểm tra luồng plugin → giao workspace/tham khảo → đọc tham khảo → sửa/chạy trong workspace → lấy kết quả, không gate nội bộ. Từ công cụ trực tiếp và tiến trình con: workspace đọc/ghi/thực thi được; tham khảo đọc được nhưng ghi/xóa/thực thi bị từ chối; dữ liệu chưa giao không đọc được. Thu hồi/thay thế thư mục không để quyền cũ tồn tại. Dùng fixture trong phạm vi test được giao.
