-- Apply manually on an isolated Neon staging branch first, after backup.
-- Deployment must not run this file automatically on production.
CREATE TABLE IF NOT EXISTS word_import_batches (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, file_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL, expected_count INTEGER NOT NULL,
  imported_count INTEGER NOT NULL, engine_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_word_import_file_once ON word_import_batches(creator_id,source_sha256);
CREATE TABLE IF NOT EXISTS word_import_items (
  batch_id TEXT NOT NULL REFERENCES word_import_batches(id),
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  PRIMARY KEY(batch_id,question_id)
);
CREATE TABLE IF NOT EXISTS question_formula_sources (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  source_token TEXT NOT NULL, field_name TEXT NOT NULL,
  source_type TEXT NOT NULL, source_omml TEXT NOT NULL,
  normalized_latex TEXT NOT NULL, review_status TEXT NOT NULL,
  engine_version TEXT NOT NULL, batch_id TEXT NOT NULL,
  PRIMARY KEY(question_id,source_token,field_name)
);
CREATE INDEX IF NOT EXISTS idx_word_import_items_question ON word_import_items(question_id);
CREATE INDEX IF NOT EXISTS idx_formula_sources_batch ON question_formula_sources(batch_id);
