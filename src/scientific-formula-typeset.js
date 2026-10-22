/**
 * Shared post-render MathJax step for exam, previews and PDF.
 * KaTeX-produced nodes are deliberately tex2jax_ignore; only pending
 * expressions are offered to MathJax, with source retained on failure.
 */
export async function typesetScientificMath(root, mathJax) {
  if (!root || !mathJax) return { rendered: 0, unresolved: 0 };
  if (mathJax.startup && mathJax.startup.promise) {
    await mathJax.startup.promise;
  }
  let rendered = 0;
  let unresolved = 0;
  const nodes = Array.from(root.querySelectorAll('.scientific-mathjax-pending'));
  for (const node of nodes) {
    if (!node.isConnected) continue;
    const source = node.getAttribute('data-scientific-latex') || '';
    const display = node.getAttribute('data-scientific-display') === 'true';
    try {
      if (typeof mathJax.tex2chtmlPromise === 'function') {
        const result = await mathJax.tex2chtmlPromise(source, { display });
        if (result && node.isConnected && !result.querySelector('merror, .mjx-merror, [data-mjx-error]')) {
          // MathJax's CHTML output is already final: never typeset it again.
          result.classList.add('tex2jax_ignore', 'scientific-rendered-math');
          node.replaceWith(result);
          rendered++;
          continue;
        }
      }
    } catch (error) {
      console.warn('[ScientificMath] Unsupported source:', error);
    }
    unresolved++;
    node.classList.remove('scientific-mathjax-pending');
    node.classList.add('scientific-math-unresolved');
    node.title = 'Công thức chưa hỗ trợ hoặc mã nguồn có lỗi; cần kiểm tra LaTeX';
  }
  if (typeof mathJax.typesetPromise === 'function') {
    await mathJax.typesetPromise([root]);
  }
  return { rendered, unresolved };
}
