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
    [0x2212, '-'], [0x00b1, '\\pm{}'], [0x2213, '\\mp{}'],
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
    [0x2227, '\\land{}'], [0x2228, '\\lor{}'], [0x00b0, '{}^{\\circ}']
]);
const fenceCodes = [
    [0x27e8, 0x27e9, '\\langle', '\\rangle'], [40, 41, '(', ')'],
    [123, 125, '\\{', '\\}'], [91, 93, '[', ']'],
    [124, 124, '|', '|'], [0x2016, 0x2016, '\\lVert', '\\rVert'],
    [0x230a, 0x230b, '\\lfloor', '\\rfloor'], [0x2308, 0x2309, '\\lceil', '\\rceil']
];

export function convertMtefV5ToLatex(input) {
    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (data.length < 7 || data.length > MAX_BYTES) fail('invalid stream size');
    const r = new Reader(data);
    if (r.byte() !== 5) fail('hi\u1ec7n h\u1ed7 tr\u1ee3 t\u1ef1 \u0111\u1ed9ng MTEF phi\u00ean b\u1ea3n 5');
    const platform = r.byte(), product = r.byte(), version = r.byte(), revision = r.byte();
    if (platform > 1 || product > 1 || version < 4 || version > 100 || revision > 100) fail('header MTEF kh\u00f4ng h\u1ee3p l\u1ec7');
    r.string();
    if (r.byte() & ~1) fail('unsupported equation options');
    const fonts = [null], explicitStyles = [null];
    let styles = [], count = 0;
    const options = allowed => {
        const value = r.byte();
        if (value & 8) fail('nudged content requires review');
        if (value & ~allowed) fail('unsupported record options');
        return value;
    };
    const styleBits = () => { const v = r.byte(); if (v > 3) fail('invalid font style'); return v; };
    const list = (depth = 0) => {
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
                nodes.push({ kind: 'line', empty: !!(opt & 1), children: (opt & 1) ? [] : list(depth + 1) });
                continue;
            }
            if (type === 2) {
                const opt = options(0x37);
                if (opt & 2) fail('function-start character requires review');
                if (opt & 32) fail('character without MTCode requires review');
                if ((opt & 4) && (opt & 16)) fail('conflicting font positions');
                const face = r.signed(), code = r.word();
                if (opt & 4) r.byte();
                if (opt & 16) r.word();
                const style = face > 0 ? styles[face - 1]?.style : explicitStyles[-face]?.style;
                nodes.push({ kind: 'char', face, code, style, options: opt,
                    embellishments: (opt & 1) ? list(depth + 1) : [] });
                continue;
            }
            if (type === 3) {
                options(0);
                const selector = r.byte(), first = r.byte();
                const variation = (first & 128) ? (first & 127) | (r.byte() << 8) : first;
                const flags = r.byte();
                nodes.push({ kind: 'template', selector, variation, flags, children: list(depth + 1) });
                continue;
            }
            if (type === 4) {
                options(0);
                const horizontal = r.byte(), vertical = r.byte();
                if (![1, 2, 3].includes(horizontal) || vertical > 4) fail('unsupported pile alignment');
                nodes.push({ kind: 'pile', horizontal, children: list(depth + 1) });
                continue;
            }
            if (type === 6) { options(0); nodes.push({ kind: 'embellishment', code: r.byte() }); continue; }
            fail('unsupported record type ' + type);
        }
    };
    const tree = list();
    if (r.offset !== data.length) fail('unconsumed trailing data');
    if (tree.length !== 1 || !['line', 'pile'].includes(tree[0].kind)) fail('expected one root equation');
    const bounded = value => { if (value.length > MAX_LATEX) fail('LaTeX size limit exceeded'); return value; };
    const renderList = nodes => bounded(nodes.map(render).join(''));
    const glyph = (node, code) => node?.kind === 'char' && node.face === 22 && node.code === code &&
        node.embellishments.length === 0 && !(node.options & 2);
    const lineValue = node => {
        if (!node || node.kind !== 'line') fail('expected template line');
        return renderList(node.children);
    };
    const embellish = (value, code) => {
        const commands = { 2: 'dot', 3: 'ddot', 8: 'tilde', 9: 'hat', 11: 'overrightarrow',
            12: 'overleftarrow', 13: 'overleftrightarrow', 17: 'overline', 29: 'underline' };
        if (commands[code]) return '\\' + commands[code] + '{' + value + '}';
        if ([5, 6, 18].includes(code)) return '{' + value + '}^{' + '\\prime'.repeat(code === 5 ? 1 : code === 6 ? 2 : 3) + '}';
        fail('unsupported embellishment ' + code);
    };
    function render(node) {
        if (node.kind === 'line') return renderList(node.children);
        if (node.kind === 'pile') {
            if (!node.children.length || node.children.some(n => n.kind !== 'line' || n.empty)) fail('invalid pile rows');
            const align = { 1: 'l', 2: 'c', 3: 'r' }[node.horizontal];
            return bounded('\\begin{array}{' + align + '}' + node.children.map(lineValue).join('\\\\') + '\\end{array}');
        }
        if (node.kind === 'char') {
            const { code, face } = node;
            let value;
            // Narrow compatibility: actual MathType spacing record, not arbitrary PUA text.
            if (face === 24 && code === 0xef02 && node.options === 0 && !node.embellishments.length) return '\\,';
            if (code < 32 || (code >= 0xd800 && code <= 0xdfff) || (code >= 0xe000 && code <= 0xf8ff)) fail('unmapped MTCode U+' + code.toString(16));
            if (![1, 2, 3, 4, 5, 6, 7, 8].includes(face)) fail('unsupported typeface ' + face);
            const char = String.fromCharCode(code);
            if (symbols.has(code)) value = symbols.get(code);
            else if (/^[A-Za-z0-9+\-=.,:;()[\]<>|/*!?]$/.test(char)) value = char;
            else if (char === ' ' && face === 1) value = '\\ ';
            else fail('unmapped MTCode U+' + code.toString(16));
            if ([1, 2].includes(face) && /^[A-Za-z]$/.test(char)) value = '\\mathrm{' + value + '}';
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
        if (flags !== 0) fail('unsupported template flags');
        if (s === 31 && (v === 1 || v === 2)) {
            if (c.length !== 2 || c[0].kind !== 'line' || !glyph(c[1], v === 1 ? 0x20d6 : 0x20d7)) fail('vector glyph mismatch');
            const value = lineValue(c[0]);
            if (!value) fail('empty vector');
            return (v === 1 ? '\\overleftarrow{' : '\\overrightarrow{') + value + '}';
        }
        if (c.some(n => n.kind !== 'line')) fail('unexpected template payload');
        const a = c.map(lineValue);
        if (s === 11 && v === 0 && a.length === 2 && a.every(Boolean)) return bounded('\\frac{' + a[0] + '}{' + a[1] + '}');
        if (s === 10 && v === 0 && a[0] && (a.length === 1 || (a.length === 2 && c[1].empty))) return '\\sqrt{' + a[0] + '}';
        if (s === 10 && v === 1 && a.length === 2 && a.every(Boolean)) return '\\sqrt[' + a[1] + ']{' + a[0] + '}';
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
