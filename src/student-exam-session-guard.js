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
    return maxWarnings > 0 && Number(cheatWarningCount) >= maxWarnings;
  }
  return false;
}
