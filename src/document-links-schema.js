/**
 * Idempotent per-tenant document-link schema. Runs on first access even
 * where a Neon tenant has not run standalone migration scripts.
 */
export const DOCUMENT_LINK_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS quan_ly_tai_lieu (
    id TEXT PRIMARY KEY,
    id_nguoi_tao TEXT NOT NULL,
    tieu_de TEXT NOT NULL,
    duong_link TEXT NOT NULL,
    doi_tuong_duoc_truy_cap TEXT NOT NULL DEFAULT 'authenticated'
      CHECK (doi_tuong_duoc_truy_cap IN ('public','authenticated','teacher','student','admin')),
    thoi_gian_het_han TEXT,
    hoat_dong INTEGER NOT NULL DEFAULT 1 CHECK (hoat_dong IN (0,1))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_qltl_creator ON quan_ly_tai_lieu(id_nguoi_tao)',
  'CREATE INDEX IF NOT EXISTS idx_qltl_visible ON quan_ly_tai_lieu(hoat_dong,doi_tuong_duoc_truy_cap,thoi_gian_het_han)'
]);
const initialization = new Map();
export async function ensureDocumentLinkSchema(db, connectionKey) {
  if (!db || typeof db.prepare !== 'function') throw new Error('Cơ sở dữ liệu không khả dụng.');
  const key = connectionKey || db.connectionUrl || db;
  if (!initialization.has(key)) {
    const task = (async()=>{
      for (const statement of DOCUMENT_LINK_SCHEMA_STATEMENTS) await db.prepare(statement).run();
    })();
    initialization.set(key, task);
    task.catch(()=>{ if (initialization.get(key) === task) initialization.delete(key); });
  }
  return initialization.get(key);
}
