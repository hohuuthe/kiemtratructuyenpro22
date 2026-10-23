import { verifyAuthSession, getDynamicSecret, checkIsAdmin, getEffectiveDb } from './exam/utils';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  JWT_SECRET?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant-Slug',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Content-Type': 'application/json'
  };

  try {
    const db = getEffectiveDb(context);
    if (!db) {
      return new Response(JSON.stringify({ error: "Database not configured." }), { status: 500, headers: corsHeaders });
    }

    // Đảm bảo schema và secret đã được khởi tạo
    await getDynamicSecret(db, env.JWT_SECRET);

    let data: any = null;
    try {
      const stmt = db.prepare(`SELECT * FROM app_settings WHERE id = 1`);
      data = await stmt.first();
    } catch (queryErr) {}

    if (!data) {
      data = {
        id: 1,
        show_results_details: 1,
        allow_ranking_details: 1,
        show_delete_selected_ranking: 1,
        immediate_feedback: 1,
        sq_case_sensitive: 0,
        sq_punctuation_sensitive: 0,
        question_font_size: 18,
        answer_font_size: 16,
        display_mode: 'standard',
        app_title: 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN',
        author_info: 'Phát triển bởi: Hồ Hữu Thế - 0935 078 895',
        ai_prompt: '',
        ai_appraise_prompt: '',
        ai_grading_key: '',
        qr_code_url: ''
      };
    } else {
      if (data.qr_code_url === undefined || data.qr_code_url === null) {
        data.qr_code_url = '';
      }
    }

    // BẢO MẬT: Chỉ tài khoản Quản trị viên (Admin) mới có quyền đọc ai_grading_key của hệ thống
    if (data) {
      let isAdmin = false;
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        try {
          const token = authHeader.substring(7).trim();
          const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
          const decoded = await verifyAuthSession(token, SECRET, db);
          if (checkIsAdmin(decoded)) {
            isAdmin = true;
          }
        } catch (e) {}
      }
      if (!isAdmin) {
        data.ai_grading_key = "";
      }
    }

    return new Response(JSON.stringify({
        data: data,
        error: null
    }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Lỗi server' }), { status: 500, headers: corsHeaders });
  }
}

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Content-Type': 'application/json'
  };

  try {
    const body: any = await request.json();
    const db = getEffectiveDb(context);
    if (!db) {
      return new Response(JSON.stringify({ error: "Database not configured." }), { status: 500, headers: corsHeaders });
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
         return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    
    let user = null;
    try {
        const token = authHeader.replace('Bearer ', '').trim();
        const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
        const decoded = await verifyAuthSession(token, SECRET, db);
        if (decoded && decoded.id) {
            user = decoded;
        }
    } catch(e) {}

    if (!checkIsAdmin(user)) {
         return new Response(JSON.stringify({ error: "Only admins can update settings" }), { status: 403, headers: corsHeaders });
    }

    // Fetch current settings for partial update support
    let currentSettings: any = null;
    try {
      const currentStmt = db.prepare(`SELECT * FROM app_settings WHERE id = 1`);
      currentSettings = await currentStmt.first();
    } catch (e) {}

    const { 
        show_results_details, allow_ranking_details, show_delete_selected_ranking, 
        immediate_feedback, sq_case_sensitive, sq_punctuation_sensitive, 
        question_font_size, answer_font_size, display_mode, app_title, 
        author_info, ai_prompt, ai_appraise_prompt, ai_grading_key, qr_code_url 
    } = body;
    
    const finalShowResults = show_results_details !== undefined ? (show_results_details ? 1 : 0) : (currentSettings?.show_results_details ?? 1);
    const finalAllowRanking = allow_ranking_details !== undefined ? (allow_ranking_details ? 1 : 0) : (currentSettings?.allow_ranking_details ?? 1);
    const finalShowDeleteRanking = show_delete_selected_ranking !== undefined ? (show_delete_selected_ranking ? 1 : 0) : (currentSettings?.show_delete_selected_ranking ?? 0);
    const finalImmediateFeedback = immediate_feedback !== undefined ? (immediate_feedback ? 1 : 0) : (currentSettings?.immediate_feedback ?? 1);
    const finalSqCase = sq_case_sensitive !== undefined ? (sq_case_sensitive ? 1 : 0) : (currentSettings?.sq_case_sensitive ?? 0);
    const finalSqPunctuation = sq_punctuation_sensitive !== undefined ? (sq_punctuation_sensitive ? 1 : 0) : (currentSettings?.sq_punctuation_sensitive ?? 0);
    const finalQFontSize = question_font_size !== undefined ? question_font_size : (currentSettings?.question_font_size ?? 18);
    const finalAFontSize = answer_font_size !== undefined ? answer_font_size : (currentSettings?.answer_font_size ?? 16);
    const finalDisplayMode = display_mode !== undefined ? display_mode : (currentSettings?.display_mode ?? 'standard');
    const finalAppTitle = app_title !== undefined ? app_title : (currentSettings?.app_title ?? 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN');
    const finalAuthorInfo = author_info !== undefined ? author_info : (currentSettings?.author_info ?? 'Phát triển bởi: Hồ Hữu Thế - 0935 078 895');
    const finalAiPrompt = ai_prompt !== undefined ? ai_prompt : (currentSettings?.ai_prompt ?? '');
    const finalAiAppraisePrompt = ai_appraise_prompt !== undefined ? ai_appraise_prompt : (currentSettings?.ai_appraise_prompt ?? '');
    const finalAiGradingKey = ai_grading_key !== undefined ? ai_grading_key : (currentSettings?.ai_grading_key ?? '');
    const finalQrCodeUrl = qr_code_url !== undefined ? qr_code_url : (currentSettings?.qr_code_url ?? '');

    const stmt = db.prepare(`
        UPDATE app_settings 
        SET show_results_details = ?, allow_ranking_details = ?, show_delete_selected_ranking = ?, 
            immediate_feedback = ?, sq_case_sensitive = ?, sq_punctuation_sensitive = ?, 
            question_font_size = ?, answer_font_size = ?, display_mode = ?, 
            app_title = ?, author_info = ?, ai_prompt = ?, ai_appraise_prompt = ?, ai_grading_key = ?,
            qr_code_url = ?
        WHERE id = 1
    `).bind(
        finalShowResults, 
        finalAllowRanking, 
        finalShowDeleteRanking, 
        finalImmediateFeedback, 
        finalSqCase,
        finalSqPunctuation,
        finalQFontSize,
        finalAFontSize,
        finalDisplayMode,
        finalAppTitle,
        finalAuthorInfo,
        finalAiPrompt,
        finalAiAppraisePrompt,
        finalAiGradingKey,
        finalQrCodeUrl
    );
    
    await stmt.run();

    return new Response(JSON.stringify({
        data: { success: true },
        error: null
    }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Lỗi server' }), { status: 500, headers: corsHeaders });
  }
}

export const onRequestOptions: PagesFunction = async () => {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS'
      }
    });
};
