export type AccountAccessReason = 'ok' | 'inactive' | 'expired' | 'invalid_expiry';

export type AccountAccessStatus = {
  allowed: boolean;
  reason: AccountAccessReason;
  field?: 'expiry_date' | 'profile_expiry_date';
};

const VN_OFFSET = '+07:00';
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const VI_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function pad3(value: number) {
  return String(value).padStart(3, '0');
}

function validDateParts(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
}

function vietnamEndOfDay(year: number, month: number, day: number) {
  if (!validDateParts(year, month, day)) throw new Error('Ngày hết hạn không hợp lệ');
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}T23:59:59.999${VN_OFFSET}`;
}

function vietnamOffsetIso(timestamp: number) {
  if (!Number.isFinite(timestamp)) throw new Error('Ngày hết hạn không hợp lệ');
  const local = new Date(timestamp + 7 * 60 * 60 * 1000);
  return `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}T${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}.${pad3(local.getUTCMilliseconds())}${VN_OFFSET}`;
}

/**
 * Canonical account expiry storage:
 * - empty => null (no expiry)
 * - yyyy-mm-dd or dd/mm/yyyy => end of that day in Viet Nam (+07:00)
 * - local ISO without zone => interpreted as Viet Nam local time
 * - ISO with explicit zone/Z => preserved as the same instant and serialized at +07:00
 */
export function normalizeVietnamExpiryForStorage(value: any): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  let match = raw.match(DATE_ONLY_RE);
  if (match) return vietnamEndOfDay(Number(match[1]), Number(match[2]), Number(match[3]));

  match = raw.match(VI_DATE_RE);
  if (match) return vietnamEndOfDay(Number(match[3]), Number(match[2]), Number(match[1]));

  match = raw.match(LOCAL_DATE_TIME_RE);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] || 0);
    const ms = Number(String(match[7] || '0').padEnd(3, '0'));
    if (!validDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59 || ms > 999) {
      throw new Error('Ngày hết hạn không hợp lệ');
    }
    return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}.${pad3(ms)}${VN_OFFSET}`;
  }

  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) throw new Error('Ngày hết hạn không hợp lệ');
  return vietnamOffsetIso(timestamp);
}

export function parseVietnamExpiryMs(value: any): number | null {
  const normalized = normalizeVietnamExpiryForStorage(value);
  return normalized ? Date.parse(normalized) : null;
}

function isActive(value: any) {
  return value === undefined || value === null ||
    !['0', 'false', 'disabled'].includes(String(value).toLowerCase().trim());
}

export function getAccountAccessStatus(row: any, nowMs = Date.now()): AccountAccessStatus {
  if (!row || !row.id || !row.password) return { allowed: false, reason: 'inactive' };
  if (!isActive(row.is_active) || !isActive(row.profile_active)) {
    return { allowed: false, reason: 'inactive' };
  }

  for (const field of ['expiry_date', 'profile_expiry_date'] as const) {
    const raw = row[field];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    let expiresAt: number | null;
    try {
      expiresAt = parseVietnamExpiryMs(raw);
    } catch {
      return { allowed: false, reason: 'invalid_expiry', field };
    }
    if (expiresAt !== null && expiresAt < nowMs) {
      return { allowed: false, reason: 'expired', field };
    }
  }

  return { allowed: true, reason: 'ok' };
}
