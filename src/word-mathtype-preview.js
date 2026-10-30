/** Read MTEF comments, never drawing commands, from an optional MathType WMF preview.
 * Wiris SDK: How MTEF is stored in files and objects / AppsMFCC convention.
 * Used only to detect unsynchronised OLE and cached-preview sources; never OCR.
 */
const LIMIT = 4 * 1024 * 1024;
const MTEF_LIMIT = 96 * 1024;
const bad = reason => { throw new Error('MathType WMF: ' + reason); };
export function readMathTypeWmfSource(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 18 || bytes.length > LIMIT) bad('invalid size');
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = (a, b) => Array.from(bytes.subarray(a, b), n => String.fromCharCode(n)).join('');
    const start = d.getUint32(0, true) === 0x9ac6cdd7 ? 22 : 0;
    if (start + 18 > bytes.length || ![1, 2].includes(d.getUint16(start, true)) || d.getUint16(start + 2, true) !== 9) bad('invalid header');
    const end = start + 2 * d.getUint32(start + 6, true);
    if (end !== bytes.length) bad('invalid file length');
    let at = start + 18, eof = false, result = null, pending = null, records = 0;
    const finish = value => {
        if (result || value.length < 7 || value.length > MTEF_LIMIT) bad('duplicate or invalid equation source');
        result = value;
    };
    while (at < end) {
        if (++records > 65536 || at + 6 > end) bad('truncated or excessive records');
        const length = d.getUint32(at, true) * 2, kind = d.getUint16(at + 4, true);
        if (length < 6 || at + length > end) bad('invalid record bounds');
        if (kind === 0) {
            if (length !== 6 || at + length !== end) bad('invalid EOF');
            eof = true; break;
        }
        // META_ESCAPE / MFCOMMENT only. Other graphics records are never interpreted.
        if (kind === 0x626 && length >= 10 && d.getUint16(at + 6, true) === 15) {
            const n = d.getUint16(at + 8, true), from = at + 10, to = from + n;
            if (to > at + length || at + length - to > 1) bad('invalid comment length');
            const id = ascii(from, Math.min(to, from + 8));
            if (id === 'AppsMFCC') {
                if (n < 19 || d.getUint16(from + 8, true) !== 1) bad('invalid AppsMFCC header');
                const total = d.getUint32(from + 10, true), size = d.getUint32(from + 14, true);
                let zero = from + 18;
                while (zero < to && zero - from < 512 && bytes[zero] !== 0) zero++;
                if (zero >= to || bytes[zero] !== 0) bad('unterminated signature');
                const signature = ascii(from + 18, zero), body = zero + 1;
                const isMtef = signature === 'Design Science, Inc.' || /^(?:Design Science, Inc\.|Wiris)\/MTEF(?:\/[^\\]*)?$/.test(signature);
                if (isMtef) {
                    if (total < 7 || total > MTEF_LIMIT || size < 1 || size > total || body + size !== to) bad('invalid MTEF chunk length');
                    if (!pending) pending = { signature, total, data: new Uint8Array(total), used: 0 };
                    if (pending.signature !== signature || pending.total !== total || pending.used + size > total) bad('inconsistent MTEF chunks');
                    pending.data.set(bytes.subarray(body, to), pending.used); pending.used += size;
                    if (pending.used === total) { finish(pending.data); pending = null; }
                } else if (pending) bad('interrupted MTEF chunks');
            } else if (id === 'MathType' && n >= 12 && d.getUint16(from + 8, true) === 0x5555) {
                const size = d.getUint16(from + 10, true);
                if (pending || size + 12 !== n) bad('invalid legacy MTEF comment');
                finish(bytes.slice(from + 12, to));
            }
        }
        at += length;
    }
    if (!eof || pending) bad('incomplete WMF or MTEF source');
    return result;
}
