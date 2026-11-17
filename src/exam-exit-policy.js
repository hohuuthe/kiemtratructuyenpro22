// Exam attempt lifetime is server-authoritative. Browser storage is never a resume source.
export const EXAM_HEARTBEAT_MS = 30_000;
export const EXAM_IDLE_TIMEOUT_MS = 90_000;
export const EXAM_FINALIZER_RETRY_MS = 5 * 60_000;

export function shouldFinalizeExamLiveness(row, nowMs = Date.now()) {
  if (!row) return false;
  const finalizingAt = Date.parse(String(row.finalizing_at || ''));
  if (Number.isFinite(finalizingAt) && finalizingAt > nowMs - EXAM_FINALIZER_RETRY_MS) return false;
  const leftAt = Date.parse(String(row.leave_requested_at || ''));
  const lastSeen = Date.parse(String(row.last_seen_at || ''));
  const deadline = Date.parse(String(row.deadline_at || ''));
  return Number.isFinite(leftAt) ||
    (Number.isFinite(deadline) && deadline <= nowMs) ||
    (Number.isFinite(lastSeen) && lastSeen <= nowMs - EXAM_IDLE_TIMEOUT_MS);
}

export function normalizeExamStudentInfo(info = {}) {
  const value = (v, max = 200) => String(v ?? '').trim().slice(0, max);
  return {
    name: value(info.name),
    lop: value(info.lop),
    donvi: value(info.donvi),
    unit: value(info.unit),
    studentClass: value(info.studentClass),
    teacherId: value(info.teacherId),
    examId: value(info.examId),
    examName: value(info.examName),
    loaiThiSinh: value(info.loaiThiSinh, 80)
  };
}
