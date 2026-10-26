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

-- Nâng cấp không mất dữ liệu: các bản ghi cũ tiếp tục giữ đúng đối tượng đã cấp.
ALTER TABLE public.quan_ly_tai_lieu ADD COLUMN IF NOT EXISTS doi_tuong_truy_cap_nhieu TEXT[];
UPDATE public.quan_ly_tai_lieu
SET doi_tuong_truy_cap_nhieu = ARRAY[doi_tuong_duoc_truy_cap]
WHERE doi_tuong_truy_cap_nhieu IS NULL;
ALTER TABLE public.quan_ly_tai_lieu
 ALTER COLUMN doi_tuong_truy_cap_nhieu SET DEFAULT ARRAY['authenticated']::TEXT[],
 ALTER COLUMN doi_tuong_truy_cap_nhieu SET NOT NULL;
DO $qltl_constraint$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conname = 'qltl_multi_audience_valid'
  AND conrelid = 'public.quan_ly_tai_lieu'::regclass
 ) THEN
  ALTER TABLE public.quan_ly_tai_lieu
  ADD CONSTRAINT qltl_multi_audience_valid
  CHECK (
   cardinality(doi_tuong_truy_cap_nhieu) BETWEEN 1 AND 5
   AND doi_tuong_truy_cap_nhieu <@ ARRAY['public','authenticated','teacher','student','admin']::TEXT[]
  );
 END IF;
END $qltl_constraint$;
CREATE INDEX IF NOT EXISTS idx_qltl_audiences
ON public.quan_ly_tai_lieu USING GIN (doi_tuong_truy_cap_nhieu);
