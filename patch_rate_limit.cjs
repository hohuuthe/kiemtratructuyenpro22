const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

// 1. Add import
if (!content.includes('express-rate-limit')) {
    content = content.replace('import express from "express";', 'import express from "express";\nimport rateLimit from "express-rate-limit";');
}

// 2. Add trust proxy
if (!content.includes('app.set(\'trust proxy\', 1);')) {
    content = content.replace('const app = express();', "const app = express();\n\n  // Cấu hình Trust Proxy (QUAN TRỌNG ĐỂ ĐỌC ĐƯỢC IP SAU CLOUDFLARE)\n  app.set('trust proxy', 1);");
}

// 3. Add Rate Limiters and app.use before express.json
const rateLimiterCode = `
  // --- BẢO MẬT & RATE LIMITING (CHỐNG DDOS VÀ SPAM) ---
  const getRealIp = (req: any) => {
    // Ưu tiên đọc IP thực từ Header đặc quyền của Cloudflare
    return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip;
  };

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 15, // Tối đa 15 lần thử đăng nhập/đổi mật khẩu
    message: { error: "Bạn đã thao tác đăng nhập hoặc đổi mật khẩu quá nhiều lần. Vui lòng chờ 15 phút để bảo vệ tài khoản." },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getRealIp
  });

  const examLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 phút
    max: 60, // Tối đa 60 lần nộp bài/tạo đề thi trong 10 phút để bảo vệ Quota AI
    message: { error: "Hệ thống đang phát hiện tần suất thi bất thường từ thiết bị của bạn. Vui lòng nghỉ ngơi vài phút." },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getRealIp
  });

  const globalLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 phút
    max: 500, // 500 request cho toàn bộ API (Ngăn cản tool scrape)
    message: { error: "Mạng của bạn gửi đi quá nhiều yêu cầu. Hệ thống tạm khóa 5 phút." },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getRealIp
  });

  // Áp dụng Rate Limit vào các tuyến API
  app.use('/api/auth', authLimiter);
  app.use('/api/exam', examLimiter);
  app.use('/api/ai', examLimiter);
  app.use('/api', globalLimiter);
`;

if (!content.includes('BẢO MẬT & RATE LIMITING')) {
    content = content.replace('app.use(express.json({ limit: "50mb" }));', rateLimiterCode + '\n  app.use(express.json({ limit: "50mb" }));');
}

fs.writeFileSync('server.ts', content);
console.log("Patched server.ts with rate limiters successfully!");
