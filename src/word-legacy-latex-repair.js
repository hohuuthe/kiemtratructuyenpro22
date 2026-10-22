/**
 * Narrow, source-preserving repair for historic malformed LaTeX in archived
 * scientific questions. Repairs only structural delimiters (row breaks and an
 * unmatched TeX math marker), never coefficients, operands or answer values.
 *
 * No database mutations. Imported source is preserved and can be corrected in
 * the original question editor; only the DOCX equation input is normalized.
 */
export function repairLegacyScientificLatexForWord(source) {
    const input = String(source ?? '');
    const repairs = [];
    let output = input;

    // One '$' inside an already isolated math expression is a broken markup
    // delimiter, not a mathematical operation. Preserve every other character.
    const dollarIndices = [];
    for (let i = 0; i < output.length; i++) {
        if (output[i] !== '$') continue;
        let slashes = 0;
        for (let j = i - 1; j >= 0 && output[j] === '\\'; j--) slashes++;
        if (slashes % 2 === 0) dollarIndices.push(i);
    }
    if (dollarIndices.length === 1 && /\\(?:angle|triangle|circ|frac|sqrt)\b/.test(output) &&
        output.includes('=')) {
        const at = dollarIndices[0];
        output = output.slice(0, at) + output.slice(at + 1);
        repairs.push('unmatched-inline-math-delimiter');
    }

    const environments = /\\begin\{(cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|aligned|align|array)\}([\s\S]*?)\\end\{\1\}/g;
    output = output.replace(environments, (whole, env, originalBody) => {
        let body = originalBody;
        // Explicit row start must be a single-letter term followed by a
        // relational / arithmetic operator. \le, \ge, \frac, etc. are not
        // touched because those are real TeX commands.
        if (env === 'cases') {
            body = body.replace(/(?<!\\)\\([A-Za-z])(?=[+\-*\/=<>\d])/g, '\\\\$1');
        } else if (/^(matrix|pmatrix|bmatrix|vmatrix|Vmatrix)$/.test(env)) {
            // A subsequent row has a new first cell ending at the next '&'.
            body = body.replace(/(?<!\\)\\([A-Za-z])(?=&)/g, '\\\\$1');
        } else if (/^(aligned|align)$/.test(env)) {
            // Each aligned row contains '&'. Do not alter TeX operators
            // or commands such as \frac because they aren't row headers.
            body = body.replace(/(?<!\\)\\(?=[A-Za-z]+(?:'+)?(?:\([^()]*\))?&)/g, '\\\\');
        } else if (env === 'array') {
            // \hline is an actual table rule following a row terminator.
            if (/(?<!\\)\\hline\b/.test(body)) {
                const offset = body.indexOf('{') === 0 ? (body.indexOf('}') + 1) : 0;
                const columnBody = body.slice(offset);
                if (columnBody.includes('&')) {
                    body = body.replace(/(?<!\\)\\hline\b/g, '\\\\\\hline');
                }
            }
            body = body.replace(/(?<!\\)\\([A-Za-z])(?=&)/g, '\\\\$1');
        }
        if (body !== originalBody) repairs.push('missing-' + env + '-row-separator');
        return whole.replace(originalBody, body);
    });

    return { latex: output, repairs, changed: output !== input };
}
