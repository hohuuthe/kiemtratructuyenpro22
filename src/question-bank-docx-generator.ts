/**
 * Question Bank -> native editable Word export.
 * Shares the exact scientific Word equation parser used by exam DOCX export.
 * Input order is the validated order from question-bank-word-selection.js.
 * Never silently omit selected questions, images or unsupported math.
 */
import { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType } from 'docx';
import { Math as WordMath } from 'docx/math';
import { extractOptionsABCD, parseFormattedText, makeWordMathRun } from './exam-docx-generator.ts';
import { splitScientificContent } from './scientific-formula-tokenizer.js';


const TWO_ARGUMENT_WORD_COMMAND = /\\(?:dfrac|tfrac|cfrac|frac|binom|dbinom|tbinom)(?![A-Za-z])/g;

/** Balanced TeX arguments. Escaped braces don't affect nesting. */
function readBracedWordArgumentEnd(source, opening) {
    if (source[opening] !== '{') return -1;
    let depth = 0;
    for (let i = opening; i < source.length; i++) {
        if (source[i] === '\\') { i++; continue; }
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return i + 1;
    }
    return -1;
}

/**
 * Some Word imports wrap a fraction numerator and its denominator in separate
 * inline HTML spans. Join ONLY formatting tags between two TeX groups.
 * All mathematical characters are preserved, without inventing denominators.
 */
export function joinFormattedFractionArguments(sourceInput) {
    let text = String(sourceInput ?? '');
    const fractions = new RegExp(TWO_ARGUMENT_WORD_COMMAND.source, 'g');
    for (let match; (match = fractions.exec(text)); ) {
        let first = fractions.lastIndex;
        while (/\s/.test(text[first] || '') && first < text.length) first++;
        const endOfNumerator = readBracedWordArgumentEnd(text, first);
        if (endOfNumerator === -1) continue;

        let cursor = endOfNumerator;
        let hasMarkup = false;
        for (;;) {
            while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
            const tag = /^<\/?(?:span|b|strong|i|em|u|font)\b[^>]*>/i.exec(text.slice(cursor));
            if (!tag) break;
            hasMarkup = true;
            cursor += tag[0].length;
        }
        if (hasMarkup && text[cursor] === '{') {
            // Only presentation markup is removed, not the TeX numerator or
            // denominator; this is intentionally Word-only, not a DB rewrite.
            text = text.slice(0, endOfNumerator) + text.slice(cursor);
            fractions.lastIndex = match.index + match[0].length;
        }
    }
    return text;
}

/**
 * Identify TeX fractions with a missing numerator/denominator. Do not guess
 * what the omitted operand was (even when a typical derivative suggests h).
 */
export function findIncompleteWordFractions(sourceInput) {
    const source = String(sourceInput ?? '');
    const found = [];
    const fractions = new RegExp(TWO_ARGUMENT_WORD_COMMAND.source, 'g');
    for (let match; (match = fractions.exec(source)); ) {
        let next = fractions.lastIndex;
        let complete = true;
        for (let index = 0; index < 2; index++) {
            while (next < source.length && /\s/.test(source[next])) next++;
            const end = readBracedWordArgumentEnd(source, next);
            if (end === -1) { complete = false; break; }
            next = end;
        }
        if (!complete) {
            found.push(source.slice(match.index, Math.min(source.length, Math.max(next, match.index + 16) + 110)));
        }
    }
    return found;
}

function strictRuns(source, description, onFormulaWarning) {
    const text = joinFormattedFractionArguments(source);
    const report = (raw, reason) => onFormulaWarning?.({
        location: description,
        source: String(raw),
        reason
    });
    // Even when the generic tokenizer treats an incomplete bare command as
    // text, report it so the teacher can repair the source in the editor.
    const incomplete = findIncompleteWordFractions(text);
    for (const expression of incomplete) {
        report(expression, 'Công thức LaTeX thiếu tử số hoặc mẫu số');
    }
    for (const part of splitScientificContent(text)) {
        if (part.type !== 'math') continue;
        if (!(makeWordMathRun(part.value) instanceof WordMath)) {
            if (!incomplete.some(expression => expression.includes(part.value) || part.value.includes(expression))) {
                report(part.value, 'Không thể tạo Equation Word từ LaTeX nguồn');
            }
        }
    }
    // All selected questions must still be exported. Unconvertible source
    // remains visibly editable literal text, never a guessed equation/image.
    const runs = parseFormattedText(text);
    if (!Array.isArray(runs)) throw new Error(description + ': không đọc được nội dung câu hỏi.');
    return runs;
}

function htmlDecodeAttribute(value) {
    return String(value ?? '')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&#x27;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

function htmlImageSource(tag) {
    const match = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    return match ? htmlDecodeAttribute(match[1] ?? match[2] ?? match[3]) : '';
}

/** Recognize inline HTML images without discarding adjacent text/math. */
async function richContentRuns(value, description, imageResolver, maxWidth, onFormulaWarning) {
    const text = joinFormattedFractionArguments(value);
    const runs = [];
    const imageRe = /<img\b[^>]*>/gi;
    let cursor = 0, match;
    while ((match = imageRe.exec(text)) !== null) {
        if (match.index > cursor) runs.push(...strictRuns(text.slice(cursor, match.index), description, onFormulaWarning));
        const source = htmlImageSource(match[0]);
        if (!source) throw new Error(description + ': thẻ ảnh thiếu đường dẫn.');
        runs.push(await makeImageRun(source, description, imageResolver, maxWidth));
        cursor = match.index + match[0].length;
    }
    if (cursor < text.length) runs.push(...strictRuns(text.slice(cursor), description, onFormulaWarning));
    return runs.length ? runs : [new TextRun({ text: '' })];
}

async function makeImageRun(source, description, imageResolver, maxWidth) {
    if (!imageResolver) throw new Error(description + ': không có bộ tải ảnh cho file Word.');
    const resolved = await imageResolver(source, description);
    if (!resolved?.data || !resolved.data.length) {
        throw new Error(description + ': không tải được ảnh. Không thể xuất file thiếu nội dung.');
    }
    const rawWidth = Number(resolved.width);
    const rawHeight = Number(resolved.height);
    const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 300;
    const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 200;
    const scale = Math.min(1, maxWidth / width);
    return new ImageRun({
        data: resolved.data,
        transformation: {
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale))
        }
    });
}

/**
 * Decode only letter-based choice keys; do not strip meaningful brackets from
 * mathematical short answers (e.g. [0;1]) or chemistry ([Cu(NH3)4]).
 * Supports legacy "[B&D]", JSON '["B","D"]' and real string arrays.
 */
function choiceKeyText(raw) {
    if (Array.isArray(raw)) {
        if (!raw.length || !raw.every(item => typeof item === 'string')) return null;
        const keys = raw.map(item => choiceKeyText(item));
        return keys.every(Boolean) ? keys.join('&') : null;
    }
    if (typeof raw !== 'string') return null;
    const source = raw.trim();
    if (!source) return null;
    if (source.startsWith('[') && source.endsWith(']')) {
        try {
            const parsed = JSON.parse(source);
            if (Array.isArray(parsed)) return choiceKeyText(parsed);
        } catch { /* Legacy unquoted [B&D] format, handled below. */ }
    }
    const value = (source.startsWith('[') && source.endsWith(']'))
        ? source.slice(1, -1) : source;
    // Quotes are only presentation remnants of an array of letter keys.
    const compact = value.replace(/["']/g, '').replace(/\s+/g, '');
    if (!/^[A-D](?:[&,;/|+][A-D]){0,3}$/i.test(compact)) return null;
    return compact.toUpperCase().replace(/[&,;/|+]/g, '&');
}

/** Word-only answer presentation; original question and grading data stay intact. */
export function formatQuestionBankAnswerForWord(answer, type) {
    if (answer === null || answer === undefined) return '';
    if (type === '4-1' || type === 'TF4') {
        const key = choiceKeyText(answer);
        if (key !== null) return key;

        // Some historical true/false questions save a boolean map rather than
        // the usual canonical "A&C" key. Display true statements explicitly.
        if (type === 'TF4' && answer && typeof answer === 'object' && !Array.isArray(answer)) {
            const labels = ['A', 'B', 'C', 'D'];
            if (Object.keys(answer).length === 4 &&
                labels.every(label => typeof answer[label] === 'boolean')) {
                return labels.filter(label => answer[label]).join('&') || 'Không có';
            }
        }
        if (type === 'TF4' && Array.isArray(answer) && answer.length === 4 &&
            answer.every(item => typeof item === 'boolean')) {
            return ['A', 'B', 'C', 'D'].filter((_label, i) => answer[i]).join('&') || 'Không có';
        }

        // Legacy four-character true/false grading sequence inside brackets.
        if (type === 'TF4' && typeof answer === 'string') {
            const match = /^\[\s*([ĐDS]{4})\s*\]$/i.exec(answer.trim());
            if (match) return match[1].toUpperCase();
        }
    }

    const text = (typeof answer === 'object' ? JSON.stringify(answer) : String(answer)).trim();
    return type === '4-1' ? text.toUpperCase() : text;
}

function questionTag(q) {
    const lesson = String(q.lesson ?? '').trim();
    const level = String(q.level ?? 'NB').trim() || 'NB';
    const type = String(q.type ?? '').trim();
    return lesson ? '[' + lesson + '][' + level + '][' + type + '] ' : '[' + level + '][' + type + '] ';
}

/**
 * Return a real DOCX Blob. The function throws before success notification
 * if even one selected question or mandatory image cannot be included.
 */
export async function generateQuestionBankDocx(plan, options = {}) {
    const questions = plan?.questions;
    if (!Array.isArray(questions) || !questions.length) throw new Error('Chưa chọn câu hỏi để xuất Word.');
    if (!Number.isSafeInteger(plan.totalSelected) || plan.totalSelected !== questions.length ||
        !Number.isSafeInteger(plan.requestedCount) || plan.requestedCount !== questions.length) {
        throw new Error('Số câu hiển thị và số câu thực xuất Word không khớp.');
    }
    if (!Array.isArray(plan.ids) || plan.ids.length !== questions.length ||
        plan.ids.some((id, i) => String(id) !== String(questions[i]?.id))) {
        throw new Error('Danh sách ID câu hỏi được chọn không khớp với dữ liệu Word.');
    }
    if (new Set(plan.ids.map(String)).size !== questions.length) {
        throw new Error('Danh sách xuất Word có câu hỏi trùng ID.');
    }
    const resolveImage = options.resolveImage;
    const warningKeys = new Set();
    const warnFormula = (issue) => {
        const key = issue.location + '|' + issue.source;
        if (warningKeys.has(key)) return;
        warningKeys.add(key);
        if (typeof options.onFormulaWarning === 'function') options.onFormulaWarning(issue);
    };
    const paragraphs = [
        new Paragraph({
            children: [new TextRun({ text: 'NGÂN HÀNG CÂU HỎI', bold: true, size: 32 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 }
        }),
        new Paragraph({
            children: [new TextRun({
                text: 'Tổng số: ' + questions.length + ' câu hỏi  |  ' + plan.selectedLessons + ' bài học',
                size: 22, italics: true
            })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 260 }
        })
    ];

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const label = 'Câu ' + (i + 1);
        const detailLabel = label + ' (ID ' + String(q.id ?? '?') + ')';
        paragraphs.push(new Paragraph({
            children: [
                new TextRun({ text: label + ': ', bold: true }),
                new TextRun({ text: questionTag(q), italics: true, color: '666666' }),
                ...await richContentRuns(q.content, detailLabel, resolveImage, 450, warnFormula)
            ],
            spacing: { before: 180, after: 60 }
        }));
        if (q.image) {
            paragraphs.push(new Paragraph({
                children: [await makeImageRun(q.image, label + ' / ảnh câu hỏi', resolveImage, 450)],
                spacing: { before: 40, after: 60 }
            }));
        }

        if (q.type === '4-1' || q.type === 'TF4') {
            const opts = extractOptionsABCD(q.options, q);
            for (const option of ['A', 'B', 'C', 'D']) {
                const content = opts['opt' + option] || '';
                const picture = opts['img' + option];
                // Keep an explicitly empty option if it is present in source.
                const rawOpts = typeof q.options === 'string'
                    ? (() => { try { return JSON.parse(q.options); } catch { return {}; } })()
                    : q.options;
                const found = Array.isArray(rawOpts)
                    ? rawOpts['ABCD'.indexOf(option)] !== undefined
                    : rawOpts && Object.keys(rawOpts).some(k =>
                        k.toLowerCase() === option.toLowerCase() ||
                        k.toLowerCase() === 'opt' + option.toLowerCase() ||
                        k.toLowerCase() === 'option' + option.toLowerCase());
                if (!found && !content && !picture) continue;
                paragraphs.push(new Paragraph({
                    children: [
                        new TextRun({ text: option + '. ', bold: true }),
                        ...await richContentRuns(content, detailLabel + ' / phương án ' + option, resolveImage, 200, warnFormula)
                    ],
                    spacing: { before: 20, after: 20 }
                }));
                if (picture) {
                    paragraphs.push(new Paragraph({
                        children: [await makeImageRun(picture, label + ' / ảnh phương án ' + option, resolveImage, 200)],
                        spacing: { before: 20, after: 40 }
                    }));
                }
            }
        }

        const answer = formatQuestionBankAnswerForWord(q.answer, q.type);
        const answerRuns = strictRuns(answer, detailLabel + ' / đáp án', warnFormula);
        paragraphs.push(new Paragraph({
            children: [
                new TextRun({ text: 'Đáp án: ', bold: true, color: 'FF0000' }),
                // For plain answers keep the familiar red style; equations
                // remain native editable Word Math, not a flattened image.
                ...(answerRuns.some(run => run instanceof WordMath)
                    ? answerRuns
                    : [new TextRun({ text: answer, bold: true, color: 'FF0000' })])
            ],
            spacing: { before: 40, after: 180 }
        }));
    }

    const doc = new Document({
        styles: { default: {
            document: {
                run: { font: 'Times New Roman', size: 26 },
                paragraph: { spacing: { line: 240, lineRule: 'auto' } }
            }
        }},
        sections: [{ properties: { page: {
            margin: { top: 1134, bottom: 1134, left: 1134, right: 851 }
        }}, children: paragraphs }]
    });
    return Packer.toBlob(doc);
}
