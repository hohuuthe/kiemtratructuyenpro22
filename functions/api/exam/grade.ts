import { verifyAuthSession, verifyJWT, getDynamicSecret, hashToken, getDatabase } from './utils';
import { evaluateTF4, isShortAnswerCorrect, examFlagEnabled, clampScore, roundScore } from '../../../src/exam-grading-core.js';

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

const getNum = (val: any, fallback: number): number => {
    if (val === undefined || val === null || val === '') return fallback;
    const num = Number(val);
    return isNaN(num) ? fallback : num;
};

const normalizeType = (type: any): string => {
    const t = String(type || '').trim().toLowerCase();
    if (t === '4-1' || t === 'trac_nghiem' || t === 'mcq') return '4-1';
    if (t === 'tf4' || t === 'dung_sai' || t === 'true_false') return 'TF4';
    if (t === 'sq' || t === 'tra_loi_ngan' || t === 'short_answer') return 'SQ';
    if (t === 'tl' || t === 'tu_luan' || t === 'essay') return 'TL';
    return String(type || '4-1');
};

const getBase64Data = (dataUri: string) => {
    if (!dataUri || !dataUri.includes('base64,')) return null;
    try {
        const p = dataUri.split('base64,');
        return {
            mimeType: p[0].split(':')[1].split(';')[0],
            data: p[1]
        };
    } catch (e) { return null; }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
    const { request, env } = context;
    const SECRET = await getDynamicSecret(db, env.JWT_SECRET);

    try {
        const body: any = await request.json();
        const { token, studentAnswers, clientQuestions, studentInfo, timeTaken } = body;

        if (!token || !studentAnswers || !clientQuestions || !studentInfo) {
            return new Response(JSON.stringify({ error: 'Thiếu thông tin nộp bài thi bắt buộc.' }), { status: 400, headers: corsHeaders });
        }

        let authenticatedUserId = studentInfo.userId || null;
        let authenticatedStudentName = studentInfo.name || '';
        let authenticatedLop = studentInfo.lop || '';
        let authenticatedDonvi = studentInfo.donvi || studentInfo.unit || '';

        const authHeader = request.headers.get("authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const verifiedUser = await verifyAuthSession(authHeader.substring(7), SECRET, db);
                if (verifiedUser && (verifiedUser.id || verifiedUser.user_id)) {
                    authenticatedUserId = verifiedUser.user_id || verifiedUser.id;
                    if (verifiedUser.full_name) {
                        authenticatedStudentName = verifiedUser.full_name;
                    }
                    if (verifiedUser.lop) {
                        authenticatedLop = verifiedUser.lop;
                    }
                    if (verifiedUser.donvi) {
                        authenticatedDonvi = verifiedUser.donvi;
                    }
                }
            } catch (e) {}
        }

        const decoded = await verifyJWT(token, SECRET);
        if (!decoded) {
            return new Response(JSON.stringify({ error: 'Mã phiên thi không hợp lệ hoặc đã hết hạn.' }), { status: 403, headers: corsHeaders });
        }

        // BẢO MẬT: Chống nộp bài trùng lặp (Token Replay Prevention)
        const tokenHash = await hashToken(token);
        try {
            await db.prepare(
                "CREATE TABLE IF NOT EXISTS _submitted_exam_tokens (token_hash TEXT PRIMARY KEY, exam_id TEXT, student_name TEXT, user_id TEXT, submitted_at TEXT)"
            ).run();
            await db.prepare(
                "ALTER TABLE _submitted_exam_tokens ADD COLUMN IF NOT EXISTS user_id TEXT"
            ).run();
            const existingSubmission = await db.prepare(
                "SELECT token_hash FROM _submitted_exam_tokens WHERE token_hash = ?"
            ).bind(tokenHash).first();
            if (existingSubmission) {
                return new Response(JSON.stringify({ error: 'Phiên thi này đã được nộp bài trước đó. Không thể nộp lại nhiều lần!' }), { status: 400, headers: corsHeaders });
            }
        } catch (tokErr) {
            console.error('Error checking submitted token:', tokErr);
        }

        const { questionIds, teacherId, gradingSessionId } = decoded;
        let examConfig: any = decoded.examConfig || {};

        if (!questionIds || clientQuestions.length !== questionIds.length) {
            return new Response(JSON.stringify({ error: 'Danh sách câu hỏi không khớp với đề thi đã phát.' }), { status: 400, headers: corsHeaders });
        }

        // 1. Chuẩn hóa thang điểm từ examConfig
        const p41 = getNum(examConfig.points41 ?? examConfig.points_41, 1);
        const pTF4 = getNum(examConfig.pointsTF4 ?? examConfig.points_tf4, 1);
        const pSQ = getNum(examConfig.pointsSQ ?? examConfig.points_sq, 1);
        const pTL = getNum(examConfig.pointsTL ?? examConfig.points_tl, 1);

        // Fetch Exam Config từ CSDL để lấy AI Grading Key nếu có
        let aiKey = '';
        try {
            if (studentInfo.examId) {
                const { results } = await db.prepare('SELECT ai_grading_key FROM exam_configs WHERE id = ?').bind(studentInfo.examId).all();
                if (results && results.length > 0 && results[0].ai_grading_key) {
                    aiKey = String(results[0].ai_grading_key);
                }
            }
            if (!aiKey && (studentInfo.examName || examConfig.name)) {
                const searchName = studentInfo.examName || examConfig.name;
                const { results } = await db.prepare('SELECT ai_grading_key FROM exam_configs WHERE name = ?').bind(searchName).all();
                if (results && results.length > 0 && results[0].ai_grading_key) {
                    aiKey = String(results[0].ai_grading_key);
                }
            }
            if (!aiKey) {
                const { results } = await db.prepare('SELECT ai_grading_key FROM app_settings WHERE id = 1').all();
                if (results && results.length > 0 && results[0].ai_grading_key) {
                    aiKey = String(results[0].ai_grading_key);
                }
            }
        } catch (e) {
            console.error('Error fetching aiKey', e);
        }

        // 2. Grade against the immutable server-side snapshot issued with this session.
        // Legacy sessions created before this release fall back to the live DB, but all new
        // sessions must have a valid snapshot and fail closed if it is unavailable.
        let trueQuestionsMap: Record<string | number, any> = {};
        let loadedFromSnapshot = false;
        if (gradingSessionId) {
            try {
                const snapshotRow: any = await db.prepare(
                    'SELECT question_ids, question_snapshot, exam_config, expires_at FROM _exam_grade_sessions WHERE session_id = ?'
                ).bind(String(gradingSessionId)).first();
                if (!snapshotRow) {
                    return new Response(JSON.stringify({ error: 'Phiên chấm điểm không tồn tại hoặc đã được thu hồi.' }), { status: 409, headers: corsHeaders });
                }
                if (snapshotRow.expires_at && new Date(String(snapshotRow.expires_at)).getTime() < Date.now()) {
                    return new Response(JSON.stringify({ error: 'Phiên chấm điểm đã hết hạn.' }), { status: 409, headers: corsHeaders });
                }
                const frozenIds = JSON.parse(String(snapshotRow.question_ids || '[]')).map((id: any) => String(id));
                const issuedIds = (questionIds || []).map((id: any) => String(id));
                if (JSON.stringify(frozenIds) !== JSON.stringify(issuedIds)) {
                    return new Response(JSON.stringify({ error: 'Danh sách câu hỏi của phiên thi không khớp snapshot chấm điểm.' }), { status: 409, headers: corsHeaders });
                }
                const frozenQuestions = JSON.parse(String(snapshotRow.question_snapshot || '[]'));
                if (!Array.isArray(frozenQuestions) || frozenQuestions.length !== issuedIds.length) {
                    return new Response(JSON.stringify({ error: 'Snapshot chấm điểm không đầy đủ.' }), { status: 409, headers: corsHeaders });
                }
                examConfig = JSON.parse(String(snapshotRow.exam_config || '{}')) || {};
                for (const row of frozenQuestions) {
                    let parsedOptions = row.options;
                    if (typeof parsedOptions === 'string') {
                        try { parsedOptions = JSON.parse(parsedOptions); } catch { parsedOptions = {}; }
                    }
                    trueQuestionsMap[row.id as any] = {
                        ...row,
                        type: normalizeType(row.type),
                        options: parsedOptions || {}
                    };
                }
                loadedFromSnapshot = true;
            } catch (e: any) {
                console.error('Error loading grading snapshot', e);
                return new Response(JSON.stringify({ error: 'Không thể xác minh snapshot chấm điểm của phiên thi.' }), { status: 503, headers: corsHeaders });
            }
        }

        if (!loadedFromSnapshot) {
            try {
                if (questionIds && questionIds.length > 0) {
                    const placeholders = questionIds.map(() => '?').join(',');
                    const { results: qRows } = await db.prepare(`SELECT * FROM questions WHERE id IN (${placeholders})`).bind(...questionIds).all();
                    if (qRows && qRows.length > 0) {
                        for (const row of qRows) {
                            let parsedOptions = row.options;
                            if (typeof parsedOptions === 'string') {
                                try { parsedOptions = JSON.parse(parsedOptions); } catch { parsedOptions = {}; }
                            }
                            trueQuestionsMap[row.id as any] = {
                                ...row,
                                type: normalizeType(row.type),
                                options: parsedOptions || {}
                            };
                        }
                    }
                }
            } catch (e) {
                console.error('Error fetching legacy live questions from DB', e);
            }
        }

        // Parse tf4 points configuration
        let tf4PointsMap: any = null;
        if (examConfig.tf4Points) {
            if (typeof examConfig.tf4Points === 'string') {
                try { tf4PointsMap = JSON.parse(examConfig.tf4Points); } catch(e) {}
            } else if (typeof examConfig.tf4Points === 'object') {
                tf4PointsMap = examConfig.tf4Points;
            }
        }
        if (!tf4PointsMap && examConfig.tf4_points) {
            if (typeof examConfig.tf4_points === 'string') {
                try { tf4PointsMap = JSON.parse(examConfig.tf4_points); } catch(e) {}
            } else if (typeof examConfig.tf4_points === 'object') {
                tf4PointsMap = examConfig.tf4_points;
            }
        }

        const detailedResults = clientQuestions.map((q: any, i: number) => {
            const trueQId = questionIds[i];
            const trueQ = trueQuestionsMap[trueQId] || trueQuestionsMap[String(trueQId)] || trueQuestionsMap[Number(trueQId)];
            
            if (!trueQ) {
                return { question: q, userAnswer: studentAnswers[i], isCorrect: false, correctAnswer: '', needsGrading: false, score: 0, aiFeedback: 'Không tìm thấy dữ liệu gốc của câu hỏi.' };
            }

            const userAnswer = studentAnswers[i];
            const correctAnswer = trueQ.answer;

            let isCorrect = false;

            if (trueQ.type === '4-1') {
                const u = String(userAnswer || '').trim().toUpperCase();
                const c = String(correctAnswer || '').trim().toUpperCase();
                isCorrect = (u !== '' && u === c);
            } else if (trueQ.type === 'TF4') {
                let tf4CorrectCount = 0;
                ['A', 'B', 'C', 'D'].forEach(opt => {
                    if (getTF4Expected(correctAnswer, opt) === isTF4UserOptTrue(userAnswer, opt)) {
                        tf4CorrectCount++;
                    }
                });
                isCorrect = (tf4CorrectCount === 4);
            } else if (trueQ.type === 'SQ') {
                let u = String(userAnswer || '').trim();
                let c = String(correctAnswer || '').trim();
                
                const isCaseSensitive = examConfig.sqCaseSensitive ?? examConfig.sq_case_sensitive ?? false;
                const isPunctuationSensitive = examConfig.sqPunctuationSensitive ?? examConfig.sq_punctuation_sensitive ?? false;

                if (!isCaseSensitive) {
                    u = u.toLowerCase();
                    c = c.toLowerCase();
                }
                if (!isPunctuationSensitive) {
                    u = u.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").replace(/\s+/g, " ").trim();
                    c = c.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").replace(/\s+/g, " ").trim();
                }

                const acceptableAnswers = c.split(/[|;]+/).map(a => a.trim()).filter(Boolean);
                if (acceptableAnswers.length > 1) {
                    isCorrect = (u !== '' && acceptableAnswers.includes(u));
                } else {
                    isCorrect = (u !== '' && u === c);
                }
            } else if (trueQ.type === 'TL') {
                isCorrect = false; 
            }

            return { question: trueQ, userAnswer, isCorrect, correctAnswer, needsGrading: trueQ.type === 'TL', score: 0, aiFeedback: '' };
        });

        // Compute MC/TF/SQ Scores
        let rawEarnedScore = 0;
        let tlQuestionsToGrade: any[] = [];

        detailedResults.forEach((d: any) => {
            let questionScore = 0;
            if (d.question.type === '4-1') {
                d.maxScore = p41;
                if (d.isCorrect) questionScore = p41;
            } else if (d.question.type === 'TF4') {
                const tf4 = evaluateTF4(d.correctAnswer, d.userAnswer);
                if (!tf4.validKey) {
                    throw new Error(`Đáp án Đúng/Sai của câu hỏi ${d.question.id} không hợp lệ.`);
                }
                d.answeredStatements = tf4.answeredCount;
                d.correctStatements = tf4.correctCount;

                const isTf4CustomMode = examFlagEnabled(examConfig.tf4ScoringMode ?? examConfig.tf4_scoring_mode, false);
                d.maxScore = isTf4CustomMode && tf4PointsMap && tf4PointsMap[4] !== undefined
                    ? Number(tf4PointsMap[4]) || 0
                    : pTF4;
                if (isTf4CustomMode && tf4PointsMap && tf4PointsMap[tf4.correctCount] !== undefined) {
                    questionScore = Number(tf4PointsMap[tf4.correctCount]) || 0;
                } else {
                    const ratioMap: Record<number, number> = { 0: 0, 1: 0.25, 2: 0.5, 3: 0.75, 4: 1.0 };
                    questionScore = pTF4 * (ratioMap[tf4.correctCount] || 0);
                }
            } else if (d.question.type === 'SQ') {
                d.maxScore = pSQ;
                if (d.isCorrect) questionScore = pSQ;
            } else if (d.question.type === 'TL') {
                d.maxScore = pTL;
                tlQuestionsToGrade.push(d);
            }

            d.score = Number(questionScore) || 0;
            rawEarnedScore += d.score;
        });

        // AI Grading for TL (Tự luận) - Hỗ trợ danh sách nhiều key cách nhau bằng dấu cách, tự động chuyển key khi hết hạn mức
        const isAutoGradeEssay = examFlagEnabled(examConfig.autoGradeEssay ?? examConfig.auto_grade_essay, false);
        const rawAiKeys = (aiKey || '').trim().split(/\s+/).filter((k: string) => k.length > 5 && !k.includes("••••••••") && !k.includes("YOUR_"));

        if (isAutoGradeEssay && rawAiKeys.length > 0 && tlQuestionsToGrade.length > 0) {
            let currentKeyIdx = 0;

            for (const d of tlQuestionsToGrade) {
                let studentAnsText = '';
                if (d.userAnswer && typeof d.userAnswer === 'object') {
                    studentAnsText = String(d.userAnswer.text || '').trim();
                } else {
                    studentAnsText = String(d.userAnswer || '').trim();
                }
                const studentAnsImage = (d.userAnswer && typeof d.userAnswer === 'object') ? d.userAnswer.image : '';

                if (!studentAnsText && !studentAnsImage) {
                    d.score = 0;
                    d.aiFeedback = "Học sinh không nộp bài làm (trống).";
                    d.gradingStatus = 'completed';
                    continue;
                }

                const prompt = `
Bạn là một giám khảo chấm thi tự luận.
THÔNG TIN ĐỀ BÀI:
- Câu hỏi: ${d.question.content || ''}
- Đáp án/Hướng dẫn: ${d.correctAnswer || ''}
- Thang điểm: ${pTL} điểm.

BÀI LÀM:
- Chữ: ${studentAnsText || '(Trống)'}

YÊU CẦU:
1. Đọc nội dung ảnh (nếu có) và chữ.
2. Chấm điểm chính xác, trả về JSON:
{
  "score": (số điểm),
  "feedback": "Nhận xét"
}`;
                
                let parts: any[] = [{ text: prompt }];

                const qImg = getBase64Data(d.question.image);
                if (qImg) { parts.push({ text: "ẢNH CÂU HỎI:" }); parts.push({ inlineData: { data: qImg.data, mimeType: qImg.mimeType } }); }
                
                const aImg = getBase64Data(d.question.options?.answerImage);
                if (aImg) { parts.push({ text: "ẢNH ĐÁP ÁN:" }); parts.push({ inlineData: { data: aImg.data, mimeType: aImg.mimeType } }); }
                
                const sImg = getBase64Data(studentAnsImage);
                if (sImg) { parts.push({ text: "ẢNH BÀI LÀM CỦA HỌC SINH:" }); parts.push({ inlineData: { data: sImg.data, mimeType: sImg.mimeType } }); }

                let gradedSuccessfully = false;
                const modelsToTry = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-flash-lite"];

                while (currentKeyIdx < rawAiKeys.length && !gradedSuccessfully) {
                    const activeKey = rawAiKeys[currentKeyIdx];
                    let keyNeedsSwitch = false;

                    for (const m of modelsToTry) {
                        try {
                            const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${activeKey}`;
                            const res = await fetch(url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    contents: [{ parts }],
                                    generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
                                })
                            });

                            if (res.ok) {
                                const json: any = await res.json();
                                const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
                                if (text) {
                                    const parsed = JSON.parse(text);
                                    const essayScore = clampScore(parsed.score, pTL);
                                    d.score = essayScore;
                                    d.aiFeedback = parsed.feedback || '';
                                    d.gradingStatus = 'completed';
                                    rawEarnedScore += essayScore;
                                    gradedSuccessfully = true;
                                    break;
                                }
                            }

                            const errJson = await res.json().catch(() => ({})) as any;
                            const errMsg = (errJson.error?.message || '').toLowerCase();
                            // Nếu key bị hết hạn mức, quá quota, không hợp lệ hoặc hết hạn => đánh dấu cần đổi key
                            if (res.status === 429 || res.status === 403 || res.status === 401 ||
                                (res.status === 400 && (errMsg.includes('key') || errMsg.includes('invalid'))) ||
                                errMsg.includes('quota') || errMsg.includes('resource_exhausted') || 
                                errMsg.includes('rate') || errMsg.includes('api_key_invalid') ||
                                errMsg.includes('api key not valid') || errMsg.includes('permission_denied') ||
                                errMsg.includes('expired') || errMsg.includes('limit')) {
                                keyNeedsSwitch = true;
                                break;
                            }
                        } catch (err: any) {
                            const em = (err.message || '').toLowerCase();
                            if (em.includes('quota') || em.includes('resource_exhausted') || em.includes('limit') || em.includes('429')) {
                                keyNeedsSwitch = true;
                                break;
                            }
                        }
                    }

                    if (gradedSuccessfully) {
                        break;
                    }

                    if (keyNeedsSwitch || !gradedSuccessfully) {
                        console.warn(`[AI Key Switcher Backend]: Key ${currentKeyIdx + 1}/${rawAiKeys.length} bị lỗi hoặc hết hạn mức. Chuyển sang key tiếp theo...`);
                        currentKeyIdx++;
                    }
                }

                if (!gradedSuccessfully) {
                    d.gradingStatus = 'failed';
                    d.aiFeedback = d.aiFeedback || 'Không thể chấm bằng AI (tất cả API Key trong danh sách đều đã hết hạn mức hoặc gặp lỗi).';
                }
            }
        }

        // Tính điểm thô và quy đổi điểm theo thang điểm 10 an toàn, chính xác
        let totalMaxScore = 0;
        detailedResults.forEach((d: any) => {
            if (d.question.type === '4-1') totalMaxScore += p41;
            else if (d.question.type === 'TF4') {
                const isTf4CustomMode = examFlagEnabled(examConfig.tf4ScoringMode ?? examConfig.tf4_scoring_mode, false);
                const maxTf4 = isTf4CustomMode && tf4PointsMap && tf4PointsMap[4] !== undefined
                    ? Number(tf4PointsMap[4]) || 0
                    : pTF4;
                totalMaxScore += maxTf4;
            }
            else if (d.question.type === 'SQ') totalMaxScore += pSQ;
            else if (d.question.type === 'TL') totalMaxScore += pTL;
            else totalMaxScore += 1;
        });

        if (totalMaxScore <= 0) {
            totalMaxScore = clientQuestions.length || 1;
        }

        // Kiểm tra xem đề thi có cấu hình giữ nguyên điểm thô (không tự động quy đổi về thang 10) hay không
        const keepRawScore = examConfig.keepRawScore === true || examConfig.keep_raw_score === true || examConfig.keep_raw_score === 1 || examConfig.keepRawScore === 'true' || examConfig.scoringScale === 'raw';

        let scale10Score = 0;
        if (totalMaxScore > 0 && !isNaN(rawEarnedScore)) {
            scale10Score = (rawEarnedScore / totalMaxScore) * 10;
        }
        if (isNaN(scale10Score) || !isFinite(scale10Score)) {
            scale10Score = 0;
        }
        scale10Score = Math.max(0, Math.min(10, scale10Score));
        
        // Theo yêu cầu tuyệt đối: Hệ thống giữ nguyên điểm thô, lưu nguyên xi điểm thô vào kết quả, không phiên sang thang điểm 10.
        const calculatedScale10 = roundScore(scale10Score, 2);
        const calculatedRaw = roundScore(rawEarnedScore, 2);
        const finalScore = calculatedRaw;

        const cheatWarningCount = Number(body.cheatWarningCount ?? body.studentInfo?.cheatWarningCount ?? 0) || 0;
        const correctCount = detailedResults.filter((d: any) => d.isCorrect && d.question.type !== 'TL').length;

        // Lưu kết quả bài thi vào cơ sở dữ liệu Cloudflare D1
        const resultId = crypto.randomUUID();
        try {
            await db.prepare(`
                CREATE TABLE IF NOT EXISTS results (
                    id TEXT PRIMARY KEY,
                    student_name TEXT,
                    student_class TEXT,
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
            `).run();

            try {
                await db.prepare("ALTER TABLE results ADD COLUMN cheat_warning_count INTEGER DEFAULT 0").run();
            } catch (e) {}
            try {
                await db.prepare("ALTER TABLE results ADD COLUMN user_id TEXT").run();
            } catch (e) {}
            try {
                await db.prepare("ALTER TABLE results ADD COLUMN lop TEXT").run();
            } catch (e) {}
            try {
                await db.prepare("ALTER TABLE results ADD COLUMN don_vi TEXT").run();
            } catch (e) {}

            await db.prepare(
                `INSERT INTO results (id, user_id, student_name, student_class, lop, don_vi, exam_name, exam_id, score, time_taken, correct_count, total_questions, details, loai_thi_sinh, cheat_warning_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                resultId,
                authenticatedUserId || studentInfo.userId || null,
                authenticatedStudentName || studentInfo.name || '',
                studentInfo.unit || authenticatedDonvi || '',
                authenticatedLop || studentInfo.lop || '',
                authenticatedDonvi || studentInfo.donvi || studentInfo.unit || '',
                studentInfo.examName || '',
                String(examConfig.id || studentInfo.examId || studentInfo.examName || ''),
                finalScore,
                timeTaken || 0,
                correctCount,
                clientQuestions.length,
                JSON.stringify(detailedResults),
                studentInfo.loaiThiSinh || (authenticatedUserId ? 'Đã đăng nhập' : 'Tự do'),
                cheatWarningCount,
                new Date().toISOString()
            ).run();
        } catch (dbErr) {
            console.error("Lỗi khi lưu kết quả bài thi vào CSDL:", dbErr);
            // Fail closed: never tell the student that submission succeeded if the
            // authoritative result row was not durably persisted.
            throw new Error('Không thể lưu kết quả bài thi. Phiên thi chưa bị đánh dấu đã nộp; vui lòng gửi lại bài.');
        }

        // BẢO MẬT: Đánh dấu token đã nộp bài thành công vào bảng kiểm soát để ngăn chặn nộp lại
        try {
            await db.prepare(
                "INSERT INTO _submitted_exam_tokens (token_hash, exam_id, student_name, user_id, submitted_at) VALUES (?, ?, ?, ?, ?)"
            ).bind(
                tokenHash,
                String(examConfig.id || studentInfo.examId || studentInfo.examName || ''),
                studentInfo.name || '',
                authenticatedUserId || null,
                new Date().toISOString()
            ).run();
        } catch (markErr) {
            console.error('Error marking token as submitted:', markErr);
            // The result has already been persisted. Do not fail the student response,
            // but retain the result ID so any replay can be audited and de-duplicated.
        }

        if (gradingSessionId) {
            try {
                await db.prepare('DELETE FROM _exam_grade_sessions WHERE session_id = ?')
                    .bind(String(gradingSessionId)).run();
            } catch (cleanupErr) {
                console.warn('Could not delete consumed grading snapshot:', cleanupErr);
            }
        }

        // BẢO MẬT: Nếu cấu hình không cho xem chi tiết đáp án, loại bỏ hoàn toàn correctAnswer và ảnh đáp án trước khi trả về client
        const shouldShowDetails = examConfig.showDetails !== false && examConfig.show_details !== false;
        const clientDetailedResults = detailedResults.map((d: any) => {
            if (!shouldShowDetails) {
                const { correctAnswer, aiFeedback, ...safeD } = d;
                if (safeD.question && safeD.question.options && safeD.question.options.answerImage) {
                    const { answerImage, ...safeOptions } = safeD.question.options;
                    safeD.question = { ...safeD.question, options: safeOptions };
                }
                return safeD;
            }
            return d;
        });

        return new Response(JSON.stringify({
            resultId,
            score: finalScore,
            rawEarnedScore: calculatedRaw,
            totalMaxScore: Number(totalMaxScore.toFixed(2)),
            scale10Score: calculatedScale10,
            correctCount,
            cheatWarningCount,
            detailedResults: clientDetailedResults
        }), {
            status: 200,
            headers: corsHeaders
        });

    } catch (err: any) {
        console.error("Lỗi POST /api/exam/grade:", err);
        return new Response(JSON.stringify({ error: err.message || 'Lỗi xử lý chấm điểm' }), { status: 500, headers: corsHeaders });
    }
};
