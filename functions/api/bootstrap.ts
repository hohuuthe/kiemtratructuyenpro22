import { getDatabase } from './exam/utils';
import { normalizedHeaderBranding } from '../../src/header-branding-policy.js';

// Dữ liệu công khai tối thiểu để mở giao diện. Tuyệt đối không trả khóa AI,
// prompt, danh sách tài khoản, đề thi, câu hỏi hoặc kết quả bài làm.
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0',
  'Vary': 'Host, X-Tenant-Slug'
};
export const onRequestGet: PagesFunction = async (context) => {
  try {
    const db = getDatabase(context);
    if (!db) throw new Error('Database not configured');
    const row: any = await db.prepare(`
      SELECT app_title, author_info, question_font_size, answer_font_size,
             display_mode, show_results_details, allow_ranking_details,
             immediate_feedback, sq_case_sensitive, sq_punctuation_sensitive,
             qr_code_url
      FROM app_settings WHERE id = 1
    `).first();
    // Old tenants may not yet have banner columns. Preserve the current text-only UI.
    let header: any = null;
    try {
      header = await db.prepare(
        'SELECT header_display_mode, header_banner_url, header_banner_key, header_banner_alt FROM app_settings WHERE id = 1'
      ).first();
    } catch {
      header = null;
    }
    // Tenants with only the original desktop banner columns still load safely.
    if (header) {
      try {
        const variants: any = await db.prepare(
          'SELECT header_banner_tablet_url, header_banner_mobile_url FROM app_settings WHERE id = 1'
        ).first();
        header = { ...header, ...variants };
      } catch {
        // Optional responsive columns can be added on the first admin save.
      }
    }
    let examHeaderMode = 'text';
    try {
      const appearance: any = await db.prepare(
        'SELECT exam_header_display_mode FROM app_settings WHERE id = 1'
      ).first();
      if (['text','banner','both'].includes(appearance?.exam_header_display_mode))
        examHeaderMode = appearance.exam_header_display_mode;
    } catch {
      // Legacy tenant without the independent fullscreen branding column.
    }
    const branding = normalizedHeaderBranding(header);
    const data = {
      app_title: row?.app_title || 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN',
      header_display_mode: branding.mode,
      exam_header_display_mode: examHeaderMode,
      header_banner_url: branding.url,
      header_banner_tablet_url: branding.tabletUrl,
      header_banner_mobile_url: branding.mobileUrl,
      header_banner_alt: branding.alt,
      author_info: row?.author_info || 'Phát triển bởi: Hồ Hữu Thế - 0935 078 895',
      question_font_size: Number(row?.question_font_size) || 18,
      answer_font_size: Number(row?.answer_font_size) || 16,
      display_mode: row?.display_mode || 'single',
      show_results_details: row?.show_results_details ?? true,
      allow_ranking_details: row?.allow_ranking_details ?? true,
      immediate_feedback: row?.immediate_feedback ?? false,
      sq_case_sensitive: row?.sq_case_sensitive ?? false,
      sq_punctuation_sensitive: row?.sq_punctuation_sensitive ?? false,
      qr_code_url: row?.qr_code_url || ''
    };
    return new Response(JSON.stringify({ data, error: null }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({
      data: null, error: 'Không thể tải cấu hình giao diện tối thiểu.'
    }), { status: 503, headers });
  }
};
