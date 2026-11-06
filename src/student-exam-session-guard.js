let examSessionSequence = 0;

export function createExamSessionId(now = Date.now()) {
  examSessionSequence = (examSessionSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${Number(now) || Date.now()}-${examSessionSequence}`;
}

export function remainingExamSeconds(startTime, timeLimitSeconds, now = Date.now()) {
  const startedAt = Number(startTime);
  const duration = Number(timeLimitSeconds);
  const currentTime = Number(now);

  if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isFinite(currentTime)) return null;

  const elapsed = Math.max(0, Math.floor((currentTime - startedAt) / 1000));
  return Math.max(0, Math.floor(duration) - elapsed);
}

export function remainingExamSecondsMonotonic(startTick, timeLimitSeconds, nowTick) {
  const startedAt = Number(startTick);
  const duration = Number(timeLimitSeconds);
  const currentTick = Number(nowTick);

  if (!Number.isFinite(startedAt) || startedAt < 0) return null;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isFinite(currentTick) || currentTick < startedAt) return null;

  const elapsed = Math.max(0, Math.floor((currentTick - startedAt) / 1000));
  return Math.max(0, Math.floor(duration) - elapsed);
}

export function canAutoSubmitExam({
  reason,
  remainingSeconds,
  cheatWarningCount = 0,
  maxCheatWarnings = 0
} = {}) {
  if (reason === 'time_expired') {
    return Number.isFinite(remainingSeconds) && remainingSeconds <= 0;
  }
  if (reason === 'cheat_limit') {
    const maxWarnings = Number(maxCheatWarnings);
    // "Tối đa N lần" nghĩa là học sinh vẫn được tiếp tục ở đúng lần thứ N.
    // Chỉ khi số vi phạm VƯỢT quá N (N + 1) mới được phép tự động nộp.
    return maxWarnings > 0 && Number(cheatWarningCount) > maxWarnings;
  }
  return false;
}

export function normalizeExamViolationReason(reason = '') {
  const value = String(reason || '').trim().toLowerCase();
  if (value.includes('tab') || value.includes('visibility') || value.includes('ẩn')) return 'visibility';
  if (value.includes('fullscreen') || value.includes('toàn màn hình')) return 'fullscreen';
  return value || 'unknown';
}

export function shouldCountExamViolation({
  reason,
  lastReason = '',
  now = 0,
  lastAt = 0,
  duplicateWindowMs = 1200
} = {}) {
  const currentKey = normalizeExamViolationReason(reason);
  const previousKey = normalizeExamViolationReason(lastReason);
  const currentAt = Number(now);
  const previousAt = Number(lastAt);
  const windowMs = Math.max(0, Number(duplicateWindowMs) || 0);

  if (!Number.isFinite(currentAt) || currentAt <= 0) return true;
  if (!Number.isFinite(previousAt) || previousAt <= 0) return true;

  const delta = currentAt - previousAt;
  if (delta < 0 || delta > windowMs) return true;

  // Cùng một tín hiệu browser phát lặp rất nhanh -> chỉ tính một lần.
  if (currentKey === previousKey) return false;

  // Một hành vi rời màn hình thường phát cả visibilitychange + fullscreenchange.
  // Gộp cặp tín hiệu này thành duy nhất một lần vi phạm.
  const pair = new Set([currentKey, previousKey]);
  if (pair.has('visibility') && pair.has('fullscreen')) return false;

  return true;
}
