import {buildRankingResultsDeletion,RankingResultDeleteError} from './src/ranking-result-delete-policy.js';
import {QUESTION_CREATOR_JOIN_SQL,QUESTION_CREATOR_NAME_SQL,QUESTION_CREATOR_USERNAME_SQL} from './src/question-creator-identity.js';
import {EXAM_CREATOR_JOIN_SQL,EXAM_CREATOR_NAME_SQL} from './src/exam-creator-identity.js';
import {parseManagementPage,accountsPageQuery,resultsPageQuery,resolveTeacherManagementScope,accountsFacetQueries,resultsFacetQuery,teacherOwnedExamNamesQuery} from './src/management-page-queries.js';
import {isExamOwner,redactExamForPublic,examAccessChallenge,isProtectedExamForUser,protectedExamPreview,accessCodeMatches} from './functions/api/exam/security';
import {listDocumentLinks,listDocumentLinksPage,parseDocumentLinkPage,listDocumentStudentClasses,createDocumentLink,updateDocumentLink,deleteDocumentLink,DocumentLinkServiceError} from './src/document-links-service.js';
import { accountSessionMaterial, legacyAccountSessionMaterialV1, isAccountEnabled, isUnexpiredAccountToken } from './src/security-session';
import { getAccountAccessStatus, normalizeVietnamExpiryForStorage } from './src/account-expiry';
import { resolveTenantRoutingFromRequest } from './src/tenant-host-map';
import crypto from 'crypto';
import express from "express";
import rateLimit from "express-rate-limit";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dotenv from "dotenv";
import { AsyncLocalStorage } from "async_hooks";
import { GoogleGenAI } from "@google/genai";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import https from "https";
import { getConfig, isConfigured, getTenantDatabaseConfig, BACKEND_CONFIG } from "./src/backend-config";
import { getNeonSql, convertSqliteToPostgres } from "./src/neon-adapter";
import { generateExamDocx } from "./src/exam-docx-generator";
import { generateExamAnswerExcel, ExamAnswerDoc } from "./src/exam-excel-generator";
import JSZip from 'jszip';
import {requiredQuestionLesson,questionLessonDeleteScope,requireQuestionLessonConfirmation,questionLessonCountQuery,questionLessonDeleteQuery,QuestionLessonDeleteError,canDeleteQuestionsByLesson} from './src/question-lesson-delete-policy';
import { canManageExamConfig, examConfigGuardedDeleteStatement } from './src/exam-config-deletion-policy';
import { processExamResultsDeletion } from './src/exam-results-delete-service';
import { listExamResultsDeletionTargets } from './src/exam-results-targets-service';
import { ExamResultsDeletionError } from './src/exam-results-delete-policy';
import { resolveLiveExamResultsActor } from './src/exam-results-delete-actor';
import { TEACHER_DELETE_CASCADE_SQL, TEACHER_DELETE_CALL_SQL, parseTeacherDeletionResult, teacherDeleteHttpError } from './src/teacher-delete-cascade';
import { STUDENT_DELETE_CASCADE_SQL, STUDENT_DELETE_CALL_SQL, parseStudentDeletionResult, studentDeleteHttpError } from './src/student-delete-cascade';
import { USER_DELETE_CASCADE_SQL, USER_DELETE_CALL_SQL, parseUserDeletionResult, userDeleteHttpError } from './src/user-delete-cascade';
import { onRequestPost as hardenedExamGenerateHandler } from './functions/api/exam/generate';
import { onRequestPost as hardenedExamGradeHandler } from './functions/api/exam/grade';
import { onRequestPost as hardenedExamStartHandler } from './functions/api/exam/start';
import { onRequestPost as hardenedExamSaveHandler } from './functions/api/exam/save';
import { onRequestPost as hardenedExamViolationHandler } from './functions/api/exam/violation';
import { onRequestPost as hardenedExamResumeHandler } from './functions/api/exam/resume';
import { onRequestPost as hardenedUploadImageHandler } from './functions/api/upload-image';
import { onRequestPost as uploadSystemBanner, onRequestPut as saveSystemBanner } from './functions/api/header-banner';
import { normalizedHeaderBranding } from './src/header-branding-policy.js';
import { signAuthSession as signCloudflareAuthSession } from './functions/api/exam/utils';
import { normalizeQuestionType, validateQuestionAnswer } from './src/exam-grading-core.js';

dotenv.config({ override: true });

const tenantStorage = new AsyncLocalStorage<{ tenantSlug: string; databaseUrl: string }>();

console.log("[SERVER]: Khởi động hệ thống với cấu hình từ src/backend-config.ts");
console.log("[SERVER]: Gemini Key:", isConfigured("GEMINI_API_KEY") ? "OK" : "MISSING");
console.log("[SERVER]: Neon Postgres Database:", isConfigured("NEON_DATABASE_URL") || !!process.env.NEON_DATABASE_URL ? "OK (ACTIVE)" : "STANDALONE READY");




async function startServer() {
  const app = express();

  // Cấu hình Trust Proxy (QUAN TRỌNG ĐỂ ĐỌC ĐƯỢC IP SAU CLOUDFLARE)
  app.set('trust proxy', 1);
  const PORT = 3000;
  // --- Map database JSON & boolean types between JS and SQLite ---
  
  // --- PBKDF2 Password Hashing (Chuẩn an toàn cấp ngân hàng, chống Brute-force/Rainbow Table) ---
  const PBKDF2_ITERATIONS = 100000;
  const PBKDF2_KEY_LEN = 32;

  function hashPasswordPBKDF2Sync(password: string, saltHex?: string): string {
    const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
    const derivedKey = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN, 'sha256');
    return `pbkdf2:sha256:${PBKDF2_ITERATIONS}:${salt.toString('hex')}:${derivedKey.toString('hex')}`;
  }

  function verifyPasswordSync(password: string, storedHash: string): boolean {
    if (!storedHash || !password) return false;
    if (storedHash.startsWith('pbkdf2:sha256:')) {
      const parts = storedHash.split(':');
      if (parts.length !== 5) return false;
      const iterations = parseInt(parts[2], 10) || PBKDF2_ITERATIONS;
      const salt = Buffer.from(parts[3], 'hex');
      const expectedHash = parts[4];
      const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, PBKDF2_KEY_LEN, 'sha256');
      return derivedKey.toString('hex') === expectedHash;
    }
    // Hỗ trợ mật khẩu cũ SHA-256
    const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
    return legacyHash.toLowerCase() === storedHash.toLowerCase();
  }

  function mapParamWrite(val: any): any {
    if (typeof val === "boolean") {
      return val ? 1 : 0;
    }
    if (val !== null && typeof val === "object") {
      return JSON.stringify(val);
    }
    return val;
  }

  function mapRowRead(row: any): any {
    if (!row) return row;
    const mapped: any = {};
    for (const [key, val] of Object.entries(row)) {
      if (typeof val === "string") {
        const trimmed = val.trim();
        if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
          try {
            mapped[key] = JSON.parse(trimmed);
          } catch {
            mapped[key] = val;
          }
        } else {
          mapped[key] = val;
        }
      } else if (val === 1 || val === 0) {
        // Coerce boolean columns back to true/false
        const booleanCols = new Set([
          "tf4_scoring_mode", "immediate_feedback", "sq_case_sensitive", 
          "sq_punctuation_sensitive", "auto_grade_essay", "show_score", 
          "show_details", "is_shared_results", "allow_student_chat", "maintenance_mode",
          "show_results_details", "allow_ranking_details", "show_delete_selected_ranking",
          "is_active"
        ]);
        if (booleanCols.has(key)) {
          mapped[key] = val === 1;
        } else {
          mapped[key] = val;
        }
      } else {
        mapped[key] = val;
      }
    }
    return mapped;
  }

  
  // --- BẢO MẬT & RATE LIMITING (CHỐNG DDOS VÀ SPAM) ---
  const getRealIp = (req: any) => {
    // Ưu tiên đọc IP thực từ Header đặc quyền của Cloudflare
    let ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '';
    if (typeof ip === 'string') {
      return ip.split(',')[0].trim(); // Chống mạo danh IP qua chuỗi phẩy (Header Injection)
    }
    return String(ip);
  };

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 15, // Tối đa 15 lần thử đăng nhập/đổi mật khẩu
    message: { error: "Bạn đã thao tác đăng nhập hoặc đổi mật khẩu quá nhiều lần. Vui lòng chờ 15 phút để bảo vệ tài khoản." },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    keyGenerator: getRealIp
  });

  const examLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 phút
    max: 60, // Tối đa 60 lần nộp bài/tạo đề thi trong 10 phút để bảo vệ Quota AI
    message: { error: "Hệ thống đang phát hiện tần suất thi bất thường từ thiết bị của bạn. Vui lòng nghỉ ngơi vài phút." },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    keyGenerator: getRealIp
  });

  const globalLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 phút
    max: 500, // 500 request cho toàn bộ API (Ngăn cản tool scrape)
    message: { error: "Mạng của bạn gửi đi quá nhiều yêu cầu. Hệ thống tạm khóa 5 phút." },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    keyGenerator: getRealIp
  });

  // Trusted URL-path tenant routing. Never derive a database from request headers.
  app.use((req, res, next) => {
    let route;
    try {
      const host = req.hostname || 'localhost';
      route = resolveTenantRoutingFromRequest({url: 'https://' + host + req.originalUrl},process.env);
    } catch {
      return res.status(421).json({error:'Tên miền hoặc slug chưa hợp lệ'});
    }
    const slug = route.slug;
    const {url: databaseUrl} = getTenantDatabaseConfig(slug,{exactOnly:route.source==='path'});
    if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
      if (req.originalUrl.includes('/api/')) return res.status(503).json({
        error:'Không thể kết nối tới Cơ sở dữ liệu, xin vui lòng liên hệ với quản trị hệ thống.',
        db_not_configured:true
      });
    }
    // Express routes stay /api/*, while the database identity remains
    // bound to the original verified tenant path in AsyncLocalStorage.
    if (route.source==='path' && req.url.startsWith(route.prefix + '/api/')) {
      req.url=req.url.slice(route.prefix.length);
    }
    tenantStorage.run({tenantSlug:slug,databaseUrl},()=>next());
  });

  // Áp dụng Rate Limit vào các tuyến API
  app.use('/api/auth', authLimiter);
  app.use('/api/exam', examLimiter);
  app.use('/api/ai', examLimiter);
  app.use('/api', globalLimiter);

  app.use(express.json({ limit: "50mb" }));

  // Any signed account token must match CURRENT account credentials and status.
  // Requests without a bearer are handled by individual route access checks.
  app.use('/api', async (req, res, next) => {
    if (!req.headers.authorization) return next();
    if (req.path === '/auth/login' || req.path === '/auth/change-password' || req.path === '/auth/register' || req.path === '/exam/grade' || req.path === '/upload-image') return next();
    const header = req.headers.authorization;
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ' });
    try {
      const decoded = verifyJWTSync(header.slice(7), await getServerSecret());
      if (!isUnexpiredAccountToken(decoded)) return res.status(401).json({ error: 'Vui lòng đăng nhập lại' });
      const lookup = await executeSqlQuery(`
        SELECT a.id,a.user_id,a.username,a.password,a.role,a.is_active,a.expiry_date,
               COALESCE(u.target_audience,'') AS target_audience
        FROM accounts a LEFT JOIN users u ON u.id=COALESCE(a.user_id,a.id)
        WHERE a.id=? LIMIT 1
      `, [decoded.id]);
      const row = lookup.results?.[0];
      if (!isAccountEnabled(row)) return res.status(401).json({ error: 'Tài khoản đã bị khóa hoặc xóa' });
      const state = crypto.createHash('sha256').update(accountSessionMaterial(row)).digest('hex');
      if (state !== decoded.auth_state) {
        const legacyState = crypto.createHash('sha256').update(legacyAccountSessionMaterialV1(row)).digest('hex');
        const sameAudience = String(decoded.target_audience || '').trim().toLowerCase() ===
          String(row.target_audience || '').trim().toLowerCase();
        if (legacyState !== decoded.auth_state || !sameAudience) {
          return res.status(401).json({ error: 'Quyền hoặc đối tượng người dùng đã thay đổi. Vui lòng đăng nhập lại' });
        }
      }
      next();
    } catch (error) {
      return res.status(503).json({ error: 'Không xác minh được trạng thái phiên' });
    }
  });

  // --- In-Memory Query Cache for high-speed performance ---
  const queryMemoryCache = new Map<string, { timestamp: number; data: any }>();

  // In-memory fallback storage for initial dev mode before DB connection string is set
  const memoryDb = {
    users: [] as any[],
    accounts: [] as any[],
    questions: [] as any[],
    exam_configs: [] as any[],
    results: [] as any[],
    app_settings: [{
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
      ai_grading_key: ''
    }] as any[],
    _submitted_exam_tokens: [] as any[],
    _internal_secrets: [] as any[]
  };

  // --- 100% Neon PostgreSQL Query Engine Đa CSDL theo Slug ---
  async function executeSqlQuery(sql: string, params: any[]): Promise<{ results: any[]; changes?: number; lastRowId?: any }> {
    // Convert undefined to null for safety
    params = params.map(p => p === undefined ? null : p);
    
    const store = tenantStorage.getStore();
    const targetUrl = store?.databaseUrl;
    if (!targetUrl) throw new Error('Tenant database not configured');
    
    const isSelect = sql.trim().toUpperCase().startsWith("SELECT") || sql.trim().startsWith("/* no-cache */");
    const bypassCache = sql.includes('/* no-cache */');
    const cacheKey = `${targetUrl}::${sql.trim().toLowerCase()}::${JSON.stringify(params)}`;

    // Identity pagination and other consistency-sensitive reads explicitly bypass
    // the 10-second process cache so snapshot checks always hit Neon.
    if (isSelect && !bypassCache && !sql.includes('FROM accounts') && queryMemoryCache.has(cacheKey)) {
      const cached = queryMemoryCache.get(cacheKey)!;
      if (Date.now() - cached.timestamp < 10000) {
        return cached.data;
      }
    }

    // --- Thực thi 100% trên Neon PostgreSQL Serverless tương ứng với CSDL của Slug ---
    const neonSql = getNeonSql(targetUrl);
    if (neonSql) {
      try {
        const pgSql = convertSqliteToPostgres(sql);
        const neonRes: any = await neonSql.query(pgSql, params);
        const finalResult = {
          results: neonRes.rows || [],
          changes: neonRes.rowCount || 0,
          lastRowId: null
        };
        if (isSelect && !bypassCache && !sql.includes('FROM accounts')) {
          queryMemoryCache.set(cacheKey, { timestamp: Date.now(), data: finalResult });
        } else {
          queryMemoryCache.clear();
        }
        return finalResult;
      } catch (neonErr: any) {
        if (neonErr.message && (neonErr.message.includes("already exists") || neonErr.message.includes("skipping"))) {
          return { results: [], changes: 0 };
        }
        console.error("[NEON DATABASE ERROR]:", neonErr.message, "\nQuery:", sql, "\nParams:", params);
        throw neonErr;
      }
    }

    // Nếu chưa cấu hình NEON_DATABASE_URL trong .env, phục vụ từ bộ nhớ memoryDb an toàn
    const sqlLower = sql.toLowerCase();
    if (sqlLower.includes("from app_settings")) {
      return { results: memoryDb.app_settings, changes: 0 };
    }
    if (sqlLower.includes("from accounts")) {
      if (params.length > 0 && sqlLower.includes("username = ?")) {
        return { results: memoryDb.accounts.filter(a => a.username === params[0]), changes: 0 };
      }
      return { results: memoryDb.accounts, changes: 0 };
    }
    if (sqlLower.includes("from users")) {
      if (params.length > 0 && sqlLower.includes("id = ?")) {
        return { results: memoryDb.users.filter(u => u.id === params[0]), changes: 0 };
      }
      return { results: memoryDb.users, changes: 0 };
    }
    if (sqlLower.includes("from exam_configs")) {
      if (params.length > 0 && sqlLower.includes("id = ?")) {
        return { results: memoryDb.exam_configs.filter(e => e.id === params[0]), changes: 0 };
      }
      return { results: memoryDb.exam_configs, changes: 0 };
    }
    if (sqlLower.includes("from questions")) {
      return { results: memoryDb.questions, changes: 0 };
    }
    if (sqlLower.includes("from results")) {
      return { results: memoryDb.results, changes: 0 };
    }
    if (sqlLower.includes("from _internal_secrets")) {
      return { results: memoryDb._internal_secrets, changes: 0 };
    }
    if (sqlLower.includes("count(*)")) {
      return { results: [{ cnt: 0, count: 0 }], changes: 0 };
    }

    return { results: [], changes: 0 };
  }

  // Execute startup migrations & table creation
  try {
    await executeSqlQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        full_name TEXT,
        phone_number TEXT,
        gender TEXT,
        dob TEXT,
        address TEXT,
        donvi TEXT,
        lop TEXT,
        occupation TEXT,
        target_audience TEXT DEFAULT 'Học sinh',
        payment_status TEXT DEFAULT 'Chưa thanh toán',
        payment_method TEXT,
        is_active INTEGER DEFAULT 1,
        expiry_date TEXT,
        created_at TEXT
      )
    `, []);
  } catch (e) {
    console.log("Migration users warning:", e);
  }

  try {
    await executeSqlQuery(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        is_active INTEGER DEFAULT 1,
        expiry_date TEXT,
        created_at TEXT
      )
    `, []);
  } catch (e) {
    console.log("Migration accounts warning:", e);
  }

  try {
    await executeSqlQuery(`
      CREATE TABLE IF NOT EXISTS results (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        student_name TEXT,
        student_class TEXT,
        lop TEXT,
        don_vi TEXT,
        exam_name TEXT,
        exam_id TEXT,
        score REAL,
        time_taken INTEGER,
        correct_count INTEGER,
        total_questions INTEGER,
        details TEXT,
        loai_thi_sinh TEXT,
        cheat_warning_count INTEGER DEFAULT 0,
        ai_grading_summary TEXT,
        created_at TEXT
      )
    `, []);
  } catch (e) {
    console.log("Migration results warning:", e);
  }

  try {
    await executeSqlQuery(`
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        type TEXT,
        level TEXT,
        lesson TEXT,
        content TEXT,
        options TEXT,
        answer TEXT,
        image TEXT,
        creator_id TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `, []);
  } catch (e) {
    console.log("Migration questions warning:", e);
  }

  try {
    await executeSqlQuery(`
      CREATE TABLE IF NOT EXISTS exam_configs (
        id TEXT PRIMARY KEY,
        name TEXT,
        creator_id TEXT,
        time_limit INTEGER,
        count_41 INTEGER,
        count_tf4 INTEGER,
        count_sq INTEGER,
        count_tl INTEGER,
        points_41 REAL,
        points_tf4 REAL,
        points_sq REAL,
        points_tl REAL,
        selected_lessons TEXT,
        tf4_scoring_mode TEXT,
        tf4_points TEXT,
        access_control TEXT,
        immediate_feedback INTEGER DEFAULT 1,
        show_score INTEGER DEFAULT 1,
        show_details INTEGER DEFAULT 1,
        sq_case_sensitive INTEGER DEFAULT 0,
        sq_punctuation_sensitive INTEGER DEFAULT 0,
        auto_grade_essay INTEGER DEFAULT 0,
        counts_detail TEXT,
        chedodethi TEXT,
        mabaomatdethi TEXT,
        target_lop TEXT,
        lop TEXT,
        target_donvi TEXT,
        donvi TEXT,
        tg_bd TEXT,
        tg_kt TEXT,
        ai_prompt TEXT,
        is_shared_results INTEGER DEFAULT 0,
        ai_grading_key TEXT,
        max_attempts INTEGER DEFAULT 0,
        max_cheat_warnings INTEGER DEFAULT 5,
        tieu_de_bai_thi TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `, []);
  } catch (e) {
    console.log("Migration exam_configs warning:", e);
  }

  try {
    await executeSqlQuery("CREATE TABLE IF NOT EXISTS _submitted_exam_tokens (token_hash TEXT PRIMARY KEY, exam_id TEXT, student_name TEXT, user_id TEXT, submitted_at TEXT)", []);
  } catch (err: any) {
    console.log("Migration _submitted_exam_tokens warning:", err);
  }

  try {
    await executeSqlQuery(`
      CREATE TABLE IF NOT EXISTS teacher_classes (
        id TEXT PRIMARY KEY,
        teacher_id TEXT NOT NULL,
        teacher_name TEXT,
        class_name TEXT NOT NULL,
        donvi TEXT NOT NULL,
        role TEXT DEFAULT 'bo_mon',
        subject TEXT DEFAULT '',
        created_at TEXT,
        UNIQUE(teacher_id, class_name, donvi)
      )
    `, []);
  } catch (err: any) {
    console.log("Migration teacher_classes warning:", err);
  }

  // Xóa bỏ hoàn toàn bảng duytricsdl khỏi cơ sở dữ liệu
  try {
    await executeSqlQuery("DROP TABLE IF EXISTS duytricsdl CASCADE", []);
  } catch (err: any) {}

  try {
    await executeSqlQuery("CREATE TABLE IF NOT EXISTS _internal_secrets (key TEXT PRIMARY KEY, value TEXT)", []);
  } catch (err: any) {
    console.log("Migration _internal_secrets warning:", err);
  }

  try {
    await executeSqlQuery(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY,
        show_results_details INTEGER DEFAULT 1,
        allow_ranking_details INTEGER DEFAULT 1,
        show_delete_selected_ranking INTEGER DEFAULT 0,
        immediate_feedback INTEGER DEFAULT 1,
        sq_case_sensitive INTEGER DEFAULT 0,
        sq_punctuation_sensitive INTEGER DEFAULT 0,
        question_font_size INTEGER DEFAULT 18,
        answer_font_size INTEGER DEFAULT 16,
        display_mode TEXT DEFAULT 'standard',
        app_title TEXT DEFAULT 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN',
        author_info TEXT DEFAULT 'Phát triển bởi: Hồ Hữu Thế - 0935 078 895',
        ai_prompt TEXT DEFAULT '',
        ai_appraise_prompt TEXT DEFAULT '',
        ai_grading_key TEXT DEFAULT '',
        qr_code_url TEXT DEFAULT ''
      )
    `, []);
    await executeSqlQuery(`
      INSERT INTO app_settings (
        id, show_results_details, allow_ranking_details, show_delete_selected_ranking,
        immediate_feedback, sq_case_sensitive, sq_punctuation_sensitive,
        question_font_size, answer_font_size, display_mode, app_title, author_info,
        ai_prompt, ai_appraise_prompt, ai_grading_key, qr_code_url
      ) VALUES (1, 1, 1, 1, 1, 0, 0, 18, 16, 'standard', 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN', 'Phát triển bởi: Hồ Hữu Thế - 0935 078 895', '', '', '', '')
      ON CONFLICT (id) DO NOTHING
    `, []);
  } catch (err: any) {
    console.log("Migration app_settings warning:", err);
  }

  // Cập nhật cấu trúc cột bảng (nếu cần)
  try { await executeSqlQuery("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS qr_code_url TEXT DEFAULT ''", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE results ADD COLUMN IF NOT EXISTS exam_id TEXT", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE results ADD COLUMN IF NOT EXISTS user_id TEXT", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE results ADD COLUMN IF NOT EXISTS lop TEXT", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE results ADD COLUMN IF NOT EXISTS don_vi TEXT", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE results ADD COLUMN IF NOT EXISTS cheat_warning_count INTEGER DEFAULT 0", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE results ADD COLUMN IF NOT EXISTS ai_grading_summary TEXT", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE _submitted_exam_tokens ADD COLUMN IF NOT EXISTS user_id TEXT", []); } catch (e) {}

  try { await executeSqlQuery("ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS created_at TEXT", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS max_cheat_warnings INTEGER DEFAULT 5", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS target_lop TEXT", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS lop TEXT", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS target_donvi TEXT", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS donvi TEXT", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 0", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS is_shared_results INTEGER DEFAULT 0", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS tieu_de_bai_thi TEXT", []); } catch (e) {}

  try { await executeSqlQuery("ALTER TABLE users ADD COLUMN IF NOT EXISTS lop TEXT", []); } catch (e) {}
  try { await executeSqlQuery("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_id TEXT", []); } catch (e) {}

  // Tối ưu hóa hiệu năng D1: Hệ thống chỉ mục 100% đầy đủ, tối ưu hóa toàn diện
  const startupIndexes = [
    // --- BẢNG ACCOUNTS ---
    "CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username)",
    "CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(role)",
    "CREATE INDEX IF NOT EXISTS idx_accounts_user_created ON accounts(user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_accounts_username_active ON accounts(username, is_active)",

    // --- BẢNG USERS ---
    "CREATE INDEX IF NOT EXISTS idx_users_donvi ON users(donvi)",
    "CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_users_lop ON users(lop)",
    "CREATE INDEX IF NOT EXISTS idx_users_target_audience ON users(target_audience)",
    "CREATE INDEX IF NOT EXISTS idx_users_donvi_audience ON users(donvi, target_audience)",
    "CREATE INDEX IF NOT EXISTS idx_users_audience_created ON users(target_audience, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_users_donvi_audience_created ON users(donvi, target_audience, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_users_donvi_lop ON users(donvi, lop)",
    "CREATE INDEX IF NOT EXISTS idx_users_full_name ON users(full_name)",
    "CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number)",

    // --- BẢNG RESULTS ---
    "CREATE INDEX IF NOT EXISTS idx_results_exam_id ON results(exam_id)",
    "CREATE INDEX IF NOT EXISTS idx_results_user_id ON results(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_results_created_at ON results(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_results_exam_created ON results(exam_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_results_user_created ON results(user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_results_student_name ON results(student_name)",
    "CREATE INDEX IF NOT EXISTS idx_results_student_created ON results(student_name, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_results_exam_student ON results(exam_id, student_name)",
    "CREATE INDEX IF NOT EXISTS idx_results_exam_user ON results(exam_id, user_id)",
    "CREATE INDEX IF NOT EXISTS idx_results_exam_name ON results(exam_name)",
    "CREATE INDEX IF NOT EXISTS idx_results_name_user ON results(exam_name, user_id)",
    "CREATE INDEX IF NOT EXISTS idx_results_name_student ON results(exam_name, student_name)",
    "CREATE INDEX IF NOT EXISTS idx_results_exam_score_time ON results(exam_id, score DESC, time_taken ASC)",
    "CREATE INDEX IF NOT EXISTS idx_results_lop ON results(lop)",

    // --- BẢNG QUESTIONS ---
    "CREATE INDEX IF NOT EXISTS idx_questions_creator_id ON questions(creator_id)",
    "CREATE INDEX IF NOT EXISTS idx_questions_creator_lookup ON questions(creator_id, type, level, lesson)",
    "CREATE INDEX IF NOT EXISTS idx_questions_creator_lesson_type ON questions(creator_id, lesson ASC, type ASC)",
    "CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type)",
    "CREATE INDEX IF NOT EXISTS idx_questions_lesson ON questions(lesson)",
    "CREATE INDEX IF NOT EXISTS idx_questions_level ON questions(level)",

    // --- BẢNG EXAM_CONFIGS ---
    "CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_id ON exam_configs(creator_id)",
    "CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_date ON exam_configs(creator_id, updated_at DESC, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_name ON exam_configs(creator_id, name ASC)",
    "CREATE INDEX IF NOT EXISTS idx_exam_configs_name_creator ON exam_configs(name, creator_id)",
    "CREATE INDEX IF NOT EXISTS idx_exam_configs_name ON exam_configs(name)",
    "CREATE INDEX IF NOT EXISTS idx_exam_configs_shared ON exam_configs(is_shared_results)",
    "CREATE INDEX IF NOT EXISTS idx_exam_configs_shared_name ON exam_configs(is_shared_results, name ASC)",

    // --- BẢNG TOKENS & THỐNG KÊ ---
    "CREATE INDEX IF NOT EXISTS idx_tokens_exam_student ON _submitted_exam_tokens(exam_id, student_name)",
    "CREATE INDEX IF NOT EXISTS idx_tokens_submitted_at ON _submitted_exam_tokens(submitted_at DESC)",

    // --- BẢNG TEACHER_CLASSES ---
    "CREATE INDEX IF NOT EXISTS idx_tc_teacher ON teacher_classes(teacher_id)",
    "CREATE INDEX IF NOT EXISTS idx_tc_class ON teacher_classes(class_name, donvi)",
    "CREATE INDEX IF NOT EXISTS idx_tc_donvi ON teacher_classes(donvi)"
  ];
  for (const idxSql of startupIndexes) {
    try {
      await executeSqlQuery(idxSql, []);
    } catch (e) {}
  }

  function isValidIdentifier(ident: string) {
    if (!ident || typeof ident !== 'string') return false;
    return /^[a-zA-Z0-9_]+$/.test(ident);
  }

  function checkIsAdmin(user: any): boolean {
    if (!user) return false;
    const role = String(user.role || '').trim().toLowerCase();
    const audience = String(user.target_audience || '').trim().toLowerCase();
    return role === 'admin' || audience === 'admin' || audience === 'quản trị viên';
  }

  function checkIsTeacherOrAdmin(user: any): boolean {
    if (!user) return false;
    if (checkIsAdmin(user)) return true;
    const role = String(user.role || '').trim().toLowerCase();
    const audience = String(user.target_audience || '').trim().toLowerCase();
    return role === 'giáo viên' || audience === 'giáo viên' || role === 'teacher' || audience === 'teacher';
  }

  app.get("/api/health", async (req, res) => {
    try {
      await executeSqlQuery("SELECT 1 AS ok", []);
      return res.json({ status: "OK" });
    } catch {
      return res.status(500).json({ status: "ERROR" });
    }
  });

  // --- API Authentication: Login ---
  app.post("/api/auth/login", async (req, res) => {
    try {
      const username = String(req.body?.username ?? '').trim();
      const password = String(req.body?.password ?? '');
      if (!username || !password) {
         return res.status(400).json({ error: "Thiếu tên đăng nhập hoặc mật khẩu." });
      }
      
      const query = `
        SELECT accounts.id, accounts.user_id, accounts.username, accounts.password, accounts.role, accounts.is_active, accounts.expiry_date, accounts.created_at,
               users.full_name, users.phone_number, users.target_audience, users.donvi, users.lop, users.gender, users.dob, users.address, users.occupation, users.payment_status, users.payment_method,
               users.is_active AS profile_active, users.expiry_date AS profile_expiry_date
        FROM accounts 
        LEFT JOIN users ON (users.id = accounts.user_id OR users.id = accounts.id)
        WHERE accounts.username = ?
      `;
      
      let accountRow: any = null;
      try {
        const resDb = await executeSqlQuery(query, [username]);
        if (resDb.results && resDb.results.length > 0) {
            accountRow = resDb.results[0];
        }
      } catch (e: any) {
          if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("Login DB Error::", e);
          if (e.message && e.message.includes("hạn mức dữ liệu")) {
              return res.status(400).json({ error: e.message });
          }
      }

      if (!accountRow || !accountRow.password) {
          return res.status(400).json({ error: "Tên đăng nhập hoặc mật khẩu không đúng." });
      }

      const isPasswordValid = verifyPasswordSync(password, accountRow.password);
      if (!isPasswordValid) {
          return res.status(400).json({ error: "Tên đăng nhập hoặc mật khẩu không đúng." });
      }

      const accessStatus = getAccountAccessStatus(accountRow);
      if (!accessStatus.allowed) {
          if (accessStatus.reason === 'expired') {
              return res.status(403).json({ error: "Tài khoản đã hết hạn. Vui lòng liên hệ quản trị viên để gia hạn.", code: "ACCOUNT_EXPIRED" });
          }
          if (accessStatus.reason === 'invalid_expiry') {
              return res.status(403).json({ error: "Thời hạn tài khoản không hợp lệ. Vui lòng liên hệ quản trị viên.", code: "ACCOUNT_EXPIRY_INVALID" });
          }
          return res.status(403).json({ error: "Tài khoản của bạn đã bị khóa hoặc chưa được kích hoạt.", code: "ACCOUNT_INACTIVE" });
      }

      // Tự động nâng cấp mật khẩu cũ (SHA-256) lên PBKDF2
      if (!accountRow.password.startsWith('pbkdf2:sha256:')) {
        try {
          const upgradedHash = hashPasswordPBKDF2Sync(password);
          await executeSqlQuery(`UPDATE accounts SET password = ? WHERE id = ?`, [upgradedHash, accountRow.id]);
          accountRow.password = upgradedHash;
        } catch (upgradeErr) {
          console.warn("Lỗi tự động nâng cấp mật khẩu server:", upgradeErr);
        }
      }
      
      const account = mapRowRead(accountRow);
      const finalTargetAudience = account.target_audience || (account.role === 'admin' ? 'Quản trị viên' : (account.role === 'teacher' || account.role === 'giáo viên' ? 'Giáo viên' : 'Học sinh'));
      const finalFullName = account.full_name || account.username;
      account.target_audience = finalTargetAudience;
      account.full_name = finalFullName;
      
      const secret = await getServerSecret();
      const token = signJWTSync({ 
          id: account.id,
          auth_state: crypto.createHash('sha256').update(accountSessionMaterial(account)).digest('hex'),
          exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
          user_id: account.user_id || account.id,
          role: account.role, 
          target_audience: finalTargetAudience,
          full_name: finalFullName,
          username: account.username,
          donvi: account.donvi || '',
          lop: account.lop || ''
      }, secret);
      
      const { password: _passwordHash, ...safeAccount } = account;
      res.json({
          data: safeAccount,
          token: token,
          error: null
      });
      
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });

  app.get("/api/auth/session", async (req, res) => {
    try {
      res.setHeader("Cache-Control","private, no-store, max-age=0");
      const auth=req.headers.authorization||"";
      if(!auth.startsWith("Bearer ")) return res.status(401).json({error:"Phiên đăng nhập không hợp lệ."});
      const claims:any=verifyJWTSync(auth.slice(7),await getServerSecret());
      if(!claims?.id||!claims?.auth_state) return res.status(401).json({error:"Phiên đăng nhập đã hết hạn hoặc không còn hiệu lực."});
      const row=(await executeSqlQuery(`
        SELECT a.id,a.user_id,a.username,a.password,a.role,a.is_active,a.expiry_date,
               u.full_name,u.target_audience,u.donvi,u.lop,u.is_active AS profile_active,u.expiry_date AS profile_expiry_date
        FROM accounts a LEFT JOIN users u ON u.id=COALESCE(a.user_id,a.id)
        WHERE a.id=? LIMIT 1
      `,[claims.id])).results?.[0];
      if(!row||!getAccountAccessStatus(row).allowed) return res.status(401).json({error:"Phiên đăng nhập đã hết hạn hoặc không còn hiệu lực."});
      const expected=crypto.createHash('sha256').update(accountSessionMaterial(row)).digest('hex');
      if(expected!==claims.auth_state) return res.status(401).json({error:"Phiên đăng nhập đã hết hạn hoặc không còn hiệu lực."});
      const audience=row.target_audience||(String(row.role).toLowerCase()==='admin'?'Quản trị viên':['teacher','giáo viên'].includes(String(row.role).toLowerCase())?'Giáo viên':'Học sinh');
      return res.json({data:{
        id:row.id,user_id:row.user_id||row.id,username:row.username,role:row.role,
        target_audience:audience,full_name:row.full_name||row.username,
        donvi:row.donvi||'',lop:row.lop||'',is_vip:false
      },error:null});
    } catch {
      return res.status(503).json({error:"Không thể xác minh phiên đăng nhập."});
    }
  });

  app.post("/api/auth/change-password", async (req, res) => {
    try {
      const { username, oldPassword, newPassword } = req.body;
      if (!username || !oldPassword || !newPassword) {
        return res.status(400).json({ error: "Vui lòng cung cấp đầy đủ thông tin!" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: "Mật khẩu mới phải có ít nhất 6 ký tự!" });
      }

      const resDb = await executeSqlQuery("SELECT * FROM accounts WHERE username = ?", [username]);
      if (!resDb.results || resDb.results.length === 0) {
        return res.status(400).json({ error: "Tên đăng nhập hoặc mật khẩu cũ không đúng!" });
      }

      const account = resDb.results[0];
      const isValid = verifyPasswordSync(oldPassword, account.password);
      if (!isValid) {
        return res.status(400).json({ error: "Tên đăng nhập hoặc mật khẩu cũ không đúng!" });
      }

      const hashedNewPassword = hashPasswordPBKDF2Sync(newPassword);
      await executeSqlQuery("UPDATE accounts SET password = ? WHERE id = ?", [hashedNewPassword, account.id]);

      res.json({ data: { success: true }, error: null });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Lỗi máy chủ khi đổi mật khẩu" });
    }
  });

  
  app.post("/api/auth/register", async (req, res) => {
    return res.status(403).json({ error: "Cơ chế tự đăng ký tài khoản đã bị khóa tuyệt đối. Chỉ Admin mới có quyền tạo tài khoản." });
  });
    
      // ==========================================
  // ==========================================
  // BẢO MẬT: API TÀI KHOẢN (ACCOUNTS)
  // Chỉ quản lý thông tin tài khoản đăng nhập
  // ==========================================
  
  // Bounded management pages are read-only, scoped to the authenticated role.
  app.get('/api/accounts-page',async(req,res)=>{
    try {
      const auth=req.headers.authorization||'';
      if(!auth.startsWith('Bearer '))return res.status(401).json({error:'Yêu cầu đăng nhập Admin.'});
      const actor=verifyJWTSync(auth.slice(7),await getServerSecret());
      if(!actor||String(actor.role||'').toLowerCase()!=='admin')return res.status(403).json({error:'Không có quyền quản lý tài khoản.'});
      const page=parseManagementPage('https://local.invalid'+req.originalUrl),q=accountsPageQuery(page);
      const count=await executeSqlQuery(q.countSQL,q.countArgs);
      const data=await executeSqlQuery(q.rowsSQL,q.rowsArgs);
      const total=Number(count.results?.[0]?.total||0);
      let facets:any=null;
      if(req.query.facets==='1') {
        const sets:any[]=[];
        for(const sql of accountsFacetQueries()){
          const rows=await executeSqlQuery(sql,[]);
          sets.push((rows.results||[]).map((x:any)=>x.value).filter(Boolean));
        }
        facets={audiences:sets[0],units:sets[1],classes:sets[2]};
      }
      return res.json({data:data.results||[],total,page:page.page,limit:page.limit,has_more:page.page*page.limit<total,facets,error:null});
    }catch(e){return res.status(500).json({error:'Không thể tải trang tài khoản.'});}
  });
  app.get('/api/results-page',async(req,res)=>{
    try{
      const auth=req.headers.authorization||'';
      if(!auth.startsWith('Bearer '))return res.status(401).json({error:'Yêu cầu đăng nhập.'});
      const actor=verifyJWTSync(auth.slice(7),await getServerSecret());
      if(!actor||!checkIsTeacherOrAdmin(actor))return res.status(403).json({error:'Không có quyền xem kết quả.'});
      const page=parseManagementPage('https://local.invalid'+req.originalUrl);
      const verified=await resolveTeacherManagementScope({...actor,role:checkIsAdmin(actor)?'admin':'teacher'},async(sql,args)=>(await executeSqlQuery(sql,args)).results||[]);
      const q=resultsPageQuery(page,verified);
      const count=await executeSqlQuery(q.countSQL,q.countArgs);
      const data=await executeSqlQuery(q.rowsSQL,q.rowsArgs);
      const total=Number(count.results?.[0]?.total||0);
      let facets:any=null;
      if(req.query.facets==='1') {
        const query=resultsFacetQuery(verified);
        const meta=await executeSqlQuery(query.sql,query.args);
        facets={rows:meta.results||[]};
        if(verified.role==='teacher'){
          const owned=teacherOwnedExamNamesQuery(verified);
          const names=await executeSqlQuery(owned.sql,owned.args);
          facets.exams=(names.results||[]).map((row:any)=>row.name).filter(Boolean);
        }
        if(verified.role==='admin'){
          const teachers=await executeSqlQuery(`SELECT a.id,a.username,u.full_name FROM accounts a LEFT JOIN users u ON u.id=COALESCE(a.user_id,a.id) WHERE LOWER(a.role) IN ('teacher','giáo viên') OR LOWER(u.target_audience)='giáo viên' ORDER BY u.full_name,a.username LIMIT 500`,[]);
          facets.teachers=(teachers.results||[]).map((x:any)=>({id:x.id,label:x.full_name||x.username||x.id}));
        }
      }
      return res.json({data:data.results||[],total,page:page.page,limit:page.limit,has_more:page.page*page.limit<total,facets,error:null});
    }catch(e){return res.status(500).json({error:'Không thể tải trang kết quả.'});}
  });

  // Dữ liệu nền theo vai trò: Admin full; GV chỉ hồ sơ mình + HS/tài khoản HS lớp phân công; HS chỉ chính mình + GV cần thiết.
  app.get("/api/core-identity", async (req, res) => {
    try {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
      const actor: any = verifyJWTSync(auth.slice(7), await getServerSecret());
      if (!actor) return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ' });

      const projection = `
        /* no-cache */ SELECT u.*,
          (SELECT a.id FROM accounts a WHERE a.user_id=u.id OR a.id=u.id ORDER BY CASE WHEN a.user_id=u.id THEN 0 ELSE 1 END, a.created_at DESC LIMIT 1) AS account_id,
          (SELECT a.username FROM accounts a WHERE a.user_id=u.id OR a.id=u.id ORDER BY CASE WHEN a.user_id=u.id THEN 0 ELSE 1 END, a.created_at DESC LIMIT 1) AS account_username,
          (SELECT a.role FROM accounts a WHERE a.user_id=u.id OR a.id=u.id ORDER BY CASE WHEN a.user_id=u.id THEN 0 ELSE 1 END, a.created_at DESC LIMIT 1) AS account_role,
          (SELECT a.is_active FROM accounts a WHERE a.user_id=u.id OR a.id=u.id ORDER BY CASE WHEN a.user_id=u.id THEN 0 ELSE 1 END, a.created_at DESC LIMIT 1) AS account_is_active
        FROM users u
      `;
      const accountProjection = `
        SELECT a.id,a.user_id,a.username,a.role,a.is_active,a.expiry_date,a.created_at,
               u.full_name,u.phone_number,u.donvi,u.lop,u.target_audience,u.occupation
        FROM accounts a LEFT JOIN users u ON u.id=COALESCE(a.user_id,a.id)
      `;
      const paged=String(req.query.paged||'')==='1';
      const selfId=String(actor.user_id||actor.id||'');
      const accountId=String(actor.id||selfId);

      if (checkIsAdmin(actor)) {
        if(paged){
          const selfRes=await executeSqlQuery(
            projection+' WHERE u.id=? OR u.id=? ORDER BY CASE WHEN u.id=? THEN 0 ELSE 1 END,u.id DESC LIMIT 1',
            [selfId,accountId,selfId]
          );
          const selfProfile:any=selfRes.results?.[0];
          if(!selfProfile) return res.status(409).json({error:'Không tìm thấy hồ sơ Admin liên kết với tài khoản đăng nhập.'});
          selfProfile.assigned_classes=[];
          const [uCount,aCount]=await Promise.all([
            executeSqlQuery('/* no-cache */ SELECT COUNT(*)::int AS total FROM users',[]),
            executeSqlQuery('SELECT COUNT(*)::int AS total FROM accounts',[])
          ]);
          return res.json({data:{
            role_scope:'admin',paged:true,users:[selfProfile],accounts:[],teachers:[],assigned_classes:[],
            counts:{users:Number(uCount.results?.[0]?.total||0),accounts:Number(aCount.results?.[0]?.total||0),teachers:0}
          },error:null});
        }
        const [uRes,aRes,tcRes]=await Promise.all([
          executeSqlQuery(projection+` ORDER BY CASE
            WHEN LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('quản trị viên','admin') THEN 0
            WHEN LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('giáo viên','teacher') THEN 1
            WHEN LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student') THEN 2 ELSE 3 END,
            u.created_at DESC,u.id DESC`,[]),
          executeSqlQuery(accountProjection+` ORDER BY CASE
            WHEN LOWER(TRIM(COALESCE(a.role,'')))='admin' OR LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('quản trị viên','admin') THEN 0
            WHEN LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('giáo viên','teacher') OR LOWER(TRIM(COALESCE(a.role,''))) IN ('teacher','giáo viên') THEN 1
            WHEN LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student') THEN 2 ELSE 3 END,
            a.created_at DESC,a.id DESC`,[]),
          executeSqlQuery('SELECT id,teacher_id,teacher_name,class_name,donvi,role,subject,created_at FROM teacher_classes ORDER BY class_name ASC,donvi ASC,id ASC',[])
        ]);
        const map:any={};
        for(const tc of (tcRes.results||[])){const id=String(tc.teacher_id||'');(map[id]||(map[id]=[])).push(tc);}
        const users=(uRes.results||[]).map((u:any)=>({...u,assigned_classes:map[String(u.id)]||[]}));
        const accounts=aRes.results||[];
        return res.json({data:{role_scope:'admin',users,accounts,teachers:[],assigned_classes:[],counts:{users:users.length,accounts:accounts.length,teachers:0}},error:null});
      }

      const selfRes=await executeSqlQuery(projection+' WHERE u.id=? OR u.id=? ORDER BY CASE WHEN u.id=? THEN 0 ELSE 1 END,u.id DESC LIMIT 1',[selfId,accountId,selfId]);
      const selfProfile:any=selfRes.results?.[0];
      if(!selfProfile) return res.status(409).json({error:'Không tìm thấy hồ sơ người dùng liên kết với tài khoản đăng nhập.'});

      if (checkIsTeacherOrAdmin(actor)) {
        const tcRes=await executeSqlQuery(
          'SELECT id,teacher_id,teacher_name,class_name,donvi,role,subject,created_at FROM teacher_classes WHERE teacher_id=? OR teacher_id=? ORDER BY class_name ASC',
          [selfId,accountId]
        );
        const assignments=tcRes.results||[];
        for(const a of assignments){
          if(!String(a?.class_name||'').trim()||!String(a?.donvi||'').trim()){
            return res.status(409).json({
              error:'Phân công lớp của giáo viên thiếu lớp hoặc đơn vị nên không thể xác định phạm vi dữ liệu an toàn.',
              code:'TEACHER_ASSIGNMENT_SCOPE_INCOMPLETE'
            });
          }
        }
        if(paged){
          selfProfile.assigned_classes=assignments;
          const studentCountSql=`
            /* no-cache */ SELECT COUNT(*)::int AS total FROM users u
            WHERE LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student')
              AND EXISTS(SELECT 1 FROM teacher_classes tc WHERE (tc.teacher_id=? OR tc.teacher_id=?)
                AND LOWER(TRIM(tc.class_name))=LOWER(TRIM(COALESCE(u.lop,'')))
                AND LOWER(TRIM(COALESCE(tc.donvi,'')))=LOWER(TRIM(COALESCE(u.donvi,''))))`;
          const accountCountSql=`
            SELECT COUNT(*)::int AS total FROM accounts a
            JOIN users u ON u.id=COALESCE(a.user_id,a.id)
            WHERE LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student')
              AND EXISTS(SELECT 1 FROM teacher_classes tc WHERE (tc.teacher_id=? OR tc.teacher_id=?)
                AND LOWER(TRIM(tc.class_name))=LOWER(TRIM(COALESCE(u.lop,'')))
                AND LOWER(TRIM(COALESCE(tc.donvi,'')))=LOWER(TRIM(COALESCE(u.donvi,''))))`;
          const [studentsCount,accountsCount]=await Promise.all([
            executeSqlQuery(studentCountSql,[selfId,accountId]),
            executeSqlQuery(accountCountSql,[selfId,accountId])
          ]);
          const studentTotal=Number(studentsCount.results?.[0]?.total||0);
          return res.json({data:{
            role_scope:'teacher',paged:true,users:[selfProfile],accounts:[],teachers:[],assigned_classes:assignments,
            counts:{users:studentTotal+1,accounts:Number(accountsCount.results?.[0]?.total||0),teachers:0,students:studentTotal}
          },error:null});
        }
        let students:any[]=[]; let accounts:any[]=[];
        if(assignments.length){
          const studentSql=projection+`
            WHERE LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student')
              AND EXISTS(SELECT 1 FROM teacher_classes tc WHERE (tc.teacher_id=? OR tc.teacher_id=?)
                AND LOWER(TRIM(tc.class_name))=LOWER(TRIM(COALESCE(u.lop,'')))
                AND LOWER(TRIM(COALESCE(tc.donvi,'')))=LOWER(TRIM(COALESCE(u.donvi,''))))
            ORDER BY u.created_at DESC,u.id DESC`;
          const accountSql=accountProjection+`
            WHERE LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student')
              AND EXISTS(SELECT 1 FROM teacher_classes tc WHERE (tc.teacher_id=? OR tc.teacher_id=?)
                AND LOWER(TRIM(tc.class_name))=LOWER(TRIM(COALESCE(u.lop,'')))
                AND LOWER(TRIM(COALESCE(tc.donvi,'')))=LOWER(TRIM(COALESCE(u.donvi,''))))
            ORDER BY LOWER(COALESCE(u.full_name,'')) ASC,LOWER(COALESCE(a.username,'')) ASC,a.id DESC`;
          const [sRes,aRes]=await Promise.all([
            executeSqlQuery(studentSql,[selfId,accountId]),
            executeSqlQuery(accountSql,[selfId,accountId])
          ]);
          students=sRes.results||[];
          accounts=aRes.results||[];
        }
        selfProfile.assigned_classes=assignments;
        const users=[selfProfile,...students.filter((u:any)=>String(u.id)!==String(selfProfile.id))];
        return res.json({data:{role_scope:'teacher',users,accounts,teachers:[],assigned_classes:assignments,counts:{users:users.length,accounts:accounts.length,teachers:0,students:students.length}},error:null});
      }

      const selfAccRes=await executeSqlQuery(accountProjection+' WHERE a.id=? OR a.user_id=? ORDER BY CASE WHEN a.id=? THEN 0 ELSE 1 END,a.created_at DESC LIMIT 1',[accountId,selfId,accountId]);
      const ownAccounts=selfAccRes.results||[];
      const examRes=await executeSqlQuery(`
        SELECT ec.creator_id,ec.chedodethi,ec.target_lop,ec.lop,ec.target_donvi,ec.donvi,ec.access_control,
          COALESCE(up.donvi,uap.donvi,'') AS teacher_donvi,
          COALESCE(NULLIF(TRIM(up.full_name),''),NULLIF(TRIM(uap.full_name),''),'Giáo viên') AS full_name,
          COALESCE(ap.role,a.role,'teacher') AS creator_role
        FROM exam_configs ec
        LEFT JOIN users up ON up.id=ec.creator_id
        LEFT JOIN accounts a ON a.id=ec.creator_id
        LEFT JOIN users uap ON uap.id=a.user_id
        LEFT JOIN accounts ap ON ap.user_id=ec.creator_id
        WHERE ec.creator_id IS NOT NULL AND TRIM(ec.creator_id)<>''`,[]);
      const norm=(v:any)=>String(v||'').trim().toLowerCase();
      const normClass=(v:any)=>norm(v).replace(/\s+/g,'');
      const sUnit=norm(selfProfile.donvi||selfProfile.address||'');
      const sClass=normClass(selfProfile.lop||'');
      const byCreator=new Map<string,any>();
      for(const row of (examRes.results||[])){
        const cid=String(row.creator_id||'').trim(); if(!cid)continue;
        let allowed=true; const mode=String(row.chedodethi||'').trim();
        if(mode==='Đề cho đơn vị'||mode==='Đề thi cho đơn vị'){
          const tUnit=norm(row.teacher_donvi);
          const examUnit=norm(row.target_donvi||row.donvi);
          let ac:any=null;
          try{ac=typeof row.access_control==='string'?JSON.parse(row.access_control||'{}'):row.access_control;}catch{}
          const units=ac?.allowedUnits?(Array.isArray(ac.allowedUnits)?ac.allowedUnits:[ac.allowedUnits]).map(norm).filter(Boolean):[];
          const scopedUnits=[...new Set([examUnit,...units].filter(Boolean))];
          let same=false;
          if(sUnit){
            if(scopedUnits.length) same=scopedUnits.includes(sUnit);
            else if(tUnit) same=sUnit===tUnit;
          }
          if(!same)allowed=false;
          if(allowed){const target=String(row.target_lop||row.lop||'').trim();if(target)allowed=!!sClass&&target.split(',').map(normClass).filter(Boolean).includes(sClass);}
        }
        if(!allowed||byCreator.has(cid))continue;
        const role=norm(row.creator_role)==='admin'?'admin':'teacher';
        byCreator.set(cid,{id:cid,full_name:String(row.full_name||'Giáo viên'),donvi:String(row.teacher_donvi||''),role,target_audience:role==='admin'?'Quản trị viên':'Giáo viên',exam_count:1});
      }
      const teachers=[...byCreator.values()].sort((a:any,b:any)=>String(a.full_name).localeCompare(String(b.full_name),'vi'));
      return res.json({data:{role_scope:'student',users:[selfProfile],accounts:ownAccounts,teachers,assigned_classes:[],counts:{users:1,accounts:ownAccounts.length,teachers:teachers.length}},error:null});
    } catch (e:any) {
      console.error('GET /api/core-identity error:',e);
      return res.status(500).json({error:'Không thể tải dữ liệu nền theo vai trò.'});
    }
  });

  // 1. Lấy danh sách tài khoản - phân trang snapshot nhất quán.
  app.get("/api/accounts", async (req, res) => {
    try {
      const authHeader=req.headers.authorization||'';
      if(!authHeader.startsWith("Bearer ")) return res.status(401).json({error:"Unauthorized"});
      const user:any=verifyJWTSync(authHeader.substring(7),await getServerSecret());
      if(!user) return res.status(401).json({error:"Phiên đăng nhập không hợp lệ"});

      const isAdmin=checkIsAdmin(user);
      const isTeacher=checkIsTeacherOrAdmin(user)&&!isAdmin;
      const limitParam=req.query.limit as string;
      const offsetParam=req.query.offset as string;
      const pageParam=req.query.page as string;
      const requestedSnapshot=String((req.query.snapshot as string)||'').trim();

      let limit=-1;
      if(limitParam!==undefined&&!['all','0','-1'].includes(limitParam)){
        const parsed=parseInt(limitParam,10);
        if(!isNaN(parsed)&&parsed>0) limit=Math.min(parsed,5000);
      }
      let offset=0;
      if(offsetParam!==undefined){
        const parsed=parseInt(offsetParam,10);
        if(!isNaN(parsed)&&parsed>=0) offset=parsed;
      }else if(pageParam!==undefined){
        const page=parseInt(pageParam,10);
        if(!isNaN(page)&&page>0) offset=(page-1)*(limit>0?limit:1000);
      }
      const paginationClause=limit>0?` LIMIT ${limit} OFFSET ${offset}`:'';

      const projection=`
        SELECT a.id,a.user_id,a.username,a.role,a.is_active,a.expiry_date,a.created_at,
               u.full_name,u.phone_number,u.donvi,u.lop,u.target_audience,u.occupation
        FROM accounts a
        LEFT JOIN users u ON u.id=COALESCE(a.user_id,a.id)
      `;

      let rows:any[]=[];
      let total=0;
      let snapshot='';
      let whereSql='';
      let orderSql=`CASE
        WHEN LOWER(TRIM(COALESCE(a.role,'')))='admin' OR LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('quản trị viên','admin') THEN 0
        WHEN LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('giáo viên','teacher') OR LOWER(TRIM(COALESCE(a.role,''))) IN ('teacher','giáo viên') THEN 1
        WHEN LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student') THEN 2 ELSE 3 END,
        a.created_at DESC,a.id DESC`;
      let binds:any[]=[];

      if(isAdmin){
        // full account scope
      }else if(isTeacher){
        const selfId=String(user.user_id||user.id||'');
        const accountId=String(user.id||selfId);
        whereSql=`
          WHERE LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student')
            AND EXISTS (
              SELECT 1 FROM teacher_classes tc
              WHERE tc.teacher_id IN (?,?)
                AND LOWER(TRIM(tc.class_name))=LOWER(TRIM(COALESCE(u.lop,'')))
                AND LOWER(TRIM(tc.donvi))=LOWER(TRIM(COALESCE(u.donvi,'')))
            )`;
        binds=[selfId,accountId];
        orderSql="LOWER(COALESCE(u.full_name,'')) ASC,LOWER(COALESCE(a.username,'')) ASC,a.id DESC";
      }else{
        const selfId=String(user.user_id||user.id||'');
        const accountId=String(user.id||selfId);
        const result=await executeSqlQuery(projection+`
          WHERE a.id=? OR a.user_id=?
          ORDER BY CASE WHEN a.id=? THEN 0 ELSE 1 END,a.created_at DESC,a.id DESC
          LIMIT 1`,[accountId,selfId,accountId]);
        rows=result.results||[];
        total=rows.length;
        snapshot=rows.length?String(rows[0].id):'';
        return res.status(200).json({data:rows,total,limit,offset:0,has_more:false,snapshot,role_scope:'student',error:null});
      }

      const metaSql=`
        SELECT COUNT(*)::int AS total,
               MD5(COALESCE(STRING_AGG(a.id,'|' ORDER BY ${orderSql}),'')) AS snapshot
        FROM accounts a
        LEFT JOIN users u ON u.id=COALESCE(a.user_id,a.id)
        ${whereSql}`;
      const meta=await executeSqlQuery(metaSql,binds);
      total=Number(meta.results?.[0]?.total||0);
      snapshot=String(meta.results?.[0]?.snapshot||'');

      if(requestedSnapshot&&requestedSnapshot!==snapshot){
        return res.status(409).json({
          error:'Phạm vi dữ liệu đã thay đổi trong khi đang phân trang. Cần tải lại từ trang đầu.',
          code:'PAGINATION_SCOPE_CHANGED',snapshot,total
        });
      }

      const data=await executeSqlQuery(projection+whereSql+` ORDER BY ${orderSql}${paginationClause}`,binds);
      rows=data.results||[];

      const verifyMeta=await executeSqlQuery(metaSql,binds);
      const verifyTotal=Number(verifyMeta.results?.[0]?.total||0);
      const verifySnapshot=String(verifyMeta.results?.[0]?.snapshot||'');
      if(verifyTotal!==total||verifySnapshot!==snapshot){
        return res.status(409).json({
          error:'Phạm vi dữ liệu thay đổi ngay trong lúc đọc trang. Cần tải lại từ đầu.',
          code:'PAGINATION_SCOPE_CHANGED',snapshot:verifySnapshot,total:verifyTotal
        });
      }

      const ids=new Set(rows.map((row:any)=>String(row?.id||'')));
      if(ids.size!==rows.length||ids.has('')){
        return res.status(500).json({
          error:'Phân trang tài khoản phát hiện bản ghi trùng hoặc thiếu ID.',
          code:'PAGINATION_PAGE_INVALID'
        });
      }

      return res.status(200).json({
        data:rows,total,limit,offset,
        has_more:limit>0?offset+rows.length<total:false,
        snapshot,
        role_scope:isAdmin?'admin':'teacher',
        error:null
      });
    }catch(e:any){
      console.error("GET /api/accounts error::",e);
      return res.status(500).json({error:e.message||'Lỗi server'});
    }
  });

  // Reset mật khẩu hàng loạt (Admin only). Một UPDATE duy nhất đảm bảo không có trạng thái nửa chừng.
  app.post("/api/accounts/reset-password", authLimiter, async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Yêu cầu đăng nhập Admin." });
      }
      const actor: any = verifyJWTSync(authHeader.substring(7), await getServerSecret());
      if (!checkIsAdmin(actor)) {
        return res.status(403).json({ error: "Chỉ Admin mới được reset mật khẩu tài khoản." });
      }

      const rawIds = Array.isArray(req.body?.account_ids) ? req.body.account_ids : [];
      const accountIds = [...new Set(rawIds.map((id: any) => String(id ?? '').trim()).filter(Boolean))] as string[];
      const password = String(req.body?.password ?? '');
      const maxAccounts = 500;

      if (!accountIds.length) {
        return res.status(400).json({ error: "Chưa chọn tài khoản cần reset mật khẩu." });
      }
      if (accountIds.length > maxAccounts) {
        return res.status(400).json({ error: `Mỗi lần chỉ được reset tối đa ${maxAccounts} tài khoản.` });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Mật khẩu mặc định phải có ít nhất 6 ký tự." });
      }
      if (password.length > 128) {
        return res.status(400).json({ error: "Mật khẩu mặc định không được vượt quá 128 ký tự." });
      }

      const marks = accountIds.map(() => '?').join(',');
      const before = await executeSqlQuery(
        `SELECT id FROM accounts WHERE id IN (${marks})`,
        accountIds
      );
      const foundIds = new Set((before.results || []).map((row: any) => String(row.id)));
      const missing = accountIds.filter(id => !foundIds.has(id));
      if (missing.length || foundIds.size !== accountIds.length) {
        return res.status(409).json({
          error: "Danh sách tài khoản đã thay đổi. Không có mật khẩu nào được reset.",
          code: "ACCOUNT_SELECTION_CHANGED",
          missing_account_ids: missing
        });
      }

      const hashes = new Map<string,string>();
      for (const id of accountIds) {
        const hash = hashPasswordPBKDF2Sync(password);
        if (!hash.startsWith('pbkdf2:sha256:') || !verifyPasswordSync(password, hash)) {
          return res.status(500).json({
            error: "Không thể xác minh kết quả mã hóa mật khẩu. Không có tài khoản nào được cập nhật."
          });
        }
        hashes.set(id, hash);
      }

      const payload = accountIds.map(id => ({ id, password: hashes.get(id) }));
      const changed = await executeSqlQuery(
        `WITH input AS (
           SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(id text,password text)
         )
         UPDATE accounts a SET password=input.password FROM input WHERE a.id=input.id
         RETURNING a.id,a.password`,
        [JSON.stringify(payload)]
      );
      if ((changed.results || []).length !== accountIds.length) {
        return res.status(500).json({
          error: "Số tài khoản được cập nhật không khớp danh sách đã chọn.",
          code: "PASSWORD_RESET_WRITE_MISMATCH"
        });
      }

      const after = await executeSqlQuery(
        `SELECT id,password FROM accounts WHERE id IN (${marks})`,
        accountIds
      );
      const rows = after.results || [];
      if (rows.length !== accountIds.length) {
        return res.status(500).json({
          error: "Không thể xác nhận toàn bộ mật khẩu sau khi ghi.",
          code: "PASSWORD_RESET_VERIFY_FAILED"
        });
      }
      for (const row of rows) {
        const expected = hashes.get(String(row.id));
        if (!expected || String(row.password || '') !== expected || !verifyPasswordSync(password, String(row.password || ''))) {
          return res.status(500).json({
            error: "Không thể xác nhận toàn bộ mật khẩu sau khi ghi.",
            code: "PASSWORD_RESET_VERIFY_FAILED"
          });
        }
      }

      return res.json({
        data: {
          success: true,
          updated: accountIds.length,
          account_ids: accountIds,
          password_scheme: "pbkdf2:sha256",
          unique_salt_per_account: true,
          session_tokens_invalidated: true,
          self_reset: accountIds.includes(String(actor.id || ''))
        },
        error: null
      });
    } catch (e: any) {
      console.error("POST /api/accounts/reset-password error::", e);
      return res.status(500).json({ error: e.message || "Không thể reset mật khẩu tài khoản." });
    }
  });

  // Cập nhật hạn dùng hàng loạt cho tài khoản (Admin only).
  app.post("/api/accounts/bulk-expiry", authLimiter, async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Yêu cầu đăng nhập Admin." });
      }
      const actor: any = verifyJWTSync(authHeader.substring(7), await getServerSecret());
      if (!checkIsAdmin(actor)) {
        return res.status(403).json({ error: "Chỉ Admin mới được cập nhật hạn dùng tài khoản." });
      }

      const rawIds = Array.isArray(req.body?.account_ids) ? req.body.account_ids : [];
      const accountIds = [...new Set(rawIds.map((id: any) => String(id ?? '').trim()).filter(Boolean))] as string[];
      const maxAccounts = 500;
      if (!accountIds.length) {
        return res.status(400).json({ error: "Chưa chọn tài khoản cần cập nhật hạn dùng." });
      }
      if (accountIds.length > maxAccounts) {
        return res.status(400).json({ error: `Mỗi lần chỉ được cập nhật tối đa ${maxAccounts} tài khoản.` });
      }

      let expiry: string | null;
      try {
        expiry = normalizeVietnamExpiryForStorage(req.body?.expiry_date);
      } catch {
        return res.status(400).json({ error: "Ngày hết hạn không hợp lệ." });
      }

      const marks = accountIds.map(() => '?').join(',');
      const before = await executeSqlQuery(
        `SELECT id FROM accounts WHERE id IN (${marks})`,
        accountIds
      );
      const found = new Set((before.results || []).map((row: any) => String(row.id)));
      const missing = accountIds.filter(id => !found.has(id));
      if (missing.length || found.size !== accountIds.length) {
        return res.status(409).json({
          error: "Danh sách tài khoản đã thay đổi. Chưa cập nhật hạn dùng cho tài khoản nào.",
          code: "ACCOUNT_SELECTION_CHANGED",
          missing_account_ids: missing
        });
      }

      await executeSqlQuery(
        `UPDATE accounts SET expiry_date = ? WHERE id IN (${marks})`,
        [expiry, ...accountIds]
      );

      const after = await executeSqlQuery(
        `SELECT id, expiry_date FROM accounts WHERE id IN (${marks})`,
        accountIds
      );
      const rows = after.results || [];
      const expected = expiry || '';
      const confirmed = new Set(
        rows
          .filter((row: any) => String(row.expiry_date || '') === expected)
          .map((row: any) => String(row.id))
      );
      if (rows.length !== accountIds.length || accountIds.some(id => !confirmed.has(id))) {
        return res.status(500).json({
          error: "Không thể xác nhận toàn bộ hạn dùng sau khi ghi. Cần kiểm tra lại dữ liệu.",
          code: "ACCOUNT_EXPIRY_VERIFY_FAILED"
        });
      }

      return res.json({
        data: {
          success: true,
          updated: accountIds.length,
          verified: accountIds.length,
          account_ids: accountIds,
          expiry_date: expiry,
          unlimited: expiry === null,
          self_account_updated: accountIds.includes(String(actor.id || ''))
        },
        error: null
      });
    } catch (e: any) {
      console.error("POST /api/accounts/bulk-expiry error::", e);
      return res.status(500).json({ error: e.message || "Không thể cập nhật hạn dùng tài khoản." });
    }
  });

  // 2. Tạo tài khoản mới (Admin only)
  app.post("/api/accounts", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const token = authHeader.substring(7);
      const user = verifyJWTSync(token, await getServerSecret());
      if (!checkIsAdmin(user)) return res.status(403).json({ error: "Chỉ Admin mới được thêm tài khoản" });

      // Xử lý tạo tài khoản đồng loạt nếu body có chứa mảng accounts
      if (req.body && Array.isArray(req.body.accounts)) {
          const list = req.body.accounts;
          const created = [];
          const failed = [];
          
          // Tối ưu hóa 1: Lấy tất cả tên đăng nhập hiện tại một lần duy nhất
          let existingSet = new Set<string>();
          try {
              const allExisting = await executeSqlQuery("SELECT username FROM accounts", []);
              if (allExisting.results) {
                  allExisting.results.forEach((a: any) => {
                      if (a.username) existingSet.add(String(a.username).toLowerCase().trim());
                  });
              }
          } catch (e) {
              console.warn("Could not pre-fetch usernames, falling back:", e);
          }

          for (const item of list) {
              try {
                  let { user_id, username, password, role, is_active, expiry_date, full_name, lop, target_audience } = item;
                  if (!username || !password) {
                      failed.push({ user_id, full_name, error: "Thiếu tên đăng nhập hoặc mật khẩu" });
                      continue;
                  }
                  username = String(username).trim();
                  let finalUsername = username;
                  let suffix = 1;
                  
                  // Tối ưu hóa 2: Kiểm tra trùng lặp trong bộ nhớ thay vì truy vấn DB nhiều lần
                  while (existingSet.has(finalUsername.toLowerCase())) {
                      finalUsername = `${username}${suffix++}`;
                  }
                  existingSet.add(finalUsername.toLowerCase());

                  // Mỗi tài khoản có salt PBKDF2 riêng, kể cả cùng mật khẩu mặc định.
                  const hashedPassword = hashPasswordPBKDF2Sync(password);
                  if (!verifyPasswordSync(String(password), hashedPassword)) {
                      throw new Error("Không thể xác minh mật khẩu vừa mã hóa");
                  }

                  const id = (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
                  const activeVal = (is_active !== false && is_active !== 0 && is_active !== 'false') ? 1 : 0;
                  const normalizedExpiry = normalizeVietnamExpiryForStorage(expiry_date);
                  const sql = "INSERT INTO accounts (id, user_id, username, password, role, is_active, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
                  await executeSqlQuery(sql, [
                      id,
                      user_id || id,
                      finalUsername,
                      hashedPassword,
                      role || 'user',
                      activeVal,
                      normalizedExpiry,
                      new Date().toISOString()
                  ]);
                  created.push({
                      id,
                      user_id: user_id || id,
                      username: finalUsername,
                      password,
                      full_name: full_name || '',
                      lop: lop || '',
                      target_audience: target_audience || (role === 'teacher' ? 'Giáo viên' : 'Học sinh'),
                      role: role || 'user'
                  });
              } catch(err: any) {
                  failed.push({ user_id: item.user_id, full_name: item.full_name, error: err.message || "Lỗi tạo tài khoản" });
              }
          }
          return res.status(201).json({ data: { created, failed }, error: null });
      }

      let { username, password, role, is_active, expiry_date, user_id } = req.body;

      if (!username || !username.trim()) {
          const randSuffix = Math.random().toString(36).substring(2, 8);
          username = `usr_${Date.now()}_${randSuffix}`;
      } else {
          username = username.trim();
      }
      if (!password) {
          password = '123456';
      }

      // Kiểm tra trùng lặp
      const checkResult = await executeSqlQuery("SELECT id FROM accounts WHERE username = ?", [username]);
      if (checkResult.results && checkResult.results.length > 0) {
          return res.status(400).json({ error: "Tên đăng nhập đã tồn tại!" });
      }

      // Mã hóa mật khẩu chuẩn PBKDF2 với Salt
      const hashedPassword = hashPasswordPBKDF2Sync(password);
      if (!verifyPasswordSync(String(password), hashedPassword)) {
        return res.status(500).json({ error: "Không thể xác minh mật khẩu vừa mã hóa" });
      }

      const id = (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
      const normalizedExpiry = normalizeVietnamExpiryForStorage(expiry_date);
      
      const sql = "INSERT INTO accounts (id, user_id, username, password, role, is_active, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
      const activeVal = (is_active !== false && is_active !== 0 && is_active !== 'false') ? 1 : 0;
      const params = [
        id, 
        user_id || id,
        username, 
        hashedPassword, 
        role || 'user', 
        activeVal, 
        normalizedExpiry, 
        new Date().toISOString()
      ];
      
      await executeSqlQuery(sql, params);
      return res.status(201).json({ data: { id, user_id, username }, error: null });
    } catch (e: any) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("POST /api/accounts error::", e);
      return res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });

  // 3. Sửa tài khoản (Admin only)
  app.put("/api/accounts/:id", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const token = authHeader.substring(7);
      const user = verifyJWTSync(token, await getServerSecret());
      if (!checkIsAdmin(user)) return res.status(403).json({ error: "Chỉ Admin mới được sửa tài khoản" });

      const accountId = req.params.id;
      const { username, password, role, is_active, expiry_date, user_id } = req.body;

      // KIỂM TRA BẢO MẬT TÀI KHOẢN ADMIN
      const findTargetAcc = await executeSqlQuery("SELECT id, username, role FROM accounts WHERE id = ?", [accountId]);
      const targetAcc = findTargetAcc.results && findTargetAcc.results.length > 0 ? findTargetAcc.results[0] : null;

      if (targetAcc) {
        const isTargetAdmin = targetAcc.role === 'admin' || targetAcc.username === 'admin' || targetAcc.id === 'admin';
        if (isTargetAdmin) {
          if (role !== undefined && role !== 'admin') {
            return res.status(400).json({ error: "BẢO MẬT HỆ THỐNG: Tuyệt đối không được thay đổi quyền của tài khoản Quản trị viên (Admin)!" });
          }
          if (is_active !== undefined) {
            const activeVal = (is_active !== false && is_active !== 0 && is_active !== 'false') ? 1 : 0;
            if (activeVal === 0) {
              return res.status(400).json({ error: "BẢO MẬT HỆ THỐNG: Tuyệt đối không được vô hiệu hóa hoặc khóa tài khoản Quản trị viên (Admin)!" });
            }
          }
        }
      }

      if (username) {
         const checkResult = await executeSqlQuery("SELECT id FROM accounts WHERE username = ? AND id != ?", [username.trim(), accountId]);
         if (checkResult.results && checkResult.results.length > 0) {
             return res.status(400).json({ error: "Tên đăng nhập đã tồn tại!" });
         }
      }

      const updates = [];
      const params = [];
      
      if (user_id !== undefined) { updates.push("user_id = ?"); params.push(user_id || null); }
      if (username !== undefined) { updates.push("username = ?"); params.push(username.trim()); }
      if (role !== undefined) { updates.push("role = ?"); params.push(role); }
      if (is_active !== undefined) { 
        const activeVal = (is_active !== false && is_active !== 0 && is_active !== 'false') ? 1 : 0;
        updates.push("is_active = ?"); 
        params.push(activeVal); 
      }
      if (expiry_date !== undefined) { updates.push("expiry_date = ?"); params.push(normalizeVietnamExpiryForStorage(expiry_date)); }

      if (password) {
          const hashedPassword = hashPasswordPBKDF2Sync(password);
          updates.push("password = ?");
          params.push(hashedPassword);
      }

      if (updates.length > 0) {
          params.push(accountId);
          const sql = `UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`;
          await executeSqlQuery(sql, params);
      }
      
      return res.status(200).json({ data: { id: accountId }, error: null });
    } catch (e: any) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("PUT /api/accounts error::", e);
      return res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });

  // 4. Xóa tài khoản (Admin only)
  app.delete("/api/accounts/:id", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const token = authHeader.substring(7);
      const user = verifyJWTSync(token, await getServerSecret());
      if (!checkIsAdmin(user)) return res.status(403).json({ error: "Chỉ Admin mới được xóa tài khoản" });

      const accountId = req.params.id;

      // KIỂM TRA BẢO MẬT TÀI KHOẢN ADMIN: TUYỆT ĐỐI KHÔNG CHO XÓA TÀI KHOẢN ADMIN
      const findTargetAcc = await executeSqlQuery("SELECT id, username, role FROM accounts WHERE id = ?", [accountId]);
      const targetAcc = findTargetAcc.results && findTargetAcc.results.length > 0 ? findTargetAcc.results[0] : null;

      if (targetAcc && (targetAcc.role === 'admin' || targetAcc.username === 'admin' || targetAcc.id === 'admin')) {
        return res.status(400).json({ error: "BẢO MẬT HỆ THỐNG: Tuyệt đối không được xóa tài khoản Quản trị viên (Admin)!" });
      }

      // Tránh tự xóa chính mình
      if (accountId === user.id) {
          return res.status(400).json({ error: "Không thể tự xóa tài khoản của chính mình!" });
      }

      await executeSqlQuery("DELETE FROM accounts WHERE id = ?", [accountId]);
      return res.status(200).json({ data: { success: true }, error: null });
    } catch (e: any) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("DELETE /api/accounts error::", e);
      return res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });

  // API Dọn dẹp cấu trúc bảng accounts trong D1
  app.post("/api/accounts/clean-schema", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const token = authHeader.substring(7);
      const user = verifyJWTSync(token, await getServerSecret());
      if (!checkIsAdmin(user)) return res.status(403).json({ error: "Chỉ Quản trị viên mới được thực hiện dọn dẹp cấu trúc CSDL" });

      // 1. Sao lưu toàn bộ hồ sơ người dùng từ accounts sang users trước khi xóa cột
      try {
        const existingAccounts = await executeSqlQuery("SELECT * FROM accounts", []);
        if (existingAccounts.results && existingAccounts.results.length > 0) {
          for (const a of existingAccounts.results) {
            const uId = a.user_id || a.id;
            await executeSqlQuery(`
              INSERT OR IGNORE INTO users 
              (id, full_name, phone_number, gender, dob, address, donvi, occupation, target_audience, payment_status, payment_method, is_active, expiry_date, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              uId, a.full_name || '', a.phone_number || '', a.gender || '', a.dob || null,
              a.address || '', a.donvi || '', a.occupation || '', a.target_audience || 'Học sinh',
              a.payment_status || 'Chưa thanh toán', a.payment_method || '', a.is_active ?? 1,
              a.expiry_date || null, a.created_at || new Date().toISOString()
            ]);
          }
        }
      } catch (backupErr) {
        console.warn("Backup accounts before schema cleanup:", backupErr);
      }

      // 2. Rebuild clean accounts table
      await executeSqlQuery(`
        CREATE TABLE IF NOT EXISTS accounts_clean (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT DEFAULT 'user',
          is_active INTEGER DEFAULT 1,
          expiry_date TEXT,
          created_at TEXT
        )
      `, []);

      await executeSqlQuery(`
        INSERT OR REPLACE INTO accounts_clean (id, user_id, username, password, role, is_active, expiry_date, created_at)
        SELECT id, COALESCE(user_id, id), username, password, COALESCE(role, 'user'), COALESCE(is_active, 1), expiry_date, COALESCE(created_at, datetime('now'))
        FROM accounts
      `, []);

      await executeSqlQuery("DROP TABLE accounts", []);
      await executeSqlQuery("ALTER TABLE accounts_clean RENAME TO accounts", []);
      try {
        await executeSqlQuery("CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id)", []);
        await executeSqlQuery("CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username)", []);
        await executeSqlQuery("CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at)", []);
        await executeSqlQuery("CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(role)", []);
        await executeSqlQuery("CREATE INDEX IF NOT EXISTS idx_accounts_user_created ON accounts(user_id, created_at DESC)", []);
        await executeSqlQuery("CREATE INDEX IF NOT EXISTS idx_accounts_username_active ON accounts(username, is_active)", []);
      } catch {}

      const colsInfo = await executeSqlQuery("PRAGMA table_info(accounts)", []);

      return res.status(200).json({
        success: true,
        message: "Đã xóa toàn bộ các cột không cần thiết trong bảng accounts trên D1!",
        columns: (colsInfo.results || []).map((c: any) => c.name)
      });
    } catch (e: any) {
      console.error("Clean schema error:", e);
      return res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });

  // =========================================================================
  // API: QUẢN LÝ HỒ SƠ NGƯỜI DÙNG (/api/users)
  // Khi xóa người dùng thì tự động xóa tài khoản gắn với người dùng đó nếu có
  // =========================================================================

  // 1. Lấy danh sách hồ sơ người dùng - phân trang snapshot nhất quán.
  app.get("/api/users", async (req, res) => {
    try {
      const authHeader=req.headers.authorization||'';
      if(!authHeader.startsWith("Bearer ")) return res.status(401).json({error:"Unauthorized"});
      const user:any=verifyJWTSync(authHeader.substring(7),await getServerSecret());
      if(!user) return res.status(401).json({error:"Phiên đăng nhập không hợp lệ"});

      const isAdmin=checkIsAdmin(user);
      const isTeacher=checkIsTeacherOrAdmin(user)&&!isAdmin;
      const limitParam=req.query.limit as string;
      const offsetParam=req.query.offset as string;
      const pageParam=req.query.page as string;
      const requestedSnapshot=String((req.query.snapshot as string)||'').trim();

      let limit=-1;
      if(limitParam!==undefined&&!['all','0','-1'].includes(limitParam)){
        const parsed=parseInt(limitParam,10);
        if(!isNaN(parsed)&&parsed>0) limit=Math.min(parsed,5000);
      }
      let offset=0;
      if(offsetParam!==undefined){
        const parsed=parseInt(offsetParam,10);
        if(!isNaN(parsed)&&parsed>=0) offset=parsed;
      }else if(pageParam!==undefined){
        const page=parseInt(pageParam,10);
        if(!isNaN(page)&&page>0) offset=(page-1)*(limit>0?limit:1000);
      }

      const projection=`
        /* no-cache */ SELECT u.*,
          (SELECT a.id FROM accounts a WHERE a.user_id=u.id OR a.id=u.id ORDER BY CASE WHEN a.user_id=u.id THEN 0 ELSE 1 END,a.created_at DESC,a.id DESC LIMIT 1) AS account_id,
          (SELECT a.username FROM accounts a WHERE a.user_id=u.id OR a.id=u.id ORDER BY CASE WHEN a.user_id=u.id THEN 0 ELSE 1 END,a.created_at DESC,a.id DESC LIMIT 1) AS account_username,
          (SELECT a.role FROM accounts a WHERE a.user_id=u.id OR a.id=u.id ORDER BY CASE WHEN a.user_id=u.id THEN 0 ELSE 1 END,a.created_at DESC,a.id DESC LIMIT 1) AS account_role,
          (SELECT a.is_active FROM accounts a WHERE a.user_id=u.id OR a.id=u.id ORDER BY CASE WHEN a.user_id=u.id THEN 0 ELSE 1 END,a.created_at DESC,a.id DESC LIMIT 1) AS account_is_active
        FROM users u
      `;

      let rows:any[]=[];
      let total=0;
      let snapshot='';

      if(isAdmin){
        const metaSql=`
          /* no-cache */ SELECT COUNT(*)::int AS total,
                 MD5(COALESCE(STRING_AGG(id,'|' ORDER BY
                   CASE WHEN LOWER(TRIM(COALESCE(target_audience,''))) IN ('quản trị viên','admin') THEN 0
                        WHEN LOWER(TRIM(COALESCE(target_audience,''))) IN ('giáo viên','teacher') THEN 1
                        WHEN LOWER(TRIM(COALESCE(target_audience,''))) IN ('học sinh','student') THEN 2 ELSE 3 END,
                   created_at DESC,id DESC),'')) AS snapshot
          FROM users`;
        const meta=await executeSqlQuery(metaSql,[]);
        total=Number(meta.results?.[0]?.total||0);
        snapshot=String(meta.results?.[0]?.snapshot||'');

        if(requestedSnapshot&&requestedSnapshot!==snapshot){
          return res.status(409).json({
            error:'Phạm vi dữ liệu đã thay đổi trong khi đang phân trang. Cần tải lại từ trang đầu.',
            code:'PAGINATION_SCOPE_CHANGED',snapshot,total
          });
        }

        const paginationClause=limit>0?` LIMIT ${limit} OFFSET ${offset}`:'';
        const result=await executeSqlQuery(projection+` ORDER BY CASE
          WHEN LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('quản trị viên','admin') THEN 0
          WHEN LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('giáo viên','teacher') THEN 1
          WHEN LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student') THEN 2 ELSE 3 END,
          u.created_at DESC,u.id DESC${paginationClause}`,[]);
        rows=result.results||[];

        const verifyMeta=await executeSqlQuery(metaSql,[]);
        const verifyTotal=Number(verifyMeta.results?.[0]?.total||0);
        const verifySnapshot=String(verifyMeta.results?.[0]?.snapshot||'');
        if(verifyTotal!==total||verifySnapshot!==snapshot){
          return res.status(409).json({
            error:'Phạm vi dữ liệu thay đổi ngay trong lúc đọc trang. Cần tải lại từ đầu.',
            code:'PAGINATION_SCOPE_CHANGED',snapshot:verifySnapshot,total:verifyTotal
          });
        }

        const tc=await executeSqlQuery(
          'SELECT id,teacher_id,teacher_name,class_name,donvi,role,subject,created_at FROM teacher_classes ORDER BY class_name ASC,donvi ASC,id ASC',[]
        );
        const map:any={};
        for(const x of (tc.results||[])){
          const id=String(x.teacher_id||'');
          (map[id]||(map[id]=[])).push(x);
        }
        for(const row of rows) row.assigned_classes=map[String(row.id)]||[];
      }else if(isTeacher){
        const selfId=String(user.user_id||user.id||'');
        const accountId=String(user.id||selfId);
        const selfRes=await executeSqlQuery(
          projection+' WHERE u.id=? OR u.id=? ORDER BY CASE WHEN u.id=? THEN 0 ELSE 1 END,u.id DESC LIMIT 1',
          [selfId,accountId,selfId]
        );
        const self=selfRes.results?.[0]||null;
        if(!self) return res.status(409).json({error:'Không tìm thấy hồ sơ giáo viên liên kết với tài khoản.'});

        const studentWhere=`
          WHERE LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student')
            AND EXISTS (
              SELECT 1 FROM teacher_classes tc
              WHERE tc.teacher_id IN (?,?)
                AND LOWER(TRIM(tc.class_name))=LOWER(TRIM(COALESCE(u.lop,'')))
                AND LOWER(TRIM(tc.donvi))=LOWER(TRIM(COALESCE(u.donvi,'')))
            )`;
        const metaSql=`
          /* no-cache */ SELECT COUNT(*)::int AS student_total,
                 MD5(COALESCE(STRING_AGG(u.id,'|' ORDER BY u.created_at DESC,u.id DESC),'')) AS student_snapshot
          FROM users u
          ${studentWhere}`;

        const meta=await executeSqlQuery(metaSql,[selfId,accountId]);
        const studentTotal=Number(meta.results?.[0]?.student_total||0);
        total=studentTotal+1;
        snapshot=String(self.id||'')+':'+String(meta.results?.[0]?.student_snapshot||'');

        if(requestedSnapshot&&requestedSnapshot!==snapshot){
          return res.status(409).json({
            error:'Phạm vi dữ liệu giáo viên đã thay đổi trong khi đang phân trang. Cần tải lại từ trang đầu.',
            code:'PAGINATION_SCOPE_CHANGED',snapshot,total
          });
        }

        if(limit<0){
          const sr=await executeSqlQuery(projection+studentWhere+' ORDER BY u.created_at DESC,u.id DESC',[selfId,accountId]);
          rows=[self,...(sr.results||[]).filter((x:any)=>String(x.id)!==String(self.id))];
        }else if(offset===0){
          const studentLimit=Math.max(0,limit-1);
          let students:any[]=[];
          if(studentLimit>0){
            const sr=await executeSqlQuery(
              projection+studentWhere+` ORDER BY u.created_at DESC,u.id DESC LIMIT ${studentLimit} OFFSET 0`,
              [selfId,accountId]
            );
            students=sr.results||[];
          }
          rows=[self,...students.filter((x:any)=>String(x.id)!==String(self.id))];
        }else{
          const studentOffset=Math.max(0,offset-1);
          const sr=await executeSqlQuery(
            projection+studentWhere+` ORDER BY u.created_at DESC,u.id DESC LIMIT ${limit} OFFSET ${studentOffset}`,
            [selfId,accountId]
          );
          rows=sr.results||[];
        }

        const verifyMeta=await executeSqlQuery(metaSql,[selfId,accountId]);
        const verifyTotal=Number(verifyMeta.results?.[0]?.student_total||0)+1;
        const verifySnapshot=String(self.id||'')+':'+String(verifyMeta.results?.[0]?.student_snapshot||'');
        if(verifyTotal!==total||verifySnapshot!==snapshot){
          return res.status(409).json({
            error:'Phạm vi dữ liệu giáo viên thay đổi ngay trong lúc đọc trang. Cần tải lại từ đầu.',
            code:'PAGINATION_SCOPE_CHANGED',snapshot:verifySnapshot,total:verifyTotal
          });
        }

        const tc=await executeSqlQuery(
          'SELECT id,teacher_id,teacher_name,class_name,donvi,role,subject,created_at FROM teacher_classes WHERE teacher_id IN (?,?) ORDER BY class_name ASC,donvi ASC,id ASC',
          [selfId,accountId]
        );
        const ownAssignments=tc.results||[];
        const selfIds=new Set([selfId,accountId]);
        for(const row of rows) row.assigned_classes=selfIds.has(String(row.id))?ownAssignments:[];
      }else{
        const selfId=String(user.user_id||user.id||'');
        const accountId=String(user.id||selfId);
        const sr=await executeSqlQuery(
          projection+' WHERE u.id=? OR u.id=? ORDER BY CASE WHEN u.id=? THEN 0 ELSE 1 END,u.id DESC LIMIT 1',
          [selfId,accountId,selfId]
        );
        rows=sr.results?.length?[sr.results[0]]:[];
        total=rows.length;
        snapshot=rows.length?String(rows[0].id):'';
        return res.status(200).json({data:rows,total,limit,offset:0,has_more:false,snapshot,role_scope:'student',error:null});
      }

      const ids=new Set(rows.map((row:any)=>String(row?.id||'')));
      if(ids.size!==rows.length||ids.has('')){
        return res.status(500).json({
          error:'Phân trang hồ sơ phát hiện bản ghi trùng hoặc thiếu ID.',
          code:'PAGINATION_PAGE_INVALID'
        });
      }

      return res.status(200).json({
        data:rows,total,limit,offset,
        has_more:limit>0?offset+rows.length<total:false,
        snapshot,
        role_scope:isAdmin?'admin':'teacher',
        error:null
      });
    }catch(e:any){
      console.error("GET /api/users error:",e);
      return res.status(500).json({error:e.message||'Lỗi server'});
    }
  });

  // Cập nhật hạn dùng hàng loạt cho hồ sơ người dùng (Admin only).
  app.post("/api/users/bulk-expiry", authLimiter, async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Yêu cầu đăng nhập Admin." });
      }
      const actor: any = verifyJWTSync(authHeader.substring(7), await getServerSecret());
      if (!checkIsAdmin(actor)) {
        return res.status(403).json({ error: "Chỉ Admin mới được cập nhật hạn dùng người dùng." });
      }

      const rawIds = Array.isArray(req.body?.user_ids) ? req.body.user_ids : [];
      const userIds = [...new Set(rawIds.map((id: any) => String(id ?? '').trim()).filter(Boolean))] as string[];
      const maxUsers = 500;
      if (!userIds.length) {
        return res.status(400).json({ error: "Chưa chọn người dùng cần cập nhật hạn dùng." });
      }
      if (userIds.length > maxUsers) {
        return res.status(400).json({ error: `Mỗi lần chỉ được cập nhật tối đa ${maxUsers} người dùng.` });
      }

      let expiry: string | null;
      try {
        expiry = normalizeVietnamExpiryForStorage(req.body?.expiry_date);
      } catch {
        return res.status(400).json({ error: "Ngày hết hạn không hợp lệ." });
      }

      const marks = userIds.map(() => '?').join(',');
      const before = await executeSqlQuery(
        `SELECT id FROM users WHERE id IN (${marks})`,
        userIds
      );
      const found = new Set((before.results || []).map((row: any) => String(row.id)));
      const missing = userIds.filter(id => !found.has(id));
      if (missing.length || found.size !== userIds.length) {
        return res.status(409).json({
          error: "Danh sách người dùng đã thay đổi. Chưa cập nhật hạn dùng cho người dùng nào.",
          code: "USER_SELECTION_CHANGED",
          missing_user_ids: missing
        });
      }

      await executeSqlQuery(
        `UPDATE users SET expiry_date = ? WHERE id IN (${marks})`,
        [expiry, ...userIds]
      );

      const after = await executeSqlQuery(
        `SELECT id, expiry_date FROM users WHERE id IN (${marks})`,
        userIds
      );
      const rows = after.results || [];
      const expected = expiry || '';
      const confirmed = new Set(
        rows
          .filter((row: any) => String(row.expiry_date || '') === expected)
          .map((row: any) => String(row.id))
      );
      if (rows.length !== userIds.length || userIds.some(id => !confirmed.has(id))) {
        return res.status(500).json({
          error: "Không thể xác nhận toàn bộ hạn dùng người dùng sau khi ghi. Cần kiểm tra lại dữ liệu.",
          code: "USER_EXPIRY_VERIFY_FAILED"
        });
      }

      return res.json({
        data: {
          success: true,
          updated: userIds.length,
          verified: userIds.length,
          user_ids: userIds,
          expiry_date: expiry,
          unlimited: expiry === null,
          self_profile_updated: userIds.includes(String(actor.user_id || actor.id || ''))
        },
        error: null
      });
    } catch (e: any) {
      console.error("POST /api/users/bulk-expiry error::", e);
      return res.status(500).json({ error: e.message || "Không thể cập nhật hạn dùng người dùng." });
    }
  });

  // 2. Thêm hồ sơ người dùng mới
  app.post("/api/users", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const token = authHeader.substring(7);
      const user = verifyJWTSync(token, await getServerSecret());
      if (!checkIsAdmin(user)) return res.status(403).json({ error: "Chỉ Quản trị viên mới được thêm hồ sơ người dùng" });

      let { id, full_name, phone_number, gender, dob, address, donvi, lop, occupation, target_audience, payment_status, payment_method, is_active, expiry_date } = req.body;
      if (!full_name || !full_name.trim()) {
        return res.status(400).json({ error: "Vui lòng nhập Họ và tên người dùng!" });
      }

      if (!id || !id.trim()) {
        id = crypto.randomUUID();
      } else {
        id = id.trim();
      }

      const activeVal = is_active !== false && is_active !== 0 && is_active !== 'false' ? 1 : 0;
      const sql = "INSERT INTO users (id, full_name, phone_number, gender, dob, address, donvi, lop, occupation, target_audience, payment_status, payment_method, is_active, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
      const params = [
        id,
        full_name.trim(),
        phone_number || '',
        gender || '',
        dob || null,
        address || '',
        donvi || '',
        lop || '',
        occupation || '',
        target_audience || 'Học sinh',
        payment_status || 'Chưa thanh toán',
        payment_method || '',
        activeVal,
        expiry_date || null,
        new Date().toISOString()
      ];

      await executeSqlQuery(sql, params);
      return res.status(201).json({ data: { id, full_name }, error: null });
    } catch (e: any) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        return res.status(400).json({ error: e.message });
      }
      console.error("POST /api/users error:", e);
      return res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });

  // 3. Sửa hồ sơ người dùng
  app.put("/api/users/:id", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const token = authHeader.substring(7);
      const user = verifyJWTSync(token, await getServerSecret());
      if (!checkIsAdmin(user)) return res.status(403).json({ error: "Chỉ Quản trị viên mới được sửa hồ sơ người dùng" });

      const userId = req.params.id;
      const { full_name, phone_number, gender, dob, address, donvi, lop, occupation, target_audience, payment_status, payment_method, is_active, expiry_date } = req.body;

      // KIỂM TRA BẢO MẬT TÀI KHOẢN ADMIN KHI SỬA HỒ SƠ
      const checkAdminAcc = await executeSqlQuery("SELECT id, username, role FROM accounts WHERE user_id = ? OR id = ?", [userId, userId]);
      const isAdminUser = (checkAdminAcc.results && checkAdminAcc.results.some((a: any) => a.role === 'admin' || a.username === 'admin' || a.id === 'admin'));

      if (isAdminUser) {
        if (target_audience !== undefined && target_audience !== 'Quản trị viên') {
          return res.status(400).json({ error: "BẢO MẬT HỆ THỐNG: Tuyệt đối không được hạ quyền Quản trị viên (Admin)!" });
        }
        if (is_active !== undefined && (is_active === false || is_active === 0 || is_active === 'false')) {
          return res.status(400).json({ error: "BẢO MẬT HỆ THỐNG: Tuyệt đối không được khóa hoặc vô hiệu hóa Quản trị viên (Admin)!" });
        }
      }

      const updates = [];
      const params = [];
      if (full_name !== undefined) { updates.push("full_name = ?"); params.push(full_name); }
      if (phone_number !== undefined) { updates.push("phone_number = ?"); params.push(phone_number); }
      if (gender !== undefined) { updates.push("gender = ?"); params.push(gender); }
      if (dob !== undefined) { updates.push("dob = ?"); params.push(dob); }
      if (address !== undefined) { updates.push("address = ?"); params.push(address); }
      if (donvi !== undefined) { updates.push("donvi = ?"); params.push(donvi); }
      if (lop !== undefined) { updates.push("lop = ?"); params.push(lop); }
      if (occupation !== undefined) { updates.push("occupation = ?"); params.push(occupation); }
      if (target_audience !== undefined) { updates.push("target_audience = ?"); params.push(target_audience); }
      if (payment_status !== undefined) { updates.push("payment_status = ?"); params.push(payment_status); }
      if (payment_method !== undefined) { updates.push("payment_method = ?"); params.push(payment_method); }
      if (is_active !== undefined) { updates.push("is_active = ?"); params.push(is_active ? 1 : 0); }
      if (expiry_date !== undefined) { updates.push("expiry_date = ?"); params.push(expiry_date); }

      if (updates.length > 0) {
        params.push(userId);
        await executeSqlQuery(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
      }

      return res.status(200).json({ data: { id: userId }, error: null });
    } catch (e: any) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        return res.status(400).json({ error: e.message });
      }
      console.error("PUT /api/users error:", e);
      return res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });

  // 4. Xóa hồ sơ người dùng: KHI XÓA NGƯỜI DÙNG THÌ PHẢI XÓA TÀI KHOẢN GẮN VỚI NGƯỜI DÙNG ĐÓ NẾU CÓ
  app.delete("/api/users/:id", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const token = authHeader.substring(7);
      const user = verifyJWTSync(token, await getServerSecret());
      if (!checkIsAdmin(user)) return res.status(403).json({ error: "Chỉ Quản trị viên mới được xóa hồ sơ người dùng" });

      const userId = req.params.id;
      const targetResult = await executeSqlQuery(
        `SELECT u.id, u.full_name, u.target_audience,
                EXISTS(
                  SELECT 1 FROM accounts a
                  WHERE (a.user_id = u.id OR a.id = u.id)
                    AND LOWER(COALESCE(a.role,'')) IN ('teacher','giáo viên')
                ) AS has_teacher_account,
                EXISTS(
                  SELECT 1 FROM accounts a
                  WHERE (a.user_id = u.id OR a.id = u.id)
                    AND (
                      LOWER(COALESCE(a.role,''))='admin'
                      OR LOWER(COALESCE(a.username,'')) IN ('admin','adminhht')
                      OR LOWER(COALESCE(a.id,'')) IN ('admin','adminhht')
                    )
                ) AS has_admin_account
         FROM users u WHERE u.id = ? LIMIT 1`,
        [userId]
      );
      const target: any = targetResult.results?.[0];
      if (!target) return res.status(404).json({ error: "Không tìm thấy hồ sơ người dùng" });

      const audience = String(target.target_audience || '').trim().toLocaleLowerCase('vi');
      const isAdminTarget = target.has_admin_account === true || target.has_admin_account === 1 ||
        ['quản trị viên','admin'].includes(audience);
      if (isAdminTarget) {
        return res.status(400).json({ error: "BẢO MẬT HỆ THỐNG: Tuyệt đối không được xóa tài khoản hoặc hồ sơ Quản trị viên (Admin)!" });
      }
      if (userId === user.user_id || userId === user.id) {
        return res.status(400).json({ error: "Không thể tự xóa tài khoản của chính mình!" });
      }

      const isStudent = ['học sinh','student'].includes(audience);
      const isTeacher = !isStudent && (
        target.has_teacher_account === true || target.has_teacher_account === 1 ||
        audience === 'giáo viên' || audience === 'teacher'
      );

      if (isTeacher) {
        await executeSqlQuery(TEACHER_DELETE_CASCADE_SQL, []);
        const deleted = await executeSqlQuery(TEACHER_DELETE_CALL_SQL, [userId]);
        const deletion = parseTeacherDeletionResult(deleted.results?.[0]);
        if (!deletion?.success) throw new Error('TEACHER_DELETE_EMPTY_RESULT');
        return res.status(200).json({ data: deletion, error: null });
      }

      if (isStudent) {
        await executeSqlQuery(STUDENT_DELETE_CASCADE_SQL, []);
        const deleted = await executeSqlQuery(STUDENT_DELETE_CALL_SQL, [userId]);
        const deletion = parseStudentDeletionResult(deleted.results?.[0]);
        if (!deletion?.success) throw new Error('STUDENT_DELETE_EMPTY_RESULT');
        return res.status(200).json({ data: deletion, error: null });
      }

      await executeSqlQuery(USER_DELETE_CASCADE_SQL, []);
      const deleted = await executeSqlQuery(USER_DELETE_CALL_SQL, [userId]);
      const deletion = parseUserDeletionResult(deleted.results?.[0]);
      if (!deletion?.success) throw new Error('USER_DELETE_EMPTY_RESULT');
      return res.status(200).json({ data: deletion, error: null });
    } catch (e: any) {
      const message = String(e?.message || e || '');
      const mapped = message.includes('STUDENT_DELETE_')
        ? studentDeleteHttpError(e)
        : message.includes('TEACHER_DELETE_')
          ? teacherDeleteHttpError(e)
          : userDeleteHttpError(e);
      console.error("DELETE /api/users error:", e);
      return res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  // --- API /api/teacher-classes (Gán và quản lý lớp học cho giáo viên) ---
  app.get("/api/teacher-classes", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const user = verifyJWTSync(authHeader.substring(7), await getServerSecret());
      if (!user) return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });

      const isAdmin = checkIsAdmin(user);
      const isTeacher = checkIsTeacherOrAdmin(user);
      if (!isAdmin && !isTeacher) {
        return res.status(403).json({ error: "Không có quyền truy cập thông tin phân công lớp" });
      }

      let teacherId = (req.query.teacher_id as string) || '';
      const donvi = (req.query.donvi as string) || '';
      const className = (req.query.class_name as string) || '';

      // BẢO MẬT: Nếu là Giáo viên (không phải Admin), BẮT BUỘC chỉ được xem phân công của chính mình
      if (!isAdmin) {
        teacherId = user.user_id || user.id;
      }

      let sql = "SELECT * FROM teacher_classes WHERE 1=1";
      const params: any[] = [];
      if (teacherId) {
        sql += " AND teacher_id = ?";
        params.push(teacherId);
      }
      if (donvi) {
        sql += " AND LOWER(TRIM(donvi)) = LOWER(TRIM(?))";
        params.push(donvi);
      }
      if (className) {
        sql += " AND LOWER(TRIM(class_name)) = LOWER(TRIM(?))";
        params.push(className);
      }
      sql += " ORDER BY class_name ASC, teacher_name ASC";

      const { results: rows } = await executeSqlQuery(sql, params);

      // Lấy danh sách các lớp học
      let schoolClasses: string[] = [];
      if (!isAdmin) {
        // Giáo viên thường chỉ thấy danh sách các lớp ĐƯỢC PHÂN CÔNG cho chính họ
        const setCls = new Set<string>();
        (rows || []).forEach((r: any) => {
          const v = String(r.class_name || '').trim();
          if (v) setCls.add(v);
        });
        schoolClasses = Array.from(setCls).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
      } else {
        try {
          const setCls = new Set<string>();

          let clsSql = "SELECT DISTINCT lop FROM users WHERE lop IS NOT NULL AND TRIM(lop) != ''";
          let clsParams: any[] = [];
          if (donvi) {
            clsSql += " AND LOWER(TRIM(donvi)) = LOWER(TRIM(?))";
            clsParams.push(donvi);
          }
          const { results: clsRows } = await executeSqlQuery(clsSql, clsParams);
          (clsRows || []).forEach((r: any) => {
            const v = String(r.lop || '').trim();
            if (v) setCls.add(v);
          });

          let tcClsSql = "SELECT DISTINCT class_name FROM teacher_classes WHERE class_name IS NOT NULL AND TRIM(class_name) != ''";
          let tcClsParams: any[] = [];
          if (donvi) {
            tcClsSql += " AND LOWER(TRIM(donvi)) = LOWER(TRIM(?))";
            tcClsParams.push(donvi);
          }
          const { results: tcClsRows } = await executeSqlQuery(tcClsSql, tcClsParams);
          (tcClsRows || []).forEach((r: any) => {
            const v = String(r.class_name || '').trim();
            if (v) setCls.add(v);
          });

          schoolClasses = Array.from(setCls).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
        } catch (e) {}
      }

      return res.status(200).json({ data: rows || [], school_classes: schoolClasses, error: null });
    } catch (e: any) {
      console.error("GET /api/teacher-classes error:", e);
      return res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });

  app.post("/api/teacher-classes", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const user = verifyJWTSync(authHeader.substring(7), await getServerSecret());
      if (!user) return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });

      const isAdmin = checkIsAdmin(user);
      const isTeacher = checkIsTeacherOrAdmin(user);
      if (!isAdmin && !isTeacher) {
        return res.status(403).json({ error: "BẢO MẬT HỆ THỐNG: Chỉ Quản trị viên hoặc Giáo viên mới có quyền thao tác tính năng này!" });
      }

      const body = req.body || {};
      const now = new Date().toISOString();

      // Trường hợp 0: Phân công theo LỚP HỌC (chọn 1 lớp, gán nhiều giáo viên)
      if (body.by_class || (body.class_name && Array.isArray(body.teachers))) {
        if (!isAdmin) {
          return res.status(403).json({ error: "Chỉ Quản trị viên mới có quyền phân công giáo viên theo lớp" });
        }
        const cName = String(body.class_name || '').trim();
        let cDonvi = String(body.donvi || '').trim();
        if (!cName) return res.status(400).json({ error: "Thiếu tên lớp học" });

        // Xóa phân công cũ của lớp này
        if (cDonvi) {
          await executeSqlQuery(
            "DELETE FROM teacher_classes WHERE LOWER(TRIM(class_name)) = LOWER(TRIM(?)) AND LOWER(TRIM(donvi)) = LOWER(TRIM(?))",
            [cName, cDonvi]
          );
        } else {
          await executeSqlQuery(
            "DELETE FROM teacher_classes WHERE LOWER(TRIM(class_name)) = LOWER(TRIM(?))",
            [cName]
          );
        }

        let insertedCount = 0;
        const teachersList = body.teachers || [];
        for (const t of teachersList) {
          const tId = String(t.teacher_id || t.id || '').trim();
          const tName = String(t.teacher_name || t.full_name || '').trim();
          const tRole = String(t.role || 'bo_mon').trim();
          const tSub = String(t.subject || '').trim();
          const tDonvi = String(t.donvi || cDonvi || '').trim();
          if (!tId) continue;
          const id = crypto.randomUUID();
          await executeSqlQuery(
            `INSERT INTO teacher_classes (id, teacher_id, teacher_name, class_name, donvi, role, subject, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (teacher_id, class_name, donvi) DO UPDATE SET role = EXCLUDED.role, subject = EXCLUDED.subject, teacher_name = EXCLUDED.teacher_name`,
            [id, tId, tName, cName, tDonvi, tRole, tSub, now]
          );
          insertedCount++;
        }
        return res.status(200).json({ success: true, count: insertedCount, error: null });
      }

      // Trường hợp 0B: Nhập hàng loạt (Batch import từ Excel hoặc danh sách)
      if (body.batch && Array.isArray(body.items)) {
        if (!isAdmin) {
          return res.status(403).json({ error: "Chỉ Quản trị viên mới có quyền nhập hàng loạt phân công" });
        }
        let insertedCount = 0;
        for (const item of body.items) {
          const tId = String(item.teacher_id || item.id || '').trim();
          const tName = String(item.teacher_name || item.full_name || '').trim();
          const cName = String(item.class_name || item.className || item.lop || '').trim();
          const donviVal = String(item.donvi || '').trim();
          const roleVal = String(item.role || 'bo_mon').trim();
          const subVal = String(item.subject || '').trim();
          if (!tId || !cName) continue;
          const id = crypto.randomUUID();
          await executeSqlQuery(
            `INSERT INTO teacher_classes (id, teacher_id, teacher_name, class_name, donvi, role, subject, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (teacher_id, class_name, donvi) DO UPDATE SET role = EXCLUDED.role, subject = EXCLUDED.subject, teacher_name = EXCLUDED.teacher_name`,
            [id, tId, tName, cName, donviVal, roleVal, subVal, now]
          );
          insertedCount++;
        }
        return res.status(200).json({ success: true, count: insertedCount, error: null });
      }

      // Trường hợp 1 & 2: Phân công theo GIÁO VIÊN
      let { teacher_id, teacher_name, donvi, classes, class_name, role, subject } = body;
      if (!teacher_id) {
        if (isTeacher && !isAdmin) {
          teacher_id = user.user_id || user.id;
        } else {
          return res.status(400).json({ error: "Thiếu mã giáo viên (teacher_id)" });
        }
      }

      // Nếu giáo viên tự phân công (nếu cho phép), chỉ được phân công cho chính mình
      if (isTeacher && !isAdmin && (user.user_id || user.id) !== teacher_id) {
        return res.status(403).json({ error: "Bạn chỉ có thể quản lý lớp của chính mình" });
      }

      if (!donvi || !donvi.trim()) {
        try {
          const { results: uRows } = await executeSqlQuery("SELECT full_name, donvi FROM users WHERE id = ?", [teacher_id]);
          if (uRows && uRows.length > 0) {
            donvi = uRows[0].donvi || '';
            if (!teacher_name) teacher_name = uRows[0].full_name || '';
          }
        } catch (e) {}
      }

      // 1A. Truyền danh sách mảng classes: [{ class_name, role, subject }]
      if (Array.isArray(classes)) {
        const normalized = classes.map((item:any)=>({
          className:String(item?.class_name||item?.className||item?.lop||'').trim(),
          role:String(item?.role||'bo_mon').trim(),
          subject:String(item?.subject||item?.mon_hoc||'').trim()
        })).filter((item:any)=>item.className);
        if(normalized.length>500)return res.status(400).json({error:"Mỗi giáo viên tối đa 500 phân công lớp."});
        const payload=normalized.map((item:any)=>({
          id:crypto.randomUUID(),teacher_id:String(teacher_id),teacher_name:String(teacher_name||''),
          class_name:item.className,donvi:String(donvi||''),role:item.role,subject:item.subject,created_at:now
        }));
        const atomic=await executeSqlQuery(`
          WITH input AS (
            SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(
              id text, teacher_id text, teacher_name text, class_name text,
              donvi text, role text, subject text, created_at text
            )
          ),
          deleted AS (
            DELETE FROM teacher_classes tc
            WHERE tc.teacher_id=?
              AND NOT EXISTS (
                SELECT 1 FROM input i
                WHERE i.teacher_id=tc.teacher_id AND i.class_name=tc.class_name AND i.donvi=tc.donvi
              )
            RETURNING tc.id
          ),
          upserted AS (
            INSERT INTO teacher_classes(id,teacher_id,teacher_name,class_name,donvi,role,subject,created_at)
            SELECT id,teacher_id,teacher_name,class_name,donvi,role,subject,created_at FROM input
            ON CONFLICT(teacher_id,class_name,donvi) DO UPDATE SET
              role=EXCLUDED.role,subject=EXCLUDED.subject,teacher_name=EXCLUDED.teacher_name
            RETURNING id
          )
          SELECT COUNT(*)::int AS count FROM upserted
        `,[JSON.stringify(payload),String(teacher_id)]);
        const insertedCount=Number(atomic.results?.[0]?.count||0);
        if(insertedCount!==normalized.length)throw new Error("Không thể xác nhận đầy đủ phân công lớp sau khi ghi.");
        return res.status(200).json({success:true,count:insertedCount,error:null});
      }

      // 1B. Truyền một lớp đơn lẻ
      if (!class_name || !String(class_name).trim()) {
        return res.status(400).json({ error: "Thiếu tên lớp cần phân công" });
      }

      const singleClass = String(class_name).trim();
      const id = crypto.randomUUID();
      await executeSqlQuery(
        `INSERT INTO teacher_classes (id, teacher_id, teacher_name, class_name, donvi, role, subject, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (teacher_id, class_name, donvi) DO UPDATE SET role = EXCLUDED.role, subject = EXCLUDED.subject, teacher_name = EXCLUDED.teacher_name`,
        [id, teacher_id, teacher_name || '', singleClass, donvi || '', role || 'bo_mon', subject || '', now]
      );
      return res.status(200).json({ success: true, id, error: null });
    } catch (e: any) {
      console.error("POST /api/teacher-classes error:", e);
      return res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });

  app.delete("/api/teacher-classes", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const user = verifyJWTSync(authHeader.substring(7), await getServerSecret());
      if (!user) return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });

      const isAdmin = checkIsAdmin(user);
      const isTeacher = checkIsTeacherOrAdmin(user);
      if (!isAdmin) {
        return res.status(403).json({ error: "BẢO MẬT HỆ THỐNG: Chỉ Quản trị viên (Admin) mới có quyền xóa phân công lớp học!" });
      }

      const id = (req.query.id as string) || (req.body && req.body.id);
      const teacherId = (req.query.teacher_id as string) || (req.body && req.body.teacher_id);
      const className = (req.query.class_name as string) || (req.body && req.body.class_name);
      const donvi = (req.query.donvi as string) || (req.body && req.body.donvi);

      if (id) {
        await executeSqlQuery("DELETE FROM teacher_classes WHERE id = ?", [id]);
        return res.status(200).json({ success: true, error: null });
      }

      // Xóa tất cả giáo viên khỏi một lớp
      if (className && !teacherId) {
        if (!isAdmin) {
          return res.status(403).json({ error: "Chỉ Quản trị viên mới có quyền xóa phân công của toàn lớp" });
        }
        if (donvi) {
          await executeSqlQuery(
            "DELETE FROM teacher_classes WHERE LOWER(TRIM(class_name)) = LOWER(TRIM(?)) AND LOWER(TRIM(donvi)) = LOWER(TRIM(?))",
            [className, donvi]
          );
        } else {
          await executeSqlQuery(
            "DELETE FROM teacher_classes WHERE LOWER(TRIM(class_name)) = LOWER(TRIM(?))",
            [className]
          );
        }
        return res.status(200).json({ success: true, error: null });
      }

      if (teacherId && className) {
        if (isTeacher && !isAdmin && (user.user_id || user.id) !== teacherId) {
          return res.status(403).json({ error: "Không có quyền thao tác trên tài khoản khác" });
        }
        await executeSqlQuery("DELETE FROM teacher_classes WHERE teacher_id = ? AND class_name = ?", [teacherId, className]);
        return res.status(200).json({ success: true, error: null });
      }

      if (teacherId && !className) {
        if (isTeacher && !isAdmin && (user.user_id || user.id) !== teacherId) {
          return res.status(403).json({ error: "Không có quyền thao tác trên tài khoản khác" });
        }
        await executeSqlQuery("DELETE FROM teacher_classes WHERE teacher_id = ?", [teacherId]);
        return res.status(200).json({ success: true, error: null });
      }

      return res.status(400).json({ error: "Thiếu thông tin để xóa (cần id, class_name hoặc teacher_id)" });
    } catch (e: any) {
      console.error("DELETE /api/teacher-classes error:", e);
      return res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });

  // --- QL Tài liệu: Express and Cloudflare share one authorization service ---
  const documentDb = {
    all: async(sql: string,params: any[]) => (await executeSqlQuery(sql,params)).results || [],
    first: async(sql: string,params: any[]) => (await executeSqlQuery(sql,params)).results?.[0] || null,
    run: async(sql: string,params: any[]) => Number((await executeSqlQuery(sql,params)).changes || 0)
  };
  async function documentActor(req: any) {
    const header = req.headers.authorization || '';
    if (!header) return null;
    if (!header.startsWith('Bearer ')) throw new DocumentLinkServiceError(401,'Phiên đăng nhập không hợp lệ.');
    let user = verifyJWTSync(header.slice(7), await getServerSecret());
    if (!user) throw new DocumentLinkServiceError(401,'Phiên đăng nhập không hợp lệ.');
    const ids=[user.user_id,user.id].map((v:any)=>String(v??'').trim()).filter(Boolean);
    if(ids.length){
      const placeholders=ids.map(()=>'?').join(',');
      const profile=(await executeSqlQuery('SELECT lop,donvi,target_audience FROM users WHERE id IN ('+placeholders+') LIMIT 1',ids)).results?.[0];
      if(profile)user={...user,lop:profile.lop||user.lop,donvi:profile.donvi||user.donvi,target_audience:profile.target_audience||user.target_audience};
    }
    return user;
  }
  async function documentApiReply(req: any,res: any,action: (actor: any)=>Promise<any>,created=false) {
    res.setHeader('Cache-Control','no-store');
    try {
      const actor = await documentActor(req);
      const data = await action(actor);
      if(req.method==='GET'&&req.path==='/api/documents'&&req.query.paged==='1')return res.json({...data,error:null});
      return res.status(created?201:200).json({data,error:null});
    } catch (e: any) {
      return res.status(e instanceof DocumentLinkServiceError ? e.status : 500)
        .json({error:e instanceof DocumentLinkServiceError ? e.message : 'Không thể xử lý tài liệu. Kiểm tra kết nối tới cơ sở dữ liệu Neon.'});
    }
  }
  app.get('/api/documents',(req,res)=>documentApiReply(req,res,
    actor=>req.query.scope==='student-classes'
      ? listDocumentStudentClasses(documentDb,actor)
      : req.query.paged==='1'
        ? listDocumentLinksPage(documentDb,actor,{...parseDocumentLinkPage(req.originalUrl),manage:req.query.manage==='1',includeReadable:req.query.manage==='1'&&req.query.includeReadable==='1'})
        : listDocumentLinks(documentDb,actor,{manage:req.query.manage==='1',includeReadable:req.query.manage==='1'&&req.query.includeReadable==='1'})));
  app.post('/api/documents',(req,res)=>documentApiReply(req,res,
    actor=>createDocumentLink(documentDb,actor,req.body),true));
  app.put('/api/documents',(req,res)=>documentApiReply(req,res,
    actor=>updateDocumentLink(documentDb,actor,req.body)));
  app.delete('/api/documents',(req,res)=>documentApiReply(req,res,
    actor=>deleteDocumentLink(documentDb,actor,String(req.query.id||''))));
  
  // --- API /api/exams (Quản lý cấu hình đề thi) ---
  app.get("/api/exams", async (req, res) => {
    try {
      const idParam = req.query.id as string;
      const codeParam = req.query.code as string;
      const teacherIdParam = req.query.teacherId as string;
      const sharedOnly = req.query.sharedOnly === 'true';

      const authHeader = req.headers.authorization;
      let user: any = null;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        user = verifyJWTSync(authHeader.substring(7), await getServerSecret());
        if (user && (user.id || user.user_id)) {
          try {
            const { results: uRows } = await executeSqlQuery(
              "SELECT donvi, lop, target_audience FROM users WHERE id = ? OR id = ?",
              [user.user_id || user.id, user.id]
            );
            if (uRows && uRows.length > 0) {
              const u = uRows[0];
              if (u.donvi) user.donvi = u.donvi;
              if (u.lop) user.lop = u.lop;
              if (u.target_audience) user.target_audience = u.target_audience;
            }
          } catch(e) {}
        }
      }

      const isAdmin = checkIsAdmin(user);
      const isTeacher = checkIsTeacherOrAdmin(user) && !isAdmin;

      if (idParam) {
        let query = "SELECT * FROM exam_configs WHERE id = ?";
        const { results } = await executeSqlQuery(query, [idParam]);
        if (!results || results.length === 0) {
          return res.status(404).json({ data: null, error: "Không tìm thấy cấu hình đề thi" });
        }
        const row: any = results[0];
        const challenge=examAccessChallenge(user,row,req.header('X-Exam-Access-Code'));
        if(challenge)return res.status(challenge.status).json({data:null,...challenge});
        const mapped = isExamOwner(user,row)?mapRowRead(row):redactExamForPublic(mapRowRead(row));
        mapped.is_shared_results = row.is_shared_results === 1 || row.is_shared_results === true || row.is_shared_results === 'true';
        return res.json({ data: mapped, server_now_ms: Date.now(), error: null });
      }

      if (codeParam) {
        const { results } = await executeSqlQuery("SELECT * FROM exam_configs WHERE id = ?", [codeParam]);
        if (!results || results.length === 0) {
          return res.status(404).json({ data: null, error: "Mã đề không tồn tại" });
        }
        const row: any = results[0];
        if (isTeacher && !isExamOwner(user,row))
          return res.status(403).json({data:null,error:'Giáo viên chỉ được truy cập đề thi do mình tạo'});
        const isShared = row.is_shared_results === 1 || row.is_shared_results === true || row.is_shared_results === 'true';
        if (!isShared && !isAdmin) {
          return res.status(403).json({ data: null, error: "Đề thi này không được phép chia sẻ kết quả" });
        }
        const mapped = isExamOwner(user,row)?mapRowRead(row):redactExamForPublic(mapRowRead(row));
        mapped.is_shared_results = isShared;
        return res.json({ data: mapped, error: null });
      }

      const limitParamRaw = req.query.limit as string;
      const offsetParamRaw = req.query.offset as string;
      const pageParamRaw = req.query.page as string;

      let limit = -1;
      if (limitParamRaw !== undefined) {
        if (limitParamRaw === 'all' || limitParamRaw === '0' || limitParamRaw === '-1') {
          limit = -1;
        } else {
          const parsed = parseInt(limitParamRaw, 10);
          if (!isNaN(parsed) && parsed > 0) limit = parsed;
        }
      }

      let offset = 0;
      if (offsetParamRaw !== undefined) {
        const parsed = parseInt(offsetParamRaw, 10);
        if (!isNaN(parsed) && parsed >= 0) offset = parsed;
      } else if (pageParamRaw !== undefined) {
        const page = parseInt(pageParamRaw, 10);
        if (!isNaN(page) && page > 0) offset = (page - 1) * (limit > 0 ? limit : 1000);
      }

      const paginationClause = limit > 0 ? ` LIMIT ${limit} OFFSET ${offset}` : '';

      // Count saved submissions by immutable exam ID, never by title or student name.
      // An ordinary teacher can only receive counts for exams owned by their account/profile.
      const attemptCountProjection = isAdmin
        ? ", (SELECT COUNT(*) FROM results r WHERE r.exam_id = ec.id) AS attempt_count"
        : isTeacher
          ? ", CASE WHEN ec.creator_id IN (?, ?) THEN (SELECT COUNT(*) FROM results r WHERE r.exam_id = ec.id) ELSE NULL END AS attempt_count"
          : "";
      let query = "SELECT ec.id, ec.name, ec.creator_id, ec.chedodethi, ec.mabaomatdethi, ec.target_lop, ec.lop, ec.target_donvi, ec.donvi, ec.time_limit, ec.count_41, ec.count_tf4, ec.count_sq, ec.count_tl, ec.points_41, ec.points_tf4, ec.points_sq, ec.points_tl, ec.selected_lessons, ec.counts_detail, ec.access_control, ec.tf4_scoring_mode, ec.tf4_points, ec.is_shared_results, ec.max_cheat_warnings, ec.tg_bd, ec.tg_kt, ec.ai_prompt, ec.immediate_feedback, ec.show_score, ec.show_details, ec.sq_case_sensitive, ec.sq_punctuation_sensitive, ec.auto_grade_essay, ec.tieu_de_bai_thi, ec.created_at, ec.updated_at, creator_profile.donvi AS teacher_donvi, "+EXAM_CREATOR_NAME_SQL+" AS creator_name" + attemptCountProjection + " FROM exam_configs ec " + EXAM_CREATOR_JOIN_SQL;
      const params: any[] = isTeacher ? [user.id, user.user_id || user.id] : [];
      if (isTeacher) {
        // A teacher's creator identity is server-verified; forRanking,
        // teacherId and sharedOnly must never widen their exam list.
        query += " WHERE ec.creator_id IN (?, ?)";
        params.push(user.id, user.user_id || user.id);
      } else if (teacherIdParam) {
        query += " WHERE (ec.creator_id = ? OR ec.creator_id IN (SELECT user_id FROM accounts WHERE id = ?) OR ec.creator_id IN (SELECT id FROM accounts WHERE user_id = ?))";
        params.push(teacherIdParam, teacherIdParam, teacherIdParam);
      } else if (sharedOnly) {
        query += " WHERE ec.is_shared_results = 1 OR ec.is_shared_results = 'true' OR ec.is_shared_results = true";
      }
      query += ` ORDER BY ec.name ASC, ec.id ASC${paginationClause}`;

      const { results } = await executeSqlQuery(query, params);
      const mappedResults = (results || []).map((row: any) => ({
        ...mapRowRead(row),
        teacher_donvi: row.teacher_donvi || '',
        creator_name: row.creator_name || '',
        creatorName: row.creator_name || '',
        target_donvi: (row.chedodethi === 'Đề công khai' ? '' : (row.target_donvi || row.donvi || '')),
        donvi: (row.chedodethi === 'Đề công khai' ? '' : (row.target_donvi || row.donvi || '')),
        target_lop: (row.chedodethi === 'Đề công khai' ? '' : (row.target_lop || row.lop || '')),
        lop: (row.chedodethi === 'Đề công khai' ? '' : (row.target_lop || row.lop || '')),
        time: row.time_limit,
        timeLimit: row.time_limit,
        count41: row.count_41,
        countTF4: row.count_tf4,
        countSQ: row.count_sq,
        countTL: row.count_tl,
        num_trac_nghiem: row.count_41,
        num_dung_sai: row.count_tf4,
        num_tra_loi_ngan: row.count_sq,
        num_tuluan: row.count_tl,
        is_shared_results: row.is_shared_results === 1 || row.is_shared_results === true || row.is_shared_results === 'true',
        isSharedResults: row.is_shared_results === 1 || row.is_shared_results === true || row.is_shared_results === 'true',
        max_cheat_warnings: row.max_cheat_warnings !== null && row.max_cheat_warnings !== undefined ? Number(row.max_cheat_warnings) : 5,
        maxCheatWarnings: row.max_cheat_warnings !== null && row.max_cheat_warnings !== undefined ? Number(row.max_cheat_warnings) : 5
      }));

      let filteredResults = mappedResults;
      if (!isAdmin && !isTeacher) {
        filteredResults = mappedResults.filter((row: any) => {
          if (row.chedodethi === 'Đề cho đơn vị' || row.chedodethi === 'Đề thi cho đơn vị') {
            const teacherDonvi = String(row.teacher_donvi || '').trim().toLowerCase();
            let allowedUnits: string[] = [];
            if (row.access_control) {
              try {
                const ac = typeof row.access_control === 'string' ? JSON.parse(row.access_control || '{}') : row.access_control;
                if (ac && ac.allowedUnits) {
                  allowedUnits = Array.isArray(ac.allowedUnits) 
                    ? ac.allowedUnits.map((u: any) => String(u).trim().toLowerCase()) 
                    : [String(ac.allowedUnits).trim().toLowerCase()];
                }
              } catch(e) {}
            }

            let isSameDonVi = false;
            if (user) {
              const normalizeUnit = (value: any) => String(value || '').trim().toLocaleLowerCase('vi').replace(/\s+/g,' ');
              const userDonvi = normalizeUnit(user.donvi || user.address || '');
              const configured = [...new Set([teacherDonvi, ...allowedUnits].map(normalizeUnit).filter(Boolean))];
              isSameDonVi = !!userDonvi && configured.includes(userDonvi);
            }

            if (!isSameDonVi) {
              return false;
            }

            const targetLop = String(row.target_lop || row.lop || '').trim();
            if (!targetLop) {
              return true;
            }

            if (!user) return false;
            const normalizeLop = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
            const userLop = normalizeLop(user.lop || '');
            const allowedLops = targetLop.split(',').map((s: string) => normalizeLop(s)).filter(Boolean);
            return allowedLops.includes(userLop);
          }
          return true;
        });
      }

      const allCreatorIds = [...new Set((mappedResults || []).map((row: any) => row.creator_id || row.creatorId).filter(Boolean))];
      return res.json({ 
        data: filteredResults.map((row:any)=>isProtectedExamForUser(user,row)?
          protectedExamPreview(row):isExamOwner(user,row)?row:redactExamForPublic(row)),
        allCreatorIds, 
        total: filteredResults.length,
        limit,
        offset,
        has_more: limit > 0 && mappedResults.length === limit,
        error: null 
      });
    } catch (e: any) {
      console.error("GET /api/exams error:", e.message || e);
      return res.status(503).json({ data: null, allCreatorIds: [], error: "Không thể tải danh sách đề thi từ cơ sở dữ liệu." });
    }
  });

  app.post("/api/exams", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const user = verifyJWTSync(authHeader.substring(7), await getServerSecret());
      if (!user) return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });

      const isAdmin = checkIsAdmin(user);
      const isTeacher = checkIsTeacherOrAdmin(user);
      if (!isTeacher) return res.status(403).json({ error: "Chỉ giáo viên hoặc admin mới có quyền lưu đề thi" });

      const body = req.body || {};
      const {
        id, name, creator_id, creatorId
      } = body;

      if (!name || !name.trim()) return res.status(400).json({ error: "Tên đề thi không được để trống" });

      const assignedCreatorId = (isAdmin && (creator_id || creatorId)) ? (creator_id || creatorId) : (user.id || creator_id || creatorId);
      const timeLimitVal = Number(body.time_limit ?? body.timeLimit ?? body.time ?? 45) || 45;
      const count41Val = Number(body.count_41 ?? body.count41 ?? body.num_trac_nghiem ?? 0) || 0;
      const countTF4Val = Number(body.count_tf4 ?? body.countTF4 ?? body.num_dung_sai ?? 0) || 0;
      const countSQVal = Number(body.count_sq ?? body.countSQ ?? body.num_tra_loi_ngan ?? 0) || 0;
      const countTLVal = Number(body.count_tl ?? body.countTL ?? body.num_tuluan ?? 0) || 0;
      const points41Val = Number(body.points_41 ?? body.points41 ?? 1) || 1;
      const pointsTF4Val = Number(body.points_tf4 ?? body.pointsTF4 ?? 1) || 1;
      const pointsSQVal = Number(body.points_sq ?? body.pointsSQ ?? 1) || 1;
      const pointsTLVal = Number(body.points_tl ?? body.pointsTL ?? 1) || 1;

      let lessonsArray: string[] = [];
      const rawLessons = body.selected_lessons || body.selectedLessons;
      if (Array.isArray(rawLessons)) {
        lessonsArray = rawLessons;
      } else if (typeof rawLessons === 'string') {
        try { lessonsArray = JSON.parse(rawLessons); } catch(e) { lessonsArray = [rawLessons]; }
      }
      const cleanLessons = [...new Set(lessonsArray.map((l: any) => String(l || '').trim()).filter(Boolean))];
      const safeSelectedLessons = JSON.stringify(cleanLessons);

      const safeAccessControl = typeof body.access_control === 'object' ? JSON.stringify(body.access_control) : (typeof body.accessControl === 'object' ? JSON.stringify(body.accessControl) : (body.access_control || body.accessControl || null));
      const safeTf4Points = typeof body.tf4_points === 'object' ? JSON.stringify(body.tf4_points) : (typeof body.tf4Points === 'object' ? JSON.stringify(body.tf4Points) : (body.tf4_points || body.tf4Points || null));
      const safeCountsDetail = typeof body.counts_detail === 'object' ? JSON.stringify(body.counts_detail) : (typeof body.countsDetail === 'object' ? JSON.stringify(body.countsDetail) : (body.counts_detail || body.countsDetail || null));
      const safeIsShared = (body.is_shared_results || body.isSharedResults) ? 1 : 0;
      const safeImmediateFeedback = (body.immediate_feedback || body.immediateFeedback) ? 1 : 0;
      const safeShowScore = (body.show_score ?? body.showScore ?? 1) ? 1 : 0;
      const safeShowDetails = (body.show_details ?? body.showDetails ?? 1) ? 1 : 0;
      const safeSqCaseSensitive = (body.sq_case_sensitive || body.sqCaseSensitive) ? 1 : 0;
      const safeSqPunctuationSensitive = (body.sq_punctuation_sensitive || body.sqPunctuationSensitive) ? 1 : 0;
      const safeAutoGradeEssay = (body.auto_grade_essay ?? body.autoGradeEssay ?? 1) ? 1 : 0;
      const safeTf4ScoringMode = (body.tf4_scoring_mode ?? body.tf4ScoringMode ?? 0) ? 1 : 0;
      const maxCheatWarningsVal = Math.max(1, Number(body.max_cheat_warnings ?? body.maxCheatWarnings ?? 5) || 5);
      const maxAttemptsVal = Math.max(0, Number(body.max_attempts ?? body.maxAttempts ?? 0) || 0);
      const chedodethiVal = body.chedodethi || 'Đề công khai';
      const mabaomatdethiVal = chedodethiVal === 'Đề có mã bảo mật' ? (body.mabaomatdethi || '') : '';
      let targetLopVal = (body.target_lop ?? body.targetLop ?? body.lop ?? '').trim();
      let targetDonviVal = (body.target_donvi ?? body.targetDonvi ?? body.donvi ?? '').trim();

      // NẾU ĐỀ THI Ở CHẾ ĐỘ LÀ ĐỀ CÔNG KHAI THÌ Ô ĐƠN VỊ VÀ Ô LỚP XÓA RỖNG
      if (chedodethiVal === 'Đề công khai' || !chedodethiVal) {
        targetLopVal = '';
        targetDonviVal = '';
      }

      // BẢO MẬT HỆ THỐNG: Nếu là Giáo viên (không phải Admin), kiểm tra tuyệt đối xem giáo viên có được phân công giảng dạy các lớp trong targetLopVal hay không
      if (!isAdmin && targetLopVal) {
        const myTeacherId = user.user_id || user.id;
        const { results: myClassRows } = await executeSqlQuery(
          "SELECT DISTINCT class_name FROM teacher_classes WHERE teacher_id = ? AND class_name IS NOT NULL AND TRIM(class_name) != ''",
          [myTeacherId]
        );
        const myAssignedClasses = (myClassRows || []).map((r: any) => String(r.class_name || '').trim().toLowerCase()).filter(Boolean);

        const targetClasses = targetLopVal.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
        const unassignedClasses = targetClasses.filter(c => !myAssignedClasses.includes(c));

        if (unassignedClasses.length > 0) {
          return res.status(403).json({
            error: `BẢO MẬT HỆ THỐNG: Bạn không được phân công giảng dạy các lớp [${unassignedClasses.join(', ')}] nên không thể chọn hay giao đề thi cho các lớp này!`
          });
        }
      }

      const tgBdVal = body.tg_bd || null;
      const tgKtVal = body.tg_kt || null;
      const aiPromptVal = body.ai_prompt ?? body.aiPrompt ?? '';
      const aiGradingKeyVal = body.ai_grading_key ?? body.aiGradingKey ?? null;
      const tieuDeBaiThiVal = (body.tieu_de_bai_thi ?? body.tieuDeBaiThi ?? '').trim();
      const now = new Date().toISOString();

      await executeSqlQuery('ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1', []);
      let existingRecord: any = null;
      if (id) {
        const { results } = await executeSqlQuery("SELECT id, creator_id, updated_at FROM exam_configs WHERE id = ?", [id]);
        if (results && results.length > 0) existingRecord = results[0];
      }
      if (!existingRecord) {
        const { results } = await executeSqlQuery("SELECT id, creator_id, updated_at FROM exam_configs WHERE name = ? AND creator_id = ?", [name.trim(), assignedCreatorId]);
        if (results && results.length > 0) existingRecord = results[0];
      }

      if (id && !existingRecord) return res.status(404).json({ error: 'Đề thi cần cập nhật không còn tồn tại' });
      if (existingRecord) {
        if (!id) return res.status(409).json({ error: 'Tên đề đã tồn tại; không được tự ghi đè', code: 'DUPLICATE_EXAM_NAME' });
        const expectedRevision = String(body.expected_updated_at ?? '');
        if (body.expected_updated_at === undefined || expectedRevision !== String(existingRecord.updated_at ?? '')) {
          return res.status(409).json({ error: 'Phiên bản đề thi đã thay đổi. Vui lòng nạp lại.', code: 'EXAM_VERSION_REQUIRED' });
        }
        if (!canManageExamConfig(user,existingRecord.creator_id,isAdmin)) {
          return res.status(403).json({ error: "Bạn không có quyền chỉnh sửa đề thi của người khác" });
        }

        const updateSql = `
          UPDATE exam_configs SET
            name = ?, time_limit = ?, count_41 = ?, count_tf4 = ?, count_sq = ?, count_tl = ?,
            points_41 = ?, points_tf4 = ?, points_sq = ?, points_tl = ?,
            selected_lessons = ?, tf4_scoring_mode = ?, tf4_points = ?, access_control = ?,
            immediate_feedback = ?, show_score = ?, show_details = ?,
            sq_case_sensitive = ?, sq_punctuation_sensitive = ?, auto_grade_essay = ?,
            counts_detail = ?, chedodethi = ?, mabaomatdethi = ?, target_lop = ?, lop = ?, target_donvi = ?, donvi = ?, tg_bd = ?, tg_kt = ?,
            ai_prompt = ?, is_shared_results = ?, max_cheat_warnings = ?, max_attempts = ?, ai_grading_key = ?, tieu_de_bai_thi = ?, updated_at = ?
          WHERE id = ? AND updated_at IS NOT DISTINCT FROM ?
        `;

        const updateResult = await executeSqlQuery(updateSql, [
          name.trim(), timeLimitVal, count41Val, countTF4Val, countSQVal, countTLVal,
          points41Val, pointsTF4Val, pointsSQVal, pointsTLVal,
          safeSelectedLessons, safeTf4ScoringMode, safeTf4Points, safeAccessControl,
          safeImmediateFeedback, safeShowScore, safeShowDetails,
          safeSqCaseSensitive, safeSqPunctuationSensitive, safeAutoGradeEssay,
          safeCountsDetail, chedodethiVal, mabaomatdethiVal, targetLopVal, targetLopVal, targetDonviVal, targetDonviVal, tgBdVal, tgKtVal,
          aiPromptVal, safeIsShared, maxCheatWarningsVal, maxAttemptsVal, aiGradingKeyVal, tieuDeBaiThiVal, now, existingRecord.id, existingRecord.updated_at ?? null
        ]);

        if (Number(updateResult.changes || 0) !== 1) return res.status(409).json({ error: 'Đề thi đã được lưu trên thiết bị khác. Vui lòng tải lại.', code: 'EXAM_CONFLICT' });
        return res.json({ success: true, type: 'updated', updated_at: now, id: existingRecord.id, error: null });
      } else {
        const newId = crypto.randomUUID();
        const insertSql = `
          INSERT INTO exam_configs (
            id, name, creator_id, time_limit, count_41, count_tf4, count_sq, count_tl,
            points_41, points_tf4, points_sq, points_tl,
            selected_lessons, tf4_scoring_mode, tf4_points, access_control,
            immediate_feedback, show_score, show_details,
            sq_case_sensitive, sq_punctuation_sensitive, auto_grade_essay,
            counts_detail, chedodethi, mabaomatdethi, target_lop, lop, target_donvi, donvi, tg_bd, tg_kt,
            ai_prompt, is_shared_results, max_cheat_warnings, max_attempts, ai_grading_key, tieu_de_bai_thi, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        await executeSqlQuery(insertSql, [
          newId, name.trim(), assignedCreatorId, timeLimitVal, count41Val, countTF4Val, countSQVal, countTLVal,
          points41Val, pointsTF4Val, pointsSQVal, pointsTLVal,
          safeSelectedLessons, safeTf4ScoringMode, safeTf4Points, safeAccessControl,
          safeImmediateFeedback, safeShowScore, safeShowDetails,
          safeSqCaseSensitive, safeSqPunctuationSensitive, safeAutoGradeEssay,
          safeCountsDetail, chedodethiVal, mabaomatdethiVal, targetLopVal, targetLopVal, targetDonviVal, targetDonviVal, tgBdVal, tgKtVal,
          aiPromptVal, safeIsShared, maxCheatWarningsVal, maxAttemptsVal, aiGradingKeyVal, tieuDeBaiThiVal, now, now
        ]);

        return res.json({ success: true, type: 'inserted', updated_at: now, id: newId, error: null });
      }
    } catch (e: any) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("POST /api/exams error::", e);
      return res.status(500).json({ error: e.message || 'Lỗi server', success: false });
    }
  });

  app.delete("/api/exams", async (req, res) => {
    try {
      const id = (req.query.id as string) || req.body?.id;
      if (typeof id !== 'string' || !id.trim())
        return res.status(400).json({error:'Thiếu ID đề thi cần xóa',code:'EXAM_ID_REQUIRED'});
      const authHeader=req.headers.authorization;
      if (!authHeader?.startsWith('Bearer '))
        return res.status(401).json({error:'Phiên đăng nhập không hợp lệ',code:'EXAM_AUTH_REQUIRED'});
      const user=verifyJWTSync(authHeader.slice(7),await getServerSecret());
      if (!user) return res.status(401).json({error:'Phiên đăng nhập không hợp lệ',code:'EXAM_AUTH_REQUIRED'});
      const isAdmin=checkIsAdmin(user);
      if (!checkIsTeacherOrAdmin(user) || (!isAdmin &&
          !['teacher','giáo viên'].includes(String(user.role||'').toLowerCase()) &&
          String(user.target_audience||'').toLowerCase()!=='giáo viên'))
        return res.status(403).json({error:'Tài khoản không có quyền xóa đề thi',code:'EXAM_DELETE_FORBIDDEN'});

      const {results}=await executeSqlQuery('SELECT id, creator_id FROM exam_configs WHERE id = ?',[id]);
      const exam:any=results?.[0];
      if (!exam) return res.status(404).json({error:'Đề thi không tồn tại hoặc đã bị xóa',code:'EXAM_NOT_FOUND'});
      if (!canManageExamConfig(user,exam.creator_id,isAdmin))
        return res.status(403).json({error:'Không có quyền xóa đề thi của người khác',code:'EXAM_DELETE_FORBIDDEN'});

      const {results:counts}=await executeSqlQuery('SELECT COUNT(*) AS total FROM results WHERE exam_id = ?',[id]);
      if (Number(counts?.[0]?.total||0)>0)
        return res.status(409).json({error:'Đề thi đã có bài làm của học sinh nên không thể xóa vĩnh viễn. Cần giữ đề để bảo toàn lịch sử và quyền xem kết quả.',code:'EXAM_HAS_RESULTS'});

      await executeSqlQuery(`
        CREATE TABLE IF NOT EXISTS _exam_grade_sessions (
          session_id TEXT PRIMARY KEY, exam_id TEXT, teacher_id TEXT,
          question_ids TEXT NOT NULL, question_snapshot TEXT NOT NULL,
          exam_config TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
          started_at TEXT, deadline_at TEXT
        )
      `,[]);
      const {results:liveSessions}=await executeSqlQuery(
        'SELECT session_id FROM _exam_grade_sessions WHERE exam_id = ? AND expires_at >= ? LIMIT 1',
        [id,new Date().toISOString()]
      );
      if(liveSessions?.length)
        return res.status(409).json({error:'Đề thi đang có phiên READY/ACTIVE của học sinh nên chưa thể xóa.',code:'EXAM_HAS_LIVE_SESSION'});

      const stmt=examConfigGuardedDeleteStatement(id,exam.creator_id);
      const deleted=await executeSqlQuery(stmt.sql,stmt.params);
      if(Number(deleted.changes||0)!==1)
        return res.status(409).json({error:'Đề thi đã thay đổi, đã có kết quả mới hoặc đã bị xóa. Vui lòng tải lại danh sách.',code:'EXAM_DELETE_CONFLICT'});
      return res.json({success:true,message:'Đã xóa đề thi thành công',error:null});
    } catch (err:any) {
      console.error('DELETE /api/exams failed:',err?.message||err);
      return res.status(500).json({error:'Không thể xóa đề thi do lỗi máy chủ. Dữ liệu hiện tại được giữ nguyên.',code:'EXAM_DELETE_FAILED'});
    }
  });

  // --- API /api/questions (Quản lý ngân hàng câu hỏi) ---
  app.get("/api/questions", async (req, res) => {
    try {
      const teacherIdParam = (req.query.teacherId || req.query.teacher_id) as string;
      const metaOnly = req.query.metaOnly === 'true' || req.query.metadata === 'true';

      // Keep metadata-only backward compatible with the Production route.
      if (metaOnly && teacherIdParam) {
        const { results } = await executeSqlQuery(
          "SELECT type, level, lesson FROM questions WHERE creator_id = ? OR creator_id IN (SELECT user_id FROM accounts WHERE id = ?) OR creator_id IN (SELECT id FROM accounts WHERE user_id = ?)",
          [teacherIdParam, teacherIdParam, teacherIdParam]
        );
        return res.json({ data: results || [], error: null });
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const user = verifyJWTSync(authHeader.substring(7), await getServerSecret());
      if (!user) return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });

      const isAdmin = checkIsAdmin(user);
      const isTeacher = checkIsTeacherOrAdmin(user);
      if (!isAdmin && !isTeacher) {
        return res.status(403).json({ error: "Không có quyền truy cập ngân hàng câu hỏi", data: [] });
      }

      const countOnly = req.query.count === 'true';
      let targetTeacherId = user.id;
      if (isAdmin && teacherIdParam) targetTeacherId = teacherIdParam;

      if (countOnly) {
        let countSql = "SELECT COUNT(*) as total FROM questions";
        const params: any[] = [];
        if (!isAdmin) {
          countSql += " WHERE creator_id = ?";
          params.push(targetTeacherId);
        } else if (teacherIdParam) {
          countSql += " WHERE creator_id = ?";
          params.push(teacherIdParam);
        }
        const { results } = await executeSqlQuery(countSql, params);
        const count = results && results.length > 0 ? (results[0] as any).total : 0;
        return res.json({ count, error: null });
      }

      const limitParam = req.query.limit as string;
      const offsetParam = req.query.offset as string;
      const pageParam = req.query.page as string;

      let limit = -1;
      if (limitParam !== undefined) {
        if (limitParam === 'all' || limitParam === '0' || limitParam === '-1') {
          limit = -1;
        } else {
          const parsed = parseInt(limitParam, 10);
          if (!isNaN(parsed) && parsed > 0) limit = parsed;
        }
      }

      let offset = 0;
      if (offsetParam !== undefined) {
        const parsed = parseInt(offsetParam, 10);
        if (!isNaN(parsed) && parsed >= 0) offset = parsed;
      } else if (pageParam !== undefined) {
        const page = parseInt(pageParam, 10);
        if (!isNaN(page) && page > 0) offset = (page - 1) * (limit > 0 ? limit : 1000);
      }

      const paginationClause = limit > 0 ? ` LIMIT ${limit} OFFSET ${offset}` : '';

      let query = "SELECT q.*, "+QUESTION_CREATOR_NAME_SQL+" AS creator_name, "+QUESTION_CREATOR_USERNAME_SQL+" AS creator_username FROM questions q "+QUESTION_CREATOR_JOIN_SQL;
      const params: any[] = [];
      if (!isAdmin) {
        query += " WHERE q.creator_id = ?";
        params.push(targetTeacherId);
      } else if (teacherIdParam) {
        query += " WHERE q.creator_id = ?";
        params.push(teacherIdParam);
      }
      query += ` ORDER BY q.lesson ASC, q.type ASC, q.id ASC${paginationClause}`;

      const { results } = await executeSqlQuery(query, params);
      const mapped = (results || []).map((q: any) => {
        const readQ = mapRowRead(q);
        return {
          id: readQ.id,
          type: readQ.type,
          level: readQ.level,
          lesson: readQ.lesson,
          content: readQ.content,
          options: readQ.options || {},
          answer: readQ.answer,
          image: readQ.image || '',
          creatorId: readQ.creator_id,
          creator_id: readQ.creator_id,
          creator_name: q.creator_name || '',
          creatorName: q.creator_name || '',
          creator_username: q.creator_username || '',
          creatorUsername: q.creator_username || '',
          created_at: readQ.created_at,
          updated_at: readQ.updated_at
        };
      });

      return res.json({ 
        data: mapped, 
        total: mapped.length,
        limit,
        offset,
        has_more: limit > 0 && mapped.length === limit,
        error: null 
      });
    } catch (e: any) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("GET /api/questions error::", e);
      return res.status(500).json({ error: e.message || 'Lỗi server', data: [] });
    }
  });

  app.post("/api/questions", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const user = verifyJWTSync(authHeader.substring(7), await getServerSecret());
      if (!user) return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });

      const isAdmin = checkIsAdmin(user);
      const isTeacher = checkIsTeacherOrAdmin(user);
      if (!isTeacher) return res.status(403).json({ error: "Chỉ giáo viên mới có quyền cập nhật ngân hàng câu hỏi" });

      const body = req.body || {};
      const questions: any[] = Array.isArray(body) ? body : (body.questions || [body]);
      if (!Array.isArray(body) && body?.deletedIds !== undefined && !Array.isArray(body.deletedIds)) {
        return res.status(400).json({error:'Danh sách ID câu hỏi cần xóa không hợp lệ'});
      }
      const deletedIds: string[] = Array.isArray(body?.deletedIds)
        ? [...new Set(body.deletedIds.map((id:any)=>String(id||'').trim()).filter(Boolean))]
        : [];
      const ownerIds = new Set([String(user.id||''),String(user.user_id||'')].filter(Boolean));

      // Validate the entire mutation set before deleting or upserting anything.
      for (const q of questions) {
        if (!q || typeof q !== 'object' || Array.isArray(q)) {
          return res.status(400).json({error:'Dữ liệu câu hỏi trong batch không hợp lệ'});
        }
        const qId = q.id || '(câu mới)';
        if (!isAdmin && q.id) {
          const existing = await executeSqlQuery("SELECT creator_id FROM questions WHERE id = ?", [q.id]);
          const owner = existing.results?.[0]?.creator_id;
          if (owner && !ownerIds.has(String(owner))) {
            return res.status(403).json({error:'Không có quyền sửa câu hỏi của tài khoản khác'});
          }
        }
        let options:any = {};
        if (q.options && typeof q.options === 'object' && !Array.isArray(q.options)) options = q.options;
        else if (typeof q.options === 'string' && q.options.trim()) {
          try { options = JSON.parse(q.options); }
          catch { return res.status(400).json({error:`Câu hỏi ${qId}: tùy chọn không phải JSON hợp lệ`}); }
        }
        const type = normalizeQuestionType(q.type || 'trac_nghiem');
        const level = String(q.level ?? '').trim().toUpperCase();
        if (!['NB','TH','VD'].includes(level)) {
          return res.status(400).json({error:`Câu hỏi ${qId}: mức độ phải là NB, TH hoặc VD.`,code:'INVALID_QUESTION_LEVEL'});
        }
        const answerVerdict = validateQuestionAnswer(type,q.answer,options);
        if (!answerVerdict.ok) {
          return res.status(400).json({error:`Câu hỏi ${qId}: ${answerVerdict.reason}`,code:'INVALID_QUESTION_ANSWER'});
        }
        if (type === '4-1') {
          for (const key of ['A','B','C','D']) {
            const option:any = options[key];
            const text = option && typeof option === 'object'
              ? String(option.text ?? option.content ?? option.value ?? '').trim()
              : String(option ?? '').trim();
            const image = option && typeof option === 'object'
              ? String(option.image ?? option.img ?? option.src ?? option.url ?? '').trim()
              : '';
            if (!text && !image) {
              return res.status(400).json({error:`Câu hỏi ${qId}: câu trắc nghiệm phải có đủ phương án A, B, C, D.`,code:'INVALID_QUESTION_OPTIONS'});
            }
          }
        }
      }

      if (deletedIds && deletedIds.length > 0) {
        for (const id of deletedIds) {
          if (!isAdmin) {
            await executeSqlQuery("DELETE FROM questions WHERE id = ? AND creator_id IN (?, ?)", [id, user.id, user.user_id || user.id]);
          } else {
            await executeSqlQuery("DELETE FROM questions WHERE id = ?", [id]);
          }
        }
      }

      if (questions && questions.length > 0) {
        const upsertSql = `
          INSERT INTO questions (id, type, level, lesson, content, options, answer, image, creator_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            type = excluded.type,
            level = excluded.level,
            lesson = excluded.lesson,
            content = excluded.content,
            options = excluded.options,
            answer = excluded.answer,
            image = excluded.image
          WHERE questions.creator_id = excluded.creator_id
        `;

        for (const q of questions) {
          if (!q || typeof q !== 'object' || Array.isArray(q)) {
            return res.status(400).json({error:'Dữ liệu câu hỏi trong batch không hợp lệ'});
          }
          const qId = q.id || ((globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36));
          let creatorId = isAdmin ? (q.creatorId || user.id) : user.id;
          if (!isAdmin && q.id) {
            const existing = await executeSqlQuery("SELECT creator_id FROM questions WHERE id = ?", [q.id]);
            const owner = existing.results?.[0]?.creator_id;
            if (owner && !ownerIds.has(String(owner))) {
              return res.status(403).json({error:'Không có quyền sửa câu hỏi của tài khoản khác'});
            }
            if (owner) creatorId = String(owner);
          }
          let optionObject:any = {};
          if (q.options && typeof q.options === 'object' && !Array.isArray(q.options)) optionObject = q.options;
          else if (typeof q.options === 'string' && q.options.trim()) {
            try { optionObject = JSON.parse(q.options); }
            catch { return res.status(400).json({error:'Tùy chọn câu hỏi không phải JSON hợp lệ'}); }
          }
          const normalizedType = normalizeQuestionType(q.type || 'trac_nghiem');
          const normalizedLevel = String(q.level ?? '').trim().toUpperCase();
          if (!['NB','TH','VD'].includes(normalizedLevel)) {
            return res.status(400).json({error:`Câu hỏi ${qId}: mức độ phải là NB, TH hoặc VD.`,code:'INVALID_QUESTION_LEVEL'});
          }
          const answerVerdict = validateQuestionAnswer(normalizedType,q.answer,optionObject);
          if (!answerVerdict.ok) {
            return res.status(400).json({error:`Câu hỏi ${qId}: ${answerVerdict.reason}`,code:'INVALID_QUESTION_ANSWER'});
          }
          const safeOptions = JSON.stringify(optionObject);

          await executeSqlQuery(upsertSql, [
            qId,
            normalizedType,
            normalizedLevel,
            q.lesson || '',
            q.content || '',
            safeOptions,
            answerVerdict.value,
            q.image || null,
            creatorId
          ]);
        }
      }

      return res.json({ success: true, count: questions.length, error: null });
    } catch (e: any) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("POST /api/questions error::", e);
      return res.status(500).json({ error: e.message || 'Lỗi server', success: false });
    }
  });

  app.post("/api/questions/delete-by-lesson", async(req,res)=>{
    try{
      const auth=req.headers.authorization;
      if(!auth?.startsWith('Bearer '))return res.status(401).json({error:'Vui lòng đăng nhập'});
      const user=verifyJWTSync(auth.slice(7),await getServerSecret());
      if(!user)return res.status(401).json({error:'Phiên đăng nhập không hợp lệ'});
      if(!checkIsTeacherOrAdmin(user)||!canDeleteQuestionsByLesson(user))return res.status(403).json({error:'Không có quyền xóa câu hỏi'});
      const scope=questionLessonDeleteScope(requiredQuestionLesson(req.body?.lesson),user.id,checkIsAdmin(user));
      const query=questionLessonCountQuery(scope);
      const initial=await executeSqlQuery(query.sql,query.params);
      const count=Number(initial.results?.[0]?.total||0);
      if(req.body?.action==='preview')return res.json({lesson:scope.lesson,count,scope:scope.scope});
      if(req.body?.action!=='delete')return res.status(400).json({error:'Thao tác không hợp lệ'});
      const expected=requireQuestionLessonConfirmation(req.body?.confirmation,req.body?.expectedCount);
      if(expected!==count)return res.status(409).json({error:'Danh sách câu hỏi đã thay đổi. Vui lòng kiểm tra lại.',code:'LESSON_CHANGED',count});
      const command=questionLessonDeleteQuery(scope,expected);
      const result=await executeSqlQuery(command.sql,command.params);
      if(result.changes!==expected)return res.status(409).json({error:result.changes>0?'Có thay đổi đồng thời: đã xóa một phần. Hãy tải lại danh sách và kiểm tra ngay.':'Danh sách đã thay đổi, chưa xóa câu hỏi nào. Vui lòng thử lại.',code:result.changes>0?'PARTIAL_DELETE':'LESSON_CHANGED',deletedCount:result.changes});
      return res.json({success:true,lesson:scope.lesson,deletedCount:result.changes});
    }catch(error:any){
      if(error instanceof QuestionLessonDeleteError)return res.status(error.status).json({error:error.message,code:error.code});
      console.error('Delete by lesson failed',error);
      return res.status(500).json({error:'Không thể xóa câu hỏi theo bài.'});
    }
  });

  app.delete("/api/questions", async (req, res) => {
    try {
      let ids: string[] = [];
      const idParam = req.query.id as string;
      if (idParam) ids = [idParam];
      else if (Array.isArray(req.body?.ids)) ids = req.body.ids;
      else if (req.body?.id) ids = [req.body.id];

      if (ids.length === 0) return res.status(400).json({ error: "Thiếu ID câu hỏi cần xóa" });

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const user = verifyJWTSync(authHeader.substring(7), await getServerSecret());
      if (!user) return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });

      const isAdmin = checkIsAdmin(user);
      for (const id of ids) {
        if (isAdmin) {
          await executeSqlQuery("DELETE FROM questions WHERE id = ?", [id]);
        } else {
          await executeSqlQuery("DELETE FROM questions WHERE id = ? AND creator_id IN (?, ?)", [id, user.id, user.user_id || user.id]);
        }
      }

      return res.json({ success: true, message: `Đã xóa ${ids.length} câu hỏi`, error: null });
    } catch (e: any) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("DELETE /api/questions error::", e);
      return res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });

  // --- API /api/results (Quản lý bảng điểm & kết quả bài thi) ---
  app.get("/api/results", async (req, res) => {
    try {
      const idParam = req.query.id as string;
      const examIdParam = (req.query.examId || req.query.exam_id) as string;
      const countOnly = req.query.count === 'true';
      const includeDetails = req.query.includeDetails === 'true' || !!idParam;
      const limitParamRaw = req.query.limit as string;
      const offsetParamRaw = req.query.offset as string;
      const pageParamRaw = req.query.page as string;

      let limit = -1;
      if (limitParamRaw !== undefined) {
        if (limitParamRaw === 'all' || limitParamRaw === '0' || limitParamRaw === '-1') {
          limit = -1;
        } else {
          const parsed = parseInt(limitParamRaw, 10);
          if (!isNaN(parsed) && parsed > 0) limit = parsed;
        }
      }

      let offset = 0;
      if (offsetParamRaw !== undefined) {
        const parsed = parseInt(offsetParamRaw, 10);
        if (!isNaN(parsed) && parsed >= 0) offset = parsed;
      } else if (pageParamRaw !== undefined) {
        const page = parseInt(pageParamRaw, 10);
        if (!isNaN(page) && page > 0) offset = (page - 1) * (limit > 0 ? limit : 1000);
      }

      const paginationClause = limit > 0 ? ` LIMIT ${limit} OFFSET ${offset}` : '';

      function sendPaginatedResults(rawRows: any[], incDetails: boolean) {
        const data = (rawRows || []).map((r: any) => {
          let details = [];
          if (incDetails && r.details) {
            try { details = typeof r.details === 'string' ? JSON.parse(r.details) : r.details; } catch { details = []; }
          }
          return {
            ...r,
            user_id: r.user_id || '',
            userId: r.user_id || '',
            lop: r.lop || '',
            don_vi: r.don_vi || r.student_class || '',
            donvi: r.don_vi || r.student_class || '',
            cheat_warning_count: Number(r.cheat_warning_count) || 0,
            cheatWarningCount: Number(r.cheat_warning_count) || 0,
            ...(incDetails ? { details } : {})
          };
        });
        return res.json({
          data,
          total: data.length,
          limit,
          offset,
          has_more: limit > 0 && data.length === limit,
          error: null
        });
      }

      const authHeader = req.headers.authorization;
      let user: any = null;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        user = verifyJWTSync(authHeader.substring(7), await getServerSecret());
      }

      const isAdmin = checkIsAdmin(user);
      const isTeacher = checkIsTeacherOrAdmin(user) && !isAdmin;
      const isStudent = user && !isAdmin && !isTeacher;

      // 1. Chi tiết 1 bài thi theo ID
      if (idParam) {
        const { results } = await executeSqlQuery(`
          SELECT 
            r.id, r.user_id, r.student_name, r.student_class, r.exam_name, r.exam_id, r.score, r.time_taken, 
            r.correct_count, r.total_questions, r.details, r.loai_thi_sinh, r.cheat_warning_count, 
            r.ai_grading_summary, r.created_at,
            COALESCE(NULLIF(TRIM(r.lop), ''), MAX(u.lop), MAX(u2.lop), '') as lop,
            COALESCE(NULLIF(TRIM(r.don_vi), ''), MAX(u.donvi), MAX(u.address), MAX(u2.donvi), MAX(u2.address), MAX(r.student_class), '') as don_vi
          FROM results r
          LEFT JOIN accounts a ON (r.user_id IS NOT NULL AND r.user_id != '' AND (r.user_id = a.id OR r.user_id = a.user_id))
          LEFT JOIN users u ON (r.user_id IS NOT NULL AND r.user_id != '' AND r.user_id = u.id)
          LEFT JOIN users u2 ON (a.user_id IS NOT NULL AND a.user_id != '' AND a.user_id = u2.id)
          WHERE r.id = ?
          GROUP BY r.id, r.user_id, r.student_name, r.student_class, r.exam_name, r.exam_id, r.score, r.time_taken, r.correct_count, r.total_questions, r.details, r.loai_thi_sinh, r.cheat_warning_count, r.ai_grading_summary, r.created_at
        `, [idParam]);

        if (!results || results.length === 0) {
          return res.status(404).json({ data: null, error: "Không tìm thấy kết quả bài thi" });
        }

        const row: any = results[0];
        if (isTeacher) {
          const { results: examRows } = await executeSqlQuery(
            "SELECT id FROM exam_configs WHERE id = ? AND creator_id IN (?, ?)",
            [row.exam_id, user.id, user.user_id || user.id]);
          if (!examRows || examRows.length === 0) {
            return res.status(403).json({ data: null, error: "Bạn không có quyền xem chi tiết kết quả này" });
          }
        } else if (isStudent) {
          const isOwner = row.user_id && (row.user_id === user.id || row.user_id === user.user_id);
          if (!isOwner) {
            return res.status(403).json({ data: null, error: "Bạn chỉ có thể xem chi tiết bài thi của chính mình" });
          }
        } else if (!user) {
          const { results: sharedCheck } = await executeSqlQuery(
            "SELECT id FROM exam_configs WHERE id = ? AND (is_shared_results = 1 OR is_shared_results = 'true' OR is_shared_results = true)",
            [row.exam_id]
          );
          if (!sharedCheck || sharedCheck.length === 0) {
            return res.status(403).json({ data: null, error: "Kết quả này không được công khai" });
          }
        }

        let parsedDetails = [];
        if (row.details) {
          try {
            parsedDetails = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
          } catch {
            parsedDetails = [];
          }
        }

        const lop = row.lop || '';
        const donVi = row.don_vi || row.student_class || '';

        return res.json({
          data: {
            ...row,
            user_id: row.user_id || '',
            userId: row.user_id || '',
            lop: lop,
            don_vi: donVi,
            donvi: donVi,
            cheat_warning_count: Number(row.cheat_warning_count) || 0,
            cheatWarningCount: Number(row.cheat_warning_count) || 0,
            details: parsedDetails
          },
          error: null
        });
      }

      // 2. Chỉ đếm số lượng kết quả (cho stats)
      if (countOnly) {
        if (isAdmin) {
          const { results: countRows } = await executeSqlQuery("SELECT COUNT(*) as cnt FROM results", []);
          const count = countRows && countRows.length > 0 ? Number((countRows[0] as any).cnt) || 0 : 0;
          return res.json({ count, error: null });
        }
        if (isTeacher) {
          const { results: myExams } = await executeSqlQuery(
            "SELECT id FROM exam_configs WHERE creator_id IN (?, ?)",
            [user.id, user.user_id || user.id]);
          const examIds = (myExams || []).map((e: any) => String(e.id)).filter(Boolean);
          if (examIds.length === 0) return res.json({ count: 0, error: null });

          const placeholders = examIds.map(() => '?').join(',');
          const { results: countRows } = await executeSqlQuery(`SELECT COUNT(*) as cnt FROM results WHERE exam_id IN (${placeholders})`, examIds);
          const count = countRows && countRows.length > 0 ? Number((countRows[0] as any).cnt) || 0 : 0;
          return res.json({ count, error: null });
        }
        if (isStudent) {
          const studentUserId = user.user_id || user.id;
          const studentAccountId = user.id;
          const { results: countRows } = await executeSqlQuery(
            "SELECT COUNT(*) as cnt FROM results WHERE (user_id = ? OR user_id = ?)",
            [studentAccountId, studentUserId]
          );
          const count = countRows && countRows.length > 0 ? Number((countRows[0] as any).cnt) || 0 : 0;
          return res.json({ count, error: null });
        }
        return res.json({ count: 0, error: null });
      }

      // 3. Tải danh sách kết quả theo mã chia sẻ (?examId=xxx)
      if (examIdParam) {
        if (isTeacher) {
          const { results: ownExam } = await executeSqlQuery(
            "SELECT id FROM exam_configs WHERE id = ? AND creator_id IN (?, ?)",
            [examIdParam, user.id, user.user_id || user.id]);
          if (!ownExam?.length) return res.status(403).json({ data: [], error: "Không có quyền xem đề thi này" });
        }
        if (!isAdmin && !isTeacher) {
          const { results: sharedExam } = await executeSqlQuery(
            "SELECT id FROM exam_configs WHERE id = ? AND (is_shared_results = 1 OR is_shared_results = 'true' OR is_shared_results = true)",
            [examIdParam]
          );
          if (!sharedExam || sharedExam.length === 0) {
            return res.status(403).json({ data: [], error: "Đề thi này không mở chia sẻ kết quả" });
          }
        }

        const columns = includeDetails
          ? "r.id, r.user_id, r.student_name, r.student_class, r.score, r.correct_count, r.total_questions, r.time_taken, r.exam_name, r.exam_id, r.created_at, r.loai_thi_sinh, r.cheat_warning_count, r.ai_grading_summary, COALESCE(NULLIF(TRIM(r.lop), ''), MAX(u.lop), MAX(u2.lop), '') as lop, COALESCE(NULLIF(TRIM(r.don_vi), ''), MAX(u.donvi), MAX(u.address), MAX(u2.donvi), MAX(u2.address), MAX(r.student_class), '') as don_vi, r.details"
          : "r.id, r.user_id, r.student_name, r.student_class, r.score, r.correct_count, r.total_questions, r.time_taken, r.exam_name, r.exam_id, r.created_at, r.loai_thi_sinh, r.cheat_warning_count, r.ai_grading_summary, COALESCE(NULLIF(TRIM(r.lop), ''), MAX(u.lop), MAX(u2.lop), '') as lop, COALESCE(NULLIF(TRIM(r.don_vi), ''), MAX(u.donvi), MAX(u.address), MAX(u2.donvi), MAX(u2.address), MAX(r.student_class), '') as don_vi";

        const { results } = await executeSqlQuery(`
          SELECT ${columns} 
          FROM results r
          LEFT JOIN accounts a ON (r.user_id IS NOT NULL AND r.user_id != '' AND (r.user_id = a.id OR r.user_id = a.user_id))
          LEFT JOIN users u ON (r.user_id IS NOT NULL AND r.user_id != '' AND r.user_id = u.id)
          LEFT JOIN users u2 ON (a.user_id IS NOT NULL AND a.user_id != '' AND a.user_id = u2.id)
          WHERE r.exam_id = ? 
          GROUP BY r.id, r.user_id, r.student_name, r.student_class, r.score, r.correct_count, r.total_questions, r.time_taken, r.exam_name, r.exam_id, r.created_at, r.loai_thi_sinh, r.cheat_warning_count, r.ai_grading_summary
          ORDER BY r.created_at DESC, r.id DESC 
          ${paginationClause}
        `, [examIdParam]);

        return sendPaginatedResults(results || [], includeDetails);
      }

      // 4. Tải danh sách theo quyền người dùng
      const columns = includeDetails
        ? "r.id, r.user_id, r.student_name, r.student_class, r.score, r.correct_count, r.total_questions, r.time_taken, r.exam_name, r.exam_id, r.created_at, r.loai_thi_sinh, r.cheat_warning_count, r.ai_grading_summary, COALESCE(NULLIF(TRIM(r.lop), ''), MAX(u.lop), MAX(u2.lop), '') as lop, COALESCE(NULLIF(TRIM(r.don_vi), ''), MAX(u.donvi), MAX(u.address), MAX(u2.donvi), MAX(u2.address), MAX(r.student_class), '') as don_vi, r.details"
        : "r.id, r.user_id, r.student_name, r.student_class, r.score, r.correct_count, r.total_questions, r.time_taken, r.exam_name, r.exam_id, r.created_at, r.loai_thi_sinh, r.cheat_warning_count, r.ai_grading_summary, COALESCE(NULLIF(TRIM(r.lop), ''), MAX(u.lop), MAX(u2.lop), '') as lop, COALESCE(NULLIF(TRIM(r.don_vi), ''), MAX(u.donvi), MAX(u.address), MAX(u2.donvi), MAX(u2.address), MAX(r.student_class), '') as don_vi";

      const fallbackColumns = "id, user_id, student_name, student_class, score, correct_count, total_questions, time_taken, exam_name, exam_id, created_at, loai_thi_sinh, cheat_warning_count, ai_grading_summary, lop, don_vi";

      if (isAdmin) {
        let rows: any[] = [];
        try {
          const { results } = await executeSqlQuery(`
            SELECT ${columns}, (SELECT e.creator_id FROM exam_configs e WHERE e.id = r.exam_id LIMIT 1) AS exam_creator_id 
            FROM results r
            LEFT JOIN accounts a ON (r.user_id IS NOT NULL AND r.user_id != '' AND (r.user_id = a.id OR r.user_id = a.user_id))
            LEFT JOIN users u ON (r.user_id IS NOT NULL AND r.user_id != '' AND r.user_id = u.id)
            LEFT JOIN users u2 ON (a.user_id IS NOT NULL AND a.user_id != '' AND a.user_id = u2.id)
            GROUP BY r.id, r.user_id, r.student_name, r.student_class, r.score, r.correct_count, r.total_questions, r.time_taken, r.exam_name, r.exam_id, r.created_at, r.loai_thi_sinh, r.cheat_warning_count, r.ai_grading_summary
            ORDER BY r.created_at DESC, r.id DESC 
            ${paginationClause}
          `, []);
          rows = results || [];
        } catch (err) {
          const { results } = await executeSqlQuery(`SELECT ${fallbackColumns}, (SELECT e.creator_id FROM exam_configs e WHERE e.id = r.exam_id LIMIT 1) AS exam_creator_id FROM results r ORDER BY r.created_at DESC, r.id DESC ${paginationClause}`, []);
          rows = results || [];
        }
        return sendPaginatedResults(rows, includeDetails);
      }

      if (isTeacher) {
        // Never widen the exam-result list by classroom membership or a
        // username/title match. Missing exam configs stay inaccessible.
        const { results: myExams } = await executeSqlQuery(
          "SELECT id FROM exam_configs WHERE creator_id IN (?, ?)",
          [user.id, user.user_id || user.id]
        );
        const examIds = (myExams || []).map((e:any)=>String(e.id)).filter(Boolean);
        if (!examIds.length) return sendPaginatedResults([], includeDetails);
        const placeholders = examIds.map(()=>'?').join(',');
        let rows: any[] = [];
        try {
          const { results } = await executeSqlQuery(`
            SELECT ${columns}
            FROM results r
            LEFT JOIN accounts a ON (r.user_id IS NOT NULL AND r.user_id != '' AND (r.user_id = a.id OR r.user_id = a.user_id))
            LEFT JOIN users u ON (r.user_id IS NOT NULL AND r.user_id != '' AND r.user_id = u.id)
            LEFT JOIN users u2 ON (a.user_id IS NOT NULL AND a.user_id != '' AND a.user_id = u2.id)
            WHERE r.exam_id IN (${placeholders})
            GROUP BY r.id, r.user_id, r.student_name, r.student_class, r.score, r.correct_count, r.total_questions, r.time_taken, r.exam_name, r.exam_id, r.created_at, r.loai_thi_sinh, r.cheat_warning_count, r.ai_grading_summary
            ORDER BY r.created_at DESC, r.id DESC
            ${paginationClause}
          `, examIds);
          rows = results || [];
        } catch (err) {
          // A failed JOIN must never trigger an unscoped fallback.
          const { results } = await executeSqlQuery(
            `SELECT ${fallbackColumns} FROM results r WHERE r.exam_id IN (${placeholders})
             ORDER BY r.created_at DESC, r.id DESC ${paginationClause}`, examIds);
          rows = results || [];
        }
        return sendPaginatedResults(rows, includeDetails);
      }

      if (isStudent) {
        const studentUserId = user.user_id || user.id;
        const studentAccountId = user.id;
        let rows: any[] = [];
        try {
          const { results } = await executeSqlQuery(`
            SELECT ${columns} 
            FROM results r
            LEFT JOIN accounts a ON (r.user_id IS NOT NULL AND r.user_id != '' AND (r.user_id = a.id OR r.user_id = a.user_id))
            LEFT JOIN users u ON (r.user_id IS NOT NULL AND r.user_id != '' AND r.user_id = u.id)
            LEFT JOIN users u2 ON (a.user_id IS NOT NULL AND a.user_id != '' AND a.user_id = u2.id)
            WHERE (r.user_id = ? OR r.user_id = ?) 
            GROUP BY r.id, r.user_id, r.student_name, r.student_class, r.score, r.correct_count, r.total_questions, r.time_taken, r.exam_name, r.exam_id, r.created_at, r.loai_thi_sinh, r.cheat_warning_count, r.ai_grading_summary
            ORDER BY r.created_at DESC, r.id DESC 
            ${paginationClause}
          `, [studentAccountId, studentUserId]);
          rows = results || [];
        } catch (err) {
          const { results } = await executeSqlQuery(
            `SELECT ${fallbackColumns} FROM results WHERE (user_id = ? OR user_id = ?) ORDER BY created_at DESC, id DESC ${paginationClause}`,
            [studentAccountId, studentUserId]
          );
          rows = results || [];
        }
        return sendPaginatedResults(rows, includeDetails);
      }

      return sendPaginatedResults([], includeDetails);
    } catch (e: any) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("GET /api/results error::", e);
      return res.status(500).json({ data: [], error: e.message || 'Lỗi server' });
    }
  });

  app.put("/api/results", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const user = verifyJWTSync(authHeader.substring(7), await getServerSecret());
      if (!user) return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });

      const isAdmin = checkIsAdmin(user);
      const isTeacher = checkIsTeacherOrAdmin(user);
      if (!isTeacher) return res.status(403).json({ error: "Chỉ giáo viên hoặc admin mới có quyền chỉnh sửa/chấm lại điểm" });

      const { id, score, correct_count, details } = req.body || {};
      if (!id) return res.status(400).json({ error: "Thiếu ID bài thi cần cập nhật" });

      if (isTeacher && !isAdmin) {
        const { results: checkRows } = await executeSqlQuery(
          "SELECT r.id FROM results r JOIN exam_configs e ON (r.exam_id = e.id) WHERE r.id = ? AND e.creator_id = ?",
          [id, user.id]
        );
        if (!checkRows || checkRows.length === 0) {
          return res.status(403).json({ error: "Bạn không có quyền cập nhật điểm cho bài thi này" });
        }
      }

      const safeDetails = typeof details === 'object' ? JSON.stringify(details) : (details || '[]');
      await executeSqlQuery(
        "UPDATE results SET score = ?, correct_count = ?, details = ? WHERE id = ?",
        [Number(score) || 0, Number(correct_count) || 0, safeDetails, id]
      );

      return res.json({ success: true, message: "Đã cập nhật điểm thành công", error: null });
    } catch (e: any) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("PUT /api/results error::", e);
      return res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });


  // Dedicated, strictly scoped deletion for a single exam's saved submissions.
  app.post("/api/results/deletion-targets", async (req, res) => {
    res.set('Cache-Control','no-store');
    try {
      const bearer = req.headers.authorization || '';
      if (!bearer.startsWith('Bearer ') || !bearer.slice(7).trim())
        return res.status(401).json({error:'Vui lòng đăng nhập.',code:'AUTH_REQUIRED'});
      const claims = verifyJWTSync(bearer.slice(7), await getServerSecret());
      if (!claims) return res.status(401).json({error:'Phiên đăng nhập không hợp lệ.',code:'AUTH_REQUIRED'});
      const live = await executeSqlQuery(
        'SELECT a.id, a.user_id, a.password, a.role, a.is_active, a.expiry_date, u.target_audience, u.is_active AS profile_active, u.expiry_date AS profile_expiry_date FROM accounts a LEFT JOIN users u ON u.id = COALESCE(a.user_id, a.id) WHERE a.id = ? LIMIT 1',
        [claims.id]
      );
      const user = resolveLiveExamResultsActor(claims,live.results?.[0]);
      const adapter = {
        all: async (sql:string, params:unknown[]) => (await executeSqlQuery(sql,params)).results || [],
        first: async (sql:string, params:unknown[]) => (await executeSqlQuery(sql,params)).results?.[0] || null
      };
      return res.json(await listExamResultsDeletionTargets(adapter,user,req.body?.examName));
    } catch(err:any) {
      if (err instanceof ExamResultsDeletionError)
        return res.status(err.status).json({error:err.message,code:err.code});
      console.error('POST /api/results/deletion-targets failed:',err);
      return res.status(503).json({error:'Không thể xác minh danh sách mã đề.',code:'TARGET_LOOKUP_FAILED'});
    }
  });

  app.post("/api/results/delete-by-exam", async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const bearer = req.headers.authorization || '';
      if (!bearer.startsWith('Bearer ') || !bearer.slice(7).trim()) {
        return res.status(401).json({ error: 'Vui lòng đăng nhập trước khi xóa kết quả.', code: 'AUTH_REQUIRED' });
      }
      // The global /api auth middleware above also verifies the live account
      // status, password and role on every request.
      const claims = verifyJWTSync(bearer.slice(7), await getServerSecret());
      if (!claims) return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.', code: 'AUTH_REQUIRED' });
      const live = await executeSqlQuery(
        'SELECT a.id, a.user_id, a.password, a.role, a.is_active, a.expiry_date, u.target_audience, u.is_active AS profile_active, u.expiry_date AS profile_expiry_date FROM accounts a LEFT JOIN users u ON u.id = COALESCE(a.user_id, a.id) WHERE a.id = ? LIMIT 1',
        [claims.id]
      );
      const user = resolveLiveExamResultsActor(claims, live.results?.[0]);
      const adapter = {
        first: async (sql: string, params: unknown[]) => {
          const result = await executeSqlQuery(sql, params);
          return result.results?.[0] || null;
        },
        run: async (sql: string, params: unknown[]) => {
          const result = await executeSqlQuery(sql, params);
          return { changes: Number(result.changes) };
        }
      };
      return res.json(await processExamResultsDeletion(adapter, user, req.body));
    } catch (err: any) {
      if (err instanceof ExamResultsDeletionError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      console.error('POST /api/results/delete-by-exam failed:', err);
      return res.status(500).json({
        error: 'Không thể xử lý xóa kết quả đề thi. Dữ liệu cần được kiểm tra lại.',
        code: 'DELETE_FAILED'
      });
    }
  });

  app.delete("/api/results", async(req,res)=>{
    try {
      const header=req.headers.authorization||'';
      if(!header.startsWith('Bearer '))return res.status(401).json({error:'Phiên đăng nhập không hợp lệ'});
      const user=verifyJWTSync(header.slice(7),await getServerSecret());
      if(!user)return res.status(401).json({error:'Phiên đăng nhập không hợp lệ'});
      if(req.query.clearAll==='true'){
        if(!checkIsAdmin(user))return res.status(403).json({error:'Chỉ quản trị viên được xóa tất cả'});
        await executeSqlQuery('DELETE FROM results',[]);
        return res.json({success:true,error:null});
      }
      const ids=req.query.id?[String(req.query.id)]:Array.isArray(req.body?.ids)?req.body.ids:req.body?.id?[req.body.id]:[];
      const operation=buildRankingResultsDeletion(ids,user);
      const response=await executeSqlQuery(operation.sql,operation.params);
      if(Number(response.changes)!==operation.count)return res.status(409).json({error:'Không xác nhận được quyền hoặc dữ liệu đã thay đổi, chưa xóa kết quả.',code:'RESULT_SCOPE_CHANGED'});
      return res.json({success:true,deletedCount:response.changes,error:null});
    }catch(err:any){
      if(err instanceof RankingResultDeleteError)return res.status(err.status).json({error:err.message,code:err.code});
      console.error('Result deletion failed',err);
      return res.status(500).json({error:'Không thể xóa kết quả.'});
    }
  });

  // Public, tenant-scoped appearance only: never expose account or AI settings.
  app.get('/api/bootstrap', async (_req, res) => {
    try {
      const query = await executeSqlQuery(`
        SELECT app_title, author_info, question_font_size, answer_font_size,
               display_mode, show_results_details, allow_ranking_details,
               immediate_feedback, sq_case_sensitive, sq_punctuation_sensitive, qr_code_url
        FROM app_settings WHERE id = 1
      `, []);
      const row: any = query.results?.[0] || {};
      let header: any = {};
      try {
        const result = await executeSqlQuery(`
          SELECT header_display_mode,header_banner_url,header_banner_alt
          FROM app_settings WHERE id = 1
        `, []);
        header = result.results?.[0] || {};
      } catch {}
      const brand = normalizedHeaderBranding(header);
      res.set('Cache-Control','private, no-store, max-age=0');
      return res.json({data:{
        app_title:row.app_title||'HỆ THỐNG KIỂM TRA TRỰC TUYẾN',
        author_info:row.author_info||'',
        question_font_size:row.question_font_size??18,
        answer_font_size:row.answer_font_size??16,
        display_mode:row.display_mode||'single',
        show_results_details:row.show_results_details??true,
        allow_ranking_details:row.allow_ranking_details??true,
        immediate_feedback:row.immediate_feedback??false,
        sq_case_sensitive:row.sq_case_sensitive??false,
        sq_punctuation_sensitive:row.sq_punctuation_sensitive??false,
        qr_code_url:row.qr_code_url||'',
        header_display_mode:brand.mode,
        header_banner_url:brand.url,
        header_banner_alt:brand.alt
      },error:null});
    } catch {
      return res.status(503).json({data:null,error:'Không thể tải cấu hình giao diện.'});
    }
  });

  app.get("/api/settings", async (req, res) => {
    try {
      let data: any = null;
      try {
        const query = `SELECT * FROM app_settings WHERE id = 1`;
        const result = await executeSqlQuery(query, []);
        data = (result.results && result.results.length > 0) ? result.results[0] : null;
      } catch (dbErr: any) {
        if (dbErr.message && dbErr.message.includes("does not exist")) {
          try {
            await executeSqlQuery(`
              CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY,
                show_results_details INTEGER DEFAULT 1,
                allow_ranking_details INTEGER DEFAULT 1,
                show_delete_selected_ranking INTEGER DEFAULT 0,
                immediate_feedback INTEGER DEFAULT 1,
                sq_case_sensitive INTEGER DEFAULT 0,
                sq_punctuation_sensitive INTEGER DEFAULT 0,
                question_font_size INTEGER DEFAULT 18,
                answer_font_size INTEGER DEFAULT 16,
                display_mode TEXT DEFAULT 'standard',
                app_title TEXT DEFAULT 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN',
                author_info TEXT DEFAULT 'Phát triển bởi: Hồ Hữu Thế - 0935 078 895',
                ai_prompt TEXT DEFAULT '',
                ai_appraise_prompt TEXT DEFAULT '',
                ai_grading_key TEXT DEFAULT ''
              )
            `, []);
            await executeSqlQuery(`
              INSERT INTO app_settings (
                id, show_results_details, allow_ranking_details, show_delete_selected_ranking,
                immediate_feedback, sq_case_sensitive, sq_punctuation_sensitive,
                question_font_size, answer_font_size, display_mode, app_title, author_info,
                ai_prompt, ai_appraise_prompt, ai_grading_key
              ) VALUES (1, 1, 1, 1, 1, 0, 0, 18, 16, 'standard', 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN', 'Phát triển bởi: Hồ Hữu Thế - 0935 078 895', '', '', '')
              ON CONFLICT (id) DO NOTHING
            `, []);
            const retryRes = await executeSqlQuery(`SELECT * FROM app_settings WHERE id = 1`, []);
            data = (retryRes.results && retryRes.results.length > 0) ? retryRes.results[0] : null;
          } catch (createErr) {}
        }
      }

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
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          const token = authHeader.substring(7);
          const user = verifyJWTSync(token, await getServerSecret());
          if (checkIsAdmin(user)) {
            isAdmin = true;
          }
        }
        if (!isAdmin) {
          data.ai_grading_key = "";
        }
      }

      return res.status(200).json({ data, error: null });
    } catch (e: any) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        return res.status(400).json({ error: e.message });
      }
      console.error("Settings GET Error::", e);
      return res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });

  app.get("/api/download-neon-sql", (req, res) => {
    const filePath = path.join(process.cwd(), "neon_database_backup.sql");
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="neon_database_backup.sql"');
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.sendFile(filePath);
    }
    return res.status(404).json({ error: "File backup SQL chưa được tạo." });
  });

  app.get("/api/download-questions-sql", (req, res) => {
    const filePath = path.join(process.cwd(), "questions_backup.sql");
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="questions_backup.sql"');
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.sendFile(filePath);
    }
    return res.status(404).json({ error: "File backup câu hỏi SQL chưa được tạo." });
  });

  app.get("/api/download-indexes-sql", (req, res) => {
    const filePath = path.join(process.cwd(), "create_all_indexes.sql");
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="create_all_indexes.sql"');
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.sendFile(filePath);
    }
    return res.status(404).json({ error: "File chỉ mục SQL chưa được tạo." });
  });

  app.put("/api/settings", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return res.status(401).json({ error: "Unauthorized" });
      }
      const token = authHeader.substring(7);
      const user = verifyJWTSync(token, await getServerSecret());
      if (!checkIsAdmin(user)) {
          return res.status(403).json({ error: "Chỉ quản trị viên mới có quyền cập nhật cấu hình hệ thống" });
      }

      // Fetch current settings for partial update support
      let currentSettings: any = null;
      try {
        const curRes = await executeSqlQuery(`SELECT * FROM app_settings WHERE id = 1`, []);
        currentSettings = (curRes.results && curRes.results.length > 0) ? curRes.results[0] : null;
      } catch (e) {}
      
      const { 
        show_results_details, allow_ranking_details, show_delete_selected_ranking, 
        immediate_feedback, sq_case_sensitive, sq_punctuation_sensitive, 
        question_font_size, answer_font_size, display_mode, app_title, 
        author_info, ai_prompt, ai_appraise_prompt, ai_grading_key,
        qr_code_url
      } = req.body;

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
      
      const updateQuery = `
        UPDATE app_settings 
        SET show_results_details = ?, allow_ranking_details = ?, show_delete_selected_ranking = ?, 
            immediate_feedback = ?, sq_case_sensitive = ?, sq_punctuation_sensitive = ?, 
            question_font_size = ?, answer_font_size = ?, display_mode = ?, 
            app_title = ?, author_info = ?, ai_prompt = ?, ai_appraise_prompt = ?, ai_grading_key = ?,
            qr_code_url = ?
        WHERE id = 1
      `;
      
      await executeSqlQuery(updateQuery, [
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
      ]);

      return res.status(200).json({ data: { success: true }, error: null });
    } catch (e: any) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("Settings PUT Error::", e);
      return res.status(500).json({ error: e.message || 'Lỗi server' });
    }
  });

  // API /api/db has been decommissioned & disabled in favor of dedicated RESTful endpoints
  app.all("/api/db", (req, res) => {
    return res.status(410).json({
      error: "Cổng API thô /api/db đã được đóng hoàn toàn theo kiến trúc bảo mật mới. Vui lòng sử dụng các API nghiệp vụ chuyên biệt."
    });
  });

  // Gemini Proxy API
  app.post("/api/ai/generate", async (req, res) => {
    try {
      // BẢO MẬT: Bắt buộc phải có tài khoản Giáo viên hoặc Admin
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return res.status(401).json({ error: "Bạn chưa đăng nhập hoặc phiên làm việc đã hết hạn. Vui lòng đăng nhập lại." });
      }
      const token = authHeader.substring(7);
      const user = verifyJWTSync(token, await getServerSecret());
      if (!user) {
          return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại." });
      }

      const isTeacherOrAdmin = user.role === 'admin' || user.role === 'teacher' || 
                               user.target_audience === 'Giáo viên' || user.target_audience === 'Quản trị viên' ||
                               String(user.username).toLowerCase() === 'admin';
      if (!isTeacherOrAdmin) {
          return res.status(403).json({ error: "Chỉ Giáo viên hoặc Quản trị viên mới được phép sử dụng tính năng tạo câu hỏi bằng AI." });
      }

      const { contents, config, model, apiKey: clientApiKey } = req.body;
      const rawKeyInput = (clientApiKey && typeof clientApiKey === 'string') ? clientApiKey.trim() : "";
      const keys = rawKeyInput.split(/\s+/).map((k: string) => k.trim()).filter((k: string) => k.length > 5 && !k.includes("••••••••") && !k.includes("YOUR_"));

      if (keys.length === 0) {
        return res.status(400).json({ error: "Vui lòng nhập Gemini API Key cá nhân của bạn để sử dụng tính năng tạo câu hỏi bằng AI." });
      }

      // Model list with automatic fallbacks in case of high demand / spikes / temporary unavailability
      const fallbackModels = [
        "gemini-3.8-flash",
        "gemini-3.1-flash-lite",
        "gemini-flash-latest",
        "gemini-3.5-flash"
      ];

      // If user specified a valid model not in list, try it first
      if (model && !["gemini-1.5-flash", "gemini-3-flash-preview"].includes(model) && !fallbackModels.includes(model)) {
        fallbackModels.unshift(model);
      }

      // Normalize contents to array if object passed
      const normalizedContents = Array.isArray(contents)
        ? contents
        : (contents && typeof contents === 'object' && contents.parts ? [contents] : contents);

      let lastError: any = null;
      let textOutput = "";
      let success = false;
      const keyReports: Array<{ index: number; maskedKey: string; reason: string }> = [];

      for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
        const currentKey = keys[keyIdx];
        const maskedKey = currentKey.length > 10 ? `${currentKey.substring(0, 6)}...${currentKey.substring(currentKey.length - 4)}` : currentKey;
        let keyFailed = false;

        const aiInstance = new GoogleGenAI({ 
          apiKey: currentKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build'
            }
          }
        });

        for (const m of fallbackModels) {
          try {
            console.log(`[Gemini Proxy] Key ${keyIdx + 1}/${keys.length} (${maskedKey}) - Model: ${m}`);
            const apiResponse = await aiInstance.models.generateContent({
              model: m,
              contents: normalizedContents,
              config
            });
            textOutput = apiResponse.text || "";
            success = true;
            console.log(`[Gemini Proxy] Generation succeeded with key ${keyIdx + 1} and model ${m}`);
            break;
          } catch (err: any) {
            lastError = err;
            const errMsg = err?.message || String(err);
            const errLower = errMsg.toLowerCase();
            console.warn(`[Gemini Proxy] Key ${keyIdx + 1} with model ${m} failed: ${errMsg}`);

            if (errLower.includes("quota") || errLower.includes("resource_exhausted") || err?.status === 429 ||
                errLower.includes("api key not valid") || errLower.includes("invalid") || err?.status === 401 || err?.status === 403 ||
                errLower.includes("expired") || errLower.includes("limit")) {
              keyFailed = true;
              keyReports.push({ index: keyIdx + 1, maskedKey, reason: errMsg });
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }

        if (success) {
          break;
        }

        if (keyFailed) {
          console.warn(`[Gemini Proxy Switcher]: Key ${keyIdx + 1}/${keys.length} (${maskedKey}) gặp sự cố. Tự động chuyển key tiếp theo...`);
          continue;
        }
      }

      if (!success) {
        const rawMsg = lastError?.message || String(lastError);
        if (rawMsg.includes("User location is not supported") || rawMsg.includes("FAILED_PRECONDITION")) {
          return res.status(400).json({
            error: "Vị trí mạng (IP) hiện tại chưa được Google AI hỗ trợ (User location is not supported). Vui lòng bật VPN / WARP 1.1.1.1 trên máy hoặc tạo khóa API mới từ Google AI Studio (https://aistudio.google.com/app/apikey).",
            keyReports
          });
        }
        const errorDetail = keys.length > 1
          ? `Tất cả ${keys.length} API Key trong danh sách đều không thể sử dụng (hết hạn mức, quá quota hoặc lỗi). Chi tiết lỗi cuối: ${rawMsg}`
          : (rawMsg || "Không thể tạo câu hỏi lúc này. Vui lòng kiểm tra lại API Key.");
        return res.status(429).json({ error: errorDetail, keyReports });
      }

      res.json({ text: textOutput });
    } catch (error: any) {
      console.error("[Gemini Proxy Error]:", error);
      res.status(500).json({ 
        error: error.message || "Lỗi không xác định khi kết nối với Gemini API." 
      });
    }
  });

  // Helper functions to clean and extract R2 credentials from user configurations automatically
  function cleanR2AccountId(id: string): string {
    let cleaned = id.trim();
    if (cleaned.includes("dash.cloudflare.com/")) {
      const parts = cleaned.split("dash.cloudflare.com/");
      if (parts[1]) {
        cleaned = parts[1].split("/")[0];
      }
    }
    cleaned = cleaned.replace(/^https?:\/\//i, "");
    if (cleaned.includes("/")) {
      cleaned = cleaned.split("/")[0];
    }
    return cleaned.trim();
  }

  function cleanR2BucketName(name: string): string {
    let cleaned = name.trim();
    if (cleaned.includes("/buckets/")) {
      const parts = cleaned.split("/buckets/");
      if (parts[1]) {
        cleaned = parts[1].split("/")[0];
      }
    }
    cleaned = cleaned.replace(/^\/|\/$/g, "");
    if (cleaned.includes("?")) {
      cleaned = cleaned.split("?")[0];
    }
    return cleaned.trim();
  }

  // Helper to load or write active connection profile
  interface R2WorkingConfig {
    successfulCombo: "original" | "swapped" | "healed";
    healedAccountId?: string;
    healedAccessKeyId?: string;
    testedAt: string;
  }

  function loadSuccessfulR2Combo(): R2WorkingConfig | null {
    try {
      const configPath = path.join(process.cwd(), "r2_working_config.json");
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, "utf8");
        return JSON.parse(raw) as R2WorkingConfig;
      }
    } catch (e) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("[loadSuccessfulR2Combo Error]::", e);
    }
    return null;
  }

  function saveSuccessfulR2Combo(combo: "original" | "swapped" | "healed", extra?: { healedAccountId?: string; healedAccessKeyId?: string }) {
    try {
      const configPath = path.join(process.cwd(), "r2_working_config.json");
      fs.writeFileSync(configPath, JSON.stringify({
        successfulCombo: combo,
        healedAccountId: extra?.healedAccountId,
        healedAccessKeyId: extra?.healedAccessKeyId,
        testedAt: new Date().toISOString()
      }, null, 2), "utf8");
    } catch (e) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("[saveSuccessfulR2Combo Error]::", e);
    }
  }

  function extractUrlsFromJson(jsonStr: string): string[] {
    const urls: string[] = [];
    try {
      const obj = JSON.parse(jsonStr);
      const scan = (val: any) => {
        if (typeof val === "string") {
          if (val.trim().startsWith("http")) {
            urls.push(val.trim());
          }
        } else if (val && typeof val === "object") {
          for (const k in val) {
            if (Object.prototype.hasOwnProperty.call(val, k)) {
              scan(val[k]);
            }
          }
        }
      };
      scan(obj);
    } catch (e) {
      console.warn("[extractUrlsFromJson Warning]: Không thể parse JSON để dọn hình ảnh.", e);
    }
    return urls;
  }

  function getR2KeyFromUrl(url: string, publicUrlConfig: string, bucketName: string, accountId: string): string | null {
    if (!url || !url.startsWith("http")) return null;
    
    // Kiểm tra xem URL có thuộc về R2 hay không
    const isR2Url = url.includes(".r2.dev") || 
                     url.includes(".r2.cloudflarestorage.com") || 
                     (publicUrlConfig && url.includes(publicUrlConfig.replace(/^https?:\/\//, "")));
                     
    if (!isR2Url) return null;
    
    try {
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname;
      // Loại bỏ dấu gạch chéo đầu tiên để lấy Key R2
      const key = pathname.startsWith("/") ? pathname.substring(1) : pathname;
      if (key && key.trim() !== "") {
        return decodeURIComponent(key);
      }
    } catch (e) {
      if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        // quota error logged as 503
        return res.status(400).json({ error: e.message });
      }
      console.error("[getR2KeyFromUrl Error]::", e);
    }
    return null;
  }

  async function deleteR2ImageByKey(key: string): Promise<boolean> {
    try {
      let r2AccessKeyId = getConfig("CLOUDFLARE_R2_ACCESS_KEY_ID");
      const r2SecretAccessKey = getConfig("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
      
      const rawBucketName = getConfig("CLOUDFLARE_R2_BUCKET_NAME");
      let r2BucketName = cleanR2BucketName(rawBucketName);
      const rawAccountId = getConfig("CLOUDFLARE_R2_ACCOUNT_ID");
      let r2AccountId = cleanR2AccountId(rawAccountId);

      const r2Config = loadSuccessfulR2Combo();
      if (r2Config) {
        if (r2Config.successfulCombo === "swapped") {
          const temp = r2AccountId;
          r2AccountId = r2AccessKeyId;
          r2AccessKeyId = temp;
        } else if (r2Config.successfulCombo === "healed") {
          if (r2Config.healedAccountId) {
            r2AccountId = r2Config.healedAccountId;
          }
          if (r2Config.healedAccessKeyId) {
            r2AccessKeyId = r2Config.healedAccessKeyId;
          }
        }
      }

      const isR2Configured = r2AccessKeyId !== "" && !r2AccessKeyId.includes("YOUR_") &&
                             r2SecretAccessKey !== "" && !r2SecretAccessKey.includes("YOUR_") &&
                             r2BucketName !== "" && !r2BucketName.includes("YOUR_") &&
                             r2AccountId !== "" && !r2AccountId.includes("YOUR_");

      if (!isR2Configured) {
        console.log(`[R2 Auto-Clean Bypass]: R2 chưa cấu hình đầy đủ. Bỏ qua key: ${key}`);
        return false;
      }

      console.log(`[R2 Auto-Clean Action]: Đang tiến hành xóa file "${key}" trên Bucket: ${r2BucketName}`);

      const s3 = new S3Client({
        region: "auto",
        endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: r2AccessKeyId,
          secretAccessKey: r2SecretAccessKey,
        },
        forcePathStyle: true,
        requestHandler: new NodeHttpHandler({
          httpsAgent: new https.Agent({
            rejectUnauthorized: true,
            keepAlive: false,
          }),
        }),
      });

      await s3.send(new DeleteObjectCommand({
        Bucket: r2BucketName,
        Key: key,
      }));

      console.log(`[R2 Auto-Clean Action Success]: Đã xóa thành công file "${key}" khỏi Cloudflare R2.`);
      return true;
    } catch (error: any) {
      console.error(`[R2 Auto-Clean Action Error] Key: ${key}. Chi tiết:`, error?.message || error);
      return false;
    }
  }

  // Shared Cloudflare Pages handlers for admin banner routes, bridged through
  // current account state and the verified tenant request path in local Express.
  const callSystemBannerHandler = async (req: any, res: any, handler: any) => {
    try {
      const headers = new Headers();
      for (const [name,value] of Object.entries(req.headers || {})) {
        if (Array.isArray(value)) for (const part of value) headers.append(name,String(part));
        else if (value !== undefined) headers.set(name,String(value));
      }
      const raw = String(req.headers.authorization || '');
      if (raw.startsWith('Bearer ')) {
        const token = raw.slice(7);
        const secret = await getServerSecret();
        const decoded: any = verifyJWTSync(token,secret);
        if (decoded?.auth_state && decoded?.id) {
          const row = (await executeSqlQuery(`
            SELECT a.id,a.user_id,a.username,a.password,a.role,a.is_active,a.expiry_date,
                   u.full_name,u.target_audience,u.donvi,u.lop,u.is_vip AS profile_vip,
                   u.is_active AS profile_active,u.expiry_date AS profile_expiry_date
            FROM accounts a LEFT JOIN users u ON u.id=COALESCE(a.user_id,a.id)
            WHERE a.id=? LIMIT 1
          `,[decoded.id])).results?.[0];
          if (!row || !getAccountAccessStatus(row).allowed)
            return res.status(401).json({error:'Phiên đăng nhập không còn hiệu lực.'});
          const expected=crypto.createHash('sha256').update(accountSessionMaterial(row)).digest('hex');
          if(expected!==decoded.auth_state)
            return res.status(401).json({error:'Phiên đăng nhập đã thay đổi.'});
          const tenantKey=tenantStorage.getStore()?.databaseUrl||'';
          const signed=await signCloudflareAuthSession(row,{
            id:row.id,user_id:row.user_id||row.id,username:row.username,
            role:row.role,target_audience:row.target_audience||''
          },secret,tenantKey);
          headers.set('Authorization','Bearer '+signed);
        }
      }
      headers.set('Content-Type','application/json');
      const host=req.get('host')||'localhost:'+PORT;
      const webReq=new Request('https://'+host+(req.originalUrl||req.url),{
        method:req.method,headers,body:JSON.stringify(req.body||{})
      });
      const env={
        ...process.env,
        CLOUDFLARE_R2_ACCESS_KEY_ID:getConfig('CLOUDFLARE_R2_ACCESS_KEY_ID')||process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
        CLOUDFLARE_R2_SECRET_ACCESS_KEY:getConfig('CLOUDFLARE_R2_SECRET_ACCESS_KEY')||process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
        CLOUDFLARE_R2_BUCKET_NAME:getConfig('CLOUDFLARE_R2_BUCKET_NAME')||process.env.CLOUDFLARE_R2_BUCKET_NAME,
        CLOUDFLARE_R2_ACCOUNT_ID:getConfig('CLOUDFLARE_R2_ACCOUNT_ID')||process.env.CLOUDFLARE_R2_ACCOUNT_ID,
        CLOUDFLARE_R2_PUBLIC_URL:getConfig('CLOUDFLARE_R2_PUBLIC_URL')||process.env.CLOUDFLARE_R2_PUBLIC_URL
      };
      const result=await handler({request:webReq,env} as any);
      res.status(result.status);
      result.headers.forEach((v:string,k:string)=>{if(k.toLowerCase()!=='content-length')res.setHeader(k,v);});
      return res.send(await result.text());
    } catch (e:any) {
      console.error('[Header branding local adapter]',e?.message||e);
      return res.status(500).json({error:'Không thể xử lý cấu hình banner an toàn.'});
    }
  };
  app.post('/api/header-banner', (req,res) => { void callSystemBannerHandler(req,res,uploadSystemBanner); });
  app.put('/api/header-banner', (req,res) => { void callSystemBannerHandler(req,res,saveSystemBanner); });

  // Image upload uses the same hardened handler as Cloudflare production.
  app.post("/api/upload-image", async (req, res) => {
    try {
      const protocol=req.protocol||'http';
      const host=req.get('host')||`localhost:${PORT}`;
      const webHeaders=new Headers();
      for(const [name,value] of Object.entries(req.headers||{})){
        if(value===undefined)continue;
        if(Array.isArray(value)){for(const item of value)webHeaders.append(name,String(item));}
        else webHeaders.set(name,String(value));
      }

      const rawBearer=String(req.headers.authorization||'');
      if(rawBearer.startsWith('Bearer ')){
        const rawToken=rawBearer.slice(7);
        const secret=await getServerSecret();
        const decoded:any=verifyJWTSync(rawToken,secret);
        if(decoded?.auth_state && decoded?.id){
          const row=(await executeSqlQuery(`
            SELECT a.id,a.user_id,a.username,a.password,a.role,a.is_active,a.expiry_date,
                   u.full_name,u.target_audience,u.donvi,u.lop,u.is_vip AS profile_vip,
                   u.is_active AS profile_active,u.expiry_date AS profile_expiry_date
            FROM accounts a LEFT JOIN users u ON u.id=COALESCE(a.user_id,a.id)
            WHERE a.id=? LIMIT 1
          `,[decoded.id])).results?.[0];
          if(!row||!getAccountAccessStatus(row).allowed){
            return res.status(401).json({error:'Phiên đăng nhập không còn hiệu lực.'});
          }
          const expected=crypto.createHash('sha256').update(accountSessionMaterial(row)).digest('hex');
          if(expected!==decoded.auth_state){
            return res.status(401).json({error:'Phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại.'});
          }
          const tenantKey=tenantStorage.getStore()?.databaseUrl||'';
          const bridged=await signCloudflareAuthSession(row,{
            id:row.id,user_id:row.user_id||row.id,username:row.username,
            role:row.role,target_audience:row.target_audience||''
          },secret,tenantKey);
          webHeaders.set('authorization','Bearer '+bridged);
        }
      }
      webHeaders.set('content-type','application/json');
      const webRequest=new Request(`${protocol}://${host}${req.originalUrl||req.url||'/api/upload-image'}`,{
        method:'POST',headers:webHeaders,body:JSON.stringify(req.body||{})
      });
      const uploadEnv={
        ...process.env,
        CLOUDFLARE_R2_ACCESS_KEY_ID:getConfig("CLOUDFLARE_R2_ACCESS_KEY_ID")||process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
        CLOUDFLARE_R2_SECRET_ACCESS_KEY:getConfig("CLOUDFLARE_R2_SECRET_ACCESS_KEY")||process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
        CLOUDFLARE_R2_BUCKET_NAME:getConfig("CLOUDFLARE_R2_BUCKET_NAME")||process.env.CLOUDFLARE_R2_BUCKET_NAME,
        CLOUDFLARE_R2_ACCOUNT_ID:getConfig("CLOUDFLARE_R2_ACCOUNT_ID")||process.env.CLOUDFLARE_R2_ACCOUNT_ID,
        CLOUDFLARE_R2_PUBLIC_URL:getConfig("CLOUDFLARE_R2_PUBLIC_URL")||process.env.CLOUDFLARE_R2_PUBLIC_URL
      };
      const response=await hardenedUploadImageHandler({request:webRequest,env:uploadEnv} as any);
      res.status(response.status);
      response.headers.forEach((value,name)=>{if(name.toLowerCase()!=='content-length')res.setHeader(name,value);});
      return res.send(await response.text());
    } catch(error:any) {
      console.error('Local hardened /api/upload-image adapter error:',error?.message||error);
      return res.status(500).json({error:'Không thể tải ảnh bằng engine bảo mật thống nhất.'});
    }
  });

  // Dedicated Test Endpoint to analyze and verify Cloudflare R2 connection
  app.post("/api/test-r2", async (req, res) => {
    const rawBucketName = getConfig("CLOUDFLARE_R2_BUCKET_NAME");
    const cleanBucket = cleanR2BucketName(rawBucketName);

    const rawAccountId = getConfig("CLOUDFLARE_R2_ACCOUNT_ID");
    const cleanAccount = cleanR2AccountId(rawAccountId);

    const rawAccessKeyId = getConfig("CLOUDFLARE_R2_ACCESS_KEY_ID");
    const cleanAccessKey = rawAccessKeyId;

    const r2SecretAccessKey = getConfig("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
    let r2PublicUrl = getConfig("CLOUDFLARE_R2_PUBLIC_URL");

    const diagnosticPayload = {
      bucket: cleanBucket,
      accountId: cleanAccount,
      accessKeyId: cleanAccessKey ? `${cleanAccessKey.substring(0, 6)}...` : "none",
      hasSecretKey: r2SecretAccessKey !== "",
      publicUrl: r2PublicUrl || "calculate_dynamically"
    };

    if (!cleanAccessKey || !r2SecretAccessKey || !cleanBucket || !cleanAccount) {
      return res.status(400).json({
        status: "failed",
        message: "Chưa cấu hình đầy đủ biến môi trường Cloudflare R2 trong Cài đặt (Settings)!",
        details: diagnosticPayload
      });
    }

    // Generate a tiny 1-pixel transparent PNG image as Base64 payload for testing
    const testBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const testBuffer = Buffer.from(testBase64, "base64");
    const testFilename = `test-connection-${Date.now()}.png`;

    // Helper utility to attempt a standalone S3 / R2 upload
    const attemptUpload = async (accId: string, keyId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const testS3 = new S3Client({
          region: "auto",
          endpoint: `https://${accId}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: keyId,
            secretAccessKey: r2SecretAccessKey,
          },
          forcePathStyle: true,
          requestHandler: new NodeHttpHandler({
            httpsAgent: new https.Agent({
              rejectUnauthorized: true,
              keepAlive: false,
            }),
          }),
        });

        await testS3.send(new PutObjectCommand({
          Bucket: cleanBucket,
          Key: `luuhinhnh/${testFilename}`,
          Body: testBuffer,
          ContentType: "image/png",
        }));

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    };

    console.log("--- BẮT ĐẦU CHẨN ĐOÁN KẾT NỐI KHOA HỌC CLOUDFLARE R2 ---");
    
    // Test Combination 1: Original profile values
    console.log(`[Diagnostic] Combo 1 (Cấu hình gốc): Account ID="***", Access Key ID="***"`);
    const combo1Result = await attemptUpload(cleanAccount, cleanAccessKey);

    if (combo1Result.success) {
      console.log(">>> [Diagnostic] Combo 1 THÀNH CÔNG RỰC RỠ!");
      saveSuccessfulR2Combo("original");

      let finalPublicUrl = r2PublicUrl;
      if (!finalPublicUrl) {
        finalPublicUrl = `https://${cleanBucket}.${cleanAccount}.r2.dev`;
      }
      if (finalPublicUrl.endsWith("/")) {
        finalPublicUrl = finalPublicUrl.slice(0, -1);
      }
      const publicFileUrl = `${finalPublicUrl}/luuhinhnh/${testFilename}`;

      console.log(">>> URL ảnh có sẵn tại:", publicFileUrl);
      return res.json({
        status: "success",
        message: "Kết nối Cloudflare R2 THÀNH CÔNG bằng cấu hình nguyên trạng của bạn!",
        fileUrl: publicFileUrl,
        combinationUsed: "original",
        details: diagnosticPayload
      });
    }

    console.log(`>>> [Diagnostic] Combo 1 THẤT BẠI. Lỗi: ${combo1Result.error}`);

    // Test Combination 2: Swapped Account ID and Access Key ID
    console.log(`[Diagnostic] Combo 2 (Đổi chéo ID & Key): Account ID="***", Access Key ID="***"`);
    const combo2Result = await attemptUpload(cleanAccessKey, cleanAccount);

    if (combo2Result.success) {
      console.log(">>> [Diagnostic] Combo 2 (Hoán đổi) THÀNH CÔNG RỰC RỠ!");
      saveSuccessfulR2Combo("swapped");

      let finalPublicUrl = r2PublicUrl;
      if (!finalPublicUrl) {
        finalPublicUrl = `https://${cleanBucket}.${cleanAccessKey}.r2.dev`;
      }
      if (finalPublicUrl.endsWith("/")) {
        finalPublicUrl = finalPublicUrl.slice(0, -1);
      }
      const publicFileUrl = `${finalPublicUrl}/luuhinhnh/${testFilename}`;

      console.log(">>> URL ảnh có sẵn tại (sau hoán đổi):", publicFileUrl);
      return res.json({
        status: "success",
        message: "Kết nối Cloudflare R2 THÀNH CÔNG nhờ cơ chế hoán đổi Account ID và Access Key ID thông minh!",
        fileUrl: publicFileUrl,
        combinationUsed: "swapped",
        details: {
          ...diagnosticPayload,
          note: "Người dùng đã nhập hoán đổi vị trí giữa Account ID và Access Key ID trong màn hình Cài đặt, hệ thống đã chuẩn hóa và tối ưu thành công."
        }
      });
    }

    console.log(`>>> [Diagnostic] Combo 2 THẤT BẠI. Lỗi: ${combo2Result.error}`);

    // Test Combination 3: Historical auto-heal backup
    const historicalAccount = ""; // REMOVED FOR SECURITY
    console.log(`[Diagnostic] Combo 3 (Tự chữa lành lịch sử): Account ID="***", Access Key ID="***"`);
    const combo3Result = await attemptUpload(historicalAccount, cleanAccessKey);

    if (combo3Result.success) {
      console.log(">>> [Diagnostic] Combo 3 (Tự chữa lành lịch sử) THÀNH CÔNG RỰC RỠ!");
      saveSuccessfulR2Combo("healed", { healedAccountId: historicalAccount, healedAccessKeyId: cleanAccessKey });

      let finalPublicUrl = r2PublicUrl;
      if (!finalPublicUrl) {
        finalPublicUrl = `https://${cleanBucket}.${historicalAccount}.r2.dev`;
      }
      if (finalPublicUrl.endsWith("/")) {
        finalPublicUrl = finalPublicUrl.slice(0, -1);
      }
      const publicFileUrl = `${finalPublicUrl}/luuhinhnh/${testFilename}`;

      console.log(">>> URL ảnh có sẵn tại (sau tự chữa lành):", publicFileUrl);
      return res.json({
        status: "success",
        message: "Kết nối Cloudflare R2 THÀNH CÔNG nhờ tính năng Tự Chữa Lành thông minh của hệ thống!",
        fileUrl: publicFileUrl,
        combinationUsed: "healed",
        details: {
          ...diagnosticPayload,
          note: "Hệ thống đã phát hiện bạn điền trùng Access Key vào cả 2 ô ô Account ID & Access Key. Nhờ cơ chế tự chữa lành của hệ thống, mã máy chủ đã được tự động áp dụng và kết nối thành công tốt đẹp!"
        }
      });
    }

    console.log(`>>> [Diagnostic] Combo 3 THẤT BẠI. Lỗi: ${combo3Result.error}`);

    // Test Combination 4: Historical healed swapped backup ("[REDACTED_ACCOUNT]" + "[REDACTED_ACCESS_KEY]")
    const historicalHealedAccount = ""; // REMOVED FOR SECURITY
    const historicalHealedAccessKey = ""; // REMOVED FOR SECURITY
    console.log(`[Diagnostic] Combo 4 (Khôi phục Hoán đổi Lịch sử): Account ID="***", Access Key ID="***"`);
    const combo4Result = await attemptUpload(historicalHealedAccount, historicalHealedAccessKey);

    if (combo4Result.success) {
      console.log(">>> [Diagnostic] Combo 4 (Khôi phục Hoán đổi Lịch sử) THÀNH CÔNG RỰC RỠ!");
      saveSuccessfulR2Combo("healed", { healedAccountId: historicalHealedAccount, healedAccessKeyId: historicalHealedAccessKey });

      let finalPublicUrl = r2PublicUrl;
      if (!finalPublicUrl) {
        finalPublicUrl = `https://${cleanBucket}.${historicalHealedAccount}.r2.dev`;
      }
      if (finalPublicUrl.endsWith("/")) {
        finalPublicUrl = finalPublicUrl.slice(0, -1);
      }
      const publicFileUrl = `${finalPublicUrl}/luuhinhnh/${testFilename}`;

      console.log(">>> URL ảnh có sẵn tại (sau tự chữa lành):", publicFileUrl);
      return res.json({
        status: "success",
        message: "Kết nối Cloudflare R2 THÀNH CÔNG nhờ tính năng Tự Chữa Lành thông minh của hệ thống!",
        fileUrl: publicFileUrl,
        combinationUsed: "healed_swapped",
        details: {
          ...diagnosticPayload,
          note: "Hệ thống tự động phát hiện bạn nhập trùng lặp Access Key ID vào cả hai ô trong màn hình Cài Đặt. Nhận diện được vấn đề, cơ chế chẩn đoán nâng cao đã tự khôi phục các biến số lịch sử thành công, ghép nối chuẩn xác Account ID và Access Key ID. Hệ thống đã tự sửa lỗi và đã kết nối thành công tốt đẹp!"
        }
      });
    }

    console.log(`>>> [Diagnostic] Combo 4 THẤT BẠI. Lỗi: ${combo4Result.error}`);

    // All Combinations failed - detailed diagnostics report
    const debugInfo = `
=== R2 QUADRUPLE CONFIG DIAGNOSTICS FAILURE ===
Timestamp: ${new Date().toISOString()}
CLOUDFLARE_R2_ACCESS_KEY_ID: "***"
CLOUDFLARE_R2_SECRET_ACCESS_KEY: "${r2SecretAccessKey ? "***" : "empty"}"
CLOUDFLARE_R2_BUCKET_NAME: "${rawBucketName}" -> Cleaned: "${cleanBucket}"
CLOUDFLARE_R2_ACCOUNT_ID: "***"
CLOUDFLARE_R2_PUBLIC_URL: "${r2PublicUrl}"

[Combo 1 (Original) Error]: ${combo1Result.error}
[Combo 2 (Swapped) Error]: ${combo2Result.error}
[Combo 3 (Healed) Error]: ${combo3Result.error}
[Combo 4 (Healed Swapped) Error]: ${combo4Result.error}
`;
    fs.writeFileSync(path.join(process.cwd(), "r2-vars-debug.txt"), debugInfo, "utf8");

    return res.status(500).json({
      status: "failed",
      message: "Không thể kết nối và tải ảnh thử nghiệm lên Cloudflare R2 bằng cả 4 phương án chẩn đoán.",
      diagnostics: {
        originalComboError: combo1Result.error,
        swappedComboError: combo2Result.error,
        healedComboError: combo3Result.error,
        healedSwappedComboError: combo4Result.error
      },
      details: diagnosticPayload,
      solution: "Vui lòng kiểm tra lại: 1. Hãy chắc chắn tên Bucket hoàn toàn chính xác. 2. API Token Cloudflare R2 của bạn phải chọn phân quyền 'Object Read & Write' (hoặc Admin Read & Write). 3. Kiểm tra tính chính xác của CLOUDFLARE_R2_SECRET_ACCESS_KEY."
    });
  });

  // Proxy Image endpoint: only trusted HTTPS R2 raster images.
  app.get("/api/proxy-image", async (req, res) => {
    try {
      const raw=typeof req.query.url==="string"?req.query.url:"";
      if(!raw)return res.status(400).send("Yêu cầu tham số URL hợp lệ.");
      let url:URL;
      try{url=new URL(raw);}catch{return res.status(400).send("URL không hợp lệ.");}
      if(url.protocol!=="https:"||url.username||url.password)return res.status(403).send("Nguồn ảnh không được phép.");
      const bases=[
        String(getConfig("CLOUDFLARE_R2_PUBLIC_URL")||"").trim().replace(/\/+$/,""),
        (()=>{const b=cleanR2BucketName(getConfig("CLOUDFLARE_R2_BUCKET_NAME"));const a=cleanR2AccountId(getConfig("CLOUDFLARE_R2_ACCOUNT_ID"));return b&&a?`https://${b}.${a}.r2.dev`:"";})()
      ].filter(Boolean);
      if(!bases.some(base=>url.href===base||url.href.startsWith(base+"/")))return res.status(403).send("Nguồn ảnh không được phép.");
      const imgRes=await fetch(url.href,{redirect:"error"});
      if(!imgRes.ok)return res.status(imgRes.status).send("Không thể tải ảnh nguồn.");
      const contentType=String(imgRes.headers.get("content-type")||"").toLowerCase();
      if(!contentType.startsWith("image/")||contentType.includes("svg"))return res.status(415).send("Nguồn không phải ảnh raster được phép.");
      const declared=Number(imgRes.headers.get("content-length")||0);
      if(declared>12*1024*1024)return res.status(413).send("Ảnh vượt giới hạn proxy.");
      const buffer=await imgRes.arrayBuffer();
      if(buffer.byteLength>12*1024*1024)return res.status(413).send("Ảnh vượt giới hạn proxy.");
      res.setHeader("Content-Type",contentType);
      res.setHeader("Cache-Control","public, max-age=86400");
      res.setHeader("X-Content-Type-Options","nosniff");
      res.setHeader("Content-Security-Policy","default-src 'none'; sandbox");
      return res.send(Buffer.from(buffer));
    } catch {
      return res.status(500).send("Lỗi máy chủ proxy ảnh.");
    }
  });

  // General routes
  app.get("/api/config", (req, res) => {
    res.json({
      isGeminiConfigured: isConfigured("GEMINI_API_KEY"),
      isNeonConfigured: isConfigured("NEON_DATABASE_URL") || !!process.env.NEON_DATABASE_URL || !!process.env.DATABASE_URL,
      isR2Configured: isConfigured("CLOUDFLARE_R2_ACCESS_KEY_ID") && isConfigured("CLOUDFLARE_R2_BUCKET_NAME")
    });
  });

  // ==========================================
  // EXAM GENERATE AND GRADE ROUTES (BACKEND)
  // ==========================================
  
  
const cachedJwtSecrets = new Map<string, string>();
async function getServerSecret(): Promise<string> {
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
    const currentDb = tenantStorage.getStore()?.databaseUrl;
    if (!currentDb) throw new Error('Tenant not configured');
    if (cachedJwtSecrets.has(currentDb)) return cachedJwtSecrets.get(currentDb)!;
    try {
        await executeSqlQuery("CREATE TABLE IF NOT EXISTS _internal_secrets (key TEXT PRIMARY KEY, value TEXT)", []);
        const { results } = await executeSqlQuery("SELECT value FROM _internal_secrets WHERE key = 'jwt'", []);
        if (results && results.length > 0 && results[0]?.value) {
            cachedJwtSecrets.set(currentDb, results[0].value);
            return results[0].value;
        }
        const newSecret = crypto.randomUUID() + "-" + crypto.randomUUID();
        await executeSqlQuery("INSERT OR REPLACE INTO _internal_secrets (key, value) VALUES (?, ?)", ['jwt', newSecret]);
        cachedJwtSecrets.set(currentDb, newSecret);
        return newSecret;
    } catch(e) {
        throw new Error('JWT secret unavailable');
    }
}


  function b64EncodeUnicode(str) {
      return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
          return String.fromCharCode(parseInt(p1, 16));
      })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }

  function b64DecodeUnicode(str) {
      return decodeURIComponent(Array.prototype.map.call(atob(str.replace(/-/g, "+").replace(/_/g, "/")), function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
  }

  function signJWTSync(payload, secret) {
      const header = { alg: "HS256", typ: "JWT" };
      const encodedHeader = b64EncodeUnicode(JSON.stringify(header));
      const encodedPayload = b64EncodeUnicode(JSON.stringify(payload));
      const dataToSign = `${encodedHeader}.${encodedPayload}`;
      const signature = crypto.createHmac('sha256', secret).update(dataToSign).digest('base64').replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
      return `${dataToSign}.${signature}`;
  }

  function verifyJWTSync(token, secret) {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [encodedHeader, encodedPayload, encodedSignature] = parts;
      const dataToSign = `${encodedHeader}.${encodedPayload}`;
      const expectedSignature = crypto.createHmac('sha256', secret).update(dataToSign).digest('base64').replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
      if (expectedSignature !== encodedSignature) return null;
      try {
          const claims = JSON.parse(b64DecodeUnicode(encodedPayload));
          const now = Math.floor(Date.now() / 1000);
          if (claims.exp !== undefined && (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now)) return null;
          if (claims.nbf !== undefined && Number(claims.nbf) > now) return null;
          return claims;
      } catch {
          return null;
      }
  }

  // Local/dev dùng cùng implementation phát đề với Cloudflare production.
  // Bước generate chỉ READY/snapshot, tuyệt đối không gửi câu hỏi trước /exam/start.
  app.post("/api/exam/generate", async (req, res) => {
      try {
          const protocol = req.protocol || 'http';
          const host = req.get('host') || `localhost:${PORT}`;
          const requestUrl = `${protocol}://${host}${req.originalUrl || req.url || '/api/exam/generate'}`;
          const webHeaders = new Headers();
          for (const [name, value] of Object.entries(req.headers || {})) {
              if (value === undefined) continue;
              if (Array.isArray(value)) {
                  for (const item of value) webHeaders.append(name, String(item));
              } else {
                  webHeaders.set(name, String(value));
              }
          }
          webHeaders.set('content-type', 'application/json');
          const webRequest = new Request(requestUrl, {
              method: 'POST',
              headers: webHeaders,
              body: JSON.stringify(req.body || {})
          });
          const response = await hardenedExamGenerateHandler({
              request: webRequest,
              env: process.env
          } as any);
          res.status(response.status);
          response.headers.forEach((value, name) => {
              if (name.toLowerCase() !== 'content-length') res.setHeader(name, value);
          });
          return res.send(await response.text());
      } catch (err: any) {
          console.error('Local hardened /api/exam/generate adapter error:', err);
          return res.status(500).json({
              error: 'Không thể chuẩn bị đề thi bằng engine thống nhất.'
          });
      }
  });

  app.all("/api/exam/export-docx", async (req, res) => {
      try {
          const isPost = req.method === 'POST';
          const params = isPost ? req.body : req.query;
          const examId = params.examId || params.id;
          const teacherId = params.teacherId;

          if (!examId && !params.examConfig) {
              return res.status(400).json({ error: 'Thiếu thông tin mã đề thi (examId)' });
          }

          let dbExam: any = null;
          if (examId) {
              const { results } = await executeSqlQuery("SELECT * FROM exam_configs WHERE id = ?", [examId]);
              if (results && results.length > 0) {
                  dbExam = results[0];
              }
          }

          const mapRowRead = (row: any) => {
              const mapped: any = {};
              for (const [key, val] of Object.entries(row)) {
                  if (typeof val === 'string') {
                      const trimmed = val.trim();
                      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                          try { mapped[key] = JSON.parse(trimmed); } catch { mapped[key] = val; }
                      } else { mapped[key] = val; }
                  } else { mapped[key] = val; }
              }
              return mapped;
          };

          let finalSelectedLessons: string[] = [];
          let finalCountsDetail: any = {};
          let targetCount41 = 0;
          let targetCountTF4 = 0;
          let targetCountSQ = 0;
          let targetCountTL = 0;
          let examName = 'Đề thi';
          let timeLimit = 45;
          let effectiveTeacherId = teacherId;

          if (dbExam) {
              const mapped = mapRowRead(dbExam);
              examName = mapped.name || 'Đề thi';
              effectiveTeacherId = mapped.creator_id || teacherId;
              timeLimit = Number(mapped.time_limit || 45);
              if (Array.isArray(mapped.selected_lessons)) {
                  finalSelectedLessons = mapped.selected_lessons;
              } else if (typeof mapped.selected_lessons === 'string') {
                  try { finalSelectedLessons = JSON.parse(mapped.selected_lessons); } catch { finalSelectedLessons = []; }
              }
              if (mapped.counts_detail && typeof mapped.counts_detail === 'object') {
                  finalCountsDetail = mapped.counts_detail;
              } else if (typeof mapped.counts_detail === 'string') {
                  try { finalCountsDetail = JSON.parse(mapped.counts_detail); } catch { finalCountsDetail = {}; }
              }
              targetCount41 = Number(mapped.count_41 || 0);
              targetCountTF4 = Number(mapped.count_tf4 || 0);
              targetCountSQ = Number(mapped.count_sq || 0);
              targetCountTL = Number(mapped.count_tl || 0);
          } else if (params.examConfig) {
              const cfg = typeof params.examConfig === 'object' ? params.examConfig : JSON.parse(params.examConfig);
              examName = cfg.name || 'Đề thi';
              effectiveTeacherId = cfg.creatorId || teacherId;
              timeLimit = Number(cfg.timeLimit || 45);
              finalSelectedLessons = Array.isArray(cfg.selectedLessons) ? cfg.selectedLessons : [];
              finalCountsDetail = cfg.countsDetail || cfg.counts_detail || {};
              targetCount41 = Number(cfg.count41 || 0);
              targetCountTF4 = Number(cfg.countTF4 || 0);
              targetCountSQ = Number(cfg.countSQ || 0);
              targetCountTL = Number(cfg.countTL || 0);
          }

          // Khi ma trận NB/TH/VD đã tồn tại, tổng theo ma trận là nguồn chuẩn.
          // Điều này tương thích với các đề lịch sử có cột tổng dẫn xuất cũ bị lệch;
          // UI khi lưu lại cũng luôn ghi tổng = NB+TH+VD.
          const sum41Detail = Number(finalCountsDetail.count41NB || 0) + Number(finalCountsDetail.count41TH || 0) + Number(finalCountsDetail.count41VD || 0);
          if (sum41Detail > 0) targetCount41 = sum41Detail;

          const sumTF4Detail = Number(finalCountsDetail.countTF4NB || 0) + Number(finalCountsDetail.countTF4TH || 0) + Number(finalCountsDetail.countTF4VD || 0);
          if (sumTF4Detail > 0) targetCountTF4 = sumTF4Detail;

          const sumSQDetail = Number(finalCountsDetail.countSQNB || 0) + Number(finalCountsDetail.countSQTH || 0) + Number(finalCountsDetail.countSQVD || 0);
          if (sumSQDetail > 0) targetCountSQ = sumSQDetail;

          const sumTLDetail = Number(finalCountsDetail.countTLNB || 0) + Number(finalCountsDetail.countTLTH || 0) + Number(finalCountsDetail.countTLVD || 0);
          if (sumTLDetail > 0) targetCountTL = sumTLDetail;

          let teacherDonVi = '';
          if (effectiveTeacherId) {
              try {
                  const { results: accRows } = await executeSqlQuery(
                      "SELECT donvi, address FROM users WHERE id = ? OR id IN (SELECT user_id FROM accounts WHERE id = ? OR username = ?)",
                      [effectiveTeacherId, effectiveTeacherId, effectiveTeacherId]
                  );
                  if (accRows && accRows.length > 0) {
                      teacherDonVi = accRows[0].donvi || accRows[0].address || '';
                  }
              } catch (e) {
                  console.warn("Could not retrieve teacher donvi:", e);
              }
          }

          // Chuẩn hóa và đối sánh bài học chính xác tuyệt đối 100%
          const normalizeLessonExport = (l: any): string => {
              if (!l) return '';
              return String(l).trim().toLowerCase().replace(/\s+/g, ' ');
          };

          const removeVietnameseTonesExport = (str: string): string => {
              if (!str) return '';
              return str
                  .normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')
                  .replace(/đ/g, 'd')
                  .replace(/Đ/g, 'D');
          };

          const normalizeLessonKeyExport = (l: any): string => {
              if (!l) return '';
              return removeVietnameseTonesExport(String(l).trim().toLowerCase())
                  .replace(/[^a-z0-9]/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
          };

          const isLessonMatchedExport = (qLessonRaw: string, allowedLessons: string[]): boolean => {
              if (!allowedLessons || allowedLessons.length === 0) return true;
              const qRaw = String(qLessonRaw || '').trim();
              if (!qRaw) return false;

              const qNorm = normalizeLessonExport(qRaw);
              const qKey = normalizeLessonKeyExport(qRaw);

              for (const allowed of allowedLessons) {
                  const aRaw = String(allowed || '').trim();
                  if (!aRaw) continue;

                  // 1. So khớp chính xác chuỗi nguyên bản
                  if (qRaw === aRaw) return true;

                  // 2. So khớp chữ thường & chuẩn hóa khoảng trắng
                  const aNorm = normalizeLessonExport(aRaw);
                  if (qNorm === aNorm) return true;

                  // 3. So khớp không dấu
                  const aKey = normalizeLessonKeyExport(aRaw);
                  if (qKey === aKey) return true;
              }
              return false;
          };

          if (!finalSelectedLessons || finalSelectedLessons.length === 0) {
              return res.status(400).json({ error: 'Đề thi này chưa được chọn Bài học/Chuyên đề trong cấu hình cài đặt. Vui lòng vào cấu hình đề thi và tích chọn ít nhất 1 bài học!' });
          }

          let allQuestions: any[] = [];
          if (effectiveTeacherId) {
              const qRes = await executeSqlQuery(
                  'SELECT * FROM questions WHERE creator_id = ? OR creator_id IN (SELECT user_id FROM accounts WHERE id = ?) OR creator_id IN (SELECT id FROM accounts WHERE user_id = ?)',
                  [effectiveTeacherId, effectiveTeacherId, effectiveTeacherId]
              );
              allQuestions = qRes.results || [];
          }
          if (!allQuestions || allQuestions.length === 0) {
              const qRes = await executeSqlQuery('SELECT * FROM questions');
              allQuestions = qRes.results || [];
          }

          if (!allQuestions || allQuestions.length === 0) {
              return res.status(404).json({ error: 'Không tìm thấy câu hỏi nào trong ngân hàng đề!' });
          }

          const normalizeType = (type: any) => {
              const t = String(type || '').trim().toLowerCase();
              if (t === '4-1' || t === 'trac_nghiem' || t === 'mcq') return '4-1';
              if (t === 'tf4' || t === 'dung_sai' || t === 'true_false') return 'TF4';
              if (t === 'sq' || t === 'tra_loi_ngan' || t === 'short_answer') return 'SQ';
              if (t === 'tl' || t === 'tu_luan' || t === 'essay') return 'TL';
              return type;
          };

          const normalizeLevel = (lvl: any) => {
              const l = String(lvl || '').trim().toUpperCase();
              if (l === 'NB' || l === 'TH' || l === 'VD') return l;
              return 'NB';
          };

          const seenQuestionIds = new Set<string>();
          const validPool = allQuestions
              .map(mapRowRead)
              .filter(q => {
                  const qId = String(q.id || '');
                  if (!qId || seenQuestionIds.has(qId)) return false;

                  // BẢO VỆ TUYỆT ĐỐI: Bỏ qua toàn bộ câu hỏi rỗng hoặc không có nội dung chữ
                  const contentStr = String(q.content || '').trim();
                  if (!contentStr) return false;

                  seenQuestionIds.add(qId);
                  return true;
              })
              .map(q => {
                  let opts = q.options || {};
                  if (typeof opts === 'string') {
                      try { opts = JSON.parse(opts); } catch { opts = {}; }
                  }
                  return {
                      id: q.id,
                      type: normalizeType(q.type),
                      level: normalizeLevel(q.level),
                      lesson: q.lesson,
                      content: q.content,
                      options: opts,
                      answer: q.answer,
                      image: q.image || '',
                      creatorId: q.creator_id
                  };
              })
              .filter(q => {
                  if (q.type === '4-1') {
                      const opts = q.options || {};
                      let hasOpt = false;
                      if (Array.isArray(opts)) {
                          hasOpt = opts.some(v => v !== null && v !== undefined && String(typeof v === 'object' ? (v.text || v.content || '') : v).trim().length > 0);
                      } else if (typeof opts === 'object') {
                          hasOpt = Object.values(opts).some(v => v !== null && v !== undefined && String(typeof v === 'object' ? (v.text || v.content || '') : v).trim().length > 0);
                      }
                      if (!hasOpt) return false;
                  }
                  return true;
              })
              .filter(q => isLessonMatchedExport(q.lesson, finalSelectedLessons));

          const totalRequired = targetCount41 + targetCountTF4 + targetCountSQ + targetCountTL;
          if (totalRequired === 0) {
              return res.status(400).json({ error: 'Cấu hình đề thi chưa có số lượng câu hỏi nào (> 0)!' });
          }

          const shuffle = (arr: any[]) => [...arr].sort(() => Math.random() - 0.5);

          const numExams = Math.min(20, Math.max(1, Number(params.soLuongDe || params.numExams || 1)));
          const baseMaDeRaw = String(params.maDe || '1201').trim();

          const formatNextMaDe = (baseStr: string, index: number) => {
              if (index === 0) return baseStr;
              const match = baseStr.match(/^(.*?)(\d+)$/);
              if (match) {
                  const prefix = match[1];
                  const digits = match[2];
                  const nextVal = Number(digits) + index;
                  const nextDigitsStr = String(nextVal).padStart(digits.length, '0');
                  return prefix + nextDigitsStr;
              }
              return baseStr + "_" + (index + 1);
          };

          const generatedDocs: Array<{ maDe: string; fileName: string; buffer: Buffer }> = [];
          const examAnswerDocs: ExamAnswerDoc[] = [];

          for (let v = 0; v < numExams; v++) {
              const currentMaDe = formatNextMaDe(baseMaDeRaw, v);
              const selectedQuestions: any[] = [];

              const pickCategory = (type: string, typeLabel: string, targetCount: number, nbTarget: number, thTarget: number, vdTarget: number) => {
                  if (targetCount <= 0) return;
                  const pool = validPool.filter(q => q.type === type);
                  if (pool.length < targetCount) {
                      throw new Error(`Ngân hàng đề không đủ câu hỏi [${typeLabel}] trong các bài học đã chọn! Yêu cầu: ${targetCount} câu, nhưng chỉ có sẵn ${pool.length} câu.`);
                  }

                  const sumSub = (nbTarget || 0) + (thTarget || 0) + (vdTarget || 0);
                  if (sumSub > 0) {
                      const nbPool = shuffle(pool.filter(q => q.level === 'NB'));
                      const thPool = shuffle(pool.filter(q => q.level === 'TH'));
                      const vdPool = shuffle(pool.filter(q => q.level === 'VD'));

                      const pickedNB = nbPool.slice(0, nbTarget || 0);
                      const pickedTH = thPool.slice(0, thTarget || 0);
                      const pickedVD = vdPool.slice(0, vdTarget || 0);

                      const pickedSoFar = [...pickedNB, ...pickedTH, ...pickedVD];
                      const pickedIds = new Set(pickedSoFar.map(q => q.id));

                      if (pickedSoFar.length < targetCount) {
                          const remaining = shuffle(pool.filter(q => !pickedIds.has(q.id)));
                          const needed = targetCount - pickedSoFar.length;
                          pickedSoFar.push(...remaining.slice(0, needed));
                      }

                      if (pickedSoFar.length < targetCount) {
                          throw new Error(`Không đủ câu hỏi [${typeLabel}] để đáp ứng cấu hình đề! Cần ${targetCount} câu, chỉ bốc được ${pickedSoFar.length} câu.`);
                      }

                      selectedQuestions.push(...pickedSoFar);
                  } else {
                      selectedQuestions.push(...shuffle(pool).slice(0, targetCount));
                  }
              };

              const cDetail = finalCountsDetail;
              try {
                  pickCategory('4-1', 'Trắc nghiệm 4-1', targetCount41, Number(cDetail.count41NB || 0), Number(cDetail.count41TH || 0), Number(cDetail.count41VD || 0));
                  pickCategory('TF4', 'Đúng/Sai TF4', targetCountTF4, Number(cDetail.countTF4NB || 0), Number(cDetail.countTF4TH || 0), Number(cDetail.countTF4VD || 0));
                  pickCategory('SQ', 'Trả lời ngắn SQ', targetCountSQ, Number(cDetail.countSQNB || 0), Number(cDetail.countSQTH || 0), Number(cDetail.countSQVD || 0));
                  pickCategory('TL', 'Tự luận TL', targetCountTL, Number(cDetail.countTLNB || 0), Number(cDetail.countTLTH || 0), Number(cDetail.countTLVD || 0));
              } catch (pickErr: any) {
                  return res.status(400).json({ error: pickErr.message });
              }

              if (selectedQuestions.length !== totalRequired) {
                  return res.status(400).json({
                      error: `Số lượng câu hỏi bốc được (${selectedQuestions.length} câu) không khớp với cấu hình đề thi (${totalRequired} câu)!`
                  });
              }

              const invalidQs = selectedQuestions.filter(q => !isLessonMatchedExport(q.lesson, finalSelectedLessons));
              if (invalidQs.length > 0) {
                  return res.status(400).json({ error: 'Phát hiện câu hỏi không thuộc bài học đã chọn trong đề thi!' });
              }

              if (selectedQuestions.length === 0) {
                  return res.status(400).json({ error: 'Không tìm thấy câu hỏi phù hợp với cấu hình đề để xuất!' });
              }

              const headerOpts = {
                  soGiaoDuc: params.soGiaoDuc || "SỞ GIÁO DỤC VÀ ĐÀO TẠO GIA LAI",
                  truongHoc: params.truongHoc || (teacherDonVi ? `TRƯỜNG ${teacherDonVi}` : "TRƯỜNG THPT LÊ HOÀN"),
                  deThiTitle: params.deThiTitle || (examName.toUpperCase().includes('ĐỀ') ? examName : `ĐỀ KIỂM TRA: ${examName}`),
                  namHoc: params.namHoc || "NĂM HỌC 2026 - 2027",
                  monHoc: params.monHoc || (finalSelectedLessons.length > 0 ? `MÔN ${finalSelectedLessons[0].toUpperCase()}` : "MÔN TIN HỌC, LỚP 12"),
                  thoiGian: params.thoiGian || timeLimit,
                  maDe: currentMaDe
              };

              const docxBuffer = await generateExamDocx(headerOpts, selectedQuestions);
              const safeFileName = `De_Thi_${examName.replace(/[^a-zA-Z0-9_\u00C0-\u1EF9]/g, '_')}_MaDe_${currentMaDe}.docx`;

              generatedDocs.push({
                  maDe: currentMaDe,
                  fileName: safeFileName,
                  buffer: docxBuffer
              });

              examAnswerDocs.push({
                  maDe: currentMaDe,
                  questions: selectedQuestions
              });
          }

          // Tạo bảng đáp án Excel (.xlsx) chứa các cột tương ứng từng mã đề thi
          const excelHeaderInfo = {
              deThiTitle: params.deThiTitle || examName,
              soGiaoDuc: params.soGiaoDuc || "SỞ GIÁO DỤC VÀ ĐÀO TẠO GIA LAI",
              truongHoc: params.truongHoc || (teacherDonVi ? `TRƯỜNG ${teacherDonVi}` : "TRƯỜNG THPT LÊ HOÀN"),
              monHoc: params.monHoc || (finalSelectedLessons.length > 0 ? `MÔN ${finalSelectedLessons[0].toUpperCase()}` : "MÔN TIN HỌC, LỚP 12"),
              namHoc: params.namHoc || "NĂM HỌC 2026 - 2027",
              thoiGian: params.thoiGian || timeLimit
          };
          const excelAnswerBuffer = Buffer.from(generateExamAnswerExcel(excelHeaderInfo, examAnswerDocs));

          const startCode = generatedDocs[0].maDe;
          const endCode = generatedDocs[generatedDocs.length - 1].maDe;
          const safeExamName = examName.replace(/[^a-zA-Z0-9_\u00C0-\u1EF9]/g, '_');

          const zip = new JSZip();
          for (const doc of generatedDocs) {
              zip.file(doc.fileName, doc.buffer);
          }

          const excelFileName = numExams === 1
              ? `Bang_Dap_An_MaDe_${startCode}.xlsx`
              : `Bang_Dap_An_Tong_Hop_Cac_Ma_De_${startCode}_den_${endCode}.xlsx`;
          zip.file(excelFileName, excelAnswerBuffer);

          const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
          const zipFileName = numExams === 1
              ? `De_Thi_kem_Dap_An_${safeExamName}_MaDe_${startCode}.zip`
              : `Bo_De_Thi_${safeExamName}_Gom_${numExams}_MaDe_${startCode}_den_${endCode}_kem_Dap_An.zip`;

          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFileName)}"; filename*=UTF-8''${encodeURIComponent(zipFileName)}`);
          res.setHeader('Content-Length', zipBuffer.length);
          return res.send(zipBuffer);

      } catch (err: any) {
          console.error("Lỗi xuất đề thi file Word:", err);
          return res.status(500).json({ error: 'Lỗi khi tạo file Word đề thi: ' + (err.message || err) });
      }
  });

  // Các endpoint phiên thi local/dev dùng đúng handler Cloudflare production
  // để không có hai logic thời gian/resume khác nhau giữa môi trường.
  const invokeExamPagesPostHandler = async (req: any, res: any, handler: any, label: string) => {
      try {
          const protocol = req.protocol || 'http';
          const host = req.get('host') || `localhost:${PORT}`;
          const requestUrl = `${protocol}://${host}${req.originalUrl || req.url || '/api/exam'}`;
          const webHeaders = new Headers();
          for (const [name, value] of Object.entries(req.headers || {})) {
              if (value === undefined) continue;
              if (Array.isArray(value)) {
                  for (const item of value) webHeaders.append(name, String(item));
              } else {
                  webHeaders.set(name, String(value));
              }
          }
          webHeaders.set('content-type', 'application/json');
          const webRequest = new Request(requestUrl, {
              method: 'POST',
              headers: webHeaders,
              body: JSON.stringify(req.body || {})
          });
          const response = await handler({ request: webRequest, env: process.env } as any);
          res.status(response.status);
          response.headers.forEach((value: string, name: string) => {
              if (name.toLowerCase() !== 'content-length') res.setHeader(name, value);
          });
          return res.send(await response.text());
      } catch (err: any) {
          console.error(`Local hardened ${label} adapter error:`, err);
          return res.status(500).json({ error: 'Không thể xử lý phiên thi bằng engine thống nhất.' });
      }
  };

  app.post("/api/exam/start", (req, res) =>
      invokeExamPagesPostHandler(req, res, hardenedExamStartHandler, '/api/exam/start'));
  app.post("/api/exam/save", (req, res) =>
      invokeExamPagesPostHandler(req, res, hardenedExamSaveHandler, '/api/exam/save'));
  app.post("/api/exam/violation", (req, res) =>
      invokeExamPagesPostHandler(req, res, hardenedExamViolationHandler, '/api/exam/violation'));
  app.post("/api/exam/resume", (req, res) =>
      invokeExamPagesPostHandler(req, res, hardenedExamResumeHandler, '/api/exam/resume'));

  // Dùng duy nhất engine chấm đã được harden ở Cloudflare Functions.
  // Local/dev không duy trì một bản logic chấm riêng để tránh sai lệch điểm, thời gian,
  // snapshot đáp án, chống replay và deadline giữa các môi trường.
  app.post("/api/exam/grade", async (req, res) => {
      try {
          const protocol = req.protocol || 'http';
          const host = req.get('host') || `localhost:${PORT}`;
          const requestUrl = `${protocol}://${host}${req.originalUrl || req.url || '/api/exam/grade'}`;
          const webHeaders = new Headers();
          for (const [name, value] of Object.entries(req.headers || {})) {
              if (value === undefined) continue;
              if (Array.isArray(value)) {
                  for (const item of value) webHeaders.append(name, String(item));
              } else {
                  webHeaders.set(name, String(value));
              }
          }
          webHeaders.set('content-type', 'application/json');

          const webRequest = new Request(requestUrl, {
              method: 'POST',
              headers: webHeaders,
              body: JSON.stringify(req.body || {})
          });
          const response = await hardenedExamGradeHandler({
              request: webRequest,
              env: process.env
          } as any);

          res.status(response.status);
          response.headers.forEach((value, name) => {
              if (name.toLowerCase() !== 'content-length') res.setHeader(name, value);
          });
          const text = await response.text();
          return res.send(text);
      } catch (err: any) {
          console.error('Local hardened /api/exam/grade adapter error:', err);
          return res.status(500).json({
              error: 'Không thể xử lý chấm điểm bằng engine thống nhất.'
          });
      }
  });

  // Vite middleware for development

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

    app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server is running on http://0.0.0.0:${PORT}`);
    console.log(`📌 Database (PostgreSQL / Neon): ${isConfigured("NEON_DATABASE_URL") || !!process.env.NEON_DATABASE_URL ? 'CONNECTED' : 'STANDALONE READY'}`);
    console.log(`📌 Storage R2: ${isConfigured("CLOUDFLARE_R2_BUCKET_NAME") ? 'CONNECTED' : 'NOT CONFIGURED'}`);
    console.log(`📌 Gemini AI: ${isConfigured("GEMINI_API_KEY") ? 'READY' : 'KEY MISSING'}`);
  });
}

startServer();
