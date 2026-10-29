// Presentational helper for the teacher/admin exam-result detail modal.
// Markup passed by callers is already rendered with the existing exam math/content renderer.
export function examDetailStudentAnswerColor(isCorrect, isAnswered) {
    if (!isAnswered) return 'text-gray-500';
    return isCorrect ? 'text-green-700' : 'text-red-600';
}

export function renderExamDetailAnswerSummary({
    studentAnswerHtml,
    correctAnswerHtml,
    score,
    studentColor = 'text-gray-800',
}) {
    const numericScore = Number(score);
    const scoreText = Number.isFinite(numericScore) ? numericScore.toFixed(2) : '0.00';

    // Three columns at every breakpoint; the shortened mobile label avoids horizontal scrolling.
    return `
        <div class="exam-detail-answer-summary mt-2 grid grid-cols-3 gap-1.5 sm:gap-2" role="group" aria-label="Đáp án và điểm từng câu">
            <div data-summary-column="student" class="min-w-0 rounded-md border border-gray-200 bg-white/80 px-1.5 py-1.5 sm:p-2">
                <p class="text-[10px] sm:text-xs leading-snug font-semibold text-gray-600"><span class="sm:hidden">Đáp án HS</span><span class="hidden sm:inline">Đáp án của học sinh</span></p>
                <div class="exam-detail-answer mt-0.5 font-bold break-words ${}studentColor}">${}studentAnswerHtml}</div>
            </div>
            <div data-summary-column="correct" class="min-w-0 rounded-md border border-gray-200 bg-white/80 px-1.5 py-1.5 sm:p-2">
                <p class="text-[10px] sm:text-xs leading-snug font-semibold text-gray-600">Đáp án đúng</p>
                <div class="exam-detail-answer mt-0.5 font-bold text-green-700 break-words">${}correctAnswerHtml}</div>
            </div>
            <div data-summary-column="score" class="min-w-0 rounded-md border border-gray-200 bg-white/80 px-1.5 py-1.5 sm:p-2">
                <p class="text-[10px] sm:text-xs leading-snug font-semibold text-gray-600">Điểm đạt được</p>
                <p class="mt-0.5 font-bold text-sm sm:text-base text-blue-700 tabular-nums">${}scoreText}</p>
            </div>
        </div>
    `;
}
