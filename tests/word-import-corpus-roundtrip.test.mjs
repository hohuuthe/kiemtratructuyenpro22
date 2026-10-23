import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { Math as WordMath } from 'docx/math';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseFormattedText, makeWordMathRun } from '../src/exam-docx-generator.ts';
import { inspectScientificDocx } from '../src/word-omml-reader.js';
import { verifyImportedWordQuestions, checkWordImportBeforeSave } from '../src/word-import-verification.js';
import { validateBatchPayload, MAX_WORD_IMPORT_QUESTIONS } from '../functions/api/questions/import-word.ts';

const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const output = 'artifacts/corpus-review';
const catalogue = JSON.parse(readFileSync('tests/fixtures/scientific-formulas-516.json', 'utf8'));
const ordinary = catalogue.cases.filter(row => !row.special);
// Every previously supported case is an acceptance contract. Do not increase
// this allowlist merely to hide a new conversion regression.
const expectedBlockedCaseIDs = [];
const serializer = new XMLSerializer();
const parser = new DOMParser();
const descendants = (node, namespace, tag) => Array.from(node.getElementsByTagNameNS(namespace, tag));
const formulaNodes = node => descendants(node, MATH_NS, 'oMath').filter(math => {
    for (let p = math.parentNode; p && p !== node; p = p.parentNode) {
        if (p.namespaceURI === MATH_NS && p.localName === 'oMath') return false;
    }
    return true;
});
const normalizeGlyphs = value => String(value).normalize('NFC')
    .replace(/[−﹣－]/gu, '-').replace(/[′’]/gu, "'")
    .replace(/[″]/gu, "''").replace(/[…]/gu, '...').replace(/[\s\u200B\uFEFF]/gu, '');

// This oracle reads the actual source Word XML independently of the importer's
// LaTeX output. It detects lost/added glyphs and reordered operands; it is not
// a claim that glyph equality alone proves every mathematical layout correct.
function glyphEvidence(math) {
    const textWithSpaces = descendants(math, MATH_NS, 't').map(n => n.textContent).join('')
        .normalize('NFC').replace(/[\u200B\uFEFF]/gu, '').replace(/\s+/gu, ' ');
    const text = normalizeGlyphs(textWithSpaces);
    const normalTextPhrases = descendants(math, MATH_NS, 'r').flatMap(run => {
        const upright = descendants(run, MATH_NS, 'sty').some(n => n.getAttributeNS(MATH_NS, 'val') === 'p')
            || descendants(run, MATH_NS, 'nor').some(n => !['0', 'false', 'off'].includes(n.getAttributeNS(MATH_NS, 'val')));
        const raw = descendants(run, MATH_NS, 't').map(n => n.textContent).join('').normalize('NFC');
        return upright && /\p{L}\s+\p{L}/u.test(raw) ? [raw.replace(/\s+/gu, ' ').trim()] : [];
    });
    return {
        text, textWithSpaces, normalTextPhrases,
        operands: text.replace(/[^\p{L}\p{N}]/gu, ''),
        glyphMultiset: Array.from(text).sort().join(''),
    };
}

async function pack(rows) {
    const children = rows.flatMap(row => [
        new Paragraph({children: [new TextRun({text: 'CORPUS-ID:' + row.id + ' '}), ...row.runs]}),
        new Paragraph({text: 'Đáp án: 1'}),
    ]);
    return new Uint8Array(await Packer.toBuffer(new Document({sections: [{children}]})));
}

async function inspectSourceIndependently(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    assert.ok(zip.file('[Content_Types].xml'), 'Corpus must be a complete OPC/Word package');
    assert.ok(zip.file('_rels/.rels'), 'Corpus must have the root package relationships');
    const documentXml = await zip.file('word/document.xml').async('string');
    const document = parser.parseFromString(documentXml, 'application/xml');
    const rows = descendants(document, WORD_NS, 'p').flatMap(paragraph => {
        const text = descendants(paragraph, WORD_NS, 't').map(n => n.textContent).join('');
        const match = /^CORPUS-ID:([^\s]+)\s?/.exec(text);
        if (!match) return [];
        return [{id: match[1], text, formulas: formulaNodes(paragraph).map(math => ({
            xml: serializer.serializeToString(math),
            ...glyphEvidence(math),
        }))}];
    });
    return {rows, equations: formulaNodes(document).length};
}

function questionsFromLines(report) {
    return report.lines.flatMap(line => {
        const match = /^CORPUS-ID:([^\s]+)\s?/.exec(line.text);
        if (!match) return [];
        return [{id: match[1], type: 'TL', level: 'NB', lesson: 'BÀI 1',
            content: line.text, answer: '1', options: {}}];
    });
}

test('All 516 source Word cases retain equation provenance and glyphs after re-export, or are explicitly blocked', {timeout: 180000}, async () => {
    mkdirSync(output, {recursive: true});
    assert.equal(ordinary.length, 516);
    assert.equal(new Set(ordinary.map(row => row.id)).size, 516, 'Catalogue IDs must remain unique');
    const source = await pack(ordinary.map(row => ({id: row.id, runs: parseFormattedText(row.latex)})));
    writeFileSync(output + '/corpus-source.docx', source);
    const original = await inspectSourceIndependently(source);
    assert.deepEqual(original.rows.map(row => row.id), ordinary.map(row => row.id));
    assert.ok(original.rows.every(row => row.formulas.length > 0), 'Every ordinary case must contain actual Word Equation objects');
    const report = await inspectScientificDocx(source);
    assert.equal(report.formulas.length, original.equations, 'Importer must account for every native source Equation');
    const rawQuestions = questionsFromLines(report);
    assert.deepEqual(rawQuestions.map(q => q.id), ordinary.map(row => row.id), 'Importer must not drop, duplicate or reorder question IDs');
    const verified = verifyImportedWordQuestions(rawQuestions, report);
    assert.deepEqual(verified.questions.map(q => q.id), ordinary.map(row => row.id));
    assert.equal(verified.stats.totalFormulaObjects, original.equations);
    assert.equal(verified.questions.flatMap(q => q.__wordFormulaSources).length, original.equations,
        'Every source Equation must have exactly one question provenance record');
    assert.equal(new Set(verified.questions.flatMap(q => q.__wordFormulaSources.map(s => s.token))).size, original.equations);

    const blocked = [], accepted = [], acceptedQuestionRecords = [], integrityErrors = [];
    const roundtripRows = [];
    for (let i = 0; i < verified.questions.length; i++) {
        const q = verified.questions[i], expected = original.rows[i];
        assert.equal(q.__wordFormulaSources.length, expected.formulas.length, q.id + ': Equation count changed');
        for (let j = 0; j < q.__wordFormulaSources.length; j++) {
            const sourceRecord = q.__wordFormulaSources[j];
            assert.equal(sourceRecord.sourceOmml, expected.formulas[j].xml, q.id + ': original Office Math provenance changed');
        }
        const verdict = checkWordImportBeforeSave([q], verified.documentIssues);
        if (!verdict.ok) {
            const issues = q.__wordImportIssues || [];
            assert.ok(verdict.errors.length > 0 && verdict.errors.every(e => String(e).trim()), q.id + ': blocked with no useful explanation');
            for (const pending of q.__wordFormulaSources.filter(s => s.status === 'review')) {
                assert.ok(pending.reason?.trim(), q.id + ': unsupported Equation has no reason');
                assert.ok(q.content.includes(pending.token), q.id + ': unsupported Equation placeholder was lost');
                assert.ok(issues.some(issue => issue.token === pending.token), q.id + ': unsupported Equation has no review issue');
            }
            blocked.push({id: q.id, latex: ordinary[i].latex, reasons: verdict.errors,
                equations: q.__wordFormulaSources.map(s => ({token: s.token, status: s.status, latex: s.latex, reason: s.reason}))});
            continue;
        }
        accepted.push(q.id);
        acceptedQuestionRecords.push(q);
        for (let j = 0; j < q.__wordFormulaSources.length; j++) {
            const sourceRecord = q.__wordFormulaSources[j];
            assert.equal(sourceRecord.status, 'verified', q.id + ': accepted Equation was not verified');
            const run = makeWordMathRun(sourceRecord.latex);
            assert.ok(run instanceof WordMath, q.id + ': accepted Equation cannot be exported as editable Word Math');
            roundtripRows.push({id: q.id + '__' + j, runs: [run], original: expected.formulas[j],
                originalLatex: ordinary[i].latex, importedLatex: sourceRecord.latex});
        }
    }
    // Prevent a test that silently passes by blocking the entire corpus.
    for (const id of ['MAT-001', 'MAT-002', 'MAT-003', 'MAT-004', 'MAT-008', 'MAT-011']) {
        assert.ok(accepted.includes(id), id + ': core supported mathematics must remain importable');
    }
    const apiChecks = [];
    const sourceSha256 = createHash('sha256').update(source).digest('hex');
    for (let offset = 0; offset < acceptedQuestionRecords.length; offset += MAX_WORD_IMPORT_QUESTIONS) {
        const questions = acceptedQuestionRecords.slice(offset, offset + MAX_WORD_IMPORT_QUESTIONS).map(q => ({
            id: 'corpus-' + q.id, type: q.type, level: q.level, lesson: q.lesson,
            content: q.content, answer: q.answer, options: q.options, image: '',
            formulaSources: structuredClone(q.__wordFormulaSources), reviewPending: false, importIssues: [],
        }));
        const payload = {batchId: 'corpus-omml-batch-' + offset, fileName: 'corpus-source.docx',
            sourceSha256, engineVersion: report.engineVersion, questions};
        // Exercise the real API's pure validation function. No HTTP endpoint,
        // DB connection or persistence routine is invoked by this contract.
        apiChecks.push({questionIDs: questions.map(q => q.id), count: questions.length,
            equations: questions.reduce((n, q) => n + q.formulaSources.length, 0),
            errors: validateBatchPayload(payload)});
    }
    const reexported = await pack(roundtripRows);
    writeFileSync(output + '/corpus-reexported.docx', reexported);
    const after = await inspectSourceIndependently(reexported);
    assert.equal(after.equations, roundtripRows.length, 'Re-export must preserve the accepted Equation count');
    assert.deepEqual(after.rows.map(row => row.id), roundtripRows.map(row => row.id));
    for (let i = 0; i < roundtripRows.length; i++) {
        const row = roundtripRows[i], now = after.rows[i];
        assert.equal(now.formulas.length, 1, row.id + ': re-export changed Equation granularity');
        const a = row.original, b = now.formulas[0];
        const missingPhrases = a.normalTextPhrases.filter(phrase => !b.textWithSpaces.includes(phrase));
        if (a.operands !== b.operands || a.glyphMultiset !== b.glyphMultiset || missingPhrases.length) {
            integrityErrors.push({id: row.id, originalLatex: row.originalLatex, importedLatex: row.importedLatex,
                sourceText: a.text, reexportedText: b.text, sourceOperands: a.operands, reexportedOperands: b.operands,
                missingPhrases,
                sourceOmml: a.xml, reexportedOmml: b.xml});
        }
    }
    const summary = {totalCases: ordinary.length, sourceEquations: original.equations,
        acceptedQuestions: accepted.length, acceptedEquations: roundtripRows.length,
        blockedQuestions: blocked.length, blocked, integrityErrors,
        apiValidatedQuestions: apiChecks.filter(b => !b.errors.length).reduce((n, b) => n + b.count, 0),
        apiValidatedEquations: apiChecks.filter(b => !b.errors.length).reduce((n, b) => n + b.equations, 0),
        apiChecks,
        scope: 'Offline Word package import/re-export; no database or production writes; glyph preservation is necessary but not sufficient for complete mathematical equivalence.'};
    writeFileSync(output + '/corpus-roundtrip.json', JSON.stringify(summary, null, 2));
    console.log('WORD_CORPUS_ROUNDTRIP', JSON.stringify({totalCases: summary.totalCases, sourceEquations: summary.sourceEquations,
        acceptedQuestions: summary.acceptedQuestions, acceptedEquations: summary.acceptedEquations,
        blockedQuestions: summary.blockedQuestions, apiValidatedQuestions: summary.apiValidatedQuestions,
        apiValidatedEquations: summary.apiValidatedEquations, apiBatchSizes: apiChecks.map(b => b.count),
        apiErrors: apiChecks.flatMap(b => b.errors),
        integrityErrors: integrityErrors.map(e => ({id: e.id, sourceText: e.sourceText, reexportedText: e.reexportedText, missingPhrases: e.missingPhrases}))}));
    assert.deepEqual(blocked.map(q => q.id), expectedBlockedCaseIDs,
        'Supported corpus changed: newly blocked cases must not be silently allowed');
    assert.deepEqual(apiChecks.flatMap(b => b.errors), [],
        'API rejected an Equation that preview verified; see artifacts/corpus-review/corpus-roundtrip.json');
    assert.equal(summary.apiValidatedQuestions, accepted.length);
    assert.equal(summary.apiValidatedEquations, roundtripRows.length);
    assert.deepEqual(integrityErrors.map(e => ({id: e.id, sourceText: e.sourceText, reexportedText: e.reexportedText, missingPhrases: e.missingPhrases})), [],
        'Accepted Word Equations changed source glyphs/operand order; see artifacts/corpus-review/corpus-roundtrip.json');
});

test('Clearly malformed LaTeX copied as Word text is held for review without source repair', async () => {
    // Some catalogue special cases are valid delimiters or prose, so only
    // explicitly malformed formula syntax belongs in this negative contract.
    const ids = ['NEG-001', 'NEG-002', 'NEG-003', 'NEG-004', 'NEG-005', 'NEG-006',
        'NEG-015', 'NEG-016', 'NEG-017', 'NEG-018', 'NEG-019'];
    const rows = ids.map(id => catalogue.cases.find(row => row.id === id));
    assert.ok(rows.every(Boolean));
    const source = await pack(rows.map(row => ({id: row.id, runs: [new TextRun({text: '$' + row.latex + '$'})]})));
    const report = await inspectScientificDocx(source);
    assert.equal(report.formulas.length, 0, 'Plain Word text must not be invented as native Equation');
    const raw = questionsFromLines(report);
    const verified = verifyImportedWordQuestions(raw, report);
    const unexpectedlyAccepted = [];
    for (let i = 0; i < rows.length; i++) {
        const q = verified.questions[i];
        assert.ok(q.content.includes(rows[i].latex), rows[i].id + ': malformed source text was changed');
        const verdict = checkWordImportBeforeSave([q], verified.documentIssues);
        if (verdict.ok) unexpectedlyAccepted.push({id: rows[i].id, latex: rows[i].latex});
        else assert.ok(verdict.errors.length, rows[i].id + ': invalid source blocked without diagnostics');
    }
    mkdirSync(output, {recursive: true});
    writeFileSync(output + '/malformed-text-results.json', JSON.stringify({total: rows.length, unexpectedlyAccepted}, null, 2));
    assert.deepEqual(unexpectedlyAccepted, [], 'Malformed Word formula text must not be silently approved');
});
