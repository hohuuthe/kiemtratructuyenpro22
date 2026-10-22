# NGHIEM THU DONG BO HIEN THI CONG THUC KHOA HOC - 22/10/2026

Trang thai: NHANH THU NGHIEM - CHUA DUOC PHE DUYET PRODUCTION.
Chuan doi chieu: giao dien lam bai hoc sinh hien hanh. Khong thay doi schema DB, diem thi hay quyen xem dap an.

## Danh muc 14 nhom

| # | Nhom | Cach dong bo / kiem tra |
|---|---|---|
| 1 | Ngan hang cau hoi | Noi dung va A-D dung renderScientificContent; queue MathJax dung chung |
| 2 | Them cau hoi | Xem truoc cho content, options A-D, answer ngay ben duoi truong nhap |
| 3 | Sua cau hoi | Xem truoc tuong tu, khong sua gia tri cua input |
| 4 | Nhap Word/Excel | Giu nguyen data parser hien co; cac cong thuc da nhan duoc xuat hien qua renderer dung chung. Can nghiem thu file nhap thuc te |
| 5 | Xem truoc nhap | RenderImportPreview dung formatContent + unified typesetter; form editPending co preview |
| 6 | AI tao cau hoi | Preview AI dung formatContent; sua cau AI co live preview |
| 7 | Quan ly de thi | Duong xem truoc noi dung su dung renderer; duong xuat docx/pdf chung nguon TeX |
| 8 | Hoc sinh lam bai | Giu ham formatContent, chuyen xu ly MathJax cho adapter dung chung; kiem tra hoi quy |
| 9 | Ket qua hoc sinh | Cac cong thuc trong cau hoi, dap an va bai lam duoc formatContent va queueMathJax |
| 10 | Xep hang/xem chi tiet | Cung renderer va queueMathJax khi mo modal chi tiet |
| 11 | Xuat Word DOCX | docx/math latexToMath cho native OMML; khi khong ho tro, giu nguyen nguon TeX |
| 12 | Xuat PDF | Dung renderScientificContent va typesetScientificMath; bao loi neu fallback khong thanh cong |
| 13 | Excel va bao cao | Excel giu nguyen TeX trong o; DOCX bao cao/ngan hang dung native Word Math |
| 14 | Thu vien va huong dan | Bo test da mon duoc su dung; cap nhat nhan huong dan; renderer dung chung |

## Tieu chi nghiem thu

- Chay 516 mau cau hoi da mon va cac bien the delimiter tren giao dien hoc sinh, giao vien va preview.
- Thu ca 4 dang 4-1, TF4, SQ, TL; ca che do tung cau va danh sach; desktop/mobile.
- Kiem tra PDF in A4 tren ca 3 loai cong thuc: inline, matrix/display, mhchem.
- Kiem tra DOCX bang Microsoft Word/LibreOffice; phan so, can, chi so la OMML co the sua.
- Khong co cong thuc bi mat/doi nghia; neu khong ho tro thi de nguyen ma nguon va canh bao.
- Doi chieu Excel: Excel khong ho tro renderer LaTeX truc tiep; giu nguyen du lieu nguon de khong mat cau truc.
- Chay GitHub Actions: 3 nhom test tokenizer cu, bo 516, screenshot-regression; nhom test tich hop Word/PDF/Excel; production build.
- Neu Preview/CI khong thanh cong thi KHONG MERGE, KHONG TRIEN KHAI PRODUCTION.

## Ranh gioi quan trong

- Han che cua docx/math doi voi mhchem phuc tap: fallback hien nguon, khong tu suy doan.
- Nhap file Word chua chuyen duoc tat ca Office Math dau vao (OMML) thanh LaTeX; phai kiem chung mau thuc te.
- HTML va Word/PDF/Excel khong co cung kieu ket xuat, nen dong bo ve noi dung/khoa hoc chu khong the dam bao pixel-perfect.
- Cac cong thuc nguon sai cu phap phai duoc bao loi, khong duoc tuy tien sua.

Chi duoc merge nhom thay doi nay vao main khi nguoi quan ly phe duyet sau khi nhan ket qua nghiem thu.
