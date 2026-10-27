/**
 * Server-side essay grading. No API key, answer key or full response is returned
 * by the retry endpoint. All mutations require an atomically acquired DB lease.
 */
export const ESSAY_PENDING_STATES = ['pending', 'retry_pending', 'waiting_key', 'processing'];

export const essayFlag = value =>
  value === true || value === 1 || value === '1' || value === 'true';

export function parseEssayKeyPool(raw) {
  return [...new Set(String(raw || '').split(/\s+/).map(k => k.trim())
    .filter(k => k.length > 5 && !k.includes('••••••••') && !k.includes('YOUR_')))];
}

export function hasEssayAnswer(answer) {
  if (typeof answer === 'string') return answer.trim().length > 0;
  if (!answer || typeof answer !== 'object') return false;
  return String(answer.text || '').trim().length > 0 ||
    String(answer.image || answer.imageUrl || '').trim().length > 0;
}

export function prepareEssayDetails(details, autoGrade, maxScore) {
  return details.map(entry => {
    const d = { ...entry };
    if (d.question?.type !== 'TL') return d;
    d.maxScore = Number.isFinite(Number(maxScore)) && Number(maxScore) >= 0
      ? Number(maxScore) : 1;
    if (!hasEssayAnswer(d.userAnswer)) {
      d.score = 0;
      d.isCorrect = false;
      d.needsGrading = false;
      d.gradingStatus = 'completed';
      d.aiFeedback = 'Học sinh không nộp bài làm.';
    } else {
      d.score = null;
      d.isCorrect = false;
      d.needsGrading = true;
      d.gradingStatus = autoGrade ? 'pending' : 'manual_required';
      d.aiFeedback = autoGrade ? 'Đang chờ AI chấm bài.' : 'Đang chờ giáo viên chấm.';
    }
    return d;
  });
}

export function summarizeEssayDetails(details) {
  let provisionalScore = 0;
  let pendingCount = 0;
  let manualCount = 0;
  for (const detail of details) {
    const state = detail.gradingStatus;
    if (detail.question?.type === 'TL' && (state === 'manual_required' ||
        (detail.needsGrading && state !== 'completed'))) {
      if (state === 'manual_required') manualCount++;
      else pendingCount++;
      continue;
    }
    if (detail.score === null || detail.score === undefined ||
        !Number.isFinite(Number(detail.score))) {
      pendingCount++;
      continue;
    }
    provisionalScore += Number(detail.score);
  }
  const score = pendingCount || manualCount ? null : Number(provisionalScore.toFixed(2));
  return { score, provisionalScore: Number(provisionalScore.toFixed(2)),
    pendingCount, manualCount, completed: score !== null };
}

export async function ensureEssayGradingSchema(db) {
  const changes = [
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS submission_token_hash TEXT',
    "ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_status TEXT DEFAULT 'completed'",
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_attempts INTEGER DEFAULT 0',
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_retry_at TEXT',
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_lease_token TEXT',
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_lease_until TEXT',
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_error_code TEXT',
    'ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_updated_at TEXT',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_results_submission_token_hash ON results(submission_token_hash) WHERE submission_token_hash IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_results_grading_queue ON results(grading_status, grading_retry_at)'
  ];
  // Never silently ignore migrations. A partial schema is unsafe for submissions.
  for (const sql of changes) await db.prepare(sql).run();
}

export async function loadEssayGradingKeys(db, examId) {
  let raw = '';
  if (examId) {
    const exam = await db.prepare('SELECT ai_grading_key FROM exam_configs WHERE id = ? LIMIT 1')
      .bind(String(examId)).first();
    raw = String(exam?.ai_grading_key || '').trim();
  }
  if (!raw) {
    const settings = await db.prepare('SELECT ai_grading_key FROM app_settings WHERE id = 1').first();
    raw = String(settings?.ai_grading_key || '').trim();
  }
  return parseEssayKeyPool(raw);
}

function imagePart(dataUri) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUri || ''));
  if (!match || match[2].length > 6_000_000) return null;
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

function buildEssayParts(detail) {
  const answer = detail.userAnswer && typeof detail.userAnswer === 'object'
    ? detail.userAnswer : { text: detail.userAnswer };
  const points = Number(detail.maxScore ?? 1);
  const prompt = 'Bạn là giám khảo chấm bài tự luận. Chấm dựa trên câu hỏi, đáp án và bài làm. ' +
    'Bắt buộc trả về một JSON có score là số trong khoảng 0..' + points +
    ' và feedback là lời nhận xét; nếu chưa đủ căn cứ, không tự suy đoán.\n' +
    'Câu hỏi:\n' + String(detail.question?.content || '') +
    '\nĐáp án/Hướng dẫn:\n' + String(detail.correctAnswer || '') +
    '\nBài làm:\n' + String(answer.text || '');
  const parts = [{ text: prompt }];
  for (const [label, raw] of [
    ['Ảnh câu hỏi', detail.question?.image],
    ['Ảnh hướng dẫn chấm', detail.question?.options?.answerImage],
    ['Ảnh bài làm', answer.image || answer.imageUrl]
  ]) {
    const image = imagePart(raw);
    if (image) parts.push({ text: label }, image);
  }
  return parts;
}

const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
export async function gradeEssayWithKeyPool({
  detail, keys, fetchImpl = fetch, now = () => Date.now(),
  deadline = Date.now() + 22_000, perCallMs = 6_000,
  models = DEFAULT_MODELS
} = {}) {
  const pool = parseEssayKeyPool((keys || []).join(' '));
  if (!pool.length) return { ok: false, code: 'NO_KEY' };
  const points = Number(detail.maxScore);
  if (!Number.isFinite(points) || points < 0) return { ok: false, code: 'INVALID_POINTS' };
  const body = JSON.stringify({
    contents: [{ parts: buildEssayParts(detail) }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
  });
  let lastCode = 'AI_UNAVAILABLE';
  // A short global budget prevents an unbounded provider outage from blocking submission.
  for (let keyIndex = 0; keyIndex < pool.length; keyIndex++) {
    for (const model of models) {
      const budget = deadline - now();
      if (budget < 250) return { ok: false, code: lastCode };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(perCallMs, budget));
      try {
        const response = await fetchImpl(
          'https://generativelanguage.googleapis.com/v1beta/models/' +
          encodeURIComponent(model) + ':generateContent',
          { method: 'POST', headers: {
            'Content-Type': 'application/json', 'x-goog-api-key': pool[keyIndex]
          }, body, signal: controller.signal }
        );
        const payload = await response.json().catch(() => ({}));
        if (response.ok) {
          const output = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (typeof output !== 'string') { lastCode = 'EMPTY_AI_RESPONSE'; continue; }
          let parsed;
          try { parsed = JSON.parse(output); } catch { lastCode = 'INVALID_AI_JSON'; continue; }
          const score = parsed?.score;
          if (typeof score !== 'number' || !Number.isFinite(score) ||
              score < 0 || score > points || typeof parsed.feedback !== 'string') {
            lastCode = 'INVALID_AI_SCORE';
            continue;
          }
          return { ok: true, score: Number(score.toFixed(2)),
            feedback: parsed.feedback.slice(0, 3000), model, keyIndex };
        }
        lastCode = response.status === 429 ? 'QUOTA' :
          response.status === 401 || response.status === 403 ? 'KEY_REJECTED' :
          response.status === 404 ? 'MODEL_UNAVAILABLE' :
          response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'AI_REQUEST_REJECTED';
        if (response.status === 401 || response.status === 403 || response.status === 429 ||
            response.status === 400 && /key|quota|invalid/i.test(String(payload?.error?.message || ''))) {
          // Key is exhausted or invalid: advance to the next key without trying more models.
          break;
        }
      } catch (error) {
        lastCode = error?.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_NETWORK_ERROR';
      } finally {
        clearTimeout(timeout);
      }
    }
  }
  return { ok: false, code: lastCode };
}

function parsedDetails(row) {
  if (Array.isArray(row.details)) return row.details;
  const parsed = JSON.parse(String(row.details || '[]'));
  if (!Array.isArray(parsed)) throw new Error('INVALID_GRADING_DETAILS');
  return parsed;
}
function retryAfter(attempts, nowMs) {
  const seconds = Math.min(6 * 3600, Math.max(30, Math.pow(2, Math.min(10, attempts)) * 15));
  return new Date(nowMs + seconds * 1000).toISOString();
}
export function publicEssayGradingResult(row) {
  return {
    resultId: row.id,
    gradingStatus: String(row.grading_status || 'completed'),
    gradingAttempts: Number(row.grading_attempts || 0),
    nextRetryAt: row.grading_retry_at || null,
    score: row.grading_status === 'completed' ? row.score : null
  };
}

/**
 * One request holds a lease and checkpoints every successfully graded question.
 * On timeout/crash the next request can reclaim the expired lease (no double DB writes).
 */
export async function processStoredEssayGrading(db, resultId, options = {}) {
  const now = options.now || (() => Date.now());
  const nowMs = now();
  const nowISO = new Date(nowMs).toISOString();
  const lease = crypto.randomUUID();
  const leaseUntil = new Date(nowMs + 65_000).toISOString();
  const force = options.force === true;
  const claim = await db.prepare(
    "UPDATE results SET grading_status = 'processing', grading_lease_token = ?, grading_lease_until = ?, " +
    "grading_attempts = COALESCE(grading_attempts,0) + 1, grading_updated_at = ? WHERE id = ? AND " +
    "((grading_status IN ('pending','retry_pending','waiting_key') AND " +
    "(grading_retry_at IS NULL OR grading_retry_at <= ? OR ? = 1) AND " +
    "(grading_lease_token IS NULL OR grading_lease_until < ?)) OR " +
    "(grading_status = 'processing' AND grading_lease_until < ?))"
  ).bind(lease, leaseUntil, nowISO, resultId, nowISO, force ? 1 : 0, nowISO, nowISO).run();
  if (claim.meta?.changes !== 1) {
    const previous = await db.prepare(
      'SELECT id, grading_status, grading_attempts, grading_retry_at, score FROM results WHERE id = ?'
    ).bind(resultId).first();
    return previous ? publicEssayGradingResult(previous) : null;
  }

  let row;
  try {
    row = await db.prepare('SELECT * FROM results WHERE id = ? AND grading_lease_token = ?')
      .bind(resultId, lease).first();
    if (!row) throw new Error('GRADING_LEASE_NOT_FOUND');
    let details = parsedDetails(row);
    const keys = await loadEssayGradingKeys(db, row.exam_id);
    const deadline = now() + (options.budgetMs || 22_000);
    let errorCode = keys.length ? null : 'NO_KEY';
    for (let index = 0; index < details.length; index++) {
      const entry = details[index];
      if (entry.question?.type !== 'TL' || entry.gradingStatus === 'completed' ||
          entry.gradingStatus === 'manual_required') continue;
      if (now() >= deadline - 250) { errorCode = 'GRADING_BUDGET'; break; }
      const answer = await gradeEssayWithKeyPool({
        detail: entry, keys, deadline, now, fetchImpl: options.fetchImpl || fetch,
        models: options.models || DEFAULT_MODELS
      });
      if (!answer.ok) { errorCode = answer.code; break; }
      // Preserve earlier checkpoints when grading several essays.
      entry.score = answer.score;
      entry.isCorrect = answer.score > 0;
      entry.needsGrading = false;
      entry.gradingStatus = 'completed';
      entry.aiFeedback = answer.feedback;
      entry.aiGradingModel = answer.model;
      const checkpoint = await db.prepare(
        "UPDATE results SET details = ?, grading_updated_at = ? WHERE id = ? " +
        "AND grading_lease_token = ? AND grading_status = 'processing'"
      ).bind(JSON.stringify(details), new Date(now()).toISOString(), resultId, lease).run();
      if (checkpoint.meta?.changes !== 1) return null; // lease was superseded/manual override
    }
    const total = summarizeEssayDetails(details);
    let state = 'completed';
    if (total.manualCount) state = 'manual_required';
    else if (total.pendingCount) state = errorCode === 'NO_KEY' ? 'waiting_key' : 'retry_pending';
    const nextRetry = (state === 'retry_pending' || state === 'waiting_key')
      ? retryAfter(Number(row.grading_attempts || 1), now()) : null;
    const update = await db.prepare(
      "UPDATE results SET score = ?, details = ?, grading_status = ?, grading_retry_at = ?, " +
      "grading_error_code = ?, grading_lease_token = NULL, grading_lease_until = NULL, " +
      "grading_updated_at = ? WHERE id = ? AND grading_lease_token = ? AND grading_status = 'processing'"
    ).bind(total.score, JSON.stringify(details), state, nextRetry, errorCode,
      new Date(now()).toISOString(), resultId, lease).run();
    if (update.meta?.changes !== 1) return null;
    return { resultId, gradingStatus: state, score: total.score,
      provisionalScore: total.provisionalScore, pendingCount: total.pendingCount,
      nextRetryAt: nextRetry, gradingAttempts: Number(row.grading_attempts || 1) };
  } catch (err) {
    // An unexpected failure also releases the lease; never mark a partial score as final.
    const next = retryAfter(Number(row?.grading_attempts || 1), now());
    await db.prepare(
      "UPDATE results SET grading_status = 'retry_pending', grading_retry_at = ?, " +
      "grading_error_code = 'INTERNAL_GRADING_ERROR', grading_lease_token = NULL, " +
      "grading_lease_until = NULL, grading_updated_at = ? WHERE id = ? " +
      "AND grading_lease_token = ? AND grading_status = 'processing'"
    ).bind(next, new Date(now()).toISOString(), resultId, lease).run().catch(() => {});
    throw err;
  }
}
