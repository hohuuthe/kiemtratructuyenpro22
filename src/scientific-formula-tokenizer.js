/**
 * Lossless tokenizer for mathematics, chemistry, biology and physics content.
 * Recognizes math delimiters before bare commands so valid TeX never gains nested delimiters.
 * Parsing never mutates the stored question content or guesses malformed expressions.
 * No DOM or third-party package needed; usable from Node's built-in test runner.
 */
function isEscapedAt(source, index) {
  let count = 0;
  for (let j = index - 1; j >= 0 && source[j] === '\\'; j--) count++;
  return (count % 2) === 1;
}
function readBalancedCurly(source, index) {
  if (source[index] !== '{') return -1;
  let depth = 0;
  for (let i = index; i < source.length; i++) {
    if (isEscapedAt(source, i)) continue;
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}
function findMathEnd(source, from, closer, singleLine = false) {
  for (let i = from; i <= source.length - closer.length; i++) {
    if (singleLine && (source[i] === '\n' || source[i] === '\r')) return -1;
    if (source.startsWith(closer, i) && !isEscapedAt(source, i)) return i;
  }
  return -1;
}
function readRawLatexCommand(source, pos) {
  const m = /^\\(frac|dfrac|tfrac|cfrac|binom|dbinom|tbinom|sqrt|vec|overrightarrow|overleftarrow|overline|underline|widehat|widetilde|hat|bar|tilde|ce|pu|mathrm|mathbf|mathbb|mathcal|text|alpha|beta|gamma|delta|epsilon|varepsilon|theta|vartheta|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Pi|Sigma|Phi|Psi|Omega|infty|partial|nabla|sum|prod|int|iint|iiint|oint|lim|sin|cos|tan|cot|log|ln|times|cdot|pm|leq|geq|neq|approx|to|rightarrow|leftarrow|rightleftharpoons)(?![A-Za-zÀ-ỹ])/u.exec(source.slice(pos));
  if (!m) return -1;
  const name = m[1];
  let end = pos + m[0].length;
  if (name === 'sqrt' && source[end] === '[') {
    const close = source.indexOf(']', end + 1);
    if (close !== -1) end = close + 1;
  }
  const count = /^(frac|dfrac|tfrac|cfrac|binom|dbinom|tbinom)$/.test(name) ? 2 : /^(sqrt|vec|overrightarrow|overleftarrow|overline|underline|widehat|widetilde|hat|bar|tilde|ce|pu|mathrm|mathbf|mathbb|mathcal|text)$/.test(name) ? 1 : 0;
  for (let n = 0; n < count; n++) {
    while (source[end] === ' ') end++;
    if (source[end] !== '{') return n === 0 ? -1 : end;
    const closing = readBalancedCurly(source, end);
    if (closing === -1) return -1;
    end = closing;
  }
  return end;
}
function isCurrencyStart(source, index) {
  if (source[index] !== '$') return false;
  const rest = source.slice(index + 1);
  const m = /^(\d+(?:[.,]\d{1,2})?)(?=$|[\s,.;!?)])/u.exec(rest);
  return !!m && rest[m[1].length] !== '$';
}
function looksLikeStandaloneMath(text) {
  const t = text.trim();
  return t.length > 2 &&
    /[=^_≤≥≠≈∑∫√±×÷]/u.test(t) &&
    /^[\dA-Za-z\s{}()[\],.;+\-*/^_=<>|!\\%∞√∑∫πΔμΩ±×÷→←⇌]+$/u.test(t) &&
    !/(?:^|\s)(?:and|the|with|find|calculate|choose|where)(?:\s|$)/i.test(t);
}
export function splitScientificContent(sourceInput) {
  const source = String(sourceInput ?? '');
  const segments = [];
  let text = '';
  const pushText = () => { if (text) segments.push({ type: 'text', value: text }); text = ''; };
  const pushMath = (body, display) => {
    pushText();
    segments.push({ type: 'math', value: body, display: !!display });
  };
  let i = 0;
  while (i < source.length) {
    if (source[i] === '\\' && source[i+1] === '$' && !isEscapedAt(source,i)) {
      text += '$';
      i += 2;
      continue;
    }
    if (source[i] === '`' && !isEscapedAt(source,i)) {
      const count = source.startsWith('```',i) ? 3 : 1;
      const close = source.indexOf('`'.repeat(count),i+count);
      if (close !== -1) {
        text += source.slice(i,close+count);
        i=close+count;
        continue;
      }
    }
    if (source[i] === '$' && !isEscapedAt(source,i) && !isCurrencyStart(source,i)) {
      const display = source.startsWith('$$',i);
      const mark = display ? '$$' : '$';
      const end = findMathEnd(source,i+mark.length,mark,!display);
      if (end > i+mark.length && source.slice(i+mark.length,end).trim()) {
        pushMath(source.slice(i+mark.length,end),display);
        i=end+mark.length;
        continue;
      }
    }
    if (source[i] === '\\' && !isEscapedAt(source,i)) {
      const delims = [['\\(','\\)',false],['\\[','\\]',true]];
      let did = false;
      for (const [open,close,display] of delims) {
        if (!source.startsWith(open,i)) continue;
        const end=findMathEnd(source,i+open.length,close,false);
        if (end !== -1 && source.slice(i+open.length,end).trim()) {
          pushMath(source.slice(i+open.length,end),display);
          i=end+close.length;
          did=true;
        }
        break;
      }
      if (did) continue;
      const begin=/^\\begin\{(cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|aligned|alignedat|align\*?|alignat\*?|gather\*?|equation\*?|array|smallmatrix)\}/.exec(source.slice(i));
      if (begin) {
        const close='\\end{'+begin[1]+'}';
        const end=source.indexOf(close,i+begin[0].length);
        if (end!==-1) {
          let extra='';
          if ((begin[1]==='array'||begin[1].startsWith('alignat')) && source[i+begin[0].length]==='{') {
            const b=readBalancedCurly(source,i+begin[0].length);
            if(b!==-1)extra=source.slice(i+begin[0].length,b);
          }
          const content=source.slice(i,end+close.length);
          pushMath(content,true);
          i=end+close.length;
          continue;
        }
      }
      const cmdEnd=readRawLatexCommand(source,i);
      if(cmdEnd>i){
        let end=cmdEnd;
        // Join adjacent unambiguous operators and operands without swallowing prose.
        while(true) {
          const between=/^(\s*(?:[+\-*/=<>]|\^|_)\s*)/.exec(source.slice(end));
          if (!between) break;
          const p=end+between[0].length;
          let next=readRawLatexCommand(source,p);
          if(next===-1){
            const atom=/^(?:\{[^{}]+\}|[A-Za-z0-9](?:[A-Za-z0-9]*)?)/.exec(source.slice(p));
            if(atom)next=p+atom[0].length;
          }
          if(next===-1 || next===p)break;
          end=next;
        }
        pushMath(source.slice(i,end),false);
        i=end;
        continue;
      }
    }
    text += source[i];
    i++;
  }
  pushText();
  if (segments.length === 1 && segments[0].type === 'text' && looksLikeStandaloneMath(segments[0].value)) {
    return [{type:'math',value:segments[0].value.trim(),display:false}];
  }
  return segments;
}
