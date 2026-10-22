/**
 * Native editable Office Math for LaTeX arrays carrying row/column rules.
 * docx's latexToMath supports matrix cells but does not preserve \hline or
 * the vertical separator in a {c|cc} column specification. Represent those
 * rules with MathBox borders on the corresponding equation cells; this keeps
 * the entire table inside Word's equation editor (no image or HTML fallback).
 */
import { Math as WordMath, MathBox, MathMatrix, MathRun, latexToMath } from 'docx/math';

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
