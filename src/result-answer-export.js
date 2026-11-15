import { normalizeQuestionType, parseTF4CorrectAnswer, getTF4UserState } from './exam-grading-core.js';

const tfKeys = ['A', 'B', 'C', 'D'];
const MAX_CELL = 32000;

export function safeExcelText(input) {
  let value = String(input ?? '').replace(/\u0000/g, '').slice(0, MAX_CELL);
  // Never interpret untrusted student answers or imported questions as Excel formulas.
  if (/^[\s\uFEFF]*[=+\-@\t\r]/.test(value)) value = "'" + value;
  return value;
}

function printable(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string' && /^data:image\//i.test(value)) return '[Ảnh đính kèm dạng dữ liệu]';
  if (typeof value === 'string') return safeExcelText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return safeExcelText(JSON.stringify(value)); } catch { return '[Dữ liệu không thể hiển thị]'; }
}

function imageReference(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  if (/^data:/i.test(value)) return '[Ảnh đính kèm dạng dữ liệu]';
  // Only text metadata; spreadsheet is not an image file archive.
  return printable(value);
}
function formatTF4Key(answer) {
  const states = parseTF4CorrectAnswer(answer);
  if (!states) return printable(answer);
  return tfKeys.map(k => k + ': ' + (states[k] ? 'Đúng' : 'Sai')).join('; ');
}
function formatTF4Student(answer) {
  if (answer === null || answer === undefined || answer === '') return '';
  return tfKeys.map(k => {
    const state = getTF4UserState(answer, k);
    return k + ': ' + (state === null ? 'Chưa trả lời' : state ? 'Đúng' : 'Sai');
  }).join('; ');
}
function formatEssayResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return printable(value);
  return [printable(value.text), value.image ? 'Ảnh bài làm: ' + imageReference(value.image) : ''].filter(Boolean).join('\n');
}
function hasAnswer(type, answer) {
  if (type === 'TF4') return tfKeys.some(k => getTF4UserState(answer, k) !== null);
  if (type === 'TL') {
    if (answer && typeof answer === 'object' && !Array.isArray(answer))
      return Boolean(String(answer.text || '').trim() || answer.image);
  }
  return answer !== null && answer !== undefined && String(answer).trim() !== '';
}

export function toResultAnswerRows(result, snapshot) {
  const details = snapshot?.details;
  const expected = Number(snapshot?.total_questions);
  if (!Array.isArray(details) || !Number.isInteger(expected) || expected < 0 ||
      (expected > 0 && details.length !== expected))
    throw new Error('Bài làm ' + String(result.id || '') + ' thiếu dữ liệu chi tiết đáp án. Không thể xuất đủ câu hỏi.');

  return details.map((item, index) => {
    if (!item || typeof item !== 'object' || !item.question ||
        typeof item.question !== 'object' || !item.question.type)
      throw new Error('Chi tiết câu ' + (index + 1) + ' không hợp lệ. Không thể xuất đủ đáp án.');
    const question = item.question;
    const type = normalizeQuestionType(question.type);
    if (!type) throw new Error('Loại câu hỏi không hợp lệ trong kết quả ' + String(result.id || ''));
    const answer = Object.prototype.hasOwnProperty.call(item, 'correctAnswer') ? item.correctAnswer : question.answer;
    const studentAnswer = item.userAnswer;
    const knownAnswer = type === 'TL' ? Boolean(String(answer ?? '').trim() || question.options?.answerImage)
      : answer !== null && answer !== undefined && String(answer).trim() !== '';
    const answerKey = !knownAnswer ? '[Không có dữ liệu đáp án]' :
      type === 'TF4' ? formatTF4Key(answer) : printable(answer);
    const studentText = type === 'TF4' ? formatTF4Student(studentAnswer)
      : type === 'TL' ? formatEssayResponse(studentAnswer) : printable(studentAnswer);
    const status = !hasAnswer(type, studentAnswer) ? 'Chưa trả lời'
      : type === 'TL' ? (item.needsGrading ? 'Chờ chấm' : 'Đã chấm')
      : item.isCorrect === true ? 'Đúng' : item.isCorrect === false ? 'Sai' : 'Chưa xác định';
    return [
      printable(result.id), printable(result.studentName),
      printable(result.lop), printable(result.donvi || result.studentClass),
      printable(result.examName), printable(result.examId),
      index + 1, printable(question.id), type, printable(question.content),
      studentText, answerKey,
      type === 'TL' ? imageReference(question.options?.answerImage) : '',
      status,
      Number.isFinite(Number(item.score)) ? Number(item.score) : '',
      Number.isFinite(Number(item.maxScore)) ? Number(item.maxScore) : '',
      printable(item.aiFeedback || ''),
      printable(result.timestamp)
    ];
  });
}

export const RESULT_ANSWER_HEADERS = [
  'Mã kết quả', 'Họ tên học sinh', 'Lớp', 'Đơn vị', 'Đề thi', 'Mã đề',
  'Câu số', 'Mã câu hỏi', 'Loại câu', 'Nội dung câu hỏi',
  'Câu trả lời học sinh', 'Đáp án đúng / Hướng dẫn chấm',
  'Ảnh đáp án tự luận', 'Trạng thái', 'Điểm câu', 'Điểm tối đa',
  'Nhận xét chấm', 'Ngày thi'
];

export async function fetchResultAnswerRows(results, options) {
  const { fetchImpl, authToken, currentToken, isSessionCurrent, batchSize = 30 } = options;
  if (!Array.isArray(results)) throw new Error('Không có danh sách kết quả để xuất.');
  const normalized = [];
  const known = new Set();
  for (const row of results) {
    const id = String(row?.id || '');
    if (!id || known.has(id)) throw new Error('Danh sách kết quả trùng hoặc thiếu mã bài làm.');
    known.add(id);
  }
  for (let start = 0; start < results.length; start += batchSize) {
    if (!isSessionCurrent() || currentToken() !== authToken)
      throw new Error('Tài khoản đã thay đổi trong khi xuất Excel.');
    const batch = results.slice(start, start + batchSize);
    const response = await fetchImpl('/api/results/export-answers', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type':'application/json', Authorization:'Bearer ' + authToken },
      body: JSON.stringify({ ids: batch.map(r => String(r.id)) })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.data))
      throw new Error(payload.error || 'Không thể tải chi tiết đáp án được cấp quyền.');
    const byId = new Map(payload.data.map(x => [String(x.id), x]));
    if (byId.size !== batch.length)
      throw new Error('Số bài làm trả về không khớp yêu cầu xuất.');
    for (const result of batch) {
      const detail = byId.get(String(result.id));
      if (!detail || String(detail.exam_id) !== String(result.examId))
        throw new Error('Dữ liệu đáp án không khớp bài thi được xuất.');
      normalized.push(...toResultAnswerRows(result, detail));
    }
  }
  if (!isSessionCurrent() || currentToken() !== authToken)
    throw new Error('Tài khoản đã thay đổi trong khi xuất Excel.');
  return normalized;
}
