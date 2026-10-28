// Browser-local Gemini key preference shared with AI question generation.
// Never attach key values to logs, grades, the exam config or local UI reports.
export function splitGeminiKeys(value) {
  return [...new Set(String(value || '').trim().split(/\s+/).filter(key =>
    key.length > 5 && !key.includes('••••') && !key.includes('YOUR_')))];
}
export function localGeminiStorageKey(user) {
  const username = String(user?.username || '').trim();
  return username ? 'gemini_api_key_' + username : '';
}
export function readBrowserGeminiKeys(storage, user) {
  const key = localGeminiStorageKey(user);
  if (!key) return [];
  try { return splitGeminiKeys(storage.getItem(key)); } catch { return []; }
}
export function saveBrowserGeminiKeys(storage, user, raw) {
  const key = localGeminiStorageKey(user);
  if (!key) throw Error('Vui lòng đăng nhập để lưu API Key cá nhân.');
  const keys = splitGeminiKeys(raw);
  try { if (keys.length) storage.setItem(key, keys.join(' ')); else storage.removeItem(key); }
  catch { throw Error('Trình duyệt không cho phép lưu khóa. Hãy kiểm tra bộ nhớ và chế độ riêng tư.'); }
  return keys.length;
}
export function prioritizeGradingKeys(storage, user, examKeys, systemKeys) {
  return [...new Set([...readBrowserGeminiKeys(storage,user), ...splitGeminiKeys(examKeys), ...splitGeminiKeys(systemKeys)])];
}
