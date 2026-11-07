# AGENTS.md — QUY CHẾ VẬN HÀNH BẮT BUỘC CHO DỰ ÁN KTTT

> **Trạng thái:** BẮT BUỘC ĐỌC TRƯỚC KHI LÀM VIỆC  
> **Phạm vi:** Toàn bộ repository, frontend, backend, database, Worker/Pages, API, CI/CD, migration, cấu hình, tài liệu kỹ thuật và Production.  
> **Mục tiêu:** Chính xác, an toàn, có kiểm chứng, thay đổi tối thiểu, không gây lỗi dây chuyền, có khả năng rollback, bảo vệ tuyệt đối tính công bằng và dữ liệu của học sinh.

---

## 0. NGUYÊN TẮC TỐI CAO

Mọi tác nhân làm việc với dự án này (AI, lập trình viên, reviewer, DevOps) **PHẢI đọc file này trước khi phân tích hoặc thay đổi mã nguồn**.

Không được bắt đầu sửa code chỉ dựa trên mô tả bề mặt. Trước mọi thay đổi phải hiểu:

1. Người dùng đang muốn sửa **hành vi nào**.
2. Hành vi hiện tại đang chạy như thế nào từ UI → API → database → phản hồi.
3. Những module nào có thể bị ảnh hưởng gián tiếp.
4. Điều gì **tuyệt đối không được thay đổi**.
5. Cách kiểm thử chứng minh thay đổi là đúng.
6. Cách quay lại trạng thái trước nếu có lỗi.

### 0.1. Không tuyên bố “đã hoàn tất” nếu chưa có bằng chứng

Chỉ được báo hoàn tất khi có tối thiểu một trong các bằng chứng phù hợp:

- Test tự động chạy đạt.
- Build thành công.
- Smoke test chức năng thành công.
- Kiểm tra API/database cho kết quả đúng.
- Xác minh Production sau deploy.
- Diff được rà soát không có thay đổi ngoài phạm vi.

Nếu chưa kiểm chứng được thì phải ghi rõ: **“Đã sửa ở mức mã nguồn nhưng chưa đủ bằng chứng để khẳng định Production đã đúng.”**

### 0.2. Không “sửa tiện thể”

- Không refactor ngoài yêu cầu nếu không cần thiết.
- Không đổi tên biến/hàm/file hàng loạt chỉ vì “đẹp hơn”.
- Không nâng thư viện, framework, runtime nếu không liên quan trực tiếp.
- Không thay đổi giao diện hoặc logic cũ ngoài vùng yêu cầu.
- Mọi diff phải càng nhỏ càng tốt nhưng vẫn giải quyết tận gốc nguyên nhân.

### 0.3. Ưu tiên fail-safe hơn fail-open

Nếu hệ thống không chắc chắn về dữ liệu quan trọng, phải **dừng thao tác an toàn và thông báo rõ**, không được đoán, bù dữ liệu hoặc tiếp tục ngầm.

Đặc biệt áp dụng cho:

- Câu hỏi của đề thi.
- Đáp án.
- Điểm số.
- Thời gian làm bài.
- Quyền truy cập.
- Tenant/database.
- Lượt làm bài.
- Trạng thái nộp bài.

---

# 1. BỐI CẢNH HỆ THỐNG CẦN GHI NHỚ

Dự án là hệ thống kiểm tra trực tuyến với các nhóm chức năng chính:

- Vai trò: **Admin / Giáo viên / Học sinh**.
- Quản lý tài khoản, hồ sơ, lớp, đơn vị.
- Ngân hàng câu hỏi.
- Tạo/sửa/cấu hình đề thi.
- Làm bài, nộp bài, chấm điểm.
- Quản lý kết quả.
- Import/Export Word/Excel.
- Hiển thị công thức Toán/Hóa/Sinh/Vật lý.
- AI chấm tự luận.
- Quản lý tài liệu.
- Bảng tương tác thông minh.
- Quét thẻ trả lời QR.
- Hệ thống đa tenant.
- Hạ tầng Cloudflare + Neon/PostgreSQL.

## 1.1. Các bất biến nghiệp vụ quan trọng

Các quy tắc sau mặc định phải được bảo toàn, trừ khi chủ dự án yêu cầu thay đổi rõ ràng:

1. **Chấm điểm phải theo dữ liệu chuẩn phía server**, không tin điểm do client gửi lên.
2. **Thời gian làm bài do server quyết định**, client chỉ hiển thị.
3. **Không được tự lấy câu hỏi mức độ khác để bù** khi thiếu câu so với cấu hình đề.
4. Nếu ngân hàng câu hỏi thực sự thiếu so với cấu hình đề:
   - Không âm thầm tạo đề sai cấu hình.
   - Không thay thế bằng câu ở mức độ khác.
   - Phải báo rõ đề/cấu hình không còn hợp lệ.
5. Sau khi ngân hàng câu hỏi đã tải thành công, nên tái sử dụng cache phù hợp; tuy nhiên trước khi dùng phải có cơ chế xác nhận dữ liệu còn hợp lệ/fresh khi nghiệp vụ yêu cầu.
6. **Immediate Feedback là chức năng hợp lệ hiện có** và không được loại bỏ nếu chưa có yêu cầu mới.
7. Các thao tác hợp lệ như đính kèm file tự luận hoặc chọn hình nền không được bị tính sai thành vi phạm fullscreen nếu cơ chế hiện tại đã miễn trừ.
8. Điểm nhập trung gian có thể cần độ chính xác cao; điểm kết quả hiển thị cuối cùng phải tuân theo quy ước hiển thị của hệ thống.
9. Giáo viên chỉ được thao tác dữ liệu trong phạm vi được phân quyền; Admin có quyền quản trị rộng hơn; Học sinh chỉ truy cập dữ liệu của mình và phạm vi đề được phép.
10. Mọi tenant phải được cách ly dữ liệu tuyệt đối.

---

# 2. QUY TRÌNH BẮT BUỘC TRƯỚC KHI SỬA MÃ

## GATE 1 — Hiểu yêu cầu

Trước khi code, phải viết ra trong đầu hoặc trong báo cáo kỹ thuật:

- **Yêu cầu chính:** cần đạt hành vi gì?
- **Phạm vi:** màn hình/API/bảng dữ liệu nào liên quan?
- **Không thay đổi:** những chức năng nào phải giữ nguyên?
- **Tiêu chí đạt:** kiểm tra thế nào để biết đã đúng?
- **Rủi ro:** nếu sửa sai sẽ ảnh hưởng gì?

Nếu yêu cầu có nhiều cách hiểu, ưu tiên cách hiểu:

1. Bảo toàn dữ liệu.
2. Bảo toàn chức năng hiện có.
3. Không làm sai quyền người dùng.
4. Không tạo hành vi bất ngờ cho học sinh/giáo viên.

## GATE 2 — Đọc luồng thực tế trong code

Không sửa chỉ dựa vào tên file.

Phải lần theo luồng đầy đủ khi liên quan:

**UI event → state/store → service/client → API route → middleware/auth → business logic → DB query/transaction → response → UI render**.

Nếu là bug, phải xác định **root cause** trước khi sửa.

Không được vá lỗi chỉ ở UI nếu lỗi thực sự nằm ở API hoặc database.

## GATE 3 — Kiểm tra trạng thái repository

Trước khi thay đổi:

- Xác định branch hiện tại.
- Kiểm tra working tree có thay đổi chưa commit hay không.
- Không được ghi đè thay đổi của người khác.
- Không được reset/xóa file chưa rõ nguồn gốc.
- Xác định commit gần nhất liên quan nếu cần.

Nếu repository đang có thay đổi chưa rõ chủ sở hữu, phải giữ nguyên và tránh đụng vào vùng đó nếu có thể.

## GATE 4 — Phân loại mức rủi ro

### P0 — Rủi ro cực cao

- Chấm điểm.
- Đáp án.
- Nộp bài.
- Thời gian làm bài.
- Lượt thi.
- Xóa dữ liệu.
- Tenant routing.
- Authentication/Authorization.
- Migration dữ liệu.
- Secret/API key.

Yêu cầu: test nhiều lớp + rollback + xác minh Production.

### P1 — Rủi ro cao

- Ngân hàng câu hỏi.
- Tạo đề.
- Phân quyền giáo viên/lớp.
- Import/Export.
- AI chấm tự luận.
- Upload file.
- Realtime.

Yêu cầu: test chức năng + quyền + dữ liệu biên.

### P2 — Rủi ro trung bình

- UI/UX.
- Sắp xếp bảng.
- Pagination.
- Format thời gian/điểm.
- Tooltip/modal.

Yêu cầu: regression test chức năng liên quan.

### P3 — Rủi ro thấp

- Text, nhãn, spacing, cosmetic không ảnh hưởng logic.

Vẫn phải build/lint phù hợp.

---

# 3. QUY TẮC THAY ĐỔI MÃ NGUỒN

## 3.1. Thay đổi nhỏ nhất có thể

Mỗi task chỉ sửa các file cần thiết.

Trước khi thêm code mới, kiểm tra xem hệ thống đã có:

- helper dùng chung,
- validation dùng chung,
- permission guard,
- API client,
- component chuẩn,
- transaction utility,
- format utility,
- logging utility.

Không tạo logic trùng lặp nếu có thể tái sử dụng an toàn.

## 3.2. Không phá hợp đồng API cũ

Khi sửa API:

- Giữ tương thích ngược nếu có thể.
- Không đổi tên field tùy tiện.
- Không đổi kiểu dữ liệu nếu chưa kiểm tra tất cả consumer.
- Nếu thêm field, ưu tiên backward-compatible.
- Nếu buộc phải breaking change, phải cập nhật tất cả caller trong cùng thay đổi.

## 3.3. Validation phải ở server

Client validation chỉ để UX.

Mọi dữ liệu quan trọng phải được server xác minh lại:

- quyền,
- tenant,
- id người dùng,
- trạng thái đề,
- thời gian,
- lượt làm bài,
- câu hỏi hợp lệ,
- đáp án,
- điểm,
- file upload,
- giới hạn số lượng.

## 3.4. Không tin dữ liệu từ client

Không tin:

- role từ client,
- userId do client tự khai,
- teacherId do client gửi nếu có thể lấy từ session,
- score client tính,
- deadline client tính,
- tenant slug không được xác minh,
- answer key do client gửi lại.

## 3.5. Idempotency

Các thao tác quan trọng phải chống lặp:

- nộp bài,
- tạo attempt,
- chấm bài,
- ghi nhận QR,
- xóa kết quả,
- cập nhật hàng loạt,
- webhook/realtime event.

Nếu request lặp do mạng/retry, hệ thống không được tạo bản ghi trùng hoặc cộng điểm/lượt hai lần.

## 3.6. Concurrency

Phải nghĩ đến hai request cùng lúc:

- Học sinh bấm nộp 2 lần.
- Hai tab cùng làm bài.
- Giáo viên sửa/xóa đề khi học sinh đang làm.
- Hai Admin cập nhật cùng bản ghi.
- Hai worker cùng xử lý một attempt.

Dùng transaction, unique constraint, compare-and-set/version hoặc cơ chế khóa phù hợp.

---

# 4. QUY TẮC DATABASE / NEON / POSTGRESQL

## 4.1. Không chạy thao tác phá hủy nếu chưa có phương án quay lui

Trước DELETE/UPDATE hàng loạt/ALTER TABLE:

- Xác định chính xác tenant/database.
- Xác định số bản ghi dự kiến bị ảnh hưởng.
- Có câu SELECT kiểm tra trước.
- Có backup/branch/snapshot hoặc phương án restore phù hợp.
- Có WHERE rõ ràng.

**Cấm** chạy UPDATE/DELETE toàn bảng chỉ vì “đã chắc”.

## 4.2. Migration phải an toàn

Ưu tiên migration theo mô hình:

1. Additive change.
2. Deploy code tương thích cả schema cũ và mới.
3. Backfill nếu cần.
4. Chuyển traffic/logic.
5. Xóa schema cũ ở task riêng sau khi ổn định.

Không gộp nhiều thay đổi phá vỡ schema vào một lần deploy nếu tránh được.

## 4.3. Tenant isolation

Mọi query dữ liệu tenant phải kiểm tra tenant ở server.

Không được chỉ filter tenant ở UI.

Khi dùng slug/database routing:

- slug phải được chuẩn hóa và xác minh.
- không cho phép truy cập tenant khác bằng cách sửa URL/body/header.
- cache phải có namespace theo tenant.
- log không làm rò dữ liệu tenant khác.

## 4.4. Query hiệu năng

Đối với bảng lớn:

- phân trang server-side,
- chỉ SELECT cột cần thiết,
- index theo pattern truy vấn thực tế,
- tránh N+1,
- tránh tải toàn bộ ngân hàng câu hỏi nếu không cần,
- tránh lặp request khi dữ liệu đã cache hợp lệ.

---

# 5. QUY TẮC RIÊNG CHO ĐỀ THI VÀ NGÂN HÀNG CÂU HỎI

Đây là vùng **P0/P1**.

## 5.1. Nạp đề

Khi nạp cấu hình đề:

1. Xác định đúng đề và người sở hữu/quyền truy cập.
2. Load đầy đủ cấu hình đề.
3. Load hoặc tái sử dụng ngân hàng câu hỏi theo cache policy.
4. Kiểm tra số lượng câu thực tế có đủ theo từng tiêu chí cấu hình.
5. Kiểm tra đúng mức độ nhận biết/thông hiểu/vận dụng hoặc taxonomy tương ứng.
6. Nếu thiếu ở bất kỳ nhóm nào:
   - dừng tạo đề,
   - báo rõ nhóm nào thiếu,
   - không lấy nhóm khác bù.
7. Chỉ cho phép tiếp tục khi cấu hình được thỏa mãn chính xác.

## 5.2. Cache ngân hàng câu hỏi

Mục tiêu: không tải dư thừa nhưng không dùng dữ liệu lỗi thời.

Cache phải có tối thiểu:

- tenant scope,
- user/permission scope nếu cần,
- trạng thái loaded,
- thời điểm/version/fingerprint phù hợp,
- cơ chế invalidate khi câu hỏi bị thêm/sửa/xóa hoặc khi cần xác minh lại.

Không được coi “đã từng tải thành công” là bằng chứng dữ liệu luôn còn hợp lệ mãi mãi.

## 5.3. Snapshot đề/attempt

Khi học sinh bắt đầu làm bài, nên bảo đảm nội dung dùng để chấm là một snapshot logic ổn định của attempt.

Không để việc giáo viên sửa/xóa câu hỏi sau đó làm thay đổi đáp án của attempt đang làm hoặc đã nộp.

---

# 6. QUY TẮC CHẤM ĐIỂM VÀ BẢO VỆ QUYỀN LỢI HỌC SINH

Đây là vùng **P0 tuyệt đối**.

## 6.1. Server-authoritative scoring

Điểm cuối cùng phải do server tính từ:

- snapshot câu hỏi/đáp án hợp lệ,
- câu trả lời học sinh,
- quy tắc chấm tương ứng,
- trọng số/điểm cấu hình.

Không nhận `score` do browser gửi làm nguồn sự thật.

## 6.2. Tính điểm phải deterministic

Cùng một dữ liệu đầu vào phải luôn cho cùng một điểm.

Không phụ thuộc:

- timezone client,
- thứ tự object không ổn định,
- rounding khác nhau giữa client/server,
- trạng thái UI.

## 6.3. Làm tròn

Phân biệt:

- **giá trị tính toán nội bộ**: giữ đủ precision cần thiết,
- **giá trị hiển thị**: làm tròn theo quy định UI.

Không làm tròn sớm ở giữa chuỗi tính toán nếu gây sai điểm cuối.

## 6.4. Nộp bài

Nộp bài phải:

- atomic hoặc có state machine rõ,
- chống double-submit,
- ghi thời điểm server,
- không mất câu trả lời cuối cùng,
- không chấm hai lần gây sai dữ liệu,
- retry an toàn khi mạng chập chờn.

## 6.5. Không được làm học sinh mất quyền lợi vì lỗi hệ thống

Nếu lỗi server/network xảy ra ở thời điểm nộp bài:

- log đầy đủ,
- không tự gán 0 điểm nếu chưa đủ căn cứ,
- không tự coi là gian lận,
- phải có dữ liệu phục hồi/audit để xử lý công bằng.

---

# 7. THỜI GIAN LÀM BÀI

Thời gian là P0.

- Server là nguồn thời gian chuẩn.
- Lưu timestamp theo chuẩn nhất quán (ưu tiên UTC trong DB), chuyển múi giờ khi hiển thị.
- UI không được tự quyết định hợp lệ/quá giờ dựa duy nhất vào đồng hồ máy học sinh.
- Resume/refresh phải khôi phục đúng trạng thái từ server nếu chức năng hỗ trợ.
- Không cộng/trừ thời gian do refresh, reconnect hoặc latency sai cách.
- Deadline phải được kiểm tra lại khi nộp.

---

# 8. AUTHENTICATION, AUTHORIZATION VÀ BẢO MẬT

## 8.1. Nguyên tắc least privilege

Mỗi vai trò chỉ có quyền tối thiểu cần thiết.

Không dùng “ẩn nút UI” làm cơ chế phân quyền.

API phải chặn truy cập trái phép dù người dùng gọi trực tiếp endpoint.

## 8.2. IDOR

Mọi endpoint dạng `/resource/:id` phải kiểm tra:

- resource có thuộc tenant không,
- user có quyền với resource không,
- teacher có phải owner hoặc được phân quyền không,
- student có phải chủ dữ liệu không.

## 8.3. Secret

Cấm commit:

- database URL,
- API key,
- Gemini key,
- Cloudflare token,
- JWT secret,
- private key,
- password thực.

Không log secret.

Không trả secret xuống client nếu không bắt buộc bởi thiết kế.

## 8.4. Upload

Upload file phải kiểm tra:

- kích thước,
- MIME/type,
- extension,
- tên file,
- quyền truy cập,
- lưu trữ an toàn,
- chống path traversal,
- không cho thực thi file upload.

---

# 9. FRONTEND / UX

## 9.1. Không để UI tạo trạng thái giả

Không hiện “Thành công” trước khi server xác nhận.

Không xóa item khỏi UI trước khi biết thao tác backend thành công, trừ khi có optimistic update với rollback đúng.

## 9.2. Loading/error state

Mọi luồng tải dữ liệu phải có:

- loading rõ ràng,
- timeout/retry hợp lý,
- lỗi cụ thể,
- không treo UI,
- không loop request.

## 9.3. Responsive

Các màn hình học sinh/giáo viên quan trọng phải kiểm tra tối thiểu:

- desktop,
- mobile,
- fullscreen nếu có.

Không sửa desktop làm hỏng mobile hoặc ngược lại.

---

# 10. API VÀ NETWORK

- Tránh request trùng.
- Abort request cũ khi người dùng chuyển tab/filter nếu phù hợp.
- Debounce/throttle ở chức năng tìm kiếm/quét/realtime nếu cần.
- Không tải payload lớn khi chỉ cần summary.
- Phân trang ở server cho dữ liệu lớn.
- Cache phải có invalidation rõ.
- Không retry vô hạn.
- Lỗi non-JSON phải được xử lý an toàn ở client.

---

# 11. REALTIME / QR / BẢNG TƯƠNG TÁC

Đây là vùng dễ phát sinh race condition.

Phải kiểm tra:

- event id hoặc sequence,
- duplicate event,
- reconnect,
- out-of-order event,
- mất kết nối,
- tenant/session isolation,
- stale client,
- giới hạn subrequest của Cloudflare,
- batching nếu cần.

QR ghi nhận đáp án phải chống:

- ghi trùng cùng học sinh/cùng câu,
- ghi vào sai câu đang chiếu,
- ghi sai lớp/session,
- event đến muộn làm ghi đè câu mới.

---

# 12. AI CHẤM TỰ LUẬN

AI không được là nguồn duy nhất cho dữ liệu không thể kiểm tra.

Phải có:

- rubric/prompt rõ,
- lưu kết quả và trạng thái chấm,
- retry có giới hạn,
- chuyển key an toàn khi quota hết nếu hệ thống hỗ trợ,
- không làm chấm lặp thành cộng điểm hai lần,
- giáo viên có khả năng kiểm tra/chỉnh sửa khi nghiệp vụ yêu cầu,
- tenant isolation cho key và dữ liệu.

Không gửi dữ liệu nhạy cảm vượt quá mức cần thiết.

---

# 13. TEST STRATEGY BẮT BUỘC

Không có một loại test nào đủ cho mọi thay đổi.

## 13.1. Unit test

Dùng cho:

- scoring,
- rounding,
- validation,
- permission helper,
- selector,
- parser/import.

## 13.2. Integration test

Dùng cho:

- API + DB,
- auth + permission,
- submit attempt,
- create exam,
- tenant routing,
- bulk update.

## 13.3. Regression test

Mọi bug fix phải có test chứng minh:

- trước đây lỗi,
- sau sửa không còn lỗi,
- case lân cận vẫn đúng.

## 13.4. Edge cases

Luôn nghĩ tối thiểu các case:

- null/undefined,
- dữ liệu rỗng,
- 0 bản ghi,
- 1 bản ghi,
- max size,
- duplicate,
- request lặp,
- timeout,
- permission denied,
- tenant khác,
- record vừa bị xóa,
- record vừa bị sửa,
- refresh giữa thao tác.

## 13.5. Kiểm thử chấm điểm

Phải có test cho:

- đúng toàn bộ,
- sai toàn bộ,
- bỏ trống,
- nhiều đáp án,
- đúng/sai,
- tự luận,
- điểm lẻ,
- rounding,
- submit lặp,
- hết giờ sát thời điểm nộp.

---

# 14. BUILD / STATIC CHECK / DEPENDENCIES

Trước deploy, chạy các kiểm tra phù hợp repository:

- typecheck,
- lint,
- unit test,
- integration test,
- build production.

Nếu repo không có một loại kiểm tra, không được giả vờ đã chạy.

Khi dependency có cảnh báo security:

- phân tích mức ảnh hưởng,
- không auto-upgrade hàng loạt nếu có thể gây breaking change,
- ưu tiên bản vá tối thiểu.

---

# 15. REVIEW DIFF TRƯỚC KHI COMMIT

Bắt buộc đọc lại toàn bộ diff.

Checklist:

- Có file nào bị sửa ngoài ý muốn?
- Có debug log còn sót?
- Có secret/token?
- Có comment tạm?
- Có TODO quan trọng chưa xử lý?
- Có thay đổi format hàng loạt vô nghĩa?
- Có mất translation/text?
- Có logic quyền bị nới lỏng?
- Có query thiếu tenant filter?
- Có error path chưa xử lý?

Không commit nếu diff chưa hiểu 100%.

---

# 16. COMMIT / BRANCH / PR

## 16.1. Commit

Mỗi commit nên có một mục tiêu logic rõ.

Ví dụ:

- `fix(exam): validate question availability before loading exam`
- `fix(scoring): make submission idempotent`
- `perf(question-bank): reuse validated cache across exam loads`

Không dùng commit message mơ hồ kiểu `update`, `fix bug`, `done`.

## 16.2. Pull Request

PR phải mô tả:

- vấn đề,
- root cause,
- giải pháp,
- file/module ảnh hưởng,
- test đã chạy,
- rủi ro,
- rollback.

---

# 17. TRIỂN KHAI PRODUCTION

Deployment không kết thúc ở “build xanh”.

## GATE DEPLOY

Chỉ deploy khi:

- code review/diff review đạt,
- test cần thiết đạt,
- build production đạt,
- migration được kiểm tra,
- secret/config đúng môi trường,
- có rollback plan.

## 17.1. Không deploy mù

Trước deploy cần biết:

- commit nào sẽ lên,
- environment nào,
- database/tenant nào liên quan,
- migration nào chạy,
- feature nào thay đổi.

## 17.2. Rollback

Mỗi thay đổi P0/P1 phải trả lời được:

> “Nếu 5 phút sau Production lỗi, quay lại bằng cách nào?”

Rollback có thể là:

- revert commit,
- deploy phiên bản trước,
- feature flag off,
- rollback migration an toàn,
- restore branch/snapshot DB khi cần.

---

# 18. XÁC MINH SAU DEPLOY

Sau deploy phải thực hiện smoke test ở Production hoặc môi trường tương đương phù hợp.

Tối thiểu kiểm tra:

1. App load được.
2. Đăng nhập được theo role liên quan.
3. Chức năng vừa sửa hoạt động.
4. Chức năng liền kề không lỗi.
5. API không phát sinh 5xx bất thường.
6. Không lỗi console nghiêm trọng.
7. Dữ liệu ghi đúng tenant.
8. Không có truy cập vượt quyền.

Đối với P0:

- thực hiện test tình huống thực tế có kiểm soát,
- kiểm tra DB/audit record nếu cần,
- xác minh kết quả cuối cùng.

---

# 19. OBSERVABILITY / LOGGING

Log phải đủ để điều tra nhưng không làm lộ dữ liệu nhạy cảm.

Mỗi luồng quan trọng nên có correlation/request id khi phù hợp.

Các sự kiện quan trọng cần audit phù hợp:

- đăng nhập thất bại/thành công,
- thay đổi quyền,
- tạo/sửa/xóa đề,
- xóa kết quả,
- nộp bài,
- chấm bài,
- thay đổi điểm thủ công,
- bulk update,
- tenant routing lỗi.

Không log password, token, secret, answer key không cần thiết.

---

# 20. STOP-THE-LINE — TRƯỜNG HỢP PHẢI DỪNG TRIỂN KHAI

Không được deploy nếu phát hiện một trong các trường hợp:

- Có nguy cơ chấm sai điểm.
- Có nguy cơ mất bài làm.
- Có nguy cơ lẫn dữ liệu tenant.
- Có thể xem/sửa dữ liệu trái quyền.
- Migration chưa có rollback hoặc chưa hiểu tác động.
- Test P0 thất bại.
- Build production thất bại.
- Không xác định được root cause nhưng đang sửa vùng nhạy cảm.
- Có secret trong source/diff.
- Có DELETE/UPDATE hàng loạt chưa xác minh phạm vi.

Trong trường hợp này: **dừng deploy, giữ hệ thống ổn định, tiếp tục phân tích.**

---

# 21. QUY TRÌNH XỬ LÝ BUG CHUẨN

1. Tái hiện lỗi.
2. Thu thập log/network/state liên quan.
3. Xác định điều kiện xảy ra.
4. Lần theo luồng code.
5. Xác định root cause.
6. Viết test hoặc scenario chứng minh lỗi.
7. Sửa nhỏ nhất tại đúng tầng.
8. Chạy test bug.
9. Chạy regression test vùng lân cận.
10. Review diff.
11. Build.
12. Deploy có rollback.
13. Re-test Production.
14. Báo cáo bằng chứng.

Không được đảo thứ tự thành “thấy lỗi → sửa thử → deploy thử”.

---

# 22. QUY TRÌNH PHÁT TRIỂN TÍNH NĂNG MỚI

1. Viết acceptance criteria.
2. Xác định permission matrix.
3. Xác định data model.
4. Xác định API contract.
5. Xác định UI states.
6. Xác định failure states.
7. Xác định concurrency/idempotency.
8. Xác định security/tenant boundary.
9. Triển khai backend trước hoặc contract-first khi phù hợp.
10. Triển khai frontend.
11. Test unit/integration/e2e phù hợp.
12. Review performance.
13. Review security.
14. Review accessibility/mobile.
15. Deploy + smoke test.

---

# 23. QUY TRÌNH TỐI ƯU HIỆU NĂNG

Không tối ưu bằng cảm giác.

1. Đo baseline.
2. Xác định bottleneck.
3. Tối ưu đúng bottleneck.
4. Đo lại.
5. So sánh before/after.
6. Kiểm tra tính đúng đắn không bị giảm.

Đặc biệt với loading câu hỏi:

- tránh download lặp nếu cache còn hợp lệ,
- tránh request theo từng câu nếu có thể batch,
- server pagination,
- chỉ tải dữ liệu cần cho tab đang mở,
- preload có chọn lọc khi người dùng sắp cần,
- invalidate cache đúng sự kiện.

Không đánh đổi tính chính xác đề thi để lấy tốc độ.

---

# 24. QUY TẮC PHÂN QUYỀN CẦN KIỂM TRA CHO MỖI TÍNH NĂNG

Mỗi API/chức năng mới phải trả lời đủ:

| Câu hỏi | Bắt buộc |
|---|---|
| Admin được làm gì? | Có |
| Giáo viên được làm gì? | Có |
| Giáo viên có bị giới hạn theo owner/lớp/đơn vị không? | Có |
| Học sinh được làm gì? | Có |
| Có kiểm tra ở server không? | Có |
| Có tenant filter không? | Có |
| Có thể sửa ID trên URL/body để truy cập dữ liệu khác không? | Phải test |

---

# 25. DEFINITION OF DONE — CHỈ ĐƯỢC COI LÀ XONG KHI

Một task chỉ được đánh dấu **DONE** nếu tất cả mục liên quan đều đạt:

- [ ] Đã đọc `AGENTS.md`.
- [ ] Đã hiểu yêu cầu và tiêu chí nghiệm thu.
- [ ] Đã xác định root cause hoặc thiết kế đúng tầng.
- [ ] Đã kiểm tra ảnh hưởng module liên quan.
- [ ] Đã sửa với diff tối thiểu.
- [ ] Không làm thay đổi chức năng ngoài phạm vi.
- [ ] Permission/tenant đã được kiểm tra.
- [ ] Validation phía server đầy đủ.
- [ ] Concurrency/idempotency được xem xét.
- [ ] Test chính đã đạt.
- [ ] Regression test đã đạt.
- [ ] Build/typecheck/lint phù hợp đã đạt.
- [ ] Đã đọc lại diff.
- [ ] Không có secret/debug code.
- [ ] Có rollback plan nếu P0/P1.
- [ ] Deploy đúng environment.
- [ ] Smoke test sau deploy đạt.
- [ ] Báo cáo cuối cùng dựa trên bằng chứng.

Nếu một mục bắt buộc chưa đạt thì trạng thái là **CHƯA HOÀN TẤT**.

---

# 26. MẪU BÁO CÁO SAU MỖI TASK

Mỗi lần hoàn thành công việc, báo cáo ngắn gọn theo mẫu:

## A. Vấn đề

Mô tả lỗi/yêu cầu thực tế.

## B. Nguyên nhân gốc

Nêu đúng tầng gây lỗi, không chỉ triệu chứng.

## C. Thay đổi đã thực hiện

- File/module nào.
- Logic nào thay đổi.
- Logic nào giữ nguyên.

## D. Kiểm thử

- Test nào đã chạy.
- Kết quả.
- Edge case nào đã kiểm tra.

## E. An toàn

- Permission/tenant.
- Data integrity.
- Concurrency/idempotency.
- Security.

## F. Triển khai

- Commit/version.
- Environment.
- Trạng thái deploy.

## G. Xác minh Production

Mô tả smoke test và bằng chứng.

## H. Rủi ro còn lại

Nếu không còn rủi ro đã biết, ghi: **“Không phát hiện rủi ro còn lại trong phạm vi đã kiểm thử.”**

Không được ghi “100% không lỗi” nếu chưa thể chứng minh toàn bộ trạng thái hệ thống.

---

# 27. MỆNH LỆNH ƯU TIÊN KHI CÁC QUY TẮC XUNG ĐỘT

Thứ tự ưu tiên:

1. **Không mất dữ liệu.**
2. **Không chấm sai / không làm mất quyền lợi học sinh.**
3. **Không lộ hoặc lẫn dữ liệu tenant.**
4. **Không vượt quyền.**
5. **Không làm gián đoạn Production.**
6. **Giữ tương thích chức năng hiện có.**
7. **Đúng yêu cầu nghiệp vụ.**
8. **Hiệu năng.**
9. **Thẩm mỹ/refactor.**

Nếu tối ưu tốc độ xung đột với độ chính xác, chọn độ chính xác.

Nếu tiện lợi xung đột với bảo mật, chọn bảo mật.

Nếu refactor đẹp hơn nhưng tăng rủi ro, không refactor trong task đó.

---

# 28. QUY TẮC DÀNH RIÊNG CHO AI/CODING AGENT

AI làm việc với repository này phải:
1. Đọc file này đầu tiên.
2. Không giả định code đang giống mô tả; phải kiểm tra code thực tế.
3. Không tuyên bố đã chạy test/build/deploy nếu chưa thực sự chạy.
4. Không giả lập kết quả Production.
5. Không xóa code không hiểu.
6. Không ghi đè thay đổi không liên quan.
7. Không tạo workaround tạm nếu có thể sửa root cause an toàn.
8. Không “bù” dữ liệu đề thi hoặc chấm điểm bằng suy đoán.
9. Luôn kiểm tra tenant + permission ở backend.
10. Trước khi deploy P0/P1, phải review diff và có rollback.
11. Sau deploy, phải xác minh chức năng thực tế.
12. Nếu phát hiện rủi ro nghiêm trọng ngoài yêu cầu, phải báo rõ trước khi tiếp tục deploy.

### Câu tự kiểm bắt buộc trước khi kết thúc

AI phải tự trả lời:

- Tôi có hiểu root cause không?
- Tôi có sửa đúng tầng không?
- Tôi có vô tình đổi hành vi khác không?
- Có race condition không?
- Có request lặp không?
- Có tenant leak không?
- Có IDOR không?
- Có trường hợp học sinh bị mất quyền lợi không?
- Có dữ liệu nào có thể mất không?
- Có thể rollback không?
- Tôi có bằng chứng để nói “đã xong” không?

Nếu bất kỳ câu trả lời nào chưa rõ, task chưa đủ điều kiện đóng.

---

# 29. TƯ DUY VẬN HÀNH CHUYÊN NGHIỆP

Mục tiêu của dự án không phải “sửa thật nhanh”, mà là:

> **Thay đổi có kiểm soát, bằng chứng rõ ràng, rủi ro thấp, rollback được và không gây bất ngờ cho Production.**

Quy trình chuẩn:

**Understand → Inspect → Model impact → Implement minimally → Validate → Review → Deploy safely → Verify → Observe → Report**

Mọi task, dù nhỏ, đều phải tuân theo tinh thần này.

---

# 30. QUY TẮC BẮT ĐẦU PHIÊN LÀM VIỆC

Khi bắt đầu một phiên làm việc mới với dự án, thứ tự mặc định là:

1. Đọc `AGENTS.md`.
2. Đọc yêu cầu mới nhất của chủ dự án.
3. Kiểm tra trạng thái repository/branch.
4. Đọc các file liên quan trước khi sửa.
5. Xác định mức rủi ro P0–P3.
6. Xác định tiêu chí nghiệm thu.
7. Thực hiện thay đổi tối thiểu.
8. Chạy kiểm thử tương ứng.
9. Review diff.
10. Commit/PR/deploy theo yêu cầu.
11. Smoke test.
12. Báo cáo chính xác, không phóng đại.

**Không bỏ qua bước 1.**

---

## KẾT LUẬN

File này là **quy chế vận hành sống (living engineering policy)** của dự án.

Khi phát hiện một loại lỗi mới, một bài học Production mới hoặc một quy tắc nghiệp vụ mới có tính lâu dài, cần cập nhật lại `AGENTS.md` để những lần làm việc sau không lặp lại sai sót.

**An toàn dữ liệu, độ chính xác chấm thi, quyền lợi học sinh, phân quyền và cách ly tenant luôn có mức ưu tiên cao nhất.**