const TYPE_SPECS = [
  { type: '4-1', total: 'count41', levels: ['count41NB', 'count41TH', 'count41VD'] },
  { type: 'TF4', total: 'countTF4', levels: ['countTF4NB', 'countTF4TH', 'countTF4VD'] },
  { type: 'SQ', total: 'countSQ', levels: ['countSQNB', 'countSQTH', 'countSQVD'] },
  { type: 'TL', total: 'countTL', levels: ['countTLNB', 'countTLTH', 'countTLVD'] }
];

const LEVELS = ['NB', 'TH', 'VD'];

const safeCount = value => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

export function normalizeExamPoolLesson(value) {
  return String(value ?? '').trim().toLocaleLowerCase('vi').replace(/\s+/g, ' ');
}

export function normalizeExamPoolType(value) {
  const type = String(value ?? '').trim().toLowerCase();
  if (type === '4-1' || type === 'trac_nghiem' || type === 'mcq') return '4-1';
  if (type === 'tf4' || type === 'dung_sai' || type === 'true_false') return 'TF4';
  if (type === 'sq' || type === 'tra_loi_ngan' || type === 'short_answer') return 'SQ';
  if (type === 'tl' || type === 'tu_luan' || type === 'essay') return 'TL';
  return String(value ?? '').trim();
}

export function normalizeExamPoolLevel(value) {
  const level = String(value ?? '').trim().toUpperCase();
  return LEVELS.includes(level) ? level : '';
}

export function verifyExamConfigQuestionPool(config, questions) {
  const source = config && typeof config === 'object' ? config : {};
  const rows = Array.isArray(questions) ? questions : [];
  const creatorId = String(source.creatorId ?? source.creator_id ?? '').trim();
  const selectedLessons = [...new Set(
    (Array.isArray(source.selectedLessons) ? source.selectedLessons : [])
      .map(normalizeExamPoolLesson)
      .filter(Boolean)
  )];

  const requiredByType = TYPE_SPECS.map(spec => {
    const detail = spec.levels.map(key => safeCount(source[key]));
    const detailedTotal = detail.reduce((sum, value) => sum + value, 0);
    const configuredTotal = safeCount(source[spec.total]);
    return {
      ...spec,
      configuredTotal,
      detailedTotal,
      requiredTotal: detailedTotal > 0 ? detailedTotal : configuredTotal,
      detail
    };
  });
  const requiredTotal = requiredByType.reduce((sum, spec) => sum + spec.requiredTotal, 0);

  if (requiredTotal === 0) {
    return { ok: true, requiredTotal: 0, eligibleTotal: 0, creatorId, selectedLessons, missing: [], counts: {} };
  }
  if (!creatorId) {
    return {
      ok: false, requiredTotal, eligibleTotal: 0, creatorId, selectedLessons, counts: {},
      missing: [{ reason: 'missing_creator', message: 'Cấu hình đề thi không xác định được người tạo.' }]
    };
  }
  if (!selectedLessons.length) {
    return {
      ok: false, requiredTotal, eligibleTotal: 0, creatorId, selectedLessons, counts: {},
      missing: [{ reason: 'missing_lessons', message: 'Cấu hình đề thi không có bài học/chuyên đề hợp lệ.' }]
    };
  }

  const lessonSet = new Set(selectedLessons);
  const eligible = rows.filter(question =>
    String(question?.creatorId ?? question?.creator_id ?? '').trim() === creatorId &&
    lessonSet.has(normalizeExamPoolLesson(question?.lesson))
  );

  const counts = {};
  for (const question of eligible) {
    const type = normalizeExamPoolType(question?.type);
    const level = normalizeExamPoolLevel(question?.level);
    const key = type + '-' + level;
    counts[key] = (counts[key] || 0) + 1;
  }

  const missing = [];
  for (const spec of requiredByType) {
    if (spec.requiredTotal <= 0) continue;
    if (spec.detailedTotal > 0) {
      LEVELS.forEach((level, index) => {
        const required = spec.detail[index];
        const available = counts[spec.type + '-' + level] || 0;
        if (available < required) {
          missing.push({ reason: 'insufficient', type: spec.type, level, required, available });
        }
      });
    } else {
      const available = LEVELS.reduce((sum, level) => sum + (counts[spec.type + '-' + level] || 0), 0);
      if (available < spec.configuredTotal) {
        missing.push({ reason: 'insufficient', type: spec.type, level: null, required: spec.configuredTotal, available });
      }
    }
  }

  return {
    ok: missing.length === 0,
    requiredTotal,
    eligibleTotal: eligible.length,
    creatorId,
    selectedLessons,
    missing,
    counts
  };
}

export function examQuestionPoolFailureMessage(verification) {
  if (!verification || verification.ok) return '';
  const first = verification.missing?.[0];
  if (first?.message) return first.message;
  if (first?.reason === 'insufficient') {
    const level = first.level ? ' ' + first.level : '';
    return `Ngân hàng câu hỏi không đủ đúng cấu hình: ${first.type}${level} cần ${first.required}, hiện có ${first.available}.`;
  }
  return 'Không thể xác minh đầy đủ ngân hàng câu hỏi theo cấu hình đề thi.';
}
