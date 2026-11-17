import { verifyAuthSession, verifyJWT, signJWT, getDynamicSecret, getDatabase, hashToken } from './utils';
import { publicContestExam } from '../contest/register';
import { ensureExamLivenessSchema, initializeExamLiveness, finalizeExamLiveness, registerExpiredLegacyExamAttemptById } from './finalize-service';
import { reconcileExpiredLegacyOrphan } from './orphan-reconcile';
import { stripContestAnswerHints } from '../../../src/exam-public-contest-projection';
import {
  EXAM_SESSION_PURPOSE_PRESTART,
  EXAM_SESSION_PURPOSE_ACTIVE,
  evaluateExamAccessWindow,
  normalizeExamTimeLimitSeconds,
  remainingExamSecondsFromDeadline
} from '../../../src/exam-time-authority.js';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DB?: any;
  JWT_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);

  try {
    const body: any = await request.json();
    const token = String(body?.token || '').trim();
    if (body?.replaceSessionId) {
      return new Response(JSON.stringify({code:'EXAM_REPLACEMENT_DISABLED',
        error:'Không hỗ trợ bỏ phiên cũ để mở phiên mới. Bài trước phải được nộp và chấm điểm.'}),
        {status:409,headers:corsHeaders});
    }
    if (!token) {
      return new Response(JSON.stringify({ error: 'Thiếu mã phiên chuẩn bị thi.' }), { status: 400, headers: corsHeaders });
    }

    const decoded: any = await verifyJWT(token, SECRET);
    if (!decoded) {
      return new Response(JSON.stringify({ error: 'Phiên chuẩn bị thi không hợp lệ hoặc đã hết hạn.' }), { status: 403, headers: corsHeaders });
    }
    if (decoded.purpose && decoded.purpose !== EXAM_SESSION_PURPOSE_PRESTART) {
      return new Response(JSON.stringify({ error: 'Phiên này không ở trạng thái chờ bắt đầu.' }), { status: 409, headers: corsHeaders });
    }

    const gradingSessionId = String(decoded.gradingSessionId || '').trim();
    // Revocation is authoritative even if an old browser still retains a
    // PRESTART token for the abandoned grading session.
    try {
      await db.prepare(`CREATE TABLE IF NOT EXISTS _exam_abandoned_attempts (
        session_id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL,
        reason TEXT NOT NULL, abandoned_at TEXT NOT NULL
      )`).run();
      if (gradingSessionId) {
        const abandoned: any = await db.prepare(
          'SELECT session_id FROM _exam_abandoned_attempts WHERE session_id = ?'
        ).bind(gradingSessionId).first();
        if (abandoned) return new Response(JSON.stringify({
          code:'EXAM_ATTEMPT_ABANDONED',
          error:'Phiên thi này đã được bỏ do không thể khôi phục. Vui lòng bắt đầu một phiên mới.'
        }), {status:409,headers:corsHeaders});
      }
    } catch (abandonError) {
      console.error('Cannot validate abandoned session before exam start:',abandonError);
      return new Response(JSON.stringify({
        code:'EXAM_ABANDON_STATUS_UNAVAILABLE',error:'Không thể kiểm tra phiên đã bỏ; chưa bắt đầu tính giờ.'
      }), {status:503,headers:corsHeaders});
    }
    if (!gradingSessionId) {
      return new Response(JSON.stringify({ error: 'Phiên thi thiếu mã phiên chấm điểm.' }), { status: 409, headers: corsHeaders });
    }

    const authHeader = request.headers.get('authorization') || '';
    let verifiedUser: any = null;
    if (authHeader.startsWith('Bearer ')) {
      verifiedUser = await verifyAuthSession(authHeader.substring(7), SECRET, db);
    }
    const signedStudentUserId = String(decoded.studentUserId || '').trim();
    const contestParticipantId = String(decoded.contestParticipantId || '').trim();
    const signedAttemptUserId = signedStudentUserId || (contestParticipantId ? 'contest:'+contestParticipantId : '');
    if (signedStudentUserId) {
      const verifiedUserId = String(verifiedUser?.user_id || verifiedUser?.id || '').trim();
      if (!verifiedUserId || verifiedUserId !== signedStudentUserId) {
        return new Response(JSON.stringify({ error: 'Tài khoản bắt đầu thi không khớp tài khoản đã nhận đề.' }), { status: 403, headers: corsHeaders });
      }
    }

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS _exam_grade_sessions (
        session_id TEXT PRIMARY KEY,
        exam_id TEXT,
        teacher_id TEXT,
        question_ids TEXT NOT NULL,
        question_snapshot TEXT NOT NULL,
        exam_config TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        started_at TEXT,
        deadline_at TEXT
      )
    `).run();
    for (const sql of [
      'ALTER TABLE _exam_grade_sessions ADD COLUMN IF NOT EXISTS started_at TEXT',
      'ALTER TABLE _exam_grade_sessions ADD COLUMN IF NOT EXISTS deadline_at TEXT'
    ]) {
      try { await db.prepare(sql).run(); } catch {}
    }

    const snapshot: any = await db.prepare(
      'SELECT session_id, exam_id, question_ids, question_snapshot, exam_config, expires_at, started_at, deadline_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(gradingSessionId).first();
    if (!snapshot) {
      return new Response(JSON.stringify({ error: 'Phiên thi không tồn tại hoặc đã được thu hồi.' }), { status: 409, headers: corsHeaders });
    }
    const nowMs = Date.now();
    if (snapshot.expires_at && new Date(String(snapshot.expires_at)).getTime() <= nowMs) {
      return new Response(JSON.stringify({ error: 'Phiên chuẩn bị thi đã hết hạn. Vui lòng tải lại đề.' }), { status: 409, headers: corsHeaders });
    }

    const issuedIds = Array.isArray(decoded.questionIds) ? decoded.questionIds.map((id: any) => String(id)) : [];
    let frozenIds: string[] = [];
    try { frozenIds = JSON.parse(String(snapshot.question_ids || '[]')).map((id: any) => String(id)); } catch {}
    if (!issuedIds.length || JSON.stringify(issuedIds) !== JSON.stringify(frozenIds)) {
      return new Response(JSON.stringify({ error: 'Danh sách câu hỏi của phiên chuẩn bị thi không khớp dữ liệu máy chủ.' }), { status: 409, headers: corsHeaders });
    }

    let frozenExamConfig: any = {};
    try { frozenExamConfig = JSON.parse(String(snapshot.exam_config || '{}')); } catch {}
    const frozenExamRevision = String(frozenExamConfig?.examRevision || frozenExamConfig?.updated_at || '').trim();

    const examId = String(snapshot.exam_id || decoded?.examConfig?.id || '').trim();
    let authoritativeExamRow: any = null;
    if (examId) {
      try {
        authoritativeExamRow = await db.prepare('SELECT * FROM exam_configs WHERE id = ? LIMIT 1').bind(examId).first();
        if (!authoritativeExamRow) {
          return new Response(JSON.stringify({
            code: 'EXAM_REVOKED_BEFORE_START',
            error: 'Đề thi đã bị thu hồi hoặc không còn tồn tại. Phiên READY này không được phép bắt đầu.'
          }), { status: 409, headers: corsHeaders });
        }
        {
          const examRow: any = authoritativeExamRow;
    if (contestParticipantId) {
      // Landing-page preference never authorizes or disables this contest.
      const published = await publicContestExam(db,examId);
      const candidate: any = await db.prepare('SELECT ma_nguoi_du_thi FROM contest_participants WHERE ma_nguoi_du_thi = ?').bind(contestParticipantId).first();
      if (!published || !candidate) return new Response(JSON.stringify({error:'Phiên cuộc thi không còn được phép bắt đầu.'}),{status:403,headers:corsHeaders});
    }
          if (frozenExamRevision && String(examRow?.updated_at || '').trim() !== frozenExamRevision) {
            return new Response(JSON.stringify({
              code: 'EXAM_CHANGED_BEFORE_START',
              error: 'Cấu hình đề thi đã thay đổi sau khi phiên READY được tạo. Vui lòng nạp lại đề để bảo đảm mọi học sinh dùng đúng cùng một phiên bản.'
            }), { status: 409, headers: corsHeaders });
          }
          // Giữ nhất quán với /exam/generate: Admin và đúng giáo viên sở hữu đề
          // được phép kiểm thử cấu hình ngoài khung giờ. Quyền bỏ qua chỉ dựa trên
          // phiên tài khoản LIVE đã xác thực, không dựa vào dữ liệu client/JWT đề thi.
          const verifiedActorIds = new Set(
            [verifiedUser?.user_id, verifiedUser?.id]
              .map((value: any) => String(value || '').trim())
              .filter(Boolean)
          );
          const creatorId = String(examRow?.creator_id || '').trim();
          const verifiedActorRole = String(verifiedUser?.role || '').trim().toLowerCase();
          const verifiedActorAudience = String(verifiedUser?.target_audience || '').trim().toLocaleLowerCase('vi');
          const canBypassAccessWindow = verifiedActorRole === 'admin' ||
            (Boolean(creatorId) &&
             verifiedActorIds.has(creatorId) &&
             (verifiedActorRole === 'teacher' || verifiedActorAudience === 'giáo viên'));

          if (!canBypassAccessWindow) {
            const access = evaluateExamAccessWindow(examRow, nowMs);
            if (!access.allowed) {
              const message = access.code === 'EXAM_NOT_STARTED'
                ? 'Chưa đến thời gian được phép bắt đầu làm bài.'
                : access.code === 'EXAM_WINDOW_CLOSED'
                  ? 'Đã hết thời gian được phép bắt đầu làm bài.'
                  : 'Cấu hình khung thời gian của đề thi không hợp lệ.';
              return new Response(JSON.stringify({ code: access.code, error: message }), { status: 403, headers: corsHeaders });
            }
          }
        }
      } catch (error) {
        console.error('Cannot validate exam access window at start:', error);
        return new Response(JSON.stringify({ error: 'Không thể xác minh thời gian được phép bắt đầu bài thi.' }), { status: 503, headers: corsHeaders });
      }
    }

    let frozenQuestions: any[] = [];
    try { frozenQuestions = JSON.parse(String(snapshot.question_snapshot || '[]')); } catch {}
    if (!Array.isArray(frozenQuestions) || frozenQuestions.length !== frozenIds.length) {
      return new Response(JSON.stringify({ error: 'Snapshot câu hỏi không hợp lệ; bài thi chưa được mở.' }), { status: 409, headers: corsHeaders });
    }
    for (let i = 0; i < frozenQuestions.length; i++) {
      const frozenId = String(frozenQuestions[i]?.id ?? frozenQuestions[i]?.questionId ?? '');
      if (!frozenId || frozenId !== frozenIds[i]) {
        return new Response(JSON.stringify({ error: 'Snapshot câu hỏi không khớp phiên đã chuẩn bị.' }), { status: 409, headers: corsHeaders });
      }
    }

    const immediateFeedback = Boolean(decoded.immediateFeedback);
    const clientQuestions = frozenQuestions.map((q: any) => {
      if (immediateFeedback) {
        // Giữ nguyên chức năng Immediate Feedback theo yêu cầu: sau khi thời gian
        // đã bắt đầu, client nhận đáp án để phản hồi tức thời như logic hiện tại.
        return { ...q };
      }
      const { answer, ...withoutAnswer } = q || {};
      if (withoutAnswer?.options && typeof withoutAnswer.options === 'object') {
        const { answerImage, ...safeOptions } = withoutAnswer.options;
        withoutAnswer.options = safeOptions;
      }
      if (contestParticipantId) return stripContestAnswerHints(withoutAnswer);
      return withoutAnswer;
    });

    // Chuẩn bị baseline draft TRƯỚC khi khóa giờ. Nếu DB lỗi, học sinh chưa mất
    // bất kỳ giây làm bài nào. Draft này chỉ là mảng rỗng và chưa thể bị sửa
    // vì /exam/save chỉ chấp nhận token ACTIVE.
    try {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS _exam_answer_drafts (
          session_id TEXT PRIMARY KEY,
          answers_json TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 0,
          saved_at TEXT NOT NULL
        )
      `).run();
      await db.prepare(`
        INSERT INTO _exam_answer_drafts (session_id, answers_json, revision, saved_at)
        VALUES (?, ?, 0, ?)
        ON CONFLICT (session_id) DO NOTHING
      `).bind(
        gradingSessionId,
        JSON.stringify(new Array(frozenIds.length).fill(null)),
        new Date().toISOString()
      ).run();
    } catch (draftError) {
      console.error('Cannot create initial exam draft:', draftError);
      return new Response(JSON.stringify({
        error: 'Không thể tạo bản lưu an toàn ban đầu; bài thi chưa được mở.'
      }), { status: 503, headers: corsHeaders });
    }


    const timeLimitSeconds = normalizeExamTimeLimitSeconds(decoded.timeLimitSeconds);

    // Reconcile a past attempt BEFORE checking remaining quota. If its result
    // was just committed, the fresh quota query below must count it. A frozen
    // attempt that cannot be safely graded remains locked; never invent marks.
    // This also makes a new exam start independent of a deployed Cron schedule
    // when the student returns after the 90-second timeout.
    if (signedStudentUserId && !contestParticipantId && examId) {
      try {
        await ensureExamLivenessSchema(db);
        await db.prepare(`CREATE TABLE IF NOT EXISTS _exam_active_attempts (
          attempt_key TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL,
          session_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
        )`).run();
        const oldKey = examId + ':' + signedStudentUserId;
        const locked: any = await db.prepare(
          'SELECT session_id FROM _exam_active_attempts WHERE attempt_key = ?'
        ).bind(oldKey).first();
        const oldId = String(locked?.session_id || '');
        if (oldId && oldId !== gradingSessionId) {
          const archived = await reconcileExpiredLegacyOrphan(db, oldKey, oldId);
          if (!archived) {
            // Pre-heartbeat historical sessions may have a fully frozen exam
            // and an expired deadline, but no liveness row yet. Bootstrap only
            // this exact locked session, then grade it from its server draft.
            await registerExpiredLegacyExamAttemptById(context, oldId);
            const closed = await finalizeExamLiveness(context, oldId);
            if (closed.status === 'retry_required') {
              return new Response(JSON.stringify({
                code:'EXAM_PREVIOUS_ATTEMPT_FINALIZE_RETRY',
                error:'Máy chủ chưa thể lưu kết quả bài trước. Hệ thống giữ bài làm để đối soát, không mở phiên mới làm mất dữ liệu.'
              }),{status:503,headers:corsHeaders});
            }
          }
        }
      } catch (reconciliationError) {
        console.error('Cannot reconcile prior attempt before new quota check:',reconciliationError);
        return new Response(JSON.stringify({
          code:'EXAM_PREVIOUS_ATTEMPT_RECONCILIATION_UNAVAILABLE',
          error:'Máy chủ chưa xác minh được trạng thái nộp bài trước; vui lòng thử lại.'
        }),{status:503,headers:corsHeaders});
      }
    }

    let completedAttemptsForQuota = 0;
    // Chốt quyền lượt làm LẦN CUỐI ngay trước khi bắt đầu đồng hồ. Generate chỉ là
    // bước READY; nhiều READY token song song không được phép tiêu thụ nhiều lượt.
    if (signedAttemptUserId && examId) {
      const maxAttempts = Math.max(0, Number(authoritativeExamRow?.max_attempts) || 0);
      if (maxAttempts > 0) {
        try {
          let completedAttempts = 0;
          const completedRow: any = await db.prepare(contestParticipantId
            ? 'SELECT COUNT(*) AS count FROM results WHERE exam_id = ? AND ma_nguoi_du_thi = ?'
            : 'SELECT COUNT(*) AS count FROM results WHERE exam_id = ? AND user_id = ?'
          ).bind(examId, contestParticipantId || signedStudentUserId).first();
          completedAttempts = Math.max(0, Number(completedRow?.count) || 0);

          const profile: any = contestParticipantId ? null : await db.prepare(
            'SELECT full_name, lop, donvi FROM users WHERE id = ? LIMIT 1'
          ).bind(signedStudentUserId).first();
          const profileName = String(profile?.full_name || '').trim();
          const profileClass = String(profile?.lop || '').trim();
          const profileUnit = String(profile?.donvi || '').trim();
          if (profileName && profileClass && profileUnit) {
            const normalizeLegacyUnit = (value: any): string =>
              String(value || '')
                .normalize('NFKC')
                .toLocaleLowerCase('vi-VN')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/đ/g, 'd')
                .trim()
                .replace(/^truong\s+/u, '')
                .replace(/^trung\s+hoc\s+pho\s+thong\s+/u, '')
                .replace(/^thpt\s+/u, '')
                .replace(/^truong\s+thpt\s+/u, '')
                .replace(/\s+/g, ' ');
            const canonicalProfileUnit = normalizeLegacyUnit(profileUnit);

            const { results: profileCandidates } = await db.prepare(
              `SELECT id, donvi FROM users
               WHERE LOWER(TRIM(full_name)) = LOWER(TRIM(?))
                 AND LOWER(TRIM(COALESCE(lop,''))) = LOWER(TRIM(?))`
            ).bind(profileName, profileClass).all();
            const matchingProfiles = (profileCandidates || []).filter((row: any) =>
              normalizeLegacyUnit(row?.donvi) === canonicalProfileUnit
            );

            if (matchingProfiles.length === 1 &&
                String((matchingProfiles[0] as any)?.id || '') === signedStudentUserId) {
              const { results: legacyRows } = await db.prepare(
                `SELECT don_vi FROM results
                 WHERE exam_id = ?
                   AND (user_id IS NULL OR TRIM(user_id) = '')
                   AND LOWER(TRIM(student_name)) = LOWER(TRIM(?))
                   AND LOWER(TRIM(COALESCE(lop,''))) = LOWER(TRIM(?))`
              ).bind(examId, profileName, profileClass).all();
              completedAttempts += (legacyRows || []).filter((row: any) =>
                normalizeLegacyUnit(row?.don_vi) === canonicalProfileUnit
              ).length;
            }
          }

          completedAttemptsForQuota = completedAttempts;
          if (completedAttempts >= maxAttempts) {
            return new Response(JSON.stringify({
              code: 'EXAM_ATTEMPT_LIMIT_REACHED',
              attemptCount: completedAttempts,
              maxAttempts,
              error: `Bạn đã đạt giới hạn số lần làm bài thi này! (Đã hoàn thành ${completedAttempts}/${maxAttempts} lần).`
            }), { status: 403, headers: corsHeaders });
          }
        } catch (attemptError) {
          console.error('Cannot revalidate attempt limit at start:', attemptError);
          return new Response(JSON.stringify({
            code: 'EXAM_ATTEMPT_COUNT_UNAVAILABLE',
            error: 'Không thể xác minh số lần làm ngay trước khi bắt đầu. Hệ thống chưa chạy đồng hồ để bảo vệ quyền lợi học sinh.'
          }), { status: 503, headers: corsHeaders });
        }
      }
    }

    // A canceled ACTIVE attempt consumes its original attempt. The currently
    // active attempt also consumes one slot when explicitly replaced. Results
    // already submitted are counted separately as before.
    if (signedStudentUserId && !contestParticipantId) {
      try {
        await db.prepare(`CREATE TABLE IF NOT EXISTS _exam_abandoned_attempts (
          session_id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL,
          reason TEXT NOT NULL, abandoned_at TEXT NOT NULL
        )`).run();
        const canceled: any = await db.prepare(
          'SELECT COUNT(*) AS count FROM _exam_abandoned_attempts WHERE exam_id = ? AND user_id = ?'
        ).bind(examId, signedStudentUserId).first();
        const usedCanceled = Math.max(0, Number(canceled?.count) || 0);
        const completed = Math.max(0, Number(completedAttemptsForQuota) || 0);
        const replacement = String(body?.replaceSessionId || '').trim();
        const maxAttempts = Number(authoritativeExamRow?.max_attempts);
        if (!Number.isInteger(maxAttempts) || maxAttempts < 0) {
          return new Response(JSON.stringify({code:'EXAM_ATTEMPT_CONFIG_INVALID',error:'Giới hạn lượt thi không hợp lệ.'}),{status:409,headers:corsHeaders});
        }
        if (maxAttempts > 0 && completed + usedCanceled + (replacement ? 1 : 0) >= maxAttempts) {
          return new Response(JSON.stringify({
            code:'EXAM_ATTEMPT_LIMIT_REACHED',
            attemptCount:completed + usedCanceled + (replacement ? 1 : 0),maxAttempts,
            error:'Bạn không còn đủ lượt làm bài để tạo phiên mới.'
          }),{status:403,headers:corsHeaders});
        }
      } catch (quotaError) {
        console.error('Cannot validate canceled attempt count:',quotaError);
        return new Response(JSON.stringify({code:'EXAM_ATTEMPT_COUNT_UNAVAILABLE',
          error:'Không thể xác minh đầy đủ lượt đã sử dụng. Bài thi chưa bắt đầu.'}),{status:503,headers:corsHeaders});
      }
    }

    // Require the liveness schema before starting the clock. Failure here must
    // not consume a student's attempt.
    try { await ensureExamLivenessSchema(db); }
    catch (schemaError) {
      console.error('Cannot prepare exam liveness:',schemaError);
      return new Response(JSON.stringify({code:'EXAM_HEARTBEAT_SCHEMA_UNAVAILABLE',error:'Chưa thể bảo đảm tự nộp bài. Phiên thi chưa bắt đầu.'}),{status:503,headers:corsHeaders});
    }

    // Lấy thời điểm bắt đầu sát lệnh claim nhất, sau khi toàn bộ snapshot/draft
    // đã sẵn sàng, để không trừ thời gian của học sinh cho công việc chuẩn bị server.
    const proposedStartedAtMs = Date.now();
    const proposedDeadlineAtMs = proposedStartedAtMs + timeLimitSeconds * 1000;
    const proposedStartedAt = new Date(proposedStartedAtMs).toISOString();
    const proposedDeadlineAt = new Date(proposedDeadlineAtMs).toISOString();
    const proposedActiveExpiresAtMs = proposedDeadlineAtMs + 60 * 60 * 1000;
    const proposedActiveExpiresAt = new Date(proposedActiveExpiresAtMs).toISOString();

    // Với học sinh đã đăng nhập, chỉ cho phép một phiên ACTIVE trên cùng một đề.
    // Khóa DB này chặn hai tab/thiết bị cùng vượt giới hạn lượt dù cả hai đã có READY token.
    if (signedAttemptUserId && examId) {
      try {
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS _exam_active_attempts (
            attempt_key TEXT PRIMARY KEY,
            exam_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
          )
        `).run();
        const attemptKey = examId + ':' + signedAttemptUserId;
        const replacementId = signedStudentUserId && !contestParticipantId
          ? String(body?.replaceSessionId || '').trim() : '';
        if (replacementId) {
          // Commit swap + revocation together. No separate "delete old then
          // create new" request can strand a student without an attempt.
          // The lock row serializes concurrent replacement requests.
          await db.prepare(`CREATE TABLE IF NOT EXISTS _submitted_exam_tokens (
            token_hash TEXT PRIMARY KEY, exam_id TEXT, student_name TEXT, user_id TEXT,
            submitted_at TEXT, status TEXT, result_id TEXT, claimed_at TEXT
          )`).run();
          for (const column of ['status','result_id']) {
            await db.prepare('ALTER TABLE _submitted_exam_tokens ADD COLUMN IF NOT EXISTS ' + column + ' TEXT').run();
          }
          const submissionHash = await hashToken('exam-session:' + replacementId);
          const replaced: any = await db.prepare(`
            WITH old AS (
              SELECT session_id
              FROM _exam_active_attempts
              WHERE attempt_key = ? AND exam_id = ? AND user_id = ? AND session_id = ?
              FOR UPDATE
            ),
            switched AS (
              UPDATE _exam_active_attempts AS active_lock
              SET session_id = ?, expires_at = ?, created_at = ?
              FROM old
              WHERE active_lock.attempt_key = ? AND active_lock.session_id = old.session_id
                AND old.session_id <> ?
                AND EXISTS (
                  SELECT 1 FROM _exam_grade_sessions ready
                  WHERE ready.session_id = ? AND ready.started_at IS NULL
                  FOR UPDATE
                )
                AND NOT EXISTS (
                  SELECT 1 FROM _submitted_exam_tokens s
                  WHERE s.token_hash = ? AND s.status IN ('processing','completed')
                )
                AND NOT EXISTS (
                  SELECT 1 FROM results result WHERE result.submission_token_hash = ?
                )
                AND (? = 0 OR (
                  (SELECT COUNT(*) FROM results WHERE exam_id = ? AND user_id = ?) +
                  (SELECT COUNT(*) FROM _exam_abandoned_attempts WHERE exam_id = ? AND user_id = ?) +
                  1 < ?
                ))
              RETURNING old.session_id AS old_session_id
            ),
            activated AS (
              UPDATE _exam_grade_sessions AS new_session
              SET started_at = ?, deadline_at = ?, expires_at = ?
              FROM switched
              WHERE new_session.session_id = ? AND new_session.started_at IS NULL
              RETURNING switched.old_session_id
            ),
            revoked AS (
              INSERT INTO _exam_abandoned_attempts
                (session_id, exam_id, user_id, reason, abandoned_at)
              SELECT old_session_id, ?, ?, 'replaced_by_student', ?
              FROM activated WHERE TRUE
              ON CONFLICT (session_id) DO UPDATE SET reason = excluded.reason
              RETURNING session_id
            )
            SELECT session_id FROM revoked LIMIT 1
          `).bind(
            attemptKey,examId,signedStudentUserId,replacementId,
            gradingSessionId,proposedActiveExpiresAt,proposedStartedAt,
            attemptKey,gradingSessionId,gradingSessionId,submissionHash,submissionHash,
            Number(authoritativeExamRow?.max_attempts) || 0,
            examId,signedStudentUserId,examId,signedStudentUserId,
            Number(authoritativeExamRow?.max_attempts) || 0,
            proposedStartedAt,proposedDeadlineAt,proposedActiveExpiresAt,gradingSessionId,
            examId,signedStudentUserId,proposedStartedAt
          ).first();
          if (!replaced?.session_id) {
            return new Response(JSON.stringify({
              code:'EXAM_REPLACEMENT_CONFLICT',
              error:'Phiên thi hoặc số lượt đã thay đổi; vui lòng kiểm tra lại. Phiên cũ chưa bị hủy.'
            }),{status:409,headers:corsHeaders});
          }
        } else {


        // Never silently discard a stale ACTIVE lock. Even if its old
        // snapshot vanished, the original attempt is consumed and must be
        // explicitly replaced via the counted atomic transaction above.

        // Before acquiring a new slot, reconcile a prior attempt only when
        // its server heartbeat proves it has ended (not from browser storage).
        const existingLock: any = await db.prepare(
          'SELECT session_id FROM _exam_active_attempts WHERE attempt_key = ?'
        ).bind(attemptKey).first();
        if (existingLock && String(existingLock.session_id)!==gradingSessionId) {
          // The old schema can leave ACTIVE locks whose frozen session has
          // already vanished. Archive only verifiably expired orphan locks,
          // then require a fresh quota check on the next start request.
          const orphanReleased=signedStudentUserId && !contestParticipantId
            ? await reconcileExpiredLegacyOrphan(
                db,attemptKey,String(existingLock.session_id)
              )
            : false;
          if (orphanReleased) {
            return new Response(JSON.stringify({
              code:'EXAM_PREVIOUS_ATTEMPT_RECONCILED',
              error:'Lượt thi cũ không còn bản đề gốc đã được ghi nhận để đối soát. Vui lòng bấm bắt đầu lại; hệ thống sẽ kiểm tra lượt còn lại.'
            }),{status:409,headers:corsHeaders});
          }
          const prior=await finalizeExamLiveness(context,String(existingLock.session_id));
          if (prior.status==='finalized') {
            // Quota must be checked again against the newly persisted result.
            // Do not consume a stale READY token in the same request.
            return new Response(JSON.stringify({code:'EXAM_PREVIOUS_ATTEMPT_FINALIZED',
              error:'Bài thi trước vừa được tự động nộp. Vui lòng bấm bắt đầu lại để kiểm tra số lượt còn lại.'}),
              {status:409,headers:corsHeaders});
          }
        }
        const claim: any = await db.prepare(`
          INSERT INTO _exam_active_attempts
            (attempt_key, exam_id, user_id, session_id, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (attempt_key) DO UPDATE SET
            session_id = excluded.session_id,
            expires_at = excluded.expires_at,
            created_at = excluded.created_at
          WHERE _exam_active_attempts.session_id = excluded.session_id
        `).bind(
          attemptKey, examId, signedAttemptUserId, gradingSessionId,
          proposedActiveExpiresAt, proposedStartedAt
        ).run();
        if (Number(claim?.meta?.changes || 0) !== 1) {
          return new Response(JSON.stringify({
            code: 'EXAM_ATTEMPT_ALREADY_ACTIVE',
            error: 'Lượt thi trước của tài khoản này chưa được máy chủ kết thúc. Hệ thống đang bảo toàn bài làm và chưa thể mở lượt mới. Vui lòng thử lại; nếu tình trạng kéo dài, liên hệ giáo viên quản lý đề.'
          }), { status: 409, headers: corsHeaders });
        }
        } // regular claim; replacement claimed atomically above
      } catch (activeClaimError) {
        console.error('Cannot claim active exam attempt:', activeClaimError);
        return new Response(JSON.stringify({
          code: 'EXAM_ATTEMPT_CLAIM_UNAVAILABLE',
          error: 'Không thể khóa lượt làm an toàn. Hệ thống chưa chạy đồng hồ.'
        }), { status: 503, headers: corsHeaders });
      }
    }

    // Record the accepted contest attempt without affecting school accounts.
    if (contestParticipantId) {
      try {
        // A submission is authoritative once the results row is committed.
        // Recover rare crashes between result INSERT and contest_attempts metadata
        // update by exact signed grading-session ID, never by shared names.
        await db.prepare(`
          UPDATE contest_attempts ca
          SET trang_thai='DA_NOP', ma_ket_qua=r.id,
              thoi_diem_nop=COALESCE(r.created_at::timestamptz,now())
          FROM results r
          WHERE ca.ma_nguoi_du_thi=? AND ca.ma_de_thi=?
            AND ca.trang_thai='DANG_LAM'
            AND r.ma_phien_thi=ca.ma_phien_thi
            AND r.ma_nguoi_du_thi=ca.ma_nguoi_du_thi
            AND r.exam_id=ca.ma_de_thi
        `).bind(contestParticipantId,examId).run();
        // Reconcile orphaned ACTIVE rows only when the older session has
        // demonstrably expired or been removed. Never cancel a live attempt.
        await db.prepare(`
          UPDATE contest_attempts SET trang_thai = 'HUY'
          WHERE ma_nguoi_du_thi = ? AND ma_de_thi = ?
            AND trang_thai = 'DANG_LAM' AND ma_phien_thi <> ?
            AND NOT EXISTS (
              SELECT 1 FROM _exam_grade_sessions gs
              WHERE gs.session_id = contest_attempts.ma_phien_thi
                AND gs.expires_at > ?
                AND gs.started_at IS NOT NULL
            )
        `).bind(contestParticipantId,examId,gradingSessionId,new Date().toISOString()).run();
        await db.prepare(`
          INSERT INTO contest_attempts
            (ma_phien_thi,ma_nguoi_du_thi,ma_de_thi,trang_thai,thoi_diem_bat_dau)
          VALUES (?,?,?,'DANG_LAM',?)
          ON CONFLICT (ma_phien_thi) DO NOTHING
        `).bind(gradingSessionId,contestParticipantId,examId,proposedStartedAt).run();
      } catch (error) {
        console.error('Cannot bind contest attempt to verified session:',error);
        try { await db.prepare('DELETE FROM _exam_active_attempts WHERE session_id = ?').bind(gradingSessionId).run(); } catch {}
        return new Response(JSON.stringify({error:'Chưa thể xác nhận phiên dự thi. Vui lòng tiếp tục phiên hiện có.'}),{status:503,headers:corsHeaders});
      }
    }

    // Claim đầu tiên ghi đồng thời start + deadline + TTL kỹ thuật. Nếu lệnh này
    // thất bại trước khi đồng hồ được ghi, thu hồi khóa ACTIVE để học sinh không mắc kẹt.
    try {
      // A replacement already activated the snapshot inside the same atomic
      // SQL statement that revoked the previous session and swapped its lock.
      // A second update is unnecessary and a later network error must not
      // remove an already-committed replacement.
      if (!(signedStudentUserId && body?.replaceSessionId)) {
        await db.prepare(
          'UPDATE _exam_grade_sessions SET started_at = ?, deadline_at = ?, expires_at = ? WHERE session_id = ? AND started_at IS NULL'
        ).bind(proposedStartedAt, proposedDeadlineAt, proposedActiveExpiresAt, gradingSessionId).run();
      }
    } catch (startClaimError) {
      if (signedAttemptUserId && examId && !body?.replaceSessionId) {
        try {
          await db.prepare('DELETE FROM _exam_active_attempts WHERE session_id = ?')
            .bind(gradingSessionId).run();
        } catch {}
      }
      throw startClaimError;
    }

    let authoritative: any = await db.prepare(
      'SELECT started_at, deadline_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(gradingSessionId).first();

    // Không được dùng mốc "đề xuất" làm fallback nếu DB không chứng minh đã claim
    // started_at. Snapshot có thể bị dọn đúng giữa SELECT đầu và UPDATE; trong race
    // đó trả token ACTIVE sẽ tạo một phiên ảo mà save/grade không thể xác minh.
    if (!authoritative?.started_at) {
      if (signedAttemptUserId && examId && !body?.replaceSessionId) {
        try {
          await db.prepare('DELETE FROM _exam_active_attempts WHERE session_id = ?')
            .bind(gradingSessionId).run();
        } catch {}
      }
      return new Response(JSON.stringify({
        code: 'EXAM_START_CLAIM_NOT_PERSISTED',
        error: 'Máy chủ chưa xác nhận được thời điểm bắt đầu trong cơ sở dữ liệu. Đồng hồ chưa được tính; vui lòng thử lại.'
      }), { status: 503, headers: corsHeaders });
    }

    // Tự sửa dữ liệu chuyển tiếp nếu bản ghi cũ hiếm gặp đã có started_at nhưng thiếu deadline.
    const existingStartedAtMs = new Date(String(authoritative.started_at)).getTime();
    if (Number.isFinite(existingStartedAtMs) && existingStartedAtMs > 0 && !authoritative?.deadline_at) {
      const recoveredDeadlineAt = new Date(existingStartedAtMs + timeLimitSeconds * 1000).toISOString();
      await db.prepare(
        'UPDATE _exam_grade_sessions SET deadline_at = ? WHERE session_id = ? AND deadline_at IS NULL'
      ).bind(recoveredDeadlineAt, gradingSessionId).run();
      authoritative = await db.prepare(
        'SELECT started_at, deadline_at FROM _exam_grade_sessions WHERE session_id = ?'
      ).bind(gradingSessionId).first();
    }

    const startedAtMs = new Date(String(authoritative?.started_at || '')).getTime();
    const deadlineAtMs = new Date(String(authoritative?.deadline_at || '')).getTime();
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(deadlineAtMs) || deadlineAtMs <= startedAtMs) {
      return new Response(JSON.stringify({ error: 'Không thể thiết lập mốc thời gian thi an toàn.' }), { status: 503, headers: corsHeaders });
    }

    // TTL kỹ thuật độc lập với deadline. Fresh claim đã ghi expires_at nguyên tử;
    // retry chỉ cần bảo đảm giá trị cũ không ngắn hơn deadline + 1 giờ.
    const activeExpiresAtMs = deadlineAtMs + 60 * 60 * 1000;
    const activeExpiresAt = new Date(activeExpiresAtMs).toISOString();
    if (signedAttemptUserId && examId) {
      try {
        await db.prepare(
          'UPDATE _exam_active_attempts SET expires_at = ? WHERE session_id = ?'
        ).bind(activeExpiresAt, gradingSessionId).run();
      } catch {}
    }
    if (snapshot.started_at) {
      try {
        await db.prepare(
          'UPDATE _exam_grade_sessions SET expires_at = ? WHERE session_id = ? AND expires_at < ?'
        ).bind(activeExpiresAt, gradingSessionId, activeExpiresAt).run();
      } catch (expiryUpdateError) {
        console.error('Cannot verify technical active-session TTL:', expiryUpdateError);
        return new Response(JSON.stringify({
          error: 'Không thể xác minh thời hạn kỹ thuật của phiên thi; bài thi chưa được mở.'
        }), { status: 503, headers: corsHeaders });
      }
    }

    // The liveness record is required for a started attempt. On ambiguous
    // database failure leave the lock intact rather than issue a falsely
    // recoverable token; the watchdog will reconcile only proven sessions.
    try {
      await initializeExamLiveness(db,{
        sessionId:gradingSessionId,examId,userId:signedStudentUserId,
        contestParticipantId,deadlineAt:new Date(deadlineAtMs).toISOString(),
        studentInfo:body?.studentInfo || {}
      });
    } catch(livenessError) {
      console.error('Unable to register started attempt for automatic finalization:',livenessError);
      // No ACTIVE token has been issued to the browser. Revert only our exact
      // unexposed start attempt; never delete a completed result or draft.
      try {
        const rolledBack: any = await db.prepare('UPDATE _exam_grade_sessions SET started_at=NULL,deadline_at=NULL WHERE session_id=? AND started_at=?')
          .bind(gradingSessionId,new Date(startedAtMs).toISOString()).run();
        if (Number(rolledBack?.meta?.changes || 0) === 1) {
          await db.prepare('DELETE FROM _exam_active_attempts WHERE session_id=?').bind(gradingSessionId).run();
          if (contestParticipantId) {
            await db.prepare("DELETE FROM contest_attempts WHERE ma_phien_thi=? AND trang_thai='DANG_LAM'")
              .bind(gradingSessionId).run();
          }
        }
      } catch (rollbackError) {
        console.error('Unable to roll back unexposed exam start:',rollbackError);
      }
      return new Response(JSON.stringify({code:'EXAM_START_LIVENESS_UNAVAILABLE',error:'Không thể xác nhận bộ giám sát phiên thi. Máy chủ chưa cho phép mở bài.'}),{status:503,headers:corsHeaders});
    }

    const activePayload = {
      ...decoded,
      purpose: EXAM_SESSION_PURPOSE_ACTIVE,
      startedAtMs,
      deadlineAtMs,
      timestamp: startedAtMs,
      timeLimitSeconds,
      exp: Math.floor(activeExpiresAtMs / 1000)
    };
    const activeToken = await signJWT(activePayload, SECRET);
    const responseNowMs = Date.now();

    return new Response(JSON.stringify({
      token: activeToken,
      startedAtMs,
      deadlineAtMs,
      serverNowMs: responseNowMs,
      timeLimitSeconds,
      remainingSeconds: remainingExamSecondsFromDeadline(deadlineAtMs, responseNowMs),
      questions: clientQuestions,
      immediateFeedback
    }), { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error('POST /api/exam/start error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Không thể bắt đầu phiên thi.' }), { status: 500, headers: corsHeaders });
  }
};
