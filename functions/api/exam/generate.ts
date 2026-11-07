import { consumeSecurityAttempt, clearSecurityAttempts } from '../../../src/security-rate-limit';
import { signJWT, verifyAuthSession, getDynamicSecret, getDatabase } from './utils';
import {makeGradeSessionConfig, accessCodeMatches} from './security';
import { examFlagEnabled, validateQuestionAnswer } from '../../../src/exam-grading-core.js';
import { EXAM_SESSION_PURPOSE_PRESTART, evaluateExamAccessWindow } from '../../../src/exam-time-authority.js';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DB?: any;
  JWT_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

const finiteNumber = (value: any, fallback = 1): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
    const { request, env } = context;
    const SECRET = await getDynamicSecret(db, env.JWT_SECRET);

    try {
        const body: any = await request.json();
        const { teacherId, examId, examName, examConfig } = body;
        const submittedAccessCode = body.examAccessCode;

        if (!teacherId) {
            return new Response(JSON.stringify({ error: 'Thiếu thông tin giáo viên (teacherId)' }), { status: 400, headers: corsHeaders });
        }

        // 1. TRUY VẤN CẤU HÌNH GỐC CHÍNH XÁC TRỰC TIẾP TỪ CSDL CLOUDFLARE D1
        // Tránh tuyệt đối tình trạng client bị lệch cache hay gửi nhầm dữ liệu đề cũ
        let dbExam: any = null;
        try {
            if (examId) {
                const { results } = await db.prepare("SELECT * FROM exam_configs WHERE id = ?").bind(examId).all();
                if (results && results.length > 0) {
                    dbExam = results[0];
                }
            }
            if (!dbExam && teacherId) {
                const searchName = (examName || examConfig?.name || '').trim().toLowerCase();
                if (searchName) {
                    const { results } = await db.prepare("SELECT * FROM exam_configs WHERE creator_id = ? ORDER BY updated_at DESC, created_at DESC").bind(teacherId).all();
                    if (results && results.length > 0) {
                        dbExam = results.find((row: any) => {
                            const rName = String(row.name || '').trim().toLowerCase();
                            return rName === searchName;
                        });
                    }
                }
            }
        } catch (dbErr) {
            console.error("Lỗi khi tìm cấu hình đề thi từ DB:", dbErr);
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

        // 2. PARSE CẤU HÌNH CHUẨN TỪ CSDL (HOẶC FALLBACK EXAMCONFIG NẾU LÀ ĐỀ TẠM CHƯA LƯU)
        let finalSelectedLessons: string[] = [];
        let finalCountsDetail: any = {};
        let targetCount41 = 0;
        let targetCountTF4 = 0;
        let targetCountSQ = 0;
        let targetCountTL = 0;
        let maxCheatWarningsFromDB = 5;
        let activeExamConfig: any = {};

        if (dbExam) {
            const mappedExam = mapRowRead(dbExam);
            if (Array.isArray(mappedExam.selected_lessons)) {
                finalSelectedLessons = mappedExam.selected_lessons;
            } else if (typeof mappedExam.selected_lessons === 'string') {
                try { finalSelectedLessons = JSON.parse(mappedExam.selected_lessons); } catch(e) { finalSelectedLessons = []; }
            }

            if (mappedExam.counts_detail && typeof mappedExam.counts_detail === 'object') {
                finalCountsDetail = mappedExam.counts_detail;
            } else if (typeof mappedExam.counts_detail === 'string') {
                try { finalCountsDetail = JSON.parse(mappedExam.counts_detail); } catch(e) { finalCountsDetail = {}; }
            }

            targetCount41 = Number(mappedExam.count_41 || 0);
            targetCountTF4 = Number(mappedExam.count_tf4 || 0);
            targetCountSQ = Number(mappedExam.count_sq || 0);
            targetCountTL = Number(mappedExam.count_tl || 0);

            if (mappedExam.max_cheat_warnings !== null && mappedExam.max_cheat_warnings !== undefined && !isNaN(Number(mappedExam.max_cheat_warnings))) {
                maxCheatWarningsFromDB = Math.max(1, Number(mappedExam.max_cheat_warnings));
            }

            activeExamConfig = {
                ...mappedExam,
                count41: targetCount41,
                countTF4: targetCountTF4,
                countSQ: targetCountSQ,
                countTL: targetCountTL,
                points41: finiteNumber(mappedExam.points_41 ?? mappedExam.points41, 1),
                pointsTF4: finiteNumber(mappedExam.points_tf4 ?? mappedExam.pointsTF4, 1),
                pointsSQ: finiteNumber(mappedExam.points_sq ?? mappedExam.pointsSQ, 1),
                pointsTL: finiteNumber(mappedExam.points_tl ?? mappedExam.pointsTL, 1),
                count41NB: Number(finalCountsDetail.count41NB || 0),
                count41TH: Number(finalCountsDetail.count41TH || 0),
                count41VD: Number(finalCountsDetail.count41VD || 0),
                countTF4NB: Number(finalCountsDetail.countTF4NB || 0),
                countTF4TH: Number(finalCountsDetail.countTF4TH || 0),
                countTF4VD: Number(finalCountsDetail.countTF4VD || 0),
                countSQNB: Number(finalCountsDetail.countSQNB || 0),
                countSQTH: Number(finalCountsDetail.countSQTH || 0),
                countSQVD: Number(finalCountsDetail.countSQVD || 0),
                countTLNB: Number(finalCountsDetail.countTLNB || 0),
                countTLTH: Number(finalCountsDetail.countTLTH || 0),
                countTLVD: Number(finalCountsDetail.countTLVD || 0),
                selectedLessons: finalSelectedLessons,
                maxCheatWarnings: maxCheatWarningsFromDB,
                immediate_feedback: mappedExam.immediate_feedback ?? 0,
                immediateFeedback: examFlagEnabled(mappedExam.immediate_feedback, false)
            };
        } else if (examConfig) {
            finalSelectedLessons = Array.isArray(examConfig.selectedLessons) ? examConfig.selectedLessons : (Array.isArray(examConfig.selected_lessons) ? examConfig.selected_lessons : []);
            finalCountsDetail = examConfig.countsDetail || examConfig.counts_detail || {};
            targetCount41 = Number(examConfig.count41 || 0);
            targetCountTF4 = Number(examConfig.countTF4 || 0);
            targetCountSQ = Number(examConfig.countSQ || 0);
            targetCountTL = Number(examConfig.countTL || 0);
            maxCheatWarningsFromDB = Math.max(1, Number(examConfig.maxCheatWarnings || 5));
            const immediateVal = examFlagEnabled(examConfig.immediateFeedback ?? examConfig.immediate_feedback, false) ? 1 : 0;
            activeExamConfig = { 
                ...examConfig, 
                count41: targetCount41,
                countTF4: targetCountTF4,
                countSQ: targetCountSQ,
                countTL: targetCountTL,
                points41: finiteNumber(examConfig.points41 ?? examConfig.points_41, 1),
                pointsTF4: finiteNumber(examConfig.pointsTF4 ?? examConfig.points_tf4, 1),
                pointsSQ: finiteNumber(examConfig.pointsSQ ?? examConfig.points_sq, 1),
                pointsTL: finiteNumber(examConfig.pointsTL ?? examConfig.points_tl, 1),
                immediate_feedback: immediateVal,
                immediateFeedback: Boolean(immediateVal === 1),
                maxCheatWarnings: maxCheatWarningsFromDB 
            };
        } else {
            return new Response(JSON.stringify({ error: 'Không tìm thấy thông tin cấu hình đề thi' }), { status: 400, headers: corsHeaders });
        }

        const hasFourDecimalPrecision = (value: any) => {
            const number = Number(value);
            return Number.isFinite(number) && Math.abs(number * 10000 - Math.round(number * 10000)) <= 1e-7;
        };
        // points_* are stored as PostgreSQL REAL. Four-decimal precision is
        // enforced when saving config; after a REAL round-trip we only validate
        // finiteness/range to avoid rejecting a valid stored score due to float noise.
        for (const [label, value] of [
            ['Trắc nghiệm', activeExamConfig.points41],
            ['Đúng/Sai', activeExamConfig.pointsTF4],
            ['Trả lời ngắn', activeExamConfig.pointsSQ],
            ['Tự luận', activeExamConfig.pointsTL]
        ] as any[]) {
            const point = Number(value);
            if (!Number.isFinite(point) || point < 0 || point > 1000) {
                return new Response(JSON.stringify({ error: `Điểm cấu hình ${label} không hợp lệ.` }), { status: 400, headers: corsHeaders });
            }
        }

        let activeTf4Points: any = activeExamConfig.tf4_points ?? activeExamConfig.tf4Points ?? null;
        if (typeof activeTf4Points === 'string' && activeTf4Points.trim()) {
            try { activeTf4Points = JSON.parse(activeTf4Points); } catch { activeTf4Points = null; }
        }
        if (activeTf4Points && typeof activeTf4Points === 'object' && !Array.isArray(activeTf4Points)) {
            const values = ['1','2','3','4'].map(key => Number(activeTf4Points[key]));
            if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1000 || !hasFourDecimalPrecision(value)) ||
                !(values[0] <= values[1] && values[1] <= values[2] && values[2] <= values[3])) {
                return new Response(JSON.stringify({
                    error: 'Bảng điểm Đúng/Sai tùy chỉnh không hợp lệ, không tăng dần hoặc có quá 4 chữ số thập phân.'
                }), { status: 400, headers: corsHeaders });
            }
        }

        const effectiveTeacherId = dbExam?.creator_id || teacherId;

        const authHeader = request.headers.get('Authorization');
        let tokenUser: any = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            try { 
                tokenUser = await verifyAuthSession(token, SECRET, db); 
                if (tokenUser && (tokenUser.id || tokenUser.user_id)) {
                    try {
                        const { results: uRows } = await db.prepare(
                            "SELECT donvi, lop, target_audience, full_name FROM users WHERE id = ? OR id = ? OR id IN (SELECT user_id FROM accounts WHERE id = ? OR id = ?)"
                        ).bind(tokenUser.user_id || '', tokenUser.id || '', tokenUser.id || '', tokenUser.user_id || '').all();
                        if (uRows && uRows.length > 0) {
                            const u: any = uRows[0];
                            if (u.donvi) tokenUser.donvi = u.donvi;
                            if (u.lop) tokenUser.lop = u.lop;
                            if (u.target_audience) tokenUser.target_audience = u.target_audience;
                            if (u.full_name) tokenUser.full_name = u.full_name;
                        }
                    } catch(e) {}
                }
            } catch(e) {}
        }
        const isAdmin = tokenUser && tokenUser.role === 'admin';
        const isTeacher = !!tokenUser && String(tokenUser.id) === String(dbExam?.creator_id || effectiveTeacherId) && (tokenUser.target_audience === 'Giáo viên' || tokenUser.role === 'teacher');

        // Khung giờ thi phải được kiểm tra trên máy chủ. Client chỉ có vai trò hiển thị.
        // Giáo viên sở hữu đề/Admin vẫn được quyền mở cấu hình ngoài khung giờ.
        if (!isAdmin && !isTeacher) {
            const accessWindow = evaluateExamAccessWindow(activeExamConfig, Date.now());
            if (!accessWindow.allowed) {
                const error = accessWindow.code === 'EXAM_NOT_STARTED'
                    ? 'Chưa đến thời gian được phép nhận đề thi.'
                    : accessWindow.code === 'EXAM_WINDOW_CLOSED'
                        ? 'Đã hết thời gian được phép nhận đề thi.'
                        : 'Cấu hình khung thời gian của đề thi không hợp lệ.';
                return new Response(JSON.stringify({ code: accessWindow.code, error }), { status: 403, headers: corsHeaders });
            }
        }

        if (dbExam && String(dbExam.creator_id) !== String(teacherId)) {
            return new Response(JSON.stringify({error:'Đề thi không thuộc giáo viên đã chọn'}), {status:403,headers:corsHeaders});
        }
        // BẢO VỆ CHỐNG LÀM GIẢ: Thí sinh chỉ được làm đề đã lưu trong CSDL, không được tự chế examConfig
        if (!dbExam && !isAdmin && !isTeacher) {
            return new Response(JSON.stringify({ error: 'Đề thi không tồn tại hoặc chưa được lưu trên hệ thống!' }), { status: 404, headers: corsHeaders });
        }

        if (dbExam?.chedodethi === 'Đề có mã bảo mật' && !isAdmin && !isTeacher) {
            const codeLimit = await consumeSecurityAttempt(db, request, 'exam-access-code', String(dbExam.id || examId || ''), {
                maxAttempts: 8, windowMs: 5 * 60_000, blockMs: 10 * 60_000
            });
            if (!codeLimit.allowed) {
                return new Response(JSON.stringify({
                    error:'Đã nhập sai mã bảo vệ quá nhiều lần. Vui lòng thử lại sau.',
                    code:'EXAM_ACCESS_CODE_RATE_LIMITED',
                    retry_after_seconds:codeLimit.retryAfterSeconds
                }), {status:429,headers:{...corsHeaders,'Retry-After':String(codeLimit.retryAfterSeconds)}});
            }
            if (!accessCodeMatches(submittedAccessCode, dbExam.mabaomatdethi)) {
                return new Response(JSON.stringify({error:'Mã bảo vệ đề thi không chính xác'}), {status:403,headers:corsHeaders});
            }
            await clearSecurityAttempts(db, 'exam-access-code', codeLimit.keyHash);
        }
        // KIỂM TRA QUYỀN TRUY CẬP ĐỐI VỚI ĐỀ CHO ĐƠN VỊ
        if (activeExamConfig.chedodethi === 'Đề cho đơn vị' || activeExamConfig.chedodethi === 'Đề thi cho đơn vị') {
            if (!isAdmin && !isTeacher) {
                // Đề theo đơn vị bắt buộc dùng danh tính đã xác thực. Không bao giờ
                // tin studentDonvi/userDonvi/studentClass do trình duyệt tự khai.
                if (!tokenUser) {
                    return new Response(JSON.stringify({
                        code: 'EXAM_UNIT_LOGIN_REQUIRED',
                        error: 'Đề thi này chỉ dành cho học sinh thuộc đơn vị được phân công. Vui lòng đăng nhập tài khoản học sinh để xác minh đơn vị.'
                    }), { status: 403, headers: corsHeaders });
                }

                const normalizeScopeValue = (value: any): string =>
                    String(value ?? '')
                        .normalize('NFKC')
                        .trim()
                        .toLocaleLowerCase('vi-VN')
                        .replace(/\s+/g, ' ');

                // Lấy đơn vị của giáo viên tạo đề từ CSDL; đây là nguồn tin cậy.
                const { results: teacherRows } = await db.prepare(
                    "SELECT donvi FROM users WHERE id = ? OR id IN (SELECT user_id FROM accounts WHERE id = ?)"
                ).bind(effectiveTeacherId, effectiveTeacherId).all();
                const teacherDonvi = normalizeScopeValue((teacherRows?.[0] as any)?.donvi || '');

                let allowedUnits: string[] = [];
                const rawAC = activeExamConfig.access_control || activeExamConfig.accessControl;
                if (rawAC) {
                    try {
                        const ac = typeof rawAC === 'object' ? rawAC : JSON.parse(rawAC);
                        if (ac && ac.allowedUnits) {
                            allowedUnits = (Array.isArray(ac.allowedUnits) ? ac.allowedUnits : [ac.allowedUnits])
                                .map((u: any) => normalizeScopeValue(u))
                                .filter(Boolean);
                        }
                    } catch(e) {
                        return new Response(JSON.stringify({
                            code: 'EXAM_UNIT_SCOPE_INVALID',
                            error: 'Cấu hình đơn vị được phép của đề thi không hợp lệ. Hệ thống chưa cho phép bắt đầu để tránh cấp sai quyền.'
                        }), { status: 409, headers: corsHeaders });
                    }
                }

                const verifiedUserDonvi = normalizeScopeValue(tokenUser.donvi || '');
                const configuredUnits = [
                    activeExamConfig.target_donvi,
                    activeExamConfig.targetDonvi,
                    activeExamConfig.donvi
                ].map((u: any) => normalizeScopeValue(u)).filter(Boolean);
                const allowedUnitSet = new Set<string>([
                    ...(teacherDonvi ? [teacherDonvi] : []),
                    ...configuredUnits,
                    ...allowedUnits
                ]);

                // Fail-closed nếu đề khai báo "cho đơn vị" nhưng không xác định được
                // bất kỳ đơn vị tin cậy nào từ giáo viên hoặc cấu hình.
                if (allowedUnitSet.size === 0) {
                    return new Response(JSON.stringify({
                        code: 'EXAM_UNIT_SCOPE_INVALID',
                        error: 'Đề thi chưa xác định được đơn vị được phép. Vui lòng liên hệ giáo viên để kiểm tra cấu hình.'
                    }), { status: 409, headers: corsHeaders });
                }

                if (!verifiedUserDonvi || !allowedUnitSet.has(verifiedUserDonvi)) {
                    return new Response(JSON.stringify({
                        code: 'EXAM_UNIT_MISMATCH',
                        error: 'Bạn không có quyền làm đề thi này do đơn vị/trường của tài khoản không thuộc phạm vi được phép.'
                    }), { status: 403, headers: corsHeaders });
                }

                const targetLop = String(activeExamConfig.target_lop || activeExamConfig.lop || '').trim();
                if (targetLop) {
                    // Chỉ chuẩn hóa Unicode, chữ hoa/thường, khoảng trắng và tiền tố "Lớp".
                    // Không dùng includes/endsWith vì có thể làm lớp ngắn khớp nhầm lớp khác.
                    const normalizeLop = (value: any): string =>
                        normalizeScopeValue(value)
                            .replace(/^lớp\s*/u, '')
                            .replace(/\s+/g, '');
                    const userLop = normalizeLop(tokenUser.lop || '');
                    const allowedLops = targetLop
                        .split(/[,;\n]+/)
                        .map((s: string) => normalizeLop(s))
                        .filter(Boolean);
                    const isLopMatched = Boolean(userLop) && allowedLops.includes(userLop);
                    if (!isLopMatched) {
                        return new Response(JSON.stringify({
                            code: 'EXAM_CLASS_MISMATCH',
                            error: `Bạn không có quyền làm đề thi này do lớp của tài khoản không thuộc phạm vi được phép (Lớp yêu cầu: ${targetLop}).`
                        }), { status: 403, headers: corsHeaders });
                    }
                }
            }
        }

        // KIỂM TRA GIỚI HẠN SỐ LẦN LÀM BÀI (max_attempts)
        const maxAttemptsVal = (dbExam && dbExam.max_attempts !== null && dbExam.max_attempts !== undefined)
            ? Number(dbExam.max_attempts)
            : Number(activeExamConfig.max_attempts || activeExamConfig.maxAttempts || 0);

        if (maxAttemptsVal > 0 && !isAdmin && !isTeacher) {
            const studentUserIdVal = tokenUser?.user_id || tokenUser?.id || null;
            const targetExamIdStr = String(activeExamConfig.id || examId || '').trim();

            // Khi có giới hạn lượt, định danh bằng tên là không đủ an toàn: hai học sinh
            // trùng tên có thể bị cộng lượt của nhau. Bắt buộc tài khoản đã xác thực.
            if (!studentUserIdVal) {
                return new Response(JSON.stringify({
                    code: 'EXAM_ATTEMPT_LOGIN_REQUIRED',
                    maxAttempts: maxAttemptsVal,
                    error: 'Đề thi có giới hạn số lần làm. Vui lòng đăng nhập tài khoản học sinh để hệ thống đếm lượt chính xác.'
                }), { status: 403, headers: corsHeaders });
            }
            if (!targetExamIdStr) {
                return new Response(JSON.stringify({
                    code: 'EXAM_ATTEMPT_SCOPE_INVALID',
                    error: 'Không thể xác định chính xác đề thi để kiểm tra số lần làm. Hệ thống chưa cho phép bắt đầu.'
                }), { status: 409, headers: corsHeaders });
            }

            let attemptCount = 0;
            try {
                const canonicalUserId = String(studentUserIdVal);
                const attemptRow: any = await db.prepare(
                    `SELECT COUNT(*) AS count
                     FROM results
                     WHERE exam_id = ? AND user_id = ?`
                ).bind(targetExamIdStr, canonicalUserId).first();
                attemptCount = Math.max(0, Number(attemptRow?.count) || 0);

                // Tương thích dữ liệu lịch sử chưa có user_id nhưng chỉ khi hồ sơ
                // họ tên + lớp + đơn vị xác định DUY NHẤT một học sinh. Không bao giờ
                // fallback chỉ theo tên vì có thể khóa nhầm học sinh trùng tên.
                const profile: any = await db.prepare(
                    'SELECT full_name, lop, donvi FROM users WHERE id = ? LIMIT 1'
                ).bind(canonicalUserId).first();
                const profileName = String(profile?.full_name || tokenUser?.full_name || '').trim();
                const profileClass = String(profile?.lop || tokenUser?.lop || '').trim();
                const profileUnit = String(profile?.donvi || tokenUser?.donvi || '').trim();
                if (profileName && profileClass && profileUnit) {
                    const normalizeLegacyUnit = (value: any): string =>
                        String(value || '')
                            .normalize('NFKC')
                            .toLocaleLowerCase('vi-VN')
                            .normalize('NFD')
                            .replace(/[\u0300-\u036f]/g, '')
                            .replace(/đ/g, 'd')
                            .trim()
                            .replace(/^truong\s+/u, '')
                            .replace(/^trung\s+hoc\s+pho\s+thong\s+/u, '')
                            .replace(/^thpt\s+/u, '')
                            .replace(/^truong\s+thpt\s+/u, '')
                            .replace(/\s+/g, ' ');
                    const canonicalProfileUnit = normalizeLegacyUnit(profileUnit);

                    const { results: profileCandidates } = await db.prepare(
                        `SELECT id, donvi FROM users
                         WHERE LOWER(TRIM(full_name)) = LOWER(TRIM(?))
                           AND LOWER(TRIM(COALESCE(lop,''))) = LOWER(TRIM(?))`
                    ).bind(profileName, profileClass).all();
                    const matchingProfiles = (profileCandidates || []).filter((row: any) =>
                        normalizeLegacyUnit(row?.donvi) === canonicalProfileUnit
                    );

                    if (matchingProfiles.length === 1 &&
                        String((matchingProfiles[0] as any)?.id || '') === canonicalUserId) {
                        const { results: legacyRows } = await db.prepare(
                            `SELECT don_vi FROM results
                             WHERE exam_id = ?
                               AND (user_id IS NULL OR TRIM(user_id) = '')
                               AND LOWER(TRIM(student_name)) = LOWER(TRIM(?))
                               AND LOWER(TRIM(COALESCE(lop,''))) = LOWER(TRIM(?))`
                        ).bind(targetExamIdStr, profileName, profileClass).all();
                        attemptCount += (legacyRows || []).filter((row: any) =>
                            normalizeLegacyUnit(row?.don_vi) === canonicalProfileUnit
                        ).length;
                    }
                }
            } catch(err) {
                console.error("Lỗi kiểm tra số lần làm bài:", err);
                return new Response(JSON.stringify({
                    code: 'EXAM_ATTEMPT_COUNT_UNAVAILABLE',
                    error: 'Không thể xác minh số lần làm bài hiện tại. Hệ thống chưa mở bài thi để tránh tính sai quyền lợi học sinh.'
                }), { status: 503, headers: corsHeaders });
            }

            if (attemptCount >= maxAttemptsVal) {
                return new Response(JSON.stringify({
                    code: 'EXAM_ATTEMPT_LIMIT_REACHED', attemptCount, maxAttempts: maxAttemptsVal,
                    error: `Bạn đã đạt giới hạn số lần làm bài thi này! (Bạn đã hoàn thành ${attemptCount} lần / Tối đa ${maxAttemptsVal} lần làm bài quy định).`
                }), { status: 403, headers: corsHeaders });
            }
        }

        // Chuẩn hóa và đối sánh bài học chính xác tuyệt đối 100%
        const normalizeLesson = (l: any): string => {
            if (!l) return '';
            return String(l).trim().toLowerCase().replace(/\s+/g, ' ');
        };

        const removeVietnameseTones = (str: string): string => {
            if (!str) return '';
            return str
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/đ/g, 'd')
                .replace(/Đ/g, 'D');
        };

        const normalizeLessonKey = (l: any): string => {
            if (!l) return '';
            return removeVietnameseTones(String(l).trim().toLowerCase())
                .replace(/[^a-z0-9]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        };

        const isQuestionInSelectedLessons = (qLessonRaw: string) => {
            if (!finalSelectedLessons || finalSelectedLessons.length === 0) return true;
            const qRaw = String(qLessonRaw || '').trim();
            if (!qRaw) return false;

            const qNorm = normalizeLesson(qRaw);
            const qKey = normalizeLessonKey(qRaw);

            for (const allowed of finalSelectedLessons) {
                const aRaw = String(allowed || '').trim();
                if (!aRaw) continue;

                // 1. So khớp chính xác chuỗi nguyên bản
                if (qRaw === aRaw) return true;

                // 2. So khớp chữ thường & chuẩn hóa khoảng trắng
                const aNorm = normalizeLesson(aRaw);
                if (qNorm === aNorm) return true;

                // 3. So khớp không dấu
                const aKey = normalizeLessonKey(aRaw);
                if (qKey === aKey) return true;
            }
            return false;
        };

        // QUY TẮC SỐNG CÒN 1: ĐỀ THI BẮT BUỘC PHẢI CÓ BÀI HỌC ĐƯỢC CHỌN TRONG CẤU HÌNH.
        if (!finalSelectedLessons || finalSelectedLessons.length === 0) {
            return new Response(JSON.stringify({
                error: 'Đề thi này chưa được chọn Bài học/Chuyên đề trong cấu hình cài đặt. Vui lòng vào cấu hình đề thi và tích chọn ít nhất 1 bài học!'
            }), { status: 400, headers: corsHeaders });
        }

        // LẤY TẤT CẢ CÂU HỎI CỦA GIÁO VIÊN NÀY TỪ CƠ SỞ DỮ LIỆU (Hỗ trợ cả trường hợp câu hỏi tạo theo user_id hoặc account_id)
        let allQuestions: any[] = [];
        try {
            if (effectiveTeacherId) {
                const { results } = await db.prepare(
                    'SELECT * FROM questions WHERE creator_id = ? OR creator_id IN (SELECT user_id FROM accounts WHERE id = ?) OR creator_id IN (SELECT id FROM accounts WHERE user_id = ?)'
                ).bind(String(effectiveTeacherId), String(effectiveTeacherId), String(effectiveTeacherId)).all();
                allQuestions = results || [];
            }
            // Never fall back to another teacher's question bank. An empty scoped
            // pool is a hard error and must be reported to the exam creator.
        } catch(err: any) {
            return new Response(JSON.stringify({ error: 'Lỗi truy vấn ngân hàng câu hỏi: ' + err.message }), { status: 500, headers: corsHeaders });
        }

        if (!allQuestions || allQuestions.length === 0) {
            return new Response(JSON.stringify({ error: 'Không tìm thấy câu hỏi nào trong ngân hàng đề!' }), { status: 404, headers: corsHeaders });
        }

        // CHUẨN HÓA LOẠI CÂU HỎI VÀ MỨC ĐỘ
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

        // LỌC BỎ NGAY LẬP TỨC 100% CÁC CÂU HỎI THUỘC BÀI KHÁC HOẶC KHÔNG CÓ BÀI HỌC
        const seenQuestionIds = new Set<string>();
        const validPool = allQuestions
            .map(mapRowRead)
            .filter(q => {
                const qId = String(q.id || '');
                if (!qId || seenQuestionIds.has(qId)) return false;
                const contentStr = String(q.content || '').trim();
                if (!contentStr) return false;
                seenQuestionIds.add(qId);
                return true;
            })
            .map(q => ({
                id: q.id,
                type: normalizeType(q.type),
                level: normalizeLevel(q.level),
                lesson: q.lesson,
                content: q.content,
                options: q.options || {},
                answer: q.answer,
                image: q.image || '',
                creatorId: q.creator_id
            }))
            .filter(q => {
                if (!isQuestionInSelectedLessons(q.lesson)) return false;
                const verdict = validateQuestionAnswer(q.type, q.answer, q.options);
                if (!verdict.ok) return false;
                if (q.type === '4-1') {
                    return ['A','B','C','D'].every(key => {
                        const option: any = q.options && q.options[key];
                        const text = option && typeof option === 'object'
                            ? String(option.text ?? option.content ?? option.value ?? '').trim()
                            : String(option ?? '').trim();
                        const image = option && typeof option === 'object'
                            ? String(option.image ?? option.img ?? option.src ?? option.url ?? '').trim()
                            : '';
                        return Boolean(text || image);
                    });
                }
                return true;
            });

        const totalRequired = targetCount41 + targetCountTF4 + targetCountSQ + targetCountTL;
        if (totalRequired === 0) {
            return new Response(JSON.stringify({ error: 'Cấu hình đề thi chưa có số lượng câu hỏi nào (> 0)!' }), { status: 400, headers: corsHeaders });
        }

        const shuffle = (arr: any[]) => [...arr].sort(() => Math.random() - 0.5);
        let selectedQuestions: any[] = [];

        // THUẬT TOÁN BỐC CÂU HỎI ĐÚNG CẤU HÌNH VÀ TUYỆT ĐỐI KHÔNG BỐC NGOÀI BÀI HỌC
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

                // Nếu số câu theo mức độ NB/TH/VD chưa đủ targetCount (do kho thiếu mức độ chi tiết đó):
                // Tự động bù từ các câu hỏi CÒN LẠI CỦA CÙNG DẠNG BÀI ĐÓ VÀ CÙNG BÀI HỌC ĐÃ CHỌN
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
                // Bốc theo số lượng tổng của dạng bài đó trong các bài học đã chọn
                selectedQuestions.push(...shuffle(pool).slice(0, targetCount));
            }
        };

        // Bốc từng dạng bài theo đúng cấu hình cài đặt
        const cDetail = finalCountsDetail;
        try {
            pickCategory('4-1', 'Trắc nghiệm 4 lựa chọn', targetCount41, Number(cDetail.count41NB || 0), Number(cDetail.count41TH || 0), Number(cDetail.count41VD || 0));
            pickCategory('TF4', 'Đúng - Sai', targetCountTF4, Number(cDetail.countTF4NB || 0), Number(cDetail.countTF4TH || 0), Number(cDetail.countTF4VD || 0));
            pickCategory('SQ', 'Trả lời ngắn', targetCountSQ, Number(cDetail.countSQNB || 0), Number(cDetail.countSQTH || 0), Number(cDetail.countSQVD || 0));
            pickCategory('TL', 'Tự luận', targetCountTL, Number(cDetail.countTLNB || 0), Number(cDetail.countTLTH || 0), Number(cDetail.countTLVD || 0));
        } catch (pickErr: any) {
            return new Response(JSON.stringify({ error: pickErr.message }), { status: 400, headers: corsHeaders });
        }

        // BẢO ĐẢM ĐÚNG 100% SỐ LƯỢNG CÂU HỎI
        if (selectedQuestions.length !== totalRequired) {
            return new Response(JSON.stringify({
                error: `Số lượng câu hỏi bốc được (${selectedQuestions.length} câu) không khớp với cấu hình đề thi (${totalRequired} câu)!`
            }), { status: 400, headers: corsHeaders });
        }

        // QUY TẮC SỐNG CÒN 2: CHỐT CHẶN BẢO MẬT CUỐI CÙNG
        // 100% CÂU HỎI ĐƯỢC BỐC PHẢI THUỘC BÀI HỌC ĐÃ ĐƯỢC CẤU HÌNH
        const invalidQs = selectedQuestions.filter(q => !isQuestionInSelectedLessons(q.lesson));
        if (invalidQs.length > 0) {
            return new Response(JSON.stringify({
                error: `LỖI HỆ THỐNG: Phát hiện ${invalidQs.length} câu hỏi không thuộc bài học đã cấu hình!`
            }), { status: 500, headers: corsHeaders });
        }

        selectedQuestions = shuffle(selectedQuestions);

        const isImmediateFeedback = examFlagEnabled(
            activeExamConfig.immediateFeedback ?? activeExamConfig.immediate_feedback,
            false
        );

        // Bước generate chỉ chuẩn bị và kiểm tra đề trên server. Tuyệt đối chưa
        // gửi nội dung câu hỏi xuống trình duyệt trước khi server ghi started_at.
        // Immediate Feedback vẫn được giữ nguyên, nhưng chỉ được kích hoạt sau /exam/start.
        const questionIds: any[] = selectedQuestions.map((q) => q.id);

        // Thời lượng phiên thi phải lấy từ cấu hình CSDL đã xác thực và được đóng băng
        // ngay khi phát đề. Client không được tiếp tục phụ thuộc vào examConfig có thể thay đổi.
        const rawTimeLimit = Number(activeExamConfig.time_limit ?? activeExamConfig.timeLimit ?? 45);
        const timeLimitMinutes = Number.isFinite(rawTimeLimit) && rawTimeLimit > 0 ? rawTimeLimit : 45;
        const timeLimitSeconds = Math.max(1, Math.round(timeLimitMinutes * 60));

        // Freeze the exact grading key server-side at issue time. Never put answers in
        // the JWT because a signed JWT is readable by the browser.
        const gradeSessionConfig = makeGradeSessionConfig(activeExamConfig);
        const gradingSessionId = crypto.randomUUID();
        const expiresAtEpoch = Math.floor(Date.now() / 1000) + Math.max(3600, Math.min(8 * 3600, timeLimitSeconds + 3600));
        const expiresAt = new Date(expiresAtEpoch * 1000).toISOString();

        try {
            await db.prepare(`
                CREATE TABLE IF NOT EXISTS _exam_grade_sessions (
                    session_id TEXT PRIMARY KEY,
                    exam_id TEXT,
                    teacher_id TEXT,
                    question_ids TEXT NOT NULL,
                    question_snapshot TEXT NOT NULL,
                    exam_config TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    started_at TEXT,
                    deadline_at TEXT
                )
            `).run();
            for (const sql of [
                'ALTER TABLE _exam_grade_sessions ADD COLUMN IF NOT EXISTS started_at TEXT',
                'ALTER TABLE _exam_grade_sessions ADD COLUMN IF NOT EXISTS deadline_at TEXT'
            ]) {
                try { await db.prepare(sql).run(); } catch {}
            }
            // Best-effort cleanup keeps the ephemeral snapshot table bounded.
            try {
                await db.prepare('DELETE FROM _exam_grade_sessions WHERE expires_at < ?')
                    .bind(new Date().toISOString()).run();
            } catch (cleanupErr) {
                console.warn('Could not clean expired grading sessions:', cleanupErr);
            }
            await db.prepare(`
                INSERT INTO _exam_grade_sessions
                    (session_id, exam_id, teacher_id, question_ids, question_snapshot, exam_config, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                gradingSessionId,
                String(activeExamConfig.id || examId || ''),
                String(effectiveTeacherId || ''),
                JSON.stringify(questionIds.map((id: any) => String(id))),
                JSON.stringify(selectedQuestions),
                JSON.stringify(gradeSessionConfig),
                new Date().toISOString(),
                expiresAt
            ).run();
        } catch (snapshotErr: any) {
            console.error('Unable to freeze grading snapshot:', snapshotErr);
            return new Response(JSON.stringify({
                error: 'Không thể khóa đáp án chấm điểm cho phiên thi. Bài thi chưa được phát để bảo đảm quyền lợi học sinh.'
            }), { status: 503, headers: corsHeaders });
        }

        // The server-side snapshot may contain private grading instructions.
        // Strip those fields from the readable JWT returned to the browser.
        const { aiPrompt: _aiPrompt, ai_prompt: _aiPromptSnake, ...tokenGradeSessionConfig } = gradeSessionConfig;

        const payload = {
            purpose: EXAM_SESSION_PURPOSE_PRESTART,
            questionIds,
            gradingSessionId,
            studentUserId: tokenUser?.user_id || tokenUser?.id || null,
            examConfig: tokenGradeSessionConfig,
            maxCheatWarnings: maxCheatWarningsFromDB,
            timeLimitSeconds,
            immediateFeedback: isImmediateFeedback,
            teacherId: effectiveTeacherId,
            timestamp: Date.now(),
            exp: expiresAtEpoch
        };

        const token = await signJWT(payload, SECRET);

        return new Response(JSON.stringify({
            ready: true,
            questionCount: questionIds.length,
            token,
            examName: activeExamConfig.name || dbExam?.name || examName || '',
            maxCheatWarnings: maxCheatWarningsFromDB,
            timeLimitMinutes,
            timeLimitSeconds,
            immediateFeedback: isImmediateFeedback
        }), {
            status: 200,
            headers: corsHeaders
        });

    } catch (err: any) {
        if (err && err.message && err.message.includes("hạn mức dữ liệu")) {
            return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: corsHeaders });
        }
        console.error("Lỗi POST /api/exam/generate (Cloudflare Functions):", err);
        return new Response(JSON.stringify({ error: err.message || 'Lỗi xử lý tạo đề thi' }), { status: 500, headers: corsHeaders });
    }
};
