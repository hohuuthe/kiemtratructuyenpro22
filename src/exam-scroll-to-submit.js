/**
 * Cuộn tới nút Nộp bài mà không thay đổi câu hiện tại, đáp án hay trạng thái thi.
 * The submit action remains exclusively behind the original submit button.
 */
export function scrollExamSubmitIntoView(examRoot) {
  if (!examRoot || examRoot.classList?.contains('hidden')) return false;
  const submitButton = examRoot.querySelector?.('#exam-submit-button');
  if (!submitButton || typeof submitButton.scrollIntoView !== 'function') return false;
  submitButton.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  return true;
}
