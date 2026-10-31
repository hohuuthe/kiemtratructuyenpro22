import { resolveTenantRoutingFromRequest } from '../../src/tenant-host-map';
import {
  boardJson, getBoardRequestContext, cleanText, cleanBoardStatus, cleanBoardAccessMode,
  cleanStudentPermission, normalizeClassList, canManageBoard, canDiscoverBoard,
  hashBoardAccessCode, boardListProjection, loadBoard
} from './board/common';

function pageParams(url: string) {
  const p = new URL(url).searchParams;
  const page = Math.max(1, Math.min(100000, Number(p.get('page')) || 1));
  const limit = Math.max(1, Math.min(50, Number(p.get('limit')) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

function isoOrNull(value: unknown) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new Error('Thời gian cấu hình không hợp lệ.');
  return d.toISOString();
}

async function assertTeacherTargets(db: any, user: any, isAdmin: boolean, accessMode: string, targetDonvi: string, targetClasses: string[]) {
  if (isAdmin || accessMode !== 'unit') return;
  const userUnit = String(user?.donvi || '').trim();
  if (!userUnit || targetDonvi !== userUnit) throw new Error('Giáo viên chỉ được tạo bảng cho đơn vị của mình.');
  if (!targetClasses.length) throw new Error('Vui lòng chọn ít nhất một lớp được phép truy cập.');
  const teacherIds = [...new Set([String(user?.id || ''), String(user?.user_id || '')].filter(Boolean))];
  if (!teacherIds.length) throw new Error('Không xác định được tài khoản giáo viên.');
  const placeholders = teacherIds.map(() => '?').join(',');
  const { results } = await db.prepare(
    `SELECT class_name, donvi FROM teacher_classes
     WHERE teacher_id IN (${placeholders}) AND donvi = ?`
  ).bind(...teacherIds, targetDonvi).all();
  const allowed = new Set((results || []).map((r: any) => String(r.class_name || '').trim()).filter(Boolean));
  const invalid = targetClasses.filter(name => !allowed.has(name));
  if (invalid.length) throw new Error('Có lớp chưa được phân công cho giáo viên: ' + invalid.join(', '));
}

function parsePayload(input: any, user: any, current?: any) {
  const accessMode = cleanBoardAccessMode(input.access_mode, current?.access_mode || 'public');
  const targetClasses = normalizeClassList(input.target_lop ?? current?.target_lop ?? '');
  const targetDonvi = cleanText(input.target_donvi ?? current?.target_donvi ?? user?.donvi ?? '', 180);
  const startsAt = input.starts_at === undefined ? (current?.starts_at || null) : isoOrNull(input.starts_at);
  const endsAt = input.ends_at === undefined ? (current?.ends_at || null) : isoOrNull(input.ends_at);
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) throw new Error('Thời gian kết thúc phải sau thời gian bắt đầu.');
  const maxParticipants = Math.max(1, Math.min(120, Number(input.max_participants ?? current?.max_participants ?? 60) || 60));
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : (() => {
    try { return JSON.parse(current?.settings_json || '{}'); } catch { return {}; }
  })();
  const safeSettings = {
    showNames: settings.showNames !== false,
    allowStudentDeleteOwn: settings.allowStudentDeleteOwn !== false,
    background: ['white','grid','lined','dots'].includes(settings.background) ? settings.background : 'white'
  };
  return {
    name: cleanText(input.name ?? current?.name, 180),
    description: cleanText(input.description ?? current?.description ?? '', 1000),
    status: cleanBoardStatus(input.status, current?.status || 'draft'),
    accessMode,
    targetDonvi: accessMode === 'unit' ? targetDonvi : '',
    targetClasses: accessMode === 'unit' ? targetClasses : [],
    studentPermission: cleanStudentPermission(input.student_permission, current?.student_permission || 'draw'),
    startsAt, endsAt, maxParticipants,
    settingsJson: JSON.stringify(safeSettings)
  };
}

export const onRequestOptions: PagesFunction = async () => boardJson({ ok: true });

export const onRequestGet: PagesFunction = async (context: any) => {
  try {
    const { db, user, isAdmin, isTeacher } = await getBoardRequestContext(context);
    if (!user) return boardJson({ error: 'Vui lòng đăng nhập để sử dụng bảng tương tác.' }, 401);
    const { page, limit, offset } = pageParams(context.request.url);
    const manage = new URL(context.request.url).searchParams.get('manage') === '1';

    if (manage && (isAdmin || isTeacher)) {
      const where = isAdmin ? '' : 'WHERE b.creator_id IN (?, ?)';
      const params = isAdmin ? [] : [String(user.id || ''), String(user.user_id || '')];
      const countRow = await db.prepare(
        `SELECT COUNT(*)::int AS total FROM interactive_boards b ${where}`
      ).bind(...params).first();
      const { results } = await db.prepare(
        `SELECT b.id,b.name,b.description,b.creator_id,b.status,b.access_mode,
                b.target_donvi,b.target_lop,b.student_permission,b.starts_at,b.ends_at,
                b.max_participants,b.settings_json,b.revision,b.created_at,b.updated_at,
                COALESCE(u.full_name,a.username,b.creator_id) AS creator_name
         FROM interactive_boards b
         LEFT JOIN accounts a ON a.id = b.creator_id
         LEFT JOIN users u ON u.id = COALESCE(a.user_id,a.id)
         ${where}
         ORDER BY b.updated_at DESC
         LIMIT ? OFFSET ?`
      ).bind(...params, limit, offset).all();
      return boardJson({
        data: (results || []).map((row: any) => boardListProjection(row, canManageBoard(user, row, isAdmin))),
        total: Number(countRow?.total || 0), page, limit
      });
    }

    // Student discovery is filtered inside PostgreSQL so Neon returns only the requested page.
    const unit = String(user.donvi || '').trim();
    const studentClass = String(user.lop || '').replace(/\s+/g, '');
    const visibilitySql = `
       b.status IN ('open','locked')
       AND (b.starts_at IS NULL OR b.starts_at <= CURRENT_TIMESTAMP)
       AND (b.ends_at IS NULL OR b.ends_at >= CURRENT_TIMESTAMP)
       AND (
         b.access_mode IN ('public','protected')
         OR (
           b.access_mode='unit'
           AND LOWER(TRIM(b.target_donvi))=LOWER(TRIM(?))
           AND (TRIM(b.target_lop)='' OR LOWER(?) = ANY(string_to_array(LOWER(replace(b.target_lop,' ','')), ',')))
         )
       )`;
    const countRow = await db.prepare(
      `SELECT COUNT(*)::int AS total FROM interactive_boards b WHERE ${visibilitySql}`
    ).bind(unit, studentClass).first();
    const { results } = await db.prepare(
      `SELECT b.id,b.name,b.description,b.creator_id,b.status,b.access_mode,
              b.target_donvi,b.target_lop,b.student_permission,b.starts_at,b.ends_at,
              b.max_participants,b.revision,b.created_at,b.updated_at,
              COALESCE(u.full_name,a.username,b.creator_id) AS creator_name
       FROM interactive_boards b
       LEFT JOIN accounts a ON a.id = b.creator_id
       LEFT JOIN users u ON u.id = COALESCE(a.user_id,a.id)
       WHERE ${visibilitySql}
       ORDER BY b.updated_at DESC
       LIMIT ? OFFSET ?`
    ).bind(unit, studentClass, limit, offset).all();
    const visible = (results || []).filter((row: any) => canDiscoverBoard(user, row, isAdmin));
    return boardJson({ data: visible.map((row: any) => boardListProjection(row, false)), total: Number(countRow?.total || 0), page, limit });
  } catch (error: any) {
    console.error('[BOARD LIST]', error?.message || error);
    return boardJson({ error: error?.message || 'Không thể tải danh sách bảng tương tác.' }, 500);
  }
};

export const onRequestPost: PagesFunction = async (context: any) => {
  try {
    const { db, user, isAdmin, isTeacher } = await getBoardRequestContext(context);
    if (!user || (!isAdmin && !isTeacher)) return boardJson({ error: 'Chỉ giáo viên hoặc quản trị viên được tạo bảng.' }, 403);
    const input: any = await context.request.json();
    const parsed = parsePayload(input, user);
    if (!parsed.name) return boardJson({ error: 'Tên bảng không được để trống.' }, 400);
    await assertTeacherTargets(db, user, isAdmin, parsed.accessMode, parsed.targetDonvi, parsed.targetClasses);
    const id = crypto.randomUUID();
    const pageId = crypto.randomUUID();
    const accessHash = parsed.accessMode === 'protected' ? await hashBoardAccessCode(input.access_code) : null;
    const creatorId = String(user.id || user.user_id || '');
    await db.prepare(
      `INSERT INTO interactive_boards
       (id,name,description,creator_id,status,access_mode,access_code_hash,target_donvi,target_lop,
        student_permission,starts_at,ends_at,max_participants,settings_json,revision,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(id, parsed.name, parsed.description, creatorId, parsed.status, parsed.accessMode, accessHash,
      parsed.targetDonvi, parsed.targetClasses.join(','), parsed.studentPermission, parsed.startsAt, parsed.endsAt,
      parsed.maxParticipants, parsed.settingsJson).run();
    await db.prepare(
      `INSERT INTO interactive_board_pages
       (id,board_id,page_no,title,background_type,canvas_width,canvas_height,revision,created_at,updated_at)
       VALUES (?,?,1,'Bảng 1',?,1600,900,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(pageId, id, JSON.parse(parsed.settingsJson).background || 'white').run();
    return boardJson({ data: boardListProjection(await loadBoard(db, id), true) }, 201);
  } catch (error: any) {
    console.error('[BOARD CREATE]', error?.message || error);
    return boardJson({ error: error?.message || 'Không thể tạo bảng tương tác.' }, 400);
  }
};

export const onRequestPut: PagesFunction = async (context: any) => {
  try {
    const { db, user, isAdmin } = await getBoardRequestContext(context);
    if (!user) return boardJson({ error: 'Phiên đăng nhập không hợp lệ.' }, 401);
    const input: any = await context.request.json();
    const id = String(input.id || '').trim();
    const current = await loadBoard(db, id);
    if (!current) return boardJson({ error: 'Không tìm thấy bảng.' }, 404);
    if (!canManageBoard(user, current, isAdmin)) return boardJson({ error: 'Bạn không có quyền sửa bảng này.' }, 403);
    const parsed = parsePayload(input, user, current);
    await assertTeacherTargets(db, user, isAdmin, parsed.accessMode, parsed.targetDonvi, parsed.targetClasses);
    let accessHash = current.access_code_hash || null;
    if (parsed.accessMode !== 'protected') accessHash = null;
    else if (typeof input.access_code === 'string' && input.access_code.trim()) accessHash = await hashBoardAccessCode(input.access_code);
    else if (!accessHash) return boardJson({ error: 'Bảng bảo mật phải có mã truy cập.' }, 400);

    const expectedRevision = Math.max(1, Number(input.revision || current.revision || 1));
    const result = await db.prepare(
      `UPDATE interactive_boards SET
       name=?,description=?,status=?,access_mode=?,access_code_hash=?,target_donvi=?,target_lop=?,
       student_permission=?,starts_at=?,ends_at=?,max_participants=?,settings_json=?,
       revision=revision+1,updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND revision=?`
    ).bind(parsed.name, parsed.description, parsed.status, parsed.accessMode, accessHash, parsed.targetDonvi,
      parsed.targetClasses.join(','), parsed.studentPermission, parsed.startsAt, parsed.endsAt,
      parsed.maxParticipants, parsed.settingsJson, id, expectedRevision).run();
    if (!Number(result.meta?.changes || 0)) return boardJson({ error: 'Bảng vừa được thay đổi ở thiết bị khác. Vui lòng tải lại trước khi lưu.' }, 409);
    return boardJson({ data: boardListProjection(await loadBoard(db, id), true) });
  } catch (error: any) {
    console.error('[BOARD UPDATE]', error?.message || error);
    return boardJson({ error: error?.message || 'Không thể cập nhật bảng tương tác.' }, 400);
  }
};

export const onRequestDelete: PagesFunction = async (context: any) => {
  try {
    const { db, user, isAdmin } = await getBoardRequestContext(context);
    if (!user) return boardJson({ error: 'Phiên đăng nhập không hợp lệ.' }, 401);
    const id = new URL(context.request.url).searchParams.get('id') || '';
    const current = await loadBoard(db, id);
    if (!current) return boardJson({ error: 'Không tìm thấy bảng.' }, 404);
    if (!canManageBoard(user, current, isAdmin)) return boardJson({ error: 'Bạn không có quyền xóa bảng này.' }, 403);
    await db.prepare('DELETE FROM interactive_board_pages WHERE board_id=?').bind(id).run();
    await db.prepare('DELETE FROM interactive_boards WHERE id=?').bind(id).run();

    // Best-effort purge of Durable Object state. Metadata deletion stays authoritative
    // even if the optional realtime Worker is temporarily unavailable.
    try {
      const secret=String(context.env?.BOARD_REALTIME_SECRET || context.env?.JWT_SECRET || '').trim();
      if(secret && context.env?.BOARD_REALTIME?.fetch){
        const route=resolveTenantRoutingFromRequest(context.request,context.env);
        await context.env.BOARD_REALTIME.fetch(new Request('https://board.internal/internal/board-reset',{
          method:'POST',
          headers:{'Content-Type':'application/json','X-Board-Internal-Secret':secret},
          body:JSON.stringify({tenant:String(route.slug||'default'),boardId:id})
        }));
      }
    } catch(error:any) {
      console.warn('[BOARD REALTIME PURGE]',error?.message||error);
    }
    return boardJson({ ok: true });
  } catch (error: any) {
    console.error('[BOARD DELETE]', error?.message || error);
    return boardJson({ error: 'Không thể xóa bảng tương tác.' }, 500);
  }
};
