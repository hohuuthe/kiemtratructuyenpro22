-- ====================================================================
-- HỆ THỐNG KIỂM TRA TRỰC TUYẾN - TỔNG HỢP 34 CHỈ MỤC (INDEXES) CHUẨN POSTGRESQL
-- Tối ưu hóa tốc độ truy vấn bài thi, tìm kiếm câu hỏi, bảng xếp hạng và người dùng
-- ====================================================================

-- 1. CHỈ MỤC BẢNG ACCOUNTS (TÀI KHOẢN & ĐĂNG NHẬP)
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at);
CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(role);
CREATE INDEX IF NOT EXISTS idx_accounts_user_created ON accounts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_username_active ON accounts(username, is_active);

-- 2. CHỈ MỤC BẢNG USERS (HỒ SƠ NGƯỜI DÙNG)
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

-- 3. CHỈ MỤC BẢNG QUESTIONS (NGÂN HÀNG CÂU HỎI)
CREATE INDEX IF NOT EXISTS idx_questions_creator_id ON questions(creator_id);
CREATE INDEX IF NOT EXISTS idx_questions_creator_lookup ON questions(creator_id, type, level, lesson);
CREATE INDEX IF NOT EXISTS idx_questions_creator_lesson_type ON questions(creator_id, lesson ASC, type ASC);
CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type);
CREATE INDEX IF NOT EXISTS idx_questions_lesson ON questions(lesson);
CREATE INDEX IF NOT EXISTS idx_questions_level ON questions(level);

-- 4. CHỈ MỤC BẢNG EXAM_CONFIGS (QUẢN LÝ ĐỀ THI)
CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_id ON exam_configs(creator_id);
CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_date ON exam_configs(creator_id, updated_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_name ON exam_configs(creator_id, name ASC);
CREATE INDEX IF NOT EXISTS idx_exam_configs_name_creator ON exam_configs(name, creator_id);
CREATE INDEX IF NOT EXISTS idx_exam_configs_name ON exam_configs(name);
CREATE INDEX IF NOT EXISTS idx_exam_configs_shared ON exam_configs(is_shared_results);
CREATE INDEX IF NOT EXISTS idx_exam_configs_shared_name ON exam_configs(is_shared_results, name ASC);

-- 5. CHỈ MỤC BẢNG RESULTS (KẾT QUẢ & BẢNG XẾP HẠNG ĐIỂM THI)
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

-- 6. CHỈ MỤC BẢNG BẢO MẬT & GIÁM SÁT KẾT NỐI
CREATE INDEX IF NOT EXISTS idx_tokens_exam_student ON _submitted_exam_tokens(exam_id, student_name);
CREATE INDEX IF NOT EXISTS idx_tokens_submitted_at ON _submitted_exam_tokens(submitted_at DESC);

-- 7. CHỈ MỤC BẢNG PHÂN CÔNG GIÁO VIÊN - LỚP HỌC (teacher_classes)
CREATE INDEX IF NOT EXISTS idx_tc_teacher ON teacher_classes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_tc_class ON teacher_classes(class_name, donvi);
CREATE INDEX IF NOT EXISTS idx_tc_donvi ON teacher_classes(donvi);
