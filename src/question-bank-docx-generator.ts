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

function strictRuns(source, description) {
    const text = String(source ?? '');
    for (const part of splitScientificContent(text)) {
        if (part.type !== 'math') continue;
        if (!(makeWordMathRun(part.value) instanceof WordMath)) {
            throw new Error(description + ': công thức không chuyển được thành Equation Word. Vui lòng sửa cú pháp nguồn trước khi xuất: ' + part.value.slice(0, 120));
        }
    }
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
async function richContentRuns(value, description, imageResolver, maxWidth) {
    const text = String(value ?? '');
    const runs = [];
    const imageRe = /<img\b[^>]*>/gi;
    let cursor = 0, match;
    while ((match = imageRe.exec(text)) !== null) {
        if (match.index > cursor) runs.push(...strictRuns(text.slice(cursor, match.index), description));
        const source = htmlImageSource(match[0]);
        if (!source) throw new Error(description + ': thẻ ảnh thiếu đường dẫn.');
        runs.push(await makeImageRun(source, description, imageResolver, maxWidth));
        cursor = match.index + match[0].length;
    }
    if (cursor < text.length) runs.push(...strictRuns(text.slice(cursor), description));
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

function answerText(answer, type) {
    if (answer === null || answer === undefined) return '';
    if (typeof answer === 'object') return JSON.stringify(answer);
    const value = String(answer);
    return type === '4-1' ? value.trim().toUpperCase() : value.trim();
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
        paragraphs.push(new Paragraph({
            children: [
                new TextRun({ text: label + ': ', bold: true }),
                new TextRun({ text: questionTag(q), italics: true, color: '666666' }),
                ...await richContentRuns(q.content, label, resolveImage, 450)
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
                        ...await richContentRuns(content, label + ' / phương án ' + option, resolveImage, 200)
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

        const answer = answerText(q.answer, q.type);
        const answerRuns = strictRuns(answer, label + ' / đáp án');
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
