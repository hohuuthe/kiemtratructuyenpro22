import { verifyAuthSession, getDynamicSecret, checkIsAdmin, checkIsTeacherOrAdmin, getDatabase } from './exam/utils';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DB?: any;
  JWT_SECRET?: string;
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store'
};

const reply = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers });

function norm(value: any) {
  return String(value ?? '').trim();
}
function normLower(value: any) {
  return norm(value).toLocaleLowerCase('vi');
}
function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {}
  }
  return [];
}
function asObject(value: any): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {}
  }
  return {};
}
function normalizeQuestionType(value: any) {
  const t = normLower(value);
  return ['4-1', 'trac_nghiem', 'mcq', 'multiple_choice'].includes(t) ? '4-1' : norm(value);
}
function normalizeLevel(value: any) {
  const v = norm(value).toUpperCase();
  if (v === 'NB' || v.includes('NHẬN')) return 'NB';
  if (v === 'TH' || v.includes('THÔNG')) return 'TH';
  if (v === 'VD' || v.includes('VẬN')) return 'VD';
  return v || 'NB';
}
function lessonKey(value: any) {
  return norm(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function lessonAllowed(questionLesson: any, selectedLessons: any[]) {
  const qRaw = norm(questionLesson);
  if (!qRaw) return false;
  const qLower = qRaw.toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim();
  const qKey = lessonKey(qRaw);
  return selectedLessons.some(item => {
    const aRaw = norm(item);
    if (!aRaw) return false;
    return qRaw === aRaw ||
      qLower === aRaw.toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim() ||
      qKey === lessonKey(aRaw);
  });
}
function safeOptions(value: any) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch {}
  }
  return {};
}
function shuffle<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function randomToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function randomJoinCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}
async function makeUniqueJoinCode(db: any) {
  for (let i = 0; i < 8; i++) {
    const code = randomJoinCode();
    const exists: any = await db.prepare("SELECT id FROM qr_answer_sessions WHERE join_code=? AND status='open' LIMIT 1").bind(code).first();
    if (!exists) return code;
  }
  return randomJoinCode() + randomJoinCode();
}
async function ownedSession(db: any, user: any, admin: boolean, sessionId: string) {
  const session: any = await db.prepare('SELECT * FROM qr_answer_sessions WHERE id=? LIMIT 1').bind(sessionId).first();
  if (!session) throw Object.assign(new Error('Không tìm thấy phiên quét.'), { status: 404, code: 'SESSION_NOT_FOUND' });
  if (!admin && !actorIds(user).includes(norm(session.creator_id))) {
    throw Object.assign(new Error('Không có quyền truy cập phiên quét này.'), { status: 403, code: 'SESSION_SCOPE_DENIED' });
  }
  return session;
}
function actorIds(user: any) {
  return [...new Set([user?.id, user?.user_id].map(norm).filter(Boolean))];
}
function isStudentAudience(value: any) {
  return normLower(value) === 'học sinh';
}

async function ensureTables(db: any) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS qr_answer_cards (
      card_token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      student_code TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS qr_answer_sessions (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL,
      exam_id TEXT NOT NULL,
      exam_name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      donvi TEXT NOT NULL DEFAULT '',
      questions_json TEXT NOT NULL,
      question_count INTEGER NOT NULL DEFAULT 0,
      points_41 REAL NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open',
      join_code TEXT NOT NULL DEFAULT '',
      current_question_index INTEGER NOT NULL DEFAULT 0,
      current_question_id TEXT NOT NULL DEFAULT '',
      collection_state TEXT NOT NULL DEFAULT 'collecting',
      state_revision INTEGER NOT NULL DEFAULT 1,
      response_revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      created_at TEXT NOT NULL,
      finalized_at TEXT
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS qr_answer_responses (
      session_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      card_token TEXT NOT NULL,
      answer TEXT NOT NULL,
      stable_hits INTEGER NOT NULL DEFAULT 3,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (session_id, question_id, user_id)
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS qr_answer_result_links (
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      result_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_id, user_id)
    )
  `).run();
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_qr_cards_user ON qr_answer_cards(user_id)').run(); } catch {}
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_qr_sessions_creator ON qr_answer_sessions(creator_id, created_at DESC)').run(); } catch {}
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_qr_responses_session ON qr_answer_responses(session_id, question_id)').run(); } catch {}
  for (const alter of [
    "ALTER TABLE qr_answer_sessions ADD COLUMN join_code TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE qr_answer_sessions ADD COLUMN current_question_index INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE qr_answer_sessions ADD COLUMN current_question_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE qr_answer_sessions ADD COLUMN collection_state TEXT NOT NULL DEFAULT 'collecting'",
    "ALTER TABLE qr_answer_sessions ADD COLUMN state_revision INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE qr_answer_sessions ADD COLUMN response_revision INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE qr_answer_sessions ADD COLUMN updated_at TEXT"
  ]) {
    try { await db.prepare(alter).run(); } catch {}
  }
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_qr_sessions_join_code ON qr_answer_sessions(join_code)').run(); } catch {}

  // Tenant cũ có thể chưa đi qua /api/exam/grade kể từ khi bổ sung các cột định danh.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS results (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      student_name TEXT,
      student_class TEXT,
      lop TEXT,
      don_vi TEXT,
      exam_name TEXT,
      exam_id TEXT,
      score REAL,
      time_taken INTEGER,
      correct_count INTEGER,
      total_questions INTEGER,
      details TEXT,
      loai_thi_sinh TEXT,
      cheat_warning_count INTEGER DEFAULT 0,
      ai_grading_summary TEXT,
      created_at TEXT
    )
  `).run();
  for (const alter of [
    'ALTER TABLE results ADD COLUMN user_id TEXT',
    'ALTER TABLE results ADD COLUMN lop TEXT',
    'ALTER TABLE results ADD COLUMN don_vi TEXT',
    'ALTER TABLE results ADD COLUMN cheat_warning_count INTEGER DEFAULT 0',
    'ALTER TABLE results ADD COLUMN ai_grading_summary TEXT'
  ]) {
    try { await db.prepare(alter).run(); } catch {}
  }
}

async function auth(context: any) {
  const db = getDatabase(context);
  const bearer = context.request.headers.get('Authorization') || '';
  if (!bearer.startsWith('Bearer ')) return { error: reply({ error: 'Vui lòng đăng nhập.' }, 401) };
  const secret = await getDynamicSecret(db, context.env.JWT_SECRET);
  const user: any = await verifyAuthSession(bearer.slice(7), secret, db);
  if (!user) return { error: reply({ error: 'Phiên đăng nhập không hợp lệ.' }, 401) };
  const admin = checkIsAdmin(user);
  const teacher = checkIsTeacherOrAdmin(user);
  if (!admin && !teacher) return { error: reply({ error: 'Chức năng quét thẻ chỉ dành cho Giáo viên/Admin.' }, 403) };
  return { db, user, admin, teacher };
}

async function resolveUserSchool(db: any, user: any) {
  const ids = actorIds(user);
  if (!ids.length) return '';
  const placeholders = ids.map(() => '?').join(',');
  const row: any = await db.prepare(`SELECT donvi FROM users WHERE id IN (${placeholders}) LIMIT 1`).bind(...ids).first();
  return norm(row?.donvi || user?.donvi);
}

async function assertClassScope(db: any, user: any, admin: boolean, className: string, donvi: string) {
  const cls = norm(className);
  const school = norm(donvi);
  if (!cls) throw Object.assign(new Error('Chưa chọn lớp.'), { status: 400, code: 'CLASS_REQUIRED' });
  if (admin) return;
  const ids = actorIds(user);
  if (!ids.length) throw Object.assign(new Error('Không xác định được tài khoản giáo viên.'), { status: 403 });
  const placeholders = ids.map(() => '?').join(',');
  const params: any[] = [...ids, cls];
  let sql = `SELECT id FROM teacher_classes WHERE teacher_id IN (${placeholders}) AND LOWER(TRIM(class_name)) = LOWER(TRIM(?))`;
  if (school) {
    sql += ' AND LOWER(TRIM(donvi)) = LOWER(TRIM(?))';
    params.push(school);
  }
  sql += ' LIMIT 1';
  const row = await db.prepare(sql).bind(...params).first();
  if (!row) throw Object.assign(new Error('Bạn chỉ được quét thẻ cho lớp đã được phân công.'), { status: 403, code: 'CLASS_SCOPE_DENIED' });
}

async function examForActor(db: any, user: any, admin: boolean, examId: string) {
  const exam: any = await db.prepare('SELECT * FROM exam_configs WHERE id = ? LIMIT 1').bind(examId).first();
  if (!exam) throw Object.assign(new Error('Không tìm thấy đề thi.'), { status: 404, code: 'EXAM_NOT_FOUND' });
  if (!admin) {
    const ids = actorIds(user);
    if (!ids.includes(norm(exam.creator_id))) {
      throw Object.assign(new Error('Giáo viên chỉ được dùng chức năng quét thẻ với đề thi do mình tạo.'), { status: 403, code: 'EXAM_SCOPE_DENIED' });
    }
  }
  return exam;
}

async function classStudents(db: any, className: string, donvi: string) {
  const params: any[] = [className];
  let where = `LOWER(TRIM(u.lop)) = LOWER(TRIM(?)) AND LOWER(TRIM(COALESCE(u.target_audience,''))) = LOWER(TRIM('Học sinh'))`;
  if (donvi) {
    where += ' AND LOWER(TRIM(COALESCE(u.donvi,\'\'))) = LOWER(TRIM(?))';
    params.push(donvi);
  }
  const result: any = await db.prepare(`
    SELECT
      u.id, u.full_name, u.lop, u.donvi, u.is_active,
      COALESCE(
        (SELECT a.username FROM accounts a WHERE a.user_id = u.id OR a.id = u.id ORDER BY CASE WHEN a.user_id = u.id THEN 0 ELSE 1 END, a.created_at DESC LIMIT 1),
        u.id
      ) AS student_code,
      c.card_token, c.active AS card_active
    FROM users u
    LEFT JOIN qr_answer_cards c ON c.user_id = u.id
    WHERE ${where}
    ORDER BY u.full_name ASC, u.id ASC
  `).bind(...params).all();
  return (result.results || []).filter((row: any) => row.is_active === undefined || row.is_active === null || Number(row.is_active) !== 0);
}

async function bootstrap(db: any, user: any, admin: boolean) {
  const ids = actorIds(user);
  let classes: any[] = [];
  if (admin) {
    const rows: any = await db.prepare(`
      SELECT DISTINCT TRIM(lop) AS class_name, TRIM(COALESCE(donvi,'')) AS donvi
      FROM users
      WHERE TRIM(COALESCE(lop,'')) != '' AND LOWER(TRIM(COALESCE(target_audience,''))) = LOWER(TRIM('Học sinh'))
      ORDER BY donvi ASC, class_name ASC
    `).all();
    classes = rows.results || [];
  } else if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const rows: any = await db.prepare(`
      SELECT DISTINCT class_name, donvi
      FROM teacher_classes
      WHERE teacher_id IN (${placeholders})
      ORDER BY donvi ASC, class_name ASC
    `).bind(...ids).all();
    classes = rows.results || [];
  }
  let exams: any[] = [];
  if (admin) {
    const rows: any = await db.prepare(`
      SELECT id,name,creator_id,count_41,count_tf4,count_sq,count_tl,target_lop,target_donvi,updated_at,created_at
      FROM exam_configs
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    `).all();
    exams = rows.results || [];
  } else if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const rows: any = await db.prepare(`
      SELECT id,name,creator_id,count_41,count_tf4,count_sq,count_tl,target_lop,target_donvi,updated_at,created_at
      FROM exam_configs
      WHERE creator_id IN (${placeholders})
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    `).bind(...ids).all();
    exams = rows.results || [];
  }
  return { classes, exams, default_donvi: await resolveUserSchool(db, user) };
}

function selectQuestionsForExam(rows: any[], exam: any) {
  const count41 = Math.max(0, Number(exam.count_41 || 0));
  const unsupported = Math.max(0, Number(exam.count_tf4 || 0)) + Math.max(0, Number(exam.count_sq || 0)) + Math.max(0, Number(exam.count_tl || 0));
  if (unsupported > 0) {
    throw Object.assign(new Error('Quét thẻ A/B/C/D chỉ hỗ trợ đề gồm câu trắc nghiệm 4 lựa chọn (4-1). Hãy chọn một đề chỉ có câu 4 lựa chọn.'), { status: 400, code: 'QR_CARD_MC_ONLY' });
  }
  if (count41 < 1) throw Object.assign(new Error('Đề thi chưa có câu trắc nghiệm 4 lựa chọn để quét thẻ.'), { status: 400, code: 'NO_MC_QUESTIONS' });

  const pool = rows
    .filter(q => normalizeQuestionType(q.type) === '4-1')
    .map(q => ({ ...q, type: '4-1', level: normalizeLevel(q.level), options: safeOptions(q.options) }));
  const counts = asObject(exam.counts_detail);
  const wants = {
    NB: Math.max(0, Number(counts.count41NB || 0)),
    TH: Math.max(0, Number(counts.count41TH || 0)),
    VD: Math.max(0, Number(counts.count41VD || 0))
  };
  const picked: any[] = [];
  const used = new Set<string>();
  const levelTotal = wants.NB + wants.TH + wants.VD;
  if (levelTotal > 0) {
    for (const level of ['NB', 'TH', 'VD'] as const) {
      const candidates = shuffle(pool.filter(q => q.level === level));
      if (candidates.length < wants[level]) {
        throw Object.assign(new Error(`Không đủ câu ${level} để tạo phiên quét thẻ theo cấu hình đề.`), { status: 400, code: 'QUESTION_POOL_SHORTAGE' });
      }
      for (const q of candidates.slice(0, wants[level])) { picked.push(q); used.add(String(q.id)); }
    }
  }
  const remainingNeeded = count41 - picked.length;
  if (remainingNeeded > 0) {
    const rest = shuffle(pool.filter(q => !used.has(String(q.id))));
    if (rest.length < remainingNeeded) {
      throw Object.assign(new Error('Ngân hàng câu hỏi không đủ số lượng theo cấu hình đề thi.'), { status: 400, code: 'QUESTION_POOL_SHORTAGE' });
    }
    picked.push(...rest.slice(0, remainingNeeded));
  }
  if (picked.length !== count41) {
    throw Object.assign(new Error('Không thể tạo đúng số câu hỏi của đề thi cho phiên quét thẻ.'), { status: 400, code: 'QUESTION_COUNT_MISMATCH' });
  }
  return shuffle(picked);
}

function publicQuestion(q: any, index: number) {
  return {
    id: q.id,
    order: index + 1,
    type: '4-1',
    level: q.level,
    lesson: q.lesson,
    content: q.content,
    options: safeOptions(q.options),
    image: q.image || null
  };
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { status: 204, headers });

export const onRequestGet: PagesFunction<Env> = async (context: any) => {
  try {
    const a: any = await auth(context);
    if (a.error) return a.error;
    const { db, user, admin } = a;
    await ensureTables(db);
    const url = new URL(context.request.url);
    const action = url.searchParams.get('action') || 'bootstrap';

    if (action === 'bootstrap') {
      return reply({ data: await bootstrap(db, user, admin), error: null });
    }
    if (action === 'cards') {
      const className = norm(url.searchParams.get('class'));
      const donvi = norm(url.searchParams.get('donvi'));
      await assertClassScope(db, user, admin, className, donvi);
      return reply({ data: await classStudents(db, className, donvi), error: null });
    }
    if (action === 'active-sessions') {
      const ids = actorIds(user);
      let rows: any;
      if (admin) {
        rows = await db.prepare(`
          SELECT id,join_code,exam_id,exam_name,class_name,donvi,status,current_question_index,current_question_id,collection_state,state_revision,response_revision,updated_at,created_at
          FROM qr_answer_sessions
          WHERE status='open'
          ORDER BY COALESCE(updated_at,created_at) DESC
          LIMIT 20
        `).all();
      } else if (ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        rows = await db.prepare(`
          SELECT id,join_code,exam_id,exam_name,class_name,donvi,status,current_question_index,current_question_id,collection_state,state_revision,response_revision,updated_at,created_at
          FROM qr_answer_sessions
          WHERE status='open' AND creator_id IN (${placeholders})
          ORDER BY COALESCE(updated_at,created_at) DESC
          LIMIT 20
        `).bind(...ids).all();
      } else rows = { results: [] };
      return reply({ data: rows.results || [], error: null });
    }
    if (action === 'session-state') {
      const id = norm(url.searchParams.get('id'));
      const session: any = await ownedSession(db, user, admin, id);
      const questions = asArray(session.questions_json);
      const index = Math.max(0, Math.min(questions.length - 1, Number(session.current_question_index || 0)));
      const current = questions[index] || null;
      const currentQuestionId = norm(session.current_question_id || current?.id);
      const stateRevision = Number(session.state_revision || 1);
      const responseRevision = Number(session.response_revision || 0);
      const since = norm(url.searchParams.get('since'));
      const version = stateRevision + ':' + responseRevision;
      if (since && since === version) {
        return reply({ data: { unchanged: true, version, status: session.status }, error: null });
      }
      const responseRows: any = currentQuestionId ? await db.prepare(`
        SELECT r.user_id,r.answer,r.stable_hits,r.updated_at,u.full_name,
          COALESCE((SELECT a.username FROM accounts a WHERE a.user_id=u.id OR a.id=u.id ORDER BY CASE WHEN a.user_id=u.id THEN 0 ELSE 1 END LIMIT 1),u.id) AS student_code
        FROM qr_answer_responses r
        JOIN users u ON u.id=r.user_id
        WHERE r.session_id=? AND r.question_id=?
        ORDER BY u.full_name
      `).bind(id,currentQuestionId).all() : { results: [] };
      const responses = responseRows.results || [];
      const counts = { A: 0, B: 0, C: 0, D: 0 };
      for (const row of responses) {
        const a = norm(row.answer).toUpperCase();
        if (a in counts) (counts as any)[a]++;
      }
      const students = await classStudents(db, session.class_name, session.donvi || '');
      const answered = new Set(responses.map((row: any) => norm(row.user_id)));
      const missing = students.filter((st: any) => !answered.has(norm(st.id))).map((st: any) => ({
        id: st.id, full_name: st.full_name, student_code: st.student_code
      }));
      return reply({ data: {
        unchanged: false,
        version,
        id: session.id,
        join_code: session.join_code,
        exam_id: session.exam_id,
        exam_name: session.exam_name,
        class_name: session.class_name,
        donvi: session.donvi,
        status: session.status,
        current_question_index: index,
        current_question_id: currentQuestionId,
        collection_state: session.collection_state || 'collecting',
        state_revision: stateRevision,
        response_revision: responseRevision,
        question_count: questions.length,
        current_question: current ? publicQuestion(current,index) : null,
        responses,
        counts,
        answered_count: responses.length,
        student_count: students.length,
        missing
      }, error: null });
    }
    if (action === 'session') {
      const id = norm(url.searchParams.get('id'));
      const session: any = await db.prepare('SELECT * FROM qr_answer_sessions WHERE id = ? LIMIT 1').bind(id).first();
      if (!session) return reply({ error: 'Không tìm thấy phiên quét.' }, 404);
      if (!admin && !actorIds(user).includes(norm(session.creator_id))) return reply({ error: 'Không có quyền xem phiên quét này.' }, 403);
      const responseRows: any = await db.prepare(`
        SELECT r.*,u.full_name,u.lop,u.donvi,
          COALESCE((SELECT a.username FROM accounts a WHERE a.user_id=u.id OR a.id=u.id ORDER BY CASE WHEN a.user_id=u.id THEN 0 ELSE 1 END LIMIT 1),u.id) AS student_code
        FROM qr_answer_responses r
        JOIN users u ON u.id=r.user_id
        WHERE r.session_id=?
        ORDER BY r.question_id,u.full_name
      `).bind(id).all();
      const questions = asArray(session.questions_json).map((q, i) => publicQuestion(q, i));
      const students = await classStudents(db, session.class_name, session.donvi || '');
      return reply({ data: {
        ...session,
        questions,
        responses: responseRows.results || [],
        students: students.map((st: any) => ({
          id: st.id, full_name: st.full_name, student_code: st.student_code, lop: st.lop, donvi: st.donvi,
          card_token: st.card_token, qr_payload: st.card_token ? `KTTTQR1|${st.card_token}|ABCD` : ''
        }))
      }, error: null });
    }
    return reply({ error: 'Thao tác không hợp lệ.' }, 400);
  } catch (err: any) {
    console.error('GET /api/qr-cards failed', err);
    return reply({ error: err?.message || 'Không thể tải dữ liệu quét thẻ.', code: err?.code }, err?.status || 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async (context: any) => {
  let finalizeLockSessionId = '';
  let finalizeDb: any = null;
  try {
    const a: any = await auth(context);
    if (a.error) return a.error;
    const { db, user, admin } = a;
    await ensureTables(db);
    const body: any = await context.request.json().catch(() => ({}));
    const action = norm(body.action);

    if (action === 'ensure-cards') {
      const className = norm(body.className);
      const donvi = norm(body.donvi);
      await assertClassScope(db, user, admin, className, donvi);
      const students = await classStudents(db, className, donvi);
      const creatorId = actorIds(user)[0] || norm(user.id);
      const now = new Date().toISOString();
      for (const student of students) {
        if (student.card_token && Number(student.card_active ?? 1) !== 0) continue;
        const token = randomToken();
        await db.prepare(`
          INSERT INTO qr_answer_cards(card_token,user_id,student_code,created_by,active,created_at,updated_at)
          VALUES(?,?,?,?,1,?,?)
          ON CONFLICT(user_id) DO UPDATE SET
            card_token=excluded.card_token,student_code=excluded.student_code,created_by=excluded.created_by,active=1,updated_at=excluded.updated_at
        `).bind(token, student.id, norm(student.student_code || student.id), creatorId, now, now).run();
      }
      return reply({ data: await classStudents(db, className, donvi), error: null });
    }

    if (action === 'start-session') {
      const className = norm(body.className);
      let donvi = norm(body.donvi);
      const examId = norm(body.examId);
      if (!donvi) donvi = await resolveUserSchool(db, user);
      await assertClassScope(db, user, admin, className, donvi);
      const exam = await examForActor(db, user, admin, examId);
      const selectedLessons = asArray(exam.selected_lessons).map(norm).filter(Boolean);
      if (!selectedLessons.length) {
        throw Object.assign(new Error('Đề thi chưa chọn Bài học/Chuyên đề. Hãy cấu hình ít nhất một bài trước khi tạo phiên quét.'), { status: 400, code: 'EXAM_LESSONS_REQUIRED' });
      }
      const creatorId = norm(exam.creator_id);
      const qRows: any = await db.prepare(`
        SELECT id,type,level,lesson,content,options,answer,image,creator_id
        FROM questions
        WHERE creator_id = ?
           OR creator_id IN (SELECT user_id FROM accounts WHERE id = ?)
           OR creator_id IN (SELECT id FROM accounts WHERE user_id = ?)
      `).bind(creatorId, creatorId, creatorId).all();
      const validRows = (qRows.results || [])
        .filter((q: any) => norm(q.id) && norm(q.content) && lessonAllowed(q.lesson, selectedLessons));
      const picked = selectQuestionsForExam(validRows, exam);
      const students = await classStudents(db, className, donvi);
      if (!students.length) throw Object.assign(new Error('Lớp chưa có hồ sơ học sinh hoạt động.'), { status: 400, code: 'EMPTY_CLASS' });
      const missingCards = students.filter((s: any) => !s.card_token || Number(s.card_active ?? 1) === 0);
      if (missingCards.length) throw Object.assign(new Error(`Còn ${missingCards.length} học sinh chưa có thẻ QR. Hãy tạo/in thẻ trước khi bắt đầu quét.`), { status: 400, code: 'CARDS_REQUIRED' });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const ownerId = actorIds(user)[0] || norm(user.id);
      const joinCode = await makeUniqueJoinCode(db);
      const firstQuestionId = norm(picked[0]?.id);
      await db.prepare(`
        INSERT INTO qr_answer_sessions(
          id,creator_id,exam_id,exam_name,class_name,donvi,questions_json,question_count,points_41,status,
          join_code,current_question_index,current_question_id,collection_state,state_revision,response_revision,updated_at,created_at
        )
        VALUES(?,?,?,?,?,?,?,?,?,'open',?,0,?,'collecting',1,0,?,?)
      `).bind(id, ownerId, examId, norm(exam.name), className, donvi, JSON.stringify(picked), picked.length, Number(exam.points_41 || 1) || 1, joinCode, firstQuestionId, now, now).run();
      return reply({
        data: {
          id, join_code: joinCode, exam_id: examId, exam_name: norm(exam.name), class_name: className, donvi,
          current_question_index: 0, current_question_id: firstQuestionId, collection_state: 'collecting', state_revision: 1, response_revision: 0,
          questions: picked.map(publicQuestion),
          students: students.map((s: any) => ({
            id: s.id, full_name: s.full_name, student_code: s.student_code, lop: s.lop, donvi: s.donvi,
            card_token: s.card_token, qr_payload: `KTTTQR1|${s.card_token}|ABCD`
          }))
        },
        error: null
      });
    }

    if (action === 'set-current-question') {
      const sessionId = norm(body.sessionId);
      const session: any = await ownedSession(db, user, admin, sessionId);
      if (session.status !== 'open') return reply({ error: 'Phiên quét không còn ở trạng thái mở.' }, 409);
      const questions = asArray(session.questions_json);
      const index = Number(body.index);
      if (!Number.isInteger(index) || index < 0 || index >= questions.length) return reply({ error: 'Số thứ tự câu hỏi không hợp lệ.' }, 400);
      const expectedRevision = Number(body.expectedRevision || 0);
      const qid = norm(questions[index]?.id);
      const now = new Date().toISOString();
      let result: any;
      if (expectedRevision > 0) {
        result = await db.prepare(`
          UPDATE qr_answer_sessions
          SET current_question_index=?,current_question_id=?,collection_state='collecting',state_revision=state_revision+1,updated_at=?
          WHERE id=? AND status='open' AND state_revision=?
        `).bind(index,qid,now,sessionId,expectedRevision).run();
      } else {
        result = await db.prepare(`
          UPDATE qr_answer_sessions
          SET current_question_index=?,current_question_id=?,collection_state='collecting',state_revision=state_revision+1,updated_at=?
          WHERE id=? AND status='open'
        `).bind(index,qid,now,sessionId).run();
      }
      if (Number(result?.meta?.changes || 0) !== 1) return reply({ error: 'Phiên vừa được thay đổi ở thiết bị khác. Hãy đồng bộ lại.', code: 'SESSION_REVISION_CONFLICT' }, 409);
      return reply({ data: { current_question_index: index, current_question_id: qid, collection_state: 'collecting' }, error: null });
    }

    if (action === 'set-collection-state') {
      const sessionId = norm(body.sessionId);
      const nextState = norm(body.collectionState);
      if (!['collecting','locked'].includes(nextState)) return reply({ error: 'Trạng thái thu đáp án không hợp lệ.' }, 400);
      const session: any = await ownedSession(db, user, admin, sessionId);
      if (session.status !== 'open') return reply({ error: 'Phiên quét không còn ở trạng thái mở.' }, 409);
      const expectedRevision = Number(body.expectedRevision || 0);
      const now = new Date().toISOString();
      let result: any;
      if (expectedRevision > 0) {
        result = await db.prepare(`
          UPDATE qr_answer_sessions
          SET collection_state=?,state_revision=state_revision+1,updated_at=?
          WHERE id=? AND status='open' AND state_revision=?
        `).bind(nextState,now,sessionId,expectedRevision).run();
      } else {
        result = await db.prepare(`
          UPDATE qr_answer_sessions
          SET collection_state=?,state_revision=state_revision+1,updated_at=?
          WHERE id=? AND status='open'
        `).bind(nextState,now,sessionId).run();
      }
      if (Number(result?.meta?.changes || 0) !== 1) return reply({ error: 'Phiên vừa được thay đổi ở thiết bị khác. Hãy đồng bộ lại.', code: 'SESSION_REVISION_CONFLICT' }, 409);
      return reply({ data: { collection_state: nextState }, error: null });
    }

    if (action === 'record-batch') {
      const sessionId = norm(body.sessionId);
      const records = Array.isArray(body.records) ? body.records.slice(0, 40) : [];
      if (!sessionId || !records.length) return reply({ error: 'Không có đáp án ổn định để ghi nhận.' }, 400);
      const session: any = await db.prepare('SELECT * FROM qr_answer_sessions WHERE id = ? LIMIT 1').bind(sessionId).first();
      if (!session) return reply({ error: 'Không tìm thấy phiên quét.' }, 404);
      if (!admin && !actorIds(user).includes(norm(session.creator_id))) return reply({ error: 'Không có quyền cập nhật phiên quét này.' }, 403);
      if (session.status !== 'open') return reply({ error: 'Phiên quét đã kết thúc.' }, 409);
      if (norm(session.collection_state || 'collecting') !== 'collecting') {
        return reply({ error: 'Câu hỏi hiện đã khóa nhận đáp án.', code: 'QUESTION_LOCKED', current_question_id: session.current_question_id }, 409);
      }
      const currentQuestionId = norm(session.current_question_id);
      if (!currentQuestionId) return reply({ error: 'Phiên chưa xác định câu hỏi hiện tại.', code: 'CURRENT_QUESTION_MISSING' }, 409);
      const accepted: any[] = [];
      const now = new Date().toISOString();
      for (const raw of records) {
        const cardToken = norm(raw.cardToken);
        const questionId = norm(raw.questionId);
        const answer = norm(raw.answer).toUpperCase();
        const stableHits = Math.max(3, Math.min(20, Number(raw.stableHits) || 3));
        if (!cardToken || questionId !== currentQuestionId || !['A','B','C','D'].includes(answer)) continue;
        const student: any = await db.prepare(`
          SELECT u.id,u.full_name,u.lop,u.donvi,c.card_token
          FROM qr_answer_cards c JOIN users u ON u.id=c.user_id
          WHERE c.card_token=? AND c.active=1
            AND LOWER(TRIM(COALESCE(u.lop,'')))=LOWER(TRIM(?))
            AND LOWER(TRIM(COALESCE(u.donvi,'')))=LOWER(TRIM(?))
          LIMIT 1
        `).bind(cardToken, session.class_name, session.donvi || '').first();
        if (!student) continue;
        await db.prepare(`
          INSERT INTO qr_answer_responses(session_id,question_id,user_id,card_token,answer,stable_hits,updated_at)
          VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(session_id,question_id,user_id) DO UPDATE SET
            card_token=excluded.card_token,answer=excluded.answer,stable_hits=excluded.stable_hits,updated_at=excluded.updated_at
        `).bind(sessionId, questionId, student.id, cardToken, answer, stableHits, now).run();
        accepted.push({ user_id: student.id, full_name: student.full_name, answer, question_id: questionId });
      }
      if (accepted.length) {
        await db.prepare('UPDATE qr_answer_sessions SET response_revision=response_revision+1,updated_at=? WHERE id=? AND status=\'open\'')
          .bind(now,sessionId).run();
      }
      return reply({ data: { accepted, current_question_id: currentQuestionId }, error: null });
    }

    if (action === 'clear-answer') {
      const sessionId = norm(body.sessionId);
      const questionId = norm(body.questionId);
      const userId = norm(body.userId);
      const session: any = await db.prepare('SELECT * FROM qr_answer_sessions WHERE id = ? LIMIT 1').bind(sessionId).first();
      if (!session) return reply({ error: 'Không tìm thấy phiên quét.' }, 404);
      if (!admin && !actorIds(user).includes(norm(session.creator_id))) return reply({ error: 'Không có quyền cập nhật phiên quét này.' }, 403);
      if (session.status !== 'open') return reply({ error: 'Phiên quét đã kết thúc.' }, 409);
      if (norm(session.collection_state || 'collecting') !== 'collecting') return reply({ error: 'Hãy mở khóa câu hỏi trước khi sửa đáp án.', code: 'QUESTION_LOCKED' }, 409);
      if (questionId !== norm(session.current_question_id)) return reply({ error: 'Chỉ được sửa đáp án của câu đang được phát.', code: 'STALE_QUESTION' }, 409);
      const student: any = await db.prepare(`
        SELECT id FROM users
        WHERE id=? AND LOWER(TRIM(COALESCE(lop,'')))=LOWER(TRIM(?))
          AND LOWER(TRIM(COALESCE(donvi,'')))=LOWER(TRIM(?))
        LIMIT 1
      `).bind(userId, session.class_name, session.donvi || '').first();
      if (!student) return reply({ error: 'Học sinh không thuộc lớp của phiên quét.' }, 400);
      await db.prepare('DELETE FROM qr_answer_responses WHERE session_id=? AND question_id=? AND user_id=?').bind(sessionId, questionId, userId).run();
      await db.prepare('UPDATE qr_answer_sessions SET response_revision=response_revision+1,updated_at=? WHERE id=? AND status=\'open\'')
        .bind(new Date().toISOString(),sessionId).run();
      return reply({ data: { cleared: true }, error: null });
    }

    if (action === 'finalize') {
      if (body.confirmFinalize !== true) return reply({ error: 'Cần xác nhận trước khi chốt kết quả quét thẻ.' }, 400);
      const sessionId = norm(body.sessionId);
      const session: any = await db.prepare('SELECT * FROM qr_answer_sessions WHERE id = ? LIMIT 1').bind(sessionId).first();
      if (!session) return reply({ error: 'Không tìm thấy phiên quét.' }, 404);
      if (!admin && !actorIds(user).includes(norm(session.creator_id))) return reply({ error: 'Không có quyền kết thúc phiên quét này.' }, 403);
      if (session.status === 'finalized') {
        const existingRows: any = await db.prepare(`
          SELECT l.result_id,r.user_id,r.student_name,r.score,r.correct_count
          FROM qr_answer_result_links l
          LEFT JOIN results r ON r.id=l.result_id
          WHERE l.session_id=?
          ORDER BY r.student_name ASC
        `).bind(sessionId).all();
        const existing = (existingRows.results || []).filter((row: any) => row.result_id);
        return reply({ data: { created: existing, skipped: [], total_results: existing.length, already_finalized: true }, error: null });
      }
      if (session.status !== 'open') return reply({ error: 'Phiên quét đang được chốt ở một yêu cầu khác.' }, 409);
      const lock = await db.prepare("UPDATE qr_answer_sessions SET status='finalizing' WHERE id=? AND status='open'").bind(sessionId).run();
      if (Number(lock?.meta?.changes || 0) !== 1) return reply({ error: 'Phiên quét đang được chốt ở yêu cầu khác.' }, 409);
      finalizeLockSessionId = sessionId;
      finalizeDb = db;

      const questions = asArray(session.questions_json);
      if (!questions.length) {
        await db.prepare("UPDATE qr_answer_sessions SET status='open' WHERE id=? AND status='finalizing'").bind(sessionId).run();
        return reply({ error: 'Phiên quét không có dữ liệu câu hỏi gốc; không tạo kết quả 0 điểm.' }, 409);
      }
      const students = await classStudents(db, session.class_name, session.donvi || '');
      const responsesResult: any = await db.prepare('SELECT * FROM qr_answer_responses WHERE session_id=?').bind(sessionId).all();
      const responseRows = responsesResult.results || [];
      const byUser = new Map<string, Map<string, string>>();
      for (const row of responseRows) {
        const uid = norm(row.user_id), qid = norm(row.question_id);
        if (!byUser.has(uid)) byUser.set(uid, new Map());
        byUser.get(uid)!.set(qid, norm(row.answer).toUpperCase());
      }
      if (!byUser.size) {
        await db.prepare("UPDATE qr_answer_sessions SET status='open' WHERE id=? AND status='finalizing'").bind(sessionId).run();
        return reply({ error: 'Chưa có học sinh nào được quét ổn định; không tạo kết quả.' }, 409);
      }

      const created: any[] = [];
      const skipped: any[] = [];
      const started = new Date(session.created_at).getTime();
      const now = new Date();
      const timeTaken = Number.isFinite(started) ? Math.max(0, Math.round((now.getTime() - started) / 1000)) : 0;
      const points = Number(session.points_41 || 1) || 1;

      for (const student of students) {
        const answers = byUser.get(norm(student.id));
        if (!answers || !answers.size) {
          skipped.push({ user_id: student.id, full_name: student.full_name, reason: 'Chưa có đáp án quét' });
          continue;
        }
        let score = 0, correctCount = 0;
        const details = questions.map((q: any) => {
          const userAnswer = norm(answers.get(norm(q.id))).toUpperCase();
          const correctAnswer = norm(q.answer).toUpperCase();
          const isCorrect = !!userAnswer && userAnswer === correctAnswer;
          const qScore = isCorrect ? points : 0;
          if (isCorrect) { score += qScore; correctCount++; }
          return {
            question: { ...q, options: safeOptions(q.options), type: '4-1' },
            userAnswer,
            isCorrect,
            correctAnswer,
            needsGrading: false,
            score: qScore,
            aiFeedback: '',
            captureMethod: 'qr_card'
          };
        });
        let link: any = await db.prepare(
          'SELECT result_id FROM qr_answer_result_links WHERE session_id=? AND user_id=? LIMIT 1'
        ).bind(sessionId, student.id).first();
        let resultId = norm(link?.result_id);
        if (!resultId) {
          resultId = crypto.randomUUID();
          await db.prepare(`
            INSERT INTO qr_answer_result_links(session_id,user_id,result_id,created_at)
            VALUES(?,?,?,?)
            ON CONFLICT(session_id,user_id) DO NOTHING
          `).bind(sessionId, student.id, resultId, now.toISOString()).run();
          link = await db.prepare(
            'SELECT result_id FROM qr_answer_result_links WHERE session_id=? AND user_id=? LIMIT 1'
          ).bind(sessionId, student.id).first();
          resultId = norm(link?.result_id || resultId);
        }

        const existingResult: any = await db.prepare('SELECT id FROM results WHERE id=? LIMIT 1').bind(resultId).first();
        if (!existingResult) {
          await db.prepare(`
            INSERT INTO results
            (id,user_id,student_name,student_class,lop,don_vi,exam_name,exam_id,score,time_taken,correct_count,total_questions,details,loai_thi_sinh,cheat_warning_count,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)
          `).bind(
            resultId, student.id, norm(student.full_name), norm(student.donvi), norm(student.lop), norm(student.donvi),
            norm(session.exam_name), norm(session.exam_id), Number(score.toFixed(2)), timeTaken, correctCount, questions.length,
            JSON.stringify(details), 'Quét thẻ QR', now.toISOString()
          ).run();
        }
        created.push({ result_id: resultId, user_id: student.id, full_name: student.full_name, score: Number(score.toFixed(2)), correct_count: correctCount });
      }
      if (!created.length) {
        await db.prepare("UPDATE qr_answer_sessions SET status='open' WHERE id=? AND status='finalizing'").bind(sessionId).run();
        return reply({ error: 'Không có bài quét hợp lệ để lưu kết quả.' }, 409);
      }
      await db.prepare("UPDATE qr_answer_sessions SET status='finalized',finalized_at=? WHERE id=? AND status='finalizing'").bind(now.toISOString(), sessionId).run();
      finalizeLockSessionId = '';
      finalizeDb = null;
      return reply({ data: { created, skipped, total_results: created.length }, error: null });
    }

    return reply({ error: 'Thao tác không hợp lệ.' }, 400);
  } catch (err: any) {
    if (finalizeLockSessionId && finalizeDb) {
      try {
        await finalizeDb.prepare("UPDATE qr_answer_sessions SET status='open' WHERE id=? AND status='finalizing'").bind(finalizeLockSessionId).run();
      } catch {}
    }
    console.error('POST /api/qr-cards failed', err);
    return reply({ error: err?.message || 'Không thể xử lý chức năng quét thẻ.', code: err?.code }, err?.status || 500);
  }
};
