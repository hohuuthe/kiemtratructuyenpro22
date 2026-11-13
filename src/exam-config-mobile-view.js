/**
 * Mobile-only, read-only presentation of the existing /api/exams management list.
 * Never render password, AI grading key, or other secrets. Permissions and
 * allowed actions are supplied by the caller and enforced again by the API.
 */
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])
);
const valueOf = (row, keys, fallback = '') => {
  for (const key of keys) if (row?.[key] !== null && row?.[key] !== undefined && row?.[key] !== '') return row[key];
  return fallback;
};
const truthy = value => value === true || value === 1 ||
  (typeof value === 'string' && ['true','1','yes','on'].includes(value.trim().toLowerCase()));
const asObject = value => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
    catch { return {}; }
  }
  return {};
};
const asList = value => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : value ? [value] : []; }
    catch { return value ? [value] : []; }
  }
  return [];
};
const countOf = (exam, fields) => {
  const value = Number(valueOf(exam, fields, 0));
  return Number.isFinite(value) && value >= 0 ? value : 0;
};
const textValue = (exam, fields, empty = '—') => {
  const value = valueOf(exam, fields, '');
  return value === '' ? empty : String(value);
};
const numericValue = (exam, fields) => {
  const raw = valueOf(exam, fields, '');
  if (raw === '') return '—';
  const value = Number(raw);
  return Number.isFinite(value) ? value.toLocaleString('vi-VN', {maximumFractionDigits: 4}) : '—';
};
const pair = (name, content) =>
  '<div class="exam-mobile-pair"><dt>' + escapeHtml(name) + '</dt><dd>' + escapeHtml(content) + '</dd></div>';
const setting = (name, enabled) => pair(name, enabled ? 'Bật' : 'Tắt');

export function renderExamConfigMobileCard({exam, ordinal, creator, creation, attemptCount, canDeleteExam = false, canDeleteResults = false}) {
  const id = String(exam?.id ?? '');
  const title = textValue(exam, ['name'], 'Đề thi chưa có tên');
  const mode = textValue(exam, ['chedodethi'], 'Đề công khai');
  const publicMode = mode === 'Đề công khai';
  const unit = publicMode ? 'Không giới hạn (đề công khai)' : textValue(exam, ['target_donvi','targetDonvi','donvi'], 'Tất cả đơn vị');
  const classroom = publicMode ? 'Không giới hạn (đề công khai)' : textValue(exam, ['target_lop','targetLop','lop'], 'Tất cả lớp');
  const duration = numericValue(exam, ['time_limit','timeLimit','time']);
  const detail = asObject(valueOf(exam, ['counts_detail','countsDetail'], {}));
  const access = asObject(valueOf(exam, ['access_control','accessControl'], {}));
  const total = countOf(exam, ['count_41','count41']) +
    countOf(exam, ['count_tf4','countTF4']) +
    countOf(exam, ['count_sq','countSQ']) +
    countOf(exam, ['count_tl','countTL']);
  const types = [
    {name: 'Trắc nghiệm [4-1]', short: '4-1', fields: ['count_41','count41'], key: '41'},
    {name: 'Đúng/Sai [TF4]', short: 'TF4', fields: ['count_tf4','countTF4'], key: 'TF4'},
    {name: 'Trả lời ngắn [SQ]', short: 'SQ', fields: ['count_sq','countSQ'], key: 'SQ'},
    {name: 'Tự luận [TL]', short: 'TL', fields: ['count_tl','countTL'], key: 'TL'}
  ];
  const questionRows = types.map(type => {
    const levels = ['NB','TH','VD'].map(level => detail['count' + type.key + level]);
    const hasLevels = levels.some(n => n !== undefined && n !== null);
    const levelText = hasLevels
      ? ['NB','TH','VD'].map((level, index) => level + ': ' + (Number.isFinite(Number(levels[index])) ? Number(levels[index]) : '—')).join(' · ')
      : 'Chưa có phân bổ NB/TH/VD';
    return '<div class="exam-mobile-count-row"><strong>' + escapeHtml(type.name) +
      '</strong><span class="exam-mobile-count-value">' + countOf(exam,type.fields) +
      ' câu</span><small>' + escapeHtml(levelText) + '</small></div>';
  }).join('');
  const countText = attemptCount === null || attemptCount === undefined
    ? 'Chưa có số liệu' : Number(attemptCount).toLocaleString('vi-VN');
  const created = creation ? creation.hour + ' · ' + creation.date : 'Chưa có thời gian tạo';
  const lessons = asList(valueOf(exam,['selected_lessons','selectedLessons'],[]))
    .map(x => String(x).trim()).filter(Boolean);
  const lessonsText = lessons.length ? lessons.join('; ') : 'Chưa có danh sách bài học';
  const customTf4 = asObject(valueOf(exam, ['tf4_points','tf4Points'], {}));
  const pointsSummary = [
    ['4-1', numericValue(exam,['points_41','points41'])],
    ['TF4', numericValue(exam,['points_tf4','pointsTF4'])],
    ['SQ', numericValue(exam,['points_sq','pointsSQ'])],
    ['TL', numericValue(exam,['points_tl','pointsTL'])]
  ].map(([name,points]) => name + ': ' + points).join(' · ');
  const tf4Scores = ['1','2','3','4'].map(k => k + ' ý: ' +
    (customTf4[k] == null ? '—' : numericValue(customTf4,[k]))).join(' · ');
  const startAt = textValue(exam, ['tg_bd','tgBd'], textValue(access,['startTime'], 'Chưa đặt'));
  const endAt = textValue(exam, ['tg_kt','tgKt'], textValue(access,['endTime'], 'Chưa đặt'));
  const extraTitle = textValue(exam,['tieu_de_bai_thi','tieuDeBaiThi'], '');
  const hasPrompt = textValue(exam,['ai_prompt','aiPrompt'],'');
  const maxAttempts = countOf(exam,['max_attempts','maxAttempts']);
  const warnings = numericValue(exam,['max_cheat_warnings','maxCheatWarnings']);
  const hasTimer = truthy(access.enabled) || startAt !== 'Chưa đặt' || endAt !== 'Chưa đặt';
  const summaryMode = mode === 'Đề cho đơn vị' || mode === 'Đề thi cho đơn vị'
    ? 'exam-mobile-mode unit' : mode === 'Đề có mã bảo mật'
      ? 'exam-mobile-mode protected' : 'exam-mobile-mode public';
  const details = [
    pair('Mã đề đầy đủ',id || '—'),
    pair('Người tạo',creator || '—'),
    pair('Ngày, giờ tạo (Việt Nam)',created),
    pair('Chế độ',mode),
    pair('Trường/Đơn vị áp dụng',unit),
    pair('Lớp áp dụng',classroom),
    pair('Bài học/chuyên đề đã chọn', lessonsText),
    pair('Điểm/câu theo từng loại',pointsSummary),
    pair('Chế độ chấm Đúng/Sai',truthy(valueOf(exam,['tf4_scoring_mode','tf4ScoringMode'],0)) ? 'Điểm theo số ý đúng' : 'Điểm theo cấu hình chung'),
    pair('Điểm theo số ý Đúng/Sai',tf4Scores),
    pair('Lượt làm tối đa',maxAttempts ? String(maxAttempts) + ' lượt' : 'Không giới hạn'),
    pair('Số lần cảnh báo',warnings),
    pair('Bắt đầu nhận bài',startAt),
    pair('Kết thúc nhận bài',endAt),
    setting('Hẹn giờ / hạn truy cập',hasTimer),
    setting('Hiển thị điểm',truthy(valueOf(exam,['show_score','showScore'],0))),
    setting('Hiển thị chi tiết bài làm',truthy(valueOf(exam,['show_details','showDetails'],0))),
    setting('Phản hồi tức thời',truthy(valueOf(exam,['immediate_feedback','immediateFeedback'],0))),
    setting('Chấm tự luận bằng AI',truthy(valueOf(exam,['auto_grade_essay','autoGradeEssay'],0))),
    setting('Chia sẻ kết quả',truthy(valueOf(exam,['is_shared_results','isSharedResults'],0))),
    setting('Trả lời ngắn phân biệt hoa/thường',truthy(valueOf(exam,['sq_case_sensitive','sqCaseSensitive'],0))),
    setting('Trả lời ngắn phân biệt dấu câu',truthy(valueOf(exam,['sq_punctuation_sensitive','sqPunctuationSensitive'],0))),
    setting('Giữ điểm gốc',truthy(valueOf(exam,['keep_raw_score','keepRawScore'],0))),
    pair('Bảo mật đề thi',mode === 'Đề có mã bảo mật' ? 'Yêu cầu nhập mật khẩu' : 'Không yêu cầu mật khẩu')
  ];
  if (extraTitle) details.push(pair('Tiêu đề hiển thị',extraTitle));
  if (hasPrompt) details.push(pair('Hướng dẫn chấm AI',hasPrompt));
  const button = (action,label,className) =>
    '<button type="button" class="exam-mobile-action ' + className + '" data-exam-action="' + action +
    '" data-exam-id="' + escapeHtml(id) + '" data-exam-name="' + escapeHtml(title) + '">' + label + '</button>';
  return [
    '<article class="exam-mobile-card" aria-label="Đề thi ' + escapeHtml(title) + '">',
    '<div class="exam-mobile-card-head"><span class="exam-mobile-sequence">Đề số ' + Number(ordinal) +
      '</span><span class="' + summaryMode + '">' + escapeHtml(mode) + '</span></div>',
    '<h5 class="exam-mobile-title">' + escapeHtml(title) + '</h5>',
    '<p class="exam-mobile-code">Mã đề: <span>' + escapeHtml(id || '—') + '</span></p>',
    '<p class="exam-mobile-creator">Người tạo: <strong>' + escapeHtml(creator || '—') + '</strong></p>',
    '<div class="exam-mobile-metrics"><div><small>Thời gian</small><strong>' + escapeHtml(duration) +
      ' phút</strong></div><div><small>Tổng câu hỏi</small><strong>' + total +
      ' câu</strong></div><div><small>Số bài đã làm</small><strong>' + escapeHtml(countText) + '</strong></div></div>',
    '<dl class="exam-mobile-summary">',
    pair('Ngày, giờ tạo',created),pair('Trường / đơn vị',unit),pair('Lớp áp dụng',classroom),
    '</dl>',
    '<section class="exam-mobile-questions" aria-label="Cấu trúc câu hỏi"><h6>Cấu trúc câu hỏi</h6>' + questionRows + '</section>',
    '<details class="exam-mobile-details"><summary>Xem đầy đủ cấu hình <span aria-hidden="true">⌄</span></summary>',
    '<dl class="exam-mobile-details-grid">' + details.join('') + '</dl></details>',
    '<div class="exam-mobile-actions">',
    button('load','⚙️ Nạp / Sửa','primary'),
    button('export','📄 Xuất Word','secondary'),
    canDeleteResults ? button('delete-results','Xóa KQ','danger-outline') : '',
    canDeleteExam ? button('delete-exam','Xóa đề','danger-outline') : '',
    '</div></article>'
  ].join('');
}
