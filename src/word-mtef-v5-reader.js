/**
 * Bounded, structural MathType MTEF v5 decoder.
 * Specification: Wiris MathType SDK, MTEF v5 (records and template slot order).
 * Layout preferences are consumed structurally; unknown semantic data fails closed.
 * Does not execute OLE, OCR previews, rewrite source bytes, or guess missing symbols.
 */
const MAX_BYTES = 96 * 1024;
const MAX_RECORDS = 8192;
const MAX_DEPTH = 32;
const MAX_LATEX = 9000;
const fail = reason => { throw new Error('MathType MTEF: ' + reason); };
class Reader {
    constructor(input) { this.data = input; this.offset = 0; }
    byte() {
        if (this.offset >= this.data.length) fail('truncated record');
        return this.data[this.offset++];
    }
    word() { return this.byte() | (this.byte() << 8); }
    unsigned() { const b = this.byte(); return b === 255 ? this.word() : b; }
    signed() { const b = this.byte(); return b === 255 ? this.word() - 32768 : b - 128; }
    string() {
        let result = '';
        for (let i = 0; i < 256; i++) {
            const b = this.byte();
            if (b === 0) return result;
            result += String.fromCharCode(b);
        }
        fail('unterminated definition string');
    }
    dimensions() {
        const count = this.byte();
        let low = null;
        const nibble = () => {
            if (low !== null) { const v = low; low = null; return v; }
            const b = this.byte(); low = b & 15; return b >>> 4;
        };
        for (let i = 0; i < count; i++) {
            if (nibble() > 4) fail('unknown dimension unit');
            let done = false;
            for (let j = 0; j < 64; j++) {
                const n = nibble();
                if (n === 15) { done = true; break; }
                if (n > 11) fail('invalid dimension digit');
            }
            if (!done) fail('unterminated dimension');
        }
        if (low !== null && low !== 0) fail('invalid dimension padding');
    }
}

// MTCode Unicode mappings; private-use glyphs are NOT treated as Unicode letters.
const symbols = new Map([
    [0x2212, '-'], [0x2218, '\\circ{}'], [0x00b1, '\\pm{}'], [0x2213, '\\mp{}'],
    [0x00d7, '\\times{}'], [0x00f7, '\\div{}'], [0x00b7, '\\cdot{}'],
    [0x221e, '\\infty{}'], [0x2264, '\\leq{}'], [0x2265, '\\geq{}'],
    [0x2260, '\\neq{}'], [0x2248, '\\approx{}'], [0x2208, '\\in{}'],
    [0x2202, '\\partial{}'], [0x2192, '\\to{}'], [0x2190, '\\leftarrow{}'],
    [0x2211, '\\sum{}'], [0x220f, '\\prod{}'], [0x222b, '\\int{}'],
    [0x03b1, '\\alpha{}'], [0x03b2, '\\beta{}'], [0x03b3, '\\gamma{}'],
    [0x03b4, '\\delta{}'], [0x03b5, '\\varepsilon{}'], [0x03f5, '\\epsilon{}'],
    [0x03b8, '\\theta{}'], [0x03bb, '\\lambda{}'], [0x03bc, '\\mu{}'],
    [0x03c0, '\\pi{}'], [0x03c3, '\\sigma{}'], [0x03c6, '\\varphi{}'],
    [0x03d5, '\\phi{}'], [0x03c9, '\\omega{}'], [0x0394, '\\Delta{}'],
    [0x03a9, '\\Omega{}'], [0x03a3, '\\Sigma{}'],
    [0x2227, '\\land{}'], [0x2228, '\\lor{}'], [0x00b0, '{}^{\\circ}'],
    [0x2207, '\\nabla{}'], [0x2229, '\\cap{}'], [0x222a, '\\cup{}'],
    [0x2282, '\\subset{}'], [0x2283, '\\supset{}'], [0x2286, '\\subseteq{}'],
    [0x2287, '\\supseteq{}'], [0x2209, '\\notin{}'], [0x2205, '\\emptyset{}'],
    [0x2200, '\\forall{}'], [0x2203, '\\exists{}'], [0x22a5, '\\perp{}'],
    [0x2225, '\\parallel{}'], [0x2194, '\\leftrightarrow{}'],
    [0x21d2, '\\Rightarrow{}'], [0x21d0, '\\Leftarrow{}'], [0x21d4, '\\Leftrightarrow{}'],
    [0x222c, '\\iint{}'], [0x222d, '\\iiint{}'], [0x222e, '\\oint{}'],
    [0x2210, '\\coprod{}'], [0x22c3, '\\bigcup{}'], [0x22c2, '\\bigcap{}'],
    [0x03bd, '\\nu{}'], [0x03b6, '\\zeta{}'], [0x03b7, '\\eta{}'],
    [0x03b9, '\\iota{}'], [0x03ba, '\\kappa{}'], [0x03be, '\\xi{}'],
    [0x03c1, '\\rho{}'], [0x03c4, '\\tau{}'], [0x03c5, '\\upsilon{}'],
    [0x03c7, '\\chi{}'], [0x03c8, '\\psi{}'], [0x0393, '\\Gamma{}'],
    [0x0398, '\\Theta{}'], [0x039b, '\\Lambda{}'], [0x039e, '\\Xi{}'],
    [0x03a0, '\\Pi{}'], [0x03a6, '\\Phi{}'], [0x03a8, '\\Psi{}'],
    [0x2026, '\\ldots{}'], [0x22ef, '\\cdots{}'], [0x22ee, '\\vdots{}'],
    [0x22f1, '\\ddots{}'],
    // Letterlike symbols emitted by MathType's MT Extra face. These are real
    // MTCode/Unicode values (not font-position guesses) and are common in
    // set notation in Vietnamese high-school mathematics.
    [0x2102, '\\mathbb{C}'], [0x210d, '\\mathbb{H}'], [0x2115, '\\mathbb{N}'],
    [0x2119, '\\mathbb{P}'], [0x211a, '\\mathbb{Q}'], [0x211d, '\\mathbb{R}'],
    [0x2124, '\\mathbb{Z}'],
    [0x7b, '\\{'], [0x7d, '\\}']
]);
const fenceCodes = [
    [0x27e8, 0x27e9, '\\langle', '\\rangle'], [40, 41, '(', ')'],
    [123, 125, '\\{', '\\}'], [91, 93, '[', ']'],
    [124, 124, '|', '|'], [0x2016, 0x2016, '\\lVert', '\\rVert'],
    [0x230a, 0x230b, '\\lfloor', '\\rfloor'], [0x2308, 0x2309, '\\lceil', '\\rceil']
];

/**
 * Standard MTEF v5 content typefaces. MathType uses 9/10 for user styles,
 * 11 for MT Extra and 12 for Far-East text. Accepting a standard typeface
 * does NOT make arbitrary glyphs valid: MTCode still has to pass the strict
 * Unicode/symbol whitelist below, and private-use/control codes remain blocked.
 */
const contentTypefaces = new Set([1,2,3,4,5,6,7,8,9,10,11,12]);
const romanTextTypefaces = new Set([1,2,12]);

/**
 * Decode the documented format first. A few legacy writers emit an END after
 * a non-final NULL slot. Retry only that explicitly delimited slot variant;
 * never trim trailing bytes or discard unknown records to make a formula pass.
 */
export function convertMtefV5ToLatex(input) {
    try { return decodeMtef(input, false); }
    catch (standardError) {
        try { return decodeMtef(input, true); }
        catch { throw standardError; }
    }
}
function decodeMtef(input, allowNullSlotEnd) {
    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (data.length < 7 || data.length > MAX_BYTES) fail('invalid stream size');
    const r = new Reader(data);
    if (r.byte() !== 5) fail('hi\u1ec7n h\u1ed7 tr\u1ee3 t\u1ef1 \u0111\u1ed9ng MTEF phi\u00ean b\u1ea3n 5');
    const platform = r.byte(), product = r.byte(), version = r.byte(), revision = r.byte();
    if (platform > 1 || product > 1 || version < 4 || version > 100 || revision > 100) fail('header MTEF kh\u00f4ng h\u1ee3p l\u1ec7');
    const producerKey = r.string();
    if (r.byte() & ~1) fail('unsupported equation options');
    const fonts = [null], explicitStyles = [null];
    let styles = [], count = 0, nullSlotEnds = 0;
    const options = allowed => {
        const value = r.byte();
        if (value & 8) fail('nudged content requires review');
        if (value & ~allowed) fail('unsupported record options');
        return value;
    };
    const styleBits = () => { const v = r.byte(); if (v > 3) fail('invalid font style'); return v; };
    const list = (depth = 0, template = null) => {
        if (depth > MAX_DEPTH) fail('nesting limit exceeded');
        const nodes = [];
        for (;;) {
            if (++count > MAX_RECORDS) fail('record limit exceeded');
            const type = r.byte();
            if (type === 0) return nodes;
            if (type >= 10 && type <= 14) continue;
            if (type === 19) { r.string(); continue; }
            if (type === 17) { fonts.push({ encoding: r.unsigned(), name: r.string() }); continue; }
            if (type === 8) { explicitStyles.push({ font: r.unsigned(), style: styleBits() }); continue; }
            if (type === 18) {
                options(0); r.dimensions(); r.dimensions();
                const n = r.byte(), next = [];
                for (let i = 0; i < n; i++) {
                    const font = r.unsigned();
                    if (font >= fonts.length) fail('undefined preference font');
                    next.push(font ? { font, style: styleBits() } : null);
                }
                styles = next;
                continue;
            }
            if (type === 9) {
                const size = r.byte();
                if (size === 101) r.word();
                else if (size === 100) { if (r.byte() > 7) fail('unknown logical size'); r.word(); }
                else { if (size > 7) fail('unknown logical size'); r.byte(); }
                continue;
            }
            if (type === 1) {
                const opt = options(1);
                // The extra END is accepted only between required slots, never
                // at the end of a template, equation, matrix or arbitrary list.
                const leadingScriptNull = [28, 29].includes(template) && nodes.length === 0;
                const leadingOperatorNull = template >= 15 && template <= 22 && nodes.length < 3;
                const nextIsSlot = r.data[r.offset + 1] === 1 && [0, 1].includes(r.data[r.offset + 2]);
                const nextIsOperator = template >= 15 && template <= 22 && nodes.length === 2 &&
                    r.data[r.offset + 1] === 2;
                if (allowNullSlotEnd && (opt & 1) && (leadingScriptNull || leadingOperatorNull) &&
                    r.data[r.offset] === 0 && (nextIsSlot || nextIsOperator)) {
                    r.byte(); nullSlotEnds++;
                }
                nodes.push({ kind: 'line', empty: !!(opt & 1), children: (opt & 1) ? [] : list(depth + 1) });
                continue;
            }
            if (type === 2) {
                const opt = options(0x37);
                // mtefOPT_CHAR_FUNC_START is metadata marking the first character
                // of a function such as sin/cos. It adds no payload bytes and does not
                // alter the character value; fnFUNCTION/typeface styling below preserves
                // the intended upright text, so it is safe to retain without blocking.
                const functionStart = !!(opt & 2);
                if (opt & 32) fail('character without MTCode requires review');
                if ((opt & 4) && (opt & 16)) fail('conflicting font positions');
                const face = r.signed(), code = r.word();
                if (opt & 4) r.byte();
                if (opt & 16) r.word();
                const style = face > 0 ? styles[face - 1]?.style : explicitStyles[-face]?.style;
                nodes.push({ kind: 'char', face, code, style, options: opt, functionStart,
                    embellishments: (opt & 1) ? list(depth + 1) : [] });
                continue;
            }
            if (type === 3) {
                options(0);
                const selector = r.byte(), first = r.byte();
                const variation = (first & 128) ? (first & 127) | (r.byte() << 8) : first;
                const flags = r.byte();
                nodes.push({ kind: 'template', selector, variation, flags, children: list(depth + 1, selector) });
                continue;
            }
            if (type === 4) {
                options(0);
                const horizontal = r.byte(), vertical = r.byte();
                if (![1, 2, 3].includes(horizontal) || vertical > 4) fail('unsupported pile alignment');
                nodes.push({ kind: 'pile', horizontal, children: list(depth + 1) });
                continue;
            }
            if (type === 5) {
                options(0);
                const vertical = r.byte(), horizontal = r.byte(), cellVertical = r.byte();
                const rows = r.byte(), cols = r.byte();
                if (vertical > 4 || cellVertical > 4 || ![1, 2, 3].includes(horizontal) ||
                    !rows || !cols || rows > 64 || cols > 64 || rows * cols > 1024)
                    fail('invalid matrix dimensions or alignment');
                const partitions = length => {
                    const result = [];
                    for (let i = 0; i < Math.ceil((length + 1) / 4); i++) {
                        const byte = r.byte();
                        // Partitioned matrices are not flattened: their rules can
                        // change meaning. Leave uncommon borders for review.
                        if (byte !== 0) fail('matrix partition lines require review');
                        result.push(byte);
                    }
                    return result;
                };
                const rowParts = partitions(rows), colParts = partitions(cols);
                const cells = list(depth + 1);
                if (cells.length !== rows * cols || cells.some(n => n.kind !== 'line'))
                    fail('matrix cell count mismatch');
                nodes.push({ kind: 'matrix', rows, cols, horizontal, cells, rowParts, colParts });
                continue;
            }
            if (type === 6) { options(0); nodes.push({ kind: 'embellishment', code: r.byte() }); continue; }
            fail('unsupported record type ' + type);
        }
    };
    const tree = list();
    if (r.offset !== data.length) fail('unconsumed trailing data');
    if (allowNullSlotEnd && !nullSlotEnds) fail('not the NULL-slot-END compatibility variant');
    if (tree.length !== 1 || !['line', 'pile'].includes(tree[0].kind)) fail('expected one root equation');
    const bounded = value => { if (value.length > MAX_LATEX) fail('LaTeX size limit exceeded'); return value; };
    const renderList = (nodes, script = false) => bounded(nodes.map(n => render(n, script)).join(''));
    const glyph = (node, code) => node?.kind === 'char' && node.face === 22 && node.code === code &&
        node.embellishments.length === 0 && !(node.options & 2);
    const lineValue = (node, script = false) => {
        if (!node || node.kind !== 'line') fail('expected template line');
        return renderList(node.children, script);
    };
    const embellish = (value, code) => {
        const commands = { 2: 'dot', 3: 'ddot', 8: 'tilde', 9: 'hat', 11: 'overrightarrow',
            12: 'overleftarrow', 13: 'overleftrightarrow', 17: 'overline', 29: 'underline' };
        if (commands[code]) return '\\' + commands[code] + '{' + value + '}';
        if ([5, 6, 18].includes(code)) return '{' + value + '}^{' + '\\prime'.repeat(code === 5 ? 1 : code === 6 ? 2 : 3) + '}';
        fail('unsupported embellishment ' + code);
    };
    function render(node, script = false) {
        if (node.kind === 'line') {
            if (node.children.some(n => n.kind === 'line')) fail('unexpected nested line');
            return renderList(node.children, script);
        }
        if (node.kind === 'matrix') {
            const rows = [];
            for (let i = 0; i < node.rows; i++)
                rows.push(node.cells.slice(i * node.cols, (i + 1) * node.cols).map(n => lineValue(n)).join(' & '));
            if (node.horizontal === 2) return bounded('\\begin{matrix}' + rows.join(' \\\\ ') + '\\end{matrix}');
            const align = (node.horizontal === 1 ? 'l' : 'r').repeat(node.cols);
            return bounded('\\begin{array}{' + align + '}' + rows.join(' \\\\ ') + '\\end{array}');
        }
        if (node.kind === 'pile') {
            if (!node.children.length || node.children.some(n => n.kind !== 'line' || n.empty)) fail('invalid pile rows');
            const align = { 1: 'l', 2: 'c', 3: 'r' }[node.horizontal];
            return bounded('\\begin{array}{' + align + '}' + node.children.map(n => lineValue(n)).join('\\\\') + '\\end{array}');
        }
        if (node.kind === 'char') {
            const { code, face } = node;
            let value;
            // Narrow compatibility: actual MathType spacing record, not arbitrary PUA text.
            if (face === 24 && code === 0xef02 && node.options === 0 && !node.embellishments.length) return '\\,';
            // Earlier KTTT exports encoded Word's invisible OMML layout separator
            // as a symbol CHAR. Accept only that known producer/record combination
            // so Word files already exported can be re-imported without changing
            // the meaning of the equation or relaxing the general MTEF whitelist.
            if (producerKey === 'KTTTMT1' && face === 6 && code === 0x200b &&
                node.options === 0 && !node.embellishments.length) return '';
            if (code < 32 || (code >= 0xd800 && code <= 0xdfff) || (code >= 0xe000 && code <= 0xf8ff)) fail('unmapped MTCode U+' + code.toString(16));
            if (!contentTypefaces.has(face)) fail('unsupported typeface ' + face);
            const char = String.fromCharCode(code);
            if (code === 0x00b0 && script) value = '\\circ{}';
            else if (symbols.has(code)) value = symbols.get(code);
            else if (/^[A-Za-z0-9+\-=.,:;()[\]<>|/*!?]$/.test(char)) value = char;
            else if (char === ' ' && face === 1) value = '\\ ';
            else fail('unmapped MTCode U+' + code.toString(16));
            if (romanTextTypefaces.has(face) && /^[A-Za-z]$/.test(char)) value = '\\mathrm{' + value + '}';
            if (face === 7 || ((node.style ?? 0) & 1)) value = '\\boldsymbol{' + value + '}';
            for (const e of node.embellishments) {
                if (e.kind !== 'embellishment') fail('invalid embellishment list');
                value = embellish(value, e.code);
            }
            return bounded(value);
        }
        if (node.kind !== 'template') fail('unexpected structural node ' + node.kind);
        const { selector: s, variation: v, flags, children: c } = node;
        if (s >= 0 && s < fenceCodes.length) {
            if (v < 1 || v > 3 || flags > 2 || !['line', 'pile'].includes(c[0]?.kind)) fail('unsupported fence');
            const [leftCode, rightCode, left, right] = fenceCodes[s];
            let at = 1;
            if ((v & 1) && !glyph(c[at++], leftCode)) fail('left fence glyph mismatch');
            if ((v & 2) && !glyph(c[at++], rightCode)) fail('right fence glyph mismatch');
            if (at !== c.length) fail('unexpected fence payload');
            return bounded('\\left' + ((v & 1) ? left : '.') + render(c[0]) + '\\right' + ((v & 2) ? right : '.'));
        }
        if (s >= 15 && s <= 22) {
            if (flags > (s === 15 ? 1 : 0) || (v & ~0x17f) || c.length !== 4 ||
                c.slice(0, 3).some(n => n.kind !== 'line')) fail('invalid large-operator slots');
            const sign = c[3];
            if (sign.kind !== 'char' || ![6, 22].includes(sign.face) || sign.embellishments.length)
                fail('invalid large-operator glyph');
            const allowed = {
                15: [0x222b, 0x222c, 0x222d, 0x222e], 16: [0x2211], 17: [0x220f],
                18: [0x2210], 19: [0x22c3, 0x222a], 20: [0x22c2, 0x2229],
                21: [0x222b, 0x222c, 0x222d, 0x222e], 22: [0x2211, 0x220f, 0x22c3, 0x22c2]
            };
            if (!allowed[s].includes(sign.code)) fail('large-operator glyph mismatch');
            const commands = { 0x222b:'int', 0x222c:'iint', 0x222d:'iiint', 0x222e:'oint',
                0x2211:'sum', 0x220f:'prod', 0x2210:'coprod', 0x22c3:'bigcup', 0x222a:'bigcup',
                0x22c2:'bigcap', 0x2229:'bigcap' };
            // SDK BigOpBoxClass order is MAIN, UPPER, LOWER, glyph.
            const body = lineValue(c[0]), upper = lineValue(c[1]), lower = lineValue(c[2]);
            return bounded('\\' + commands[sign.code] + (lower ? '_{' + lower + '}' : '') +
                (upper ? '^{' + upper + '}' : '') + ' ' + body);
        }
        if (flags !== 0) fail('unsupported template flags');
        if ([12, 13, 32, 33].includes(s) && c.length === 1 && c[0].kind === 'line') {
            if (v !== 0 && !(s <= 13 && v === 1)) fail('unsupported accent variation');
            const command = { 12:'underline', 13:'overline', 32:'widetilde', 33:'widehat' }[s];
            const value = lineValue(c[0]);
            if (!value) fail('empty accent');
            const once = '\\' + command + '{' + value + '}';
            return v ? '\\' + command + '{' + once + '}' : once;
        }
        if (s === 31 && (v === 1 || v === 2)) {
            if (![1, 2].includes(c.length) || c[0].kind !== 'line' ||
                (c.length === 2 && !glyph(c[1], v === 1 ? 0x20d6 : 0x20d7))) fail('vector glyph mismatch');
            const value = lineValue(c[0]);
            if (!value) fail('empty vector');
            return (v === 1 ? '\\overleftarrow{' : '\\overrightarrow{') + value + '}';
        }
        if (c.some(n => n.kind !== 'line')) fail('unexpected template payload');
        const a = c.map(n => lineValue(n, [27, 28, 29].includes(s)));
        if (s === 11 && v === 0 && a.length === 2 && a.every(Boolean)) return bounded('\\frac{' + a[0] + '}{' + a[1] + '}');
        if (s === 10 && v === 0 && a[0] && (a.length === 1 || (a.length === 2 && c[1].empty))) return '\\sqrt{' + a[0] + '}';
        if (s === 10 && v === 1 && a.length === 2 && a.every(Boolean)) return '\\sqrt[' + a[1] + ']{' + a[0] + '}';
        // KTTT's writer emits pre-scripts as a variation=1 template before
        // the base glyph. Leading empty atom anchors TeX indices to the LEFT
        // of the following base without changing its meaning.
        if (producerKey === 'KTTTMT1' && v === 1 && a.length === 2) {
            if (s === 27 && a[0] && c[1].empty) return '{}_{' + a[0] + '}';
            if (s === 28 && c[0].empty && a[1]) return '{}^{' + a[1] + '}';
            if (s === 29 && a.every(Boolean)) return '{}_{' + a[0] + '}^{' + a[1] + '}';
        }
        if (v === 0 && [27, 28, 29].includes(s)) {
            // MathType writes sub THEN sup, retaining NULL slots. Keep the legacy
            // one-slot subset accepted by the original importer, without dropping other data.
            if (s === 27 && a.length === 1 && a[0]) return '_{' + a[0] + '}';
            if (s === 28 && a.length === 1 && a[0]) return '^{' + a[0] + '}';
            if (a.length === 2) {
                if (s === 27 && a[0] && c[1].empty) return '_{' + a[0] + '}';
                if (s === 28 && c[0].empty && a[1]) return '^{' + a[1] + '}';
                if (s === 29 && a.every(Boolean)) return '_{' + a[0] + '}^{' + a[1] + '}';
            }
        }
        fail('unsupported template ' + s + '/' + v);
    }
    const latex = bounded(render(tree[0]));
    if (!latex.trim()) fail('empty equation');
    return latex;
}
