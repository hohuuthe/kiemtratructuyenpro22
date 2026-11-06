/**
 * Presentation only: renders already scoped /api/results/me records.
 * This module does not fetch data, accepts no caller-selected student ID,
 * and never exposes the stored correctAnswer / teacher grading key.
 */
import {
    getExamReviewText,
    normalizeExamReviewDetails,
    renderExamDetailOptions,
    renderExamReviewMath
} from './exam-detail-formula-renderer.js';

export function escapeStudentText(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function studentResultScore(value) {
    const number = Number(value);
    return value === null || value === undefined || value === '' || !Number.isFinite(number)
        ? null : number;
}

export function studentResultDuration(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const whole = Math.floor(seconds);
    return String(Math.floor(whole / 60)) + ':' + String(whole % 60).padStart(2, '0');
}

export function studentResultPageStats(rows, total) {
    const data = Array.isArray(rows) ? rows : [];
    const scores = data.filter(row => row.can_view_score === true).map(row => studentResultScore(row.score)).filter(score => score !== null);
    const keys = new Set(data.map(row => String(row.exam_id || row.exam_name || '').trim()).filter(Boolean));
    return {
        total: Math.max(0, Number(total) || 0),
        best: scores.length ? Math.max(...scores) : null,
        distinctExams: keys.size
    };
}

function foldStudentSearch(value) {
    return String(value || '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLocaleLowerCase('vi-VN');
}

export function filterStudentResultPage(rows, { query = '', scoreBand = 'all', sort = 'recent' } = {}) {
    const term = foldStudentSearch(String(query).trim());
    const filtered = (Array.isArray(rows) ? rows : []).filter(row => {
        const name = foldStudentSearch(row.exam_name);
        if (term && !name.includes(term)) return false;
        const score = row.can_view_score === true ? studentResultScore(row.score) : null;
        if (scoreBand === 'high' && (score === null || score < 8)) return false;
        if (scoreBand === 'medium' && (score === null || score < 5 || score >= 8)) return false;
        if (scoreBand === 'low' && (score === null || score >= 5)) return false;
        return true;
    });
    const byDate = row => {
        const time = Date.parse(String(row.created_at || ''));
        return Number.isFinite(time) ? time : 0;
    };
    return filtered.sort((a, b) => {
        if (sort === 'score-desc') return (studentResultScore(b.score) ?? -Infinity) - (studentResultScore(a.score) ?? -Infinity) || byDate(b) - byDate(a);
        if (sort === 'score-asc') return (studentResultScore(a.score) ?? Infinity) - (studentResultScore(b.score) ?? Infinity) || byDate(b) - byDate(a);
        if (sort === 'oldest') return byDate(a) - byDate(b);
        return byDate(b) - byDate(a);
    });
}

function percentCorrect(row) {
    const total = Number(row.total_questions);
    const correct = Number(row.correct_count);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(correct)) return 0;
    return Math.min(100, Math.max(0, Math.round(correct / total * 100)));
}

function scoreDisplay(score) {
    return score === null ? '—' : score.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const arrowIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
const calendarIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>';
const clockIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

export function renderStudentResultCards(container, rows, { onOpen, onOpenAttempts, formatDate, formatDuration } = {}) {
    if (!container) return;
    container.replaceChildren();
    const values = Array.isArray(rows) ? rows : [];
    if (!values.length) {
        const empty = document.createElement('div');
        empty.className = 'student-results-empty';
        empty.innerHTML = '<div class="student-results-empty-icon" aria-hidden="true">⌕</div>' +
            '<h3>Không tìm thấy bài làm phù hợp</h3>' +
            '<p>Thử thay đổi từ khóa hoặc bộ lọc của trang hiện tại.</p>';
        container.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    values.forEach(result => {
        const canScore = result.can_view_score === true;
        const canDetail = result.can_view_details === true;
        const score = canScore ? studentResultScore(result.score) : null;
        const date = formatDate ? formatDate(result.created_at) : 'Chưa xác định';
        const time = formatDuration ? formatDuration(result) : studentResultDuration(result.time_taken);
        const total = Math.max(0, Number(result.total_questions) || 0);
        const correct = canScore ? Math.max(0, Number(result.correct_count) || 0) : null;
        const progress = percentCorrect(result);
        const isGrouped = result.is_grouped === true;
        const attemptCount = Math.max(1, Math.floor(Number(result.attempt_count) || 1));
        const card = document.createElement('article');
        card.className = 'student-result-card';
        card.innerHTML =
            '<div class="student-result-card-top">' +
                '<div class="student-result-card-kind"><span class="student-result-kind-icon" aria-hidden="true">✦</span> BÀI KIỂM TRA</div>' +
                '<div class="student-result-score" aria-label="Điểm số: ' + escapeStudentText(scoreDisplay(score)) + '">' +
                    '<strong>' + (canScore ? escapeStudentText(scoreDisplay(score)) : 'Đã ẩn') + '</strong><small>' + (canScore ? 'điểm' : 'theo cấu hình đề thi') + '</small>' +
                '</div>' +
            '</div>' +
            '<h3 class="student-result-card-title">' + escapeStudentText(result.exam_name || 'Bài thi chưa có tên') + '</h3>' +
            (isGrouped ? '<div class="student-result-group-summary"><strong>' + attemptCount + '</strong><span>lượt đã làm · đang hiển thị điểm cao nhất</span></div>' : '') +
            '<div class="student-result-card-meta"><span>' + calendarIcon + escapeStudentText(date) + '</span>' +
                (isGrouped ? '<span>Lần làm gần nhất</span>' : '<span>' + clockIcon + escapeStudentText(time) + '</span>') + '</div>' +
            '<div class="student-result-violation ' + ((Number(result.cheat_warning_count) || 0) > 0 ? 'has-violation' : 'no-violation') + '">' +
                '<span>' + ((Number(result.cheat_warning_count) || 0) > 0 ? '⚠️' : '✓') + ' Vi phạm</span>' +
                '<strong>' + escapeStudentText(Math.max(0, Math.floor(Number(result.cheat_warning_count) || 0))) + ' lần</strong></div>' +
             (canScore ? '<div class="student-result-progress">' +
                '<div class="student-result-progress-label"><span>Câu trả lời đúng</span><strong>' +
                escapeStudentText(correct) + '/' + escapeStudentText(total) + '</strong></div>' +
                '<div class="student-result-progress-track" role="progressbar" aria-label="Tỉ lệ câu đúng" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + progress + '">' +
                    '<span style="width:' + progress + '%"></span></div>' +
            '</div>' : '') +
            '<div class="student-result-actions">' +
                (result.exam_id ? '<button type="button" class="student-result-attempts" aria-label="Xem các lần làm của ' +
                    escapeStudentText(result.exam_name || 'Bài thi') + '"><span>Xem các lần làm</span></button>' : '') +
                (!isGrouped && canDetail ? '<button type="button" class="student-result-open" aria-label="Xem chi tiết bài làm ' +
                    escapeStudentText(result.exam_name || 'Bài thi') + '"><span>Xem chi tiết</span>' + arrowIcon + '</button>' :
                    (!isGrouped && !canDetail ? '<div class="student-result-access-note">Giáo viên chưa cho phép xem chi tiết bài làm.</div>' : '')) +
            '</div>';
        const attemptsButton = card.querySelector('.student-result-attempts');
        if (attemptsButton) attemptsButton.addEventListener('click', async () => {
            if (attemptsButton.disabled) return;
            attemptsButton.disabled = true;
            const label = attemptsButton.querySelector('span');
            if (label) label.textContent = 'Đang tải...';
            try {
                if (typeof onOpenAttempts === 'function') {
                    await onOpenAttempts(String(result.exam_id), String(result.exam_name || 'Bài thi'));
                } else if (typeof window.showStudentAttemptHistory === 'function') {
                    await window.showStudentAttemptHistory(String(result.exam_id), String(result.exam_name || 'Bài thi'));
                } else {
                    window.dispatchEvent(new CustomEvent('student-result-attempts-request', {
                        detail: { examId: String(result.exam_id), examName: String(result.exam_name || 'Bài thi') }
                    }));
                }
            } finally {
                if (label) label.textContent = 'Xem các lần làm';
                attemptsButton.disabled = false;
            }
        });
        const detailButton = card.querySelector('.student-result-open');
        if (detailButton) detailButton.addEventListener('click', async () => {
            if (detailButton.disabled || typeof onOpen !== 'function') return;
            detailButton.disabled = true;
            const label = detailButton.querySelector('span');
            if (label) label.textContent = 'Đang mở...';
            try { await onOpen(String(result.id)); }
            finally {
                if (label) label.textContent = 'Xem chi tiết';
                detailButton.disabled = false;
            }
        });
        fragment.appendChild(card);
    });
    container.appendChild(fragment);
}


export function sortStudentAttemptHistory(rows) {
    const byDate = row => {
        const parsed = Date.parse(String(row && row.created_at || ''));
        return Number.isFinite(parsed) ? parsed : 0;
    };
    return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
        const aScore = a && a.can_view_score === true ? studentResultScore(a.score) : null;
        const bScore = b && b.can_view_score === true ? studentResultScore(b.score) : null;
        const scoreOrder = (bScore ?? -Infinity) - (aScore ?? -Infinity);
        return scoreOrder || byDate(b) - byDate(a) || String(b && b.id || '').localeCompare(String(a && a.id || ''));
    });
}

export function buildStudentAttemptHistoryMarkup(rows, { examName = 'Bài thi', formatDate, formatDuration } = {}) {
    const attempts = sortStudentAttemptHistory(rows);
    const visibleScores = attempts.filter(row => row.can_view_score === true)
        .map(row => studentResultScore(row.score)).filter(score => score !== null);
    const best = visibleScores.length ? Math.max(...visibleScores) : null;
    const formatViolation = value => {
        const count = Math.max(0, Math.floor(Number(value) || 0));
        return count > 0 ? count + ' lần' : 'Không';
    };
    const body = attempts.map((row, index) => {
        const score = row.can_view_score === true ? studentResultScore(row.score) : null;
        const scoreText = row.can_view_score === true ? scoreDisplay(score) : 'Đã ẩn';
        const duration = formatDuration ? formatDuration(row.time_taken) : studentResultDuration(row.time_taken);
        const created = formatDate ? formatDate(row.created_at) : String(row.created_at || 'Chưa xác định');
        const violationCount = Math.max(0, Math.floor(Number(row.cheat_warning_count) || 0));
        return '<tr>' +
            '<td data-label="STT">' + (index + 1) + '</td>' +
            '<td data-label="Tên đề thi" class="student-attempt-name">' + escapeStudentText(row.exam_name || examName) + '</td>' +
            '<td data-label="Điểm"><strong class="student-attempt-score">' + escapeStudentText(scoreText) + '</strong></td>' +
            '<td data-label="Thời gian làm">' + escapeStudentText(duration) + '</td>' +
            '<td data-label="Làm lúc">' + escapeStudentText(created) + '</td>' +
            '<td data-label="Vi phạm"><span class="student-attempt-violation ' + (violationCount > 0 ? 'has-violation' : '') + '">' +
                escapeStudentText(formatViolation(violationCount)) + '</span></td>' +
        '</tr>';
    }).join('');
    return '<section class="student-attempt-history" aria-label="Các lần làm bài của đề thi">' +
        '<header class="student-attempt-history-head">' +
            '<div><span class="student-attempt-overline">LỊCH SỬ LÀM BÀI · CHỈ MÌNH BẠN</span>' +
            '<h2>Các lần làm bài</h2><p>' + escapeStudentText(examName) + '</p></div>' +
            '<div class="student-attempt-summary">' +
                '<div><span>Số lượt</span><strong>' + attempts.length + '</strong></div>' +
                '<div><span>Điểm cao nhất</span><strong>' + (best === null ? 'Đã ẩn' : escapeStudentText(scoreDisplay(best))) + '</strong></div>' +
            '</div>' +
        '</header>' +
        '<div class="student-attempt-table-wrap"><table class="student-attempt-table">' +
            '<thead><tr><th>STT</th><th>Tên đề thi</th><th>Điểm</th><th>Thời gian làm</th><th>Làm lúc</th><th>Vi phạm</th></tr></thead>' +
            '<tbody>' + (body || '<tr><td colspan="6" class="student-attempt-empty">Chưa có lượt làm nào cho đề thi này.</td></tr>') + '</tbody>' +
        '</table></div>' +
        '<footer class="student-attempt-footer"><span>Sắp xếp theo điểm cao nhất; nếu bằng điểm, lần làm mới hơn đứng trước.</span>' +
            '<button type="button" class="student-attempt-close">Đóng</button></footer>' +
    '</section>';
}

function safeStudentImage(source) {
    const value = String(source || '').trim();
    if (!value || value.length > 2_000_000) return '';
    if (/^https?:\/\/[^\s]+$/i.test(value) || /^\/(?!\/)[^\s]*$/.test(value) ||
        /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)) {
        return escapeStudentText(value);
    }
    return '';
}

function studentImageHtml(source, description) {
    const url = safeStudentImage(source);
    if (!url) return '';
    return '<div class="student-detail-image-wrap"><img loading="lazy" src="' + url +
        '" alt="' + escapeStudentText(description) +
        '" data-student-zoom="true" class="student-detail-image" tabindex="0"></div>';
}

function hasStudentAnswer(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.some(hasStudentAnswer);
    if (typeof value === 'object') {
        return Object.values(value).some(hasStudentAnswer);
    }
    return true; // false is a valid choice for true/false questions
}

export function studentAnswerStatus(detail) {
    const question = detail && detail.question || {};
    if (!hasStudentAnswer(detail && detail.userAnswer)) return { key: 'unanswered', label: 'Chưa trả lời' };
    if (question.type === 'TL') return { key: 'recorded', label: 'Bài tự luận' };
    if (detail.isCorrect === true) return { key: 'correct', label: 'Chính xác' };
    if (detail.isCorrect === false) {
        const part = question.type === 'TF4' && Number(detail.score) > 0;
        return { key: 'review', label: part ? 'Đúng một phần' : 'Cần xem lại' };
    }
    return { key: 'recorded', label: 'Đã ghi nhận' };
}

function studentAnswerHtml(detail) {
    const answer = detail && detail.userAnswer;
    const type = detail && detail.question && detail.question.type;
    if (!hasStudentAnswer(answer)) return '<p class="student-detail-no-answer">Học sinh chưa trả lời câu hỏi này.</p>';
    if (type === 'TF4' && answer && typeof answer === 'object' && !Array.isArray(answer)) {
        const chips = ['A', 'B', 'C', 'D'].map(letter => {
            const value = answer[letter] ?? answer[letter.toLowerCase()];
            const truth = value === true || value === 1 || String(value).toLowerCase() === 'true';
            const falsehood = value === false || value === 0 || String(value).toLowerCase() === 'false';
            const text = truth ? 'Đúng' : falsehood ? 'Sai' : '—';
            return '<div class="student-detail-tf-item"><span>Ý ' + letter.toLowerCase() + '</span>' +
                '<strong class="' + (truth ? 'student-detail-tf-true' : falsehood ? 'student-detail-tf-false' : '') + '">' + text + '</strong></div>';
        });
        return '<div class="student-detail-tf-grid">' + chips.join('') + '</div>';
    }
    if (typeof answer === 'object' && !Array.isArray(answer) && answer !== null) {
        const text = getExamReviewText(answer);
        const image = answer.image || answer.imageUrl || answer.image_url || '';
        const textHtml = text ? '<div class="student-detail-richtext">' + renderExamReviewMath(text) + '</div>' : '';
        const imageHtml = studentImageHtml(image, 'Hình ảnh học sinh đã nộp');
        return textHtml + imageHtml || '<p class="student-detail-no-answer">Đã ghi nhận dữ liệu trả lời.</p>';
    }
    if (Array.isArray(answer)) {
        return '<div class="student-detail-richtext">' + escapeStudentText(answer.map(String).join(', ')) + '</div>';
    }
    return '<div class="student-detail-richtext">' + renderExamReviewMath(String(answer)) + '</div>';
}

function labelForQuestionType(type) {
    return { '4-1': 'Trắc nghiệm', TF4: 'Đúng / sai', SQ: 'Trả lời ngắn', TL: 'Tự luận' }[type] || 'Câu hỏi';
}

export function buildStudentResultDetailMarkup(result, { formatDate, formatDuration } = {}) {
    const details = normalizeExamReviewDetails(result && result.details || []);
    const canScore = result && result.can_view_score === true;
    const score = canScore ? studentResultScore(result && result.score) : null;
    const total = Math.max(0, Number(result && result.total_questions) || details.length || 0);
    const correct = canScore ? Math.max(0, Number(result && result.correct_count) || 0) : null;
    const time = formatDuration ? formatDuration(result && result.time_taken) : studentResultDuration(result && result.time_taken);
    const date = formatDate ? formatDate(result && result.created_at) : 'Chưa xác định';
    const counts = { all: details.length, correct: 0, review: 0, unanswered: 0, recorded: 0 };
    const questionHtml = details.map((detail, index) => {
        const q = detail.question || {};
        const status = canScore ? studentAnswerStatus(detail) : (detail.userAnswer == null || detail.userAnswer === '' ? {key:'unanswered',label:'Chưa trả lời'} : {key:'recorded',label:'Đã nộp'});
        counts[status.key]++;
        const questionText = getExamReviewText(q.content);
        const prompt = questionText ?
            renderExamReviewMath(q.content) :
            '<span class="student-detail-unavailable">Bản lưu kết quả không có nội dung câu hỏi.</span>';
        // Only the student's selected option is highlighted; never pass correctAnswer.
        const options = renderExamDetailOptions(q, detail.userAnswer, detail.correctAnswer, 18);
        const correctAnswerHtml = detail.correctAnswer !== undefined && detail.correctAnswer !== null && String(detail.correctAnswer).trim() !== ''
            ? '<div class="student-detail-response"><div class="student-detail-response-label">ĐÁP ÁN ĐÚNG / HƯỚNG DẪN</div><div class="student-detail-richtext">' + renderExamReviewMath(String(detail.correctAnswer)) + '</div></div>' : '';
        const scoreValue = canScore ? studentResultScore(detail.score) : null;
        const savedScore = scoreValue === null ? '' :
            '<span class="student-detail-earned">' + escapeStudentText(scoreDisplay(scoreValue)) + ' điểm</span>';
        const aiFeedback = result && result.student_feedback_scope === 'owned-detail' && q.type === 'TL' && typeof detail.aiFeedback === 'string' ? detail.aiFeedback.trim() : '';
        const aiFeedbackHtml = aiFeedback
            ? '<div class="student-essay-ai-actions">' +
                '<button type="button" class="student-essay-ai-open" data-ai-feedback-open="' + index + '">🤖 Xem chi tiết nhận xét AI</button>' +
                '<div class="student-essay-ai-dialog" data-ai-feedback-dialog="' + index + '" hidden>' +
                    '<div class="student-essay-ai-dialog-card" role="dialog" aria-modal="true" aria-labelledby="student-ai-feedback-title-' + index + '">' +
                        '<header><div><span>AI CHẤM TỰ LUẬN</span><h4 id="student-ai-feedback-title-' + index + '">Nhận xét chi tiết · Câu ' + (index + 1) + '</h4></div>' +
                        '<button type="button" class="student-essay-ai-close" data-ai-feedback-close="' + index + '" aria-label="Đóng nhận xét AI">✕</button></header>' +
                        '<div class="student-essay-ai-dialog-body"><p>' + escapeStudentText(aiFeedback) + '</p></div>' +
                        '<footer><span>Nhận xét được lưu cùng kết quả chấm tự luận của bài làm này.</span>' +
                        '<button type="button" class="student-essay-ai-close" data-ai-feedback-close="' + index + '">Đóng</button></footer>' +
                    '</div></div>' +
              '</div>'
            : '';
        return '<article class="student-detail-question" data-student-status="' + status.key +
            '" id="student-result-question-' + (index + 1) + '">' +
            '<header class="student-detail-question-head">' +
                '<div class="student-detail-question-heading"><span class="student-detail-number">Câu ' + (index + 1) + '</span>' +
                '<span class="student-detail-type">' + escapeStudentText(labelForQuestionType(q.type)) + '</span></div>' +
                '<div class="student-detail-status-group"><span class="student-detail-badge student-detail-badge-' + status.key + '">' +
                    escapeStudentText(status.label) + '</span>' + savedScore + '</div>' +
            '</header>' +
            '<div class="student-detail-question-body"><div class="student-detail-prompt">' + prompt + '</div>' +
                studentImageHtml(q.image, 'Hình minh họa câu ' + (index + 1)) + options +
                '<div class="student-detail-response"><div class="student-detail-response-label">CÂU TRẢ LỜI ĐÃ NỘP</div>' +
                studentAnswerHtml(detail) + '</div>' + correctAnswerHtml + aiFeedbackHtml +
            '</div></article>';
    }).join('');
    const chips = [
        ['all', 'Tất cả', counts.all],
        ['correct', 'Đúng', counts.correct],
        ['review', 'Cần xem lại', counts.review],
        ['unanswered', 'Chưa trả lời', counts.unanswered],
        ['recorded', 'Khác', counts.recorded]
    ].filter(([value]) => canScore || !['correct','review'].includes(value)).map(([value, label, count], i) => {
        return '<button type="button" class="student-detail-filter' + (i === 0 ? ' is-active' : '') +
            '" data-student-filter="' + value + '" aria-pressed="' + (i === 0 ? 'true' : 'false') +
            '">' + label + '<span>' + count + '</span></button>';
    }).join('');
    return '<div class="student-result-detail exam-detail-review" role="region" aria-label="Chi tiết bài làm của tôi">' +
        '<header class="student-detail-hero"><div class="student-detail-hero-visual" aria-hidden="true"></div>' +
            '<span class="student-detail-overline">HỒ SƠ BÀI LÀM · CHỈ MÌNH BẠN</span>' +
            '<h2>Chi tiết bài làm</h2>' +
            '<p class="student-detail-exam-name">' + escapeStudentText(result && result.exam_name || 'Bài thi') + '</p>' +
            '<p class="student-detail-date">' + calendarIcon + escapeStudentText(date) + '</p>' +
        '</header>' +
        '<div class="student-detail-content">' +
            '<section class="student-detail-stat-grid" aria-label="Tổng quan kết quả">' +
                '<div class="student-detail-stat student-detail-stat-score"><span>ĐIỂM BÀI THI</span><strong>' + (canScore ? escapeStudentText(scoreDisplay(score)) : 'Đã ẩn') + '</strong><small>Theo cấu hình đề thi</small></div>' +
                '<div class="student-detail-stat"><span>SỐ CÂU ĐÚNG</span><strong>' + (canScore ? escapeStudentText(correct) : 'Đã ẩn') + '<em> / ' + escapeStudentText(total) + '</em></strong><small>Câu hỏi</small></div>' +
                '<div class="student-detail-stat"><span>THỜI GIAN</span><strong>' + escapeStudentText(time) + '</strong><small>Phút : giây</small></div>' +
            '</section>' +
            '<div class="student-detail-section-head"><div><span class="student-detail-subtitle">BÀI LÀM ĐÃ LƯU</span>' +
                '<h3>Đáp án và nội dung từng câu</h3>' +
                '<p>Các câu trả lời bên dưới được lấy từ bài thi đã nộp.</p></div>' +
                '<div class="student-detail-total">' + details.length + ' câu</div></div>' +
            '<div class="student-detail-toolbar" role="group" aria-label="Lọc câu hỏi theo kết quả">' + chips + '</div>' +
            '<div class="student-detail-question-list">' +
                (questionHtml || '<div class="student-detail-empty">Bài làm này không có dữ liệu chi tiết câu hỏi trong bản lưu.</div>') +
            '</div>' +
            '<p class="student-detail-filter-empty" hidden>Không có câu hỏi nào thuộc nhóm đã chọn.</p>' +
            '<footer class="student-detail-footer"><span>Thông tin chỉ thuộc bài làm của tài khoản hiện tại.</span>' +
                '<button type="button" class="student-detail-close">Đóng chi tiết</button></footer>' +
        '</div></div>';
}

export function bindStudentResultDetail(root, onClose, onImageZoom) {
    if (!root) return;
    const buttons = Array.from(root.querySelectorAll('[data-student-filter]'));
    const questions = Array.from(root.querySelectorAll('[data-student-status]'));
    const empty = root.querySelector('.student-detail-filter-empty');
    buttons.forEach(button => button.addEventListener('click', () => {
        const selected = button.getAttribute('data-student-filter');
        let count = 0;
        buttons.forEach(item => {
            const active = item === button;
            item.classList.toggle('is-active', active);
            item.setAttribute('aria-pressed', String(active));
        });
        questions.forEach(card => {
            const visible = selected === 'all' || card.getAttribute('data-student-status') === selected;
            card.hidden = !visible;
            if (visible) count++;
        });
        if (empty) empty.hidden = count !== 0 || questions.length === 0;
    }));
    root.querySelectorAll('[data-ai-feedback-open]').forEach(button => {
        button.addEventListener('click', () => {
            const index = button.getAttribute('data-ai-feedback-open');
            const dialog = root.querySelector('[data-ai-feedback-dialog="' + index + '"]');
            if (!dialog) return;
            dialog.hidden = false;
            const close = dialog.querySelector('[data-ai-feedback-close]');
            if (close) close.focus();
        });
    });
    root.querySelectorAll('[data-ai-feedback-close]').forEach(button => {
        button.addEventListener('click', () => {
            const index = button.getAttribute('data-ai-feedback-close');
            const dialog = root.querySelector('[data-ai-feedback-dialog="' + index + '"]');
            if (dialog) dialog.hidden = true;
            const opener = root.querySelector('[data-ai-feedback-open="' + index + '"]');
            if (opener) opener.focus();
        });
    });
    const closeButton = root.querySelector('.student-detail-close');
    if (closeButton && typeof onClose === 'function') closeButton.addEventListener('click', onClose);
    root.querySelectorAll('[data-student-zoom]').forEach(image => {
        const zoom = () => {
            if (typeof onImageZoom === 'function') onImageZoom(image.getAttribute('src'));
        };
        image.addEventListener('click', zoom);
        image.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); zoom(); }
        });
    });
}
