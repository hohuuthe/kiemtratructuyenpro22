import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { examDetailStudentAnswerColor, renderExamDetailAnswerSummary } from '../src/exam-detail-answer-summary.js';

test('correct, incorrect, and unanswered student answers have distinct colors', () => {
    assert.equal(examDetailStudentAnswerColor(true, true), 'text-green-700');
    assert.equal(examDetailStudentAnswerColor(false, true), 'text-red-600');
    assert.equal(examDetailStudentAnswerColor(false, false), 'text-gray-500');
});

test('exam detail places student answer, correct answer and 0.30 score in three columns on every screen', () => {
    const markup = renderExamDetailAnswerSummary({
        studentAnswerHtml: 'B',
        correctAnswerHtml: 'B',
        score: 0.3,
        studentColor: examDetailStudentAnswerColor(true, true),
    });
    assert.match(markup, /grid grid-cols-3/);
    assert.doesNotMatch(markup, /grid-cols-1|sm:grid-cols-3/);
    assert.deepEqual(
        [...markup.matchAll(/data-summary-column="([^"]+)"/g)].map(match => match[1]),
        ['student', 'correct', 'score'],
    );
    assert.match(markup, /Đáp án của học sinh/);
    assert.match(markup, /Đáp án đúng/);
    assert.match(markup, /Điểm đạt được/);
    assert.match(markup, /text-green-700">B<\/div>/);
    assert.match(markup, /text-blue-700 tabular-nums">0\.30<\/p>/);
});

test('answer markup is retained for math and for each TF4 statement', () => {
    const student = '<span class="text-green-700">A: Đ</span>, <span class="text-red-600">B: Đ</span>';
    const markup = renderExamDetailAnswerSummary({
        studentAnswerHtml: student,
        correctAnswerHtml: 'A&C',
        score: 0.25,
    });
    assert.ok(markup.includes(student));
    assert.ok(markup.includes('A&C'));
    assert.ok(markup.includes('0.25'));
    assert.ok(renderExamDetailAnswerSummary({studentAnswerHtml: 'Chưa trả lời',correctAnswerHtml: 'C',score: null,studentColor: examDetailStudentAnswerColor(false,false)}).includes('text-gray-500'));
});

test('review modal uses the shared grid for all three objective question types and preserves essay grading', () => {
    const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const start = source.indexOf('const detailsHtml = examReviewDetails.map(');
    const end = source.indexOf("            }).join('');", start);
    assert.ok(start >= 0 && end > start);
    const review = source.slice(start, end);
    assert.equal((review.match(/renderExamDetailAnswerSummary\(\{/g) || []).length, 3);
    assert.match(review, /const colorClass = isMatch \? 'text-green-700' : 'text-red-600'/);
    assert.match(review, /renderExamReviewMath\(d\.userAnswer\)/);
    assert.match(review, /formatContent\(d\.userAnswer\)/);
    assert.match(review, /id="grade-tl-/);
    assert.match(review, /ai-grade-btn-/);
});
