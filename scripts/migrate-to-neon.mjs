import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const neonUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '';

if (!neonUrl || !neonUrl.startsWith('postgres') || neonUrl.includes('YOUR_')) {
  console.log('[MIGRATE-NEON] Không tìm thấy chuỗi kết nối NEON_DATABASE_URL hợp lệ.');
  console.log('[MIGRATE-NEON] Vui lòng cung cấp NEON_DATABASE_URL trong file .env để thực hiện di chuyển dữ liệu.');
  process.exit(0);
}

const sql = neon(neonUrl, { fullResults: true });

async function runMigration() {
  console.log('[MIGRATE-NEON] Bắt đầu khởi tạo Schema và di chuyển dữ liệu sang Neon PostgreSQL...');

  // 1. Tạo Schema bảng trên Neon PostgreSQL
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
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
    )`,
    `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      is_active INTEGER DEFAULT 1,
      expiry_date TEXT,
      created_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS results (
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
    )`,
    `CREATE TABLE IF NOT EXISTS questions (
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
    )`,
    `CREATE TABLE IF NOT EXISTS exam_configs (
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
      created_at TEXT,
      updated_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (
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
    )`,
    `CREATE TABLE IF NOT EXISTS _submitted_exam_tokens (
      token_hash TEXT PRIMARY KEY,
      exam_id TEXT,
      student_name TEXT,
      submitted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS duytricsdl (
      id TEXT PRIMARY KEY,
      thoigian TEXT,
      so INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS _internal_secrets (
      key TEXT PRIMARY KEY,
      value TEXT
    )`
  ];

  for (const tbl of tables) {
    try {
      await sql.query(tbl);
    } catch (e) {
      console.warn('[MIGRATE-NEON] Cảnh báo tạo bảng:', e.message);
    }
  }

  // 2. Tạo Indexes tăng tốc truy vấn
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username)",
    "CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_users_donvi ON users(donvi)",
    "CREATE INDEX IF NOT EXISTS idx_users_lop ON users(lop)",
    "CREATE INDEX IF NOT EXISTS idx_results_exam_id ON results(exam_id)",
    "CREATE INDEX IF NOT EXISTS idx_results_user_id ON results(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_results_exam_student ON results(exam_id, student_name)",
    "CREATE INDEX IF NOT EXISTS idx_questions_creator_id ON questions(creator_id)",
    "CREATE INDEX IF NOT EXISTS idx_questions_lesson ON questions(lesson)",
    "CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_id ON exam_configs(creator_id)"
  ];

  for (const idx of indexes) {
    try {
      await sql.query(idx);
    } catch (e) {
      console.warn('[MIGRATE-NEON] Cảnh báo tạo index:', e.message);
    }
  }

  // 3. Khởi tạo / Đồng bộ dữ liệu mặc định từ d1_fallback_cache.json
  const cacheFile = path.join(process.cwd(), 'd1_fallback_cache.json');
  if (fs.existsSync(cacheFile)) {
    try {
      const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));

      // 3.1 Cài đặt app_settings
      const settings = cacheData.settings || {};
      await sql.query(`
        INSERT INTO app_settings (
          id, show_results_details, allow_ranking_details, show_delete_selected_ranking,
          immediate_feedback, sq_case_sensitive, sq_punctuation_sensitive,
          question_font_size, answer_font_size, display_mode, app_title, author_info,
          ai_prompt, ai_appraise_prompt, ai_grading_key
        ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO UPDATE SET
          app_title = EXCLUDED.app_title,
          author_info = EXCLUDED.author_info
      `, [
        settings.show_results_details ?? 1,
        settings.allow_ranking_details ?? 1,
        settings.show_delete_selected_ranking ?? 1,
        settings.immediate_feedback ?? 1,
        settings.sq_case_sensitive ?? 0,
        settings.sq_punctuation_sensitive ?? 0,
        settings.question_font_size ?? 18,
        settings.answer_font_size ?? 16,
        settings.display_mode || 'standard',
        'HỆ THỐNG KIỂM TRA TRỰC TUYẾN',
        'Phát triển bởi: Hồ Hữu Thế - 0935 078 895',
        settings.ai_prompt || '',
        settings.ai_appraise_prompt || '',
        settings.ai_grading_key || ''
      ]);
      console.log('[MIGRATE-NEON] ✓ Đã đồng bộ cấu hình app_settings (HỆ THỐNG KIỂM TRA TRỰC TUYẾN)');

      // 3.2 Di chuyển tài khoản accounts và users
      if (Array.isArray(cacheData.accounts)) {
        for (const acc of cacheData.accounts) {
          const userId = acc.user_id || acc.id;
          // Users
          await sql.query(`
            INSERT INTO users (
              id, full_name, phone_number, donvi, lop, target_audience, is_active, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
              full_name = EXCLUDED.full_name,
              phone_number = EXCLUDED.phone_number,
              donvi = EXCLUDED.donvi,
              lop = EXCLUDED.lop,
              target_audience = EXCLUDED.target_audience,
              is_active = EXCLUDED.is_active
          `, [
            userId,
            acc.full_name || acc.username,
            acc.phone_number || '',
            acc.donvi || '',
            acc.lop || '',
            acc.target_audience || (acc.role === 'admin' ? 'Quản trị viên' : acc.role === 'teacher' ? 'Giáo viên' : 'Học sinh'),
            acc.is_active ?? 1,
            acc.created_at || new Date().toISOString()
          ]);

          // Accounts
          if (acc.password) {
            await sql.query(`
              INSERT INTO accounts (
                id, user_id, username, password, role, is_active, expiry_date, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (username) DO UPDATE SET
                password = EXCLUDED.password,
                role = EXCLUDED.role,
                is_active = EXCLUDED.is_active,
                expiry_date = EXCLUDED.expiry_date
            `, [
              acc.id,
              userId,
              acc.username,
              acc.password,
              acc.role || 'user',
              acc.is_active ?? 1,
              acc.expiry_date || null,
              acc.created_at || new Date().toISOString()
            ]);
          }
        }
        console.log(`[MIGRATE-NEON] ✓ Đã kiểm tra và đồng bộ ${cacheData.accounts.length} tài khoản người dùng`);
      }

      // 3.3 Di chuyển đề thi exam_configs
      if (Array.isArray(cacheData.exams)) {
        for (const ex of cacheData.exams) {
          await sql.query(`
            INSERT INTO exam_configs (
              id, name, creator_id, time_limit, count_41, count_tf4, count_sq, count_tl,
              points_41, points_tf4, points_sq, points_tl, selected_lessons,
              immediate_feedback, show_score, show_details, is_shared_results, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            ON CONFLICT (id) DO NOTHING
          `, [
            ex.id,
            ex.name || 'Đề thi',
            ex.creator_id || '',
            ex.time_limit || 45,
            ex.count_41 || 0,
            ex.count_tf4 || 0,
            ex.count_sq || 0,
            ex.count_tl || 0,
            ex.points_41 || 0,
            ex.points_tf4 || 0,
            ex.points_sq || 0,
            ex.points_tl || 0,
            typeof ex.selected_lessons === 'object' ? JSON.stringify(ex.selected_lessons) : (ex.selected_lessons || '[]'),
            ex.immediate_feedback ?? 1,
            ex.show_score ?? 1,
            ex.show_details ?? 1,
            ex.is_shared_results ?? 0,
            ex.created_at || new Date().toISOString(),
            ex.updated_at || new Date().toISOString()
          ]);
        }
        console.log(`[MIGRATE-NEON] ✓ Đã kiểm tra và đồng bộ ${cacheData.exams.length} cấu hình đề thi`);
      }

    } catch (readErr) {
      console.warn('[MIGRATE-NEON] Lỗi đọc cache:', readErr.message);
    }
  }

  console.log('[MIGRATE-NEON] HOÀN TẤT DI CHUYỂN DỮ LIỆU SANG NEON POSTGRESQL 100% THÀNH CÔNG!');
}

runMigration().catch(err => {
  console.error('[MIGRATE-NEON] Lỗi:', err);
  process.exit(1);
});
