import { getDatabase, getDynamicSecret, signJWT, hashToken, verifyAuthSession } from './utils';
import { buildActiveExamRecoveryPayload } from '../../../src/exam-active-attempt-recovery.js';
import { onRequestPost as gradeSchoolExam } from './grade';

// Server receipt time is authoritative; no browser clock or localStorage state.
export const EXAM_HEARTBEAT_MS = 30_000;
export const EXAM_DISCONNECT_MS = 90_000;
const CLAIM_RETRY_MS = 5 * 60_000;

export async function ensureExamLifecycleColumns(db: any): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS _exam_active_attempts (
    attempt_key TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL,
    session_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
  )`).run();
  await db.prepare('ALTER TABLE _exam_active_attempts ADD COLUMN IF NOT EXISTS heartbeat_at TEXT').run();
  await db.prepare('ALTER TABLE _exam_active_attempts ADD COLUMN IF NOT EXISTS finalizing_at TEXT').run();
  await db.prepare('ALTER TABLE results ADD COLUMN IF NOT EXISTS submission_token_hash TEXT').run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS _submitted_exam_tokens (
    token_hash TEXT PRIMARY KEY, exam_id TEXT, student_name TEXT, user_id TEXT,
    submitted_at TEXT, status TEXT, result_id TEXT, claimed_at TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS _exam_abandoned_attempts (
    session_id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL,
    reason TEXT NOT NULL, abandoned_at TEXT NOT NULL
  )`).run();
  for (const col of ['status','result_id','claimed_at']) {
    await db.prepare('ALTER TABLE _submitted_exam_tokens ADD COLUMN IF NOT EXISTS '+col+' TEXT').run();
  }
}

export type ExamLifecycleState = 'ready' | 'live' | 'processing' | 'unavailable';
export interface ExamLifecycleResult {
  state: ExamLifecycleState;
  retryAfterSeconds?: number;
  resultId?: string;
}

const saneIso = (value: unknown): number => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
};

/**
 * Called only for the authenticated learner's exact exam. Never replaces or
 * discards an attempt; a stale attempt is graded from the immutable server
 * snapshot and the last acknowledged autosave before its lock is released.
 * The same grading token hash is used as interactive submission.
 */
export async function settleInactiveSchoolExam(
  context: any, examId: string, userId: string
): Promise<ExamLifecycleResult> {
  if (!examId || !userId) return { state: 'unavailable' };
  const db = getDatabase(context);
  try {
    await ensureExamLifecycleColumns(db);
    const key = examId + ':' + userId;
    const active: any = await db.prepare(
      'SELECT session_id, heartbeat_at, finalizing_at, created_at FROM _exam_active_attempts WHERE attempt_key = ? AND exam_id = ? AND user_id = ?'
    ).bind(key, examId, userId).first();
    if (!active?.session_id) return { state: 'ready' };

    const sessionId = String(active.session_id);
    const submissionHash = await hashToken('exam-session:' + sessionId);
    // Reconcile a committed grade before doing any timeout or quota decision.
    const completed: any = await db.prepare(
      'SELECT id FROM results WHERE submission_token_hash = ? LIMIT 1'
    ).bind(submissionHash).first();
    if (completed?.id) {
      await db.prepare(
        'DELETE FROM _exam_active_attempts WHERE attempt_key = ? AND exam_id = ? AND user_id = ? AND session_id = ?'
      ).bind(key, examId, userId, sessionId).run();
      return { state: 'ready', resultId: String(completed.id) };
    }

    const session: any = await db.prepare(
      'SELECT session_id, exam_id, teacher_id, question_ids, question_snapshot, exam_config, started_at, deadline_at, expires_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(sessionId).first();
    // An old deployment may leave a lock after deleting its grading snapshot.
    // Such an attempt cannot be scored. After a verifiable disconnect, record
    // one consumed attempt for teacher audit and atomically release only its lock.
    // Never create a fabricated result or delete the student's draft.
    if (!session) {
      const last = saneIso(active.heartbeat_at || active.created_at);
      const cutoff = new Date(Date.now()-EXAM_DISCONNECT_MS).toISOString();
      if (!Number.isFinite(last)) return {state:'unavailable'};
      if (Date.now()-last < EXAM_DISCONNECT_MS)
        return {state:'live',retryAfterSeconds:Math.max(1,Math.ceil((EXAM_DISCONNECT_MS-(Date.now()-last))/1000))};
      const processing: any = await db.prepare(
        'SELECT status FROM _submitted_exam_tokens WHERE token_hash = ?'
      ).bind(submissionHash).first();
      if (processing?.status === 'processing') return {state:'processing',retryAfterSeconds:10};
      const orphan: any = await db.prepare(`
        WITH old AS (
          SELECT attempt_key, session_id FROM _exam_active_attempts
          WHERE attempt_key = ? AND exam_id = ? AND user_id = ? AND session_id = ?
            AND COALESCE(heartbeat_at, created_at) <= ?
            AND finalizing_at IS NULL
          FOR UPDATE
        ), accounted AS (
          INSERT INTO _exam_abandoned_attempts (session_id,exam_id,user_id,reason,abandoned_at)
          SELECT session_id, ?, ?, 'missing_snapshot_requires_review', ? FROM old
          WHERE NOT EXISTS (
            SELECT 1 FROM results WHERE submission_token_hash = ?
          )
          ON CONFLICT (session_id) DO UPDATE SET reason = excluded.reason
          RETURNING session_id
        ), released AS (
          DELETE FROM _exam_active_attempts locked USING accounted
          WHERE locked.attempt_key = ? AND locked.session_id = accounted.session_id
          RETURNING locked.session_id
        )
        SELECT session_id FROM released
      `).bind(key,examId,userId,sessionId,cutoff,
        examId,userId,new Date().toISOString(),submissionHash,key).first();
      return orphan?.session_id ? {state:'ready'} : {state:'processing',retryAfterSeconds:10};
    }
    if (String(session.exam_id) !== examId || !session.started_at) {
      return {state:'unavailable'};
    }
    const now = Date.now();
    const lastSeen = saneIso(active.heartbeat_at || active.created_at);
    const deadline = saneIso(session.deadline_at);
    if (!Number.isFinite(lastSeen) || !Number.isFinite(deadline)) {
      return { state: 'unavailable' };
    }
    const disconnected = now - lastSeen >= EXAM_DISCONNECT_MS;
    const timedOut = now >= deadline;
    if (!disconnected && !timedOut) {
      return { state: 'live', retryAfterSeconds: Math.max(1, Math.ceil(Math.min(
        EXAM_DISCONNECT_MS - (now - lastSeen), deadline - now
      ) / 1000)) };
    }

    const claimTime = new Date(now).toISOString();
    const cutoff = new Date(now - EXAM_DISCONNECT_MS).toISOString();
    const retryCutoff = new Date(now - CLAIM_RETRY_MS).toISOString();
    const claimed: any = await db.prepare(`
      UPDATE _exam_active_attempts
      SET finalizing_at = ?
      WHERE attempt_key = ? AND exam_id = ? AND user_id = ? AND session_id = ?
        AND (finalizing_at IS NULL OR finalizing_at < ?)
        AND (COALESCE(heartbeat_at, created_at) <= ? OR EXISTS (
          SELECT 1 FROM _exam_grade_sessions
          WHERE session_id = ? AND deadline_at <= ?
        ))
      RETURNING session_id
    `).bind(claimTime,key,examId,userId,sessionId,retryCutoff,cutoff,sessionId,claimTime).first();
    if (!claimed?.session_id) {
      return { state: 'processing', retryAfterSeconds: 10 };
    }

    let gradeSucceeded = false;
    try {
      const draft: any = await db.prepare(
        'SELECT answers_json FROM _exam_answer_drafts WHERE session_id = ?'
      ).bind(sessionId).first();
      const answers = JSON.parse(String(draft?.answers_json || 'null'));
      const questions = JSON.parse(String(session.question_snapshot || 'null'));
      if (!Array.isArray(answers) || !Array.isArray(questions) ||
          answers.length !== questions.length || !questions.length) {
        return { state: 'unavailable' };
      }
      const signedPayload = buildActiveExamRecoveryPayload({
        session, examId, studentUserId: userId,
        // The snapshot must still be within its technical TTL.
        nowMs: now
      });
      if (!signedPayload) return { state: 'unavailable' };
      const secret = await getDynamicSecret(db, context.env.JWT_SECRET);
      const token = await signJWT({ ...signedPayload, exp: Math.floor((now + 300_000) / 1000) }, secret);
      const authorization = context.request.headers.get('authorization') || '';
      if (!authorization.startsWith('Bearer ')) return { state: 'unavailable' };
      const gradeRequest = new Request(context.request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authorization },
        body: JSON.stringify({
          token, studentAnswers: answers, clientQuestions: questions,
          studentInfo: { examId, examName: '', name: '', lop: '', donvi: '', loaiThiSinh: 'Đã đăng nhập' },
          timeTaken: Math.max(0, Math.floor((now - saneIso(session.started_at)) / 1000))
        })
      });
      const response: Response = await gradeSchoolExam(
        { ...context, request: gradeRequest }
      );
      if (!response.ok) {
        console.warn('Deferred exam submission did not finish:', response.status);
        return { state: 'unavailable' };
      }
      // Verify persistence, not just HTTP success, before allowing a new attempt.
      const stored: any = await db.prepare(
        'SELECT id FROM results WHERE submission_token_hash = ? LIMIT 1'
      ).bind(submissionHash).first();
      if (!stored?.id) return { state: 'unavailable' };
      gradeSucceeded = true;
      return { state: 'ready', resultId: String(stored.id) };
    } finally {
      if (!gradeSucceeded) {
        // A transient failure must not permanently hold a finalization lock.
        // A grade claim/result remains authoritative and is checked on retry.
        try {
          await db.prepare(
            'UPDATE _exam_active_attempts SET finalizing_at = NULL WHERE attempt_key = ? AND session_id = ? AND finalizing_at = ?'
          ).bind(key,sessionId,claimTime).run();
        } catch (releaseError) {
          console.warn('Cannot release failed exam finalization claim:',releaseError);
        }
      }
    }
  } catch (error) {
    console.error('Cannot settle inactive school exam:', error);
    return { state: 'unavailable' };
  }
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};
function reply(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {status, headers});
}
export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {status:204, headers});

export const onRequestPost: PagesFunction<any> = async context => {
  const db = getDatabase(context);
  try {
    const auth = context.request.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ')) return reply(401,{code:'EXAM_LOGIN_REQUIRED'});
    const secret = await getDynamicSecret(db, context.env.JWT_SECRET);
    const actor: any = await verifyAuthSession(auth.slice(7),secret,db);
    const userId = String(actor?.user_id || actor?.id || '');
    const role = String(actor?.role || '').toLowerCase();
    const audience = String(actor?.target_audience || '').toLocaleLowerCase('vi-VN');
    if (!userId || !(['student','học sinh'].includes(role) ||
      (role === 'user' && ['học sinh','student'].includes(audience)))) {
      return reply(403,{code:'EXAM_STUDENT_REQUIRED'});
    }
    const body: any = await context.request.json().catch(() => ({}));
    if (body?.mode === 'heartbeat') {
      const token = String(body?.token || '');
      const {verifyJWT} = await import('./utils');
      const decoded: any = token ? await verifyJWT(token,secret) : null;
      const examId = String(decoded?.examConfig?.id || '');
      const sessionId = String(decoded?.gradingSessionId || '');
      if (!examId || !sessionId || String(decoded?.studentUserId || '') !== userId ||
        decoded?.purpose !== 'exam_active') return reply(403,{code:'EXAM_HEARTBEAT_FORBIDDEN'});
      await ensureExamLifecycleColumns(db);
      const now = new Date().toISOString();
      // A heartbeat can never revive an expired or finalizing session.
      const updated: any = await db.prepare(`
        UPDATE _exam_active_attempts
        SET heartbeat_at = ?
        WHERE attempt_key = ? AND exam_id = ? AND user_id = ? AND session_id = ?
          AND finalizing_at IS NULL
          AND COALESCE(heartbeat_at, created_at) > ?
          AND EXISTS (SELECT 1 FROM _exam_grade_sessions gs
            WHERE gs.session_id = ? AND gs.started_at IS NOT NULL
              AND gs.deadline_at > ? AND gs.expires_at > ?)
          AND NOT EXISTS (
            SELECT 1 FROM _submitted_exam_tokens sub
            WHERE sub.token_hash = ? AND sub.status IN ('processing','completed')
          )
        RETURNING session_id
      `).bind(now,examId+':'+userId,examId,userId,sessionId,
        new Date(Date.now()-EXAM_DISCONNECT_MS).toISOString(),sessionId,now,now,
        await hashToken('exam-session:'+sessionId)).first();
      return updated?.session_id ? reply(200,{ok:true,serverNow:now}) :
        reply(409,{code:'EXAM_SESSION_TERMINATED',error:'Phiên thi đã kết thúc hoặc đang nộp.'});
    }
    if (body?.mode !== 'settle') return reply(400,{code:'EXAM_LIFECYCLE_MODE_REQUIRED'});
    const examId = String(body?.examId || '').trim();
    if (!examId || examId.length > 200) return reply(400,{code:'EXAM_ID_REQUIRED'});
    const state = await settleInactiveSchoolExam(context,examId,userId);
    if (state.state === 'unavailable') {
      return reply(503,{code:'EXAM_FINALIZATION_UNAVAILABLE',error:'Chưa xác minh được việc chấm bài cũ. Vui lòng thử lại.'});
    }
    return reply(200,state);
  } catch(error) {
    console.error('Exam lifecycle request failed:',error);
    return reply(503,{code:'EXAM_LIFECYCLE_UNAVAILABLE'});
  }
};
