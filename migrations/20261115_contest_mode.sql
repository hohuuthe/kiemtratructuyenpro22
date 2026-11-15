-- KTTT / 2026-11-15: isolated public contest mode.
-- Run in the intended tenant database AFTER taking a verified backup.
-- Additive schema only; no existing exam, account or result is deleted.
BEGIN;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS application_mode TEXT NOT NULL DEFAULT 'school';
ALTER TABLE public.exam_configs
  ADD COLUMN IF NOT EXISTS contest_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS ma_nguoi_du_thi TEXT;
ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS ma_phien_thi TEXT;

-- Tat ca ten cot cua bang contest_participants bang tieng Viet khong dau.
CREATE TABLE IF NOT EXISTS public.contest_participants (
  ma_nguoi_du_thi TEXT PRIMARY KEY,
  ho_ten TEXT NOT NULL,
  don_vi TEXT NOT NULL,
  dia_chi_ma_hoa TEXT,
  so_dien_thoai_ma_hoa TEXT NOT NULL,
  so_cccd_ma_hoa TEXT,
  ma_dinh_danh_bam TEXT NOT NULL UNIQUE,
  thoi_diem_dong_y TIMESTAMPTZ NOT NULL,
  thoi_diem_tao TIMESTAMPTZ NOT NULL DEFAULT now(),
  thoi_diem_cap_nhat TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contest_attempts (
  ma_phien_thi TEXT PRIMARY KEY,
  ma_nguoi_du_thi TEXT NOT NULL REFERENCES public.contest_participants(ma_nguoi_du_thi),
  ma_de_thi TEXT NOT NULL,
  trang_thai TEXT NOT NULL DEFAULT 'DANG_LAM',
  ma_ket_qua TEXT,
  thoi_diem_bat_dau TIMESTAMPTZ NOT NULL DEFAULT now(),
  thoi_diem_nop TIMESTAMPTZ,
  CONSTRAINT contest_attempts_status_ck CHECK (trang_thai IN ('DANG_LAM','DA_NOP','HUY'))
);
CREATE INDEX IF NOT EXISTS idx_contest_exams_public
  ON public.exam_configs(contest_status, created_at DESC)
  WHERE chedodethi = 'Cuộc thi trực tuyến';
CREATE INDEX IF NOT EXISTS idx_contest_attempts_participant
  ON public.contest_attempts(ma_nguoi_du_thi, ma_de_thi, trang_thai);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contest_attempt_active
  ON public.contest_attempts(ma_nguoi_du_thi, ma_de_thi)
  WHERE trang_thai = 'DANG_LAM';
CREATE INDEX IF NOT EXISTS idx_results_contest_participant
  ON public.results(ma_nguoi_du_thi, exam_id, created_at DESC);
-- Backfill only when the previous attempt already recorded the immutable
-- result ID and that mapping is unambiguous. Never infer by name or phone.
UPDATE public.results AS r
SET ma_phien_thi=ca.ma_phien_thi
FROM public.contest_attempts AS ca
WHERE r.id=ca.ma_ket_qua
  AND r.exam_id=ca.ma_de_thi
  AND r.ma_nguoi_du_thi=ca.ma_nguoi_du_thi
  AND r.ma_phien_thi IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.contest_attempts AS other
    WHERE other.ma_ket_qua=ca.ma_ket_qua
      AND other.ma_phien_thi<>ca.ma_phien_thi
  );
CREATE UNIQUE INDEX IF NOT EXISTS uq_results_contest_session
  ON public.results(ma_phien_thi) WHERE ma_phien_thi IS NOT NULL;

-- Keep the participant registry private even when this DB is accessed through
-- Supabase Data API. Cloudflare/Neon trusted server-side SQL retains owner access.
ALTER TABLE public.contest_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contest_participants FROM PUBLIC;
REVOKE ALL ON public.contest_attempts FROM PUBLIC;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.contest_participants FROM anon;
    REVOKE ALL ON public.contest_attempts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.contest_participants FROM authenticated;
    REVOKE ALL ON public.contest_attempts FROM authenticated;
  END IF;
END
$guard$;

COMMIT;

-- Read-only post-migration verification:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='contest_participants'
-- ORDER BY ordinal_position;
-- SELECT application_mode FROM app_settings WHERE id = 1;
-- SELECT indexname FROM pg_indexes WHERE tablename='contest_attempts';
