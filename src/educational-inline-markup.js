/**
 * Shared read-only classification of inline HTML-looking text in assessment
 * questions. HTML examples must remain literal; only unambiguous legacy
 * inline formatting pairs are converted into display tokens.
 *
 * This parser never evaluates source HTML or modifies stored questions.
 * It is used by both the browser/PDF renderer and editable DOCX exporter.
 */
const STYLE_NAMES = new Set(['sup', 'sub', 'b', 'strong', 'i', 'em', 'u', 'mark']);
const STYLE_TAG = /<\/?(?:sup|sub|b|strong|i|em|u|mark)>/gi;
const CODE_SPAN = /(?:\x60{3}[\s\S]*?\x60{3}|\x60[^\x60\n]+\x60)/g;
const TEACHING_CONTEXT = /(?:\b(?:html|css|javascript|tag|element)\b|thẻ|cú pháp|mã nguồn|đoạn mã|cặp thẻ|phần tử)/iu;

/** Decode only encoded tag-shaped entities, then re-escape at the sink. */
export function normalizeEducationalTagEntities(source) {
  return String(source ?? '').replace(/&lt;(\/?[a-z][\w-]*(?:\s+[^<>]{0,120})?)&gt;/gi, (_full, contents) => '<' + contents + '>');
}

/**
 * Tokens: text, code, open, close. Unknown/unsafe HTML and <br/> stay literal.
 * Code spans remain opaque even when they contain a matched formatting pair.
 */
export function tokenizeEducationalInlineMarkup(sourceInput) {
  const source = normalizeEducationalTagEntities(sourceInput);
  const out = [];
  const add = (type, value, name) => {
    if (type === 'text') {
      if (!value) return;
      const prev = out[out.length - 1];
      if (prev?.type === 'text') { prev.value += value; return; }
    }
    out.push({ type, value, ...(name ? { name } : {}) });
  };
  const appendPlain = part => {
    if (!part) return;
    const teaching = TEACHING_CONTEXT.test(part);
    const pairedTags = new Map();
    const stack = [];
    STYLE_TAG.lastIndex = 0;
    for (const match of part.matchAll(STYLE_TAG)) {
      const name = match[0].replace(/[</>]/g, '').toLowerCase();
      if (!STYLE_NAMES.has(name)) continue;
      if (!match[0].startsWith('</')) {
        stack.push({ name, start: match.index, value: match[0] });
        continue;
      }
      const top = stack[stack.length - 1];
      if (!top || top.name !== name) continue; // malformed nesting remains literal
      stack.pop();
      const predecessor = top.start ? part[top.start - 1] : '';
      // H<sub>2</sub>O, x<sup>2</sup> and other formatted formulas survive
      // even if their prose also contains "HTML" or "phần tử".
      const chemistryOrMath = (name === 'sub' || name === 'sup') && /[\p{L}\p{N}]/u.test(predecessor);
      if (!teaching || chemistryOrMath) {
        pairedTags.set(top.start, { type: 'open', name, value: top.value });
        pairedTags.set(match.index, { type: 'close', name, value: match[0] });
      }
    }
    const selected = [...pairedTags.entries()].sort((a, b) => a[0] - b[0]);
    let previous = 0;
    // Assessment question/answer text is source code when it contains HTML
    // examples. There is no reliable way to distinguish an authored <br/>
    // from a code-example <br/> by surrounding words, punctuation, or casing.
    // NEVER transform such tags into layout instructions: preserve the exact
    // characters and escape them at each renderer. Actual newline characters
    // are still rendered as line breaks by the scientific/Word pipelines.
    const appendLiteralText = text => add('text', text);
    for (const [index, token] of selected) {
      appendLiteralText(part.slice(previous, index));
      add(token.type, token.value, token.name);
      previous = index + token.value.length;
    }
    appendLiteralText(part.slice(previous));
  };
  let previous = 0;
  for (const match of source.matchAll(CODE_SPAN)) {
    appendPlain(source.slice(previous, match.index));
    const marker = match[0].startsWith('\x60\x60\x60') ? 3 : 1;
    add('code', match[0].slice(marker, -marker));
    previous = match.index + match[0].length;
  }
  appendPlain(source.slice(previous));
  return out;
}
