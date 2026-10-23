/** Shared authorization primitives; display labels never grant privileges. */
export function canonicalRole(role: unknown): string {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'admin') return 'admin';
  if (['teacher', 'gi\u00e1o vi\u00ean'].includes(value)) return 'teacher';
  return 'user';
}
export function asFlag(value: unknown, fallback = false): boolean {
  if (value === null || value === undefined || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}
export function withoutAnswers(detail: any): any {
  const {correctAnswer, aiFeedback, ...safe} = detail || {};
  if (safe.question) {
    const {answer, correctAnswer: nestedAnswer, answerImage, ...question} = safe.question;
    if (question.options && typeof question.options === 'object') {
      const {answerImage, answer, correctAnswer, ...options} = question.options;
      question.options = options;
    }
    safe.question = question;
  }
  return safe;
}
export function normalizeScope(value: unknown): string {
  return String(value || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** An answer can be inferred from per-question scores; hide those as well. */
export function restrictResultDetail(detail:any, revealAnswers:boolean, revealScore:boolean):any {
  const safe=revealAnswers && revealScore ? {...detail} : withoutAnswers(detail);
  if(!revealScore) for(const key of ['score','isCorrect','correctStatements','aiFeedback','correctAnswer']) delete safe[key];
  return safe;
}
