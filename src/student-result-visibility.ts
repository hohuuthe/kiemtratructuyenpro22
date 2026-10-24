/**
 * Server-only policy for student exam history.
 * Trust only the current exam_configs row joined by the immutable exam ID.
 * Never infer permissions from exam names, browser flags or cached snapshots.
 */
export function isExamSettingEnabled(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function studentExamVisibility(row: any) {
  return {
    can_view_score: isExamSettingEnabled(row?.exam_show_score),
    can_view_details: isExamSettingEnabled(row?.exam_show_details)
  };
}

function decode(value: any): any {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try { return JSON.parse(value); } catch { return value; }
}

function displayText(value: any): any {
  if (typeof value === 'string' || typeof value === 'number') return value;
  const object = decode(value);
  if (!object || typeof object !== 'object' || Array.isArray(object)) return '';
  const text = object.text ?? object.content;
  return (typeof text === 'string' || typeof text === 'number') ? { text } : '';
}

function displayImage(value: any): string {
  return typeof value === 'string' ? value : '';
}

function displayOption(value: any): any {
  value = decode(value);
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const text = [value.text, value.content, value.value, value.label]
    .find(item => typeof item === 'string' || typeof item === 'number');
  const image = [value.image, value.img, value.src, value.url, value.picture]
    .find(item => typeof item === 'string');
  return { text: text === undefined ? '' : text, image: image || '' };
}

const letters = ['A', 'B', 'C', 'D'];
function displayOptions(raw: any) {
  const options = decode(raw);
  const picked: any = {};
  if (Array.isArray(options)) {
    for (let i = 0; i < Math.min(options.length, 4); i++) picked[letters[i]] = displayOption(options[i]);
    return picked;
  }
  if (!options || typeof options !== 'object') return picked;
  // Preserve only visible choices, never answerImage/correctAnswer/teacher hints.
  for (let i = 0; i < letters.length; i++) {
    const letter = letters[i];
    const aliases = [letter, letter.toLowerCase(), 'opt' + letter, 'option' + letter,
      'opt_' + letter.toLowerCase(), 'option_' + letter.toLowerCase()];
    if (Object.prototype.hasOwnProperty.call(options, '0')) aliases.push(String(i));
    else if (Object.prototype.hasOwnProperty.call(options, '1')) aliases.push(String(i + 1));
    const alias = aliases.find(key => Object.prototype.hasOwnProperty.call(options, key));
    if (alias !== undefined) picked[letter] = displayOption(options[alias]);
  }
  return picked;
}

function displayOptionImages(raw: any) {
  const images = decode(raw);
  const picked: any = {};
  if (!images || typeof images !== 'object') return picked;
  for (const [index, letter] of letters.entries()) {
    const candidate = Array.isArray(images) ? images[index] : (images[letter] ?? images[letter.toLowerCase()]);
    if (typeof candidate === 'string') picked[letter] = candidate;
  }
  return picked;
}

function displayQuestion(raw: any) {
  const question = decode(raw);
  if (!question || typeof question !== 'object' || Array.isArray(question)) {
    return { content: displayText(question) };
  }
  const shuffledOptions = decode(question.shuffledOptions ?? question.shuffled_options);
  return {
    type: typeof question.type === 'string' ? question.type : '',
    content: displayText(question.content),
    image: displayImage(question.image),
    options: displayOptions(question.options),
    optionImages: displayOptionImages(question.optionImages ?? question.option_images ?? question.images),
    ...(Array.isArray(shuffledOptions) && shuffledOptions.length === 4 &&
        shuffledOptions.every((item: unknown) => typeof item === 'string' && letters.includes(item.toUpperCase())) &&
        new Set(shuffledOptions.map((item: string) => item.toUpperCase())).size === 4
      ? { shuffledOptions: shuffledOptions.map((item: string) => item.toUpperCase()) } : {})
  };
}

function displayStudentAnswer(value: any, type: string): any {
  const answer = decode(value);
  if (answer === null || typeof answer === 'string' || typeof answer === 'boolean' || typeof answer === 'number') return answer;
  if (Array.isArray(answer)) return answer.slice(0, 100).map(item =>
    (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') ? item : '');
  if (!answer || typeof answer !== 'object') return null;
  if (String(type).toUpperCase() === 'TF4') {
    const picked: any = {};
    for (const letter of letters) {
      const val = answer[letter] ?? answer[letter.toLowerCase()];
      if (val === true || val === false || val === 0 || val === 1 ||
          (typeof val === 'string' && ['true', 'false', '0', '1'].includes(val.toLowerCase()))) {
        picked[letter] = val;
      }
    }
    return picked;
  }
  const picked: any = {};
  if (typeof answer.text === 'string' || typeof answer.text === 'number') picked.text = answer.text;
  for (const key of ['image', 'imageUrl', 'image_url']) {
    if (typeof answer[key] === 'string') picked[key] = answer[key];
  }
  return picked;
}

/** Never return raw grading snapshots: they can contain question.answer,
 * unrelated answer keys, answerImage and private AI grading feedback. */
export function projectStudentAttemptDetails(raw: any, canViewScore: boolean): any[] {
  const parsed = decode(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry: any) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { question: {}, userAnswer: null };
    const question = displayQuestion(entry.question);
    const out: any = { question, userAnswer: displayStudentAnswer(entry.userAnswer, question.type) };
    // Detail endpoint calls this only after checking show_details=true on the server.
    if (entry.correctAnswer !== undefined && entry.correctAnswer !== null) {
      const answer = entry.correctAnswer;
      if (typeof answer === 'string' || typeof answer === 'number' || typeof answer === 'boolean') {
        out.correctAnswer = answer;
      }
    }
    if (canViewScore) {
      if (entry.isCorrect === true || entry.isCorrect === false) out.isCorrect = entry.isCorrect;
      if (entry.score !== undefined && entry.score !== null && Number.isFinite(Number(entry.score))) {
        out.score = Number(entry.score);
      }
    }
    return out;
  });
}

export function projectStudentResultRow(row: any) {
  const permission = studentExamVisibility(row);
  return {
    id: row.id,
    exam_id: row.exam_id,
    exam_name: row.exam_name,
    score: permission.can_view_score ? row.score : null,
    correct_count: permission.can_view_score ? row.correct_count : null,
    total_questions: row.total_questions,
    time_taken: row.time_taken,
    created_at: row.created_at,
    ...permission
  };
}
