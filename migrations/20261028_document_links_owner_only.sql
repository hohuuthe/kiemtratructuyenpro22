-- Non-destructive owner-only audience upgrade; apply once per Neon tenant before enabling the feature.
BEGIN;
ALTER TABLE public.quan_ly_tai_lieu DROP CONSTRAINT IF EXISTS quan_ly_tai_lieu_doi_tuong_duoc_truy_cap_check;
ALTER TABLE public.quan_ly_tai_lieu ADD CONSTRAINT quan_ly_tai_lieu_doi_tuong_duoc_truy_cap_check
  CHECK (doi_tuong_duoc_truy_cap IN ('public','authenticated','teacher','student','admin','owner'));
ALTER TABLE public.quan_ly_tai_lieu DROP CONSTRAINT IF EXISTS qltl_multi_audience_valid;
ALTER TABLE public.quan_ly_tai_lieu ADD CONSTRAINT qltl_multi_audience_valid
  CHECK (
    cardinality(doi_tuong_truy_cap_nhieu) BETWEEN 1 AND 6
    AND doi_tuong_truy_cap_nhieu <@ ARRAY['public','authenticated','teacher','student','admin','owner']::TEXT[]
    AND (NOT ('owner'=ANY(doi_tuong_truy_cap_nhieu)) OR cardinality(doi_tuong_truy_cap_nhieu)=1)
  );
COMMIT;
