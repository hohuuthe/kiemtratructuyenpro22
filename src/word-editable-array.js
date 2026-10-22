/**
 * Native editable Office Math for LaTeX arrays carrying row/column rules.
 * docx's latexToMath supports matrix cells but does not preserve \hline or
 * the vertical separator in a {c|cc} column specification. Represent those
 * rules with MathBox borders on the corresponding equation cells; this keeps
 * the entire table inside Word's equation editor (no image or HTML fallback).
 */
import { Math as WordMath, MathBox, MathMatrix, MathEquationArray, MathRun, latexToMath } from 'docx/math';

export function makeEditableWordBorderedArray(source) {
    const input = String(source || '').trim();
    const match = /^\\begin\{array\}\{([clr|]+)\}([\s\S]*?)\\end\{array\}$/.exec(input);
    if (!match) return null;
    const spec = match[1];
    if (!spec.includes('|') && !match[2].includes('\\hline')) return null;

    const alignment = [];
    const verticalRulesAfter = new Set();
    for (const item of spec) {
        if (item === '|') {
            if (!alignment.length || verticalRulesAfter.has(alignment.length - 1)) return null;
            verticalRulesAfter.add(alignment.length - 1);
        } else {
            alignment.push(item === 'l' ? 'left' : item === 'r' ? 'right' : 'center');
        }
    }
    if (!alignment.length || alignment.length > 64) return null;

    const rows = [];
    const bottomRuleAfter = new Set();
    let topRule = false;
    const sourceRows = match[2].split('\\\\');
    for (const raw of sourceRows) {
        let text = raw.trim();
        while (text.startsWith('\\hline')) {
            if (rows.length) bottomRuleAfter.add(rows.length - 1);
            else topRule = true;
            text = text.slice('\\hline'.length).trimStart();
        }
        if (!text) continue;
        const cells = text.split('&');
        if (cells.length !== alignment.length || rows.length >= 256) return null;
        rows.push(cells.map(s => s.trim()));
    }
    if (!rows.length) return null;

    // MathBox applies a true OMML bottom/right border. It is editable as
    // a math structure and does not insert any spurious numeric matrix row.
    const renderedRows = rows.map((cells, rowIndex) => cells.map((cell, colIndex) => {
        const content = cell ? latexToMath(cell) : [new MathRun(' ')];
        const borders = [];
        if (verticalRulesAfter.has(colIndex)) borders.push('right');
        if (bottomRuleAfter.has(rowIndex)) borders.push('bottom');
        if (topRule && rowIndex === 0) borders.push('top');
        return borders.length ? [new MathBox({children:content, borders})] : content;
    }));

    return new WordMath({
        children: [new MathMatrix({rows:renderedRows, columnAlignment:alignment})],
    });
}


/**
 * Build a real Word equation array for aligned multiline LaTeX instead of
 * serializing the alignment '&' into a single apparent equation line.
 * Source validation is conservative: malformed rows are left to the caller's
 * normal (non-destructive) handling rather than guessed.
 */
export function makeEditableWordAlignedEquation(source) {
    const input = String(source ?? '').trim();
    const environment = /^\\begin\{(aligned|align)\}([\s\S]*?)\\end\{\1\}$/.exec(input);
    if (!environment) return null;

    // Only split at depth zero. Fractions, groups and escaped tokens must
    // never be mistaken for alignment points or row separators.
    function splitStructure(text, separator) {
        const parts = [];
        let depth = 0, start = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '\\') {
                if (text[i + 1] === '\\') {
                    if (separator === '\\\\' && depth === 0) {
                        parts.push(text.slice(start, i));
                        start = i + 2;
                    }
                    i++;
                    continue;
                }
                if (text[i + 1] === '{' || text[i + 1] === '}' || text[i + 1] === '&') {
                    i++;
                    continue;
                }
            }
            if (char === '{') { depth++; continue; }
            if (char === '}') {
                depth--;
                if (depth < 0) return null;
                continue;
            }
            if (separator === '&' && char === '&' && depth === 0) {
                parts.push(text.slice(start, i));
                start = i + 1;
            }
        }
        if (depth !== 0) return null;
        parts.push(text.slice(start));
        return parts;
    }

    const sourceRows = splitStructure(environment[2], '\\\\');
    if (!sourceRows || sourceRows.length < 2 || sourceRows.length > 128) return null;
    const rows = [];
    for (const row of sourceRows) {
        const segments = splitStructure(row, '&');
        if (!segments || !segments.length || segments.length > 8 ||
            segments.every(segment => !segment.trim())) return null;
        rows.push({
            parts: segments.map(segment =>
                segment.trim() ? latexToMath(segment.trim()) : [new MathRun(' ')])
        });
    }
    return new WordMath({ children: [new MathEquationArray({ rows })] });
}
