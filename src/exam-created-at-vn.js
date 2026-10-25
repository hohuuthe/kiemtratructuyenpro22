/**
 * Show the immutable exam_configs.created_at instant in Vietnam time
 * (Asia/Ho_Chi_Minh) regardless of the viewer's browser timezone.
 *
 * New records use UTC ISO-8601. Historical SQL timestamps without an offset
 * are treated as UTC because SQLite datetime('now') was the legacy default.
 * Missing, date-only and invalid timestamps are intentionally NOT guessed.
 */
export const EXAM_CREATION_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const localTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: EXAM_CREATION_TIME_ZONE,
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
const localDate = new Intl.DateTimeFormat('vi-VN', {
  timeZone: EXAM_CREATION_TIME_ZONE,
  day: '2-digit', month: '2-digit', year: 'numeric'
});

export function parseExamCreatedAt(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  // Require date AND clock. A date-only value has no reliable creation time.
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(raw);
  if (!m) return null;
  const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
  const hour=Number(m[4]),minute=Number(m[5]),second=Number(m[6]);
  const leap=(year%4===0 && (year%100!==0 || year%400===0));
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if (month<1 || month>12 || day<1 || day>days[month-1] ||
      hour>23 || minute>59 || second>59) return null;
  let zone=m[8] || 'Z';
  if (zone.toUpperCase() !== 'Z') {
    if (!zone.includes(':')) zone=zone.slice(0,3)+':'+zone.slice(3);
    const zh=Number(zone.slice(1,3)),zm=Number(zone.slice(4,6));
    if (zh>14 || zm>59 || (zh===14 && zm>0)) return null;
  } else zone='Z';
  const iso=m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+m[6]+
    (m[7]||'')+zone;
  const instant=new Date(iso);
  return Number.isFinite(instant.getTime()) ? instant : null;
}

export function formatExamCreatedAtVN(value) {
  const instant=parseExamCreatedAt(value);
  if (!instant) return null;
  return {
    hour: localTime.format(instant),
    date: localDate.format(instant),
    iso: instant.toISOString()
  };
}
