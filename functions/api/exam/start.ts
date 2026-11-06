import { verifyAuthSession, verifyJWT, getDynamicSecret, getDatabase } from './utils';

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

const normalizeGuestKeyPart = (value: unknown) =>
  String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const secret = await getDynamicSecret(db, context.env.JWT_SECRET);

  try {
    const body: any = await context.request.json();
    const token = String(body?.token || '').trim();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Thiếu mã phiên thi.' }), {
        status: 400, headers: corsHeaders
      });
    }

    const decoded: any = await verifyJWT(token, secret);
    if (!decoded?.gradingSessionId || !Array.isArray(decoded?.questionIds)) {
      return new Response(JSON.stringify({ error: 'Phiên thi không hợp lệ hoặc thiếu snapshot chấm điểm.' }), {
        status: 403, headers: corsHeaders
      });
    }

    const signedStudentUserId = decoded.studentUserId ? String(decoded.studentUserId) : '';
    if (signedStudentUserId) {
      const authHeader = context.request.headers.get('authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Phiên đăng nhập không hợp lệ.' }), {
          status: 401, headers: corsHeaders
        });
      }
      const user: any = await verifyAuthSession(authHeader.slice(7), secret, db);
      const requestUserId = String(user?.user_id || user?.id || '');
      if (!requestUserId || requestUserId !== signedStudentUserId) {
        return new Response(JSON.stringify({ error: 'Tài khoản bắt đầu bài thi không khớp phiên đã phát.' }), {
          status: 403, headers: corsHeaders
        });
      }
    }

    const sessionId = String(decoded.gradingSessionId);
    const session: any = await db.prepare(
      'SELECT session_id, question_ids, started_at, expires_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(sessionId).first();

    if (!session) {
      return new Response(JSON.stringify({ error: 'Phiên chấm điểm không tồn tại hoặc đã bị thu hồi.' }), {
        status: 409, headers: corsHeaders
      });
    }
    if (session.expires_at && new Date(String(session.expires_at)).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: 'Phiên thi đã hết hạn trước khi bắt đầu.' }), {
        status: 409, headers: corsHeaders
      });
    }

    const frozenIds = JSON.parse(String(session.question_ids || '[]')).map((id: any) => String(id));
    const issuedIds = decoded.questionIds.map((id: any) => String(id));
    if (JSON.stringify(frozenIds) !== JSON.stringify(issuedIds)) {
      return new Response(JSON.stringify({ error: 'Snapshot câu hỏi không khớp phiên thi.' }), {
        status: 409, headers: corsHeaders
      });
    }

    let attemptNumber: number | null = null;
    const maxAttempts = Math.max(0, Math.floor(Number(decoded.maxAttempts) || 0));
    const examId = String(decoded?.examConfig?.id || '').trim();

    // The start endpoint is the authoritative attempt gate. A slot is consumed
    // exactly when the student actually enters the exam, not while viewing the ready dialog.
    if (!session.started_at && maxAttempts > 0) {
      if (!examId) {
        return new Response(JSON.stringify({
          error: 'Không xác định được mã đề thi để khóa lượt làm bài.'
        }), { status: 409, headers: corsHeaders });
      }

      const guestName = String(decoded.studentName || '').trim();
      const guestClass = String(decoded.studentClass || decoded.studentLop || '').trim();
      const guestUnit = String(decoded.studentDonvi || '').trim();
      const candidateKey = signedStudentUserId
        ? 'user:' + signedStudentUserId
        : 'guest:' + [
            normalizeGuestKeyPart(guestName),
            normalizeGuestKeyPart(guestClass),
            normalizeGuestKeyPart(guestUnit)
          ].join('|');

      if (!signedStudentUserId && !normalizeGuestKeyPart(guestName)) {
        return new Response(JSON.stringify({
          error: 'Không xác định được danh tính thí sinh để khóa lượt làm bài.'
        }), { status: 409, headers: corsHeaders });
      }

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS _exam_attempt_slots (
          exam_id TEXT NOT NULL,
          candidate_key TEXT NOT NULL,
          attempt_no INTEGER NOT NULL,
          session_id TEXT NOT NULL UNIQUE,
          started_at TEXT NOT NULL,
          expires_at TEXT,
          completed_at TEXT,
          result_id TEXT,
          PRIMARY KEY (exam_id, candidate_key, attempt_no)
        )
      `).run();
      try {
        await db.prepare('ALTER TABLE _exam_attempt_slots ADD COLUMN IF NOT EXISTS expires_at TEXT').run();
        await db.prepare(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_attempt_slots_one_active ON _exam_attempt_slots(exam_id, candidate_key) WHERE completed_at IS NULL'
        ).run();
      } catch (slotSchemaErr) {
        console.error('Could not enforce single active exam attempt:', slotSchemaErr);
        return new Response(JSON.stringify({
          error: 'Không thể khóa an toàn lượt làm bài đang hoạt động.'
        }), { status: 503, headers: corsHeaders });
      }

      // An expired session still consumes its attempt slot, but it must no longer
      // block the candidate from starting the next allowed attempt.
      await db.prepare(
        "UPDATE _exam_attempt_slots SET completed_at = COALESCE(completed_at, expires_at) WHERE completed_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?"
      ).bind(new Date().toISOString()).run();

      const existingSlot: any = await db.prepare(
        'SELECT attempt_no FROM _exam_attempt_slots WHERE session_id = ?'
      ).bind(sessionId).first();

      if (existingSlot?.attempt_no) {
        attemptNumber = Number(existingSlot.attempt_no);
      } else {
        const activeOther: any = await db.prepare(
          'SELECT session_id, attempt_no FROM _exam_attempt_slots WHERE exam_id = ? AND candidate_key = ? AND completed_at IS NULL LIMIT 1'
        ).bind(examId, candidateKey).first();
        if (activeOther) {
          return new Response(JSON.stringify({
            code: 'EXAM_ATTEMPT_ALREADY_ACTIVE',
            error: 'Bạn đang có một lượt làm bài khác chưa kết thúc. Không thể mở đồng thời nhiều lượt.'
          }), { status: 409, headers: corsHeaders });
        }

        let completedCount = 0;
        if (signedStudentUserId) {
          const row: any = await db.prepare(
            'SELECT COUNT(*) AS count FROM results WHERE exam_id = ? AND user_id = ?'
          ).bind(examId, signedStudentUserId).first();
          completedCount = Math.max(0, Number(row?.count || 0));
        } else {
          // Compatibility with historical guest results: guest identity was stored
          // by name. New sessions additionally use class/unit in candidate_key to
          // prevent concurrent slot collisions among distinct signed guest identities.
          const row: any = await db.prepare(
            'SELECT COUNT(*) AS count FROM results WHERE exam_id = ? AND LOWER(TRIM(student_name)) = LOWER(TRIM(?))'
          ).bind(examId, guestName).first();
          completedCount = Math.max(0, Number(row?.count || 0));
        }

        if (completedCount >= maxAttempts) {
          return new Response(JSON.stringify({
            code: 'EXAM_ATTEMPT_LIMIT_REACHED',
            attemptCount: completedCount,
            maxAttempts,
            error: `Bạn đã đạt giới hạn số lần làm bài thi này! (Bạn đã hoàn thành ${completedCount} lần / Tối đa ${maxAttempts} lần làm bài quy định).`
          }), { status: 403, headers: corsHeaders });
        }

        const slotStartedAt = new Date().toISOString();
        for (let slot = completedCount + 1; slot <= maxAttempts; slot++) {
          const insert = await db.prepare(
            `INSERT INTO _exam_attempt_slots
              (exam_id, candidate_key, attempt_no, session_id, started_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT DO NOTHING`
          ).bind(examId, candidateKey, slot, sessionId, slotStartedAt, String(session.expires_at || '')).run();

          if (Number(insert?.meta?.changes || 0) === 1) {
            attemptNumber = slot;
            break;
          }

          // A concurrent request for this same session may have won the unique
          // session_id race. Re-read before trying another attempt slot.
          const sameSession: any = await db.prepare(
            'SELECT attempt_no FROM _exam_attempt_slots WHERE session_id = ?'
          ).bind(sessionId).first();
          if (sameSession?.attempt_no) {
            attemptNumber = Number(sameSession.attempt_no);
            break;
          }
          const concurrentActive: any = await db.prepare(
            'SELECT session_id FROM _exam_attempt_slots WHERE exam_id = ? AND candidate_key = ? AND completed_at IS NULL LIMIT 1'
          ).bind(examId, candidateKey).first();
          if (concurrentActive) {
            return new Response(JSON.stringify({
              code: 'EXAM_ATTEMPT_ALREADY_ACTIVE',
              error: 'Một lượt làm bài khác vừa được bắt đầu. Hệ thống không cho phép hai lượt chạy đồng thời.'
            }), { status: 409, headers: corsHeaders });
          }
        }

        if (!attemptNumber) {
          return new Response(JSON.stringify({
            code: 'EXAM_ATTEMPT_LIMIT_REACHED',
            attemptCount: maxAttempts,
            maxAttempts,
            error: `Bạn đã đạt giới hạn ${maxAttempts} lượt làm bài được phép.`
          }), { status: 403, headers: corsHeaders });
        }
      }
    }

    let startedAt = session.started_at ? String(session.started_at) : '';
    if (!startedAt) {
      const candidate = new Date().toISOString();
      await db.prepare(
        'UPDATE _exam_grade_sessions SET started_at = ? WHERE session_id = ? AND (started_at IS NULL OR started_at = \'\')'
      ).bind(candidate, sessionId).run();

      const refreshed: any = await db.prepare(
        'SELECT started_at FROM _exam_grade_sessions WHERE session_id = ?'
      ).bind(sessionId).first();
      startedAt = String(refreshed?.started_at || candidate);
    }

    const startedAtMs = Date.parse(startedAt);
    const elapsedSeconds = Number.isFinite(startedAtMs)
      ? Math.max(0, (Date.now() - startedAtMs) / 1000)
      : 0;

    return new Response(JSON.stringify({
      ok: true,
      startedAt,
      elapsedSeconds,
      attemptNumber,
      maxAttempts,
      timeLimitSeconds: Math.max(1, Math.floor(Number(decoded.timeLimitSeconds) || 1))
    }), { status: 200, headers: corsHeaders });
  } catch (err: any) {
    console.error('POST /api/exam/start failed:', err);
    return new Response(JSON.stringify({
      error: err?.message || 'Không thể xác lập thời điểm bắt đầu bài thi.'
    }), { status: 500, headers: corsHeaders });
  }
};
