// School-exam disconnection contract. The server is authoritative: a browser
// timer never revokes an attempt or makes up a completed result.
export const EXAM_HEARTBEAT_INTERVAL_MS = 30_000;
export const EXAM_DISCONNECT_GRACE_MS = 90_000;

export function isSchoolExamHeartbeatStale(row, nowMs = Date.now()) {
  const raw = row?.last_seen_at ?? row?.created_at;
  const seenAtMs = Date.parse(String(raw || ''));
  return Number.isFinite(seenAtMs) && Number.isFinite(Number(nowMs)) &&
    Number(nowMs) - seenAtMs >= EXAM_DISCONNECT_GRACE_MS;
}
