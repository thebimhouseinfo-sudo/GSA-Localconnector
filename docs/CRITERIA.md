# Criteria — Logic hoạt động người dùng đã chốt

Tài liệu này mô tả hệ thống người dùng muốn có và cách nó phải hoạt động. Người dùng đã xác nhận mô hình: GSA-Localconnector là một bản GitHub offline, cung cấp nơi làm việc và công cụ làm việc. Connector không có gate phê duyệt công việc; giới hạn an toàn bảo vệ dữ liệu và tài nguyên ngoài phạm vi được giao. Ngoài workspace làm việc, người dùng có thể cấp thêm các thư mục tham khảo chỉ đọc; quyền ghi và thực thi chỉ có trong workspace. Đây là yêu cầu sản phẩm đã chốt; tài liệu không khẳng định phần mềm hiện tại đã đáp ứng.

Mọi kiến trúc, API, cơ chế bảo mật, kế hoạch và milestone phải phục vụ logic dưới đây. Khi giải pháp chưa đáp ứng, cần sửa giải pháp hoặc báo phần chưa đáp ứng để người dùng quyết định. Không điều chỉnh mong muốn của người dùng chỉ để khớp với phần mềm đang có. Các lựa chọn kỹ thuật và cách kiểm chứng được ghi trong [implementation plan](plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md).

## 1. GSA làm việc trực tiếp với dự án trên máy người dùng

GSA-Localconnector là nơi làm việc local của GSA theo mô hình GitHub offline: cung cấp workspace, file, công cụ thao tác và môi trường chạy, build, test ngay trên máy Windows hoặc Mac của người dùng. Dự án có thể là một thư mục bình thường, không cần là Git repository và không phải đưa lên GitHub mới làm được việc.

GSA vẫn là bên suy nghĩ, lập kế hoạch, điều phối công việc, đánh giá kết quả và trao đổi với người dùng. Localconnector cung cấp khả năng thao tác trên máy đã chọn và trả kết quả thực tế cho GSA. Việc gọi connector không tạo thêm một agent, một hệ thống Job hay một vòng đời quản lý dự án riêng ở máy local.

Những công việc thuộc GitHub vẫn được GSA thực hiện qua kết nối GitHub. Bộ nhớ dự án của GSA vẫn ở nơi đã được cấu hình online. Người dùng có thể làm dự án chỉ ở local hoặc kết hợp local với GitHub mà không bị buộc chuyển toàn bộ cách quản lý dự án.

## 2. Người dùng chọn máy bằng plugin

Windows và Mac là hai máy làm việc độc lập, mỗi máy có plugin và kết nối riêng. Người dùng có thể để cả hai cùng hoạt động và làm những dự án khác nhau vào cùng thời điểm. GSA chọn đúng plugin của máy chứa dự án; đường dẫn giống nhau trên hai máy không có nghĩa là cùng một dự án hay cùng quyền truy cập.

Việc khởi động, cấp quyền, mất kết nối hoặc sửa chữa một máy không được tự làm thay đổi máy còn lại. Trên mỗi máy chỉ có một phiên điều khiển GSA có thẩm quyền tại một thời điểm, tránh hai bên cùng tranh quyền thực hiện thao tác. Hệ thống không tự chuyển công việc sang máy khác khi máy đang dùng gặp sự cố.

## 3. Bắt đầu bằng plugin và thư mục muốn giao

Trong luồng sử dụng bình thường, người dùng gọi plugin của máy đã chọn và cung cấp một hoặc nhiều đường dẫn tuyệt đối đến các thư mục muốn GSA làm việc. Connector kiểm tra những thư mục đó trên đúng máy, ghi nhận phạm vi được giao và cho GSA sử dụng chúng ngay trong phiên. Người dùng không phải tạo một Job local hay mở Terminal để đăng ký từng thư mục trước mỗi lần làm việc.

Ví dụ, người dùng chọn plugin Mac và giao hai thư mục dự án. GSA có thể đọc cả hai, hiểu quan hệ giữa chúng và tiếp tục công việc trong từng phạm vi. Hệ thống không tự lấy thêm thư mục cha, thư mục bên cạnh hoặc toàn bộ ổ đĩa. Thư mục không tồn tại hay không truy cập được phải được báo rõ.

Khi người dùng giao một workspace, GSA được sử dụng đầy đủ các công cụ làm việc trong workspace đó: đọc, ghi, tạo, sửa, xóa, chạy lệnh, Git và build/test. Không có bước xin cấp thêm quyền đọc, ghi hoặc thực thi, không có gate phê duyệt riêng cho từng loại thao tác hay từng lần gọi. Ranh giới cần bảo vệ là bên ngoài các workspace đã giao; nội dung dự án không được tự mở rộng ranh giới đó.

Người dùng cũng có thể giao thêm thư mục chỉ đọc để tham khảo chéo thiết kế, mã nguồn hoặc knowledge. Thư mục tham khảo được phân biệt rõ với workspace làm việc: GSA có thể duyệt, tìm kiếm, đọc và đối chiếu nội dung nhưng không được ghi, sửa, xóa hoặc thực thi tại đó. Việc cấp quyền đọc không tự biến thư mục thành workspace. Không tự lấy thêm thư mục tham khảo ngoài những nơi người dùng đã cấp.

Ví dụ, GSA làm việc trong dự án A và đọc thiết kế ở thư mục B. GSA có thể dùng thông tin ở B để sửa hoặc kiểm tra A; mọi thay đổi và tác vụ thực thi nằm trong A, còn B giữ nguyên. Lệnh chạy từ A và tiến trình con cũng phải tuân thủ quyền chỉ đọc của B; không được dùng việc đổi thư mục chạy hay gọi script để vượt quyền.

## 4. GSA có thể làm trọn công việc trong phạm vi được giao

Trong workspace đã giao, GSA phải có thể duyệt và tìm mã nguồn, đọc nội dung hoặc thông tin file, tạo và chỉnh sửa file, áp dụng bản vá, sao chép, di chuyển và xóa mà không qua gate của connector. Việc sửa phải dựa trên nội dung thực tế, phát hiện khi file đã thay đổi và bảo vệ công việc người dùng đang làm. Xóa thông thường ưu tiên khả năng khôi phục; không biến cách xóa thành một gate quyền riêng bên trong workspace.

GSA cũng phải có thể chạy lệnh, khởi động và theo dõi tiến trình, lấy đầu ra và dừng công việc của mình. Với thư mục có Git, GSA dùng được các thao tác Git cần thiết theo công việc đang thực hiện, không qua gate riêng của connector. Thư mục không có Git vẫn dùng được các chức năng file và kiểm tra local; chỉ phần Git cần báo không áp dụng.

Nhiều thư mục hoặc công việc có thể được thao tác đồng thời nhưng phải tách biệt. Thao tác trên thư mục này không làm đổi ngữ cảnh hay tác động nhầm thư mục khác. Sao chép hoặc di chuyển giữa hai workspace đã giao không cần phê duyệt thêm; cả nơi đi và nơi đến phải nằm trong phạm vi đã giao. Thay đổi file local phải được báo là thay đổi local; commit và đưa lên remote là những hành động khác với sửa file. Connector không tự đặt quy trình phê duyệt Git; chính sách làm việc của GSA hoặc repository được áp dụng ở lớp tương ứng.

## 5. Có thể build và kiểm tra ngay trên local

Người dùng muốn GSA chạy được quy trình build/test trên thư mục local, kể cả thư mục không có Git. Quy trình có thể có nhiều bước, công việc phụ thuộc nhau, chạy đồng thời, giới hạn tài nguyên và thời gian. Khi công cụ và phụ thuộc đã có sẵn, công việc phù hợp phải chạy được offline; nhu cầu tải thêm, truy cập mạng hay dùng bí mật cần được cho phép riêng.

Kết quả phải trả lời được: đã kiểm tra nội dung nào, ở môi trường nào, đã chạy gì, thành công hay thất bại vì sao, và tạo ra những đầu ra nào. Trong lúc chạy, build có thể sinh hoặc sửa file phục vụ chính nó, nhưng không được làm mất khả năng biết phiên bản đầu vào thực sự đã được kiểm tra. Kết quả cũ không được dùng để kết luận cho nội dung mới chưa được chạy.

GSA phải lấy được log và sản phẩm đầu ra cần thiết để đánh giá, tiếp tục công việc hoặc trình cho người dùng. Kết quả một lần chạy chỉ phản ánh lần chạy đó; GSA và người dùng sử dụng kết quả đó để đánh giá công việc. Connector không tự dựng gate chấp nhận, review hay promote kết quả.

## 6. Công việc dài vẫn theo dõi và kiểm soát được

Một lệnh gọi plugin không cần giữ kết nối suốt thời gian build hay chạy tiến trình. Sau khi bắt đầu, GSA phải có thể quay lại hỏi trạng thái, lấy phần log tiếp theo, xem đầu ra hoặc yêu cầu hủy đúng công việc đó.

Hủy, hết thời gian hoặc thu hồi quyền không được dừng nhầm tiến trình khác trên máy. Các công việc chạy đồng thời phải có trạng thái và đầu ra riêng. GSA không được mất quyền kiểm soát chỉ vì một công việc tạo nhiều log hoặc chạy lâu hơn thời gian của một lần gọi kết nối.

## 7. Giới hạn an toàn bảo vệ bên ngoài workspace

Workspace đã giao là nơi GSA được làm việc đầy đủ, không chia thành các tầng quyền đọc, ghi, chỉnh sửa hoặc thực thi cần mở khóa. Giới hạn an toàn áp dụng cho mọi công cụ, lệnh, script và tiến trình con: đọc/ghi/thực thi trong workspace; chỉ đọc ở các thư mục tham khảo được cấp; không truy cập dữ liệu dự án ở nơi chưa được giao. Chỉ có workspace là nơi thực thi công việc. Quyền đọc thư mục tham khảo không cho phép chạy lệnh, build/test hay dùng thư mục đó làm đích ghi đầu ra. Đặt thư mục làm việc đúng chỗ chưa đủ để bảo đảm ranh giới đó.

Mã nguồn dự án không được tự mở quyền đọc phần còn lại của máy, lấy thông tin đăng nhập, sửa cấu hình cấp quyền hoặc thay kết quả kiểm tra đã lưu. Đồng thời, chương trình hợp lệ vẫn phải dùng được toolchain và tài nguyên cần thiết đã được cho phép để hoàn thành công việc.

Khi quyền bị thu hồi, thư mục gốc bị thay thế hoặc hệ thống không còn xác định được phạm vi an toàn, thao tác phải bị chặn hay dừng theo chính sách phù hợp và báo lý do. Nếu triển khai chưa bảo vệ được ranh giới ngoài workspace thì đó là phần chưa đáp ứng yêu cầu sản phẩm, phải sửa thiết kế và báo đúng tình trạng. Không biến hạn chế triển khai thành yêu cầu người dùng phải mở khóa quyền trong workspace. Xác thực đúng kết nối, kiểm tra đường dẫn, phát hiện xung đột nội dung và giới hạn hệ điều hành vẫn có hiệu lực; chúng không phải gate phê duyệt công việc.

## 8. Mất kết nối hoặc khởi động lại không làm sai sự thật

Khi GSA ngắt kết nối, connector lỗi hoặc máy khởi động lại, hệ thống phải giữ đủ thông tin để xác định các công việc trước đó và đối chiếu trạng thái thật khi hoạt động trở lại. Phiên đã hết hạn hay bị thu hồi không được tự lấy lại quyền điều khiển.

Nếu chưa xác định được một thao tác đã hoàn tất hay chưa, phải báo chưa xác định và kiểm tra lại trước khi lặp. Không tự chạy lại một thao tác có thể gây tác động lần thứ hai, không biến công việc bị gián đoạn thành thành công và không sửa kết quả đã kết thúc để che sự cố.

Sau khi người dùng đăng nhập máy, connector phải có thể hoạt động nền mà không cần giữ cửa sổ Terminal. Cần hỗ trợ phục hồi khi ứng dụng lỗi hoặc máy thức dậy, nhưng không hứa máy vẫn tính toán khi đang ngủ hay hoạt động trước khi đăng nhập. Cài đặt, cập nhật, sửa chữa và gỡ bỏ phải giới hạn trong thành phần của connector, bảo vệ dự án cùng các ứng dụng đang có như GPTWorker, CadGPT và RevitGPT.

## 9. Cùng một ý nghĩa sử dụng trên Windows và Mac

Người dùng phải sử dụng được cùng các nhóm khả năng và hiểu được kết quả nhất quán trên hai máy. Cách triển khai bên trong có thể khác theo hệ điều hành, nhưng phải thực hiện đúng hành vi đã chốt và báo rõ giới hạn riêng.

Một backend chạy được chương trình Linux trong máy ảo trên Mac chưa chứng minh chạy được ứng dụng hay SDK của macOS. Một chức năng hoạt động trên Mac cũng chưa chứng minh hoạt động trên Windows. Ưu tiên hoàn thiện Mac trước chỉ là thứ tự triển khai; mục tiêu sản phẩm vẫn gồm cả Windows và Mac.

## 10. Thiết kế được đánh giá bằng trải nghiệm hoạt động này

Một thiết kế đáp ứng khi người dùng có thể chọn đúng máy, phân biệt workspace làm việc với các thư mục tham khảo chỉ đọc, để GSA sử dụng đầy đủ công cụ trong workspace mà không qua gate của connector, theo dõi và kiểm tra kết quả, rồi tiếp tục an toàn sau gián đoạn. Hai máy có thể phục vụ hai dự án độc lập mà không lẫn quyền, dữ liệu hay trạng thái.

Việc có tên công cụ, schema, một cơ chế kỹ thuật hoặc test đơn vị thành công chưa đủ thay thế luồng hoạt động đó. Kế hoạch phải chỉ ra từng phần thiết kế phục vụ mong muốn nào và kiểm chứng trong tình huống thực tế tương ứng. Lỗi hiện tại, tiến độ và giới hạn bằng chứng được ghi trong handoff, plan và báo cáo; chúng không định nghĩa lại mục tiêu sản phẩm.

Nguồn đối chiếu: [quyết định sản phẩm](DECISIONS.md), [implementation plan](plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md) và [tình trạng source](STATUS.md). Hai plugin độc lập và nhận đường dẫn qua plugin thay thế hướng dẫn cũ về một plugin dùng chung hoặc đăng ký bắt buộc bằng Terminal.

Quyết định mới nhất của người dùng trong phiên 2026-10-17 thay thế yêu cầu cũ “bind chỉ đọc rồi cấp quyền ghi/thực thi riêng”. Quy trình phát triển repository không phải chức năng sản phẩm và không được đưa vào luồng sử dụng connector.

Bổ sung đã chốt: thư mục tham khảo bên ngoài workspace có thể được cấp read-only để đối chiếu thiết kế hoặc knowledge; không có quyền ghi hay thực thi tại đó. Toolchain hệ thống phục vụ lệnh trong workspace được mô tả ở thiết kế thực thi; quyền đọc dữ liệu tham khảo không cấp thêm quyền thực thi dự án bên ngoài workspace.
