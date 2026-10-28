// Browser-only Gemini key preferences. Keys remain device-local and are never
// persisted to an exam, the result database or server-side automatic grading.
export const MAX_BROWSER_GEMINI_KEYS = 30;
export function splitGeminiKeys(value) {
  return [...new Set(String(value || '').trim().split(/\s+/).filter(key =>
    key.length > 5 && key.length <= 256 && !key.includes('••••') && !key.includes('YOUR_')))];
}
export function browserAIAccountIdentity(user) {
  const username = String(user?.username || '').trim();
  if (!username) return '';
  return String(user?.user_id || user?.id || '') + ':' + username;
}
export function localGeminiStorageKey(user) {
  const username = String(user?.username || '').trim();
  if (!username) return '';
  const accountId = String(user?.user_id || user?.id || '').trim();
  return accountId
    ? 'gemini_api_key_account_' + encodeURIComponent(accountId) + '_' + encodeURIComponent(username)
    : 'gemini_api_key_' + username;
}
function legacyGeminiStorageKey(user) {
  return user?.username ? 'gemini_api_key_' + String(user.username).trim() : '';
}
export function readBrowserGeminiKeys(storage, user) {
  const key = localGeminiStorageKey(user);
  if (!key) return [];
  try {
    const scopedValue = storage.getItem(key);
    if (scopedValue !== null) return splitGeminiKeys(scopedValue);
    // One-way compatibility for keys saved by the original AI question editor.
    // NEVER fall back to global 'gemini_api_key', which could belong to another login.
    const legacy = legacyGeminiStorageKey(user);
    return legacy && legacy !== key ? splitGeminiKeys(storage.getItem(legacy)) : [];
  } catch { return []; }
}
export function saveBrowserGeminiKeys(storage, user, raw) {
  const key = localGeminiStorageKey(user);
  if (!key) throw Error('Vui lòng đăng nhập để lưu API Key cá nhân.');
  if (String(raw || '').length > 16000) throw Error('Danh sách Key quá dài.');
  const keys = splitGeminiKeys(raw);
  if (keys.length > MAX_BROWSER_GEMINI_KEYS) {
    throw Error('Chỉ cho phép tối đa ' + MAX_BROWSER_GEMINI_KEYS + ' API Key cá nhân.');
  }
  try {
    const legacy = legacyGeminiStorageKey(user);
    // An empty scoped value deliberately blocks reading a stale legacy entry.
    storage.setItem(key, keys.join(' '));
    if (legacy && legacy !== key) storage.removeItem(legacy);
  } catch {
    throw Error('Trình duyệt không cho phép lưu khóa. Hãy kiểm tra bộ nhớ và chế độ riêng tư.');
  }
  return keys.length;
}
export function prioritizeGradingKeys(storage, user, examKeys, systemKeys) {
  return [...new Set([
    ...readBrowserGeminiKeys(storage, user),
    ...splitGeminiKeys(examKeys),
    ...splitGeminiKeys(systemKeys)
  ])];
}
export function validateManualEssayAIGrade(raw, maximum) {
  const max = Number(maximum);
  if (!Number.isFinite(max) || max < 0) throw Error('Thang điểm tự luận không hợp lệ.');
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { throw Error('Gemini không trả về dữ liệu JSON hợp lệ. Điểm chưa được cập nhật.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      typeof data.score !== 'number' || !Number.isFinite(data.score) ||
      data.score < 0 || data.score > max ||
      typeof data.feedback !== 'string' || !data.feedback.trim()) {
    throw Error('Điểm hoặc nhận xét AI không hợp lệ. Điểm chưa được cập nhật.');
  }
  return { score: Number(data.score.toFixed(2)), feedback: data.feedback.trim().slice(0, 3000) };
}
