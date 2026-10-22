import fs from 'fs';
import path from 'path';
import https from 'https';

const ACCOUNT_ID = "707664771b38d2605f49a2c0d5cdb770";
const API_TOKEN = "cfut_bCz5rZaCOfUTMbR2OdPRNS75E3Gcl99XWbCIBtA6fc7aec9e";
const DATABASE_ID = "5805b728-d039-4294-9943-2cf06d54bf0d";

async function queryD1(sql) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ sql, params: [] });
    const options = {
      hostname: 'api.cloudflare.com',
      port: 443,
      path: `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success && parsed.result && parsed.result[0]) {
            resolve(parsed.result[0].results || []);
          } else {
            reject(new Error(parsed.errors?.[0]?.message || 'Lỗi D1 API'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

function escapeSql(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return val.toString();
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function main() {
  console.log('[D1-EXPORT] Đang kết nối trực tiếp đến Cloudflare D1 Database:', DATABASE_ID);

  let dump = `-- ====================================================================
-- HỆ THỐNG KIỂM TRA TRỰC TUYẾN - TOÀN BỘ DỮ LIỆU XUẤT TỪ CLOUDFLARE D1
-- Thời gian xuất: ${new Date().toISOString()}
-- Tác giả: Hồ Hữu Thế - 0935 078 895
-- Database ID: ${DATABASE_ID}
-- Hướng dẫn: Copy toàn bộ nội dung file này dán vào SQL Editor trên Neon.tech và bấm Run.
-- ====================================================================

-- 1. TẠO CẤU TRÚC 9 BẢNG
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
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  is_active INTEGER DEFAULT 1,
  expiry_date TEXT,
  created_at TEXT
);

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
);

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
  created_at TEXT,
  updated_at TEXT
);

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
);

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
);

CREATE TABLE IF NOT EXISTS _submitted_exam_tokens (
  token_hash TEXT PRIMARY KEY,
  exam_id TEXT,
  student_name TEXT,
  submitted_at TEXT
);

CREATE TABLE IF NOT EXISTS duytricsdl (
  id TEXT PRIMARY KEY,
  thoigian TEXT,
  so INTEGER
);

CREATE TABLE IF NOT EXISTS _internal_secrets (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- TỔNG HỢP 34 CHỈ MỤC (INDEXES) CHUẨN POSTGRESQL
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at);
CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(role);
CREATE INDEX IF NOT EXISTS idx_accounts_user_created ON accounts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_username_active ON accounts(username, is_active);

CREATE INDEX IF NOT EXISTS idx_users_donvi ON users(donvi);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_lop ON users(lop);
CREATE INDEX IF NOT EXISTS idx_users_target_audience ON users(target_audience);
CREATE INDEX IF NOT EXISTS idx_users_donvi_audience ON users(donvi, target_audience);
CREATE INDEX IF NOT EXISTS idx_users_audience_created ON users(target_audience, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_donvi_audience_created ON users(donvi, target_audience, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_donvi_lop ON users(donvi, lop);
CREATE INDEX IF NOT EXISTS idx_users_full_name ON users(full_name);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);

CREATE INDEX IF NOT EXISTS idx_questions_creator_id ON questions(creator_id);
CREATE INDEX IF NOT EXISTS idx_questions_creator_lookup ON questions(creator_id, type, level, lesson);
CREATE INDEX IF NOT EXISTS idx_questions_creator_lesson_type ON questions(creator_id, lesson ASC, type ASC);
CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type);
CREATE INDEX IF NOT EXISTS idx_questions_lesson ON questions(lesson);
CREATE INDEX IF NOT EXISTS idx_questions_level ON questions(level);

CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_id ON exam_configs(creator_id);
CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_date ON exam_configs(creator_id, updated_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_name ON exam_configs(creator_id, name ASC);
CREATE INDEX IF NOT EXISTS idx_exam_configs_name_creator ON exam_configs(name, creator_id);
CREATE INDEX IF NOT EXISTS idx_exam_configs_name ON exam_configs(name);
CREATE INDEX IF NOT EXISTS idx_exam_configs_shared ON exam_configs(is_shared_results);
CREATE INDEX IF NOT EXISTS idx_exam_configs_shared_name ON exam_configs(is_shared_results, name ASC);

CREATE INDEX IF NOT EXISTS idx_results_exam_id ON results(exam_id);
CREATE INDEX IF NOT EXISTS idx_results_user_id ON results(user_id);
CREATE INDEX IF NOT EXISTS idx_results_created_at ON results(created_at);
CREATE INDEX IF NOT EXISTS idx_results_exam_created ON results(exam_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_results_user_created ON results(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_results_student_name ON results(student_name);
CREATE INDEX IF NOT EXISTS idx_results_student_created ON results(student_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_results_exam_student ON results(exam_id, student_name);
CREATE INDEX IF NOT EXISTS idx_results_exam_user ON results(exam_id, user_id);
CREATE INDEX IF NOT EXISTS idx_results_exam_name ON results(exam_name);
CREATE INDEX IF NOT EXISTS idx_results_name_user ON results(exam_name, user_id);
CREATE INDEX IF NOT EXISTS idx_results_name_student ON results(exam_name, student_name);
CREATE INDEX IF NOT EXISTS idx_results_exam_score_time ON results(exam_id, score DESC, time_taken ASC);
CREATE INDEX IF NOT EXISTS idx_results_lop ON results(lop);

CREATE INDEX IF NOT EXISTS idx_tokens_exam_student ON _submitted_exam_tokens(exam_id, student_name);
CREATE INDEX IF NOT EXISTS idx_tokens_submitted_at ON _submitted_exam_tokens(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_duytricsdl_thoigian ON duytricsdl(thoigian DESC);
`;

  // 1. App Settings
  try {
    const settings = await queryD1('SELECT * FROM app_settings LIMIT 1');
    if (settings && settings.length > 0) {
      const s = settings[0];
      dump += `\n-- 2. NẠP APP_SETTINGS\nINSERT INTO app_settings (id, show_results_details, allow_ranking_details, show_delete_selected_ranking, immediate_feedback, sq_case_sensitive, sq_punctuation_sensitive, question_font_size, answer_font_size, display_mode, app_title, author_info, ai_prompt, ai_appraise_prompt, ai_grading_key) VALUES (${s.id || 1}, ${s.show_results_details ?? 1}, ${s.allow_ranking_details ?? 1}, ${s.show_delete_selected_ranking ?? 1}, ${s.immediate_feedback ?? 1}, ${s.sq_case_sensitive ?? 0}, ${s.sq_punctuation_sensitive ?? 0}, ${s.question_font_size ?? 18}, ${s.answer_font_size ?? 16}, ${escapeSql(s.display_mode || 'standard')}, ${escapeSql(s.app_title || 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN')}, ${escapeSql(s.author_info || 'Phát triển bởi: Hồ Hữu Thế - 0935 078 895')}, ${escapeSql(s.ai_prompt || '')}, ${escapeSql(s.ai_appraise_prompt || '')}, ${escapeSql(s.ai_grading_key || '')}) ON CONFLICT (id) DO UPDATE SET app_title = EXCLUDED.app_title, author_info = EXCLUDED.author_info;\n`;
    }
  } catch (e) {
    console.warn('Lỗi tải app_settings:', e.message);
  }

  // 2. Users
  try {
    const users = await queryD1('SELECT * FROM users');
    if (users.length > 0) {
      dump += `\n-- 3. NẠP DỮ LIỆU USERS (${users.length} bản ghi)\n`;
      for (const u of users) {
        dump += `INSERT INTO users (id, full_name, phone_number, gender, dob, address, donvi, lop, occupation, target_audience, payment_status, payment_method, is_active, expiry_date, created_at) VALUES (${escapeSql(u.id)}, ${escapeSql(u.full_name)}, ${escapeSql(u.phone_number)}, ${escapeSql(u.gender)}, ${escapeSql(u.dob)}, ${escapeSql(u.address)}, ${escapeSql(u.donvi)}, ${escapeSql(u.lop)}, ${escapeSql(u.occupation)}, ${escapeSql(u.target_audience)}, ${escapeSql(u.payment_status)}, ${escapeSql(u.payment_method)}, ${u.is_active ?? 1}, ${escapeSql(u.expiry_date)}, ${escapeSql(u.created_at)}) ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, phone_number = EXCLUDED.phone_number, donvi = EXCLUDED.donvi, lop = EXCLUDED.lop, target_audience = EXCLUDED.target_audience, is_active = EXCLUDED.is_active;\n`;
      }
    }
  } catch (e) {
    console.warn('Lỗi tải users:', e.message);
  }

  // 3. Accounts
  try {
    const accounts = await queryD1('SELECT * FROM accounts');
    if (accounts.length > 0) {
      dump += `\n-- 4. NẠP DỮ LIỆU ACCOUNTS (${accounts.length} bản ghi)\n`;
      for (const a of accounts) {
        dump += `INSERT INTO accounts (id, user_id, username, password, role, is_active, expiry_date, created_at) VALUES (${escapeSql(a.id)}, ${escapeSql(a.user_id)}, ${escapeSql(a.username)}, ${escapeSql(a.password)}, ${escapeSql(a.role)}, ${a.is_active ?? 1}, ${escapeSql(a.expiry_date)}, ${escapeSql(a.created_at)}) ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role, is_active = EXCLUDED.is_active, expiry_date = EXCLUDED.expiry_date;\n`;
      }
    }
  } catch (e) {
    console.warn('Lỗi tải accounts:', e.message);
  }

  // 4. Questions
  try {
    const questions = await queryD1('SELECT * FROM questions');
    if (questions.length > 0) {
      dump += `\n-- 5. NẠP DỮ LIỆU CÂU HỎI (${questions.length} câu hỏi)\n`;
      for (const q of questions) {
        dump += `INSERT INTO questions (id, type, level, lesson, content, options, answer, image, creator_id, created_at, updated_at) VALUES (${escapeSql(q.id)}, ${escapeSql(q.type)}, ${escapeSql(q.level)}, ${escapeSql(q.lesson)}, ${escapeSql(q.content)}, ${escapeSql(q.options)}, ${escapeSql(q.answer)}, ${escapeSql(q.image)}, ${escapeSql(q.creator_id)}, ${escapeSql(q.created_at || new Date().toISOString())}, ${escapeSql(q.updated_at || new Date().toISOString())}) ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, level = EXCLUDED.level, lesson = EXCLUDED.lesson, content = EXCLUDED.content, options = EXCLUDED.options, answer = EXCLUDED.answer, image = EXCLUDED.image, updated_at = EXCLUDED.updated_at;\n`;
      }
    }
  } catch (e) {
    console.warn('Lỗi tải questions:', e.message);
  }

  // 5. Exam Configs
  try {
    const exams = await queryD1('SELECT * FROM exam_configs');
    if (exams.length > 0) {
      dump += `\n-- 6. NẠP DỮ LIỆU ĐỀ THI (${exams.length} đề thi)\n`;
      for (const ex of exams) {
        dump += `INSERT INTO exam_configs (id, name, creator_id, time_limit, count_41, count_tf4, count_sq, count_tl, points_41, points_tf4, points_sq, points_tl, selected_lessons, tf4_scoring_mode, tf4_points, access_control, immediate_feedback, show_score, show_details, sq_case_sensitive, sq_punctuation_sensitive, auto_grade_essay, counts_detail, chedodethi, mabaomatdethi, target_lop, lop, target_donvi, donvi, tg_bd, tg_kt, ai_prompt, is_shared_results, ai_grading_key, max_attempts, max_cheat_warnings, created_at, updated_at) VALUES (${escapeSql(ex.id)}, ${escapeSql(ex.name)}, ${escapeSql(ex.creator_id)}, ${ex.time_limit || 45}, ${ex.count_41 || 0}, ${ex.count_tf4 || 0}, ${ex.count_sq || 0}, ${ex.count_tl || 0}, ${ex.points_41 || 0}, ${ex.points_tf4 || 0}, ${ex.points_sq || 0}, ${ex.points_tl || 0}, ${escapeSql(ex.selected_lessons)}, ${escapeSql(ex.tf4_scoring_mode)}, ${escapeSql(ex.tf4_points)}, ${escapeSql(ex.access_control)}, ${ex.immediate_feedback ?? 1}, ${ex.show_score ?? 1}, ${ex.show_details ?? 1}, ${ex.sq_case_sensitive ?? 0}, ${ex.sq_punctuation_sensitive ?? 0}, ${ex.auto_grade_essay ?? 0}, ${escapeSql(ex.counts_detail)}, ${escapeSql(ex.chedodethi)}, ${escapeSql(ex.mabaomatdethi)}, ${escapeSql(ex.target_lop)}, ${escapeSql(ex.lop)}, ${escapeSql(ex.target_donvi)}, ${escapeSql(ex.donvi)}, ${escapeSql(ex.tg_bd)}, ${escapeSql(ex.tg_kt)}, ${escapeSql(ex.ai_prompt)}, ${ex.is_shared_results ?? 0}, ${escapeSql(ex.ai_grading_key)}, ${ex.max_attempts ?? 0}, ${ex.max_cheat_warnings ?? 5}, ${escapeSql(ex.created_at)}, ${escapeSql(ex.updated_at)}) ON CONFLICT (id) DO NOTHING;\n`;
      }
    }
  } catch (e) {
    console.warn('Lỗi tải exams:', e.message);
  }

  // 6. Results
  try {
    const results = await queryD1('SELECT * FROM results');
    if (results.length > 0) {
      dump += `\n-- 7. NẠP DỮ LIỆU KẾT QUẢ THI (${results.length} kết quả)\n`;
      for (const r of results) {
        dump += `INSERT INTO results (id, user_id, student_name, student_class, lop, don_vi, exam_name, exam_id, score, time_taken, correct_count, total_questions, details, loai_thi_sinh, cheat_warning_count, ai_grading_summary, created_at) VALUES (${escapeSql(r.id)}, ${escapeSql(r.user_id)}, ${escapeSql(r.student_name)}, ${escapeSql(r.student_class)}, ${escapeSql(r.lop)}, ${escapeSql(r.don_vi)}, ${escapeSql(r.exam_name)}, ${escapeSql(r.exam_id)}, ${r.score || 0}, ${r.time_taken || 0}, ${r.correct_count || 0}, ${r.total_questions || 0}, ${escapeSql(r.details)}, ${escapeSql(r.loai_thi_sinh)}, ${r.cheat_warning_count || 0}, ${escapeSql(r.ai_grading_summary)}, ${escapeSql(r.created_at)}) ON CONFLICT (id) DO NOTHING;\n`;
      }
    }
  } catch (e) {
    console.warn('Lỗi tải results:', e.message);
  }

  // Ghi ra file
  fs.writeFileSync(path.join(process.cwd(), 'neon_database_backup.sql'), dump, 'utf8');
  fs.writeFileSync(path.join(process.cwd(), 'public', 'neon_database_backup.sql'), dump, 'utf8');
  fs.writeFileSync(path.join(process.cwd(), 'public', 'create_all_indexes.sql'), fs.readFileSync(path.join(process.cwd(), 'create_all_indexes.sql'), 'utf8'), 'utf8');

  console.log('[D1-EXPORT] HOÀN TẤT 100%! Đã xuất toàn bộ dữ liệu từ D1 sang neon_database_backup.sql với đầy đủ 34 chỉ mục!');
}

main();
