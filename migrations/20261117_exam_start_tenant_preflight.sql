-- KTTT 2026-11-17: additive and repeatable preparation of counted exam starts.
-- Apply separately to each intended tenant, using a direct migration connection.
-- Do not remove old attempts or modify scores. Snapshot/backup before Production.
BEGIN;

ALTER TABLE public.results ADD COLUMN IF NOT EXISTS attempt_no INTEGER;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS grading_status TEXT DEFAULT 'FINAL';
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS submission_token_hash TEXT;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS score_finalized_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_results_school_attempt_no
  ON public.results(exam_id, user_id, attempt_no)
  WHERE user_id IS NOT NULL AND attempt_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_results_submission_token_hash
  ON public.results(submission_token_hash)
  WHERE submission_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public._exam_abandoned_attempts (
  session_id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL,
  reason TEXT NOT NULL, abandoned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public._contest_start_claims (
  session_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_contest_start_claim_slot UNIQUE (exam_id, participant_id, attempt_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contest_start_claim_slot
  ON public._contest_start_claims(exam_id, participant_id, attempt_no);
ALTER TABLE public._contest_start_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._contest_start_claims FROM PUBLIC;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public._contest_start_claims FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public._contest_start_claims FROM authenticated;
  END IF;
END
$guard$;

COMMIT;

-- Verify schema, index, RLS, tenant routing, and server-role access before release.
-- Do not downgrade a tenant automatically when this migration already ran.
