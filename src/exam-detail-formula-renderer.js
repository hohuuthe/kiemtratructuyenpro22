/**
 * Read-only exam detail presentation. Uses EXACTLY the same scientific engine as
 * formatContent in the student exam, without modifying stored questions/answers.
 */
import { renderScientificContent, sanitizeHtml } from './scientific-formula-engine.ts';

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Student /api/exam/generate applies mapRowRead to JSON-looking database fields,
 * then formatContent extracts content.text for objects. Historical result
 * snapshots hold the original, sometimes JSON-serialized field instead.
 * Decode only explicitly structured text, without modifying any LaTeX source.
 */
export function getExamReviewText(source) {
    if (source === null || source === undefined) return '';
    let value = source;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed !== null && typeof parsed === 'object') value = parsed;
            } catch {
                // Genuine formula text may contain braces; leave it byte-for-byte.
            }
        }
    }
    if (value && typeof value === 'object') {
        const text = value.text;
        // Student formatContent uses text.text for rich question objects.
        return typeof text === 'string' || typeof text === 'number' ? String(text) : '';
    }
    return String(value);
}

/**
 * Read historical result snapshots defensively. Return new display-only
 * objects; never rewrite marks, answer keys or the persisted result.
 */
export function normalizeExamReviewDetails(rawDetails) {
    let entries = rawDetails;
    for (let pass = 0; pass < 2 && typeof entries === 'string'; pass++) {
        try { entries = JSON.parse(entries); } catch { return []; }
    }
    if (!Array.isArray(entries)) return [];
    return entries.map(entry => {
        if (!entry || typeof entry !== 'object') return { question: {}, score: 0 };
        let question = entry.question || {};
        if (typeof question === 'string') {
            try { question = JSON.parse(question); } catch { question = { content: question }; }
        }
        if (!question || typeof question !== 'object' || Array.isArray(question)) question = {};
        const options = decodeObject(question.options);
        const type = String(question.type || '').trim().toLowerCase();
        const normalizedType = (type === 'trac_nghiem' || type === 'mcq' || type === '4-1') ? '4-1'
            : (type === 'tf4' || type === 'dung_sai' || type === 'true_false') ? 'TF4'
            : (type === 'sq' || type === 'tra_loi_ngan' || type === 'short_answer') ? 'SQ'
            : (type === 'tl' || type === 'tu_luan' || type === 'essay') ? 'TL'
            : question.type;
        let userAnswer = entry.userAnswer;
        if (normalizedType === 'TF4' && typeof userAnswer === 'string') {
            const value = decodeObject(userAnswer);
            if (value && typeof value === 'object' && !Array.isArray(value)) userAnswer = value;
        }
        return { ...entry, userAnswer, question: { ...question, type: normalizedType,
            options: options && typeof options === 'object' ? options : {} } };
    });
}

export function renderExamReviewMath(source) {
    // Same engine and source normalization as formatContent in student view.
    return renderScientificContent(getExamReviewText(source));
}


function decodeObject(value) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return value; }
}

function readOptionValue(value) {
    if (value === null || value === undefined) return { text: '', image: '' };
    if (typeof value !== 'object') return { text: String(value), image: '' };
    const text = ['text', 'content', 'value', 'label']
        .map(key => value[key])
        .find(candidate => candidate !== null && candidate !== undefined &&
            (typeof candidate === 'string' || typeof candidate === 'number'));
    const image = ['image', 'img', 'src', 'url', 'picture']
        .map(key => value[key])
        .find(candidate => typeof candidate === 'string' && candidate.trim());
    return { text: text === undefined ? '' : String(text), image: image || '' };
}

/**
 * Resolve option data from objects, arrays or older JSON records. Do not
 * alter the original option, its LaTeX text, its letter or its answer.
 */
export function getExamDetailOption(question, letter) {
    const key = String(letter || '').toUpperCase();
    const index = LETTERS.indexOf(key);
    if (index < 0) return { text: '', image: '' };
    const options = decodeObject(question && question.options) || {};
    let value;
    if (Array.isArray(options)) {
        value = options[index];
    } else if (options && typeof options === 'object') {
        const aliases = [key, key.toLowerCase(), 'opt' + key, 'option' + key,
            'opt_' + key.toLowerCase(), 'option_' + key.toLowerCase()];
        if (Object.prototype.hasOwnProperty.call(options, '0')) {
            aliases.push(String(index));
        } else if (Object.prototype.hasOwnProperty.call(options, '1')) {
            aliases.push(String(index + 1));
        }
        for (const alias of aliases) {
            if (Object.prototype.hasOwnProperty.call(options, alias)) {
                value = options[alias];
                break;
            }
        }
    }
    const option = readOptionValue(value);
    const fallbackImages = decodeObject(question && (question.optionImages || question.option_images || question.images));
    if (!option.image && fallbackImages && typeof fallbackImages === 'object') {
        const image = fallbackImages[key] || fallbackImages[key.toLowerCase()] ||
            (Array.isArray(fallbackImages) ? fallbackImages[index] : '');
        if (typeof image === 'string') option.image = image;
    }
    return option;
}

function safeImageSrc(source) {
    const value = String(source || '').trim();
    // Image URLs only. Never interpolate arbitrary data as an HTML attribute.
    if (!/^(?:https?:\/\/|\/\/|\/(?!\/)|\.\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(value)) return '';
    return sanitizeHtml(value);
}

function fontSize(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 10 && number <= 48 ? number : fallback;
}

export function renderExamDetailQuestion(question, index, questionFontSize = 24) {
    const text = question && question.content !== undefined ? question.content : '';
    const number = Number(index) + 1;
    return '<div class="exam-detail-question responsive-q-text font-bold text-gray-900 leading-relaxed mb-3 min-w-0 break-words" ' +
        'style="--base-q-size:' + fontSize(questionFontSize, 24) + 'px">' +
        '<span class="mr-2 text-blue-600 italic">Câu ' + (Number.isFinite(number) ? number : 1) + ':</span>' +
        (getExamReviewText(text) ? renderExamReviewMath(text) :
            '<span class="text-sm font-normal text-amber-700">Không có nội dung câu hỏi trong bản lưu kết quả.</span>') +
        '</div>';
}

export function renderExamDetailOptions(question, userAnswer, correctAnswer, answerFontSize = 20) {
    if (!question || (question.type !== '4-1' && question.type !== 'TF4')) return '';
    const data = LETTERS.map(letter => ({ letter, ...getExamDetailOption(question, letter) }));
    if (!data.some(option => option.text.trim() || option.image)) {
        return '<div class="exam-detail-options-unavailable text-xs text-amber-700 mb-2">' +
            'Bản lưu kết quả không có nội dung các phương án để hiển thị.</div>';
    }

    // Respect an actual saved option order; otherwise use A-D in source order.
    const savedOrder = decodeObject(question.shuffledOptions || question.shuffled_options);
    const order = Array.isArray(savedOrder) && savedOrder.length === 4 &&
        new Set(savedOrder.map(x => String(x).toUpperCase())).size === 4 &&
        savedOrder.every(x => LETTERS.includes(String(x).toUpperCase()))
        ? savedOrder.map(x => String(x).toUpperCase()) : LETTERS;
    const selected = typeof userAnswer === 'string' ? userAnswer.trim().toUpperCase() : '';
    const correct = typeof correctAnswer === 'string' ? correctAnswer.trim().toUpperCase() : '';
    const correctTF = /^[ABCD](?:\s*[&,;]\s*[ABCD])*$/i.test(correct) ?
        new Set(correct.split(/[&,;]/).map(x => x.trim())) : null;

    const maxLength = Math.max(0, ...data.map(option => option.text.replace(/<[^>]*>/g, '').length));
    const hasImage = data.some(option => option.image);
    const layout = question.type === 'TF4' || hasImage || maxLength > 65
        ? 'grid-cols-1'
        : maxLength > 25 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';

    const items = order.map((letter, i) => {
        const option = data.find(entry => entry.letter === letter);
        const label = LETTERS[i]; // Same displayed lettering convention as the student exam.
        const isMC = question.type === '4-1';
        const chosen = isMC && selected === letter;
        const right = isMC && correct === letter;
        let bgClass = 'border-gray-200 bg-white';
        if (chosen && !right) bgClass = 'border-rose-300 bg-rose-50';
        if (right) bgClass = 'border-emerald-400 bg-emerald-50/60';
        const badges = [];
        if (chosen) badges.push('<span class="text-xs font-bold text-indigo-700">Học sinh chọn</span>');
        if (right) badges.push('<span class="text-xs font-bold text-green-700">Đáp án đúng</span>');
        if (!isMC) {
            const student = userAnswer && typeof userAnswer === 'object' ? userAnswer[letter] : undefined;
            if (student === true || student === false) {
                badges.push('<span class="text-xs font-bold text-blue-700">HS: ' + (student ? 'Đúng' : 'Sai') + '</span>');
            }
            if (correctTF) {
                badges.push('<span class="text-xs font-bold text-green-700">ĐA: ' + (correctTF.has(letter) ? 'Đúng' : 'Sai') + '</span>');
            }
        }
        const image = safeImageSrc(option.image);
        const imageHtml = image
            ? '<div class="mt-2"><img src="' + image + '" alt="Hình phương án ' + sanitizeHtml(label) +
              '" class="max-w-full h-auto max-h-32 object-contain rounded-lg border border-gray-100 cursor-zoom-in" onclick="zoomImage(this.src)"></div>'
            : '';
        return '<div class="exam-detail-option min-w-0 p-3 rounded-xl border-2 ' + bgClass +
            '" data-option-key="' + sanitizeHtml(letter) + '">' +
            '<div class="responsive-a-text min-w-0 break-words leading-relaxed" style="--base-a-size:' +
            fontSize(answerFontSize, 20) + 'px">' +
            '<span class="font-black text-indigo-600 mr-2">' + label + '.</span>' +
            renderExamReviewMath(option.text) + imageHtml + '</div>' +
            (badges.length ? '<div class="flex flex-wrap gap-x-3 gap-y-1 mt-2">' + badges.join('') + '</div>' : '') +
            '</div>';
    });
    return '<div class="exam-detail-options mb-3 grid ' + layout + ' gap-2" aria-label="Các phương án trong bài thi">' +
        items.join('') + '</div>';
}
