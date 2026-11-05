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
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0'
};

const norm = (value: any) => String(value || '').trim().toLowerCase();
const normClass = (value: any) => norm(value).replace(/\s+/g, '');

function parseAccessControl(value: any) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}

async function attachAssignedClasses(db: any, users: any[]) {
  if (!users.length) return users;
  try {
    const { results } = await db.prepare(
      'SELECT id, teacher_id, teacher_name, class_name, donvi, role, subject, created_at FROM teacher_classes ORDER BY class_name ASC'
    ).all();
    const map: Record<string, any[]> = {};
    for (const row of (results || [])) {
      const id = String((row as any).teacher_id || '');
      if (!map[id]) map[id] = [];
      map[id].push(row);
    }
    for (const u of users) u.assigned_classes = map[String(u.id)] || [];
  } catch {
    for (const u of users) u.assigned_classes = [];
  }
  return users;
}

async function getSelfProfile(db: any, user: any) {
  return await db.prepare(
    `SELECT users.*,
       COALESCE((SELECT a.id FROM accounts a WHERE a.user_id = users.id OR a.id = users.id ORDER BY (CASE WHEN a.user_id = users.id THEN 0 ELSE 1 END), a.created_at DESC LIMIT 1), NULL) AS account_id,
       COALESCE((SELECT a.username FROM accounts a WHERE a.user_id = users.id OR a.id = users.id ORDER BY (CASE WHEN a.user_id = users.id THEN 0 ELSE 1 END), a.created_at DESC LIMIT 1), NULL) AS account_username,
       COALESCE((SELECT a.role FROM accounts a WHERE a.user_id = users.id OR a.id = users.id ORDER BY (CASE WHEN a.user_id = users.id THEN 0 ELSE 1 END), a.created_at DESC LIMIT 1), NULL) AS account_role,
       COALESCE((SELECT a.is_active FROM accounts a WHERE a.user_id = users.id OR a.id = users.id ORDER BY (CASE WHEN a.user_id = users.id THEN 0 ELSE 1 END), a.created_at DESC LIMIT 1), NULL) AS account_is_active
     FROM users
     WHERE users.id = ? OR users.id = ?
     ORDER BY CASE WHEN users.id = ? THEN 0 ELSE 1 END
     LIMIT 1`
  ).bind(user.user_id || user.id, user.id, user.user_id || user.id).first();
}

async function getSelfAccount(db: any, user: any) {
  return await db.prepare(
    `SELECT a.id, a.user_id, a.username, a.role, a.is_active, a.expiry_date, a.created_at,
            u.full_name, u.phone_number, u.donvi, u.lop, u.target_audience, u.occupation
       FROM accounts a
       LEFT JOIN users u ON u.id = COALESCE(a.user_id, a.id)
      WHERE a.id = ? OR a.user_id = ?
      ORDER BY CASE WHEN a.id = ? THEN 0 ELSE 1 END, a.created_at DESC
      LIMIT 1`
  ).bind(user.id, user.user_id || user.id, user.id).first();
}

async function adminPayload(db: any) {
  const [uRes, aRes] = await Promise.all([
    db.prepare(
      `SELECT users.*,
         COALESCE((SELECT a.id FROM accounts a WHERE a.user_id = users.id OR a.id = users.id ORDER BY (CASE WHEN a.user_id = users.id THEN 0 ELSE 1 END), a.created_at DESC LIMIT 1), NULL) AS account_id,
         COALESCE((SELECT a.username FROM accounts a WHERE a.user_id = users.id OR a.id = users.id ORDER BY (CASE WHEN a.user_id = users.id THEN 0 ELSE 1 END), a.created_at DESC LIMIT 1), NULL) AS account_username,
         COALESCE((SELECT a.role FROM accounts a WHERE a.user_id = users.id OR a.id = users.id ORDER BY (CASE WHEN a.user_id = users.id THEN 0 ELSE 1 END), a.created_at DESC LIMIT 1), NULL) AS account_role,
         COALESCE((SELECT a.is_active FROM accounts a WHERE a.user_id = users.id OR a.id = users.id ORDER BY (CASE WHEN a.user_id = users.id THEN 0 ELSE 1 END), a.created_at DESC LIMIT 1), NULL) AS account_is_active
       FROM users
       ORDER BY users.created_at DESC`
    ).all(),
    db.prepare(
      `SELECT a.id, a.user_id, a.username, a.role, a.is_active, a.expiry_date, a.created_at,
              u.full_name, u.phone_number, u.donvi, u.lop, u.target_audience, u.occupation
         FROM accounts a
         LEFT JOIN users u ON u.id = COALESCE(a.user_id, a.id)
         ORDER BY a.created_at DESC, a.id DESC`
    ).all()
  ]);
  const users = await attachAssignedClasses(db, (uRes.results || []) as any[]);
  const accounts = (aRes.results || []) as any[];
  return {
    role_scope: 'admin',
    users,
    accounts,
    teachers: [],
    assigned_classes: [],
    scope_contract: {
      users: 'all',
      accounts: 'all',
      teachers: 'none'
    },
    counts: { users: users.length, accounts: accounts.length, teachers: 0 }
  };
}

async function teacherPayload(db: any, user: any) {
  const selfProfile: any = await getSelfProfile(db, user);
  if (!selfProfile) throw new Error('TEACHER_PROFILE_NOT_FOUND');

  const teacherIds = [...new Set([String(user.id || ''), String(user.user_id || ''), String(selfProfile.id || '')].filter(Boolean))];
  const id1 = teacherIds[0] || '';
  const id2 = teacherIds[1] || id1;
  const id3 = teacherIds[2] || id1;

  const assignmentRes: any = await db.prepare(
    `SELECT id, teacher_id, teacher_name, class_name, donvi, role, subject, created_at
       FROM teacher_classes
      WHERE teacher_id IN (?, ?, ?)
      ORDER BY class_name ASC`
  ).bind(id1, id2, id3).all();
  const assignments = (assignmentRes.results || []) as any[];

  const teacherUnit = String(selfProfile.donvi || user.donvi || '').trim();
  for (const a of assignments) {
    if (!String(a.class_name || '').trim()) throw new Error('TEACHER_ASSIGNMENT_SCOPE_INCOMPLETE');
    if (!String(a.donvi || teacherUnit || '').trim()) throw new Error('TEACHER_ASSIGNMENT_SCOPE_INCOMPLETE');
  }

  let students: any[] = [];
  let studentAccounts: any[] = [];
  if (assignments.length) {
    const sRes: any = await db.prepare(
      `SELECT u.*,
         COALESCE((SELECT a.id FROM accounts a WHERE a.user_id = u.id OR a.id = u.id ORDER BY (CASE WHEN a.user_id = u.id THEN 0 ELSE 1 END), a.created_at DESC LIMIT 1), NULL) AS account_id,
         COALESCE((SELECT a.username FROM accounts a WHERE a.user_id = u.id OR a.id = u.id ORDER BY (CASE WHEN a.user_id = u.id THEN 0 ELSE 1 END), a.created_at DESC LIMIT 1), NULL) AS account_username,
         COALESCE((SELECT a.role FROM accounts a WHERE a.user_id = u.id OR a.id = u.id ORDER BY (CASE WHEN a.user_id = u.id THEN 0 ELSE 1 END), a.created_at DESC LIMIT 1), NULL) AS account_role,
         COALESCE((SELECT a.is_active FROM accounts a WHERE a.user_id = u.id OR a.id = u.id ORDER BY (CASE WHEN a.user_id = u.id THEN 0 ELSE 1 END), a.created_at DESC LIMIT 1), NULL) AS account_is_active
       FROM users u
       WHERE LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student')
         AND EXISTS (
           SELECT 1 FROM teacher_classes tc
            WHERE tc.teacher_id IN (?, ?, ?)
              AND LOWER(TRIM(tc.class_name)) = LOWER(TRIM(COALESCE(u.lop,'')))
              AND LOWER(TRIM(COALESCE(u.donvi,''))) =
                  LOWER(TRIM(COALESCE(NULLIF(tc.donvi,''), ?)))
         )
       ORDER BY u.created_at DESC`
    ).bind(id1, id2, id3, teacherUnit).all();
    students = (sRes.results || []) as any[];

    const aRes: any = await db.prepare(
      `SELECT a.id, a.user_id, a.username, a.role, a.is_active, a.expiry_date, a.created_at,
              u.full_name, u.phone_number, u.donvi, u.lop, u.target_audience, u.occupation
         FROM accounts a
         JOIN users u ON u.id = COALESCE(a.user_id, a.id)
        WHERE LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student')
          AND EXISTS (
            SELECT 1 FROM teacher_classes tc
             WHERE tc.teacher_id IN (?, ?, ?)
               AND LOWER(TRIM(tc.class_name)) = LOWER(TRIM(COALESCE(u.lop,'')))
               AND LOWER(TRIM(COALESCE(u.donvi,''))) =
                   LOWER(TRIM(COALESCE(NULLIF(tc.donvi,''), ?)))
          )
        ORDER BY u.full_name ASC, a.username ASC`
    ).bind(id1, id2, id3, teacherUnit).all();
    studentAccounts = (aRes.results || []) as any[];
  }

  selfProfile.assigned_classes = assignments;
  const users = [selfProfile, ...students.filter(s => String(s.id) !== String(selfProfile.id))];
  // Giáo viên đã có thông tin tài khoản của chính mình từ /api/auth/login.
  // Core preload chỉ trả tài khoản Học sinh thuộc lớp được phân công, không tải dư tài khoản GV/Admin.
  const accounts = studentAccounts;

  return {
    role_scope: 'teacher',
    users,
    accounts,
    teachers: [],
    assigned_classes: assignments,
    scope_contract: {
      users: 'self_plus_assigned_students',
      accounts: 'assigned_student_accounts_only',
      teachers: 'none',
      include_teacher_account: false
    },
    counts: { users: users.length, accounts: accounts.length, teachers: 0, students: students.length }
  };
}

async function studentTeachers(db: any, profile: any) {
  const studentUnit = norm(profile?.donvi || profile?.address || '');
  const studentClass = normClass(profile?.lop || '');

  const examRes: any = await db.prepare(
    `SELECT ec.creator_id, ec.chedodethi, ec.target_lop, ec.lop, ec.access_control,
            COALESCE(up.donvi, uap.donvi, '') AS teacher_donvi,
            COALESCE(NULLIF(TRIM(up.full_name),''), NULLIF(TRIM(uap.full_name),''), 'Giáo viên') AS full_name,
            COALESCE(ap.role, a.role, 'teacher') AS creator_role
       FROM exam_configs ec
       LEFT JOIN users up ON up.id = ec.creator_id
       LEFT JOIN accounts a ON a.id = ec.creator_id
       LEFT JOIN users uap ON uap.id = a.user_id
       LEFT JOIN accounts ap ON ap.user_id = ec.creator_id
      WHERE ec.creator_id IS NOT NULL AND TRIM(ec.creator_id) <> ''`
  ).all();

  const byCreator = new Map<string, any>();
  for (const row of (examRes.results || []) as any[]) {
    const creatorId = String(row.creator_id || '').trim();
    if (!creatorId) continue;

    let allowed = true;
    const mode = String(row.chedodethi || '').trim();
    if (mode === 'Đề cho đơn vị' || mode === 'Đề thi cho đơn vị') {
      const teacherUnit = norm(row.teacher_donvi);
      const ac = parseAccessControl(row.access_control);
      const allowedUnits = ac?.allowedUnits
        ? (Array.isArray(ac.allowedUnits) ? ac.allowedUnits : [ac.allowedUnits]).map(norm).filter(Boolean)
        : [];

      let sameUnit = false;
      if (!teacherUnit && allowedUnits.length === 0) sameUnit = true;
      else if (studentUnit) {
        if (teacherUnit && (studentUnit === teacherUnit || studentUnit.includes(teacherUnit) || teacherUnit.includes(studentUnit))) {
          sameUnit = true;
        } else if (allowedUnits.some((u: string) => u && (u === studentUnit || studentUnit.includes(u) || u.includes(studentUnit)))) {
          sameUnit = true;
        }
      }
      if (!sameUnit) allowed = false;

      if (allowed) {
        const target = String(row.target_lop || row.lop || '').trim();
        if (target) {
          const classes = target.split(',').map(normClass).filter(Boolean);
          allowed = Boolean(studentClass && classes.includes(studentClass));
        }
      }
    }

    if (!allowed || byCreator.has(creatorId)) continue;
    const role = norm(row.creator_role) === 'admin' ? 'admin' : 'teacher';
    byCreator.set(creatorId, {
      id: creatorId,
      full_name: String(row.full_name || 'Giáo viên'),
      donvi: String(row.teacher_donvi || ''),
      role,
      target_audience: role === 'admin' ? 'Quản trị viên' : 'Giáo viên',
      exam_count: 1
    });
  }
  return [...byCreator.values()].sort((a, b) =>
    String(a.full_name).localeCompare(String(b.full_name), 'vi', { sensitivity: 'base' })
  );
}

async function studentPayload(db: any, user: any) {
  const selfProfile: any = await getSelfProfile(db, user);
  const selfAccount: any = await getSelfAccount(db, user);
  if (!selfProfile) throw new Error('STUDENT_PROFILE_NOT_FOUND');

  const teachers = await studentTeachers(db, selfProfile);
  const users = [selfProfile];
  const accounts = selfAccount ? [selfAccount] : [];

  return {
    role_scope: 'student',
    users,
    accounts,
    teachers,
    assigned_classes: [],
    scope_contract: {
      users: 'self_only',
      accounts: 'self_only',
      teachers: 'eligible_exam_creators_only'
    },
    counts: { users: users.length, accounts: accounts.length, teachers: teachers.length }
  };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const db = getDatabase(context);
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }
    const user: any = await verifyAuthSession(
      authHeader.slice(7),
      await getDynamicSecret(db, env.JWT_SECRET),
      db
    );
    if (!user) {
      return new Response(JSON.stringify({ error: 'Phiên đăng nhập không hợp lệ' }), { status: 401, headers });
    }

    let data;
    if (checkIsAdmin(user)) data = await adminPayload(db);
    else if (checkIsTeacherOrAdmin(user)) data = await teacherPayload(db, user);
    else data = await studentPayload(db, user);

    return new Response(JSON.stringify({ data, error: null }), { status: 200, headers });
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (msg.includes('TEACHER_ASSIGNMENT_SCOPE_INCOMPLETE')) {
      return new Response(JSON.stringify({
        error: 'Phân công lớp của giáo viên thiếu lớp hoặc đơn vị nên không thể xác định phạm vi dữ liệu an toàn.',
        code: 'TEACHER_ASSIGNMENT_SCOPE_INCOMPLETE'
      }), { status: 409, headers });
    }
    if (msg.includes('TEACHER_PROFILE_NOT_FOUND') || msg.includes('STUDENT_PROFILE_NOT_FOUND')) {
      return new Response(JSON.stringify({
        error: 'Không tìm thấy hồ sơ người dùng liên kết với tài khoản đăng nhập.',
        code: msg
      }), { status: 409, headers });
    }
    return new Response(JSON.stringify({
      error: 'Không thể tải dữ liệu nền theo vai trò.',
      code: 'CORE_IDENTITY_LOAD_FAILED'
    }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers });
