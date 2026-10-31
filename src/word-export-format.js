/**
 * Equation remains an identity operation. MathType is available on Production and
 * Preview when explicitly selected; native-editor acceptance is tracked separately.
 */
import { MathTypeExportError } from './word-mathtype-export/errors.js';

export const WORD_EQUATION_FORMATS = Object.freeze(['equation', 'mathtype']);
export const MATHTYPE_EXPORT_QUALIFICATION = Object.freeze({
  productionEnabled: true,
  nativeEditorVerified: false,
  reason: 'Production enabled by project owner request; native Word + MathType open-edit-save acceptance remains tracked separately.'
});

export function isMathTypePreviewHost(hostname = globalThis.location?.hostname || '') {
  const host=String(hostname||'').toLowerCase();
  // Cloudflare branch/commit preview URLs have a prefix before the project host.
  // The bare project pages.dev host and all custom production domains stay locked.
  return /^[a-z0-9-]+\.kiemtratructuyenpro\.pages\.dev$/i.test(host) &&
    host !== 'kiemtratructuyenpro.pages.dev';
}

export function canExportMathTypeHere(hostname = globalThis.location?.hostname || '') {
  if (MATHTYPE_EXPORT_QUALIFICATION.productionEnabled) return true;
  return isMathTypePreviewHost(hostname);
}

export async function finalizeWordExport(equationBlob, options = {}) {
  const format = options.equationFormat ?? 'equation';
  if (format === 'equation') return equationBlob;
  if (format !== 'mathtype') throw new MathTypeExportError('INVALID_FORMAT', 'Unknown Word equation format.');
  if (!canExportMathTypeHere(options.hostname)) {
    throw new MathTypeExportError('MATHTYPE_EXPORT_DISABLED',
      'MathType OLE hiện đang bị tắt. Equation Word vẫn hoạt động bình thường.');
  }
  const [{convertDocxToMathType},previewModule] = await Promise.all([
    import('./word-mathtype-export/docx-converter.js'),
    import('./word-mathtype-export/preview-browser-mathjax.js')
  ]);
  const renderPreview=options.renderPreview || previewModule.createBrowserMathTypePreviewRenderer();
  const renderPreviewBatch=options.renderPreviewBatch || previewModule.createBrowserMathTypePreviewBatchRenderer?.();
  return (await convertDocxToMathType(equationBlob,{...options,renderPreview,renderPreviewBatch})).blob;
}
