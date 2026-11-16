// A started attempt is never resumed after navigation. The server owns its final state.
export const EXAM_HEARTBEAT_MS = 30_000;
export const EXAM_IDLE_TIMEOUT_MS = 90_000;
export const EXAM_FINALIZATION_LEASE_MS = 5 * 60_000;

export function isExamFinalizationDue(row, nowMs = Date.now()) {
  const seen = Date.parse(String(row?.last_seen_at || ''));
  const started = Date.parse(String(row?.started_at || ''));
  const now = Number(nowMs);
  // Do not retroactively submit legacy attempts which never had lifecycle
  // tracking: those must be reconciled separately to protect active students.
  if (!Number.isFinite(seen) || !Number.isFinite(started) ||
      !Number.isFinite(now) || started > now || seen > now) return false;
  const leftAt = Date.parse(String(row?.leave_requested_at || ''));
  const deadline = Date.parse(String(row?.deadline_at || ''));
  return Number.isFinite(leftAt) || seen <= now - EXAM_IDLE_TIMEOUT_MS ||
    (Number.isFinite(deadline) && deadline <= now);
}

export function allowExamHeartbeat(row) {
  return Boolean(row?.started_at && row?.last_seen_at &&
    !row?.leave_requested_at && !row?.finalization_claimed_at);
}
