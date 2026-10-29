/**
 * Question bank DOCX download delivery.
 *
 * Packer.toBlob() completing does NOT prove the browser accepted a synthetic
 * anchor click. Prefer a native user-activated save picker when supported; in
 * other browsers keep a REAL clickable download link visible after generation.
 * Never report a browser download as confirmed just because link.click() ran.
 */

export const QUESTION_BANK_WORD_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Must be invoked synchronously from the user's Export Word click. */
export function beginQuestionBankWordSavePicker(filename, picker) {
  if (typeof picker !== 'function') return null;
  try {
    return Promise.resolve(picker({
      suggestedName: filename,
      types: [{ description: 'Microsoft Word (.docx)',
        accept: { [QUESTION_BANK_WORD_MIME]: ['.docx'] } }]
    })).then(handle => ({ handle }), error => ({ error }));
  } catch (error) {
    return Promise.resolve({ error });
  }
}

/** Resolves only after the browser has finished writing and closing the file. */
export async function writeQuestionBankWordFile(handle, blob) {
  if (!handle || typeof handle.createWritable !== 'function') return false;
  let writer;
  try {
    writer = await handle.createWritable();
    await writer.write(blob);
    await writer.close();
    return true;
  } catch (error) {
    if (writer && typeof writer.abort === 'function') {
      try { await writer.abort(); } catch { /* Preserve the original failure. */ }
    }
    throw error;
  }
}

/** A persistent DOM link for browsers which block download after async work. */
export function createQuestionBankWordDownload(blob, filename, options = {}) {
  if (!blob || !Number.isFinite(blob.size) || blob.size < 1000) {
    throw new Error('Tệp Word chưa được tạo hợp lệ.');
  }
  if (typeof filename !== 'string' || !/\.docx$/i.test(filename)) {
    throw new Error('Tên tệp Word không hợp lệ.');
  }
  const doc = options.document || document;
  const api = options.urlApi || URL;
  const objectUrl = api.createObjectURL(blob);
  let released = false;
  const link = doc.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.type = QUESTION_BANK_WORD_MIME;
  link.textContent = '⬇️ Tải file Word (.docx)';
  link.className =
    'inline-flex justify-center items-center rounded-xl bg-emerald-600 ' +
    'hover:bg-emerald-700 text-white px-5 py-3 text-sm font-bold ' +
    'shadow-md cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2';
  link.setAttribute('aria-label', 'Tải tệp Word ' + filename);
  return {
    link,
    objectUrl,
    release() {
      if (released) return;
      released = true;
      api.revokeObjectURL(objectUrl);
    }
  };
}
