/**
 * Teacher/editor previews using exactly the renderer and MathJax fallback
 * used for student exam questions. No writes to input or the database.
 */
export function isScientificEditorField(field) {
  if (!field || !field.id || !['INPUT', 'TEXTAREA'].includes(field.tagName)) return false;
  if (field.type && field.type !== 'text' && field.type !== 'textarea') return false;
  return /^(?:new-q|edit-q|edit-pending|edit-ai)-(?:content|answer|opt-[A-D])$/.test(field.id);
}
export function attachScientificEditorPreviews(root, renderContent, typesetRoot) {
  if (!root || typeof renderContent !== 'function') return;
  const create = (field) => {
    if (!isScientificEditorField(field) || !field.isConnected) return null;
    const anchor = field.tagName === 'INPUT' && field.parentElement?.classList.contains('flex')
      ? field.parentElement : field;
    const sibling = anchor.nextElementSibling;
    if (sibling && sibling.classList.contains('scientific-editor-preview')) return sibling;
    const wrapper = field.ownerDocument.createElement('div');
    wrapper.className = 'scientific-editor-preview';
    wrapper.setAttribute('role', 'status');
    wrapper.setAttribute('aria-live', 'off');
    const heading = field.ownerDocument.createElement('div');
    heading.className = 'scientific-editor-preview-title';
    heading.textContent = 'Xem trước công thức và nội dung';
    const body = field.ownerDocument.createElement('div');
    body.className = 'scientific-editor-preview-body';
    wrapper.append(heading, body);
    anchor.insertAdjacentElement('afterend', wrapper);
    return wrapper;
  };
  const refresh = (field) => {
    const wrapper = create(field);
    if (!wrapper) return;
    const body = wrapper.lastElementChild;
    const value = String(field.value ?? '');
    // Prevent creating MathJax jobs against stale nodes during fast typing.
    body.innerHTML = value.trim()
      ? renderContent(value)
      : '<span class="scientific-editor-preview-empty">Nội dung xem trước xuất hiện tại đây.</span>';
    if (value.trim() && body.querySelector('.scientific-mathjax-pending') && typeof typesetRoot === 'function') typesetRoot(body);
  };
  for (const field of root.querySelectorAll('input[id], textarea[id]')) {
    if (isScientificEditorField(field)) refresh(field);
  }
  if (root.__scientificPreviewListening) return;
  root.__scientificPreviewListening = true;
  root.addEventListener('input', (event) => {
    const field = event.target;
    if (!isScientificEditorField(field)) return;
    clearTimeout(field.__scientificPreviewTimer);
    field.__scientificPreviewTimer = setTimeout(() => {
      if (field.isConnected) refresh(field);
    }, 120);
  });
  root.addEventListener('focusin', (event) => {
    if (isScientificEditorField(event.target)) refresh(event.target);
  });
}
