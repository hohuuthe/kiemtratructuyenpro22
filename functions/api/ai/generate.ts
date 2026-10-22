import { verifyJWT, getDynamicSecret, getDatabase } from "../exam/utils";

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DB?: any;
  JWT_SECRET?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;

    // Xác thực tài khoản giáo viên hoặc admin
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Access denied. Bạn chưa đăng nhập hoặc thiếu token xác thực." }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.substring(7);
    let user: any = null;
    try {
      const db = getDatabase(context);
      const secret = await getDynamicSecret(db, env.JWT_SECRET);
      user = await verifyJWT(token, secret);
    } catch {
      // Fallback verify nếu DB bận
      user = await verifyJWT(token, env.JWT_SECRET || 'online_exam_secret_key_2024');
    }

    if (!user || (user.role !== 'admin' && user.role !== 'teacher' && user.target_audience !== 'Giáo viên' && user.target_audience !== 'Quản trị viên')) {
      return new Response(JSON.stringify({ error: "Access denied. Chỉ Giáo viên hoặc Quản trị viên mới được phép sử dụng tính năng tạo câu hỏi bằng AI." }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body: any = await request.json();
    const { contents, config, model, apiKey: clientApiKey } = body;
    
    const rawKeyInput = (clientApiKey && typeof clientApiKey === 'string') ? clientApiKey.trim() : "";
    const keys = rawKeyInput.split(/\s+/).map((k: string) => k.trim()).filter((k: string) => k.length > 5 && !k.includes("••••••••") && !k.includes("YOUR_"));

    if (keys.length === 0) {
      return new Response(JSON.stringify({ error: "Vui lòng nhập Gemini API Key cá nhân của bạn để sử dụng tính năng này." }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const activeModel = (!model || model.includes("1.5-flash") || model.includes("3-flash-preview")) ? "gemini-3.8-flash" : model;

    // Chuẩn hóa contents và payload gửi sang Google API
    const normalizedContents = Array.isArray(contents)
      ? contents
      : (contents && typeof contents === 'object' && contents.parts ? [contents] : contents);

    const payload: any = {
      contents: normalizedContents,
      generationConfig: {}
    };

    if (config) {
      if (config.responseMimeType) payload.generationConfig.responseMimeType = config.responseMimeType;
      if (config.responseSchema) payload.generationConfig.responseSchema = config.responseSchema;
      if (config.thinkingConfig) payload.generationConfig.thinkingConfig = config.thinkingConfig;
    }

    let lastError = "";
    let lastStatus = 500;
    const modelsToTry = [activeModel, "gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-3.5-flash"];
    const uniqueModels = [...new Set(modelsToTry)];
    const keyReports: Array<{ index: number; maskedKey: string; reason: string }> = [];

    // Luân chuyển tuần tự qua từng key nếu key trước đó bị hết hạn mức, quá quota hoặc lỗi
    for (let i = 0; i < keys.length; i++) {
      const activeKey = keys[i];
      const maskedKey = activeKey.length > 10 ? `${activeKey.substring(0, 6)}...${activeKey.substring(activeKey.length - 4)}` : activeKey;
      let shouldSwitchKey = false;

      for (const m of uniqueModels) {
        const googleEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${activeKey}`;
        
        try {
          const apiResponse = await fetch(googleEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          if (apiResponse.ok) {
            const resData: any = await apiResponse.json();
            const text = resData.candidates?.[0]?.content?.parts?.[0]?.text || "";
            return new Response(JSON.stringify({ text }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }

          const errJson = await apiResponse.json().catch(() => ({})) as any;
          const errMsg = errJson.error?.message || `Google API Error HTTP ${apiResponse.status}`;
          lastError = errMsg;
          lastStatus = apiResponse.status;
          const errLower = errMsg.toLowerCase();

          // Kiểm tra nếu lỗi do key hết quota, hạn mức hoặc key hỏng
          if (apiResponse.status === 429 || apiResponse.status === 403 || apiResponse.status === 401 ||
              (apiResponse.status === 400 && (errLower.includes('key') || errLower.includes('invalid'))) ||
              errLower.includes('quota') || errLower.includes('resource_exhausted') ||
              errLower.includes('rate') || errLower.includes('api_key_invalid') ||
              errLower.includes('api key not valid') || errLower.includes('permission_denied') ||
              errLower.includes('expired') || errLower.includes('limit')) {
            console.warn(`[AI Key Switcher Proxy]: Key ${i + 1}/${keys.length} (${maskedKey}) bị lỗi hoặc hết hạn mức (${errMsg}). Chuyển sang key tiếp theo...`);
            keyReports.push({ index: i + 1, maskedKey, reason: errMsg });
            shouldSwitchKey = true;
            break;
          }
        } catch (err: any) {
          lastError = err.message || "Lỗi kết nối API";
          lastStatus = 500;
        }
      }

      if (shouldSwitchKey) {
        continue;
      }
    }

    const finalMsg = keys.length > 1
      ? `Tất cả ${keys.length} API Key trong danh sách đều không thể sử dụng (hết hạn mức, quá quota hoặc không hợp lệ). Chi tiết lỗi cuối: ${lastError}`
      : lastError;

    return new Response(JSON.stringify({ 
      error: finalMsg,
      keyReports,
      help: "Vui lòng vào Google AI Studio (https://aistudio.google.com/app/apikey) để lấy thêm Key mới hoặc kiểm tra hạn ngạch tài khoản."
    }), {
      status: lastStatus,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ 
      error: error.message || "Lỗi không xác định khi kết nối với Gemini API." 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
