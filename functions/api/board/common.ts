import {
  getDatabase, getDynamicSecret, verifyAuthSession, checkIsTeacherOrAdmin,
  hashPasswordPBKDF2, verifyPassword
} from '../exam/utils';
import { ensureInteractiveBoardSchema } from './schema';

export const boardCorsHeaders = {
  // API bảng chỉ phục vụ cùng origin; không mở CORS ra website bên ngoài.
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

export function boardJson(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: boardCorsHeaders });
}

export async function getBoardRequestContext(context: any) {
  const db = getDatabase(context);
  await ensureInteractiveBoardSchema(db);
  const header = context.request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return { db, user: null, isAdmin: false, isTeacher: false };
  const secret = await getDynamicSecret(db, context.env?.JWT_SECRET);
  const user = await verifyAuthSession(header.slice(7), secret, db);
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
  const isTeacher = !!user && checkIsTeacherOrAdmin(user) && !isAdmin;
  return { db, user, isAdmin, isTeacher };
}

export function cleanText(value: unknown, max: number, fallback = '') {
  const text = String(value ?? fallback).trim();
  if (text.length > max) throw new Error('Dữ liệu vượt giới hạn cho phép.');
  return text;
}

export function cleanId(value: unknown) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : '';
}

export function cleanBoardStatus(value: unknown, fallback = 'draft') {
  const status = String(value ?? fallback).trim();
  if (!['draft','open','locked','closed','archived'].includes(status)) {
    throw new Error('Trạng thái bảng không hợp lệ.');
  }
  return status;
}

export function cleanBoardAccessMode(value: unknown, fallback = 'public') {
  const mode = String(value ?? fallback).trim();
  if (!['public','unit','protected'].includes(mode)) throw new Error('Chế độ truy cập bảng không hợp lệ.');
  return mode;
}

export function cleanStudentPermission(value: unknown, fallback = 'draw') {
  const permission = String(value ?? fallback).trim();
  if (!['view','comment','draw'].includes(permission)) throw new Error('Quyền tương tác học sinh không hợp lệ.');
  return permission;
}

export function normalizeClassList(value: unknown) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(raw.map(v => String(v).trim()).filter(Boolean))].slice(0, 50);
}

function norm(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('vi').replace(/\s+/g, '');
}

export function boardWindowOpen(board: any, now = Date.now()) {
  if (board.starts_at) {
    const start = Date.parse(board.starts_at);
    if (Number.isFinite(start) && now < start) return false;
  }
  if (board.ends_at) {
    const end = Date.parse(board.ends_at);
    if (Number.isFinite(end) && now > end) return false;
  }
  return true;
}

export function canManageBoard(user: any, board: any, isAdmin = false) {
  if (!user || !board) return false;
  if (isAdmin) return true;
  const ids = new Set([String(user.id || ''), String(user.user_id || '')].filter(Boolean));
  return ids.has(String(board.creator_id || ''));
}

export function unitAndClassMatch(user: any, board: any) {
  if (!user) return false;
  const requiredUnit = norm(board.target_donvi);
  const userUnit = norm(user.donvi);
  if (requiredUnit && requiredUnit !== userUnit) return false;
  const classes = normalizeClassList(board.target_lop).map(norm).filter(Boolean);
  if (!classes.length) return true;
  return classes.includes(norm(user.lop));
}

export function canDiscoverBoard(user: any, board: any, isAdmin = false) {
  if (!user || !board) return false;
  if (canManageBoard(user, board, isAdmin)) return true;
  if (!['open','locked'].includes(String(board.status || ''))) return false;
  if (!boardWindowOpen(board)) return false;
  if (board.access_mode === 'unit') return unitAndClassMatch(user, board);
  return board.access_mode === 'public' || board.access_mode === 'protected';
}

export async function canEnterBoard(user: any, board: any, isAdmin: boolean, accessCode: unknown) {
  if (!canDiscoverBoard(user, board, isAdmin)) return { ok: false, status: 403, error: 'Bạn không có quyền truy cập bảng này.' };
  if (canManageBoard(user, board, isAdmin)) return { ok: true };
  if (board.access_mode === 'protected') {
    const code = typeof accessCode === 'string' ? accessCode.trim() : '';
    if (!code) return { ok: false, status: 403, code: 'BOARD_ACCESS_CODE_REQUIRED', error: 'Vui lòng nhập mã bảo mật của bảng.' };
    if (!board.access_code_hash || !(await verifyPassword(code, board.access_code_hash))) {
      return { ok: false, status: 403, code: 'BOARD_ACCESS_CODE_INVALID', error: 'Mã bảo mật của bảng không đúng.' };
    }
  }
  return { ok: true };
}

export async function hashBoardAccessCode(code: unknown) {
  const value = cleanText(code, 200);
  if (value.length < 4) throw new Error('Mã bảo mật phải có ít nhất 4 ký tự.');
  if (value.length > 64) throw new Error('Mã bảo mật tối đa 64 ký tự.');
  return hashPasswordPBKDF2(value);
}

export function boardListProjection(board: any, owner = false) {
  const base: any = {
    id: board.id,
    name: board.name,
    description: board.description || '',
    creator_id: board.creator_id,
    creator_name: board.creator_name || '',
    status: board.status,
    access_mode: board.access_mode,
    target_donvi: board.target_donvi || '',
    target_lop: board.target_lop || '',
    student_permission: board.student_permission,
    starts_at: board.starts_at || null,
    ends_at: board.ends_at || null,
    max_participants: Number(board.max_participants) || 60,
    revision: Number(board.revision) || 1,
    created_at: board.created_at,
    updated_at: board.updated_at,
    protected: board.access_mode === 'protected'
  };
  if (owner && board.settings_json) {
    try { base.settings = JSON.parse(board.settings_json); } catch { base.settings = {}; }
  }
  return base;
}

export async function loadBoard(db: any, id: string) {
  return db.prepare(`
    SELECT id,name,description,creator_id,status,access_mode,access_code_hash,
           target_donvi,target_lop,student_permission,starts_at,ends_at,
           max_participants,settings_json,revision,created_at,updated_at
    FROM interactive_boards WHERE id = ? LIMIT 1
  `).bind(id).first();
}
