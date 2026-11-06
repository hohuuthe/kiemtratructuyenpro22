/**
 * Shared, deterministic grading primitives.
 *
 * The server is authoritative, but the browser imports the same helpers so
 * immediate feedback cannot disagree with final grading.
 */

function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function examFlagEnabled(value, fallback = false) {
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

function parseTruthToken(value) {
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
export function parseTF4CorrectAnswer(correctAnswer) {
  const raw = String(correctAnswer ?? '').trim();
  if (!raw) return null;
  const keys = ['A', 'B', 'C', 'D'];
  const compact = upper(raw).replace(/\s+/g, '');
  if (['NONE', 'KHÔNGCÓÝĐÚNG', 'KHONGCOYDUNG', '----'].includes(compact)) {
    return { A: false, B: false, C: false, D: false };
  }
  if (/^[ĐDSF]{4}$/.test(compact)) {
    const parsed = [...compact].map(parseTruthToken);
    if (parsed.every(v => v !== null)) {
      return { A: parsed[0], B: parsed[1], C: parsed[2], D: parsed[3] };
    }
  }

  const explicit = {};
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
  if (parts.length > 0 && parts.every(p => keys.includes(upper(p)))) {
    const normalized = parts.map(upper);
    if (new Set(normalized).size !== normalized.length) return null;
    const trueSet = new Set(normalized);
    return { A: trueSet.has('A'), B: trueSet.has('B'), C: trueSet.has('C'), D: trueSet.has('D') };
  }

  if (parts.length === 4) {
    const parsed = parts.map(parseTruthToken);
    if (parsed.some(v => v === null)) return null;
    return {
      A: parsed[0],
      B: parsed[1],
      C: parsed[2],
      D: parsed[3]
    };
  }

  return null;
}

/**
 * Missing/invalid student choice is null, never false.
 * This is critical: "not answered" must never receive credit for a false key.
 */
export function getTF4UserState(userAnswer, option) {
  if (!userAnswer || typeof userAnswer !== 'object' || Array.isArray(userAnswer)) return null;
  const key = upper(option);
  const value = userAnswer[key] ?? userAnswer[key.toLowerCase()];
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  if (typeof value === 'string') return parseTruthToken(value);
  return null;
}

export function evaluateTF4(correctAnswer, userAnswer) {
  const expected = parseTF4CorrectAnswer(correctAnswer);
  if (!expected) {
    return { validKey: false, answeredCount: 0, correctCount: 0, allCorrect: false };
  }
  let answeredCount = 0;
  let correctCount = 0;
  for (const option of ['A', 'B', 'C', 'D']) {
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

function normalizeUnicodeMath(text) {
  return text
    .normalize('NFKC')
    .replace(/[−–—]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/[÷⁄∕]/g, '/')
    .replace(/\u00A0/g, ' ');
}

function normalizeDecimalComma(text) {
  return text.replace(/(\d),(\d)/g, '$1.$2');
}

/**
 * "Punctuation insensitive" means cosmetic prose punctuation is ignored.
 * Mathematical operators and number syntax are always preserved.
 */
export function normalizeShortAnswer(value, options = {}) {
  let text = normalizeUnicodeMath(String(value ?? '').trim());

  if (!options.caseSensitive) text = text.toLowerCase();

  if (!options.punctuationSensitive) {
    text = normalizeDecimalComma(text);
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

export function isShortAnswerCorrect(userAnswer, correctAnswer, options = {}) {
  const user = normalizeShortAnswer(userAnswer, options);
  if (!user) return false;

  // In strict punctuation mode, semicolon is data, not a separator.
  // "|" is always the canonical alternative-answer separator.
  const alternativeSeparator = options.punctuationSensitive ? /\|+/ : /[|;]+/;
  const rawAlternatives = String(correctAnswer ?? '')
    .split(alternativeSeparator)
    .map(s => s.trim())
    .filter(Boolean);

  if (rawAlternatives.length === 0) return false;
  return rawAlternatives.some(answer => normalizeShortAnswer(answer, options) === user);
}

export function clampScore(value, maxScore) {
  const score = Number(value);
  const max = Number(maxScore);
  const safeScore = Number.isFinite(score) ? score : 0;
  const safeMax = Number.isFinite(max) && max >= 0 ? max : 0;
  return Math.max(0, Math.min(safeMax, safeScore));
}

export function roundScore(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = Math.pow(10, digits);
  return Math.round((number + Number.EPSILON) * factor) / factor;
}


export function normalizeQuestionType(type) {
  const t = String(type ?? '').trim().toLowerCase();
  if (['4-1','trac_nghiem','mcq'].includes(t)) return '4-1';
  if (['tf4','dung_sai','true_false'].includes(t)) return 'TF4';
  if (['sq','tra_loi_ngan','short_answer'].includes(t)) return 'SQ';
  if (['tl','tu_luan','essay'].includes(t)) return 'TL';
  return '';
}

/**
 * Validate an answer key before it can enter the question bank.
 * This prevents malformed keys from reaching exam generation/grading.
 */
export function validateQuestionAnswer(type, answer, options = {}) {
  const normalizedType = normalizeQuestionType(type);
  const raw = String(answer ?? '').trim();

  if (!normalizedType) return { ok: false, reason: 'Loại câu hỏi không hợp lệ.' };

  if (normalizedType === '4-1') {
    const value = raw.toUpperCase();
    return /^[ABCD]$/.test(value)
      ? { ok: true, value }
      : { ok: false, reason: 'Đáp án trắc nghiệm phải là đúng một ký tự A, B, C hoặc D.' };
  }

  if (normalizedType === 'TF4') {
    return parseTF4CorrectAnswer(raw)
      ? { ok: true, value: raw }
      : { ok: false, reason: 'Đáp án Đúng/Sai phải xác định đầy đủ trạng thái A-D hoặc danh sách các ý đúng hợp lệ.' };
  }

  if (normalizedType === 'SQ') {
    return raw
      ? { ok: true, value: raw }
      : { ok: false, reason: 'Câu trả lời ngắn bắt buộc phải có đáp án.' };
  }

  const answerImage = options && typeof options === 'object' ? String(options.answerImage ?? '').trim() : '';
  return raw || answerImage
    ? { ok: true, value: raw }
    : { ok: false, reason: 'Câu tự luận phải có hướng dẫn chấm bằng văn bản hoặc hình ảnh đáp án.' };
}
