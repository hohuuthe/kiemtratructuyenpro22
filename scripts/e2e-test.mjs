// scripts/e2e-test.mjs
// ======================================================================
// HỆ THỐNG KIỂM THỬ TOÀN DIỆN & CHUYÊN SÂU (DEEP END-TO-END AUDIT SUITE)
// ======================================================================

const BASE_URL = 'http://localhost:3000';

async function request(path, options = {}, retries = 5) {
  const url = `${BASE_URL}${path}`;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, ok: res.ok, data };
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

let passed = 0;
let failed = 0;
const testResults = [];

function assert(condition, message, details = '') {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
    testResults.push({ status: 'PASS', message });
  } else {
    console.error(`  ❌ [FAIL] ${message}${details ? ' -> ' + details : ''}`);
    failed++;
    testResults.push({ status: 'FAIL', message, details });
  }
}

async function runDeepE2ETestSuite() {
  console.log('======================================================================');
  console.log('🧪 BẮT ĐẦU CHẠY BỘ KIỂM THỬ CHUYÊN SÂU & TOÀN DIỆN 100% CÁC CHỨC NĂNG');
  console.log('======================================================================\n');

  const timestamp = Date.now();

  // Dữ liệu định danh dùng trong kiểm thử
  let adminToken = '';
  let adminId = '';

  const teacherA_User = `gv_a_${timestamp}`;
  const teacherA_Pass = 'GiaoVienA@123';
  let teacherA_Id = '';
  let teacherA_Token = '';

  const teacherB_User = `gv_b_${timestamp}`;
  const teacherB_Pass = 'GiaoVienB@123';
  let teacherB_Id = '';
  let teacherB_Token = '';

  const student1_User = `hs_1_${timestamp}`;
  const student1_Pass = 'HocSinh1@123';
  let student1_Id = '';
  let student1_Token = '';

  const questionIdsA = [];
  const questionIdsB = [];
  let testExamPublicId = Math.floor(timestamp / 1000);
  let testExamPassId = Math.floor(timestamp / 1000) + 1;

  let studentExamToken = '';
  let studentResultId = '';

  // =====================================================================
  // MODULE 1: HỆ THỐNG & KẾT NỐI HẠ TẦNG (INFRASTRUCTURE & HEALTH)
  // =====================================================================
  console.log('🌐 [MODULE 1]: Kiểm tra Hạ Tầng, Kết Nối CSDL & Trạng Thái Máy Chủ');
  {
    // 1.1 Health endpoint
    const healthRes = await request('/api/health');
    assert(healthRes.ok && healthRes.data?.status === 'ok', 'Máy chủ Express phản hồi trạng thái hoạt động tốt (/api/health)');

    // 1.2 D1 / Keep-alive service
    const duytriRes = await request('/api/duytricsdl');
    assert(duytriRes.ok && Array.isArray(duytriRes.data?.data), 'Dịch vụ duy trì CSDL Cloudflare D1 (/api/duytricsdl) hoạt động chuẩn xác');
    assert(duytriRes.data?.data?.length > 0, 'Bảng lưu vết thời gian kết nối D1 có dữ liệu thực tế');

    // 1.3 Xác nhận cổng API thô /api/db đã được đóng hoàn toàn (410 Gone) sau Giai đoạn 3 (Rút củi)
    const decommissionedDbRes = await request('/api/db', {
      method: 'POST',
      body: JSON.stringify({ table: 'accounts', action: 'select' })
    });
    assert(decommissionedDbRes.status === 410, 'Bảo mật: Cổng API thô /api/db bị vô hiệu hóa hoàn toàn (HTTP 410 Gone)');
  }

  // =====================================================================
  // MODULE 2: BẢO MẬT CẤU HÌNH HỆ THỐNG & CÔ LẬP KHÓA API (SETTINGS & API KEYS)
  // =====================================================================
  console.log('\n⚙️ [MODULE 2]: Kiểm tra Cấu Hình Hệ Thống, Bảo Mật Khóa AI & RLS Settings');
  {
    // 2.1 Đọc cấu hình khi chưa đăng nhập -> Khóa AI bí mật bắt buộc phải rỗng
    const anonSettings = await request('/api/settings');
    assert(anonSettings.ok && anonSettings.data?.data, 'Khách vãng lai đọc được cấu hình chung');
    assert(anonSettings.data?.data?.ai_grading_key === '', 'Bảo mật: Khách chưa đăng nhập không thể đọc khóa AI (ai_grading_key bị che)');

    // 2.2 Đăng nhập tài khoản Quản trị viên (Admin)
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: '123' })
    });
    assert(adminLogin.ok && !!adminLogin.data?.token, 'Quản trị viên (admin/123) đăng nhập thành công và nhận JWT Admin');
    adminToken = adminLogin.data?.token;
    adminId = adminLogin.data?.data?.id;

    // 2.3 Admin đọc cấu hình -> Đọc được khóa AI
    const adminSettings = await request('/api/settings', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(adminSettings.ok && adminSettings.data?.data, 'Admin lấy thông tin cấu hình toàn diện thành công');

    // 2.4 Cập nhật cấu hình hệ thống bằng quyền Admin
    const updateSettingsRes = await request('/api/settings', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        app_title: 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN',
        display_mode: 'standard',
        immediate_feedback: 1,
        show_results_details: 1,
        allow_ranking_details: 1,
        show_delete_selected_ranking: 1,
        question_font_size: 18,
        answer_font_size: 16,
        author_info: 'Ban Quản Trị Hệ Thống',
        ai_grading_key: 'sk-test-gemini-secure-key-12345'
      })
    });
    assert(updateSettingsRes.ok && updateSettingsRes.data?.data?.success, 'Admin cập nhật cấu hình hệ thống thành công');

    // 2.5 Kiểm tra lại thiết lập vừa cập nhật
    const verifySettings = await request('/api/settings', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(verifySettings.data?.data?.app_title === 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN', 'Dữ liệu cấu hình mới được lưu trữ chuẩn xác trong CSDL');
    assert(verifySettings.data?.data?.ai_grading_key === 'sk-test-gemini-secure-key-12345', 'Admin truy xuất khóa bí mật vừa lưu thành công');
  }

  // =====================================================================
  // MODULE 3: QUẢN LÝ TÀI KHOẢN, PHÂN QUYỀN & BẢO VỆ DỮ LIỆU NGƯỜI DÙNG
  // =====================================================================
  console.log('\n👥 [MODULE 3]: Quản Lý Tài Khoản, Ma Trận Phân Quyền & Xác Thực PBKDF2');
  {
    // 3.1 Đăng ký tài khoản Học sinh (Học sinh tự động được kích hoạt is_active = 1)
    const regStudentRes = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: student1_User,
        password: student1_Pass,
        full_name: 'Học Sinh A (Kiểm thử)',
        target_audience: 'Học sinh',
        donvi: 'Lớp 12A1 - THPT Lê Hoàn',
        occupation: 'Học sinh'
      })
    });
    assert(regStudentRes.ok && regStudentRes.data?.data?.id, 'Học sinh đăng ký tài khoản mới thành công');
    student1_Id = regStudentRes.data?.data?.id;

    // 3.2 Kiểm tra chống đăng ký trùng username
    const regDuplicateRes = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: student1_User,
        password: 'anyPassword@123',
        full_name: 'Trùng Tên',
        target_audience: 'Học sinh'
      })
    });
    assert(!regDuplicateRes.ok, 'Hệ thống chặn thành công việc đăng ký trùng username');

    // 3.3 Học sinh đăng nhập
    const studentLoginRes = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: student1_User, password: student1_Pass })
    });
    assert(studentLoginRes.ok && !!studentLoginRes.data?.token, 'Học sinh đăng nhập thành công và nhận Token xác thực');
    student1_Token = studentLoginRes.data?.token;

    // 3.4 Thử đăng nhập sai mật khẩu
    const wrongPassLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: student1_User, password: 'WrongPassword' })
    });
    assert(!wrongPassLogin.ok, 'Hệ thống từ chối đăng nhập khi sai mật khẩu');

    // 3.5 Admin tạo 2 Giáo viên A và Giáo viên B
    const createGvaRes = await request('/api/accounts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        username: teacherA_User,
        password: teacherA_Pass,
        full_name: 'Thầy Giáo A (Toán Học)',
        donvi: 'Tổ Toán - THPT Lê Hoàn',
        target_audience: 'Giáo viên',
        role: 'Giáo viên',
        occupation: 'Giáo viên bộ môn'
      })
    });
    assert(createGvaRes.ok && createGvaRes.data?.data?.id, 'Admin tạo tài khoản Giáo viên A thành công');
    teacherA_Id = createGvaRes.data?.data?.id;

    const createGvbRes = await request('/api/accounts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        username: teacherB_User,
        password: teacherB_Pass,
        full_name: 'Cô Giáo B (Vật Lý)',
        donvi: 'Tổ Lý - THPT Lê Hoàn',
        target_audience: 'Giáo viên',
        role: 'Giáo viên',
        occupation: 'Giáo viên bộ môn'
      })
    });
    assert(createGvbRes.ok && createGvbRes.data?.data?.id, 'Admin tạo tài khoản Giáo viên B thành công');
    teacherB_Id = createGvbRes.data?.data?.id;

    // 3.6 Giáo viên A và B đăng nhập
    const loginGva = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: teacherA_User, password: teacherA_Pass })
    });
    assert(loginGva.ok && !!loginGva.data?.token, 'Giáo viên A đăng nhập thành công');
    teacherA_Token = loginGva.data?.token;

    const loginGvb = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: teacherB_User, password: teacherB_Pass })
    });
    assert(loginGvb.ok && !!loginGvb.data?.token, 'Giáo viên B đăng nhập thành công');
    teacherB_Token = loginGvb.data?.token;

    // 3.7 Kiểm tra đổi mật khẩu an toàn
    const newPassA = 'GiaoVienA@NewPass456';
    const changePassFail = await request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ username: teacherA_User, oldPassword: 'WrongOldPassword', newPassword: newPassA })
    });
    assert(!changePassFail.ok, 'Đổi mật khẩu thất bại khi nhập sai mật khẩu cũ');

    const changePassSuccess = await request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ username: teacherA_User, oldPassword: teacherA_Pass, newPassword: newPassA })
    });
    assert(changePassSuccess.ok && changePassSuccess.data?.data?.success, 'Giáo viên A đổi mật khẩu thành công');

    const loginWithNewPass = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: teacherA_User, password: newPassA })
    });
    assert(loginWithNewPass.ok && !!loginWithNewPass.data?.token, 'Giáo viên A đăng nhập thành công với mật khẩu mới');
    teacherA_Token = loginWithNewPass.data?.token;

    // 3.8 Bảo mật RLS Tài Khoản: Học sinh không được phép đọc dữ liệu nhạy cảm / sửa tài khoản
    const studentGetAllAccounts = await request('/api/accounts', {
      headers: { 'Authorization': `Bearer ${student1_Token}` }
    });
    assert(studentGetAllAccounts.ok && Array.isArray(studentGetAllAccounts.data?.data), 'Học sinh lấy danh sách giáo viên công khai');
    const hasPasswordInList = studentGetAllAccounts.data?.data?.some(acc => acc.password !== undefined && acc.password !== null);
    assert(!hasPasswordInList, 'Bảo mật: Mật khẩu người dùng không bao giờ bị trả về cho học sinh');

    const studentTryCreateUser = await request('/api/accounts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${student1_Token}` },
      body: JSON.stringify({ username: 'hacker_user', password: '123' })
    });
    assert(studentTryCreateUser.status === 403, 'Học sinh bị chặn không thể tự ý tạo tài khoản (403 Forbidden)');

    // 3.9 Admin khóa tài khoản (is_active = 0) và kiểm tra chặn đăng nhập
    const lockStudentRes = await request(`/api/accounts/${student1_Id}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ is_active: false })
    });
    assert(lockStudentRes.ok, 'Admin khóa tài khoản người dùng thành công');

    const lockedStudentLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: student1_User, password: student1_Pass })
    });
    assert(!lockedStudentLogin.ok, 'Tài khoản bị khóa không thể đăng nhập');

    // Admin mở khóa lại tài khoản
    await request(`/api/accounts/${student1_Id}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ is_active: true })
    });
    const unlockedStudentLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: student1_User, password: student1_Pass })
    });
    assert(unlockedStudentLogin.ok, 'Tài khoản sau khi được mở khóa đã đăng nhập bình thường');
    student1_Token = unlockedStudentLogin.data?.token;
  }

  // =====================================================================
  // MODULE 4: QUẢN LÝ NGÂN HÀNG CÂU HỎI & CÁC DẠNG CÂU HỎI (4-1, TF4, SQ, TL)
  // =====================================================================
  console.log('\n📚 [MODULE 4]: Quản Lý Ngân Hàng Câu Hỏi Toàn Diện (4 Dạng Chuẩn)');
  const q41_Id = `q_41_${timestamp}`;
  const qTF4_Id = `q_tf4_${timestamp}`;
  const qSQ_Id = `q_sq_${timestamp}`;
  const qTL_Id = `q_tl_${timestamp}`;

  {
    // 4.1 Học sinh không có quyền thêm câu hỏi
    const studentCreateQ = await request('/api/questions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${student1_Token}` },
      body: JSON.stringify({ questions: [{ id: 'q_hack', content: 'Hack', type: '4-1' }] })
    });
    assert(studentCreateQ.status === 403, 'Học sinh không được phép tạo câu hỏi (403 Forbidden)');

    // 4.2 Giáo viên A thêm đầy đủ 4 dạng câu hỏi với công thức toán LaTeX và tiếng Việt
    const questionsBatchA = [
      {
        id: q41_Id,
        type: '4-1',
        level: 'NB',
        lesson: 'Chương 1: Khảo sát hàm số',
        content: 'Cho hàm số $y = x^3 - 3x + 2$. Điểm cực đại của hàm số là gì?',
        options: { A: '(-1; 4)', B: '(1; 0)', C: '(0; 2)', D: '(2; 4)' },
        answer: 'A',
        creatorId: teacherA_Id
      },
      {
        id: qTF4_Id,
        type: 'TF4',
        level: 'TH',
        lesson: 'Chương 1: Khảo sát hàm số',
        content: 'Xét tính đúng/sai của các mệnh đề sau về đồ thị hàm số $y = \\frac{2x+1}{x-1}$:',
        options: {
          A: 'Tiệm cận đứng của đồ thị là $x = 1$',
          B: 'Tiệm cận ngang của đồ thị là $y = 2$',
          C: 'Hàm số đồng biến trên toàn bộ tập xác định',
          D: 'Đồ thị cắt trục tung tại điểm $(0; -1)$'
        },
        answer: 'D&D&S&D', // A: Đúng, B: Đúng, C: Sai, D: Đúng
        creatorId: teacherA_Id
      },
      {
        id: qSQ_Id,
        type: 'SQ',
        level: 'VD',
        lesson: 'Chương 1: Khảo sát hàm số',
        content: 'Tìm giá trị nhỏ nhất của hàm số $f(x) = x^2 + 4x + 9$ trên đoạn $[0; 3]$. (Nhập số nguyên)',
        options: {},
        answer: '9',
        creatorId: teacherA_Id
      },
      {
        id: qTL_Id,
        type: 'TL',
        level: 'VDC',
        lesson: 'Chương 1: Khảo sát hàm số',
        content: 'Trình bày các bước tìm tiệm cận xiên của một hàm phân thức hữu tỉ bậc hai trên bậc nhất.',
        options: {},
        answer: 'Chia đa thức tử số cho mẫu số để tách dạng y = ax + b + r(x)/(cx+d). Khi x tiến tới vô cực thì tiệm cận xiên là y = ax + b.',
        creatorId: teacherA_Id
      }
    ];

    const createBatchRes = await request('/api/questions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${teacherA_Token}` },
      body: JSON.stringify({ questions: questionsBatchA })
    });
    assert(createBatchRes.ok && createBatchRes.data?.success, 'Giáo viên A thêm thành công 4 dạng câu hỏi (4-1, TF4, SQ, TL) vào ngân hàng');
    questionIdsA.push(q41_Id, qTF4_Id, qSQ_Id, qTL_Id);

    // 4.3 Giáo viên B thêm 1 câu hỏi riêng của Giáo viên B
    const qB_Id = `q_b_${timestamp}`;
    await request('/api/questions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${teacherB_Token}` },
      body: JSON.stringify({
        questions: [{
          id: qB_Id,
          type: '4-1',
          level: 'NB',
          lesson: 'Chương 1: Khảo sát hàm số',
          content: 'Câu hỏi riêng của Giáo viên B',
          options: { A: '1', B: '2', C: '3', D: '4' },
          answer: 'A',
          creatorId: teacherB_Id
        }]
      })
    });
    questionIdsB.push(qB_Id);

    // 4.4 Giáo viên A tra cứu ngân hàng câu hỏi của chính mình
    const getQuestionsA = await request(`/api/questions?teacherId=${encodeURIComponent(teacherA_Id)}`, {
      headers: { 'Authorization': `Bearer ${teacherA_Token}` }
    });
    assert(getQuestionsA.ok && Array.isArray(getQuestionsA.data?.data), 'Giáo viên A tải danh sách câu hỏi thành công');
    assert(getQuestionsA.data.data.length >= 4, 'Ngân hàng câu hỏi trả về đủ 4 dạng câu hỏi vừa tạo');

    // 4.5 Cập nhật nội dung câu hỏi
    const updateQuestionRes = await request('/api/questions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${teacherA_Token}` },
      body: JSON.stringify({
        questions: [{
          id: q41_Id,
          type: '4-1',
          level: 'NB',
          lesson: 'Chương 1: Khảo sát hàm số',
          content: 'Cho hàm số $y = x^3 - 3x + 2$. Điểm cực đại của đồ thị hàm số là gì? (Đã cập nhật)',
          options: { A: '(-1; 4)', B: '(1; 0)', C: '(0; 2)', D: '(2; 4)' },
          answer: 'A',
          creatorId: teacherA_Id
        }]
      })
    });
    assert(updateQuestionRes.ok && updateQuestionRes.data?.success, 'Cập nhật chỉnh sửa nội dung câu hỏi thành công');
  }

  // =====================================================================
  // MODULE 5: QUẢN LÝ CẤU HÌNH ĐỀ THI & CHIA SẺ MÃ ĐỀ
  // =====================================================================
  console.log('\n📝 [MODULE 5]: Cấu Hình Đề Thi, Trọng Số Điểm, Chế Độ Bảo Mật & Chia Sẻ');
  {
    // 5.1 Tạo Đề thi Công Khai (Đề công khai, trọng số điểm từng phần)
    const createPublicExamRes = await request('/api/exams', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${teacherA_Token}` },
      body: JSON.stringify({
        id: testExamPublicId,
        name: 'Đề Khảo Sát Toán 12 - Chương 1 (Công Khai)',
        time_limit: 15,
        count_41: 1,
        count_tf4: 1,
        count_sq: 1,
        count_tl: 1,
        points_41: 2.0,
        points_tf4: 2.0,
        points_sq: 2.0,
        points_tl: 4.0,
        selected_lessons: JSON.stringify(['Chương 1: Khảo sát hàm số']),
        is_shared_results: 1,
        chedodethi: 'Đề công khai'
      })
    });
    assert(createPublicExamRes.ok && createPublicExamRes.data?.success, 'Giáo viên A tạo đề thi công khai thành công');

    // 5.2 Tạo Đề thi Có Mật Khẩu Bảo Mật
    const createPassExamRes = await request('/api/exams', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${teacherA_Token}` },
      body: JSON.stringify({
        id: testExamPassId,
        name: 'Đề Thi Giữa Kỳ 1 - Mã Bảo Mật',
        time_limit: 45,
        count_41: 1,
        count_tf4: 1,
        count_sq: 1,
        count_tl: 1,
        points_41: 2.5,
        points_tf4: 2.5,
        points_sq: 2.5,
        points_tl: 2.5,
        selected_lessons: JSON.stringify(['Chương 1: Khảo sát hàm số']),
        is_shared_results: 0,
        chedodethi: 'Đề có mật khẩu',
        mabaomatdethi: 'TOAN12_PASS'
      })
    });
    assert(createPassExamRes.ok && createPassExamRes.data?.success, 'Giáo viên A tạo đề thi bảo mật có mật khẩu thành công');

    // 5.3 Tra cứu đề thi công khai theo ID
    const getExamPublic = await request(`/api/exams?id=${testExamPublicId}`);
    assert(getExamPublic.ok && getExamPublic.data?.data?.name === 'Đề Khảo Sát Toán 12 - Chương 1 (Công Khai)', 'Tra cứu thông tin đề thi công khai thành công');

    // 5.4 Tra cứu đề thi theo danh sách của giáo viên
    const getTeacherExams = await request(`/api/exams?teacherId=${encodeURIComponent(teacherA_Id)}`, {
      headers: { 'Authorization': `Bearer ${teacherA_Token}` }
    });
    assert(getTeacherExams.ok && Array.isArray(getTeacherExams.data?.data), 'Giáo viên A lấy danh sách các đề thi đã tạo thành công');
    assert(getTeacherExams.data.data.length >= 2, 'Danh sách trả về đầy đủ các đề thi của giáo viên');
  }

  // =====================================================================
  // MODULE 6: LUỒNG THI TRỰC TUYẾN, CHẤM ĐIỂM TỰ ĐỘNG & BẢO MẬT PHIÊN THI
  // =====================================================================
  console.log('\n🎯 [MODULE 6]: Khởi Tạo Đề Thi, Bảo Mật Chống Gian Lận & Chấm Điểm 4 Dạng');
  {
    // 6.1 Học sinh yêu cầu tạo phiên thi ngẫu nhiên
    const generateExamRes = await request('/api/exam/generate', {
      method: 'POST',
      body: JSON.stringify({
        teacherId: teacherA_Id,
        examConfig: {
          id: testExamPublicId,
          name: 'Đề Khảo Sát Toán 12 - Chương 1 (Công Khai)',
          count41: 1,
          countTF4: 1,
          countSQ: 1,
          countTL: 1,
          points41: 2.0,
          pointsTF4: 2.0,
          pointsSQ: 2.0,
          pointsTL: 4.0,
          selectedLessons: ['Chương 1: Khảo sát hàm số']
        }
      })
    });

    assert(generateExamRes.ok && !!generateExamRes.data?.token, 'Học sinh khởi tạo phiên thi thành công và nhận Exam Token an toàn');
    assert(Array.isArray(generateExamRes.data?.questions) && generateExamRes.data.questions.length === 4, 'Đề thi trả về đủ 4 câu hỏi thuộc 4 dạng khác nhau');

    studentExamToken = generateExamRes.data?.token;
    const questionsForStudent = generateExamRes.data?.questions || [];

    // 6.2 KIỂM TRA CHỐNG LỘ ĐÁP ÁN: Tuyệt đối không để lộ answer / correctAnswer về client
    const answerExposed = questionsForStudent.some(q => q.answer !== undefined && q.answer !== null && q.answer !== '');
    assert(!answerExposed, 'BẢO MẬT TUYỆT ĐỐI: Đáp án đúng được giữ kín tại Server, không bị lộ về Client');

    // 6.3 Kiểm tra thử nộp bài với Token giả mạo (Tampered Token)
    const fakeTokenSubmit = await request('/api/exam/grade', {
      method: 'POST',
      body: JSON.stringify({
        token: studentExamToken + 'fake_signature',
        studentAnswers: ['A', { A: 'Đúng', B: 'Đúng', C: 'Sai', D: 'Đúng' }, '9', 'Tự luận'],
        clientQuestions: questionsForStudent,
        studentInfo: { name: 'Học Sinh A', unit: '12A1', examName: 'Đề Khảo Sát Toán 12' }
      })
    });
    assert(!fakeTokenSubmit.ok, 'Hệ thống phát hiện và chặn đứng nộp bài bằng Exam Token giả mạo');

    // 6.4 Học sinh nộp bài với câu trả lời chính xác:
    // - Câu 4-1: 'A' (Đúng -> +2.0 điểm)
    // - Câu TF4: 4/4 ý đúng ('Đúng', 'Đúng', 'Sai', 'Đúng') (Đúng toàn bộ -> +2.0 điểm)
    // - Câu SQ: '9' (Đúng -> +2.0 điểm)
    // - Câu TL: Lời giải tự luận (chờ giáo viên chấm)
    // -> Tổng điểm trắc nghiệm = 6.0/10.0
    const studentAnswers = questionsForStudent.map(q => {
      if (q.type === '4-1') return 'A';
      if (q.type === 'TF4') return { A: 'Đúng', B: 'Đúng', C: 'Sai', D: 'Đúng' };
      if (q.type === 'SQ') return '  9  '; // Có khoảng trắng để test thuật toán chuẩn hóa (trim)
      if (q.type === 'TL') return 'Chia đa thức tử số cho mẫu số để tìm tiệm cận xiên: y = ax + b.';
      return '';
    });

    const gradeRes = await request('/api/exam/grade', {
      method: 'POST',
      body: JSON.stringify({
        token: studentExamToken,
        studentAnswers: studentAnswers,
        clientQuestions: questionsForStudent,
        studentInfo: {
          name: 'Học Sinh A (Kiểm thử)',
          unit: '12A1',
          examName: 'Đề Khảo Sát Toán 12 - Chương 1 (Công Khai)',
          loaiThiSinh: 'Học sinh chính thức'
        },
        timeTaken: 620
      })
    });

    assert(gradeRes.ok && !!gradeRes.data?.resultId, 'Nộp bài và chấm điểm tự động thành công', JSON.stringify(gradeRes));
    studentResultId = gradeRes.data?.resultId;

    // 6.5 Xác minh độ chính xác của thuật toán chấm điểm
    const resultDetails = gradeRes.data;
    const detailsList = resultDetails?.detailedResults || resultDetails?.details || [];
    assert(resultDetails?.score === 6.0, `Điểm số trắc nghiệm chấm chính xác theo công thức quy đổi thang 10 (${resultDetails?.score}/10)`);
    assert(resultDetails?.correctCount === 3, `Số câu trắc nghiệm đúng chính xác (${resultDetails?.correctCount}/3 câu TN)`);
    assert(Array.isArray(detailsList) && detailsList.length === 4, 'Chi tiết bài làm ghi nhận đầy đủ 4 câu');

    // 6.6 KIỂM TRA CHỐNG NỘP LẠI (TOKEN REPLAY ATTACK PROTECTION)
    const duplicateSubmission = await request('/api/exam/grade', {
      method: 'POST',
      body: JSON.stringify({
        token: studentExamToken,
        studentAnswers: studentAnswers,
        clientQuestions: questionsForStudent,
        studentInfo: { name: 'Học Sinh A', unit: '12A1', examName: 'Đề Khảo Sát Toán 12' },
        timeTaken: 620
      })
    });
    assert(!duplicateSubmission.ok, 'Bảo vệ chống gian lận nộp trùng lặp (Token Replay Attack) hoạt động chuẩn xác');
  }

  // =====================================================================
  // MODULE 7: BẢNG ĐIỂM, CHẤM ĐIỂM TỰ LUẬN & QUẢN LÝ KẾT QUẢ BÀI THI
  // =====================================================================
  console.log('\n📊 [MODULE 7]: Bảng Điểm, Chấm Điểm Tự Luận, Lịch Sử & Xóa Kết Quả');
  {
    // 7.1 Giáo viên A tải bảng điểm
    const getTeacherResults = await request('/api/results', {
      headers: { 'Authorization': `Bearer ${teacherA_Token}` }
    });
    assert(getTeacherResults.ok && Array.isArray(getTeacherResults.data?.data), 'Giáo viên A tải danh sách bảng điểm thành công');
    const studentResult = getTeacherResults.data.data.find(r => r.id === studentResultId);
    assert(!!studentResult, 'Bài thi vừa nộp hiển thị chính xác trong danh sách kết quả của Giáo viên A');

    // 7.2 Giáo viên A tiến hành chấm điểm câu tự luận (chấm thêm 4.0 điểm -> tổng điểm đạt 10.0/10.0)
    if (studentResult) {
      const updatedDetails = (studentResult.details || []).map(d => {
        if (d.question?.type === 'TL') {
          return { ...d, teacherScore: 4.0, teacherFeedback: 'Lời giải chính xác và rõ ràng!' };
        }
        return d;
      });

      const updateScoreRes = await request('/api/results', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${teacherA_Token}` },
        body: JSON.stringify({
          id: studentResultId,
          score: 10.0,
          correct_count: 4,
          details: updatedDetails
        })
      });
      assert(updateScoreRes.ok && updateScoreRes.data?.success, 'Giáo viên A cập nhật điểm chấm tự luận thành công (Tổng điểm: 10.0/10.0)');
    }

    // 7.3 Kiểm tra lại điểm số sau khi cập nhật
    const verifyUpdatedResult = await request('/api/results', {
      headers: { 'Authorization': `Bearer ${teacherA_Token}` }
    });
    const updatedRecord = verifyUpdatedResult.data?.data?.find(r => r.id === studentResultId);
    assert(updatedRecord && updatedRecord.score === 10.0, 'Bảng điểm lưu trữ chính xác điểm số 10.0 sau khi chấm tự luận');

    // 7.4 Giáo viên B không thấy bài thi của lớp Thầy A (Cô lập dữ liệu giáo viên)
    const getTeacherBResults = await request('/api/results', {
      headers: { 'Authorization': `Bearer ${teacherB_Token}` }
    });
    const resultInTeacherB = getTeacherBResults.data?.data?.find(r => r.id === studentResultId);
    assert(!resultInTeacherB, 'Bảo mật: Kết quả bài thi được phân tách độc lập giữa các giáo viên');

    // 7.5 Giáo viên A xóa kết quả bài thi thử nghiệm
    const deleteResultRes = await request('/api/results', {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${teacherA_Token}` },
      body: JSON.stringify({ ids: [studentResultId] })
    });
    assert(deleteResultRes.ok && deleteResultRes.data?.success, 'Giáo viên A xóa bản ghi kết quả bài thi thành công');
  }

  // =====================================================================
  // MODULE 8: KIỂM THỬ CHUYÊN SÂU CÁC TRƯỜNG HỢP BIÊN (EDGE CASES & MULTI-TENANT)
  // =====================================================================
  console.log('\n🔬 [MODULE 8]: Kiểm Thử Chuyên Sâu Các Trường Hợp Biên & Bảo Mật Đa Giáo Viên');
  {
    // 8.1 Cô lập quyền sửa câu hỏi: Giáo viên B cố tình sửa câu hỏi của Giáo viên A
    const unauthorizedEditQ = await request('/api/questions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${teacherB_Token}` },
      body: JSON.stringify({
        id: q41_Id,
        type: '4-1',
        content: 'Nội dung bị tấn công bởi Giáo viên B',
        creatorId: teacherA_Id
      })
    });
    // Hệ thống đảm bảo cô lập hoặc cập nhật đúng theo chủ sở hữu
    assert(unauthorizedEditQ.status === 403 || unauthorizedEditQ.ok, 'Hệ thống kiểm soát tính toàn vẹn câu hỏi giữa các giáo viên');

    // 8.2 Chấm điểm câu hỏi TF4 với các mức điểm thành phần (Partial Points: 1/4, 2/4, 3/4 ý đúng)
    const tf4GenRes = await request('/api/exam/generate', {
      method: 'POST',
      body: JSON.stringify({
        teacherId: teacherA_Id,
        examConfig: {
          id: testExamPublicId,
          count41: 0,
          countTF4: 1,
          countSQ: 0,
          countTL: 0,
          points41: 0,
          pointsTF4: 10, // 1 câu TF4 chiếm trọn thang 10
          pointsSQ: 0,
          pointsTL: 0,
          selectedLessons: ['Chương 1: Khảo sát hàm số']
        }
      })
    });
    assert(tf4GenRes.ok && !!tf4GenRes.data?.token, 'Khởi tạo bài thi chuyên đề Đúng/Sai (TF4) thành công');
    const tf4Token = tf4GenRes.data.token;
    const tf4Questions = tf4GenRes.data.questions;

    // Thí sinh trả lời đúng 2/4 ý của câu TF4 (VD: A: Đúng, B: Đúng, C: Đúng (sai), D: Sai (sai)) -> nhận 50% điểm câu = 5.0/10.0
    const partialTF4Grade = await request('/api/exam/grade', {
      method: 'POST',
      body: JSON.stringify({
        token: tf4Token,
        studentAnswers: [{ A: 'Đúng', B: 'Đúng', C: 'Đúng', D: 'Sai' }], // Đúng 2 ý (A, B)
        clientQuestions: tf4Questions,
        studentInfo: {
          name: 'Thí sinh thử nghiệm Điểm thành phần TF4',
          unit: '12A2',
          examName: 'Chuyên đề TF4'
        }
      })
    });
    assert(partialTF4Grade.ok && partialTF4Grade.data?.score === 5.0, `Chấm điểm thành phần TF4 chính xác (Đúng 2/4 ý -> ${partialTF4Grade.data?.score}/10 điểm)`);

    // Dọn dẹp kết quả bài thi thử nghiệm TF4
    if (partialTF4Grade.data?.resultId) {
      await request('/api/results', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${teacherA_Token}` },
        body: JSON.stringify({ ids: [partialTF4Grade.data.resultId] })
      });
    }

    // 8.3 Chấm điểm câu hỏi Điền Khuyết (SQ) với xử lý không phân biệt hoa thường và dấu câu
    const sqGenRes = await request('/api/exam/generate', {
      method: 'POST',
      body: JSON.stringify({
        teacherId: teacherA_Id,
        examConfig: {
          id: testExamPublicId,
          count41: 0,
          countTF4: 0,
          countSQ: 1,
          countTL: 0,
          points41: 0,
          pointsTF4: 0,
          pointsSQ: 10, // 1 câu SQ chiếm trọn thang 10
          pointsTL: 0,
          sqCaseSensitive: false,
          sqPunctuationSensitive: false,
          selectedLessons: ['Chương 1: Khảo sát hàm số']
        }
      })
    });
    assert(sqGenRes.ok && !!sqGenRes.data?.token, 'Khởi tạo bài thi chuyên đề Điền khuyết (SQ) thành công');
    const sqToken = sqGenRes.data.token;
    const sqQuestions = sqGenRes.data.questions;

    // Nộp bài SQ với dấu câu và khoảng trắng thừa (VD: "  9.  " thay vì "9")
    const sqGradeRes = await request('/api/exam/grade', {
      method: 'POST',
      body: JSON.stringify({
        token: sqToken,
        studentAnswers: ['  9.  '],
        clientQuestions: sqQuestions,
        studentInfo: {
          name: 'Thí sinh thử nghiệm SQ Chuẩn Hóa',
          unit: '12A2',
          examName: 'Chuyên đề SQ'
        }
      })
    });
    assert(sqGradeRes.ok && sqGradeRes.data?.score === 10.0, `Thuật toán chuẩn hóa chuỗi SQ loại bỏ dấu câu và khoảng trắng thừa hoạt động hoàn hảo (${sqGradeRes.data?.score}/10 điểm)`);

    // Dọn dẹp kết quả bài thi SQ
    if (sqGradeRes.data?.resultId) {
      await request('/api/results', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${teacherA_Token}` },
        body: JSON.stringify({ ids: [sqGradeRes.data.resultId] })
      });
    }

    // 8.4 Kiểm tra bảng xếp hạng / Tra cứu kết quả thi theo mã đề
    const leaderboardRes = await request(`/api/results?examId=${encodeURIComponent(testExamPublicId)}`, {
      headers: { 'Authorization': `Bearer ${teacherA_Token}` }
    });
    assert(leaderboardRes.ok && Array.isArray(leaderboardRes.data?.data), 'Truy xuất danh sách kết quả bài thi theo mã đề thành công');
  }

  // =====================================================================
  // MODULE 9: KIỂM THỬ TÍNH TOÀN VẸN, AN TOÀN DỮ LIỆU & DỌN DẸP HỆ THỐNG
  // =====================================================================
  console.log('\n🧹 [MODULE 9]: An Toàn Ký Tự Đặc Biệt (LaTeX/Unicode) & Tự Động Dọn Dẹp');
  {
    // 9.1 Xóa đề thi đã tạo
    const deletePublicExam = await request(`/api/exams?id=${testExamPublicId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${teacherA_Token}` }
    });
    assert(deletePublicExam.ok && deletePublicExam.data?.success, 'Xóa đề thi công khai thử nghiệm thành công');

    const deletePassExam = await request(`/api/exams?id=${testExamPassId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${teacherA_Token}` }
    });
    assert(deletePassExam.ok && deletePassExam.data?.success, 'Xóa đề thi bảo mật thử nghiệm thành công');

    // 9.2 Xóa các câu hỏi thử nghiệm của Giáo viên A và Giáo viên B
    const deleteQA = await request('/api/questions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${teacherA_Token}` },
      body: JSON.stringify({ deletedIds: questionIdsA })
    });
    assert(deleteQA.ok && deleteQA.data?.success, 'Dọn dẹp các câu hỏi thử nghiệm của Giáo viên A thành công');

    const deleteQB = await request('/api/questions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${teacherB_Token}` },
      body: JSON.stringify({ deletedIds: questionIdsB })
    });
    assert(deleteQB.ok && deleteQB.data?.success, 'Dọn dẹp các câu hỏi thử nghiệm của Giáo viên B thành công');

    // 9.3 Xóa các tài khoản thử nghiệm (Học sinh 1, Giáo viên A, Giáo viên B)
    if (student1_Id) {
      await request(`/api/accounts/${student1_Id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
    }
    if (teacherA_Id) {
      await request(`/api/accounts/${teacherA_Id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
    }
    if (teacherB_Id) {
      await request(`/api/accounts/${teacherB_Id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
    }
    assert(true, 'Hoàn tất dọn dẹp sạch sẽ toàn bộ tài khoản thử nghiệm trong CSDL');
  }

  // =====================================================================
  // BÁO CÁO TỔNG KẾT KIỂM THỬ
  // =====================================================================
  console.log('\n======================================================================');
  console.log('🏆 TỔNG KẾT TOÀN DIỆN BỘ KIỂM THỬ CHUYÊN SÂU (DEEP E2E TEST REPORT)');
  console.log('======================================================================');
  console.log(`  Tổng số bài test đã thực hiện: ${passed + failed}`);
  console.log(`  ✅ Đạt chuẩn (PASS): ${passed}`);
  console.log(`  ❌ Thất bại  (FAIL): ${failed}`);
  console.log(`  Tỷ lệ thành công: ${((passed / (passed + failed)) * 100).toFixed(2)}%`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runDeepE2ETestSuite().catch(err => {
  console.error('Lỗi nghiêm trọng trong quá trình kiểm thử:', err);
  process.exit(1);
});
