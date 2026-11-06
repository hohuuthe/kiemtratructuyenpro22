import { signJWT, verifyAuthSession, getDynamicSecret, getDatabase } from './utils';
import {makeGradeSessionConfig, accessCodeMatches} from './security';

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
                points41: Number(mappedExam.points_41 ?? mappedExam.points41 ?? 1) || 1,
                pointsTF4: Number(mappedExam.points_tf4 ?? mappedExam.pointsTF4 ?? 1) || 1,
                pointsSQ: Number(mappedExam.points_sq ?? mappedExam.pointsSQ ?? 1) || 1,
                pointsTL: Number(mappedExam.points_tl ?? mappedExam.pointsTL ?? 1) || 1,
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
                immediate_feedback: mappedExam.immediate_feedback !== undefined ? mappedExam.immediate_feedback : (examConfig?.immediateFeedback ? 1 : 0),
                immediateFeedback: Boolean(mappedExam.immediate_feedback == 1 || mappedExam.immediate_feedback === true || mappedExam.immediate_feedback === '1' || examConfig?.immediateFeedback)
            };
        } else if (examConfig) {
            finalSelectedLessons = Array.isArray(examConfig.selectedLessons) ? examConfig.selectedLessons : (Array.isArray(examConfig.selected_lessons) ? examConfig.selected_lessons : []);
            finalCountsDetail = examConfig.countsDetail || examConfig.counts_detail || {};
            targetCount41 = Number(examConfig.count41 || 0);
            targetCountTF4 = Number(examConfig.countTF4 || 0);
            targetCountSQ = Number(examConfig.countSQ || 0);
            targetCountTL = Number(examConfig.countTL || 0);
            maxCheatWarningsFromDB = Math.max(1, Number(examConfig.maxCheatWarnings || 5));
            const immediateVal = (examConfig.immediateFeedback || examConfig.immediate_feedback) ? 1 : 0;
            activeExamConfig = { 
                ...examConfig, 
                count41: targetCount41,
                countTF4: targetCountTF4,
                countSQ: targetCountSQ,
                countTL: targetCountTL,
                points41: Number(examConfig.points41 ?? examConfig.points_41 ?? 1) || 1,
                pointsTF4: Number(examConfig.pointsTF4 ?? examConfig.points_tf4 ?? 1) || 1,
                pointsSQ: Number(examConfig.pointsSQ ?? examConfig.points_sq ?? 1) || 1,
                pointsTL: Number(examConfig.pointsTL ?? examConfig.points_tl ?? 1) || 1,
                immediate_feedback: immediateVal,
                immediateFeedback: Boolean(immediateVal === 1),
                maxCheatWarnings: maxCheatWarningsFromDB 
            };
        } else {
            return new Response(JSON.stringify({ error: 'Không tìm thấy thông tin cấu hình đề thi' }), { status: 400, headers: corsHeaders });
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

        if (dbExam && String(dbExam.creator_id) !== String(teacherId)) {
            return new Response(JSON.stringify({error:'Đề thi không thuộc giáo viên đã chọn'}), {status:403,headers:corsHeaders});
        }
        // BẢO VỆ CHỐNG LÀM GIẢ: Thí sinh chỉ được làm đề đã lưu trong CSDL, không được tự chế examConfig
        if (!dbExam && !isAdmin && !isTeacher) {
            return new Response(JSON.stringify({ error: 'Đề thi không tồn tại hoặc chưa được lưu trên hệ thống!' }), { status: 404, headers: corsHeaders });
        }

        if (dbExam?.chedodethi === 'Đề có mã bảo mật' && !isAdmin && !isTeacher &&
            !accessCodeMatches(submittedAccessCode, dbExam.mabaomatdethi)) {
            return new Response(JSON.stringify({error:'Mã bảo vệ đề thi không chính xác'}), {status:403,headers:corsHeaders});
        }
        // KIỂM TRA QUYỀN TRUY CẬP ĐỐI VỚI ĐỀ CHO ĐƠN VỊ
        if (activeExamConfig.chedodethi === 'Đề cho đơn vị' || activeExamConfig.chedodethi === 'Đề thi cho đơn vị') {
            if (!isAdmin && !isTeacher) {
                // Lấy thông tin đơn vị của giáo viên tạo đề (hỗ trợ cả id người dùng và id tài khoản)
                const { results: teacherRows } = await db.prepare(
                    "SELECT donvi FROM users WHERE id = ? OR id IN (SELECT user_id FROM accounts WHERE id = ?)"
                ).bind(effectiveTeacherId, effectiveTeacherId).all();
                const teacherDonvi = String((teacherRows?.[0] as any)?.donvi || '').trim().toLowerCase();

                let allowedUnits: string[] = [];
                const rawAC = activeExamConfig.access_control || activeExamConfig.accessControl;
                if (rawAC) {
                    try {
                        const ac = typeof rawAC === 'object' ? rawAC : JSON.parse(rawAC);
                        if (ac && ac.allowedUnits) {
                            allowedUnits = Array.isArray(ac.allowedUnits)
                                ? ac.allowedUnits.map((u: any) => String(u).trim().toLowerCase())
                                : [String(ac.allowedUnits).trim().toLowerCase()];
                        }
                    } catch(e) {}
                }

                let isSameDonVi = false;
                const candidateInputDonvi = String(body.studentDonvi || body.userDonvi || body.studentClass || '').trim().toLowerCase();
                if (!teacherDonvi && allowedUnits.length === 0) {
                    isSameDonVi = true;
                } else if (tokenUser) {
                    const userDonvi = String(tokenUser.donvi || tokenUser.address || '').trim().toLowerCase();
                    if (teacherDonvi && userDonvi && (userDonvi === teacherDonvi || userDonvi.includes(teacherDonvi) || teacherDonvi.includes(userDonvi))) {
                        isSameDonVi = true;
                    } else if (allowedUnits.some((au: string) => au && (au === userDonvi || userDonvi.includes(au) || au.includes(userDonvi)))) {
                        isSameDonVi = true;
                    } else if (teacherDonvi && candidateInputDonvi && (candidateInputDonvi === teacherDonvi || candidateInputDonvi.includes(teacherDonvi) || teacherDonvi.includes(candidateInputDonvi))) {
                        isSameDonVi = true;
                    } else if (allowedUnits.some((au: string) => au && (au === candidateInputDonvi || candidateInputDonvi.includes(au) || au.includes(candidateInputDonvi)))) {
                        isSameDonVi = true;
                    }
                } else {
                    if (teacherDonvi && candidateInputDonvi && (candidateInputDonvi === teacherDonvi || candidateInputDonvi.includes(teacherDonvi) || teacherDonvi.includes(candidateInputDonvi))) {
                        isSameDonVi = true;
                    } else if (allowedUnits.some((au: string) => au && (au === candidateInputDonvi || candidateInputDonvi.includes(au) || au.includes(candidateInputDonvi)))) {
                        isSameDonVi = true;
                    }
                }

                if (!isSameDonVi) {
                    return new Response(JSON.stringify({ error: `🛑 Bạn không có quyền làm đề thi này do Đơn vị/Trường không phù hợp! (Đề thi chỉ dành cho học sinh thuộc đơn vị "${(teacherRows?.[0] as any)?.donvi || 'được phân công'}").` }), { status: 403, headers: corsHeaders });
                }

                const targetLop = String(activeExamConfig.target_lop || activeExamConfig.lop || '').trim();
                // TH1: Nếu không nhập lớp nào -> Dành cho tất cả học sinh thuộc đơn vị đó, không ràng buộc lớp.
                // TH2: Nếu có nhập tên lớp cố định:
                if (targetLop) {
                    if (!tokenUser) {
                        return new Response(JSON.stringify({ error: `🛑 Bạn không có quyền làm đề thi này do chưa đăng nhập! (Đề thi chỉ dành riêng cho học sinh Lớp ${targetLop}. Vui lòng đăng nhập tài khoản học sinh để làm bài).` }), { status: 403, headers: corsHeaders });
                    }
                    const normalizeLop = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
                    const userLop = normalizeLop(tokenUser.lop || '');
                    const candidateClass = normalizeLop(body.studentLop || body.userLop || body.studentClass || '');
                    const allowedLops = targetLop.split(/[,;\n]+/).map((s: string) => normalizeLop(s)).filter(Boolean);
                    const isLopMatched = allowedLops.some((al: string) => 
                        (userLop && (al === userLop || userLop === 'lớp' + al || al === 'lớp' + userLop || userLop.endsWith(al) || al.endsWith(userLop))) ||
                        (candidateClass && (al === candidateClass || candidateClass === 'lớp' + al || al === 'lớp' + candidateClass || candidateClass.endsWith(al) || al.endsWith(candidateClass)))
                    );
                    if (!isLopMatched) {
                        return new Response(JSON.stringify({ error: `🛑 Bạn không có quyền làm đề thi này do Lớp không phù hợp! (Đề thi chỉ dành riêng cho học sinh Lớp ${targetLop}. Tài khoản của bạn thuộc Lớp ${tokenUser.lop || 'khác'}).` }), { status: 403, headers: corsHeaders });
                    }
                }
            }
        }

        // KIỂM TRA GIỚI HẠN SỐ LẦN LÀM BÀI (max_attempts)
        const maxAttemptsVal = (dbExam && dbExam.max_attempts !== null && dbExam.max_attempts !== undefined)
            ? Number(dbExam.max_attempts)
            : Number(activeExamConfig.max_attempts || activeExamConfig.maxAttempts || 0);

        if (maxAttemptsVal > 0 && !isAdmin && !isTeacher) {
            const studentNameVal = (body.studentName || '').trim();
            const studentUserIdVal = tokenUser?.user_id || tokenUser?.id || null;
            const targetExamIdStr = String(activeExamConfig.id || examId || '').trim();
            const targetExamNameStr = String(activeExamConfig.name || examName || '').trim();

            let attemptCount = 0;
            try {
                if (studentUserIdVal) {
                    const { results: attempts } = await db.prepare(
                        `SELECT COUNT(*) as count FROM results 
                         WHERE (
                             (exam_id IS NOT NULL AND (exam_id = ? OR CAST(exam_id AS TEXT) = ? OR LOWER(TRIM(exam_id)) = LOWER(TRIM(?))))
                             OR 
                             (exam_name IS NOT NULL AND (exam_name = ? OR LOWER(TRIM(exam_name)) = LOWER(TRIM(?))))
                         ) AND (
                             (user_id IS NOT NULL AND (user_id = ? OR user_id = ?))
                             OR
                             (student_name IS NOT NULL AND LOWER(TRIM(student_name)) = LOWER(TRIM(?)))
                         )`
                    ).bind(targetExamIdStr, targetExamIdStr, targetExamIdStr, targetExamNameStr, targetExamNameStr, String(studentUserIdVal), String(studentUserIdVal), studentNameVal).all();
                    attemptCount = Number((attempts?.[0] as any)?.count || (attempts?.[0] as any)?.['COUNT(*)'] || 0);
                } else {
                    const { results: attempts } = await db.prepare(
                        `SELECT COUNT(*) as count FROM results 
                         WHERE (
                             (exam_id IS NOT NULL AND (exam_id = ? OR CAST(exam_id AS TEXT) = ? OR LOWER(TRIM(exam_id)) = LOWER(TRIM(?))))
                             OR 
                             (exam_name IS NOT NULL AND (exam_name = ? OR LOWER(TRIM(exam_name)) = LOWER(TRIM(?))))
                         ) AND (
                             student_name IS NOT NULL AND LOWER(TRIM(student_name)) = LOWER(TRIM(?))
                         )`
                    ).bind(targetExamIdStr, targetExamIdStr, targetExamIdStr, targetExamNameStr, targetExamNameStr, studentNameVal).all();
                    attemptCount = Number((attempts?.[0] as any)?.count || (attempts?.[0] as any)?.['COUNT(*)'] || 0);
                }
            } catch(err) {
                console.error("Lỗi kiểm tra số lần làm bài:", err);
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
            if (!allQuestions || allQuestions.length === 0) {
                const { results } = await db.prepare('SELECT * FROM questions').all();
                allQuestions = results || [];
            }
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
            .filter(q => isQuestionInSelectedLessons(q.lesson));

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

        const isImmediateFeedback = Boolean(
            activeExamConfig.immediate_feedback == 1 ||
            activeExamConfig.immediate_feedback === true ||
            activeExamConfig.immediate_feedback === '1' ||
            activeExamConfig.immediateFeedback === true ||
            activeExamConfig.immediateFeedback == 1 ||
            (examConfig && (examConfig.immediateFeedback || examConfig.immediate_feedback == 1))
        );

        const questionIds: any[] = [];
        const clientQuestions = selectedQuestions.map((q) => {
            questionIds.push(q.id);
            if (isImmediateFeedback) {
                // Giữ nguyên đáp án để thí sinh biết đúng/sai ngay lập tức khi làm bài
                return { ...q };
            }
            const { answer, ...qWithoutAnswer } = q;
            if (qWithoutAnswer.options && qWithoutAnswer.options.answerImage) {
                const { answerImage, ...opts } = qWithoutAnswer.options;
                qWithoutAnswer.options = opts;
            }
            return qWithoutAnswer;
        });

        // Thời lượng phiên thi phải lấy từ cấu hình CSDL đã xác thực và được đóng băng
        // ngay khi phát đề. Client không được tiếp tục phụ thuộc vào examConfig có thể thay đổi.
        const rawTimeLimit = Number(activeExamConfig.time_limit ?? activeExamConfig.timeLimit ?? 45);
        const timeLimitMinutes = Number.isFinite(rawTimeLimit) && rawTimeLimit > 0 ? rawTimeLimit : 45;
        const timeLimitSeconds = Math.max(1, Math.round(timeLimitMinutes * 60));

        const payload = {
            questionIds,
            examConfig: makeGradeSessionConfig(activeExamConfig),
            maxCheatWarnings: maxCheatWarningsFromDB,
            timeLimitSeconds,
            teacherId: effectiveTeacherId,
            timestamp: Date.now(),
            exp: Math.floor(Date.now() / 1000) + Math.max(3600, Math.min(8 * 3600, timeLimitSeconds + 3600))
        };

        const token = await signJWT(payload, SECRET);

        return new Response(JSON.stringify({
            questions: clientQuestions,
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
