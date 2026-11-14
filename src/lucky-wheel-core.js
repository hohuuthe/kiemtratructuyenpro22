const TAU = Math.PI * 2;

export const normWheelText = (value) =>
  String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');

export function wheelStorageKey({ tenant, teacherId, unit, className, kind = 'session' }) {
  if (!String(teacherId || '').trim()) throw new Error('Thiếu định danh giáo viên.');
  return ['kttt-lucky-wheel', 'v1', tenant || 'default', teacherId, kind, unit || '', className || '']
    .map(value => encodeURIComponent(String(value))).join(':');
}

export function classChoices(users, assignments, isAdmin) {
  const choices = new Map();
  const add = (unit, className) => {
    if (!String(unit || '').trim() || !String(className || '').trim()) return;
    const key = normWheelText(unit) + '|' + normWheelText(className);
    if (!choices.has(key)) choices.set(key, { unit: String(unit).trim(), className: String(className).trim(), key });
  };
  if (isAdmin) {
    for (const u of users || []) {
      if (isWheelStudent(u)) add(u.donvi, u.lop);
    }
  } else {
    for (const a of assignments || []) add(a.donvi, a.class_name);
  }
  return [...choices.values()].sort((a, b) =>
    a.unit.localeCompare(b.unit, 'vi', { numeric: true }) ||
    a.className.localeCompare(b.className, 'vi', { numeric: true })
  );
}

export function isWheelStudent(row) {
  const audience = normWheelText(row?.target_audience);
  return (audience === 'học sinh' || audience === 'student') && !!String(row?.id || '').trim();
}

export function classRoster(users, assignments, isAdmin, unit, className) {
  const unitKey = normWheelText(unit);
  const classKey = normWheelText(className);
  if (!unitKey || !classKey) return [];
  if (!isAdmin && !(assignments || []).some(a =>
    normWheelText(a.donvi) === unitKey && normWheelText(a.class_name) === classKey
  )) return [];
  const seen = new Set();
  return (users || []).filter(row => {
    if (!isWheelStudent(row) || normWheelText(row.donvi) !== unitKey ||
        normWheelText(row.lop) !== classKey) return false;
    const id = String(row.id).trim();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map(row => ({
    id: String(row.id).trim(),
    name: String(row.full_name || row.ho_ten || 'Chưa có họ tên').trim(),
    unit: String(row.donvi).trim(),
    className: String(row.lop).trim()
  })).sort((a, b) =>
    a.name.localeCompare(b.name, 'vi', { numeric: true }) ||
    a.id.localeCompare(b.id, 'vi')
  );
}

export function reconcileWheelState(raw, roster) {
  const valid = new Set(roster.map(s => s.id));
  const clean = values => [...new Set(Array.isArray(values) ? values.filter(id =>
    typeof id === 'string' && valid.has(id)) : [])];
  const excluded = clean(raw?.excluded);
  const called = clean(raw?.called);
  const history = clean(raw?.history);
  const pendingId = typeof raw?.pendingId === 'string' && valid.has(raw.pendingId)
    ? raw.pendingId : null;
  const lastId = typeof raw?.lastId === 'string' && valid.has(raw.lastId)
    ? raw.lastId : null;
  return { excluded, called, history, pendingId, lastId };
}

export function availableStudents(roster, state) {
  const excluded = new Set(state.excluded || []);
  const called = new Set(state.called || []);
  return roster.filter(s => !excluded.has(s.id) && !called.has(s.id));
}

export function randomWheelIndex(length, cryptoSource = globalThis.crypto) {
  if (!Number.isSafeInteger(length) || length < 1 || length > 0xffffffff) {
    throw new RangeError('Danh sách tham gia không hợp lệ.');
  }
  if (!cryptoSource?.getRandomValues) throw new Error('Trình duyệt không hỗ trợ số ngẫu nhiên an toàn.');
  const range = 0x100000000;
  const limit = Math.floor(range / length) * length;
  const buf = new Uint32Array(1);
  let value;
  do {
    cryptoSource.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % length;
}

export function nextWheelRotation(currentAngle, targetIndex, sectorCount, turns = 6) {
  if (!Number.isInteger(targetIndex) || !Number.isInteger(sectorCount) ||
      sectorCount < 1 || targetIndex < 0 || targetIndex >= sectorCount) {
    throw new RangeError('Vị trí kim chọn không hợp lệ.');
  }
  const positiveModulo = value => ((value % TAU) + TAU) % TAU;
  const desired = positiveModulo(-targetIndex * TAU / sectorCount);
  const diff = positiveModulo(desired - positiveModulo(currentAngle));
  return currentAngle + Math.max(2, Math.floor(turns)) * TAU + diff;
}

export function finishPendingWheelResult(state) {
  if (!state.pendingId) return state;
  return {
    ...state,
    lastId: state.pendingId,
    called: [...new Set([...state.called, state.pendingId])],
    history: [...new Set([...state.history, state.pendingId])],
    pendingId: null
  };
}
