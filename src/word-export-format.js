/**
 * The Equation route is intentionally a zero-transform identity operation.
 * It does not import a MathType module or access its feature gate.
 * Native MathType editing qualification is NOT yet available: disabled by default.
 */
import { MathTypeExportError } from './word-mathtype-export/errors.js';
export const WORD_EQUATION_FORMATS = Object.freeze(['equation', 'mathtype']);
export const MATHTYPE_EXPORT_QUALIFICATION = Object.freeze({
  enabled: false,
  nativeEditorVerified: false,
  reason: 'Pending Microsoft Word desktop and MathType open-edit-save qualification.'
});
export async function finalizeWordExport(equationBlob, options = {}) {
  const format = options.equationFormat ?? 'equation';
  if (format === 'equation') return equationBlob;
  if (format !== 'mathtype') throw new MathTypeExportError('INVALID_FORMAT', 'Unknown Word equation format.');
  if (!MATHTYPE_EXPORT_QUALIFICATION.enabled || !MATHTYPE_EXPORT_QUALIFICATION.nativeEditorVerified) {
    throw new MathTypeExportError('NATIVE_ACCEPTANCE_REQUIRED',
      'MathType export is not yet qualified for production. Equation Word remains available.');
  }
  const { convertDocxToMathType } = await import('./word-mathtype-export/docx-converter.js');
  return (await convertDocxToMathType(equationBlob, options)).blob;
}
