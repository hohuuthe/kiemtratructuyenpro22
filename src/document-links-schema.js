/**
 * Idempotent, per-Neon-tenant link repository schema.
 * Automatically upgrades the earlier seven-column revision without
 * dropping any rows. Legacy invalid timestamps cause a fail-closed error.
 */
export const DOCUMENT_LINK_SCHEMA_STATEMENTS = Object.freeze([
  "CREATE TABLE IF NOT EXISTS public.quan_ly_tai_lieu (\n    id TEXT PRIMARY KEY,\n    id_nguoi_tao TEXT NOT NULL,\n    tieu_de TEXT NOT NULL,\n    duong_link TEXT NOT NULL,\n    doi_tuong_duoc_truy_cap TEXT NOT NULL DEFAULT 'authenticated'\n      CHECK (doi_tuong_duoc_truy_cap IN ('public','authenticated','teacher','student','admin','owner')),\n    thoi_gian_het_han TIMESTAMPTZ,\n    hoat_dong INTEGER NOT NULL DEFAULT 1 CHECK (hoat_dong IN (0,1)),\n    mo_ta TEXT NOT NULL DEFAULT '',\n    danh_muc TEXT NOT NULL DEFAULT 'Chung',\n    id_nguoi_cap_nhat TEXT,\n    thoi_gian_tao TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    thoi_gian_cap_nhat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP\n  )",
  "ALTER TABLE public.quan_ly_tai_lieu\n    ADD COLUMN IF NOT EXISTS mo_ta TEXT NOT NULL DEFAULT '',\n    ADD COLUMN IF NOT EXISTS danh_muc TEXT NOT NULL DEFAULT 'Chung',\n    ADD COLUMN IF NOT EXISTS id_nguoi_cap_nhat TEXT,\n    ADD COLUMN IF NOT EXISTS thoi_gian_tao TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    ADD COLUMN IF NOT EXISTS thoi_gian_cap_nhat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP",
  "DO $migrate_expiry$\nDECLARE current_type TEXT;\nBEGIN\n SELECT data_type INTO current_type FROM information_schema.columns\n  WHERE table_schema='public' AND table_name='quan_ly_tai_lieu'\n    AND column_name='thoi_gian_het_han';\n IF current_type IN ('text','character varying') THEN\n   ALTER TABLE public.quan_ly_tai_lieu\n    ALTER COLUMN thoi_gian_het_han TYPE TIMESTAMPTZ\n    USING NULLIF(BTRIM(thoi_gian_het_han),'')::TIMESTAMPTZ;\n ELSIF current_type <> 'timestamp with time zone' THEN\n   RAISE EXCEPTION 'Unsupported expiry column type: %',current_type;\n END IF;\nEND;\n$migrate_expiry$",
  "ALTER TABLE public.quan_ly_tai_lieu ADD COLUMN IF NOT EXISTS doi_tuong_truy_cap_nhieu TEXT[]",
  "ALTER TABLE public.quan_ly_tai_lieu ADD COLUMN IF NOT EXISTS pham_vi_lop_hoc_sinh JSONB NOT NULL DEFAULT '[]'::JSONB",
  "UPDATE public.quan_ly_tai_lieu SET doi_tuong_truy_cap_nhieu = ARRAY[doi_tuong_duoc_truy_cap] WHERE doi_tuong_truy_cap_nhieu IS NULL",
  "ALTER TABLE public.quan_ly_tai_lieu ALTER COLUMN doi_tuong_truy_cap_nhieu SET DEFAULT ARRAY['authenticated']::TEXT[], ALTER COLUMN doi_tuong_truy_cap_nhieu SET NOT NULL",
  "DO $qltl_audience_constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qltl_multi_audience_valid' AND conrelid = 'public.quan_ly_tai_lieu'::regclass) THEN ALTER TABLE public.quan_ly_tai_lieu ADD CONSTRAINT qltl_multi_audience_valid CHECK (cardinality(doi_tuong_truy_cap_nhieu) BETWEEN 1 AND 5 AND doi_tuong_truy_cap_nhieu <@ ARRAY['public','authenticated','teacher','student','admin']::TEXT[]); END IF; END $qltl_audience_constraint$",
  "DO $qltl_owner_constraints$\nBEGIN\n IF NOT EXISTS (\n   SELECT 1 FROM pg_constraint\n   WHERE conrelid = 'public.quan_ly_tai_lieu'::regclass\n     AND conname = 'quan_ly_tai_lieu_doi_tuong_duoc_truy_cap_check'\n     AND pg_get_constraintdef(oid) LIKE '%owner%'\n ) THEN\n   ALTER TABLE public.quan_ly_tai_lieu DROP CONSTRAINT IF EXISTS quan_ly_tai_lieu_doi_tuong_duoc_truy_cap_check;\n   ALTER TABLE public.quan_ly_tai_lieu ADD CONSTRAINT quan_ly_tai_lieu_doi_tuong_duoc_truy_cap_check\n     CHECK (doi_tuong_duoc_truy_cap IN ('public','authenticated','teacher','student','admin','owner'));\n END IF;\n IF NOT EXISTS (\n   SELECT 1 FROM pg_constraint\n   WHERE conrelid = 'public.quan_ly_tai_lieu'::regclass\n     AND conname = 'qltl_multi_audience_valid'\n     AND pg_get_constraintdef(oid) LIKE '%owner%'\n ) THEN\n   ALTER TABLE public.quan_ly_tai_lieu DROP CONSTRAINT IF EXISTS qltl_multi_audience_valid;\n   ALTER TABLE public.quan_ly_tai_lieu ADD CONSTRAINT qltl_multi_audience_valid\n     CHECK (\n       cardinality(doi_tuong_truy_cap_nhieu) BETWEEN 1 AND 6\n       AND doi_tuong_truy_cap_nhieu <@ ARRAY['public','authenticated','teacher','student','admin','owner']::TEXT[]\n       AND (NOT ('owner'=ANY(doi_tuong_truy_cap_nhieu)) OR cardinality(doi_tuong_truy_cap_nhieu)=1)\n     );\n END IF;\nEND;\n$qltl_owner_constraints$",
  "CREATE INDEX IF NOT EXISTS idx_qltl_audiences ON public.quan_ly_tai_lieu USING GIN (doi_tuong_truy_cap_nhieu)",
  "CREATE INDEX IF NOT EXISTS idx_qltl_student_classes ON public.quan_ly_tai_lieu USING GIN (pham_vi_lop_hoc_sinh)",
  "CREATE INDEX IF NOT EXISTS idx_qltl_creator ON public.quan_ly_tai_lieu(id_nguoi_tao)",
  "CREATE INDEX IF NOT EXISTS idx_qltl_visible ON public.quan_ly_tai_lieu(hoat_dong,doi_tuong_duoc_truy_cap,thoi_gian_het_han)",
  "CREATE INDEX IF NOT EXISTS idx_qltl_creator_created ON public.quan_ly_tai_lieu(id_nguoi_tao,thoi_gian_tao DESC)",
  "CREATE INDEX IF NOT EXISTS idx_qltl_created ON public.quan_ly_tai_lieu(thoi_gian_tao DESC)",
  "CREATE INDEX IF NOT EXISTS idx_qltl_category ON public.quan_ly_tai_lieu(danh_muc)",
  "CREATE OR REPLACE FUNCTION public.qltl_set_updated_at()\nRETURNS TRIGGER LANGUAGE plpgsql AS $fn$\nBEGIN\n NEW.thoi_gian_cap_nhat := CURRENT_TIMESTAMP;\n RETURN NEW;\nEND;\n$fn$",
  "DO $create_qltl_trigger$\nBEGIN\n IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_qltl_set_updated_at'\n   AND tgrelid='public.quan_ly_tai_lieu'::regclass) THEN\n  CREATE TRIGGER trg_qltl_set_updated_at\n    BEFORE UPDATE ON public.quan_ly_tai_lieu\n    FOR EACH ROW EXECUTE FUNCTION public.qltl_set_updated_at();\n END IF;\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND;\n$create_qltl_trigger$"
]);
const initialization = new Map();
export async function ensureDocumentLinkSchema(db,connectionKey){
 if(!db||typeof db.prepare!=='function')throw new Error('Cơ sở dữ liệu không khả dụng.');
 const key=connectionKey||db.connectionUrl||db;
 if(!initialization.has(key)){
  const task=(async()=>{
   for(const statement of DOCUMENT_LINK_SCHEMA_STATEMENTS)await db.prepare(statement).run();
  })();
  initialization.set(key,task);
  task.catch(()=>{if(initialization.get(key)===task)initialization.delete(key);});
 }
 return initialization.get(key);
}
