/**
 * School attempts use a durable result reservation instead of an ACTIVE-lock.
 * A start consumes one attempt, even if the browser disappears before submit.
 * IN_PROGRESS/ABANDONED are NOT scores and must never be publicly ranked.
 */
// Schema is migrated ahead of release. The first request on a Worker instance
// verifies the tenant and thereafter performs no DDL. Failed checks are retriable.
const schoolSchemaChecks = new Map<string, Promise<void>>();

async function schoolResultSchemaReady(db: any): Promise<boolean> {
  const row: any = await db.prepare([
    'SELECT (',
    "to_regclass('public._exam_abandoned_attempts') IS NOT NULL",
    'AND (SELECT COUNT(*) FROM information_schema.columns',
    "WHERE table_schema = 'public' AND table_name = 'results'",
    "AND column_name IN ('user_id','lop','don_vi','submission_token_hash',",
    "'grading_status','score_finalized_at','attempt_no','last_seen_at')) = 8",
    'AND EXISTS (SELECT 1 FROM pg_indexes',
    "WHERE schemaname='public' AND tablename='results' AND indexname='uq_results_school_attempt_no')",
    'AND EXISTS (SELECT 1 FROM pg_indexes',
    "WHERE schemaname='public' AND tablename='results' AND indexname='uq_results_submission_token_hash')",
    ') AS ready'
  ].join(' ')).bind().first();
  return row?.ready === true || row?.ready === 1;
}

async function initializeSchoolResultReservationSchema(db: any): Promise<void> {
  if (await schoolResultSchemaReady(db)) return;
  // Backward-compatible additive setup for a tenant that missed migration.
  await db.prepare(`CREATE TABLE IF NOT EXISTS _exam_abandoned_attempts (
    session_id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL,
    reason TEXT NOT NULL, abandoned_at TEXT NOT NULL
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY, user_id TEXT, student_name TEXT, student_class TEXT,
    lop TEXT, don_vi TEXT, exam_name TEXT, exam_id TEXT, score REAL,
    time_taken INTEGER, correct_count INTEGER, total_questions INTEGER,
    details TEXT, loai_thi_sinh TEXT, cheat_warning_count INTEGER DEFAULT 0,
    submission_token_hash TEXT, grading_status TEXT DEFAULT 'FINAL',
    score_finalized_at TEXT, created_at TEXT
  )`).run();
  for (const sql of [
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS user_id TEXT',
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS lop TEXT',
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS don_vi TEXT',
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS submission_token_hash TEXT',
    "ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_status TEXT DEFAULT 'FINAL'",
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS score_finalized_at TEXT',
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS attempt_no INTEGER',
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_results_submission_token_hash ON results(submission_token_hash) WHERE submission_token_hash IS NOT NULL',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_results_school_attempt_no ON results(exam_id, user_id, attempt_no) WHERE user_id IS NOT NULL AND attempt_no IS NOT NULL'
  ]) await db.prepare(sql).run();
  if (!await schoolResultSchemaReady(db)) {
    throw new Error('SCHOOL_RESULT_RESERVATION_SCHEMA_INCOMPLETE');
  }
}

export async function ensureSchoolResultReservationSchema(db: any): Promise<void> {
  const dbKey = String(db?.connectionUrl || '');
  if (!dbKey) return initializeSchoolResultReservationSchema(db);
  let pending = schoolSchemaChecks.get(dbKey);
  if (!pending) {
    pending = initializeSchoolResultReservationSchema(db);
    schoolSchemaChecks.set(dbKey, pending);
  }
  try {
    await pending;
  } catch (error) {
    if (schoolSchemaChecks.get(dbKey) === pending) schoolSchemaChecks.delete(dbKey);
    throw error;
  }
}
export function isSchoolResultProvisional(status: unknown): boolean {
  return ['IN_PROGRESS','ABANDONED'].includes(String(status || '').toUpperCase());
}
export const SCHOOL_RESULT_ACTIVE = 'IN_PROGRESS';
export const SCHOOL_RESULT_ABORTED = 'ABANDONED';

/**
 * This is the only school start claim. Quota verification, starting the frozen
 * snapshot, and reserving the result happen in ONE PostgreSQL statement.
 * Unique (exam_id,user_id,attempt_no) makes concurrent starts race safely:
 * at most one of two claims with the same remaining slot can succeed.
 * A conflicting INSERT raises a unique violation and rolls back the entire
 * activation statement. It NEVER leaves a started snapshot without a slot.
 */
export async function claimSchoolResultAtStart(db: any, params: {
  examId: string; userId: string; sessionId: string; tokenHash: string;
  studentName: string; studentClass: string; studentUnit: string;
  examName: string; questionCount: number; maxAttempts: number;
  legacyAttempts: number; startedAt: string; deadlineAt: string; expiresAt: string;
}): Promise<{ id: string; attemptNo: number; startedAt: string; deadlineAt: string } | null> {
  const { examId, userId, sessionId, tokenHash, studentName, studentClass,
    studentUnit, examName, questionCount, maxAttempts, legacyAttempts,
    startedAt, deadlineAt, expiresAt } = params;
  if (!examId || !userId || !sessionId || !tokenHash ||
      !Number.isInteger(maxAttempts) || maxAttempts < 0 ||
      !Number.isInteger(legacyAttempts) || legacyAttempts < 0 ||
      !Number.isInteger(questionCount) || questionCount <= 0) {
    throw new Error('EXAM_RESERVATION_INVALID_INPUT');
  }
  await ensureSchoolResultReservationSchema(db);
  const id = crypto.randomUUID();
  const claimed: any = await db.prepare(`
    WITH quota AS MATERIALIZED (
      SELECT COUNT(*)::integer AS used,
             COALESCE(MAX(attempt_no), 0)::integer + 1 AS next_no
      FROM results WHERE exam_id = ? AND user_id = ?
    ),
    activated AS (
      UPDATE _exam_grade_sessions AS session
         SET started_at = ?, deadline_at = ?, expires_at = ?
        FROM quota
       WHERE session.session_id = ? AND session.exam_id = ?
         AND session.started_at IS NULL
         AND (? = 0 OR quota.used + ? < ?)
       RETURNING session.started_at, session.deadline_at
    ),
    reserved AS (
      INSERT INTO results (
        id,user_id,student_name,student_class,lop,don_vi,
        exam_name,exam_id,score,time_taken,correct_count,total_questions,
        details,loai_thi_sinh,submission_token_hash,grading_status,
        created_at,attempt_no,last_seen_at
      )
      SELECT ?,?,?,?,?,?,?,?,0,0,0,?,'[]','Đã đăng nhập',?,
             'IN_PROGRESS',?,quota.next_no,?::timestamptz
      FROM activated CROSS JOIN quota
      RETURNING id, attempt_no
    )
    SELECT reserved.id, reserved.attempt_no, activated.started_at, activated.deadline_at
    FROM reserved CROSS JOIN activated
  `).bind(
    examId,userId,
    startedAt,deadlineAt,expiresAt,sessionId,examId,
    maxAttempts,legacyAttempts,maxAttempts,
    id,userId,studentName,studentClass,studentClass,studentUnit,
    examName,examId,questionCount,tokenHash,startedAt,startedAt
  ).first();
  if (!claimed?.id) return null;
  const attemptNo = Number(claimed.attempt_no);
  // Older attempts are terminal. This is cleanup only; it NEVER gates the
  // insertion above. A delayed old submit also checks the newer attempt slot.
  try {
    await db.prepare(`
      UPDATE results SET grading_status = 'ABANDONED'
      WHERE exam_id = ? AND user_id = ? AND grading_status = 'IN_PROGRESS'
        AND attempt_no IS NOT NULL AND attempt_no < ?
    `).bind(examId,userId,attemptNo).run();
  } catch (err) {
    console.error('Deferred old school result reconciliation:',err);
  }
  return {
    id: String(claimed.id), attemptNo,
    startedAt: String(claimed.started_at), deadlineAt: String(claimed.deadline_at)
  };
}

export async function findSchoolResultBySession(db: any, tokenHash: string, examId: string, userId: string) {
  return db.prepare(`SELECT id, grading_status, attempt_no FROM results
    WHERE submission_token_hash = ? AND exam_id = ? AND user_id = ? LIMIT 1
  `).bind(tokenHash, examId, userId).first();
}
