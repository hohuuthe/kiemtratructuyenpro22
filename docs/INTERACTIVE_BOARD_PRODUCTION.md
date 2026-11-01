# Triển khai Production - Bảng tương tác thông minh

Tài liệu này mô tả quy trình phát hành thủ công, không phụ thuộc GitHub Actions.

## 1. Kiểm tra mã nguồn trước phát hành

Chạy tại thư mục dự án:

```bash
npm ci
npm run release:interactive-board:check
```

Lệnh trên thực hiện:
- kiểm tra cú pháp JavaScript;
- regression bảo mật Bảng tương tác;
- TypeScript check;
- Production build.

Chỉ tiếp tục khi tất cả lệnh kết thúc thành công.

## 2. Cấu hình secret dùng chung

Tạo một giá trị ngẫu nhiên mạnh cho `BOARD_REALTIME_SECRET`.
Không commit secret vào Git.

Đặt cùng một giá trị ở cả Worker và Pages.

### Worker

```bash
npx wrangler secret put BOARD_REALTIME_SECRET --config wrangler.board.toml
```

### Pages

```bash
npx wrangler pages secret put BOARD_REALTIME_SECRET --project-name kiemtratructuyenmoi
```

## 3. Deploy Worker Durable Object

```bash
npm run deploy:interactive-board-worker
```

Worker phải có tên:
`kiemtratructuyen-board-realtime`

Durable Object:
`BoardRoom`

Cấu hình dùng SQLite-backed Durable Object qua migration `new_sqlite_classes`.

## 4. Deploy Cloudflare Pages

Pages project:
`kiemtratructuyenmoi`

`wrangler.toml` đã khai báo service binding:

- binding: `BOARD_REALTIME`
- service: `kiemtratructuyen-board-realtime`

Nếu dùng Git integration, merge vào `main` sẽ kích hoạt Pages deploy theo cấu hình hiện tại.
Nếu deploy thủ công, build trước rồi dùng quy trình Pages đang áp dụng cho dự án.

## 5. Kiểm tra Production sau deploy

Đăng nhập Admin và gọi:

`GET /api/board/health`

Tenant slug:

`GET /<slug>/api/board/health`

Kết quả đạt phải có:

```json
{
  "ok": true,
  "checks": {
    "database": true,
    "realtime_secret": true,
    "realtime_binding": true,
    "realtime_worker": true,
    "durable_object": true
  }
}
```

## 6. Smoke test bắt buộc

1. Admin bật VIP cho một Giáo viên.
2. Giáo viên VIP thấy nút Tạo bảng.
3. Giáo viên không VIP không thấy nút và gọi trực tiếp POST /api/boards phải bị 403 VIP_REQUIRED.
4. Tạo bảng công khai.
5. Học sinh đăng nhập và vào bảng.
6. Kiểm tra vẽ, sticky, vote, timer, laser, khóa cả lớp, khóa riêng học sinh.
7. Kiểm tra mất mạng/reconnect.
8. Tạo nhiều trang, đổi nền, chuyển trang.
9. Xuất PNG và PDF.
10. Kiểm tra AI chỉ hoạt động cho chủ bảng/Admin.
11. Kiểm tra trên desktop và điện thoại.
12. Kiểm tra ít nhất 2 tenant khác nhau để bảo đảm không giao thoa dữ liệu.

## 7. Rollback

Nếu Pages có sự cố, rollback Pages về deployment trước đó.
Nếu Worker có sự cố, rollback Worker về version trước đó trong Cloudflare Workers.
Không xóa Durable Object namespace khi rollback vì dữ liệu bảng realtime đang nằm trong namespace này.

## QR Answer Cards production release

- Release commit source: `a71df7e99ff01a70028ec08af9e3d4868358c8f9`
- Scope: QR A/B/C/D cards, Presenter ↔ Scanner synchronization, atomic late-frame protection, idempotent grading.
- Release gate: `npm run release:qr-cards:check` passed on PR #93 before merge.

## QR phone persistence release 2026-11-01

- Source commit: `00b6a9dad4ad4368d1747d706582331d0e23536a`
- Scope: phone scanner server-confirmed persistence, Presenter synchronization, locked-state UX, mobile overflow hardening.
- Verification: PR #94 `release:qr-cards:check` passed; Neon branch smoke verified `qr_answer_responses` insert and `response_revision` increment.
- Production trigger: this commit is pushed to `main` for Cloudflare Pages Git integration.
