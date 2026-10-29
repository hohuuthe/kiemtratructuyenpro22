import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
    QUESTION_BANK_WORD_MIME,
    beginQuestionBankWordSavePicker,
    writeQuestionBankWordFile,
    createQuestionBankWordDownload
} from '../src/question-bank-word-download.js';

const filename = 'NganHangCauHoi_2026-10-29.docx';
const docx = new Blob([Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), new Uint8Array(2048)], {
    type: QUESTION_BANK_WORD_MIME
});

test('native save picker starts synchronously in the user gesture and writes a real Word file', async () => {
    let pickerCalled = false, wrote = false, closed = false;
    const pickerRequest = beginQuestionBankWordSavePicker(filename, options => {
        pickerCalled = true;
        assert.equal(options.suggestedName, filename);
        assert.deepEqual(options.types[0].accept[QUESTION_BANK_WORD_MIME], ['.docx']);
        return { createWritable: async () => ({
            write: async blob => { assert.equal(blob, docx); wrote = true; },
            close: async () => { assert.equal(wrote, true); closed = true; }
        }) };
    });
    assert.equal(pickerCalled, true, 'The picker must be opened before the first await');
    const result = await pickerRequest;
    assert.equal(await writeQuestionBankWordFile(result.handle, docx), true);
    assert.equal(closed, true, 'Only closing the writer confirms that saving finished');
});

test('missing picker, user cancellation and disk failure do not report saved', async () => {
    assert.equal(beginQuestionBankWordSavePicker(filename), null);
    const cancel = beginQuestionBankWordSavePicker(filename, () =>
        Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })));
    assert.equal((await cancel).error.name, 'AbortError');
    assert.equal(await writeQuestionBankWordFile(null, docx), false);

    let aborted = false;
    const failed = await beginQuestionBankWordSavePicker(filename, () => ({
        createWritable: async () => ({
            write: async () => { throw new Error('disk full'); },
            close: async () => { throw new Error('unexpected close'); },
            abort: async () => { aborted = true; }
        })
    }));
    await assert.rejects(writeQuestionBankWordFile(failed.handle, docx), /disk full/);
    assert.equal(aborted, true, 'Partial writes must be aborted after error');
});

test('fallback link remains available for a genuine user click and releases only on close', () => {
    let revoked = 0, clicked = 0;
    const doc = { createElement(type) {
        assert.equal(type, 'a');
        return { setAttribute() {}, click() { clicked++; } };
    } };
    const urlApi = {
        createObjectURL(blob) { assert.equal(blob, docx); return 'blob:ready-word'; },
        revokeObjectURL(url) { assert.equal(url, 'blob:ready-word'); revoked++; }
    };
    const download = createQuestionBankWordDownload(docx, filename, { document: doc, urlApi });
    assert.equal(download.link.href, 'blob:ready-word');
    assert.equal(download.link.download, filename);
    assert.equal(download.link.type, QUESTION_BANK_WORD_MIME);
    download.link.click();
    assert.equal(clicked, 1);
    assert.equal(revoked, 0, 'Never revoke while the modal offers the fallback');
    download.release();
    download.release();
    assert.equal(revoked, 1, 'Dispose is idempotent');
    assert.throws(() => createQuestionBankWordDownload(new Blob(['bad']), filename, {document:doc,urlApi}), /hợp lệ/);
});

test('Export Word UI keeps download reachable after async generation and avoids false success', () => {
    const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const start = source.indexOf('window.executeExportWord = async');
    const end = source.indexOf('window.exportStatsToExcel = async', start);
    assert.ok(start >= 0 && end > start, 'Cannot locate the Word export handler');
    const handler = source.slice(start, end);
    const picker = handler.indexOf('beginQuestionBankWordSavePicker(');
    const firstAwait = handler.indexOf('await loadVerifiedQuestionBankWordInventory()');
    assert.ok(picker >= 0 && picker < firstAwait, 'Save picker must start inside the click gesture');
    for (const expected of [
        'await writeQuestionBankWordFile(choice.handle, blob)',
        'downloadPanel.appendChild(wordDownload.link)',
        'bankWordDownloadReleases.push(wordDownload.release)',
        'signature[0] !== 0x50',
        'pickerCancelled'
    ]) assert.ok(handler.includes(expected), 'Missing download safeguard: ' + expected);
    assert.ok(handler.includes('Nếu trình duyệt chưa tải tự động'));
    assert.ok(!handler.includes('modal.remove();'), 'Do not close a modal while manual retry is needed');
    assert.ok(!handler.includes('download.remove();'), 'Do not detach the only download link');
    assert.ok(source.includes('id="exp-download-ready"'));
    assert.ok(source.includes('window.closeQuestionBankWordModal'));
    assert.ok(source.includes('bankWordDownloadReleases.splice(0)'));
});
