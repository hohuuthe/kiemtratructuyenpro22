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

test('ready download is inert until user explicitly clicks it', async () => {
    let opened = 0, wrote = 0, saved = 0, cancelled = 0, browserDownloads = 0;
    const listeners = new Map();
    const link = {
        setAttribute() {},
        addEventListener(name, fn) { listeners.set(name, fn); },
        click() {
            const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
            listeners.get('click')?.(event);
            if (!event.defaultPrevented) browserDownloads++;
            return event;
        }
    };
    const doc = { createElement(type) { assert.equal(type, 'a'); return link; } };
    const urls = { createObjectURL() { return 'blob:generated'; }, revokeObjectURL() {} };
    const download = createQuestionBankWordDownload(docx, filename, {
        document: doc, urlApi: urls,
        picker: () => { opened++; return { createWritable: async () => ({
            write: async data => { assert.equal(data, docx); wrote++; },
            close: async () => {}
        }) }; },
        onSaved: () => { saved++; },
        onCancelled: () => { cancelled++; }
    });
    assert.deepEqual([opened, wrote, saved, browserDownloads], [0, 0, 0, 0],
        'Creating DOCX/link must not open Save As or download anything');
    assert.equal(download.link.click().defaultPrevented, true);
    assert.equal(opened, 1, 'Picker opens from the real download click only');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([wrote, saved, cancelled, browserDownloads], [1, 1, 0, 0]);
    download.release();
});

test('user cancelling Save As keeps the generated DOCX ready; unsupported picker falls back on a later click', async () => {
    const links = [];
    const doc = { createElement() {
        const listeners = new Map();
        const link = {
            setAttribute() {}, addEventListener(name, fn) { listeners.set(name, fn); },
            click() { let prevented = false; listeners.get('click')?.({preventDefault(){ prevented=true; }}); return prevented; }
        };
        links.push(link); return link;
    } };
    const urls = {createObjectURL(){return 'blob:ready';},revokeObjectURL(){}};
    let cancelled = 0, errors = 0, browser = 0, opens = 0;
    const cancelledDownload = createQuestionBankWordDownload(docx, filename, {
        document:doc,urlApi:urls,
        picker: () => { opens++; return Promise.reject(Object.assign(new Error('cancelled'),{name:'AbortError'})); },
        onCancelled: () => { cancelled++; }
    });
    assert.equal(cancelledDownload.link.click(),true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(cancelled,1);
    assert.equal(cancelledDownload.link.click(),true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(opens,2,'Cancel must not invalidate the ready file');

    const fallback = createQuestionBankWordDownload(docx, filename, {
        document:doc,urlApi:urls,picker:()=>{throw new Error('unavailable');},
        onError:()=>{errors++;},onBrowserDownload:()=>{browser++;}
    });
    assert.equal(fallback.link.click(),true,'first click tries native picker');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(errors,1);
    assert.equal(fallback.link.click(),false,'second user click uses native browser download');
    assert.equal(browser,1);

    const basic = createQuestionBankWordDownload(docx, filename, {
        document:doc,urlApi:urls,onBrowserDownload:()=>{browser++;}
    });
    assert.equal(basic.link.click(),false);
    assert.equal(browser,2,'No picker means only manual anchor download');
});

test('Export Word UI keeps the file ready and never launches Save As/download while generating', () => {
    const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const start = source.indexOf('window.executeExportWord = async');
    const end = source.indexOf('window.exportStatsToExcel = async', start);
    assert.ok(start >= 0 && end > start, 'Cannot locate the Word export handler');
    const handler = source.slice(start, end);
    const helper = readFileSync(new URL('../src/question-bank-word-download.js', import.meta.url), 'utf8');
    assert.doesNotMatch(handler, /beginQuestionBankWordSavePicker\s*\(/);
    assert.doesNotMatch(handler, /writeQuestionBankWordFile\s*\(/);
    assert.doesNotMatch(handler, /\.link\.click\s*\(/);
    assert.doesNotMatch(handler, /showSaveFilePicker\s*\(/);
    assert.ok(helper.includes("link.addEventListener('click'"), 'Save picker is owned by the final link');
    assert.ok(helper.includes('event.preventDefault()'));
    for (const expected of [
        'downloadPanel.appendChild(wordDownload.link)',
        'bankWordDownloadReleases.push(wordDownload.release)',
        'signature[0] !== 0x50',
        'modal._wordDownloadSignature = exportSignature',
        'resetQuestionBankWordReady(modal)',
        'Đã tạo Word'
    ]) assert.ok(handler.includes(expected), 'Missing download safeguard: ' + expected);
    assert.ok(!handler.includes('modal.remove();'), 'Keep the modal for an explicit download');
    assert.ok(source.includes('id="exp-download-ready"'));
    assert.ok(source.includes('window.closeQuestionBankWordModal'));
    assert.ok(source.includes('bankWordDownloadReleases.splice(0)'));
    assert.ok(source.includes('currentSignature !== modal._wordDownloadSignature'),
        'Changing selection/formula type must invalidate a previously generated file');
});
