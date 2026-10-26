-- QL Tài liệu cho Neon; không xóa dữ liệu các bảng khác.
-- See quan_ly_tai_lieu_neon.sql for a full safe migration including legacy
-- TEXT-to-TIMESTAMPTZ conversion and update-time trigger.
CREATE TABLE IF NOT EXISTS quan_ly_tai_lieu (
 id TEXT PRIMARY KEY, id_nguoi_tao TEXT NOT NULL,
 tieu_de TEXT NOT NULL, duong_link TEXT NOT NULL,
 doi_tuong_duoc_truy_cap TEXT NOT NULL DEFAULT 'authenticated'
 CHECK (doi_tuong_duoc_truy_cap IN ('public','authenticated','teacher','student','admin')),
 thoi_gian_het_han TIMESTAMPTZ,
 hoat_dong INTEGER NOT NULL DEFAULT 1 CHECK (hoat_dong IN (0,1)),
 mo_ta TEXT NOT NULL DEFAULT '', danh_muc TEXT NOT NULL DEFAULT 'Chung',
 id_nguoi_cap_nhat TEXT,
 thoi_gian_tao TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 thoi_gian_cap_nhat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
