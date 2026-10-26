/**
 * Access policy for shared document URLs. Only accept server-verified actors.
 */
export const DOCUMENT_AUDIENCES = Object.freeze({
  public: 'Công khai (kể cả khách)',
  authenticated: 'Mọi tài khoản đăng nhập',
  teacher: 'Giáo viên',
  student: 'Học sinh',
  admin: 'Chỉ quản trị viên'
});
export const DOCUMENT_AUDIENCE_KEYS = Object.freeze(Object.keys(DOCUMENT_AUDIENCES));

export class DocumentLinkInputError extends Error {
  constructor(message) { super(message); this.name = 'DocumentLinkInputError'; }
}
export function documentActorRole(user) {
  if (!user) return 'guest';
  const role = String(user.role || '').trim().toLowerCase();
  const audience = String(user.target_audience || '').trim().toLowerCase();
  if (role === 'admin' || audience === 'quản trị viên' || audience === 'admin') return 'admin';
  if (role === 'teacher' || role === 'giáo viên' || audience === 'giáo viên') return 'teacher';
  if (role === 'student' || role === 'học sinh' || audience === 'học sinh') return 'student';
  return 'guest';
}
export function documentOwnerId(user) {
  return user?.id ? String(user.id) : '';
}
export function canManageDocument(actor, document = null) {
  const role = documentActorRole(actor);
  if (role === 'admin') return true;
  return role === 'teacher' && Boolean(documentOwnerId(actor)) &&
    (!document || String(document.id_nguoi_tao || '') === documentOwnerId(actor));
}
export function documentIsActive(row, at = Date.now()) {
  if (!row || !(row.hoat_dong === 1 || row.hoat_dong === true || row.hoat_dong === '1')) return false;
  if (!row.thoi_gian_het_han) return true;
  const expires = Date.parse(String(row.thoi_gian_het_han));
  return Number.isFinite(expires) && expires > at;
}
export function canViewDocument(actor, row, at = Date.now()) {
  if (!row || !documentIsActive(row, at)) return false;
  const role = documentActorRole(actor);
  if (role === 'admin') return true;
  const access = row.doi_tuong_duoc_truy_cap;
  return access === 'public' ||
    (access === 'authenticated' && role !== 'guest') ||
    (access === 'teacher' && role === 'teacher') ||
    (access === 'student' && role === 'student') ||
    (access === 'admin' && role === 'admin');
}
export function normalizeDocumentLinkInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DocumentLinkInputError('Dữ liệu tài liệu không hợp lệ.');
  }
  if (typeof input.tieu_de !== 'string') throw new DocumentLinkInputError('Vui lòng nhập tiêu đề tài liệu.');
  const title = input.tieu_de.trim();
  if (!title || title.length > 180 || /[\u0000-\u001f\u007f]/.test(title)) {
    throw new DocumentLinkInputError('Tiêu đề cần từ 1 đến 180 ký tự, không chứa ký tự điều khiển.');
  }
  if (typeof input.duong_link !== 'string') throw new DocumentLinkInputError('Vui lòng nhập liên kết chia sẻ.');
  const link = input.duong_link.trim();
  if (!link || link.length > 2048 || /[\u0000-\u0020\u007f]/.test(link)) {
    throw new DocumentLinkInputError('Đường liên kết không hợp lệ hoặc vượt quá 2048 ký tự.');
  }
  let url;
  try { url = new URL(link); } catch { throw new DocumentLinkInputError('Liên kết phải là địa chỉ HTTPS hợp lệ.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new DocumentLinkInputError('Chỉ chấp nhận HTTPS, không chứa thông tin đăng nhập trong địa chỉ.');
  }
  const audience = input.doi_tuong_duoc_truy_cap;
  if (typeof audience !== 'string' || !Object.hasOwn(DOCUMENT_AUDIENCES, audience)) {
    throw new DocumentLinkInputError('Hãy chọn đối tượng được truy cập hợp lệ.');
  }
  let expires = null;
  if (input.thoi_gian_het_han !== null && input.thoi_gian_het_han !== undefined && input.thoi_gian_het_han !== '') {
    const raw = input.thoi_gian_het_han;
    if (typeof raw !== 'string' || raw.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
      throw new DocumentLinkInputError('Thời gian hết hạn phải là ngày giờ ISO có múi giờ.');
    }
    const ts = Date.parse(raw);
    if (!Number.isFinite(ts)) throw new DocumentLinkInputError('Ngày giờ hết hạn không hợp lệ.');
    expires = new Date(ts).toISOString();
  }
  const active = input.hoat_dong;
  if (typeof active !== 'boolean' && active !== 0 && active !== 1) {
    throw new DocumentLinkInputError('Trạng thái hoạt động phải là bật hoặc tắt.');
  }
  return {
    mo_ta: String(input.mo_ta ?? '').trim().slice(0,4000),
    danh_muc: String(input.danh_muc ?? 'Chung').trim().slice(0,100) || 'Chung',
    tieu_de:title, duong_link:url.href,
    doi_tuong_duoc_truy_cap:audience, thoi_gian_het_han:expires,
    hoat_dong:active === true || active === 1 ? 1 : 0
  };
}
