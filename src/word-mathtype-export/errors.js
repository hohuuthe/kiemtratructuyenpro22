/** Errors are safe to show to the exporting teacher. No source text is logged. */
export class MathTypeExportError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'MathTypeExportError'; this.code = code; this.details = details;
  }
}
export function fail(code, message, details) { throw new MathTypeExportError(code, message, details); }
export function aborted(signal) {
  if (signal?.aborted) fail('ABORTED', 'MathType export was cancelled. No document was changed.');
}
