/**
 * Hướng dẫn theo vai trò, đối chiếu với giao diện và API KTTT (10/2026).
 * Chỉ tài liệu của vai trò đang đăng nhập mới được dựng vào DOM.
 * Không thêm mật khẩu, khóa API hay dữ liệu cá nhân vào tài liệu này.
 */
export const HELP_GUIDES = {
  "admin": {
    "label": "Quản trị viên",
    "intro": "Tài liệu thao tác dành riêng cho tài khoản Admin: từ quản lý người dùng, ngân hàng câu hỏi, đề thi đến kết quả và cấu hình hệ thống. Các thao tác quản trị được áp dụng theo phạm vi dữ liệu của hệ thống đang đăng nhập.",
    "highlight": "Bạn có thể quản lý dữ liệu của nhiều giáo viên trong cùng phạm vi hệ thống. Kiểm tra kỹ người tạo, mã đề, đơn vị và số bản ghi trước khi sửa hoặc xóa.",
    "links": [
      [
        "users",
        "Hồ sơ người dùng",
        "👥"
      ],
      [
        "accounts",
        "Tài khoản",
        "🔐"
      ],
      [
        "teacher-assignment",
        "Phân công lớp",
        "🏫"
      ],
      [
        "questions",
        "Ngân hàng câu hỏi",
        "📚"
      ],
      [
        "exams",
        "Quản lý đề thi",
        "📋"
      ],
      [
        "exam-editor",
        "Tạo/sửa đề thi",
        "📝"
      ],
      [
        "ranking",
        "Kết quả thi",
        "📊"
      ],
      [
        "settings",
        "Cấu hình",
        "⚙️"
      ]
    ],
    "sections": [
      {
        "id": "admin-start",
        "title": "01. Bắt đầu và kiểm tra tài khoản",
        "summary": "Đăng nhập, nhận diện đúng quyền quản trị và đổi mật khẩu khi cần.",
        "steps": [
          [
            "Đăng nhập",
            "Nhấn Đăng nhập ở đầu thanh menu, nhập tên đăng nhập và mật khẩu được cấp. Chỉ tiếp tục khi đăng nhập thành công và tên tài khoản của bạn xuất hiện ở menu."
          ],
          [
            "Nhận diện quyền",
            "Trong ô thông tin tài khoản ở thanh bên, kiểm tra dòng Quản trị viên (Admin). Nếu không đúng, đăng xuất và đăng nhập lại bằng tài khoản quản trị hợp lệ."
          ],
          [
            "Kiểm tra danh mục",
            "Menu quản trị có QL Người dùng, QL Tài khoản, Phân công giáo viên, QL Câu hỏi, QL Đề thi, QL Tạo/sửa đề thi, QL Kết quả và Cài đặt."
          ],
          [
            "Thông tin cá nhân",
            "Bấm vào thẻ tài khoản để xem thông tin; sử dụng chức năng đổi mật khẩu khi cần. Đăng xuất trước khi bàn giao thiết bị cho người khác."
          ]
        ],
        "note": "Trạng thái Admin phải xuất phát từ tài khoản đã được hệ thống xác thực; không dùng mã xác nhận xóa dữ liệu thay cho mật khẩu đăng nhập."
      },
      {
        "id": "admin-users",
        "title": "02. Quản lý hồ sơ người dùng",
        "summary": "Tra cứu, nhập Excel, bổ sung hồ sơ học sinh và giáo viên.",
        "steps": [
          [
            "Mở QL Người dùng",
            "Xem danh sách hồ sơ; sử dụng ô tìm kiếm và bộ lọc trường/đơn vị, lớp để tìm đúng người. Đối chiếu họ tên, lớp, đơn vị trước khi cập nhật."
          ],
          [
            "Tạo hoặc sửa hồ sơ",
            "Mở biểu mẫu hồ sơ phù hợp và nhập các trường được yêu cầu. Hồ sơ người dùng và tài khoản đăng nhập là hai phần liên quan nhưng không hoàn toàn giống nhau."
          ],
          [
            "Nhập danh sách từ Excel",
            "Sử dụng chức năng nhập Excel trong QL Người dùng. Chọn tệp đúng mẫu, xem bản xem trước, kiểm tra cột họ tên, trường/đơn vị, lớp và xử lý các dòng không hợp lệ trước khi xác nhận."
          ],
          [
            "Tạo tài khoản đồng loạt",
            "Chọn những hồ sơ cần cấp tài khoản, chọn quy tắc tạo tên đăng nhập, mật khẩu khởi tạo, vai trò và trạng thái; kiểm tra bảng xem trước rồi thực hiện. Lưu và gửi thông tin đăng nhập theo kênh phù hợp."
          ]
        ],
        "note": "Không tạo trùng hồ sơ hoặc cấp sai vai trò. Kiểm tra kỹ danh sách được chọn khi thực hiện thao tác hàng loạt."
      },
      {
        "id": "admin-accounts",
        "title": "03. Quản lý tài khoản và quyền truy cập",
        "summary": "Cấp phát, lọc, chỉnh sửa, khóa hoặc kích hoạt tài khoản.",
        "steps": [
          [
            "Vào QL Tài khoản",
            "Tìm kiếm theo tên đăng nhập; lọc theo đối tượng, trường/đơn vị và lớp để xác định đúng tài khoản cần thao tác."
          ],
          [
            "Cấp tài khoản",
            "Liên kết với hồ sơ thích hợp nếu biểu mẫu yêu cầu. Đặt tên đăng nhập không trùng, mật khẩu đủ an toàn, quyền tương ứng và trạng thái kích hoạt."
          ],
          [
            "Chỉnh sửa và kiểm soát truy cập",
            "Kiểm tra vai trò Admin hoặc người dùng, đối tượng thực tế (giáo viên/học sinh), thời hạn và trạng thái hoạt động. Khóa tài khoản không còn được phép sử dụng; khi đổi quyền cần đăng nhập lại để xác minh."
          ],
          [
            "Kiểm tra sau thao tác",
            "Tải lại danh sách, đối chiếu tài khoản vừa tạo/sửa. Thử truy cập bằng tài khoản kiểm tra có đúng vai trò và không thấy các mục ngoài quyền hay không."
          ]
        ],
        "note": "Không chia sẻ mật khẩu quản trị. Hãy ưu tiên cấp đúng quyền tối thiểu thay vì cấp Admin cho mọi người."
      },
      {
        "id": "admin-classes",
        "title": "04. Phân công giáo viên và lớp học",
        "summary": "Quản lý danh sách giáo viên, lớp chủ nhiệm và lớp bộ môn.",
        "steps": [
          [
            "Mở Phân công giáo viên",
            "Chọn đơn vị/trường, nhập từ khóa giáo viên hoặc lớp, lọc theo khối và trạng thái phân công."
          ],
          [
            "Xem theo ba góc độ",
            "Chuyển giữa danh sách giáo viên, danh sách lớp và ma trận phân công để rà soát lớp thiếu giáo viên hoặc bị phân công chưa đúng."
          ],
          [
            "Giao lớp cho giáo viên",
            "Chọn giáo viên, đánh dấu lớp được phụ trách; xác định vai trò chủ nhiệm/bộ môn và môn dạy theo các trường trong biểu mẫu; lưu thay đổi."
          ],
          [
            "Thêm lớp hoặc nhập Excel",
            "Dùng Thêm lớp học mới khi lớp chưa có; có thể nhập phân công từ Excel và xuất Excel để kiểm tra, đối chiếu."
          ],
          [
            "Kiểm tra ràng buộc đề thi",
            "Sau khi phân công, kiểm tra lại lớp được phép áp dụng khi giáo viên tạo đề cho đơn vị. Chỉ sửa khi đã xác minh thông tin với nhà trường."
          ]
        ]
      },
      {
        "id": "admin-questions",
        "title": "05. Quản lý ngân hàng câu hỏi",
        "summary": "Lọc theo giáo viên, loại, bài; thêm thủ công, tạo AI, import Word và xuất dữ liệu.",
        "steps": [
          [
            "Lọc đúng phạm vi",
            "Trong QL Câu hỏi, dùng ô giáo viên (Admin), Chọn bài, các nút loại [4-1], [TF4], [SQ], [TL] và ô tìm kiếm để thu hẹp danh sách."
          ],
          [
            "Thêm hoặc sửa câu hỏi",
            "Nhấn Thêm câu hỏi, chọn loại, bài, mức độ, nội dung, lựa chọn/đáp án theo mẫu tương ứng. Kiểm tra đáp án chính xác trước khi lưu."
          ],
          [
            "Tạo bằng AI",
            "Nhấn Tạo bằng AI, nhập yêu cầu chủ đề và cấu trúc. Đọc lại toàn bộ kiến thức, đáp án, điểm và công thức; AI chỉ hỗ trợ soạn, không thay thế khâu kiểm duyệt."
          ],
          [
            "Import từ Word",
            "Nhấn Import Word, chọn tệp .docx, kiểm tra các câu hỏi và phần chuyển đổi công thức, ảnh, ký hiệu trong bản xem trước; chỉ lưu những câu đúng. Sau khi nhập, tải lại và xem các câu mới."
          ],
          [
            "Xuất và rà soát",
            "Dùng Export Word hoặc Xuất Excel để đối chiếu. Với công thức Toán, Hóa, Vật lý, xem trực tiếp bản hiển thị và xuất Word để phát hiện lỗi ký hiệu."
          ],
          [
            "Xóa có kiểm soát",
            "Xóa đã chọn tác động lên các câu đã tích; Xóa theo bài tác động tới câu của bài đang chọn. Hộp thoại xóa theo bài yêu cầu nhập 123; Admin cần kiểm tra phạm vi tất cả người tạo trước khi xác nhận."
          ]
        ],
        "note": "Mã 123 chỉ dùng để xác nhận hành động xóa theo bài, không thay thế kiểm tra quyền sở hữu và số lượng câu sẽ xóa."
      },
      {
        "id": "admin-editor",
        "title": "06. Tạo đề thi mới và chỉnh sửa cấu hình",
        "summary": "Thiết lập đề, lựa chọn câu hỏi, điểm số, thời gian và cách công bố kết quả.",
        "steps": [
          [
            "Mở QL Tạo/sửa đề thi",
            "Chọn Tạo đề thi mới để bắt đầu cấu hình trống hoặc dùng Nạp từ QL Đề thi để chỉnh sửa đề hiện có. Kiểm tra tên và mã đề đang nạp trước khi lưu."
          ],
          [
            "Thiết lập phạm vi",
            "Nhập tên đề thi, chọn Đề công khai, Đề cho đơn vị hoặc Đề có mã bảo mật. Với đề theo đơn vị, xác định trường và các lớp áp dụng; với đề bảo mật, đặt mã truy cập."
          ],
          [
            "Quy định điều kiện thi",
            "Cấu hình thời lượng, thời gian bắt đầu/kết thúc, số lượt làm tối đa và số lần cảnh báo rời màn hình theo yêu cầu đánh giá."
          ],
          [
            "Lựa chọn cấu trúc",
            "Chọn bài, số câu theo từng dạng [4-1], [TF4], [SQ], [TL] và mức độ. Xác nhận ngân hàng có đủ câu hỏi hợp lệ trước khi lưu."
          ],
          [
            "Đặt thang điểm",
            "Khai báo điểm/câu, phương pháp tính điểm từng ý Đúng/Sai, quy tắc so khớp câu trả lời ngắn, nếu có. Đối chiếu tổng điểm và đáp án."
          ],
          [
            "Chấm AI và công bố kết quả",
            "Tự luận có thể bật chấm tự động bằng AI khi hệ thống đã cấu hình hợp lệ; kiểm duyệt kết quả chấm. Chọn cho phép công bố đúng/sai, điểm hoặc chi tiết bài làm tùy mục đích."
          ],
          [
            "Lưu đề và kiểm tra",
            "Nhấn Lưu cấu hình đề thi. Nếu nhận thông báo có thay đổi từ thiết bị khác, tải lại và đối chiếu thay vì ghi đè; kiểm tra đề trong QL Đề thi sau khi lưu."
          ]
        ],
        "note": "Không tự ý hứa rằng AI luôn chấm chính xác hoặc mọi công thức import Word đều không cần kiểm tra."
      },
      {
        "id": "admin-exams",
        "title": "07. Bảng cấu hình quản lý đề thi",
        "summary": "Tìm kiếm, nạp, xuất và xóa đề; theo dõi số lượt làm.",
        "steps": [
          [
            "Tìm đề",
            "Vào QL Đề thi. Tìm theo tên, mã hoặc lớp; Admin còn có bộ lọc người tạo và trường/đơn vị, bên cạnh bộ lọc lớp."
          ],
          [
            "Đọc bảng",
            "Đối chiếu mã đề, tên đề, người tạo, giờ/ngày tạo theo giờ Việt Nam, chế độ, lớp/trường áp dụng, thời lượng, cấu trúc câu hỏi, tính năng và Số bài đã làm."
          ],
          [
            "Nạp để sửa",
            "Bấm Nạp ở đúng dòng; hệ thống đưa cấu hình sang tab QL Tạo/sửa đề thi. Kiểm tra dữ liệu vừa nạp trước khi điều chỉnh và lưu."
          ],
          [
            "Xuất đề",
            "Bấm Xuất để mở tùy chọn xuất file Word. Kiểm tra nội dung, đáp án, công thức, hình ảnh và bố cục trước khi in, đặc biệt đối với đề có câu tự luận hoặc công thức khoa học."
          ],
          [
            "Xóa kết quả khác xóa đề",
            "Xóa KQ xóa các lượt làm đã lưu của đề đã chọn nhưng giữ cấu hình đề; phải đọc cảnh báo, đối chiếu số bản ghi và nhập 1234. Nút xóa đề xóa cấu hình, có thể bị chặn nếu đề còn kết quả; xử lý đúng thứ tự."
          ]
        ],
        "note": "Mã đề là định danh quan trọng hơn tên đề. Hai đề trùng tên không có nghĩa là cùng một đề."
      },
      {
        "id": "admin-results",
        "title": "08. Quản lý kết quả, báo cáo và xóa bài làm",
        "summary": "Thống kê đa đề, xuất Excel, đánh giá và xử lý dữ liệu theo quyền Admin.",
        "steps": [
          [
            "Mở QL Kết quả",
            "Dùng lọc đề thi, giáo viên, đơn vị, lớp và tìm kiếm học sinh; có thể sắp xếp theo họ tên, điểm, thời gian, câu đúng hoặc các tiêu chí đang hỗ trợ."
          ],
          [
            "Kiểm tra chi tiết",
            "Chọn dòng kết quả để xem các thông tin được phép hiển thị; đối chiếu đề, người làm, thời điểm nộp và cấu hình chấm trước khi kết luận."
          ],
          [
            "Báo cáo và xuất",
            "Nhấn Báo cáo để xem tổng hợp; nhấn Export Excel để xuất dữ liệu phục vụ đối chiếu và lưu trữ theo quy định của đơn vị."
          ],
          [
            "Chỉnh sửa/chấm lại",
            "Nếu sử dụng tính năng điều chỉnh hoặc chấm lại, kiểm tra bản ghi và ghi nhận căn cứ. Kết quả do AI hỗ trợ chấm cần được người có thẩm quyền kiểm tra."
          ],
          [
            "Xóa kết quả theo đề",
            "Chọn chính xác đề trong bộ lọc, nhấn Xóa bài theo đề; đọc số lượng bài sẽ xóa, xác nhận bằng mã 1234. Admin được phép xóa kết quả các đề trong phạm vi hệ thống đang đăng nhập."
          ],
          [
            "Xóa kết quả đã chọn",
            "Chỉ chọn những dòng cần xử lý rồi dùng Xóa đã chọn khi tính năng có sẵn; xác minh phạm vi một lần nữa trước khi xác nhận."
          ]
        ],
        "note": "Xóa kết quả là thao tác ảnh hưởng dữ liệu đã nộp; không thể xem đây là thao tác lọc hoặc ẩn kết quả."
      },
      {
        "id": "admin-settings",
        "title": "09. Cấu hình hệ thống và AI",
        "summary": "Thiết lập hiển thị, prompt và tham số dùng chung khi có quyền.",
        "steps": [
          [
            "Mở Cài đặt",
            "Xem những thiết lập hiện được cung cấp; đối chiếu ảnh hưởng đến học sinh, giáo viên và phần công bố kết quả trước khi lưu."
          ],
          [
            "Cấu hình prompt AI",
            "Các vùng Prompt Sinh Câu Hỏi và Prompt Giám Định cho phép điều chỉnh hướng dẫn AI. Chỉ thay đổi khi có mục đích rõ; dùng Khôi phục gốc nếu cần quay lại mẫu chuẩn."
          ],
          [
            "Kiểm soát quyền xem kết quả",
            "Kiểm tra những tùy chọn hiển thị chi tiết bài làm, kết quả và nút xóa nếu hệ thống cho phép cấu hình. Thử lại bằng tài khoản kiểm thử sau thay đổi."
          ],
          [
            "Xác minh hiệu lực",
            "Sau khi lưu, tải lại trang và kiểm tra trạng thái. Không đặt khóa API hoặc mật khẩu trong nội dung đề, thông báo hay tài liệu hướng dẫn."
          ]
        ]
      },
      {
        "id": "admin-safety",
        "title": "10. Quy trình kiểm tra và xử lý sự cố",
        "summary": "Thao tác an toàn, bảo vệ dữ liệu và kiểm tra sau mỗi thay đổi quan trọng.",
        "steps": [
          [
            "Trước khi cập nhật",
            "Xác định đúng đơn vị, đúng người, đúng mã đề và quyền đang đăng nhập; ưu tiên thử trên dữ liệu kiểm thử khi thay đổi quy trình."
          ],
          [
            "Khi trang không tải",
            "Kiểm tra kết nối Internet và trạng thái đăng nhập, nhấn nút tải lại trong tab; nếu phiên hết hạn, đăng nhập lại. Không thao tác xóa nhiều lần khi chưa rõ kết quả."
          ],
          [
            "Khi công thức sai",
            "Đối chiếu câu gốc, bản xem trước, màn hình làm bài và bản xuất Word; sửa nguồn câu hỏi trước khi phát hành đề."
          ],
          [
            "Khi có xung đột lưu",
            "Không ghi đè cấu hình của phiên khác. Tải lại đề và so sánh thay đổi để quyết định phiên bản cần giữ."
          ],
          [
            "Sau thao tác nhạy cảm",
            "Tải lại danh sách và thống kê để xác nhận số bản ghi hoặc cấu hình đã thay đổi đúng. Đăng xuất khi kết thúc công việc."
          ]
        ]
      }
    ],
    "faqs": [
      [
        "Vì sao tôi thấy nhiều đề thi hơn giáo viên?",
        "Tài khoản Admin được xem và quản lý rộng hơn trong phạm vi hệ thống/đơn vị đang đăng nhập, trong khi giáo viên bị giới hạn theo quyền sở hữu."
      ],
      [
        "Xóa KQ có xóa luôn đề thi không?",
        "Không. Xóa KQ xóa các lượt làm thuộc đúng mã đề đã chọn; cấu hình đề thi vẫn còn."
      ],
      [
        "Vì sao xóa đề thi có thể bị từ chối?",
        "Hệ thống có thể chặn xóa cấu hình khi đã có bài làm; trước hết cần rà soát và xử lý kết quả đúng quyền, đúng mã đề."
      ],
      [
        "Mã 123 và 1234 là mật khẩu quản trị?",
        "Không. Chúng chỉ là mã xác nhận cho một số hành động xóa nguy hiểm; quyền thao tác vẫn được kiểm tra từ phiên đăng nhập."
      ],
      [
        "Số bài đã làm được đếm như thế nào?",
        "Đó là số lượt nộp bài có kết quả lưu của đúng mã đề; cùng một học sinh làm lại nhiều lần có thể tạo nhiều lượt."
      ]
    ]
  },
  "teacher": {
    "label": "Giáo viên",
    "intro": "Hướng dẫn dành riêng cho giáo viên: soạn ngân hàng câu hỏi, cấu hình đề kiểm tra, quản lý đề mình tạo, xem và xuất kết quả học sinh theo phạm vi được cấp.",
    "highlight": "Bạn được thao tác với câu hỏi và cấu hình đề thi do mình tạo. Không chỉnh sửa hoặc xóa dữ liệu thuộc giáo viên khác nếu hệ thống không cấp quyền.",
    "links": [
      [
        "questions",
        "Ngân hàng câu hỏi",
        "📚"
      ],
      [
        "exam-editor",
        "Tạo/sửa đề thi",
        "📝"
      ],
      [
        "exams",
        "Quản lý đề thi",
        "📋"
      ],
      [
        "ranking",
        "Kết quả thi",
        "📊"
      ],
      [
        "users",
        "Danh sách người dùng",
        "👥"
      ]
    ],
    "sections": [
      {
        "id": "teacher-start",
        "title": "01. Đăng nhập và chuẩn bị kiểm tra",
        "summary": "Kiểm tra đúng tài khoản, đơn vị và lớp được phân công.",
        "steps": [
          [
            "Đăng nhập",
            "Nhấn Đăng nhập, nhập tên đăng nhập và mật khẩu cá nhân. Sau khi vào hệ thống, thanh bên hiển thị tên và vai trò Giáo viên."
          ],
          [
            "Kiểm tra thông tin",
            "Bấm thẻ tài khoản để xem họ tên, trường/đơn vị, lớp và thông tin liên quan. Liên hệ quản trị viên nếu dữ liệu chưa đúng."
          ],
          [
            "Làm quen menu",
            "Giáo viên dùng QL Câu hỏi, QL Đề thi, QL Tạo/sửa đề thi, QL Kết quả và QL Người dùng ở phạm vi được phép."
          ],
          [
            "Bảo vệ tài khoản",
            "Đổi mật khẩu khi cần; đăng xuất khi dùng máy tính chung. Không giao thông tin đăng nhập cho học sinh."
          ]
        ]
      },
      {
        "id": "teacher-users",
        "title": "02. Xem danh sách học sinh và lớp",
        "summary": "Tra cứu hồ sơ thuộc đơn vị được phép để kiểm tra thông tin dự thi.",
        "steps": [
          [
            "Mở QL Người dùng",
            "Sử dụng danh sách, tìm kiếm và bộ lọc trường/đơn vị, lớp để tìm học sinh hoặc giáo viên."
          ],
          [
            "Đối chiếu thông tin",
            "Kiểm tra họ tên, lớp, đơn vị của học sinh; thông báo cho Admin nếu có hồ sơ thiếu, sai hoặc trùng."
          ],
          [
            "Giới hạn quyền",
            "Giáo viên có thể xem danh sách hồ sơ được hệ thống cấp; việc thêm/sửa/xóa hồ sơ hoặc cấp tài khoản do Admin thực hiện."
          ]
        ],
        "note": "Không nhầm quyền xem danh sách với quyền quản trị tài khoản."
      },
      {
        "id": "teacher-questions",
        "title": "03. Tạo và quản lý câu hỏi của mình",
        "summary": "Bốn dạng câu hỏi, tìm kiếm theo bài và nhập xuất Word.",
        "steps": [
          [
            "Lọc và xem câu hỏi",
            "Vào QL Câu hỏi; chọn bài, loại câu hỏi và ô tìm kiếm. Danh sách của giáo viên được giới hạn theo người tạo; số liệu tổng phụ thuộc bộ lọc."
          ],
          [
            "Thêm câu hỏi thủ công",
            "Nhấn Thêm câu hỏi, chọn bài/mức độ/loại [4-1], [TF4], [SQ] hoặc [TL]; nhập nội dung, phương án, đáp án và lưu."
          ],
          [
            "Tạo câu hỏi bằng AI",
            "Chọn Tạo bằng AI, nhập yêu cầu, xem lại nội dung, đáp án và độ khó; chỉ thêm vào ngân hàng sau khi đã kiểm duyệt."
          ],
          [
            "Import Word",
            "Nhấn Import Word, chọn tệp .docx và xem trước kết quả nhận diện. Kiểm tra công thức, ảnh, đáp án và cấu trúc câu; sửa câu không đạt trước khi xác nhận nhập."
          ],
          [
            "Xuất và tìm câu mới",
            "Dùng Export Word hoặc Xuất Excel khi cần; danh sách được tải lại sau khi thêm/nhập và thường ưu tiên câu mới để dễ đối chiếu."
          ],
          [
            "Sửa hoặc xóa",
            "Chọn đúng câu để sửa/xóa; Xóa đã chọn chỉ tác động lên các câu đã tích. Xóa theo bài yêu cầu chọn chính xác bài, xem số lượng, nhập mã 123 và xác nhận."
          ]
        ],
        "note": "Giáo viên chỉ có quyền xóa câu hỏi do chính tài khoản của mình tạo; mã 123 không mở rộng quyền."
      },
      {
        "id": "teacher-editor",
        "title": "04. Tạo đề thi mới",
        "summary": "Chọn nguồn câu hỏi và cấu hình một đề kiểm tra hợp lệ.",
        "steps": [
          [
            "Mở tab Tạo/sửa",
            "Vào QL Tạo/sửa đề thi rồi chọn Tạo đề thi mới; điền tên rõ ràng để sau này dễ quản lý."
          ],
          [
            "Chọn chế độ",
            "Chọn Đề công khai, Đề cho đơn vị hoặc Đề có mã bảo mật. Nếu đề cho đơn vị, kiểm tra đúng trường và các lớp đã được phân công; không chọn lớp ngoài quyền."
          ],
          [
            "Thiết lập thời gian",
            "Nhập thời lượng, thời gian mở/đóng đề nếu cần, số lượt làm tối đa và giới hạn cảnh báo rời màn hình."
          ],
          [
            "Chọn bài và dạng câu",
            "Chọn bài trong ngân hàng; định lượng câu [4-1], [TF4], [SQ], [TL] và mức độ. Nếu thấy cảnh báo không đủ câu, kiểm tra bộ lọc bài và dữ liệu đã tạo."
          ],
          [
            "Thiết lập chấm điểm",
            "Khai báo điểm từng loại; với Đúng/Sai chọn mức điểm theo số ý đúng, với trả lời ngắn xem tùy chọn so khớp ký tự và dấu. Tự kiểm tra tổng điểm."
          ],
          [
            "Tùy chọn kết quả",
            "Chọn công bố đáp án đúng/sai, hiển thị điểm và cho xem chi tiết bài làm sau nộp. Nếu bật chấm tự luận bằng AI, cần cấu hình phù hợp và kiểm duyệt."
          ],
          [
            "Lưu và thử đề",
            "Nhấn Lưu cấu hình đề thi, kiểm tra thông báo thành công. Đối chiếu lại nội dung và chế độ trong QL Đề thi trước khi giao học sinh làm."
          ]
        ],
        "note": "Không nên phát hành đề khi chưa kiểm tra thực tế ít nhất một bộ câu hỏi, cách tính điểm và công thức."
      },
      {
        "id": "teacher-manage",
        "title": "05. Quản lý đề đã tạo và sửa đề",
        "summary": "Nạp lại, điều chỉnh, xuất Word và đọc thống kê lượt làm.",
        "steps": [
          [
            "Mở QL Đề thi",
            "Tìm đề qua tên/mã, bộ lọc lớp và danh sách đang hiển thị; theo dõi thời gian tạo, cấu trúc, chế độ, số bài đã làm."
          ],
          [
            "Nạp đề",
            "Bấm Nạp tại dòng đề muốn sửa. Hệ thống chuyển dữ liệu vào QL Tạo/sửa đề thi; xác nhận đúng mã đề trước khi thay đổi."
          ],
          [
            "Chỉnh sửa và lưu",
            "Sửa nội dung/cấu hình cần thiết, nhấn Lưu. Nếu hệ thống báo xung đột do người khác sửa cùng lúc, tải lại và đối chiếu; không ghi đè mù."
          ],
          [
            "Xuất tài liệu",
            "Bấm Xuất để xuất đề thi Word; kiểm tra đáp án, bố cục, công thức và hình trước khi in. Việc xuất đề không đồng nghĩa đã cấp quyền làm bài."
          ],
          [
            "Xóa đề của mình",
            "Chỉ xóa đề do mình tạo theo quyền hệ thống. Xem kỹ cảnh báo và số bài đã làm; nếu bị chặn vì còn kết quả, cần xử lý kết quả đúng quy trình trước."
          ]
        ],
        "note": "Đề do người khác tạo hoặc chia sẻ có thể chỉ được xem/sử dụng theo quyền; không mặc nhiên được sửa hoặc xóa."
      },
      {
        "id": "teacher-results",
        "title": "06. Theo dõi kết quả học sinh",
        "summary": "Lọc theo đề, đơn vị, lớp, xem báo cáo, xuất Excel.",
        "steps": [
          [
            "Mở QL Kết quả",
            "Chọn đề thi, đơn vị hoặc Tất cả đơn vị, lớp và từ khóa tìm kiếm; danh sách được giới hạn theo đề thuộc phạm vi bạn được xem."
          ],
          [
            "Đọc bảng xếp hạng",
            "Kiểm tra tên học sinh, lớp, đề, điểm, số câu đúng, thời lượng làm và thông tin chấm (nếu được hiển thị). Đổi tiêu chí sắp xếp theo nhu cầu."
          ],
          [
            "Xem chi tiết/chấm lại",
            "Mở bài làm cụ thể để xem thông tin được phép; nếu đề có câu tự luận hoặc AI hỗ trợ chấm, cần đối chiếu đáp án và hướng dẫn chấm trước khi điều chỉnh."
          ],
          [
            "Tổng hợp kết quả",
            "Dùng Báo cáo để xem thống kê theo đề và Export Excel để lưu, lọc và xử lý theo quy định của nhà trường."
          ],
          [
            "Chia sẻ kết quả khi được phép",
            "Nếu đề đã bật Chia sẻ kết quả, có thể dùng mã xem điểm/ID đề theo thiết lập. Không coi đây là quyền xem mọi kết quả của các giáo viên khác."
          ]
        ],
        "note": "Phạm vi xem kết quả do quyền đề thi và xác thực ở máy chủ quyết định; việc chọn Tất cả đơn vị không mở rộng quyền sở hữu."
      },
      {
        "id": "teacher-delete",
        "title": "07. Xóa kết quả bài làm của đề mình tạo",
        "summary": "Phân biệt xóa lượt làm với xóa cấu hình đề thi.",
        "steps": [
          [
            "Từ QL Kết quả",
            "Lọc chọn đúng đề, bấm Xóa bài theo đề, đọc thông báo số kết quả sẽ xóa và mã đề đích."
          ],
          [
            "Từ QL Đề thi",
            "Tại dòng đề do bạn tạo, có nút Xóa KQ. Nút này xóa kết quả học sinh của đề được chọn, không xóa cấu hình đề."
          ],
          [
            "Xác nhận",
            "Đối chiếu số bài và mã đề, nhập chính xác 1234 rồi xác nhận. Chỉ thực hiện khi đã có căn cứ và thực sự cần thiết."
          ],
          [
            "Kiểm tra kết quả",
            "Tải lại thống kê Số bài đã làm và danh sách QL Kết quả để đảm bảo đúng đề được xử lý."
          ],
          [
            "Giới hạn quyền",
            "Nếu đề do giáo viên khác tạo, máy chủ sẽ từ chối xóa kết quả dù biết mã 1234."
          ]
        ],
        "note": "Xóa kết quả có thể không khôi phục được từ giao diện. Nên xuất dữ liệu cần lưu trữ trước khi thực hiện."
      },
      {
        "id": "teacher-troubleshoot",
        "title": "08. Xử lý lỗi và bảo đảm chất lượng",
        "summary": "Cách xử lý thiếu câu hỏi, sai công thức và lỗi đồng bộ.",
        "steps": [
          [
            "Không thấy câu hỏi",
            "Kiểm tra bộ lọc bài, loại câu và tài khoản người tạo; tải lại ngân hàng. Giáo viên không thấy câu hỏi của tài khoản khác chỉ vì biết tên đề."
          ],
          [
            "Không đủ câu để ra đề",
            "Kiểm tra số lượng theo loại và bài, bổ sung hoặc điều chỉnh cấu trúc thay vì lưu cấu hình thiếu dữ liệu."
          ],
          [
            "Lỗi công thức",
            "Mở câu trong ngân hàng, kiểm tra cú pháp và bản xem trước, sau đó xuất Word thử; không phát hành nếu câu chưa hiển thị đúng."
          ],
          [
            "Không thấy kết quả",
            "Xác nhận học sinh đã nộp bài, chọn đúng đề/đơn vị/lớp và tải lại; nếu vẫn thiếu, liên hệ Admin để kiểm tra dữ liệu."
          ],
          [
            "Kết thúc phiên",
            "Đăng xuất khi sử dụng máy chung. Không gửi mật khẩu, khóa AI hay bảng điểm học sinh lên kênh công khai."
          ]
        ]
      }
    ],
    "faqs": [
      [
        "Vì sao không thấy câu hỏi/đề của giáo viên khác?",
        "Ngân hàng câu hỏi và quyền sửa đề được ràng buộc với người tạo. Admin là người kiểm tra dữ liệu và quyền khi cần."
      ],
      [
        "Chọn Tất cả đơn vị có được xem toàn bộ điểm không?",
        "Không. Tùy chọn này chỉ thay đổi bộ lọc trên những kết quả mà tài khoản giáo viên có quyền truy cập."
      ],
      [
        "Tôi đã nhập Word nhưng công thức bị sai thì sao?",
        "Kiểm tra bản xem trước và câu đã lưu; sửa cú pháp hoặc nhập lại câu chưa đạt. Luôn kiểm thử công thức trên đề trước khi tổ chức thi."
      ],
      [
        "Có thể xóa kết quả đề do giáo viên khác tạo không?",
        "Không. Giáo viên chỉ được xóa kết quả của đề do mình tạo; Admin có phạm vi quản trị rộng hơn."
      ],
      [
        "Khi nào học sinh xem được điểm hoặc chi tiết?",
        "Phụ thuộc tùy chọn hiển thị kết quả trong cấu hình của chính đề thi đó."
      ]
    ]
  },
  "student": {
    "label": "Học sinh",
    "intro": "Hướng dẫn từng bước từ đăng nhập, chọn đề, làm bài, nộp bài đến kiểm tra lịch sử kết quả của chính mình. Mỗi đề có quy định riêng về thời gian, số lượt làm và công bố điểm.",
    "highlight": "Chỉ sử dụng tài khoản của chính mình. Kiểm tra tên, lớp, trường và đề thi trước khi bắt đầu; không đóng trang hoặc chuyển tab khi đang làm bài.",
    "links": [
      [
        "exam",
        "Làm bài thi",
        "📝"
      ],
      [
        "ranking",
        "Kết quả của tôi",
        "📊"
      ]
    ],
    "sections": [
      {
        "id": "student-login",
        "title": "01. Đăng nhập và kiểm tra thông tin",
        "summary": "Sử dụng tài khoản được cấp và xác minh đúng hồ sơ.",
        "steps": [
          [
            "Vào hệ thống",
            "Mở HỆ THỐNG KIỂM TRA TRỰC TUYẾN trên trình duyệt, nhấn Đăng nhập và điền tên đăng nhập, mật khẩu do nhà trường cấp."
          ],
          [
            "Kiểm tra tài khoản",
            "Sau khi đăng nhập, xem tên của mình ở thanh bên. Bấm thẻ tài khoản để đối chiếu họ tên, lớp và trường/đơn vị."
          ],
          [
            "Kiểm tra ô thông tin dự thi",
            "Trong tab Làm bài, họ tên, lớp hoặc đơn vị có thể được điền sẵn và khóa sửa khi đã gắn với tài khoản. Nếu có sai sót, báo giáo viên thay vì làm bài bằng thông tin của người khác."
          ],
          [
            "Nếu đăng nhập lỗi",
            "Kiểm tra chữ hoa/chữ thường, mật khẩu và kết nối mạng. Nếu tài khoản bị khóa/hết hạn hoặc sai hồ sơ, liên hệ giáo viên hay quản trị viên."
          ]
        ]
      },
      {
        "id": "student-choose",
        "title": "02. Chọn đúng giáo viên và đề thi",
        "summary": "Xác định bộ câu hỏi, điều kiện truy cập và số lượt được phép làm.",
        "steps": [
          [
            "Mở Làm bài",
            "Chọn mục Làm bài thi ở thanh menu. Nếu đang ở phần khác, chuyển về đây trước khi chọn đề."
          ],
          [
            "Chọn giáo viên",
            "Ở ô Chọn tên giáo viên, tìm giáo viên ra đề. Danh sách đề/bộ câu hỏi tương ứng sẽ được cập nhật."
          ],
          [
            "Chọn đề",
            "Trong ô Chọn bộ câu hỏi hoặc đề thi, chọn đúng tên được giáo viên thông báo. Kiểm tra mô tả số câu, thời gian và lượt thi còn lại nếu có hiển thị."
          ],
          [
            "Kiểm tra điều kiện",
            "Đề cho đơn vị/lớp chỉ mở với đối tượng phù hợp; đề có mã bảo mật cần nhập mã do giáo viên cung cấp; đề có thời gian mở/đóng sẽ không truy cập ngoài khoảng cho phép."
          ],
          [
            "Trước khi bắt đầu",
            "Đảm bảo mạng ổn định, thiết bị đủ pin, sử dụng trình duyệt cập nhật và đọc kỹ quy định của giáo viên."
          ]
        ],
        "note": "Nếu không tìm thấy đề, kiểm tra đúng giáo viên, lớp, trường, thời gian mở đề và hỏi lại giáo viên; không tự sử dụng tài khoản khác."
      },
      {
        "id": "student-start",
        "title": "03. Bắt đầu và tuân thủ quy định giám sát",
        "summary": "Nhận diện đồng hồ, chế độ toàn màn hình và các cảnh báo.",
        "steps": [
          [
            "Nhấn Bắt đầu làm bài",
            "Chỉ bắt đầu sau khi đã chọn đúng đề và sẵn sàng làm liên tục. Một số đề yêu cầu mở ở chế độ toàn màn hình trước khi vào bài."
          ],
          [
            "Theo dõi thời gian",
            "Đồng hồ trên giao diện cho biết thời gian còn lại hoặc thời gian làm bài; hoàn thành trước hạn mà đề quy định."
          ],
          [
            "Không rời màn hình tùy tiện",
            "Việc thoát toàn màn hình, chuyển tab hoặc rời giao diện có thể bị ghi nhận theo cài đặt giám sát. Vượt giới hạn cảnh báo có thể ảnh hưởng phiên thi."
          ],
          [
            "Không chuyển sang tab khác khi đang thi",
            "Hệ thống cảnh báo chuyển tab có thể hủy bài làm đang diễn ra. Chỉ chuyển sau khi đã nộp xong và được phép."
          ]
        ],
        "note": "Không dựa vào giả định bài làm luôn tự động lưu từng 30 giây. Khi mạng gặp sự cố, báo giáo viên và làm theo hướng dẫn của kỳ kiểm tra."
      },
      {
        "id": "student-types",
        "title": "04. Trả lời bốn dạng câu hỏi",
        "summary": "Cách nhập đáp án để hệ thống ghi nhận chính xác.",
        "steps": [
          [
            "Trắc nghiệm [4-1]",
            "Đọc câu hỏi, chọn một phương án đúng trong các lựa chọn. Có thể đổi lựa chọn trước khi nộp nếu đề cho phép."
          ],
          [
            "Đúng/Sai [TF4]",
            "Mỗi câu có nhiều nhận định; chọn Đúng hoặc Sai cho từng ý theo yêu cầu. Đừng bỏ sót các ý chưa chọn."
          ],
          [
            "Trả lời ngắn [SQ]",
            "Nhập đáp án vào ô tương ứng. Chú ý định dạng số, dấu thập phân, đơn vị và cách viết theo hướng dẫn của đề."
          ],
          [
            "Tự luận [TL]",
            "Nhập nội dung trả lời vào vùng soạn thảo; trình bày rõ ý, đúng yêu cầu. Câu tự luận có thể cần chấm thủ công hoặc AI hỗ trợ tùy đề."
          ],
          [
            "Câu có công thức/hình",
            "Đọc kỹ ký hiệu toán học, hóa học, hình minh họa. Nếu hình hoặc công thức không hiển thị, báo giáo viên trước khi gửi bài."
          ]
        ]
      },
      {
        "id": "student-navigate",
        "title": "05. Điều hướng và tự kiểm tra bài làm",
        "summary": "Quản lý câu đã trả lời, tránh bỏ câu và nộp khi chưa sẵn sàng.",
        "steps": [
          [
            "Di chuyển giữa các câu",
            "Sử dụng các nút điều hướng/câu hỏi trên giao diện hoặc bảng số câu để chọn câu cần làm tiếp."
          ],
          [
            "Kiểm tra trạng thái",
            "Quan sát những câu đã chọn/chưa trả lời trên bảng điều hướng nếu có; rà soát câu Đúng/Sai đủ mọi ý."
          ],
          [
            "Đọc lại đáp án",
            "Kiểm tra câu chọn một đáp án, câu trả lời ngắn và nội dung tự luận; tránh gõ nhầm dấu hoặc bỏ sót câu."
          ],
          [
            "Theo dõi đồng hồ",
            "Dành thời gian kiểm tra trước khi hết giờ. Khi hết thời gian, hành vi nộp bài phụ thuộc cơ chế của đề đang thi."
          ]
        ]
      },
      {
        "id": "student-submit",
        "title": "06. Nộp bài và xem thông báo kết quả",
        "summary": "Hoàn tất bài thi và hiểu vì sao đôi khi điểm hoặc đáp án bị ẩn.",
        "steps": [
          [
            "Hoàn thành bài",
            "Khi đã rà soát, chọn chức năng Nộp bài hoặc Kết thúc bài thi theo giao diện."
          ],
          [
            "Xác nhận nộp",
            "Đọc kỹ thông báo xác nhận nếu có; chỉ xác nhận khi sẵn sàng. Tránh bấm nộp liên tục hoặc đóng trang trong lúc hệ thống đang xử lý."
          ],
          [
            "Đợi ghi nhận",
            "Quan sát thông báo hoàn tất hoặc màn hình kết quả trước khi thoát. Nếu mạng mất đúng lúc nộp, thông báo ngay cho giáo viên để kiểm tra hệ thống đã lưu hay chưa."
          ],
          [
            "Hiểu quyền xem kết quả",
            "Điểm, đáp án đúng/sai và chi tiết bài làm có thể hiện hoặc bị ẩn theo cấu hình giáo viên. Không thấy điểm ngay không đồng nghĩa đã mất bài."
          ],
          [
            "Số lượt làm",
            "Nếu đề giới hạn số lần dự thi, việc làm lại phải tuân theo số lượt còn lại. Không tự cho rằng có thể làm lại vô hạn."
          ]
        ]
      },
      {
        "id": "student-history",
        "title": "07. Xem Kết quả bài thi của tôi",
        "summary": "Tra cứu lịch sử bài làm được gắn với đúng tài khoản đăng nhập.",
        "steps": [
          [
            "Vào QL Kết quả",
            "Chọn QL Kết quả ở menu; học sinh sẽ thấy riêng màn hình Kết quả bài thi của tôi, không phải bảng quản trị toàn trường."
          ],
          [
            "Đọc số liệu",
            "Xem Tổng lượt làm bài và danh sách bài đã tham gia. Điểm cao nhất, số đề trên màn hình có thể chỉ tính trong trang kết quả hiện tại."
          ],
          [
            "Tìm và lọc",
            "Gõ tên đề trong ô tìm kiếm, lọc theo mức điểm nếu được công bố, sắp xếp Mới nhất/Cũ nhất hoặc điểm cao/thấp."
          ],
          [
            "Chuyển trang và tải lại",
            "Dùng Trang trước/Trang sau để xem thêm kết quả; bấm Tải lại kết quả để cập nhật sau khi vừa nộp."
          ],
          [
            "Xem chi tiết khi được mở",
            "Bấm Xem chi tiết bài làm nếu có nút này. Nếu thông báo giáo viên chưa cho phép thì cần chờ quy định công bố của đề."
          ],
          [
            "Bảo vệ dữ liệu cá nhân",
            "Hệ thống chỉ cung cấp lịch sử thuộc tài khoản bạn đang đăng nhập; không có chức năng chọn ID người khác để xem điểm."
          ]
        ],
        "note": "Kết quả của học sinh khác không được hiển thị trên màn hình lịch sử cá nhân."
      },
      {
        "id": "student-problems",
        "title": "08. Các tình huống thường gặp",
        "summary": "Các bước xử lý khi thiếu đề, lỗi mạng hoặc kết quả chưa xuất hiện.",
        "steps": [
          [
            "Không tìm thấy đề",
            "Kiểm tra tên giáo viên, tên đề, điều kiện lớp/trường, mã bảo mật và giờ mở đề; liên hệ giáo viên nếu chưa đúng."
          ],
          [
            "Bị thoát chế độ toàn màn hình",
            "Trở lại giao diện thi theo hướng dẫn; không cố tình chuyển ứng dụng để tránh tăng cảnh báo."
          ],
          [
            "Không xem được điểm",
            "Đề có thể chưa bật công bố điểm hoặc chi tiết. Kiểm tra lại sau khi giáo viên thông báo."
          ],
          [
            "Không thấy bài vừa nộp",
            "Bấm Tải lại kết quả, kiểm tra bạn vẫn dùng đúng tài khoản; nếu vẫn thiếu, cung cấp tên đề và thời điểm nộp cho giáo viên."
          ],
          [
            "Quên mật khẩu",
            "Liên hệ giáo viên hoặc người quản trị để được hướng dẫn khôi phục; không dùng tài khoản người khác."
          ],
          [
            "Dùng điện thoại",
            "Giữ màn hình ổn định, tránh đổi ứng dụng và để ý thông báo rời toàn màn hình theo quy định của đề."
          ]
        ]
      }
    ],
    "faqs": [
      [
        "Tôi có được xem bài của bạn khác không?",
        "Không. QL Kết quả của học sinh chỉ hiển thị các lượt làm thuộc đúng tài khoản đang đăng nhập."
      ],
      [
        "Vì sao tôi đã nộp nhưng không thấy điểm?",
        "Giáo viên có thể chưa cho phép hiển thị điểm; hệ thống vẫn có thể ghi nhận kết quả bài làm."
      ],
      [
        "Tại sao không thấy nút Xem chi tiết?",
        "Tùy chọn xem chi tiết được quyết định trong cấu hình đề thi, nên nút chỉ xuất hiện khi được cho phép."
      ],
      [
        "Đề yêu cầu mã truy cập thì lấy ở đâu?",
        "Mã bảo mật do giáo viên hoặc đơn vị tổ chức thi cung cấp; không phải mật khẩu đăng nhập của bạn."
      ],
      [
        "Có thể làm lại cùng một đề không?",
        "Chỉ khi đề cho phép và tài khoản còn lượt thi. Số lượt phụ thuộc cấu hình của từng đề."
      ]
    ]
  }
};
