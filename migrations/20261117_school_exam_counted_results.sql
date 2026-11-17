-- 2026-11-17: School attempts are counted when the authenticated student starts
-- an exam, not when the student submits. Zero is a provisional placeholder,
-- NEVER a finalized grade. No existing results are deleted or rewritten.
-- Tenant-scoped: execute separately against each authorized tenant DB.
BEGIN;
ALTER TABLE results ADD COLUMN IF NOT EXISTS attempt_no INTEGER;
ALTER TABLE results ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_status TEXT DEFAULT 'FINAL';
ALTER TABLE results ADD COLUMN IF NOT EXISTS submission_token_hash TEXT;
ALTER TABLE results ADD COLUMN IF NOT EXISTS score_finalized_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_results_school_attempt_no
ON results(exam_id,user_id,attempt_no)
WHERE user_id IS NOT NULL AND attempt_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_results_submission_token_hash
ON results(submission_token_hash)
WHERE submission_token_hash IS NOT NULL;
COMMIT;
