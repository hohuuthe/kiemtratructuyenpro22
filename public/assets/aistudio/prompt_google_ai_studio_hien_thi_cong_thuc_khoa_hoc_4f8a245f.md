# Bộ Prompt Chuẩn Cho Google AI Studio: Hiển Thị Chuẩn & Đẹp 100% Bộ Kiểm Thử 551 Công Thức Khoa Học Đa Môn

Tài liệu này cung cấp **2 bộ Prompt chuyên dụng** để bạn dán trực tiếp vào **Google AI Studio** tùy theo mục tiêu sử dụng của dự án:

1. **PHẦN 1 — Prompt Xây Dựng Ứng Dụng / Component Hiển Thị Công Thức (Dành cho AI Studio Build / Code Generation):** Dùng khi bạn yêu cầu Google AI Studio viết mã nguồn (React / TypeScript / HTML / JS) cho website hiển thị toàn bộ **516 công thức khoa học + 25 ca lỗi có chủ đích (`NEG`) + 10 ca kiểm thử Delimiter (`DEL`)**.
2. **PHẦN 2 — System Instructions Cho Mô Hình Gemini (Dành cho ô System Instructions trên Google AI Studio):** Dùng khi bạn cấu hình AI Assistant trả lời các bài toán Toán, Lý, Hóa, Sinh, Kỹ thuật, Kinh tế, Y sinh với định dạng LaTeX chuẩn xuất bản.

## PHẦN 1: Prompt Yêu Cầu Google AI Studio Viết Code Hiển Thị Chuẩn 100% (Copy & Paste)

Hãy sao chép toàn bộ nội dung trong khối dưới đây và dán vào khung chat của **Google AI Studio**:

```markdown
Bạn là Principal Frontend Architect và Chuyên gia Chế bản Toán học (LaTeX/KaTeX/MathJax).
Hãy xây dựng cho tôi một mô-đun/ứng dụng web hoàn chỉnh có khả năng phân tích cú pháp (parse), tiền xử lý làm sạch (sanitize & normalize) và hiển thị (render) đẹp chuẩn xuất bản khoa học cho toàn bộ "BỘ KIỂM THỬ CÔNG THỨC KHOA HỌC ĐA MÔN" (gồm 516 công thức thuộc 10 lĩnh vực Toán, Lý, Hóa, Sinh, Tin học, Kỹ thuật, Địa lý, Kinh tế, Y sinh, Thiên văn; 1032 trường hợp inline/display; 25 ca kiểm thử lỗi có chủ đích NEG-001..NEG-025; và 10 ca kiểm thử trình phân tích văn bản DEL-001..DEL-010).

Để đảm bảo tỷ lệ hiển thị thành công 100% và đạt thẩm mỹ như bản in LaTeX chuyên nghiệp, bạn BẮT BUỘC phải triển khai đầy đủ 5 tầng kỹ thuật sau đây (không bỏ sót bất kỳ quy tắc nào):

### TẦNG 1: Thư viện Render & Extension Bắt Buộc
1. Sử dụng **KaTeX** (phiên bản `>= 0.16.9`) kết hợp đầy đủ:
   - `katex.min.css` và `katex.min.js`
   - Extension Hóa học bắt buộc: `contrib/mhchem.min.js` (để biên dịch toàn bộ 48+ lệnh `\ce{...}` trong Hóa học, Sinh học và Kiểm thử biên như `\ce{H2O}`, `\ce{SO4^{2}-}`, `\ce{2AgCl ->[h\nu] 2Ag + Cl2}`, `\ce{^{238}_{92}U -> ^{234}_{90}Th + ^{4}_2He}`).
   - Font chữ hỗ trợ tiếng Việt trong chế độ toán: Nhúng Google Fonts `Noto Serif` và `JetBrains Mono` để hiển thị trọn vẹn các dấu tiếng Việt nằm trong `\text{...}` và `\mathrm{...}` (ví dụ: `W_{\mathrm{đ}}`, `m_{\mathrm{hạt\ nhân}}`, `N_{\mathrm{tái\ tổ\ hợp}}`, `\text{‰}`).
2. Cấu hình lệnh gọi `katex.renderToString(latex, options)` với:
   - `displayMode: true` cho chế độ Display (hoặc cột hiển thị công thức chính) để phân số, tích phân, tổng sigma, giới hạn và ma trận có kích thước lớn, rõ nét như `\displaystyle`.
   - `throwOnError: false` và `strict: "ignore"` để không làm sập trang khi gặp ký tự Unicode tiếng Việt trong `\mathrm{...}` hoặc các ca kiểm thử lỗi `NEG`.
   - `trust: false` để chặn hoàn toàn việc thực thi mã độc/XSS từ trong LaTeX.
   - Khai báo `macros` bổ trợ cho các môi trường hoặc lệnh đặc thù:
     ```js
     macros: {
       "\\alignat": "\\alignedat",
       "\\endalignat": "\\endalignedat"
     }
     ```

### TẦNG 2: Bộ Tiền Xử Lý Làm Sạch & Chuẩn Hóa Dữ Liệu Nguồn (`normalizeLatexInput`)
Trước khi đưa chuỗi vào trình phân tích hoặc KaTeX, BẮT BUỘC chạy hàm tiền xử lý theo đúng thứ tự sau để khắc phục các lỗi biến dạng dữ liệu thực tế trong bộ kiểm thử:

1. **Bảo vệ chống XSS tuyệt đối (`NEG-012`, `NEG-013`):**
   - Không bao giờ gán trực tiếp chuỗi đầu vào thô vào `innerHTML`.
   - Escape toàn bộ thẻ HTML nhạy cảm (`<script>`, `<img ... onerror=...>`, `<iframe>`, `<svg>`) thành thực thể an toàn (`&lt;`, `&gt;`) trước khi xử lý Markdown/LaTeX.

2. **Khôi phục ký tự điều khiển JavaScript bị nuốt (`NEG-009`, `NEG-023`):**
   - Khi dữ liệu nhập từ chuỗi JS/JSON chưa dùng raw string, `\frac` dễ bị biến thành ký tự Form Feed (`\x0c` + `rac`), `\text`/`\theta`/`\times`/`\to`/`\tau`/`\tan` bị biến thành Tab (`\x09` + phần dư), `\nabla`/`\neg`/`\ne`/`\nu`/`\nexists` bị biến thành Newline (`\x0a` + phần dư), `\right`/`\rho`/`\rightarrow` bị biến thành Carriage Return (`\x0d` + phần dư).
   - Viết bước khôi phục tự động:
     ```js
     str = str
       .replace(/\x0c(?=[a-zA-Z])/g, "\\f")
       .replace(/\x09(?=[a-zA-Z])/g, "\\t")
       .replace(/\x0a(?=(?:abla|eg|e\b|u\b|exists|ot\b|atural|mid))/g, "\\n")
       .replace(/\x0d(?=(?:ight|ho\b|ceil|floor|angle))/g, "\\r");
     ```

3. **Tách dòng bị dính khi sao chép từ Word (`MAT-079` & `MAT-080`):**
   - Tự động phát hiện và tách mẫu dính dòng:
     `MAT-079 ... \angle ABC=$60^{\circ}\text{M}$AT-080` thành 2 bản ghi độc lập:
     - `MAT-079`: Tên = `Góc và ký hiệu hình học`, Công thức = `\angle ABC=60^{\circ}`
     - `MAT-080`: Tên = `Song song và vuông góc`, Công thức = `a\parallel b,\quad c\perp d`

4. **Làm sạch văn bản tiếng Việt bị dính dấu `\` trong tên công thức:**
   - Trong cột mô tả/tên công thức tiếng Việt, chuyển các chuỗi bị lỗi khi xuất từ Word như `\chiếu` -> `chiếu`, `\chiều` -> `chiều`, `\chi phí` -> `chi phí`, `\chi tiêu` -> `chi tiêu`, `\phi tương đối tính` -> `phi tương đối tính`.
   - Với các ký hiệu toán học nằm trong tên công thức (`Tổng \sigma`, `Sin và \cos`, `Định lý \sin`, `Độ phức tạp n \log n`, `Độ phức tạp \Omega`, `Độ phức tạp \Theta`, `Alpha \beta \gamma \delta`), tự động bọc các lệnh LaTeX đó vào inline math `\(...\)` để chúng hiển thị thành ký hiệu toán học đẹp thay vì in chữ thô.

5. **Khôi phục dấu ngắt dòng `\\` bị mất thành `\` đơn trong môi trường đa dòng (`MAT-022`, `MAT-086`, `MAT-088`, `STR-003`, `STR-022`, `STR-030`):**
   - Bên trong các môi trường `\begin{cases}...\end{cases}`, `\begin{pmatrix}...\end{pmatrix}`, `\begin{bmatrix}...\end{bmatrix}`, `\begin{matrix}...\end{matrix}`, `\begin{aligned}...\end{aligned}`, `\begin{array}...\end{array}`:
     - Thay thế `\hline` đứng sau ký tự không phải `\` thành `\\\hline` (sửa `STR-030`: `&A&B\hline A&1&0\B&0&1` -> `&A&B\\\hline A&1&0\\B&0&1`).
     - Thay thế dấu `\` đơn (không phải lệnh LaTeX hợp lệ mà là đầu dòng mới như `\x-3y`, `\c&d`, `\f'(x)`, `\f''(x)`, `\P&=UI`, `\E&=Pt`, `\B&0&1`) thành dấu ngắt dòng chuẩn `\\`.

6. **Loại bỏ dấu `$` lồng thừa bên trong biểu thức đã là công thức (`MAT-068`, `MAT-079`, `STR-006`, `STR-012`, `DEL-007`):**
   - Khi chuỗi đã ở trong chế độ công thức (hoặc nằm trong `\( ... \)`), loại bỏ cặp `$` bao quanh cụm độ C/độ góc như `$180^{\circ}$` -> `180^{\circ}`, `$450^{\circ}$` -> `450^{\circ}`, `$25^{\circ}$` -> `25^{\circ}`, `$20^{\circ}$` -> `20^{\circ}`.

7. **Chuẩn hóa dấu tổ hợp Unicode trong toán học (`NEG-024`):**
   - Chuyển ký tự kết hợp Unicode (combining diacritical marks) sang lệnh LaTeX tương ứng:
     - `([a-zA-Z])\u0304` (như `x̄`) -> `\bar{$1}`
     - `([a-zA-Z])\u0302` (như `ŷ`) -> `\hat{$1}`
     - `([a-zA-Z])\u0303` (như `x̃`) -> `\tilde{$1}`
     - `([a-zA-Z])\u20d7` -> `\vec{$1}`

8. **Chuyển đổi môi trường `alignat` sang `alignedat` khi render đơn lẻ (`NEG-025`):**
   - Chuyển `\begin{alignat}{2}...\end{alignat}` thành `\begin{alignedat}{2}...\end{alignedat}` để KaTeX render mượt mà trong cả chế độ inline lẫn display.

### TẦNG 3: Bộ Phân Tích Văn Bản Hỗn Hợp Delimiter + Markdown + Tiền Tệ (`DEL-001` – `DEL-010`, `NEG-011`, `NEG-022`)
Đối với các chuỗi kết hợp văn bản tiếng Việt, Markdown và nhiều công thức toán học:
1. **Phân biệt chính xác dấu `$` tiền tệ và `$` toán học (`NEG-011`, `DEL-009`, `STR-027`):**
   - Dấu `\$` đã escape phải được giữ nguyên là ký tự `$` hiển thị thường.
   - Nếu một dấu `$` theo sau bởi chữ số và khoảng trắng/dấu câu tiếng Việt (ví dụ: `Giá vé $20, giảm còn $15` hoặc `Giá $20, không phải định dạng toán học`), tuyệt đối KHÔNG coi đó là delimiter mở công thức toán.
   - Chỉ nhận diện `$ ... $` là inline math khi:
     - Sau dấu `$` mở không phải là khoảng trắng,
     - Trước dấu `$` đóng không phải là khoảng trắng,
     - Và nội dung bên trong không phải là hai con số tiền tệ cách nhau bởi văn bản thường.
2. **Thứ tự ưu tiên tách token (Tokenizer Priority):**
   - Ưu tiên 1: Display math `$$ ... $$` và `\[ ... \]` (`DEL-003`, `DEL-004`, `DEL-008`).
   - Ưu tiên 2: Inline math `\( ... \)` (`DEL-001`, `DEL-005`, `DEL-006`, `DEL-007`, `DEL-008`, `DEL-010`).
   - Ưu tiên 3: Inline math `$ ... $` hợp lệ (`DEL-002`).
   - Ưu tiên 4: Chỉ áp dụng định dạng Markdown (`**in đậm**`, `_in nghiêng_`) và chuyển `\n` thành `<br/>` (`DEL-010`) trên các **text token nằm ngoài công thức toán** để dấu `_` (chỉ số dưới) và `*` trong LaTeX không bao giờ bị Markdown làm hỏng (`NEG-022`, `DEL-006`).

### TẦNG 4: Xử Lý Thông Minh Cho 25 Ca Kiểm Thử Lỗi Có Chủ Đích (`NEG-001` – `NEG-025`)
Không để bất kỳ ca kiểm thử `NEG` nào hiển thị khối lỗi đỏ thô kệch làm vỡ giao diện. Với mỗi mục trong nhóm `NEG`:
1. Hiển thị đồng thời **2 phần rõ ràng**:
   - **Chuỗi kiểm thử gốc (`Raw Input`)**: Đặt trong thẻ `<code>` monospace kèm nhãn phân loại lỗi (ví dụ: `Cú pháp thiếu ngoặc`, `Bảo mật XSS`, `Plugin chuyên dụng`, `Ký tự điều khiển`).
   - **Bản chuẩn hóa / Kết quả xử lý an toàn (`Normalized / Safe Output`)**:
     - Với lỗi thiếu ngoặc đóng (`NEG-001` `\frac{a}{b`, `NEG-003` `\sqrt{x+1`, `NEG-016` `{a+b`, `NEG-017` `\ce{2H2 + O2 -> 2H2O`, `NEG-021` `$\frac12`): Tự động cân bằng ngoặc hoặc đóng môi trường (`NEG-005` thêm `\end{matrix}`, `NEG-006` thêm `\end{cases}`) để hiển thị bản công thức đã khắc phục kèm chú thích nhỏ chỉ rõ lỗi đã sửa.
     - Với lỗi thiếu đối số (`NEG-002` `\frac{a}`): Bổ sung `\square` vào mẫu số (`\frac{a}{\square}`) để minh họa vị trí đối số bị thiếu.
     - Với lỗi mất dấu `\` (`NEG-007`, `NEG-008`) hoặc thừa ngoặc đóng (`NEG-015`): Hiển thị bản khôi phục `\frac{a}{b}`, `\text{kg}`, `a+b`.
     - Với các gói đồ họa ngoài phạm vi LaTeX toán học (`NEG-018` `\chemfig{*6(-=-=-=)}`, `NEG-019` `tikzpicture`, `NEG-020` SMILES `c1ccccc1`): Hiển thị badge kỹ thuật giải thích gói/renderer cần thiết (như `chemfig`, `TikZ`, `RDKit/SmilesDrawer`) kèm công thức phân tử/biểu diễn chuẩn tương đương ($\mathrm{C_6H_6}$).

### TẦNG 5: Chuẩn Thẩm Mỹ Giao Diện & Typography (Publication-Grade UI/CSS)
1. **Typography cho Công thức & Tiếng Việt:**
   - Áp dụng CSS cho `.katex .mtext` và `.katex .textrm`:
     ```css
     .katex {
       font-size: 1.08em;
     }
     .katex .mtext, .katex .textrm {
       font-family: 'Noto Serif', 'Times New Roman', serif !important;
     }
     ```
     Quy tắc này đảm bảo mọi chữ tiếng Việt có dấu trong chỉ số dưới (`W_{\mathrm{đ}}`, `m_{\mathrm{hạt\ nhân}}`, `\mathrm{Sản\ lượng}`) hiển thị đồng bộ, sắc nét, không bị lỗi font.
2. **Khoảng đệm dọc chống dính dòng (Vertical Breathing Room):**
   - Các công thức có phân số nhiều tầng (`MAT-004`, `MAT-005`, `GEN-031`, `STR-001`), tích phân và ma trận phải có `padding: 12px 16px` trong ô bảng để tử số và mẫu số không bao giờ chạm vào đường kẻ ngang của dòng trên/dưới.
   - Bật thanh cuộn ngang mượt (`overflow-x: auto`) cho các công thức siêu dài trên màn hình nhỏ để không bao giờ bị tràn lề.
3. **Tính năng Tương tác & Kiểm thử:**
   - Có thanh tìm kiếm nhanh theo Mã (`MAT-001`, `CHE-024`, `STR-001`...), lọc theo từng Môn học (14 nhóm) và chế độ chuyển đổi xem **Inline vs Display** (đáp ứng đủ 1032 trường hợp kiểm thử inline/display).
   - Mỗi dòng công thức hiển thị rõ: **Mã định danh**, **Tên công thức**, **Bản hiển thị chuẩn (Rendered View)** và **Mã nguồn LaTeX chuẩn (Clean LaTeX Source)** kèm nút Copy 1 chạm.
```

## PHẦN 2: System Instructions Cho Model Gemini Trên Google AI Studio (Dành Cho Chatbot Giải Toán / Khoa Học)

Nếu dự án của bạn trên Google AI Studio gọi Gemini API để **sinh nội dung có chứa công thức khoa học**, hãy dán đoạn sau vào ô **System Instructions** trong Google AI Studio để mô hình luôn xuất ra mã LaTeX sạch 100%, không bao giờ mắc các lỗi như trong nhóm `NEG`:

```markdown
### QUY TẮC BẮT BUỘC KHI XUẤT CÔNG THỨC TOÁN & KHOA HỌC (LATEX STANDARDIZATION RULES)

Khi trả lời bất kỳ nội dung nào thuộc Toán học, Vật lý, Hóa học, Sinh học, Tin học, Kỹ thuật, Địa lý, Kinh tế, Y sinh và Thiên văn, bạn BẮT BUỘC tuân thủ nghiêm ngặt các quy tắc định dạng LaTeX sau:

1. **Bao đóng công thức (Delimiters) nhất quán:**
   - Sử dụng `$ ... $` (hoặc `\( ... \)`) cho công thức nội dòng (inline math). Không để khoảng trắng sát sau dấu `$` mở hoặc sát trước dấu `$` đóng.
   - Sử dụng `$$ ... $$` (hoặc `\[ ... \]`) trên dòng riêng cho công thức khối (display math), hệ phương trình, ma trận, biến đổi nhiều dòng và các phân số nhiều tầng.
   - Tuyệt đối KHÔNG lồng dấu `$` bên trong một biểu thức đã ở trong chế độ toán (Ví dụ: viết `$180^{\circ} = \pi\,\mathrm{rad}$`, KHÔNG viết `$$180^{\circ}$ = \pi\,\mathrm{rad}$`).
   - Khi viết số tiền đô-la trong văn bản thường, luôn dùng `\$` (ví dụ: `\$20`) hoặc viết `20 USD` để không xung đột với delimiter toán học.

2. **Bảo toàn tiếng Việt và chỉ số có dấu:**
   - Không bao giờ gõ dính dấu `\` trước từ tiếng Việt bắt đầu bằng `ch`, `ph`, `th`, `tr`, `s`, `c` (như `chiếu`, `chiều`, `chi phí`, `phi tương đối`).
   - Khi đưa từ tiếng Việt có dấu vào chỉ số dưới hoặc trong công thức, luôn đặt trong `\text{...}` hoặc `\mathrm{...}` có khoảng trắng chuẩn (ví dụ: `W_{\text{đ}}`, `m_{\text{hạt nhân}}`, `\eta = \frac{P_{\text{ra}}}{P_{\text{vào}}} \times 100\%`).

3. **Cấu trúc đa dòng & Ma trận chuẩn xác:**
   - Trong các môi trường `\begin{cases}...\end{cases}`, `\begin{pmatrix}...\end{pmatrix}`, `\begin{bmatrix}...\end{bmatrix}`, `\begin{aligned}...\end{aligned}`, `\begin{array}...\end{array}`, luôn dùng đầy đủ hai dấu gạch chéo ngược `\\` để ngắt dòng (không bao giờ dùng một dấu `\`).
   - Kiểm tra cân bằng 100% số lượng ngoặc nhọn `{ }`, `\left( ... \right)`, `\left[ ... \right]`, `\left\{ ... \right\}` và cặp `\begin{...} ... \end{...}` trước khi xuất câu trả lời.

4. **Định dạng Hóa học, Đơn vị SI và Số thập phân:**
   - Với công thức hóa học và phương trình phản ứng: sử dụng `\ce{...}` (chuẩn `mhchem`, ví dụ: `$\ce{2H2 + O2 -> 2H2O}$`, `$\ce{N2 + 3H2 <=> 2NH3}$`, `$\ce{SO4^{2}-}$`) hoặc LaTeX chuẩn dùng `\mathrm{...}`, `\longrightarrow`, `\rightleftharpoons`, `\xrightarrow{...}`, `\downarrow`, `\uparrow`.
   - Với đơn vị đo lường SI: luôn dùng khoảng trắng hẹp `\,` trước đơn vị đứng thẳng `\mathrm{...}` (ví dụ: `$a = 9{,}81\,\mathrm{m/s^2}$`, `$c \approx 4200\,\mathrm{J/(kg\cdot K)}$`).
   - Với số thập phân dùng dấu phẩy theo chuẩn Việt Nam: bọc dấu phẩy trong `{,}` (ví dụ: `$3{,}14159$`) để LaTeX không chèn khoảng trắng thừa sau dấu phẩy.
   - Luôn escape dấu phần trăm là `\%` khi nằm trong chế độ toán học (ví dụ: `$100\%$`).
```

## PHẦN 3: Bảng Tóm Tắt Các Lỗi Ẩn Trong Bộ 551 Công Thức Mà Prompt Trên Đã Tự Động Xử Lý

| Nhóm lỗi thực tế trong dữ liệu gốc | Mã công thức bị ảnh hưởng | Cơ chế xử lý trong Prompt |
| :--- | :--- | :--- |
| **Dính 2 công thức trên cùng 1 dòng** | `MAT-079` và `MAT-080` (`\angle ABC=$60^{\circ}\text{M}$AT-080`) | Tầng 2 (Mục 3) tự động tách thành 2 bản ghi độc lập và sửa lại `60^{\circ}` |
| **Mất dấu `\` thứ hai trong `\\` ngắt dòng** | `MAT-022`, `MAT-086`, `MAT-088`, `STR-003`, `STR-022`, `STR-030` | Tầng 2 (Mục 5) tự động khôi phục `\\` trong `cases`, `pmatrix`, `aligned`, `array` |
| **Từ tiếng Việt biến thành lệnh LaTeX** | Intro (`\chiếu`), `PHY-067`, `PHY-085` (`\chiều`), `PHY-087` (`\phi`), `CS-019`, `ENG-002`, `ECO-010` | Tầng 2 (Mục 4) tự động đổi về từ tiếng Việt chuẩn và bọc math cho ký hiệu toán |
| **Dấu `$` lồng thừa trong biểu thức toán** | `MAT-068`, `MAT-079`, `STR-006`, `STR-012`, `DEL-007` | Tầng 2 (Mục 6) tự động loại bỏ cặp `$` thừa quanh `^{\circ}` |
| **48 công thức hóa học dùng `\ce{...}`** | `CHE-001`..`CHE-035`, `CHE-042`..`048`, `CHE-059`..`068`, `BIO-021`..`022`, `BIO-041`..`042`, `STR-006`..`008` | Tầng 1 (Mục 1) tích hợp `mhchem.min.js` để hỗ trợ toàn bộ cú pháp `\ce{...}` |
| **Chữ tiếng Việt có dấu trong `\mathrm{...}`** | `PHY-010` (`W_{\mathrm{đ}}`), `PHY-081` (`m_{\mathrm{hạt\ nhân}}`), `BIO-011`, `GEO-002`..`007`, `MED-005`..`015` | Tầng 1 & Tầng 5 cấu hình `strict: "ignore"` và ép font `Noto Serif` cho `.katex .textrm` |
| **25 ca lỗi cú pháp & XSS (`NEG-001`..`025`)** | Toàn bộ nhóm `NEG` | Tầng 2 (Mục 1, 2, 7, 8) & Tầng 4 chặn XSS, khôi phục control char và hiển thị song song mã lỗi + bản chuẩn hóa |
| **10 ca Delimiter & Tiền tệ (`DEL-001`..`010`)** | Toàn bộ nhóm `DEL` và `NEG-011`, `NEG-022` | Tầng 3 ưu tiên tách token Toán trước khi render Markdown và nhận diện `$20` tiền tệ |
