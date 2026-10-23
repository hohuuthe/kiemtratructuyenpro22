/**
 * Deterministic, content-addressed object storage for Word-imported images.
 * Teacher identity scopes objects; the source image bytes determine the key.
 * This permits an exact retry after an ambiguous database commit outcome
 * without allocating new random media URLs.
 */
const knownMimes = Object.freeze({
  'image/png':'png',
  'image/jpeg':'jpg',
  'image/gif':'gif',
  'image/webp':'webp',
  'image/bmp':'bmp'
});
export async function wordImportImageObjectKey(bytes, userId, mimeType) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 8*1024*1024)
    throw new Error('Ảnh Word không hợp lệ hoặc vượt giới hạn 8 MB');
  const ext = knownMimes[mimeType];
  if (!ext) throw new Error('Loại hình ảnh Word chưa được hỗ trợ');
  if (!userId || typeof userId !== 'string') throw new Error('Thiếu người sở hữu ảnh Word');
  const hex = array => Array.from(new Uint8Array(array)).map(n=>n.toString(16).padStart(2,'0')).join('');
  const [ownerHash,contentHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId)),
    crypto.subtle.digest('SHA-256', bytes)
  ]);
  return 'luuhinhnh/word-import/' + hex(ownerHash).slice(0,24) + '/' + hex(contentHash) + '.' + ext;
}
