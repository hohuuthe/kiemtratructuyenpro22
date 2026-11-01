export const QR_CARD_PREFIX = 'KTTTQR1';

export function buildQrCardPayload(cardToken) {
  const token = String(cardToken || '').trim();
  if (!/^[a-f0-9]{36}$/i.test(token)) throw new Error('Mã thẻ QR không hợp lệ.');
  return `${QR_CARD_PREFIX}|${token}|ABCD`;
}

export function parseQrCardPayload(value) {
  const raw = String(value || '').trim();
  const parts = raw.split('|');
  if (parts.length !== 3 || parts[0] !== QR_CARD_PREFIX || parts[2] !== 'ABCD') return null;
  const cardToken = String(parts[1] || '').trim();
  if (!/^[a-f0-9]{36}$/i.test(cardToken)) return null;
  return { version: QR_CARD_PREFIX, cardToken };
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
export function answerFromQrAngle(angle, tolerance = 42) {
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
  return bestDistance <= Math.max(20, Math.min(45, Number(tolerance) || 42))
    ? { answer: best, angle: a, distance: bestDistance }
    : null;
}

export function answerFromQrLocation(location, tolerance = 42) {
  const angle = qrOrientationAngle(location);
  return angle == null ? null : answerFromQrAngle(angle, tolerance);
}
