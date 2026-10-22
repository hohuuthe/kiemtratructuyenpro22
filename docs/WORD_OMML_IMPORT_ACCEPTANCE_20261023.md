# Báo cáo nghiệm thu — Import Word công thức khoa học
Dự án: HỆ THỐNG KIỂM TRA TRỰC TUYẾN
Nhánh: feat/word-omml-verified-import-20261023
PR: https://github.com/hohuuthe/kiemtratructuyenpro22/pull/12
Trạng thái: Chờ nghiệm thu trên nhánh riêng; chưa hợp nhất main/Production.

## Phạm vi 8 nhóm theo phê duyệt
1. Đọc OOXML/OMML trực tiếp từ DOCX; bảo toàn thứ tự văn bản, công thức và hình ảnh. Giới hạn 24MB file/80MB giải nén.
2. Chuyển phân số, chỉ số, căn, ma trận, Equation Array, tích phân, giới hạn, hàm, vector, dấu ngoặc, Hy Lạp thành LaTeX có cấu trúc.
3. Kiểm thử với bộ KaTeX, hóa học mhchem và bộ xuất Equation Word; không tự phỏng đoán ký hiệu Hóa học khi không có bằng chứng.
4. Không tự thêm tử/mẫu thiếu, không tự đổi phân loại câu, không di chuyển ảnh từ phương án sang câu hỏi.
5. Preview số câu/Equation/cần duyệt, chi tiết lỗi và xác nhận sau khi giáo viên sửa.
6. API import riêng, giao dịch Neon PostgreSQL nguyên tử, nhật ký batch, nguồn OMML, đối chiếu số câu sau ghi.
7. Node tests và Chromium cho DOCX thực tế, cảnh báo, ảnh, rollback, LaTeX, giao diện.
8. PR draft, báo cáo kiểm thử và đợi phê duyệt trước Production.

## Các giới hạn cần công bố
- File Word .docx; .doc và MathType OLE cũ có thể cần chuyển đổi trước.
- Công thức chỉ là ảnh cần kiểm duyệt thủ công; không tự nhận dạng từ ảnh để tránh sai.
- OOXML ngoài tập cú pháp hỗ trợ sẽ bị chặn; giữ nguyên bản gốc, có thể sửa LaTeX và xác minh.
- Đánh số tự động, Track Changes, header/footer, bảng phức tạp hoặc nhiều ảnh trong một đoạn có thể cần sửa lại nguồn.
- Giới hạn 400 câu và 6MB gói dữ liệu mỗi giao dịch nhập, tránh lưu thiếu nếu quá lớn.
- 100% độ chính xác với mọi DOCX tùy ý là bất khả thi; mục tiêu cứng là không lưu âm thầm câu hoặc công thức chưa xác minh.

## Danh sách nghiệm thu
- [ ] GitHub Actions Node tests và build đạt trên commit cuối.
- [ ] Chromium kiểm tra preview Equation thật và cảnh báo nguồn lỗi.
- [ ] Giáo viên thử file Word thực tế của các môn Toán, Vật lý, Hóa, Sinh.
- [ ] Staging Neon riêng: giao dịch lưu/thất bại/rollback và đối chiếu ID, số câu, OMML sau ghi.
- [ ] Đọc lại câu hỏi qua API, xem trên giao diện học sinh và xuất Word có thể sửa công thức.
- [ ] Không có ảnh hưởng đến dữ liệu Production.
- [ ] Báo cáo, chủ dự án phê duyệt trước khi hợp nhất main.

Nguyên tắc: Không merge main hoặc thực hiện thay đổi Production khi chưa có phê duyệt.
