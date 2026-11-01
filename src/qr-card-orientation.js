export const QR_CARD_PREFIX = 'KTTTQR1';
export const QR_CARD_PREFIX_V2 = 'K2';
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function hexToBytes(hex) {
  const raw = String(hex || '').trim().toLowerCase();
  if (!/^[a-f0-9]{36}$/.test(raw)) throw new Error('Mã thẻ QR không hợp lệ.');
  const out = new Uint8Array(raw.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function encodeBase64Url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64URL[(n >>> 18) & 63] + B64URL[(n >>> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL[(n >>> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL[n & 63];
  }
  return out;
}
function decodeBase64Url(value) {
  const raw = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const bytes = [];
  for (let i = 0; i < raw.length; i += 4) {
    const c0 = B64URL.indexOf(raw[i] || '');
    const c1 = B64URL.indexOf(raw[i + 1] || '');
    const c2 = raw[i + 2] ? B64URL.indexOf(raw[i + 2]) : -1;
    const c3 = raw[i + 3] ? B64URL.indexOf(raw[i + 3]) : -1;
    if (c0 < 0 || c1 < 0 || (raw[i + 2] && c2 < 0) || (raw[i + 3] && c3 < 0)) return null;
    const n = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
    bytes.push((n >>> 16) & 255);
    if (c2 >= 0) bytes.push((n >>> 8) & 255);
    if (c3 >= 0) bytes.push(n & 255);
  }
  return new Uint8Array(bytes);
}

/**
 * V2 keeps the existing 18-byte opaque token but encodes it in 24 base64url
 * characters instead of 36 hexadecimal characters and drops redundant text.
 * This materially lowers QR module density for long-range classroom scanning.
 */
export function buildQrCardPayload(cardToken) {
  return `${QR_CARD_PREFIX_V2}.${encodeBase64Url(hexToBytes(cardToken))}`;
}

export function parseQrCardPayload(value) {
  const raw = String(value || '').trim();

  // New compact long-range format.
  if (raw.startsWith(QR_CARD_PREFIX_V2 + '.')) {
    const encoded = raw.slice(QR_CARD_PREFIX_V2.length + 1);
    const bytes = decodeBase64Url(encoded);
    if (!bytes || bytes.length !== 18) return null;
    return { version: QR_CARD_PREFIX_V2, cardToken: bytesToHex(bytes) };
  }

  // Legacy V1 cards remain fully supported.
  const parts = raw.split('|');
  if (parts.length !== 3 || parts[0] !== QR_CARD_PREFIX || parts[2] !== 'ABCD') return null;
  const cardToken = String(parts[1] || '').trim();
  if (!/^[a-f0-9]{36}$/i.test(cardToken)) return null;
  return { version: QR_CARD_PREFIX, cardToken: cardToken.toLowerCase() };
}

export function normalizeAngleDegrees(value) {
  let angle = Number(value);
  if (!Number.isFinite(angle)) return 0;
  angle %= 360;
  if (angle > 180) angle -= 360;
  if (angle <= -180) angle += 360;
  return angle;
}

export function qrOrientationAngle(location) {
  const a = location?.topLeftCorner;
  const b = location?.topRightCorner;
  if (!a || !b) return null;
  const dx = Number(b.x) - Number(a.x);
  const dy = Number(b.y) - Number(a.y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 2) return null;
  return normalizeAngleDegrees(Math.atan2(dy, dx) * 180 / Math.PI);
}

/**
 * Printed convention:
 * A = top, B = right, C = bottom, D = left.
 * To put an edge at the physical top, the whole card rotates:
 * A -> 0deg, B -> -90deg, C -> 180deg, D -> +90deg.
 */
export function answerFromQrAngle(angle, tolerance = 36) {
  const a = normalizeAngleDegrees(angle);
  const options = [
    ['A', 0],
    ['B', -90],
    ['C', 180],
    ['D', 90]
  ];
  let best = null;
  let bestDistance = Infinity;
  for (const [answer, target] of options) {
    const raw = Math.abs(normalizeAngleDegrees(a - target));
    const distance = Math.min(raw, 360 - raw);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = answer;
    }
  }
  return bestDistance <= Math.max(16, Math.min(40, Number(tolerance) || 36))
    ? { answer: best, angle: a, distance: bestDistance }
    : null;
}

export function answerFromQrLocation(location, tolerance = 36) {
  const angle = qrOrientationAngle(location);
  return angle == null ? null : answerFromQrAngle(angle, tolerance);
}
