# Báo cáo nghiệm thu — Import Word công thức khoa học

- **Dự án:** HỆ THỐNG KIỂM TRA TRỰC TUYẾN.
- **Ngày báo cáo:** 23/10/2026, giờ Việt Nam.
- **Nhánh:** `feat/word-omml-verified-import-20261023`.
- **PR:** https://github.com/hohuuthe/kiemtratructuyenpro22/pull/12.
- **Bộ đọc công thức:** `word-omml-1.1`.
- **Trạng thái:** đã có kết quả kiểm thử bổ sung ở môi trường cô lập; còn các điều kiện nghiệm thu thực tế và CI trên commit mới. Chưa hợp nhất `main` hoặc cập nhật Production.

## 1. Kết quả đã xác minh

Các kết quả sau thuộc cây mã nguồn mới trong môi trường kiểm thử cục bộ. Commit mới chưa được đưa lên GitHub tại thời điểm lập báo cáo; kết quả CI/Preview của commit cũ `d9da16d` không thay thế việc kiểm tra commit mới.

| Nhóm kiểm thử | Kết quả đã chạy | Phạm vi chứng minh |
| --- | ---: | --- |
| Tokenizer và nhận dạng công thức | **26/26 đạt** | Nhận dạng, tách công thức và hồi quy hiển thị |
| Hiển thị nhiều chức năng và xuất file | **50/50 đạt** | Các trường hợp Word, công thức, chi tiết bài thi và xuất file trong bộ kiểm thử |
| Đọc OMML và bảo toàn nguồn | **26/26 đạt** | Thuộc tính, mặc định, ký hiệu, kiểu chữ, đường kẻ ma trận và trường hợp cần chặn |
| Xác minh payload/API nhập Word | **12/12 đạt** | Đầu vào sai, nguồn công thức, giao dịch và đối chiếu riêng từng lần xuất hiện Equation |
| Corpus Word nhập rồi xuất lại | **2/2 đạt** | 516 mẫu và 11 trường hợp LaTeX sai rõ ràng trong Word text |
| PostgreSQL và Neon client thật trong môi trường cô lập | **6/6 đạt** | Lưu/đọc, ràng buộc duy nhất, phân tách giáo viên và rollback khi dữ liệu bị thay đổi |
| **Tổng kiểm thử Node tại mốc này** | **122/122 đạt** | Tổng các nhóm trên; không cộng Chromium vào số này |
| Build Production | **Đạt** | Vite và esbuild biên dịch thành công |
| Chromium — import Word trên bản build Production | **10/10 đạt** | Giao diện nhập, Equation hợp lệ/thiếu thành phần, kiểm duyệt và sửa thủ công trên `dist` cục bộ; không ghi dữ liệu thật |
| Chromium — công thức, máy tính/di động, trình soạn thảo và xuất file | **35/35 đạt cục bộ** | Lần chạy này dùng ngoại lệ CA cục bộ để tải tài nguyên CDN; CI vẫn giữ kiểm chứng chỉ mặc định |
| GitHub Actions trên commit mới | **Chờ** | Đưa commit mới lên nhánh riêng và kiểm tra CI đúng commit đó |
| Cloudflare Preview của commit mới | **Chờ** | Kiểm tra triển khai và nghiệm thu sau khi nhánh được cập nhật |

**Đã hoàn tất kiểm tra từng lần xuất hiện:** hai Equation giống nhau phải có hai vị trí thực trong đúng trường nội dung. Xóa một vị trí không thể dùng lại vị trí còn lại để xác minh hai nguồn; sửa Equation thứ hai phải giữ nguyên Equation thứ nhất và OMML gốc. Các ca số thập phân dùng dấu phẩy, đoạn mã và dollar escape cũng đã được kiểm tra. Lượt chạy toàn bộ cuối cùng đạt 122/122, không bỏ qua test nào.

### Corpus 516 mẫu

- Tạo DOCX hoàn chỉnh bằng `Document/Packer`, đọc XML nguồn bằng bộ đọc độc lập trước khi đưa qua importer.
- **516/516 ID câu hỏi và 527/527 Equation** được nhận diện, xác minh và tái xuất; **0 câu bị chặn**.
- Đối chiếu số lượng, thứ tự ID, nguồn OMML, glyph, thứ tự toán hạng và khoảng trắng trong các cụm chữ đứng. **Không phát hiện sai khác theo các phép đối chiếu này.**
- Hàm API thật `validateBatchPayload()` chấp nhận đủ **516 câu/527 nguồn OMML** ở hai payload **400 + 116 câu**, có ID hợp lệ và SHA-256 của DOCX nguồn. Đây là kiểm tra hợp đồng đầu vào; không gọi HTTP hoặc lưu hai payload này vào CSDL.
- **11/11 nguồn LaTeX sai rõ ràng** được chặn; không có nguồn sai nào trong nhóm này được tự chấp nhận.
- Bộ kiểm thử yêu cầu danh sách câu bị chặn bằng rỗng; không cho phép tăng số câu bị chặn để che hồi quy và không bỏ qua mẫu âm thầm.

Phép đối chiếu glyph/toán hạng và nguồn dữ liệu chưa thay thế đánh giá trực quan mọi đặc tính bố cục hoặc việc mở/chỉnh sửa bằng Microsoft Word.

### Phạm vi kiểm thử PostgreSQL

Sáu ca dùng **PGlite chạy SQL PostgreSQL thật** và **gói Neon serverless client thật**. Transport được chuyển vào CSDL cục bộ cô lập để kiểm tra truy vấn, giao dịch, ràng buộc và rollback; chưa kiểm tra kết nối Neon staging qua mạng.

Các ca đã chạy: lưu/đọc đúng nội dung và metadata; lỗi khóa chính giữa giao dịch; nhập trùng cùng file; phân tách hai giáo viên; trigger làm đổi nội dung câu hỏi; trigger làm đổi nguồn công thức. Các sai khác do trigger phải gây lỗi kiểm chứng trước commit và hoàn tác toàn bộ giao dịch.

### Bằng chứng tái kiểm tra

- `tests/word-import-omml.test.mjs`: cấu trúc, thuộc tính và nguồn OMML.
- `tests/word-import-transaction.test.mjs`: payload/API và giao dịch.
- `tests/word-import-postgres.test.mjs`: sáu ca PostgreSQL/Neon client cô lập.
- `tests/word-import-corpus-roundtrip.test.mjs`: corpus, hợp đồng API và nguồn sai.
- `artifacts/corpus-review/corpus-roundtrip.json` và `malformed-text-results.json`: số liệu từng mẫu và kết quả đối chiếu.
- `artifacts/corpus-review/corpus-source.docx` và `corpus-reexported.docx`: DOCX trước/sau nhập.
- `artifacts/browserqa/production-import/acceptance.json`: **10 đạt, 0 lỗi**, chế độ `production-build`, đích cục bộ; các yêu cầu API bị chặn để không chạm dữ liệu thật.

Các artifact này đang là bằng chứng cục bộ. Cần gắn kết quả CI và artifact của commit mới sau khi GitHub Actions chạy xong.

## 2. Những vấn đề đã sửa trong đợt kiểm thử bổ sung

1. **OMML engine 1.1:** xử lý thuộc tính và mặc định theo cấu trúc nguồn; bảo toàn kiểu phân số, dấu ngoặc, ký hiệu nhóm, toán tử tích phân, chỉ số và các kiểu chữ được hỗ trợ. Trường hợp chưa xác định chắc chắn được chặn kèm lý do.
2. **Biến thể Hy Lạp:** bảo toàn sự khác nhau giữa `φ`/`ϕ` và `ε`/`ϵ`, tránh đổi glyph khi nhập rồi xuất lại.
3. **Ký hiệu độ:** giữ Unicode `°` và đúng vị trí chỉ số; không thêm tầng superscript vào nguồn đã có superscript.
4. **Văn bản trong công thức:** giữ khoảng trắng trong các cụm “hạt nhân”, “thực tế”, “lý thuyết”, “áp suất”; hỗ trợ normal text và chữ đứng theo nguồn.
5. **Ma trận có đường kẻ:** khôi phục đường kẻ từng cạnh và căn cột khi nguồn có cấu trúc nhất quán; chặn cấu trúc không bảo toàn được. STR-030 đã qua corpus; kiểm thử riêng đối chiếu cạnh của từng ô và căn cột.
6. **Xác minh tại máy chủ:** kiểm lại LaTeX và metadata bằng bộ xác minh chung; đọc lại OMML gốc để kiểm tra nguồn tự động đã xác minh, không chỉ tin trạng thái do trình duyệt gửi. Chặn mã nguồn trùng giữa các câu và sai lệch giữa nguồn, metadata, trường nội dung.
7. **Đối soát trước commit:** so toàn bộ giá trị câu hỏi và metadata công thức bên trong cùng giao dịch PostgreSQL; sai khác phải gây lỗi và rollback trước khi ghi nhận thành công. Sử dụng tùy chọn Neon client `isolationLevel: 'Serializable'`, rồi đọc lại để đối chiếu sau giao dịch.
8. **Công thức lặp lại:** đối chiếu một-một từng lần xuất hiện và sửa đúng vị trí nguồn. Nếu không xác định chắc vị trí cần sửa, giữ nguyên câu hỏi và metadata, báo lỗi để kiểm tra.

## 3. Phạm vi 8 nhóm theo phê duyệt

1. Đọc OOXML/OMML trực tiếp từ DOCX; bảo toàn thứ tự văn bản, công thức và hình ảnh trong cấu trúc hỗ trợ. Giới hạn file 24 MB và dữ liệu giải nén 80 MB.
2. Chuyển phân số, chỉ số, căn, ma trận, Equation Array, tích phân, giới hạn, hàm, vector, dấu ngoặc và ký hiệu Hy Lạp thành LaTeX có cấu trúc, có nguồn gốc để đối chiếu.
3. Kiểm chứng với bộ dựng công thức và bộ xuất native Word Equation; không tự phỏng đoán ký hiệu hóa học khi thiếu bằng chứng.
4. Chặn công thức sai/thiếu, cấu trúc chưa hỗ trợ hoặc vấn đề hình ảnh; không tự thêm tử/mẫu, đổi phân loại câu hoặc di chuyển ảnh giữa các trường.
5. Xem trước số câu/Equation, lỗi từng câu và sửa từng công thức; xác nhận thủ công không được bỏ qua công thức chưa chuyển đổi.
6. API nhập riêng, giao dịch nguyên tử, nhật ký batch, nguồn OMML, kiểm chứng trước commit và đọc lại sau ghi.
7. Kiểm thử Node, PostgreSQL cô lập, corpus DOCX và Chromium; tiếp tục nghiệm thu bằng tài liệu giáo viên và môi trường staging thật.
8. Giữ nhánh riêng, PR draft và báo cáo nghiệm thu; chỉ đưa lên Production sau khi đủ điều kiện và có phê duyệt.

## 4. Các điều kiện còn chờ trước khi đề nghị triển khai

- [x] Mốc 122/122 kiểm thử Node nêu trên đạt trong môi trường cô lập, 0 lỗi, 0 test bị bỏ qua.
- [x] Corpus 516 câu/527 Equation không còn câu bị chặn hoặc sai khác do oracle hiện có phát hiện; 11 nguồn sai được chặn.
- [x] Build Production thành công; Chromium import trên bản build đạt 10/10.
- [x] Chromium công thức/xuất file đạt 35/35 cục bộ với giới hạn CA đã công bố.
- [x] Chạy lại toàn bộ kiểm thử và build sau khi bổ sung ràng buộc từng lần xuất hiện công thức.
- [ ] GitHub Actions và build đạt trên đúng commit mới; xác minh ảnh/file artifact của lượt chạy đó.
- [ ] Cloudflare Preview của commit mới triển khai thành công và được nghiệm thu.
- [ ] Giáo viên thử DOCX thực tế của Toán, Vật lý, Hóa, Sinh; đặc biệt MathType/Equation Editor cũ hoặc công thức dạng ảnh.
- [ ] Mở và chỉnh sửa Equation trong DOCX xuất lại bằng Microsoft Word thực tế.
- [ ] Kiểm thử Cloudflare → Neon staging độc lập: nhập, đọc lại, lỗi giữa giao dịch và rollback; đối chiếu ID, số câu, nội dung và nguồn OMML.
- [ ] Nghiệm thu xuyên suốt bằng dữ liệu thực tế: nhập Word → lưu CSDL → đọc qua API → mở lại câu hỏi → giao diện học sinh → xuất lại Word.
- [ ] Hoàn tất báo cáo commit cuối và chủ dự án phê duyệt trước khi hợp nhất `main`/Production.

**Chưa đủ bằng chứng để tuyên bố nghiệm thu Production hoàn tất.** Các lượt kiểm thử đã nêu sử dụng dữ liệu/môi trường cô lập; không ghi dữ liệu Production trong đợt kiểm tra này.

## 5. Các giới hạn cần công bố

- Định dạng nhập là `.docx`; `.doc` và MathType OLE cũ có thể cần chuyển đổi trước.
- Công thức chỉ là ảnh cần kiểm duyệt thủ công; không tự nhận dạng rồi mặc nhiên xem là đúng.
- OOXML ngoài tập cú pháp/thuộc tính hỗ trợ bị chặn; giữ nguồn để sửa LaTeX và xác minh.
- Đánh số tự động, Track Changes, nội dung quan trọng ở header/footer, bảng phức tạp hoặc nhiều ảnh trong cùng đoạn có thể cần sửa lại nguồn.
- Giới hạn 400 câu và 6 MB dữ liệu mỗi giao dịch nhập, kể cả metadata OMML và ảnh.
- Thành công trên bộ 516 mẫu không có nghĩa mọi DOCX tùy ý đều chính xác 100%. Tiêu chí bắt buộc là bảo toàn nội dung trong phạm vi đã xác minh và không lưu âm thầm công thức chưa xác minh.

**Nguyên tắc triển khai:** không hợp nhất `main` hoặc thay đổi Production trước khi hoàn thành nghiệm thu cần thiết và nhận phê duyệt của chủ dự án.

