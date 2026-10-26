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


// Return the effective audience list without trusting arbitrary database values.
// Old rows contain only doi_tuong_duoc_truy_cap; upgraded rows use the array.
export function documentAudienceValues(rowOrValue) {
  const source = rowOrValue && typeof rowOrValue === 'object' && !Array.isArray(rowOrValue)
    ? (Array.isArray(rowOrValue.doi_tuong_truy_cap_nhieu) && rowOrValue.doi_tuong_truy_cap_nhieu.length
        ? rowOrValue.doi_tuong_truy_cap_nhieu : rowOrValue.doi_tuong_duoc_truy_cap)
    : rowOrValue;
  const values = Array.isArray(source) ? source : [source];
  return [...new Set(values.filter(value => typeof value === 'string' && Object.hasOwn(DOCUMENT_AUDIENCES, value)))];
}

export class DocumentLinkInputError extends Error {
  constructor(message) { super(message); this.name = 'DocumentLinkInputError'; }
}
export function documentActorRole(user) {
  if (!user) return 'guest';
  const role = String(user.role || '').trim().toLowerCase();
  const audience = String(user.target_audience || '').trim().toLowerCase();
  // Admin must be granted by the verified account role, never a profile audience.
  if (role === 'admin') return 'admin';
  if (role === 'teacher' || role === 'giáo viên') return 'teacher';
  if (role === 'student' || role === 'học sinh') return 'student';
  // Legacy accounts can have role=user with teacher/student classification in the profile.
  if (role === 'user' || role === '') {
    if (audience === 'giáo viên') return 'teacher';
    if (audience === 'học sinh') return 'student';
  }
  return 'guest';
}
export function documentOwnerId(user) {
  return user?.id ? String(user.id) : '';
}
// The server determines this flag for each document. Client-side buttons never grant rights.
export function canEditDocumentRow(manage, row) {
  return Boolean(manage && row && row.co_quyen_quan_ly === true);
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
  const audiences = documentAudienceValues(row);
  return audiences.includes('public') ||
    (audiences.includes('authenticated') && role !== 'guest') ||
    audiences.includes(role);

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
  // Accept legacy single-select clients and the new checkbox array.
  const supplied = input.doi_tuong_truy_cap_nhieu !== undefined
    ? input.doi_tuong_truy_cap_nhieu : input.doi_tuong_duoc_truy_cap;
  const selected = typeof supplied === 'string' ? [supplied] : supplied;
  if (!Array.isArray(selected) || !selected.length || selected.length > DOCUMENT_AUDIENCE_KEYS.length ||
      selected.some(value => typeof value !== 'string' || !Object.hasOwn(DOCUMENT_AUDIENCES, value))) {
    throw new DocumentLinkInputError('Hãy chọn ít nhất một đối tượng truy cập hợp lệ.');
  }
  const audiences = [...new Set(selected)];
  if (typeof input.doi_tuong_duoc_truy_cap === 'string' &&
      input.doi_tuong_truy_cap_nhieu !== undefined &&
      input.doi_tuong_duoc_truy_cap !== audiences[0]) {
    throw new DocumentLinkInputError('Đối tượng truy cập không nhất quán.');
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
    doi_tuong_duoc_truy_cap:audiences[0], doi_tuong_truy_cap_nhieu:audiences, thoi_gian_het_han:expires,
    hoat_dong:active === true || active === 1 ? 1 : 0
  };
}
