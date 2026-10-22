# Criteria — Logic hoạt động người dùng đã chốt

## Xác nhận phạm vi ngày 2026-10-18 — ưu tiên khi cách diễn đạt cũ khác nhau

Người dùng yêu cầu cập nhật criteria theo hợp đồng dưới đây. “GitHub offline” mô tả các công cụ local hữu ích cho personal use; không yêu cầu dựng lại GitHub, một hệ thống CI đa hệ điều hành hay một agent local khác. Đây là mục tiêu, không phải tuyên bố phần mềm đã hoàn thành.

GSA-Localconnector cung cấp capability và API để **GSA** gọi qua plugin `gsa-lc-mac` hoặc `gsa-lc` của máy đã chọn. GSA suy nghĩ và điều phối; connector thực hiện thao tác, trả kết quả thật. Người dùng chọn được nhiều thư mục, mỗi thư mục có vai trò rõ ràng:

| Phạm vi | Khả năng bắt buộc |
| --- | --- |
| Workspace | Liệt kê, tìm kiếm, đọc nội dung/metadata; tạo file/thư mục; ghi, sửa, patch; copy, di chuyển, đổi tên, xóa; xem diff; chạy shell, Git, build/test/script. Có copy trong cùng workspace và copy/move giữa các workspace đã giao. Không cần mở khóa thêm từng loại thao tác. |
| Ref | Liệt kê, tìm kiếm, đọc và copy file/thư mục sang workspace. Không tạo, ghi, sửa, xóa, đổi tên, di chuyển nguồn hoặc thực thi trực tiếp trong ref; ref không là đích copy/đầu ra. |
| Lệnh/lần chạy | Chạy trên máy thật với công cụ đã có; trả lệnh/cwd, trạng thái, stdout/stderr, mã thoát, lỗi và file đầu ra; hỗ trợ lấy tiếp log và dừng đúng tiến trình. |
| Theo dõi | API đọc log thao tác/lệnh và diff code, tách theo workspace/lần chạy, không ghi lộ bí mật. Không bắt buộc một giao diện quản lý dự án riêng. |

Bản copy từ ref vào workspace được sửa và chạy bình thường tại workspace. Ref chỉ cần được connector đọc/tìm kiếm/copy; shell không cần và không được cấp quyền chạy trực tiếp từ ref. Quyền hệ điều hành vẫn áp dụng; “full quyền workspace” không phải quyền quản trị hệ thống và không mở rộng sang thư mục ngoài phạm vi. Các ranh giới ở §7 vẫn phải được bảo vệ; không dùng việc thu hẹp personal use để tuyên bố shell không giới hạn là an toàn.

Build/test offline chạy **script/lệnh có sẵn của dự án trên hệ điều hành thật của máy đang kết nối**, kể cả thư mục không có Git. Script dự án có thể tự quản lý nhiều bước/chạy song song. Không cần connector CI/DAG engine riêng, bộ test mọi OS, VM hay môi trường mới. Khi cần đa hệ điều hành, dùng CI GitHub theo yêu cầu dự án và quyền mạng/remote tương ứng. Android/iOS là target của app đang phát triển, không phải host connector mới.

Không phát triển VM mới. VM Linux cũ trên Mac chỉ là tùy chọn khi có bằng chứng chạy đạt phù hợp; build helper hoặc bằng chứng lịch sử không chứng nhận tình trạng hiện tại và không thay thế kiểm thử macOS thật. Hoàn thiện Mac trước, rồi mới Windows; không yêu cầu test nhiều máy đồng thời. Tận dụng thành phần đã có, chỉ bổ sung phần thiếu để hoàn thành luồng GSA qua plugin.

Tài liệu này mô tả hệ thống người dùng muốn có và cách nó phải hoạt động. GSA-Localconnector cung cấp công cụ local và API qua plugin để GSA sử dụng. Connector không có gate phê duyệt công việc; giới hạn an toàn bảo vệ dữ liệu và tài nguyên ngoài phạm vi được giao. Ngoài workspace làm việc, người dùng có thể cấp thêm các thư mục tham khảo chỉ đọc/copy ra workspace; quyền ghi và thực thi chỉ có trong workspace. Đây là yêu cầu sản phẩm đã chốt; tài liệu không khẳng định phần mềm hiện tại đã đáp ứng.

Mọi kiến trúc, API, cơ chế bảo mật, kế hoạch và milestone phải phục vụ logic dưới đây. Khi giải pháp chưa đáp ứng, cần sửa giải pháp hoặc báo phần chưa đáp ứng để người dùng quyết định. Không điều chỉnh mong muốn của người dùng chỉ để khớp với phần mềm đang có. Các lựa chọn kỹ thuật và cách kiểm chứng được ghi trong [implementation plan](plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md).

## 1. GSA làm việc trực tiếp với dự án trên máy người dùng

GSA-Localconnector cung cấp API để GSA thao tác workspace, file, Git, shell và build/test ngay trên máy Windows hoặc Mac của người dùng qua plugin tương ứng. Dự án có thể là một thư mục bình thường, không cần là Git repository và không phải đưa lên GitHub mới làm được việc.

GSA vẫn là bên suy nghĩ, lập kế hoạch, điều phối công việc, đánh giá kết quả và trao đổi với người dùng. Localconnector cung cấp khả năng thao tác trên máy đã chọn và trả kết quả thực tế cho GSA. Việc gọi connector không tạo thêm một agent, một hệ thống Job hay một vòng đời quản lý dự án riêng ở máy local.

Những công việc thuộc GitHub vẫn được GSA thực hiện qua kết nối GitHub. Bộ nhớ dự án của GSA vẫn ở nơi đã được cấu hình online. Người dùng có thể làm dự án chỉ ở local hoặc kết hợp local với GitHub mà không bị buộc chuyển toàn bộ cách quản lý dự án.

## 2. Người dùng chọn máy bằng plugin

Windows và Mac là hai máy làm việc độc lập, mỗi máy có plugin và kết nối riêng. GSA chọn đúng plugin của máy chứa dự án; đường dẫn giống nhau trên hai máy không có nghĩa là cùng một dự án hay cùng quyền truy cập. Mục tiêu là sử dụng cá nhân và kiểm chứng từng máy qua plugin riêng, không yêu cầu một luồng phối hợp hay kiểm thử đồng thời nhiều máy.

Việc khởi động, cấp quyền, mất kết nối hoặc sửa chữa một máy không được tự làm thay đổi máy còn lại. Trên mỗi máy chỉ có một phiên điều khiển GSA có thẩm quyền tại một thời điểm, tránh hai bên cùng tranh quyền thực hiện thao tác. Hệ thống không tự chuyển công việc sang máy khác khi máy đang dùng gặp sự cố.

GSA có thể làm việc độc lập trên nhiều dự án. Trên một máy, các workspace, tiến trình và kết quả của từng dự án phải tách biệt kể cả khi có nhiều công việc cùng hoạt động. Không đưa kiểm thử Mac+Windows đồng thời, hai máy Mac, hai máy Windows hoặc ma trận nhiều máy vào điều kiện nghiệm thu của phạm vi personal use này.

## 3. Bắt đầu bằng plugin và thư mục muốn giao

Trong luồng sử dụng bình thường, người dùng gọi plugin của máy đã chọn và cung cấp một hoặc nhiều đường dẫn tuyệt đối đến các thư mục muốn GSA làm việc. Connector kiểm tra những thư mục đó trên đúng máy, ghi nhận phạm vi được giao và cho GSA sử dụng chúng ngay trong phiên. Người dùng không phải tạo một Job local hay mở Terminal để đăng ký từng thư mục trước mỗi lần làm việc.

Ví dụ, người dùng chọn plugin Mac và giao hai thư mục dự án. GSA có thể đọc cả hai, hiểu quan hệ giữa chúng và tiếp tục công việc trong từng phạm vi. Hệ thống không tự lấy thêm thư mục cha, thư mục bên cạnh hoặc toàn bộ ổ đĩa. Thư mục không tồn tại hay không truy cập được phải được báo rõ.

Khi người dùng giao một workspace, GSA được sử dụng đầy đủ các công cụ làm việc trong workspace đó: duyệt/tìm kiếm/đọc, tạo file/thư mục, ghi/sửa/patch, copy/di chuyển/đổi tên/xóa, diff, shell, Git và build/test. Không có bước xin cấp thêm quyền đọc, ghi hoặc thực thi, không có gate phê duyệt riêng cho từng loại thao tác hay từng lần gọi. Ranh giới cần bảo vệ là bên ngoài các workspace đã giao; nội dung dự án không được tự mở rộng ranh giới đó.

Người dùng cũng có thể giao thêm thư mục chỉ đọc để tham khảo chéo thiết kế, mã nguồn hoặc knowledge. Thư mục tham khảo được phân biệt rõ với workspace làm việc: GSA có thể duyệt, tìm kiếm, đọc, đối chiếu và copy file/thư mục từ ref sang workspace, nhưng không được ghi, sửa, xóa, đổi tên, di chuyển nguồn hoặc thực thi tại ref. Ref không làm đích copy hay đầu ra; bản copy trong workspace được sửa/chạy bình thường. Việc cấp quyền đọc không tự biến thư mục thành workspace. Không tự lấy thêm thư mục tham khảo ngoài những nơi người dùng đã cấp.

Ví dụ, GSA làm việc trong dự án A và đọc thiết kế ở thư mục B. GSA có thể dùng thông tin ở B để sửa hoặc kiểm tra A; mọi thay đổi và tác vụ thực thi nằm trong A, còn B giữ nguyên. Lệnh chạy từ A và tiến trình con cũng phải tuân thủ quyền chỉ đọc của B; không được dùng việc đổi thư mục chạy hay gọi script để vượt quyền.

## 4. GSA có thể làm trọn công việc trong phạm vi được giao

Trong workspace đã giao, GSA phải có thể duyệt và tìm mã nguồn, đọc nội dung hoặc thông tin file, tạo và chỉnh sửa file, áp dụng bản vá, sao chép, di chuyển và xóa mà không qua gate của connector. Việc sửa phải dựa trên nội dung thực tế, phát hiện khi file đã thay đổi và bảo vệ công việc người dùng đang làm. Xóa thông thường ưu tiên khả năng khôi phục; không biến cách xóa thành một gate quyền riêng bên trong workspace.

GSA cũng phải có thể chạy lệnh, khởi động và theo dõi tiến trình, lấy đầu ra và dừng công việc của mình. Với thư mục có Git, GSA dùng được các thao tác Git cần thiết theo công việc đang thực hiện, không qua gate riêng của connector. Thư mục không có Git vẫn dùng được các chức năng file và kiểm tra local; chỉ phần Git cần báo không áp dụng.

Nhiều thư mục hoặc công việc có thể được thao tác đồng thời nhưng phải tách biệt. Thao tác trên thư mục này không làm đổi ngữ cảnh hay tác động nhầm thư mục khác. Sao chép hoặc di chuyển giữa hai workspace đã giao không cần phê duyệt thêm; cả nơi đi và nơi đến phải nằm trong phạm vi đã giao. Thay đổi file local phải được báo là thay đổi local; commit và đưa lên remote là những hành động khác với sửa file. Connector không tự đặt quy trình phê duyệt Git; chính sách làm việc của GSA hoặc repository được áp dụng ở lớp tương ứng.

## 5. Có thể build và kiểm tra ngay trên local

Người dùng muốn GSA chạy lệnh/script build/test có sẵn của dự án trên máy thật, kể cả thư mục không có Git. Script dự án có thể tự quản lý nhiều bước hoặc chạy đồng thời; connector không cần CI/DAG engine riêng. Cần giới hạn thời gian/đầu ra và dừng đúng công việc. Khi công cụ và phụ thuộc đã có sẵn, công việc phù hợp phải chạy được offline; nhu cầu tải thêm, truy cập mạng hay dùng bí mật cần được cho phép riêng.

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

Quyết định mới nhất của người dùng ngày 2026-10-19: toàn bộ chống sleep, kể cả khi tắt màn hình hoặc gập nắp, do công cụ `nosleep` mà người dùng tự cài ngoài connector đảm nhiệm (repo người dùng chọn: https://github.com/tmad4000/nosleep). Connector không thêm cơ chế chống sleep, Keep Awake, assertion nguồn, helper hay thay đổi cấu hình nguồn; không nghiên cứu, cài, điều khiển hoặc kiểm thử công cụ này. Đây không là dependency hay điều kiện nghiệm thu của bộ cài connector. Connector vẫn phải tôn trọng Pause/Quit, Sleep/shutdown thủ công và phục hồi trung thực sau sleep/wake theo §8.

Bộ cài/app lưu cả tunnel ID và khóa runtime một lần trong `.env` ở repo theo lựa chọn người dùng và tự dùng lại khi cấu hình hợp lệ, không bắt nhập lại mỗi lần khởi động. File này phải được Git bỏ qua; không đưa khóa thật vào log, câu lệnh hiển thị hoặc gói phát hành dùng chung. Chỉ đọc biến được cho phép từ file dữ liệu, không thực thi `.env` như shell script. App Mac có biểu tượng Dock dễ phân biệt từ thư viện vector miễn phí phù hợp giấy phép, chạy nền và tự khởi động sau đăng nhập; luồng sử dụng bình thường không mở shell/Terminal. Menu Dock có Pause/Resume và Quit. Đóng cửa sổ chỉ ẩn giao diện; Pause giữ app để có thể Resume; Quit thoát app và dừng đúng thành phần connector sở hữu. Không dừng nhầm công việc hoặc tiến trình của ứng dụng khác.

## 9. Cùng một ý nghĩa sử dụng trên Windows và Mac

Người dùng phải sử dụng được cùng các nhóm khả năng và hiểu được kết quả nhất quán trên hai máy. Cách triển khai bên trong có thể khác theo hệ điều hành, nhưng phải thực hiện đúng hành vi đã chốt và báo rõ giới hạn riêng.

Một backend chạy được chương trình Linux trong máy ảo trên Mac chưa chứng minh chạy được ứng dụng hay SDK của macOS. Một chức năng hoạt động trên Mac cũng chưa chứng minh hoạt động trên Windows. Hoàn thiện và nghiệm thu đầy đủ luồng sử dụng trên Mac trước, rồi mới bắt đầu phát triển Windows; không phát triển hai nền tảng song song. Mục tiêu sản phẩm vẫn gồm cả Windows và Mac, được triển khai và nghiệm thu lần lượt.

## 10. Thiết kế được đánh giá bằng trải nghiệm hoạt động này

Một thiết kế đáp ứng khi người dùng có thể chọn đúng máy, phân biệt workspace làm việc với các thư mục tham khảo chỉ đọc, để GSA sử dụng đầy đủ công cụ trong workspace mà không qua gate của connector, theo dõi và kiểm tra kết quả, rồi tiếp tục an toàn sau gián đoạn. Trên từng máy được nghiệm thu, nhiều dự án phải giữ quyền, dữ liệu, tiến trình và kết quả độc lập. Nghiệm thu qua plugin riêng của từng nền tảng theo thứ tự Mac rồi Windows; không phụ thuộc bài thử hai hay nhiều máy chạy đồng thời.

Việc có tên công cụ, schema, một cơ chế kỹ thuật hoặc test đơn vị thành công chưa đủ thay thế luồng hoạt động đó. Kế hoạch phải chỉ ra từng phần thiết kế phục vụ mong muốn nào và kiểm chứng trong tình huống thực tế tương ứng. Lỗi hiện tại, tiến độ và giới hạn bằng chứng được ghi trong handoff, plan và báo cáo; chúng không định nghĩa lại mục tiêu sản phẩm.

Nguồn đối chiếu: [quyết định sản phẩm](DECISIONS.md), [implementation plan](plans/GSA-LOCALCONNECTOR-IMPLEMENTATION-PLAN.md) và [tình trạng source](STATUS.md). Hai plugin độc lập và nhận đường dẫn qua plugin thay thế hướng dẫn cũ về một plugin dùng chung hoặc đăng ký bắt buộc bằng Terminal.

Quyết định mới nhất của người dùng trong phiên 2026-10-17 thay thế yêu cầu cũ “bind chỉ đọc rồi cấp quyền ghi/thực thi riêng”. Quy trình phát triển repository không phải chức năng sản phẩm và không được đưa vào luồng sử dụng connector.

Bổ sung đã chốt: thư mục tham khảo bên ngoài workspace có thể được cấp read-only để đối chiếu thiết kế hoặc knowledge; không có quyền ghi hay thực thi tại đó. Toolchain hệ thống phục vụ lệnh trong workspace được mô tả ở thiết kế thực thi; quyền đọc dữ liệu tham khảo không cấp thêm quyền thực thi dự án bên ngoài workspace.

Điều chỉnh phạm vi do người dùng chốt khi review kế hoạch: hoàn thiện Mac trước mới phát triển Windows; personal use không cần kiểm thử nhiều máy đồng thời. Điều chỉnh này thay thế yêu cầu nghiệm thu đồng thời hai máy trước đây; không bỏ khả năng làm nhiều dự án độc lập trên cùng một máy.
