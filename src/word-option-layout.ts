/**
 * Word answer layout planner. This module measures *visual* TeX lines only;
 * the original LaTeX and OMML are never modified for export.
 *
 * A4 text width is about 17 cm at 2 cm margins. Two cells have about 8.5 cm
 * each (minus their A./B. labels). Widths below are conservative glyph units,
 * not string lengths or Word's rendering coordinates.
 */
export interface WordOptionMeasure {
    maxLineWidth: number;
    lineCount: number;
    longestUnbroken: number;
    structuredMath: boolean;
    hardTextBreak: boolean;
    media: boolean;
    uncertain: boolean;
}

const MATH_ROWS = /\\begin\s*\{(?:cases|aligned|alignedat|align|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|gather|gathered|split)\}/i;
const MEDIA = /<(?:img|svg|table)\b|!\[[^\]]*\]\([^)]*\)|data:image\//i;
const HTML_BREAK = /<br\s*\/?>|<\/(?:p|div|li)>/i;
const MULTIROW_TEX = /\\\\(?:\[[^\]]*\])?/;
const TEX_MATH = /\\(?:frac|dfrac|tfrac|sqrt|leq|geq|le|ge|ce|pu|times|cdot|alpha|beta|sin|cos|sum|int)\b|[=^_]/;
const WIDE_SYMBOLS = new Set(['⇒', '⇔', '⟶', '→', '⟵', '←']);

function glyphWidth(char: string): number {
    if (/\s/u.test(char)) return 0.45;
    if (/[ilI.,;:!|']/u.test(char)) return 0.55;
    if (/[MW@#%]/u.test(char)) return 1.4;
    if (/[{}]/u.test(char)) return 0;
    if (/[+\-=<>≤≥]/u.test(char)) return 1.15;
    if (WIDE_SYMBOLS.has(char)) return 2.0;
    if (/[\u2e80-\u9fff]/u.test(char)) return 1.8;
    return 1.0;
}

/** Read one TeX argument, preserving nested groups without losing fractions. */
function argumentAt(source: string, from: number): { value: string; end: number } | null {
    let i = from;
    while (i < source.length && /\s/u.test(source[i])) i++;
    if (source[i] !== '{') {
        if (i >= source.length) return null;
        if (source[i] === '\\') {
            const m = /^\\(?:[A-Za-z]+|.)/u.exec(source.slice(i));
            return m ? { value: m[0], end: i + m[0].length } : null;
        }
        return { value: source[i], end: i + 1 };
    }
    let depth = 0;
    for (let j = i; j < source.length; j++) {
        if (source[j] === '\\' && /[{}]/u.test(source[j + 1] || '')) { j++; continue; }
        if (source[j] === '{') depth++;
        if (source[j] === '}' && --depth === 0) {
            return { value: source.slice(i + 1, j), end: j + 1 };
        }
    }
    return null;
}

/** Approximate horizontal width of a single visible TeX/math row. */
function mathLineWidth(source: string, depth = 0): number {
    if (depth > 12) return 1e6; // Fail closed on malformed nesting.
    let width = 0;
    for (let i = 0; i < source.length;) {
        const c = source[i];
        if (c === '\\') {
            const matched = /^\\([A-Za-z]+|.)/u.exec(source.slice(i));
            if (!matched) { width += 2; i++; continue; }
            const name = matched[1];
            i += matched[0].length;
            if (['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr'].includes(name)) continue;
            if (['frac', 'dfrac', 'tfrac', 'binom'].includes(name)) {
                const a = argumentAt(source, i);
                const b = a && argumentAt(source, a.end);
                if (!a || !b) { width += 12; continue; }
                width += Math.max(mathLineWidth(a.value, depth + 1), mathLineWidth(b.value, depth + 1)) + 2.5;
                i = b.end;
                continue;
            }
            if (['sqrt', 'overline', 'underline', 'overrightarrow', 'vec', 'hat', 'bar'].includes(name)) {
                const a = argumentAt(source, i);
                if (!a) { width += 6; continue; }
                width += mathLineWidth(a.value, depth + 1) + (name === 'sqrt' ? 2 : 0.7);
                i = a.end;
                continue;
            }
            if (['text', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathbb', 'operatorname', 'ce', 'pu', 'boldsymbol'].includes(name)) {
                const a = argumentAt(source, i);
                if (a) { width += mathLineWidth(a.value, depth + 1); i = a.end; }
                else width += 2;
                continue;
            }
            if (name === 'qquad') { width += 5; continue; }
            if (name === 'quad') { width += 2.5; continue; }
            if ([';', ':', ',', '!', ' '].includes(name)) { width += 0.5; continue; }
            if (['Longrightarrow', 'Longleftarrow', 'longrightarrow', 'longleftarrow', 'rightleftharpoons'].includes(name)) { width += 3; continue; }
            if (['sin', 'cos', 'tan', 'log', 'lim', 'max', 'min', 'ln', 'det'].includes(name)) { width += name.length; continue; }
            // One displayed glyph, independent of long source macro name.
            width += ['to', 'rightarrow', 'leftarrow', 'leftrightarrow', 'implies', 'iff'].includes(name) ? 2 : 1.4;
            continue;
        }
        if (c === '^' || c === '_') {
            const a = argumentAt(source, i + 1);
            if (!a) { width += 2; i++; continue; }
            width += Math.max(0.6, mathLineWidth(a.value, depth + 1) * 0.6);
            i = a.end;
            continue;
        }
        if (c === '{') {
            const a = argumentAt(source, i);
            if (a) { width += mathLineWidth(a.value, depth + 1); i = a.end; continue; }
            width += 6; i++; continue;
        }
        width += glyphWidth(c);
        i++;
    }
    return width;
}

/** Estimates line width rather than cumulative length of multi-row TeX. */
export function estimateWordOptionMeasure(source: string): WordOptionMeasure {
    const raw = String(source ?? '');
    const structuredMath = MATH_ROWS.test(raw) || (MULTIROW_TEX.test(raw) && TEX_MATH.test(raw));
    const hardTextBreak = (HTML_BREAK.test(raw) || /[\r\n]/u.test(raw)) && !structuredMath;
    const media = MEDIA.test(raw);
    const uncertain = raw.length > 8000;
    const clean = raw
        .replace(/<br\s*\/?>|<\/(?:p|div|li)>/gi, '\n')
        .replace(/<[^>]*>/gu, '')
        .replace(/&(nbsp|lt|gt|amp|quot|apos);/gi, (_m, n: string) => ({nbsp:' ',lt:'<',gt:'>',amp:'&',quot:'"',apos:"'"}[n.toLowerCase() as 'nbsp'|'lt'|'gt'|'amp'|'quot'|'apos']))
        .replace(/\\begin\s*\{array\}\s*\{[^}]*\}/giu, '')
        .replace(/\\(?:begin|end)\s*\{[^}]*\}/giu, '')
        .replace(/\\(?:\(|\)|\[|\])/gu, '')
        .replace(/\${1,2}/gu, '');
    const rowSources = structuredMath ? clean.split(/\\\\(?:\[[^\]]*\])?/u) : clean.split(/[\r\n]+/u);
    const lineWidths = rowSources.map(row => {
        const parts = row.split('&');
        return parts.reduce((sum, part) => sum + mathLineWidth(part), 0) + Math.max(0, parts.length - 1) * 1.4;
    });
    const normalizedTokens = clean.replace(/\\[A-Za-z]+/gu,'x').replace(/[{}]/gu,' ').split(/\s+/u).filter(Boolean);
    const longestUnbroken = Math.max(0, ...normalizedTokens.map(v => [...v].length));
    return {
        maxLineWidth: Math.max(0, ...lineWidths),
        lineCount: Math.max(1, rowSources.length),
        longestUnbroken,
        structuredMath,
        hardTextBreak,
        media,
        uncertain
    };
}

/** Cost of option text at a given text-cell width, including math row height. */
function estimateLines(m: WordOptionMeasure, available: number): number {
    if (m.structuredMath) return m.lineCount;
    return Math.max(1, Math.ceil(m.maxLineWidth / available));
}

/** 4×1 for compact text, 2×2 for narrow multiline formulas, 1×4 for overflow. */
export function chooseWordOptionColumnCount(texts: readonly string[]): 1 | 2 | 4 {
    if (!texts.some(text => String(text ?? '').trim())) return 1;
    const metrics = texts.map(text => estimateWordOptionMeasure(text));
    if (metrics.some(m => m.media || m.uncertain || m.hardTextBreak)) return 1;
    const maxWidth = Math.max(...metrics.map(m => m.maxLineWidth));
    const totalWidth = metrics.reduce((n, m) => n + m.maxLineWidth, 0);
    const anyStructured = metrics.some(m => m.structuredMath);
    // 4.25 cm including label and padding. Never cram a 3-line system here.
    if (!anyStructured && maxWidth <= 15 && totalWidth <= 58 && metrics.every(m => m.longestUnbroken <= 15)) return 4;
    // Each 8.5-cm cell should hold an unwrapped equation line (~30 glyph units).
    if (anyStructured && metrics.some(m => m.maxLineWidth > 29 || m.lineCount > 7)) return 1;
    if (metrics.some(m => !m.structuredMath && m.longestUnbroken > 40)) return 1;
    // Prose can wrap; equation rows cannot be broken across columns.
    if (!anyStructured && (maxWidth > 80 || totalWidth > 250)) return 1;
    const twoRows = Math.max(estimateLines(metrics[0]!, 32), estimateLines(metrics[1]!, 32))
        + Math.max(estimateLines(metrics[2]!, 32), estimateLines(metrics[3]!, 32));
    const oneColumn = metrics.reduce((sum, m) => sum + estimateLines(m, 68), 0);
    return twoRows < oneColumn ? 2 : 1;
}
