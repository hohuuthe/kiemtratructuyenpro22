import fs from 'fs';
import path from 'path';

const cacheFile = path.join(process.cwd(), 'd1_fallback_cache.json');
let cacheData = { accounts: [], exams: [], settings: {} };

if (fs.existsSync(cacheFile)) {
  try {
    cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch (e) {
    console.error('Error reading cache:', e);
  }
}

function escapeSql(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return val.toString();
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

let sqlDump = `-- ====================================================================
-- HỆ THỐNG KIỂM TRA TRỰC TUYẾN - FILE XUẤT DỮ LIỆU ĐẦY ĐỦ CHO NEON POSTGRESQL
-- Ngày xuất: ${new Date().toISOString()}
-- Tác giả: Hồ Hữu Thế - 0935 078 895
-- Hướng dẫn: Copy toàn bộ nội dung file này và dán vào tab "SQL Editor"
-- trên Neon.tech (https://console.neon.tech) rồi nhấn "Run".
-- ====================================================================

-- 1. BẢNG USERS (HỒ SƠ NGƯỜI DÙNG)
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

-- 2. BẢNG ACCOUNTS (TÀI KHOẢN ĐĂNG NHẬP & BẢO MẬT MẬT KHẨU)
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

-- 3. BẢNG QUESTIONS (NGÂN HÀNG CÂU HỎI)
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

-- 4. BẢNG EXAM_CONFIGS (QUẢN LÝ ĐỀ THI)
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

-- 5. BẢNG RESULTS (KẾT QUẢ & BẢNG ĐIỂM THI)
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

-- 6. BẢNG APP_SETTINGS (CẤU HÌNH HỆ THỐNG)
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

-- 7. BẢNG _SUBMITTED_EXAM_TOKENS (CHỐNG GIAN LẬN NỘP BÀI)
CREATE TABLE IF NOT EXISTS _submitted_exam_tokens (
  token_hash TEXT PRIMARY KEY,
  exam_id TEXT,
  student_name TEXT,
  submitted_at TEXT
);

-- 8. BẢNG DUYTRICSDL (GIÁM SÁT KẾT NỐI)
CREATE TABLE IF NOT EXISTS duytricsdl (
  id TEXT PRIMARY KEY,
  thoigian TEXT,
  so INTEGER
);

-- 9. BẢNG _INTERNAL_SECRETS (BẢO MẬT KHÓA NỘI BỘ)
CREATE TABLE IF NOT EXISTS _internal_secrets (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- TẠO CHỈ MỤC (INDEXES) TỐI ƯU TỐC ĐỘ TRUY VẤN
CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_users_donvi ON users(donvi);
CREATE INDEX IF NOT EXISTS idx_users_lop ON users(lop);
CREATE INDEX IF NOT EXISTS idx_results_exam_id ON results(exam_id);
CREATE INDEX IF NOT EXISTS idx_results_user_id ON results(user_id);
CREATE INDEX IF NOT EXISTS idx_results_exam_student ON results(exam_id, student_name);
CREATE INDEX IF NOT EXISTS idx_questions_creator_id ON questions(creator_id);
CREATE INDEX IF NOT EXISTS idx_questions_lesson ON questions(lesson);
CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_id ON exam_configs(creator_id);

-- ====================================================================
-- NẠP DỮ LIỆU CẤU HÌNH HỆ THỐNG (APP_SETTINGS)
-- ====================================================================
INSERT INTO app_settings (
  id, show_results_details, allow_ranking_details, show_delete_selected_ranking,
  immediate_feedback, sq_case_sensitive, sq_punctuation_sensitive,
  question_font_size, answer_font_size, display_mode, app_title, author_info,
  ai_prompt, ai_appraise_prompt, ai_grading_key
) VALUES (
  1, 1, 1, 1, 1, 0, 0, 18, 16, 'standard',
  'HỆ THỐNG KIỂM TRA TRỰC TUYẾN',
  'Phát triển bởi: Hồ Hữu Thế - 0935 078 895',
  '', '', ''
) ON CONFLICT (id) DO UPDATE SET
  app_title = EXCLUDED.app_title,
  author_info = EXCLUDED.author_info;

-- ====================================================================
-- NẠP DỮ LIỆU HỒ SƠ NGƯỜI DÙNG & TÀI KHOẢN (USERS & ACCOUNTS)
-- ====================================================================
`;

// Nạp Users & Accounts
if (Array.isArray(cacheData.accounts)) {
  for (const acc of cacheData.accounts) {
    const userId = acc.user_id || acc.id;
    const fullName = acc.full_name || acc.username;
    const phone = acc.phone_number || '';
    const donvi = acc.donvi || '';
    const lop = acc.lop || '';
    const role = acc.role || 'user';
    const targetAudience = acc.target_audience || (role === 'admin' ? 'Quản trị viên' : role === 'teacher' ? 'Giáo viên' : 'Học sinh');
    const isActive = acc.is_active !== undefined ? acc.is_active : 1;
    const createdAt = acc.created_at || new Date().toISOString();
    const expiryDate = acc.expiry_date ? `'${acc.expiry_date}'` : 'NULL';

    sqlDump += `
INSERT INTO users (id, full_name, phone_number, donvi, lop, target_audience, is_active, created_at)
VALUES (${escapeSql(userId)}, ${escapeSql(fullName)}, ${escapeSql(phone)}, ${escapeSql(donvi)}, ${escapeSql(lop)}, ${escapeSql(targetAudience)}, ${isActive}, ${escapeSql(createdAt)})
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  phone_number = EXCLUDED.phone_number,
  donvi = EXCLUDED.donvi,
  lop = EXCLUDED.lop,
  target_audience = EXCLUDED.target_audience,
  is_active = EXCLUDED.is_active;

INSERT INTO accounts (id, user_id, username, password, role, is_active, expiry_date, created_at)
VALUES (${escapeSql(acc.id)}, ${escapeSql(userId)}, ${escapeSql(acc.username)}, ${escapeSql(acc.password)}, ${escapeSql(role)}, ${isActive}, ${expiryDate}, ${escapeSql(createdAt)})
ON CONFLICT (username) DO UPDATE SET
  password = EXCLUDED.password,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active,
  expiry_date = EXCLUDED.expiry_date;
`;
  }
}

// Nạp Exam Configs
sqlDump += `
-- ====================================================================
-- NẠP DỮ LIỆU ĐỀ THI (EXAM_CONFIGS)
-- ====================================================================
`;

if (Array.isArray(cacheData.exams)) {
  for (const ex of cacheData.exams) {
    const exId = String(ex.id);
    const exName = ex.name || 'Đề thi';
    const creatorId = ex.creator_id || '';
    const timeLimit = ex.time_limit || 45;
    const count41 = ex.count_41 || 0;
    const countTf4 = ex.count_tf4 || 0;
    const countSq = ex.count_sq || 0;
    const countTl = ex.count_tl || 0;
    const points41 = ex.points_41 || 0;
    const pointsTf4 = ex.points_tf4 || 0;
    const pointsSq = ex.points_sq || 0;
    const pointsTl = ex.points_tl || 0;
    const selectedLessons = typeof ex.selected_lessons === 'object' ? JSON.stringify(ex.selected_lessons) : (ex.selected_lessons || '[]');
    const targetLop = ex.target_lop || ex.lop || '';
    const lop = ex.lop || ex.target_lop || '';
    const targetDonvi = ex.target_donvi || ex.donvi || '';
    const donvi = ex.donvi || ex.target_donvi || '';
    const chedodethi = ex.chedodethi || 'Đề tự do';
    const mabaomatdethi = ex.mabaomatdethi || '';
    const createdAt = ex.created_at || new Date().toISOString();
    const updatedAt = ex.updated_at || new Date().toISOString();

    sqlDump += `
INSERT INTO exam_configs (
  id, name, creator_id, time_limit, count_41, count_tf4, count_sq, count_tl,
  points_41, points_tf4, points_sq, points_tl, selected_lessons,
  target_lop, lop, target_donvi, donvi, chedodethi, mabaomatdethi,
  immediate_feedback, show_score, show_details, is_shared_results, created_at, updated_at
) VALUES (
  ${escapeSql(exId)}, ${escapeSql(exName)}, ${escapeSql(creatorId)}, ${timeLimit},
  ${count41}, ${countTf4}, ${countSq}, ${countTl},
  ${points41}, ${pointsTf4}, ${pointsSq}, ${pointsTl}, ${escapeSql(selectedLessons)},
  ${escapeSql(targetLop)}, ${escapeSql(lop)}, ${escapeSql(targetDonvi)}, ${escapeSql(donvi)},
  ${escapeSql(chedodethi)}, ${escapeSql(mabaomatdethi)},
  1, 1, 1, 0, ${escapeSql(createdAt)}, ${escapeSql(updatedAt)}
) ON CONFLICT (id) DO NOTHING;
`;
  }
}

// Lưu file vào thư mục gốc và thư mục public để tải trực tiếp từ web
fs.writeFileSync(path.join(process.cwd(), 'neon_database_backup.sql'), sqlDump, 'utf8');
if (!fs.existsSync(path.join(process.cwd(), 'public'))) {
  fs.mkdirSync(path.join(process.cwd(), 'public'));
}
fs.writeFileSync(path.join(process.cwd(), 'public', 'neon_database_backup.sql'), sqlDump, 'utf8');

console.log('[GENERATE-SQL] File neon_database_backup.sql đã được tạo thành công!');
