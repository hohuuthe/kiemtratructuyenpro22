-- QL Tài liệu cho Neon; không xóa dữ liệu các bảng khác.
CREATE TABLE IF NOT EXISTS quan_ly_tai_lieu (
    id TEXT PRIMARY KEY,
    id_nguoi_tao TEXT NOT NULL,
    tieu_de TEXT NOT NULL,
    duong_link TEXT NOT NULL,
    doi_tuong_duoc_truy_cap TEXT NOT NULL DEFAULT 'authenticated'
        CHECK (doi_tuong_duoc_truy_cap IN ('public','authenticated','teacher','student','admin')),
    thoi_gian_het_han TEXT,
    hoat_dong INTEGER NOT NULL DEFAULT 1 CHECK (hoat_dong IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_qltl_creator ON quan_ly_tai_lieu(id_nguoi_tao);
CREATE INDEX IF NOT EXISTS idx_qltl_visible ON quan_ly_tai_lieu(hoat_dong, doi_tuong_duoc_truy_cap, thoi_gian_het_han);
