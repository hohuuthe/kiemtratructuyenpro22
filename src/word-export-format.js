/**
 * Equation remains an identity operation. MathType is exposed only on Cloudflare
 * branch/commit Preview hosts until native Word + MathType acceptance is complete.
 */
import { MathTypeExportError } from './word-mathtype-export/errors.js';

export const WORD_EQUATION_FORMATS = Object.freeze(['equation', 'mathtype']);
export const MATHTYPE_EXPORT_QUALIFICATION = Object.freeze({
  productionEnabled: false,
  nativeEditorVerified: false,
  reason: 'Preview qualification only; Production stays locked pending Word + MathType open-edit-save acceptance.'
});

export function isMathTypePreviewHost(hostname = globalThis.location?.hostname || '') {
  const host=String(hostname||'').toLowerCase();
  // Cloudflare branch/commit preview URLs have a prefix before the project host.
  // The bare project pages.dev host and all custom production domains stay locked.
  return /^[a-z0-9-]+\.kiemtratructuyenpro\.pages\.dev$/i.test(host) &&
    host !== 'kiemtratructuyenpro.pages.dev';
}

export function canExportMathTypeHere(hostname = globalThis.location?.hostname || '') {
  return MATHTYPE_EXPORT_QUALIFICATION.productionEnabled &&
      MATHTYPE_EXPORT_QUALIFICATION.nativeEditorVerified ||
    isMathTypePreviewHost(hostname);
}

export async function finalizeWordExport(equationBlob, options = {}) {
  const format = options.equationFormat ?? 'equation';
  if (format === 'equation') return equationBlob;
  if (format !== 'mathtype') throw new MathTypeExportError('INVALID_FORMAT', 'Unknown Word equation format.');
  if (!canExportMathTypeHere(options.hostname)) {
    throw new MathTypeExportError('NATIVE_ACCEPTANCE_REQUIRED',
      'MathType chỉ đang mở trên Cloudflare Preview. Equation Word vẫn hoạt động bình thường.');
  }
  const [{convertDocxToMathType},{createBrowserMathTypePreviewRenderer}] = await Promise.all([
    import('./word-mathtype-export/docx-converter.js'),
    import('./word-mathtype-export/preview-browser-mathjax.js')
  ]);
  const renderPreview=options.renderPreview || createBrowserMathTypePreviewRenderer();
  return (await convertDocxToMathType(equationBlob,{...options,renderPreview})).blob;
}
