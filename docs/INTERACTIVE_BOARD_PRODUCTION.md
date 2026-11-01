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

## QR mobile scanner-only release 2026-11-01

- Source commit: `74b9af0cd3b21288a22d73300285d2fef422de3b`
- Scope: phone-only scanner UI, desktop controls hidden on mobile, camera-first layout, reduced mobile data loading.
- Verification: PR #95 `release:qr-cards:check` passed before merge.
- Production trigger: this commit is pushed to `main` for Cloudflare Pages Git integration.

## QR reliable ACK + Presenter monitor release 2026-11-01

- Source commit: `610d6fedf487f814aad223c60279ab8fda60594f`
- Scope: reliable phone ACK queue, serialized persistence batches, persisted retry queue, explicit per-card ACK, live saved-answer monitor beside Presenter question.
- Production evidence before release: Neon Production session `AXMCSP` persisted a real response and incremented `response_revision` to 1.
- Verification: PR #96 `release:qr-cards:check` passed before merge.
- Production trigger: this commit is pushed to `main` for Cloudflare Pages Git integration.

## QR long-range hybrid scanner release 2026-11-01

- Source commit: `ea1e08ff8634642d9cb15fa848dd0bf9112acad0`
- Scope: native multi-QR BarcodeDetector, high-resolution tiled jsQR fallback, adaptive scan cadence, camera resolution fallback, compact V2 QR payload, legacy V1 compatibility.
- Verification: PR #97 `release:qr-cards:check` passed before merge.
- Production trigger: this commit is pushed to `main` for Cloudflare Pages Git integration.

## Production redeploy QR scanner 2026-11-01 16:41 +07

- Production source commit: `9b17ffca5924534d8864a5f88dba7bb35a4f53d3`
- Scope: long-range hybrid QR scanner + reliable ACK queue + Presenter monitor + mobile scanner-only UI.
- Deployment trigger: push to `main` for Cloudflare Pages Git integration.

## QR subrequest + VIP gate release 2026-11-01

- Source commit: `fda3c6ce9527c28d0664bfc9cd29f19ac5de8f67`
- Scope: bounded QR database subrequests, bulk card provisioning, bulk answer persistence/finalization, VIP-only scanner access for teachers, Admin bypass, VIP badge and upgrade notice.
- Release verification: PR #98 `release:qr-cards:check` passed before merge.
- Production trigger: this commit is pushed to `main` for Cloudflare Pages Git integration.
