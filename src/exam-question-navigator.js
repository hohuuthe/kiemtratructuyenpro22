/**
 * In-exam question navigator. Never change the active application tab:
 * contest exams share the same #exam-interface but are owned by "contest".
 */
export function scrollExamQuestionNavigator(doc) {
  const root = doc?.getElementById?.('exam-interface');
  const nav = doc?.getElementById?.('question-nav');
  if (!root || !nav || root.classList?.contains('hidden') || !root.contains(nav)) return false;

  // Only scroll the question navigator belonging to the active fullscreen
  // exam surface. Do not move DOM nodes or request/exit fullscreen.
  const fullscreen = doc.fullscreenElement;
  if (fullscreen && fullscreen !== root && !fullscreen.contains(root)) return false;

  const panel = nav.parentElement || nav;
  if (typeof panel.scrollIntoView !== 'function') return false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
  return true;
}
