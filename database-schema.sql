-- ============================================================================
-- HỆ THỐNG KIỂM TRA TRỰC TUYẾN - TOÀN BỘ CẤU TRÚC VÀ DỮ LIỆU CƠ SỞ DỮ LIỆU POSTGRESQL (NEON)
-- Tương thích 100% với PostgreSQL Serverless trên Neon.tech và Cloudflare Pages
-- ============================================================================

-- 1. BẢNG HỒ SƠ NGƯỜI DÙNG (users)
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

-- 2. BẢNG TÀI KHOẢN ĐĂNG NHẬP (accounts)
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

-- 3. BẢNG KẾT QUẢ THI (results)
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

-- 4. BẢNG NGÂN HÀNG CÂU HỎI (questions)
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

-- 5. BẢNG CẤU HÌNH ĐỀ THI (exam_configs)
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

-- BẢNG QUẢN LÝ LIÊN KẾT TÀI LIỆU
CREATE TABLE IF NOT EXISTS quan_ly_tai_lieu (
    id TEXT PRIMARY KEY,
    id_nguoi_tao TEXT NOT NULL,
    tieu_de TEXT NOT NULL,
    duong_link TEXT NOT NULL,
    doi_tuong_duoc_truy_cap TEXT NOT NULL DEFAULT 'authenticated'
        CHECK (doi_tuong_duoc_truy_cap IN ('public','authenticated','teacher','student','admin')),
    thoi_gian_het_han TEXT,
    hoat_dong INTEGER NOT NULL DEFAULT 1 CHECK (hoat_dong IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_qltl_creator ON quan_ly_tai_lieu(id_nguoi_tao);
CREATE INDEX IF NOT EXISTS idx_qltl_visible ON quan_ly_tai_lieu(hoat_dong,doi_tuong_duoc_truy_cap,thoi_gian_het_han);

-- 6. BẢNG TOKEN BẢO MẬT BÀI THI CHỐNG NỘP TRÙNG (_submitted_exam_tokens)
CREATE TABLE IF NOT EXISTS _submitted_exam_tokens (
    token_hash TEXT PRIMARY KEY,
    exam_id TEXT,
    student_name TEXT,
    submitted_at TEXT
);

-- 7. BẢNG LƯU TRỮ KHÓA BẢO MẬT HỆ THỐNG (_internal_secrets)
CREATE TABLE IF NOT EXISTS _internal_secrets (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- 8. BẢNG CÀI ĐẶT HỆ THỐNG (app_settings)
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
);

-- 7. BẢNG PHÂN CÔNG GIÁO VIÊN - LỚP HỌC (teacher_classes)
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
);

-- ============================================================================
-- HỆ THỐNG CHỈ MỤC (INDEX) TỐI ƯU HÓA HIỆU NĂNG TRUY VẤN
-- ============================================================================

-- BẢNG ACCOUNTS
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at);
CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(role);
CREATE INDEX IF NOT EXISTS idx_accounts_user_created ON accounts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_username_active ON accounts(username, is_active);

-- BẢNG USERS
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

-- BẢNG RESULTS
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

-- BẢNG QUESTIONS
CREATE INDEX IF NOT EXISTS idx_questions_creator_id ON questions(creator_id);
CREATE INDEX IF NOT EXISTS idx_questions_creator_lookup ON questions(creator_id, type, level, lesson);
CREATE INDEX IF NOT EXISTS idx_questions_creator_lesson_type ON questions(creator_id, lesson ASC, type ASC);
CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type);
CREATE INDEX IF NOT EXISTS idx_questions_lesson ON questions(lesson);
CREATE INDEX IF NOT EXISTS idx_questions_level ON questions(level);

-- BẢNG EXAM_CONFIGS
CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_id ON exam_configs(creator_id);
CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_date ON exam_configs(creator_id, updated_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_name ON exam_configs(creator_id, name ASC);
CREATE INDEX IF NOT EXISTS idx_exam_configs_name_creator ON exam_configs(name, creator_id);
CREATE INDEX IF NOT EXISTS idx_exam_configs_name ON exam_configs(name);
CREATE INDEX IF NOT EXISTS idx_exam_configs_shared ON exam_configs(is_shared_results);
CREATE INDEX IF NOT EXISTS idx_exam_configs_shared_name ON exam_configs(is_shared_results, name ASC);

-- BẢNG TOKENS & THỐNG KÊ
CREATE INDEX IF NOT EXISTS idx_tokens_exam_student ON _submitted_exam_tokens(exam_id, student_name);
CREATE INDEX IF NOT EXISTS idx_tokens_submitted_at ON _submitted_exam_tokens(submitted_at DESC);

-- BẢNG PHÂN CÔNG GIÁO VIÊN - LỚP HỌC
CREATE INDEX IF NOT EXISTS idx_tc_teacher ON teacher_classes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_tc_class ON teacher_classes(class_name, donvi);
CREATE INDEX IF NOT EXISTS idx_tc_donvi ON teacher_classes(donvi);

-- ============================================================================
-- NẠP DỮ LIỆU CẤU HÌNH & TÀI KHOẢN QUẢN TRỊ VIÊN MẪU (adminhht)
-- ============================================================================

INSERT INTO app_settings (
    id, show_results_details, allow_ranking_details, show_delete_selected_ranking,
    immediate_feedback, sq_case_sensitive, sq_punctuation_sensitive,
    question_font_size, answer_font_size, display_mode, app_title, author_info,
    ai_prompt, ai_appraise_prompt, ai_grading_key, qr_code_url
) VALUES (
    1, 1, 1, 0,
    1, 0, 0,
    18, 16, 'standard', 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN', 'Phát triển bởi: Hồ Hữu Thế - 0935 078 895',
    '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

-- 1. Thêm hồ sơ người dùng Quản trị viên (users)
INSERT INTO users (
    id, full_name, phone_number, gender, dob, address, donvi, lop,
    occupation, target_audience, payment_status, payment_method, is_active, created_at
) VALUES (
    'adminhht',
    'Hồ Hữu Thế',
    '0935 078 895',
    'Nam',
    '',
    '',
    'Ban Quản Trị',
    '',
    'Quản trị viên',
    'Quản trị viên',
    'Đã thanh toán',
    'Miễn phí',
    1,
    '2026-10-05T00:00:00.000Z'
)
ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    target_audience = 'Quản trị viên',
    is_active = 1;

-- 2. Thêm tài khoản đăng nhập Quản trị viên (accounts)
-- Mật khẩu mặc định: 123456 (đã mã hóa chuẩn bảo mật cao cấp PBKDF2)
INSERT INTO accounts (
    id, user_id, username, password, role, is_active, created_at
) VALUES (
    'adminhht',
    'adminhht',
    'adminhht',
    'pbkdf2:sha256:100000:b9373535351754809cbe2037a3b412bb:eab39e5893e785b381a71ad2266dfcf15d00faef7637132494cc4bf7fda3fa25',
    'admin',
    1,
    '2026-10-05T00:00:00.000Z'
)
ON CONFLICT (username) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    role = 'admin',
    is_active = 1,
    password = EXCLUDED.password;
