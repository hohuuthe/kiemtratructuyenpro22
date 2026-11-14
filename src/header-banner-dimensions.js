/** Recommended source image sizes, not rigid upload restrictions. */
export const RECOMMENDED_BANNER_SIZES = Object.freeze({
  desktop: Object.freeze({ width: 1920, height: 320, name: 'máy tính' }),
  tablet: Object.freeze({ width: 1200, height: 300, name: 'máy tính bảng' }),
  mobile: Object.freeze({ width: 750, height: 360, name: 'điện thoại' })
});

/**
 * Returns advisory feedback only. A banner never fails to upload solely because
 * of image proportions: the browser always displays it with object-fit:contain.
 */
export function bannerDimensionFeedback(device, width, height) {
  const target = RECOMMENDED_BANNER_SIZES[device];
  if (!target || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { status: 'invalid', text: 'Không đọc được kích thước ảnh. Hãy chọn tệp ảnh hợp lệ.' };
  }
  const ratio = width / height, expected = target.width / target.height;
  const dimensions = Math.round(width) + ' × ' + Math.round(height) + ' px';
  const recommended = target.width + ' × ' + target.height + ' px';
  if (Math.abs(ratio - expected) / expected <= 0.12 && width >= target.width * 0.65) {
    return { status: 'good', text: dimensions + ' • Tỷ lệ phù hợp cho ' + target.name + '.' };
  }
  const reason = width < target.width * 0.65
    ? 'Ảnh khá nhỏ, có thể thiếu nét khi trình chiếu.'
    : 'Tỷ lệ ảnh khác tỷ lệ đề xuất, có thể xuất hiện khoảng trống hai bên.';
  return {
    status: 'warning',
    text: dimensions + ' • ' + reason + ' Khuyến nghị ' + recommended +
      '; hệ thống vẫn giữ nguyên toàn bộ ảnh, không cắt hoặc kéo méo.'
  };
}
