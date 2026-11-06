export const EXAM_SESSION_PURPOSE_PRESTART = 'exam_prestart';
export const EXAM_SESSION_PURPOSE_ACTIVE = 'exam_active';

export function examBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value).trim().toLowerCase();
  if (['1','true','yes','on'].includes(normalized)) return true;
  if (['0','false','no','off'].includes(normalized)) return false;
  return fallback;
}

export function normalizeExamTimeLimitSeconds(value, fallback = 45 * 60) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.max(1, Math.floor(numeric));
  const safeFallback = Number(fallback);
  return Number.isFinite(safeFallback) && safeFallback > 0 ? Math.max(1, Math.floor(safeFallback)) : 45 * 60;
}

export function examDeadlineAtMs(startedAtMs, timeLimitSeconds) {
  const started = Number(startedAtMs);
  const duration = normalizeExamTimeLimitSeconds(timeLimitSeconds);
  if (!Number.isFinite(started) || started <= 0) return null;
  return started + duration * 1000;
}

export function remainingExamSecondsFromDeadline(deadlineAtMs, nowMs = Date.now()) {
  const deadline = Number(deadlineAtMs);
  const now = Number(nowMs);
  if (!Number.isFinite(deadline) || deadline <= 0 || !Number.isFinite(now)) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

function parseDateMs(value) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // Giá trị từ input datetime-local không mang múi giờ. Toàn hệ thống vận hành
  // theo giờ Việt Nam, vì vậy phải gắn UTC+07:00 tường minh thay vì phụ thuộc
  // múi giờ runtime của Cloudflare/Node.
  const vietnamLocal = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  const normalized = vietnamLocal
    ? `${vietnamLocal[1]}T${vietnamLocal[2]}:${vietnamLocal[3] || '00'}${vietnamLocal[4] ? '.' + vietnamLocal[4] : ''}+07:00`
    : raw;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : NaN;
}

export function readExamAccessWindow(config = {}) {
  let access = config?.access_control ?? config?.accessControl ?? null;
  if (typeof access === 'string' && access.trim()) {
    try { access = JSON.parse(access); } catch { access = { enabled: true, __invalid: true }; }
  }
  if (!access || typeof access !== 'object' || Array.isArray(access)) access = {};

  const enabled = examBoolean(access.enabled, false);
  const startRaw = access.startTime ?? access.start_time ?? config?.tg_bd ?? '';
  const endRaw = access.endTime ?? access.end_time ?? config?.tg_kt ?? '';
  const startMs = parseDateMs(startRaw);
  const endMs = parseDateMs(endRaw);
  const invalid = Boolean(access.__invalid) ||
    (startRaw !== '' && Number.isNaN(startMs)) ||
    (endRaw !== '' && Number.isNaN(endMs)) ||
    (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs < startMs);

  return { enabled, startRaw, endRaw, startMs, endMs, invalid };
}

export function evaluateExamAccessWindow(config = {}, nowMs = Date.now()) {
  const window = readExamAccessWindow(config);
  if (!window.enabled) return { allowed: true, code: 'OK', ...window };

  const now = Number(nowMs);
  if (!Number.isFinite(now) || window.invalid) {
    return { allowed: false, code: 'EXAM_TIME_WINDOW_INVALID', ...window };
  }
  if (Number.isFinite(window.startMs) && now < window.startMs) {
    return { allowed: false, code: 'EXAM_NOT_STARTED', ...window };
  }
  if (Number.isFinite(window.endMs) && now > window.endMs) {
    return { allowed: false, code: 'EXAM_WINDOW_CLOSED', ...window };
  }
  return { allowed: true, code: 'OK', ...window };
}

export function resolveAuthoritativeExamTiming(claims = {}, sessionRow = {}, nowMs = Date.now()) {
  const limitSeconds = normalizeExamTimeLimitSeconds(claims?.timeLimitSeconds);
  const rowStarted = sessionRow?.started_at ? new Date(sessionRow.started_at).getTime() : NaN;
  const rowDeadline = sessionRow?.deadline_at ? new Date(sessionRow.deadline_at).getTime() : NaN;
  const claimStarted = Number(claims?.startedAtMs ?? claims?.timestamp);
  const claimDeadline = Number(claims?.deadlineAtMs);

  const startedAtMs = Number.isFinite(rowStarted) && rowStarted > 0
    ? rowStarted
    : (Number.isFinite(claimStarted) && claimStarted > 0 ? claimStarted : null);
  const deadlineAtMs = Number.isFinite(rowDeadline) && rowDeadline > 0
    ? rowDeadline
    : (Number.isFinite(claimDeadline) && claimDeadline > 0
      ? claimDeadline
      : examDeadlineAtMs(startedAtMs, limitSeconds));

  const valid = Number.isFinite(startedAtMs) && startedAtMs > 0 &&
    Number.isFinite(deadlineAtMs) && deadlineAtMs > startedAtMs;
  const now = Number(nowMs);
  const expired = valid && Number.isFinite(now) ? now > deadlineAtMs : false;
  const elapsedSeconds = valid && Number.isFinite(now)
    ? Math.max(0, Math.min(limitSeconds, Math.floor((now - startedAtMs) / 1000)))
    : limitSeconds;

  return { valid, startedAtMs, deadlineAtMs, limitSeconds, expired, elapsedSeconds };
}
