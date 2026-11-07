import { verifyAuthSession, verifyJWT, signJWT, getDynamicSecret, getDatabase } from './utils';
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
    if (!gradingSessionId) {
      return new Response(JSON.stringify({ error: 'Phiên thi thiếu mã phiên chấm điểm.' }), { status: 409, headers: corsHeaders });
    }

    const authHeader = request.headers.get('authorization') || '';
    let verifiedUser: any = null;
    if (authHeader.startsWith('Bearer ')) {
      verifiedUser = await verifyAuthSession(authHeader.substring(7), SECRET, db);
    }
    const signedStudentUserId = String(decoded.studentUserId || '').trim();
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

    // Chốt quyền lượt làm LẦN CUỐI ngay trước khi bắt đầu đồng hồ. Generate chỉ là
    // bước READY; nhiều READY token song song không được phép tiêu thụ nhiều lượt.
    if (signedStudentUserId && examId) {
      const maxAttempts = Math.max(0, Number(authoritativeExamRow?.max_attempts) || 0);
      if (maxAttempts > 0) {
        try {
          let completedAttempts = 0;
          const completedRow: any = await db.prepare(
            'SELECT COUNT(*) AS count FROM results WHERE exam_id = ? AND user_id = ?'
          ).bind(examId, signedStudentUserId).first();
          completedAttempts = Math.max(0, Number(completedRow?.count) || 0);

          const profile: any = await db.prepare(
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
                .trim()
                .replace(/^trường\s+/u, '')
                .replace(/^trung\s+học\s+phổ\s+thông\s+/u, '')
                .replace(/^thpt\s+/u, '')
                .replace(/^trường\s+thpt\s+/u, '')
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
    if (signedStudentUserId && examId) {
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
        const attemptKey = examId + ':' + signedStudentUserId;

        // Tự-heal khóa mồ côi nếu lần nộp trước đã dọn snapshot nhưng DELETE khóa
        // ACTIVE bị lỗi tạm thời. Không xóa khóa khi session cũ vẫn còn tồn tại.
        const existingActive: any = await db.prepare(
          'SELECT session_id FROM _exam_active_attempts WHERE attempt_key = ?'
        ).bind(attemptKey).first();
        if (existingActive?.session_id && String(existingActive.session_id) !== gradingSessionId) {
          const existingSession: any = await db.prepare(
            'SELECT session_id FROM _exam_grade_sessions WHERE session_id = ?'
          ).bind(String(existingActive.session_id)).first();
          if (!existingSession) {
            await db.prepare(
              'DELETE FROM _exam_active_attempts WHERE attempt_key = ? AND session_id = ?'
            ).bind(attemptKey, String(existingActive.session_id)).run();
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
             OR _exam_active_attempts.expires_at <= ?
        `).bind(
          attemptKey, examId, signedStudentUserId, gradingSessionId,
          proposedActiveExpiresAt, proposedStartedAt, proposedStartedAt
        ).run();
        if (Number(claim?.meta?.changes || 0) !== 1) {
          return new Response(JSON.stringify({
            code: 'EXAM_ATTEMPT_ALREADY_ACTIVE',
            error: 'Tài khoản này đang có một phiên làm bài của cùng đề chưa hoàn tất. Vui lòng tiếp tục phiên đang làm thay vì mở thêm lượt mới.'
          }), { status: 409, headers: corsHeaders });
        }
      } catch (activeClaimError) {
        console.error('Cannot claim active exam attempt:', activeClaimError);
        return new Response(JSON.stringify({
          code: 'EXAM_ATTEMPT_CLAIM_UNAVAILABLE',
          error: 'Không thể khóa lượt làm an toàn. Hệ thống chưa chạy đồng hồ.'
        }), { status: 503, headers: corsHeaders });
      }
    }

    // Claim đầu tiên ghi đồng thời start + deadline + TTL kỹ thuật. Nếu lệnh này
    // thất bại trước khi đồng hồ được ghi, thu hồi khóa ACTIVE để học sinh không mắc kẹt.
    try {
      await db.prepare(
        'UPDATE _exam_grade_sessions SET started_at = ?, deadline_at = ?, expires_at = ? WHERE session_id = ? AND started_at IS NULL'
      ).bind(proposedStartedAt, proposedDeadlineAt, proposedActiveExpiresAt, gradingSessionId).run();
    } catch (startClaimError) {
      if (signedStudentUserId && examId) {
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
      if (signedStudentUserId && examId) {
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
    if (signedStudentUserId && examId) {
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
