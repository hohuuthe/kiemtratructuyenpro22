import { getDatabase } from './exam/utils';

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
    const data = {
      app_title: row?.app_title || 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN',
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
