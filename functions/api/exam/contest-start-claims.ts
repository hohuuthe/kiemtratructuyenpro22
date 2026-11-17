/**
 * Count a fresh contest attempt on authoritative Start, never on Submit.
 * Previous sessions are NEVER restored, compared, replaced or used as locks.
 * Historical contest rows/results are used solely as consumed-attempt totals.
 */
export async function ensureContestStartClaimsSchema(db: any): Promise<void> {
  await db.prepare([
    'CREATE TABLE IF NOT EXISTS _contest_start_claims (',
    'session_id TEXT PRIMARY KEY, participant_id TEXT NOT NULL,',
    'exam_id TEXT NOT NULL, attempt_no INTEGER NOT NULL,',
    'created_at TIMESTAMPTZ NOT NULL,',
    'CONSTRAINT uq_contest_start_claim_slot UNIQUE (exam_id, participant_id, attempt_no))'
  ].join(' ')).run();
}

const quotaSQL = [
  '(',
  'SELECT',
  '(SELECT COUNT(*) FROM contest_attempts ca WHERE ca.ma_nguoi_du_thi = ? AND ca.ma_de_thi = ?)',
  '+ (SELECT COUNT(*) FROM _contest_start_claims claim WHERE claim.participant_id = ? AND claim.exam_id = ?)',
  '+ (SELECT COUNT(*) FROM results r WHERE r.ma_nguoi_du_thi = ? AND r.exam_id = ?',
  'AND NOT EXISTS (SELECT 1 FROM contest_attempts ca',
  'WHERE ca.ma_phien_thi = r.ma_phien_thi AND ca.ma_nguoi_du_thi = r.ma_nguoi_du_thi',
  'AND ca.ma_de_thi = r.exam_id)',
  'AND NOT EXISTS (SELECT 1 FROM _contest_start_claims claim',
  'WHERE claim.session_id = r.ma_phien_thi AND claim.participant_id = r.ma_nguoi_du_thi',
  'AND claim.exam_id = r.exam_id))',
  ')'
].join(' ');

const quotaArgs = (participantId: string, examId: string): string[] => [
  participantId, examId, participantId, examId, participantId, examId
];

export async function countContestUsedAttempts(db: any, participantId: string, examId: string): Promise<number> {
  await ensureContestStartClaimsSchema(db);
  const row: any = await db.prepare('SELECT ' + quotaSQL + ' AS used')
    .bind(...quotaArgs(participantId, examId)).first();
  return Math.max(0, Number(row?.used) || 0);
}

export async function findContestStartClaim(db: any, sessionId: string, participantId: string, examId: string): Promise<any> {
  await ensureContestStartClaimsSchema(db);
  return db.prepare('SELECT session_id, attempt_no FROM _contest_start_claims ' +
    'WHERE session_id = ? AND participant_id = ? AND exam_id = ?')
    .bind(sessionId, participantId, examId).first();
}

export async function claimContestStart(db: any, params: {
  sessionId: string;
  participantId: string;
  examId: string;
  maxAttempts: number;
  startedAt: string;
  deadlineAt: string;
  expiresAt: string;
}): Promise<{sessionId: string; attemptNo: number; startedAt: string; deadlineAt: string} | null> {
  const {sessionId, participantId, examId, maxAttempts, startedAt, deadlineAt, expiresAt} = params;
  if (!sessionId || !participantId || !examId || !Number.isInteger(maxAttempts) || maxAttempts < 0) {
    throw new Error('CONTEST_START_CLAIM_INVALID_INPUT');
  }
  await ensureContestStartClaimsSchema(db);
  const sql = [
    'WITH quota AS MATERIALIZED (SELECT', quotaSQL, 'AS used,',
    'COALESCE((SELECT MAX(attempt_no) FROM _contest_start_claims',
    'WHERE participant_id = ? AND exam_id = ?), 0) + 1 AS next_no),',
    'activated AS (UPDATE _exam_grade_sessions AS session',
    'SET started_at = ?, deadline_at = ?, expires_at = ?',
    'FROM quota WHERE session.session_id = ? AND session.exam_id = ?',
    'AND session.started_at IS NULL',
    'AND (?::integer = 0 OR quota.used < ?::integer)',
    'RETURNING session.session_id, session.started_at, session.deadline_at),',
    'reserved AS (INSERT INTO _contest_start_claims',
    '(session_id, participant_id, exam_id, attempt_no, created_at)',
    'SELECT activated.session_id, ?, ?, quota.next_no, ?::timestamptz',
    'FROM activated CROSS JOIN quota RETURNING session_id, attempt_no)',
    'SELECT reserved.session_id, reserved.attempt_no, activated.started_at, activated.deadline_at',
    'FROM reserved JOIN activated ON activated.session_id = reserved.session_id'
  ].join(' ');
  const bind = [
    ...quotaArgs(participantId, examId), participantId, examId,
    startedAt, deadlineAt, expiresAt, sessionId, examId,
    maxAttempts, maxAttempts, participantId, examId, startedAt
  ];
  // Unique (exam, participant, attempt_no) prevents parallel quota overspend.
  // A unique-constraint error rolls back both activation and reservation.
  for (let retry = 0; retry < 3; retry++) {
    try {
      const row: any = await db.prepare(sql).bind(...bind).first();
      if (!row?.session_id) return null;
      return {
        sessionId: String(row.session_id), attemptNo: Number(row.attempt_no),
        startedAt: String(row.started_at), deadlineAt: String(row.deadline_at)
      };
    } catch (error: any) {
      const duplicate = String(error?.code || '') === '23505' ||
        /duplicate key value violates unique constraint.*(uq_contest_start_claim_slot|_contest_start_claims)/i
          .test(String(error?.message || ''));
      if (!duplicate || retry === 2) throw error;
    }
  }
  return null;
}
