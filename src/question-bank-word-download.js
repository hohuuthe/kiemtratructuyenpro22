/**
 * Question bank DOCX download delivery.
 *
 * Generation and saving are separate user actions. Never invoke the save
 * picker or click a download link while building the DOCX. Only a genuine
 * click on the ready download link may open the native save picker, or
 * download directly in browsers without File System Access support.
 */

export const QUESTION_BANK_WORD_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Must be invoked synchronously from the user's Download Word click, after generation. */
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

  // Native "Save As" must be opened by the DOWNLOAD gesture, never by the
  // preceding async DOCX generation action. Without this browser API, the
  // native <a download> action remains the regular user-initiated fallback.
  const picker = options.picker;
  if (typeof link.addEventListener === 'function') {
    if (typeof picker !== 'function') {
      link.addEventListener('click', () => options.onBrowserDownload?.());
    } else {
    let saving = false, pickerAvailable = true;
    link.addEventListener('click', event => {
      if (!pickerAvailable) {
        options.onBrowserDownload?.();
        return; // Allow the browser's regular download.
      }
      event.preventDefault();
      if (saving || released) return;
      saving = true;
      // The picker must start synchronously, before the first await.
      const saveRequest = beginQuestionBankWordSavePicker(filename, picker);
      Promise.resolve(saveRequest).then(async choice => {
        if (choice?.error?.name === 'AbortError') {
          options.onCancelled?.();
          return;
        }
        if (choice?.error) throw choice.error;
        if (!choice?.handle) throw new Error('Không mở được hộp thoại lưu Word.');
        await writeQuestionBankWordFile(choice.handle, blob);
        options.onSaved?.();
      }).catch(error => {
        // On the NEXT real click, use the browser's built-in download path.
        // Do not synthesize another click: that could download unexpectedly.
        pickerAvailable = false;
        options.onError?.(error);
      }).finally(() => { saving = false; });
    });
    }
  }

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
