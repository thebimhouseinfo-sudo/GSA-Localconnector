# Ghi chú tích hợp GSA về sau

Người dùng làm rõ ngày 2026-10-19: **connector chỉ cung cấp syntax/API và capability; phần còn lại GSA tự làm**. Hoàn thiện connector trước; không xây bridge, bộ quản lý cấu hình dự án, bộ tự điền hay thay đổi repo GSA trong phạm vi công việc này. Hiện chưa có integration contract. Ghi chú này chỉ lưu ý định sử dụng, không định nghĩa API mới hoặc chứng nhận luồng tích hợp.

Mẫu dự kiến để GSA gọi plugin:

```text
@gsa-lc-mac workspace({{workspace_paths}}) ref({{ref_paths}})
```

GSA sẽ tự điền placeholder từ cấu hình của đúng dự án và máy/plugin, thay vì AI tự nhớ đường dẫn hay người dùng đăng ký thủ công mỗi lần. Theo mô hình người dùng mô tả, dự án online dùng repo URL; dự án local dùng đường dẫn thư mục đã lưu trong cấu hình dự án. Những danh sách này phải giữ dạng dữ liệu có cấu trúc; không eval chuỗi template hay tách đường dẫn theo dấu phẩy. Ref không được tự nâng thành workspace.

GSA tự xử lý schema cấu hình, điền placeholder, chọn plugin và điều phối ánh xạ cấu hình → tham số API → kết quả binding trên đúng host. Connector chỉ cần bàn giao syntax/schema tool, capability thực tế và kết quả/lỗi rõ ràng; không cần biết hay triển khai schema nội bộ của GSA. Không dựng thêm kho Project/Job local trong connector. Repo `thebimhouseinfo-sudo/GPT-supper-agent` đã được đọc tham khảo để hiểu phân tách Project Memory/configuration; không sửa repo đó và không sao chép cơ chế điều phối vào connector.

`bind_workspaces`, controller và các tool local vẫn là phần connector đang được xây dựng/kiểm chứng. Có tên API hoặc mẫu gọi chưa đủ chứng minh GSA đã tự điền hay gọi chúng đúng. Triển khai template/GSA integration không phải đầu việc của connector.
