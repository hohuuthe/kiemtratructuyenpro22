/**
 * Strict, presentation-only parsing for counts supplied by /api/exams.
 * PostgreSQL COUNT(*) may arrive as a numeric string through the Neon adapter.
 * Absence, lack of permission or an invalid number is NOT the same as zero.
 * This module must never mutate the table DOM: each row is built atomically
 * inside renderExamConfigsTable so its 11 cells match the 11 header columns.
 */
export function parseExamAttemptCount(raw) {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw === 'string' && /^(0|[1-9][0-9]*)$/.test(raw)) {
    const count = Number(raw);
    return Number.isSafeInteger(count) ? count : null;
  }
  return null;
}

export function getExamAttemptCount(exams, examId) {
  const id = typeof examId === 'string' ? examId.trim() : '';
  if (!id || !Array.isArray(exams)) return null;
  const exam = exams.find(row => String(row?.id ?? '').trim() === id);
  return parseExamAttemptCount(exam?.attempt_count);
}
