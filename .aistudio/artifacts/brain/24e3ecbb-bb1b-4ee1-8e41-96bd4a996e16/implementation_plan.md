# Kế Hoạch Phân Tích Chuyên Sâu & Giải Pháp Gán Lớp Học Cho Giáo Viên

## 1. Phân Tích Hiện Trạng Hệ Thống

### 1.1. Hiện trạng quản lý Lớp và Giáo viên
- **Bảng `users`**: Hiện tại chứa trường `lop` (dành cho học sinh) và `donvi` (đơn vị/trường học). Giáo viên cũng nằm trong bảng `users` (với `target_audience = 'Giáo viên'`), trường `lop` của giáo viên thường để trống hoặc chỉ chứa 1 chuỗi đơn lẻ.
- **Bảng `accounts`**: Lưu thông tin đăng nhập (`role = 'teacher' | 'admin' | 'student'`), liên kết 1-1 với `users` qua `user_id`.
- **Bảng `exam_configs`**: Đề thi có `target_lop` (chuỗi dạng `"12A1, 12A2"`) và `creator_id` (ID giáo viên tạo đề).
- **Hạn chế hiện tại**:
  - Chưa có bảng trung gian để liên kết quan hệ Nhiều - Nhiều (N-N): 1 giáo viên có thể dạy nhiều lớp (ví dụ: Toán dạy 12A1, 12A2, 10A3), và 1 lớp có thể có nhiều giáo viên (GVCN, GV Toán, GV Văn, GV Anh,...).
  - Giáo viên khi tạo đề thi phải tự gõ tay danh sách lớp, dễ bị sai chính tả hoặc thừa thiếu khoảng trắng.
  - Khi xem bảng kết quả thi (`tab-ranking.html`) hoặc danh sách học sinh, giáo viên chưa có bộ lọc nhanh chỉ xem các lớp mình được phân công.

---

## 2. Kiến Trúc Giải Pháp Kỹ Thuật

### 2.1. Thiết kế Cơ sở dữ liệu (Database Schema)
Tạo bảng trung gian `teacher_classes` hỗ trợ quan hệ Nhiều - Nhiều (N - N) trên cả SQLite (môi trường Dev) và Cloudflare D1 (`functions/api/[[route]].ts`):

```sql
CREATE TABLE IF NOT EXISTS teacher_classes (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  teacher_name TEXT,
  class_name TEXT NOT NULL,
  donvi TEXT NOT NULL,
  role TEXT DEFAULT 'bo_mon',          -- 'chu_nhiem' (Chủ nhiệm) hoặc 'bo_mon' (Bộ môn)
  subject TEXT DEFAULT '',             -- Tên môn học phụ trách (Toán, Văn, Anh, v.v.)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(teacher_id, class_name, donvi)
);

CREATE INDEX IF NOT EXISTS idx_tc_teacher ON teacher_classes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_tc_class ON teacher_classes(class_name, donvi);
```

### 2.2. Thiết kế API Backend (Đồng bộ `server.ts` & `functions/api/[[route]].ts`)
1. **`GET /api/teacher-classes`**:
   - Tham số: `teacher_id` (tùy chọn), `donvi` (tùy chọn), `class_name` (tùy chọn).
   - Trả về danh sách các lớp được phân công cho giáo viên.
   - Nếu giáo viên gọi: tự động trả về danh sách lớp của chính mình.
   - Nếu Admin gọi: có thể truy vấn theo bất kỳ giáo viên hoặc toàn bộ đơn vị.
2. **`POST /api/teacher-classes`**:
   - Cho phép Quản trị viên (hoặc giáo viên tự đăng ký nếu được cấp quyền) gán danh sách lớp cho giáo viên.
   - Nhận payload: `{ teacher_id, classes: [{ class_name, role, subject }], donvi }`.
   - Thực hiện cập nhật an toàn (Upsert / Transaction).
3. **`DELETE /api/teacher-classes`**:
   - Gỡ bỏ phân công 1 lớp hoặc nhiều lớp của giáo viên.
4. **Nâng cấp `GET /api/users`**:
   - Với tài khoản giáo viên, tự động JOIN / đính kèm trường `assigned_classes` (danh sách tên lớp, vai trò, môn học) để giao diện hiển thị tức thì mà không cần gọi thêm API phụ.
5. **Nâng cấp `GET /api/results` & `GET /api/exams`**:
   - Tối ưu quyền truy cập: Hỗ trợ bộ lọc nhanh theo các lớp giáo viên phụ trách.

---

## 3. Thiết Kế Giao Diện UI/UX (Tailwind CSS, Thân Thiện & Trực Quan)

### 3.1. Tab Quản lý người dùng (`tab-users.html` & `src/main.js`)
- **Danh sách giáo viên**:
  - Thêm cột **"Lớp phụ trách"**: Hiển thị các huy hiệu (tag/badge) lớp sắc nét (ví dụ: `12A1 (Toán)`, `12A2 (CN)`).
  - Nút hành động **"Phân công lớp"** (Icon cặp sách / người dùng):
    - Mở Modal phân công lớp học tùy biến (Custom Modal Tailwind CSS, không dùng alert/prompt trình duyệt).
    - Modal cho phép chọn trường/đơn vị, tích chọn nhiều lớp từ danh sách lớp có sẵn trong trường hoặc nhập thêm lớp mới.
    - Lựa chọn vai trò (Chủ nhiệm / Bộ môn) và nhập môn học phụ trách cho từng lớp.
    - Nút lưu với phản hồi Toast thông báo đẹp mắt.

### 3.2. Tab Cấu hình đề thi (`tab-exams.html`)
- Tại mục cấu hình **"Lớp làm bài"** (`target_lop`):
  - Hiển thị thanh gợi ý nhanh: **"Lớp của tôi:"** kèm các nút badge lớp mà giáo viên được phân công.
  - Giáo viên chỉ cần click vào badge để thêm hoặc bỏ chọn lớp, có nút "Chọn tất cả lớp của tôi".
  - Vẫn giữ nguyên ô nhập để linh hoạt thêm lớp khác nếu cần thiết.

### 3.3. Tab Quản lý kết quả & Xếp hạng (`tab-ranking.html`)
- Thêm nút lọc nhanh: **"Chỉ xem lớp tôi phụ trách"**.
- Khi bật lọc này, danh sách bài nộp và thống kê chỉ tính trên học sinh thuộc các lớp giáo viên được phân công, giúp giáo viên nắm bắt ngay kết quả bài thi của học sinh mình.

---

## 4. Kế Hoạch Triển Khai Chi Tiết

1. **Bước 1: Khởi tạo CSDL & Schema Migration**:
   - Thêm câu lệnh khởi tạo bảng `teacher_classes` và index trong `initDatabase()` của `server.ts` và `functions/api/[[route]].ts`.
2. **Bước 2: Xây dựng Bộ API Backend**:
   - Viết các route `/api/teacher-classes` (GET, POST, DELETE).
   - Tích hợp `assigned_classes` vào danh sách giáo viên trong `/api/users`.
3. **Bước 3: Nâng cấp Giao diện Phân công Lớp**:
   - Thêm UI Modal phân công lớp học trong `tab-users.html`.
   - Viết hàm xử lý load danh sách lớp, chọn lớp, lưu phân công trong `src/main.js`.
4. **Bước 4: Tích hợp Gợi ý Lớp trong Tạo Đề & Bộ lọc Kết Quả**:
   - Bổ sung thanh chọn nhanh lớp phụ trách trong `tab-exams.html`.
   - Bổ sung bộ lọc lớp phụ trách trong `tab-ranking.html`.
5. **Bước 5: Kiểm tra & Biên dịch**:
   - Kiểm tra `compile_applet`, chạy thử các luồng gán lớp, tạo đề và xem kết quả.
   - Đảm bảo 100% tuân thủ quy tắc Cloudflare Pages và tên ứng dụng "HỆ THỐNG KIỂM TRA TRỰC TUYẾN".
