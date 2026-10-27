import { ensureEssayGradingSchema, prepareEssayDetails, summarizeEssayDetails, processStoredEssayGrading } from '../../../src/essay-grading-pipeline.js';
import { verifyAuthSession, verifyJWT, getDynamicSecret, hashToken, getDatabase } from './utils';

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

function getTF4Expected(corrAns: string, opt: string): boolean {
    const raw = String(corrAns || '').trim();
    if (!raw) return false;
    
    // Format "A:Đ&B:S..." or "A=1, B=0..." or "A: True..."
    const match = raw.match(new RegExp(`${opt}[:=]\\s*([A-Za-zĐđ0-9]+)`, 'i'));
    if (match) {
        const val = match[1].toUpperCase();
        return val === 'D' || val === 'Đ' || val === 'ĐÚNG' || val === 'DUNG' || val === 'T' || val === 'TRUE' || val === '1';
    }

    // Split by & or , or ;
    const parts = raw.split(/[&,;\/]+/).map(p => p.trim()).filter(Boolean);
    
    // If format is list of True options: ["A", "B"]
    if (parts.length > 0 && parts.every(p => ['A', 'B', 'C', 'D'].includes(p.toUpperCase()))) {
        return parts.map(p => p.toUpperCase()).includes(opt.toUpperCase());
    }

    // If format is exactly 4 values in order [A, B, C, D]: ["Đ", "S", "Đ", "S"]
    if (parts.length === 4) {
        const idx = ['A', 'B', 'C', 'D'].indexOf(opt.toUpperCase());
        if (idx >= 0) {
            const val = parts[idx].toUpperCase();
            return val === 'D' || val === 'Đ' || val === 'ĐÚNG' || val === 'DUNG' || val === 'T' || val === 'TRUE' || val === '1';
        }
    }

    return parts.map(p => p.toUpperCase()).includes(opt.toUpperCase());
}

function isTF4UserOptTrue(uAns: any, opt: string): boolean {
    if (!uAns || typeof uAns !== 'object') return false;
    const val = uAns[opt] ?? uAns[opt.toUpperCase()] ?? uAns[opt.toLowerCase()];
    if (val === true || val === 1 || val === '1') return true;
    if (typeof val === 'string') {
        const u = val.trim().toUpperCase();
        return u === 'D' || u === 'Đ' || u === 'ĐÚNG' || u === 'DUNG' || u === 'T' || u === 'TRUE' || u === '1';
    }
    return false;
}

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
                "CREATE TABLE IF NOT EXISTS _submitted_exam_tokens (token_hash TEXT PRIMARY KEY, exam_id TEXT, student_name TEXT, submitted_at TEXT)"
            ).run();
            const existingSubmission = await db.prepare(
                "SELECT token_hash FROM _submitted_exam_tokens WHERE token_hash = ?"
            ).bind(tokenHash).first();
            if (existingSubmission) {
                await ensureEssayGradingSchema(db);
                const saved: any = await db.prepare('SELECT id, score, grading_status, grading_attempts, grading_retry_at FROM results WHERE submission_token_hash = ?').bind(tokenHash).first();
                if (saved) return new Response(JSON.stringify({
                    resultId:saved.id, score:saved.grading_status==='completed'?saved.score:null,
                    gradingStatus:saved.grading_status, nextRetryAt:saved.grading_retry_at,
                    alreadySubmitted:true
                }),{status:200,headers:corsHeaders});
                return new Response(JSON.stringify({error:'Bài đã nộp và đang được hệ thống xử lý; không gửi lại bài.'}),{status:409,headers:corsHeaders});
            }
        } catch (tokErr) {
            console.error('Error checking submitted token:', tokErr);
        }

        const { questionIds, examConfig = {}, teacherId } = decoded;

        if (!questionIds || clientQuestions.length !== questionIds.length) {
            return new Response(JSON.stringify({ error: 'Danh sách câu hỏi không khớp với đề thi đã phát.' }), { status: 400, headers: corsHeaders });
        }

        // 1. Chuẩn hóa thang điểm từ examConfig
        const p41 = getNum(examConfig.points41 ?? examConfig.points_41, 1);
        const pTF4 = getNum(examConfig.pointsTF4 ?? examConfig.points_tf4, 1);
        const pSQ = getNum(examConfig.pointsSQ ?? examConfig.points_sq, 1);
        const pTL = getNum(examConfig.pointsTL ?? examConfig.points_tl, 1);

        // Always resolve grading secrets from the server-side, verified exam session.
        // Never trust a client-supplied examId or name to choose another exam's secret.
        let aiKey = '';
        try {
            const verifiedExamId = String(examConfig.id || '').trim();
            if (verifiedExamId) {
                const row: any = await db.prepare(
                    'SELECT ai_grading_key FROM exam_configs WHERE id = ? AND creator_id = ? LIMIT 1'
                ).bind(verifiedExamId, String(teacherId || '')).first();
                if (row && row.ai_grading_key) aiKey = String(row.ai_grading_key).trim();
            }
            // No fallback by exam name: names are not unique across teachers.
            if (!aiKey) {
                const row: any = await db.prepare(
                    'SELECT ai_grading_key FROM app_settings WHERE id = 1'
                ).first();
                if (row && row.ai_grading_key) aiKey = String(row.ai_grading_key).trim();
            }
        } catch (error) {
            console.error('Failed to resolve essay grading key from verified exam');
        }

        // 2. Truy xuất câu hỏi gốc từ DB chính xác 100% bằng questionIds
        let trueQuestionsMap: Record<string | number, any> = {};
        try {
            if (questionIds && questionIds.length > 0) {
                const placeholders = questionIds.map(() => '?').join(',');
                const { results: qRows } = await db.prepare(`SELECT * FROM questions WHERE id IN (${placeholders})`).bind(...questionIds).all();
                if (qRows && qRows.length > 0) {
                    for (const row of qRows) {
                        let parsedOptions = row.options;
                        if (typeof parsedOptions === 'string') {
                            try { parsedOptions = JSON.parse(parsedOptions); } catch (e) { parsedOptions = {}; }
                        }
                        trueQuestionsMap[row.id as any] = {
                            ...row,
                            type: normalizeType(row.type),
                            options: parsedOptions || {}
                        };
                    }
                }
            }

            // Fallback nếu có ID câu hỏi chưa tìm thấy
            const missingIds = questionIds.filter((qid: any) => !trueQuestionsMap[qid] && !trueQuestionsMap[String(qid)] && !trueQuestionsMap[Number(qid)]);
            if (missingIds.length > 0 && teacherId) {
                const { results: fallbackQs } = await db.prepare('SELECT * FROM questions WHERE creator_id = ?').bind(teacherId).all();
                if (fallbackQs && fallbackQs.length > 0) {
                    for (const row of fallbackQs) {
                        let parsedOptions = row.options;
                        if (typeof parsedOptions === 'string') {
                            try { parsedOptions = JSON.parse(parsedOptions); } catch (e) { parsedOptions = {}; }
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
            console.error('Error fetching real questions from DB', e);
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
                if (d.isCorrect) questionScore = p41;
            } else if (d.question.type === 'TF4') {
                const userAnswers = d.userAnswer || {};
                let correctStatementCount = 0;

                ['A', 'B', 'C', 'D'].forEach(opt => {
                    if (getTF4Expected(d.correctAnswer, opt) === isTF4UserOptTrue(userAnswers, opt)) {
                        correctStatementCount++;
                    }
                });

                d.correctStatements = correctStatementCount;

                const isTf4CustomMode = Boolean(examConfig.tf4ScoringMode || examConfig.tf4_scoring_mode);
                if (isTf4CustomMode && tf4PointsMap && tf4PointsMap[correctStatementCount] !== undefined) {
                    questionScore = Number(tf4PointsMap[correctStatementCount]) || 0;
                } else {
                    const ratioMap: Record<number, number> = { 0: 0, 1: 0.25, 2: 0.5, 3: 0.75, 4: 1.0 };
                    questionScore = pTF4 * (ratioMap[correctStatementCount] || 0);
                }
            } else if (d.question.type === 'SQ') {
                if (d.isCorrect) questionScore = pSQ;
            } else if (d.question.type === 'TL') {
                tlQuestionsToGrade.push(d);
            }

            d.score = Number(questionScore) || 0;
            rawEarnedScore += d.score;
        });

        // Essays must be persisted before any provider request. No failed AI grade is zero.
        const gradingDetails = prepareEssayDetails(detailedResults,
          (examConfig.autoGradeEssay ?? examConfig.auto_grade_essay) === true ||
          (examConfig.autoGradeEssay ?? examConfig.auto_grade_essay) === 1 ||
          (examConfig.autoGradeEssay ?? examConfig.auto_grade_essay) === '1',
          pTL);
        const initialGrade = summarizeEssayDetails(gradingDetails);
        const gradingState = initialGrade.pendingCount ? 'pending' :
          initialGrade.manualCount ? 'manual_required' : 'completed';

        // Tính điểm thô và quy đổi điểm theo thang điểm 10 an toàn, chính xác
        let totalMaxScore = 0;
        detailedResults.forEach((d: any) => {
            if (d.question.type === '4-1') totalMaxScore += p41;
            else if (d.question.type === 'TF4') totalMaxScore += pTF4;
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
        const calculatedScale10 = Number(scale10Score.toFixed(2));
        const calculatedRaw = Number(rawEarnedScore.toFixed(2));

        const cheatWarningCount = Number(body.cheatWarningCount ?? body.studentInfo?.cheatWarningCount ?? 0) || 0;
        const correctCount = detailedResults.filter((d: any) => d.isCorrect && d.question.type !== 'TL').length;

        // Fail closed if durable persistence is unavailable.
        await ensureEssayGradingSchema(db);
        const resultId = crypto.randomUUID();
        const verifiedExamId = String(examConfig.id || '');
        if (!verifiedExamId) throw new Error('Không xác định được mã đề đã xác minh.');
        await db.prepare(
          `INSERT INTO results (id, user_id, student_name, student_class, lop, don_vi, exam_name,
          exam_id, score, time_taken, correct_count, total_questions, details, loai_thi_sinh,
          cheat_warning_count, created_at, submission_token_hash, grading_status, grading_updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (submission_token_hash) DO NOTHING`
        ).bind(resultId, authenticatedUserId || studentInfo.userId || null,
          authenticatedStudentName || studentInfo.name || '',
          studentInfo.unit || authenticatedDonvi || '',
          authenticatedLop || studentInfo.lop || '',
          authenticatedDonvi || studentInfo.donvi || studentInfo.unit || '',
          String(examConfig.name || studentInfo.examName || ''), verifiedExamId,
          initialGrade.score, timeTaken || 0, correctCount, clientQuestions.length,
          JSON.stringify(gradingDetails),
          studentInfo.loaiThiSinh || (authenticatedUserId ? 'Đã đăng nhập' : 'Tự do'),
          cheatWarningCount, new Date().toISOString(), tokenHash, gradingState,
          new Date().toISOString()).run();
        const saved: any = await db.prepare('SELECT id FROM results WHERE submission_token_hash = ?')
          .bind(tokenHash).first();
        if (!saved) throw new Error('Không xác nhận được việc lưu bài thi.');
        const persistedId = String(saved.id);
        // Each repeated submit resolves to exactly one attempt. No duplicate result rows.
        let gradeResult: any = {resultId:persistedId, gradingStatus:gradingState,
          score:initialGrade.score};
        if (gradingState === 'pending') {
          try {
            gradeResult = await processStoredEssayGrading(db,persistedId,{budgetMs:18000}) || gradeResult;
          } catch (e) { console.error('Essay queued for retry after provider failure'); }
        }
        const finalRow: any = await db.prepare(
          'SELECT score, grading_status, details FROM results WHERE id = ?'
        ).bind(persistedId).first();
        const finalDetails = JSON.parse(String(finalRow?.details || '[]'));
        const finalScore = finalRow?.grading_status === 'completed' ? finalRow.score : null;
        const publicScore = finalScore;
        await db.prepare(
          'INSERT INTO _submitted_exam_tokens (token_hash, exam_id, student_name, submitted_at) '+
          'VALUES (?, ?, ?, ?) ON CONFLICT (token_hash) DO NOTHING'
        ).bind(tokenHash, verifiedExamId, authenticatedStudentName || studentInfo.name || '',
          new Date().toISOString()).run();

        // BẢO MẬT: Nếu cấu hình không cho xem chi tiết đáp án, loại bỏ hoàn toàn correctAnswer và ảnh đáp án trước khi trả về client
        const shouldShowDetails = examConfig.showDetails !== false && examConfig.show_details !== false;
        const clientDetailedResults = finalDetails.map((d: any) => {
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
            resultId: persistedId,
            score: publicScore,
            gradingStatus: finalRow?.grading_status || gradeResult.gradingStatus,
            provisionalScore: initialGrade.provisionalScore,
            rawEarnedScore: initialGrade.provisionalScore,
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
