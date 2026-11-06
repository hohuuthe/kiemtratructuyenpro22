/**
 * Shared, deterministic grading primitives.
 *
 * The server is authoritative, but the browser imports the same helpers so
 * immediate feedback cannot disagree with final grading.
 */

export type TF4State = boolean | null;

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

export function examFlagEnabled(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'off'].includes(v)) return false;
  }
  return fallback;
}

function parseTruthToken(value: unknown): boolean | null {
  const v = upper(value);
  if (['D', 'Đ', 'ĐÚNG', 'DUNG', 'T', 'TRUE', '1'].includes(v)) return true;
  if (['S', 'SAI', 'F', 'FALSE', '0'].includes(v)) return false;
  return null;
}

/**
 * Parse a TF4 answer key into explicit A-D boolean states.
 * Canonical DB form is a list of true options such as "A&C", but legacy forms
 * like "A:Đ&B:S&C:Đ&D:S" and "Đ,S,Đ,S" are also supported.
 */
export function parseTF4CorrectAnswer(correctAnswer: unknown): Record<'A' | 'B' | 'C' | 'D', boolean> | null {
  const raw = String(correctAnswer ?? '').trim();
  if (!raw) return null;
  const keys = ['A', 'B', 'C', 'D'] as const;

  const explicit: Partial<Record<typeof keys[number], boolean>> = {};
  let explicitCount = 0;
  for (const key of keys) {
    const match = raw.match(new RegExp(`(?:^|[&,;/\\s])${key}\\s*[:=]\\s*([^&,;/\\s]+)`, 'i'));
    if (!match) continue;
    const parsed = parseTruthToken(match[1]);
    if (parsed === null) return null;
    explicit[key] = parsed;
    explicitCount++;
  }
  if (explicitCount > 0) {
    if (explicitCount !== 4) return null;
    return {
      A: Boolean(explicit.A),
      B: Boolean(explicit.B),
      C: Boolean(explicit.C),
      D: Boolean(explicit.D)
    };
  }

  const parts = raw.split(/[&,;/\\s]+/).map(p => p.trim()).filter(Boolean);
  if (parts.length > 0 && parts.every(p => keys.includes(upper(p) as any))) {
    const trueSet = new Set(parts.map(upper));
    return { A: trueSet.has('A'), B: trueSet.has('B'), C: trueSet.has('C'), D: trueSet.has('D') };
  }

  if (parts.length === 4) {
    const parsed = parts.map(parseTruthToken);
    if (parsed.some(v => v === null)) return null;
    return {
      A: parsed[0] as boolean,
      B: parsed[1] as boolean,
      C: parsed[2] as boolean,
      D: parsed[3] as boolean
    };
  }

  return null;
}

/**
 * Missing/invalid student choice is null, never false.
 * This is critical: "not answered" must never receive credit for a false key.
 */
export function getTF4UserState(userAnswer: any, option: string): TF4State {
  if (!userAnswer || typeof userAnswer !== 'object' || Array.isArray(userAnswer)) return null;
  const key = upper(option);
  const value = userAnswer[key] ?? userAnswer[key.toLowerCase()];
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  if (typeof value === 'string') return parseTruthToken(value);
  return null;
}

export function evaluateTF4(correctAnswer: unknown, userAnswer: any) {
  const expected = parseTF4CorrectAnswer(correctAnswer);
  if (!expected) {
    return { validKey: false, answeredCount: 0, correctCount: 0, allCorrect: false };
  }
  let answeredCount = 0;
  let correctCount = 0;
  for (const option of ['A', 'B', 'C', 'D'] as const) {
    const state = getTF4UserState(userAnswer, option);
    if (state === null) continue;
    answeredCount++;
    if (state === expected[option]) correctCount++;
  }
  return {
    validKey: true,
    answeredCount,
    correctCount,
    allCorrect: answeredCount === 4 && correctCount === 4
  };
}

function normalizeUnicodeMath(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[−–—]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/\u00A0/g, ' ');
}

function normalizeDecimalComma(text: string): string {
  return text.replace(/(\d),(\d)/g, '$1.$2');
}

/**
 * "Punctuation insensitive" means cosmetic prose punctuation is ignored.
 * Mathematical operators and number syntax are always preserved.
 */
export function normalizeShortAnswer(
  value: unknown,
  options: { caseSensitive?: boolean; punctuationSensitive?: boolean } = {}
): string {
  let text = normalizeUnicodeMath(String(value ?? '').trim());
  text = normalizeDecimalComma(text);

  if (!options.caseSensitive) text = text.toLowerCase();

  if (!options.punctuationSensitive) {
    // Remove only cosmetic prose punctuation. Never remove - / . + = < > ^ * %
    // because doing so changes mathematical meaning.
    text = text
      .replace(/[!?;:'"“”‘’…]/g, '')
      .replace(/(^|\s)[,.](?=\s|$)/g, '$1')
      .replace(/[,.]+$/g, '');
  }

  text = text
    .replace(/\s*([+\-*\/=<>^%])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

export function isShortAnswerCorrect(
  userAnswer: unknown,
  correctAnswer: unknown,
  options: { caseSensitive?: boolean; punctuationSensitive?: boolean } = {}
): boolean {
  const user = normalizeShortAnswer(userAnswer, options);
  if (!user) return false;

  // Split alternatives BEFORE punctuation normalization so ";" remains a separator.
  const rawAlternatives = String(correctAnswer ?? '')
    .split(/[|;]+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (rawAlternatives.length === 0) return false;
  return rawAlternatives.some(answer => normalizeShortAnswer(answer, options) === user);
}

export function clampScore(value: unknown, maxScore: unknown): number {
  const score = Number(value);
  const max = Number(maxScore);
  const safeScore = Number.isFinite(score) ? score : 0;
  const safeMax = Number.isFinite(max) && max >= 0 ? max : 0;
  return Math.max(0, Math.min(safeMax, safeScore));
}

export function roundScore(value: unknown, digits = 2): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = Math.pow(10, digits);
  return Math.round((number + Number.EPSILON) * factor) / factor;
}
