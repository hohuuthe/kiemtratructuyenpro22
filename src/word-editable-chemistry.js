/**
 * Native, editable Office Math (OMML) for mhchem chemistry.
 *
 * The student UI supports \ce / \pu via MathJax. The docx latexToMath parser
 * does NOT recognize mhchem; exporting its source as TextRun leaves literal
 * LaTeX in Word. Build chemistry with native MathRun and script components.
 *
 * No images, HTML, external resources or changes to saved exam questions.
 */
import {
    Math as WordMath, MathRun, MathSubScript, MathSuperScript,
    MathSubSuperScript, MathPreSubSuperScript, MathLimitUpper, MathLimitLower,
} from 'docx/math';

/** Return the contents of a balanced brace or bracket block, or null. */
function balanced(input, from, opener = '{', closer = '}') {
    if (input[from] !== opener) return null;
    let depth = 0;
    for (let pos = from; pos < input.length; pos++) {
        if (input[pos] === '\\') { pos++; continue; }
        if (input[pos] === opener) depth++;
        else if (input[pos] === closer) {
            depth--;
            if (depth === 0) return { inner: input.slice(from + 1, pos), end: pos + 1 };
        }
    }
    return null;
}

const greek = {
    Delta: 'Δ', delta: 'δ', nu: 'ν', alpha: 'α', beta: 'β', gamma: 'γ',
    theta: 'θ', lambda: 'λ', mu: 'μ', phi: 'φ', pi: 'π',
    cdot: '·', times: '×', circ: '°',
};
const mark = (text) => new MathRun({ text: String(text), style: 'plain' });
const script = (text) => [mark(text)];

function withScripts(children, sub, sup) {
    if (sub !== null && sup !== null) {
        return new MathSubSuperScript({ children, subScript: script(sub), superScript: script(sup) });
    }
    if (sub !== null) return new MathSubScript({ children, subScript: script(sub) });
    if (sup !== null) return new MathSuperScript({ children, superScript: script(sup) });
    return children.length === 1 ? children[0] : null;
}
function readScript(source, index, symbol) {
    if (source[index] !== symbol) return null;
    const next = index + 1;
    if (source[next] === '{') {
        const group = balanced(source, next);
        return group ? { value: group.inner, end: group.end } : null;
    }
    const match = /^[A-Za-z0-9+-]+/.exec(source.slice(next));
    return match ? { value: match[0], end: next + match[0].length } : null;
}

/** Native subscript/superscript on the WHOLE ion, not its last oxygen atom. */
function detachCharge(source) {
    let body = source.trim();
    const patterns = [
        /\^\{(\d+)([+-])\}$/,
        /\^\{(\d+)\}([+-])$/,
        /\^(\d+)([+-])$/,
        /\^\{([+-])\}$/,
        /\^([+-])$/,
        /([+-])$/,
    ];
    for (const rx of patterns) {
        const found = rx.exec(body);
        if (!found) continue;
        const charge = found.length === 3 ? found[1] + found[2]
            : found.length === 2 ? found[1] : '';
        if (!charge) continue;
        body = body.slice(0, found.index);
        return { body, charge: charge.replace(/-/g, '−') };
    }
    return { body, charge: null };
}

/** Chemical subscripts, grouped polyatomic ions, isotopes and optional states. */
function speciesToComponents(source) {
    const input = String(source).trim();
    if (!input) return [];
    // The suffix charge is attached to the entire formula (e.g. SO4^{2-}).
    const ion = detachCharge(input);
    const body = ion.body;
    const items = [];
    let i = 0;
    while (i < body.length) {
        const tail = body.slice(i);
        const isotope = /^\^\{(\d+)\}_(?:\{(\d+)\}|(\d+))([A-Z][a-z]?)/.exec(tail);
        if (isotope) {
            items.push(new MathPreSubSuperScript({
                children: [mark(isotope[4])],
                subScript: script(isotope[2] || isotope[3]),
                superScript: script(isotope[1]),
            }));
            i += isotope[0].length;
            continue;
        }
        const atom = /^[A-Z][a-z]?/.exec(tail);
        if (atom) {
            i += atom[0].length;
            let sub = null, sup = null;
            const digits = /^\d+/.exec(body.slice(i));
            if (digits) { sub = digits[0]; i += digits[0].length; }
            // Explicit _{n}, ^{n} on polymer/element labels.
            const requestedSub = readScript(body, i, '_');
            if (requestedSub) { sub = requestedSub.value; i = requestedSub.end; }
            const requestedSup = readScript(body, i, '^');
            if (requestedSup) { sup = requestedSup.value; i = requestedSup.end; }
            const comp = withScripts([mark(atom[0])], sub, sup);
            if (comp) items.push(comp);
            continue;
        }
        if (body[i] === '(' || body[i] === '[') {
            const open = body[i], close = open === '(' ? ')' : ']';
            const group = balanced(body, i, open, close);
            if (group) {
                // Physical-state suffixes are not stoichiometric groups.
                if (open === '(' && /^(aq|s|l|g|cr)$/i.test(group.inner)) {
                    items.push(mark('(' + group.inner + ')'));
                    i = group.end;
                    continue;
                }
                const children = [mark(open), ...speciesToComponents(group.inner), mark(close)];
                i = group.end;
                let sub = null, sup = null;
                const digits = /^\d+/.exec(body.slice(i));
                if (digits) { sub = digits[0]; i += digits[0].length; }
                const requestedSub = readScript(body, i, '_');
                if (requestedSub) { sub = requestedSub.value; i = requestedSub.end; }
                const requestedSup = readScript(body, i, '^');
                if (requestedSup) { sup = requestedSup.value; i = requestedSup.end; }
                const comp = withScripts(children, sub, sup);
                if (comp) items.push(comp);
                else items.push(...children);
                continue;
            }
        }
        if (body[i] === '\\') {
            const cmd = /^\\([a-zA-Z]+)/.exec(tail);
            if (cmd && Object.hasOwn(greek, cmd[1])) {
                items.push(mark(greek[cmd[1]])); i += cmd[0].length; continue;
            }
            if (cmd && (cmd[1] === 'text' || cmd[1] === 'mathrm' || cmd[1] === 'mathbf')) {
                const whitespace = /^\s*/.exec(body.slice(i + cmd[0].length))[0];
                const begin = i + cmd[0].length + whitespace.length;
                const group = balanced(body, begin);
                if (group) { items.push(mark(group.inner)); i = group.end; continue; }
                const one = /^[A-Za-zÀ-ỹ]+/u.exec(body.slice(begin));
                if (one) { items.push(mark(one[0])); i = begin + one[0].length; continue; }
            }
            if (tail.startsWith('\\,')) { items.push(mark(' ')); i += 2; continue; }
            if (tail.startsWith('\\;')) { items.push(mark(' ')); i += 2; continue; }
            throw new Error('Unsupported chemistry command: ' + tail.slice(0, 24));
        }
        const coeff = /^\d+(?:[.,]\d+)?/.exec(tail);
        if (coeff) {
            i += coeff[0].length;
            const exp = readScript(body, i, '^');
            if (exp) {
                const symbol = exp.value.replace(/\\circ\b/g, '°');
                items.push(new MathSuperScript({children:[mark(coeff[0])],superScript:script(symbol)}));
                i = exp.end;
            } else items.push(mark(coeff[0]));
            continue;
        }
        if (body[i] === '$') { i++; continue; }
        if (/\s/.test(body[i])) {
            const spaces = /^\s+/.exec(tail);
            items.push(mark(' ')); i += spaces[0].length; continue;
        }
        if (/^[+\-#=·.:*/^{}\[\]a-zA-Z0-9]$/.test(body[i])) {
            items.push(mark(body[i])); i++; continue;
        }
        // Preserve literal Unicode chemistry signs as editable math runs.
        items.push(mark(body[i])); i++;
    }
    if (ion.charge) return [new MathSuperScript({
        children: items.length ? items : [mark(' ')], superScript: script(ion.charge),
    })];
    return items;
}

/**
 * Return Word Math components for reaction conditions above/below an arrow.
 * In school chemistry documents, t^o (also t^\circ and t^{\circ})
 * denotes temperature, not an exponent on the ARROW. The t symbol has
 * its own true degree superscript, and the whole label is centered over
 * the reaction arrow using OMML m:limUpp (not m:sSup on the arrow).
 */
function reactionConditionToComponents(source) {
    const text=String(source);
    const degree=/\b([tT])\s*\^\s*(?:\{\s*(?:\\circ|o|°)\s*\}|(?:\\circ|o|°))/g;
    const out=[];
    let cursor=0, match;
    while((match=degree.exec(text))!==null) {
        if(match.index>cursor)out.push(...speciesToComponents(text.slice(cursor,match.index)));
        out.push(new MathSuperScript({
            children:[mark(match[1])],
            superScript:[mark('°')]
        }));
        cursor=match.index+match[0].length;
    }
    if(cursor<text.length)out.push(...speciesToComponents(text.slice(cursor)));
    return out.length?out:[mark(' ')];
}
function annotatedReactionArrow(operator, symbol, labels) {
    // Keep ordinary reactions unchanged; a long arrow makes the annotation
    // easier to read and edit in Word's native equation editor.
    if(!labels.length)return mark(symbol);
    const longArrows={'->':'⟶','<-':'⟵','<->':'⟷','<-->':'⟷'};
    const arrow=[mark(longArrows[operator]||symbol)];
    const above=labels[0]?reactionConditionToComponents(labels[0]):[];
    const below=labels.length===2 && labels[1]
        ?reactionConditionToComponents(labels[1]):[];
    let expression=arrow;
    if(below.length)expression=[new MathLimitLower({children:expression,limit:below})];
    if(above.length)expression=[new MathLimitUpper({children:expression,limit:above})];
    return expression[0];
}

/**
 * A top-level mhchem reaction parser. Chemistry arrows are native Unicode
 * symbols. Labeled arrows use centered OMML limits, not superscripts on the
 * arrow's right edge. This is shared by question-bank and exam DOCX export.
 */
export function parseChemicalMath(source) {
    const text = String(source).trim();
    if (!text) return [mark(' ')];
    const out = [];
    let pos = 0, chunk = '';
    const flush = () => {
        if (!chunk) return;
        out.push(...speciesToComponents(chunk)); chunk = '';
    };
    // Prefer longest, so <--> is never partially read as <-.
    const arrows = [
        ['<<=>>','⇌'], ['<-->','⟷'], ['<=>','⇌'], ['<->','↔'],
        ['<=>>','⇀'], ['->>','↠'], ['->','→'], ['<-','←'],
    ];
    while (pos < text.length) {
        const tail = text.slice(pos);
        // Distinguish '+' between molecules (" + ") from the ionic charge.
        const addition = /^\s+\+\s+/.exec(tail);
        if (addition) {
            flush(); out.push(mark(' + ')); pos += addition[0].length; continue;
        }
        const arrow = arrows.find(([op]) => tail.startsWith(op));
        if (arrow) {
            flush(); pos += arrow[0].length;
            const labels = [];
            while (text[pos] === '[' && labels.length < 2) {
                const label = balanced(text, pos, '[', ']');
                if (!label) break;
                labels.push(label.inner);
                pos = label.end;
            }
            out.push(annotatedReactionArrow(arrow[0], arrow[1], labels));
            continue;
        }
        const precipitate = /^\s+(v|\^)(?=\s|$)/.exec(tail);
        if (precipitate) {
            flush(); out.push(mark(precipitate[1] === 'v' ? ' ↓' : ' ↑'));
            pos += precipitate[0].length; continue;
        }
        if (text[pos] === '{') {
            const brace = balanced(text, pos);
            if (brace) { chunk += text.slice(pos, brace.end); pos = brace.end; continue; }
        }
        chunk += text[pos++];
    }
    flush();
    return out.length ? out : [mark(' ')];
}

export function makeEditableChemistryEquation(source) {
    return new WordMath({ children: parseChemicalMath(source) });
}

/** Editable scientific units, such as 123 kJ mol^-1 and m/s^2. */
export function makeEditableUnitEquation(source) {
    const raw = String(source || '').trim();
    if (!raw) return new WordMath({ children: [mark(' ')] });
    const parts = [], matches = /([a-zA-Zµμ°]+)(?:\^?\{?(-?\d+)\}?|(-\d+))?|(\d+(?:[.,]\d+)?)|(\s+)|([*/·×])|(.)/g;
    for (const m of raw.matchAll(matches)) {
        if (m[1]) {
            const power = m[2] || m[3];
            parts.push(power ? new MathSuperScript({
                children: [mark(m[1])], superScript: script(power),
            }) : mark(m[1]));
        } else if (m[4]) parts.push(mark(m[4]));
        else if (m[5]) parts.push(mark(' '));
        else if (m[6]) parts.push(mark(m[6] === '*' ? '·' : m[6]));
        else if (m[7]) parts.push(mark(m[7]));
    }
    return new WordMath({ children: parts });
}

/**
 * Expand chemistry in a larger expression (e.g. K_a = [\ce{H+}])
 * before docx's LaTeX parser sees unsupported \ce commands.
 * Supports any number of balanced nested chemistry blocks.
 */
export function expandMhchemForWordMath(input) {
    const source = String(input || '');
    let result = '';
    let pos = 0;
    while (pos < source.length) {
        const match = /^\\(ce|pu)\s*\{/.exec(source.slice(pos));
        if (!match) { result += source[pos++]; continue; }
        const block = balanced(source, pos + match[0].length - 1);
        if (!block) throw new Error('Unbalanced \\'+match[1]+' chemistry source');
        result += match[1] === 'ce' ? chemicalToLatex(block.inner) : unitToLatex(block.inner);
        pos = block.end;
    }
    return result;
}

/** The embedded branch builds only ordinary TeX features docx/math supports. */
function chemicalToLatex(text) {
    const source = String(text).trim();
    const ops = /(\s+\+\s+|<=>|<-->|<->|->|<-)/g;
    return source.split(ops).filter(Boolean).map(token => {
        const operator = token.trim();
        if (/^\+$/.test(operator) && /^\s/.test(token)) return ' + ';
        const arrows = {'->':'→','<-':'←','<=>':'⇌','<->':'↔','<-->':'⟷'};
        if (Object.hasOwn(arrows,operator)) return arrows[operator];
        const {body,charge} = detachCharge(token.trim());
        const isotopes=[];
        const protectedSource=body.replace(/\^\{(\d+)\}_\{?(\d+)\}?([A-Z][a-z]?)/g,
            (_full,sup,sub,element) => {
                const index=isotopes.length;
                isotopes.push('{}^{' + sup + '}_{' + sub + '}\\mathrm{' + element + '}');
                return '§' + index + '§';
            });
        const atomized=protectedSource
            .replace(/([A-Z][a-z]?)(\d*)/g, (_full,element,sub) =>
                '\\mathrm{' + element + '}' + (sub ? '_{' + sub + '}' : ''))
            .replace(/([\)\]])(\d+)/g, '$1_{$2}')
            .replace(/§(\d+)§/g, (_full,index) => isotopes[Number(index)]);
        return (charge ? '{' + atomized + '}^{' + charge + '}' : atomized);
    }).join('');
}
function unitToLatex(source) {
    return String(source).replace(/([A-Za-zµμ°]+)(?:\^?\{?(-?\d+)\}?|(-\d+))?/g,
        (_whole,unit,power1,power2) => '\\mathrm{' + unit + '}' +
            ((power1 || power2) ? '^{' + (power1 || power2) + '}' : ''))
        .replace(/\*/g,'\\cdot ');
}

/** Read complete \ce{...} or \pu{...} with balanced nested braces. */
export function standaloneMhchemCommand(source) {
    const str = String(source || '').trim();
    const head = /^\\(ce|pu)\s*\{/.exec(str);
    if (!head) return null;
    const block = balanced(str, head[0].length - 1);
    if (!block || block.end !== str.length) return null;
    return {kind: head[1], body: block.inner};
}
