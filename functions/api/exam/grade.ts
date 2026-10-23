import {normalizedImageUrl} from '../../../src/safe-image-url.js';
import { restoreAttemptQuestions } from './attempt-envelope';
import { persistExamResult } from './submission';
import { asFlag, withoutAnswers, restrictResultDetail } from '../../../src/security-policy';
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

function isTF4UserOptTrue(uAns: any, opt: string): boolean | null {
    if (!uAns || typeof uAns !== 'object') return null;
    const val = uAns[opt] ?? uAns[opt.toUpperCase()] ?? uAns[opt.toLowerCase()];
    if (val === undefined || val === null || val === '') return null;
    if (val === false || val === 0 || val === '0') return false;
    if (val === true || val === 1 || val === '1') return true;
    if (typeof val === 'string') {
        const u = val.trim().toUpperCase();
        if (['D','\u0110','\u0110\u00daNG','DUNG','T','TRUE','1'].includes(u)) return true;
        if (['S','SAI','F','FALSE','0'].includes(u)) return false;
    }
    return null;
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

        let authenticatedUserId = null;
        let verifiedAccount: any = null;
        let authenticatedStudentName = studentInfo.name || '';
        let authenticatedLop = studentInfo.lop || '';
        let authenticatedDonvi = studentInfo.donvi || studentInfo.unit || '';

        const authHeader = request.headers.get("authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const verifiedUser = await verifyAuthSession(authHeader.substring(7), SECRET, db);
                if (verifiedUser && (verifiedUser.id || verifiedUser.user_id)) {
                    verifiedAccount = verifiedUser;
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
        if (!decoded || decoded.tokenType !== 'exam') {
            return new Response(JSON.stringify({ error: 'Mã phiên thi không hợp lệ hoặc đã hết hạn.' }), { status: 403, headers: corsHeaders });
        }

        if(decoded.subject && (!verifiedAccount || String(decoded.subject.accountId)!==String(verifiedAccount.id))) {
            return new Response(JSON.stringify({error:'This attempt belongs to another or revoked account'}),{status:403,headers:corsHeaders});
        }
        if(!decoded.subject)authenticatedUserId=null;
        else {
            authenticatedUserId=decoded.subject.userId;
            authenticatedStudentName=decoded.subject.name;
            authenticatedLop=decoded.subject.lop;
            authenticatedDonvi=decoded.subject.donvi;
        }
        const {questionIds,examConfig={},teacherId}=decoded;
        if(!Array.isArray(questionIds)||!Array.isArray(studentAnswers)||!Array.isArray(clientQuestions)||studentAnswers.length!==questionIds.length||clientQuestions.length!==questionIds.length) {
            return new Response(JSON.stringify({error:'Answer count does not match the issued exam'}),{status:400,headers:corsHeaders});
        }
        for(const answer of studentAnswers) {
            if(answer && typeof answer==='object' && answer.image && !normalizedImageUrl(answer.image)) {
                return new Response(JSON.stringify({error:'Invalid answer image source'}),{status:400,headers:corsHeaders});
            }
        }
        const tokenHash=await hashToken(token);
        const resultId='attempt-'+tokenHash;
        const responseForSaved=(saved:any,duplicate=false)=>{
            const details=typeof saved.details==='string'?JSON.parse(saved.details):saved.details;
            const reveal=asFlag(examConfig.show_details ?? examConfig.showDetails,true);
            const showScore=asFlag(examConfig.show_score ?? examConfig.showScore,true);
            return new Response(JSON.stringify({resultId:saved.id,score:showScore?saved.score:null,
                correctCount:showScore?saved.correct_count:null,duplicate,
                detailedResults:(details||[]).map((d:any)=>restrictResultDetail(d,reveal,showScore))}),{status:200,headers:corsHeaders});
        };
        const prior=await db.prepare('SELECT * FROM results WHERE id=?').bind(resultId).first();
        if(prior)return responseForSaved(prior,true);
        let issuedQuestions:any[];
        try { issuedQuestions=await restoreAttemptQuestions(decoded,clientQuestions,SECRET); }
        catch { return new Response(JSON.stringify({error:'Question payload differs from the issued exam'}),{status:400,headers:corsHeaders}); }

        // 1. Chuẩn hóa thang điểm từ examConfig
        const p41 = getNum(examConfig.points41 ?? examConfig.points_41, 1);
        const pTF4 = getNum(examConfig.pointsTF4 ?? examConfig.points_tf4, 1);
        const pSQ = getNum(examConfig.pointsSQ ?? examConfig.points_sq, 1);
        const pTL = getNum(examConfig.pointsTL ?? examConfig.points_tl, 1);

        // Fetch Exam Config từ CSDL để lấy AI Grading Key nếu có
        let aiKey = '';
        try {
            if (examConfig.id) {
                const row=await db.prepare('SELECT ai_grading_key FROM exam_configs WHERE id=? AND creator_id=?').bind(String(examConfig.id),String(teacherId)).first();
                if(row?.ai_grading_key)aiKey=String(row.ai_grading_key);
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

        // Grade exactly the original server-issued snapshot, even if the bank is edited later.
        const trueQuestionsMap:Record<string,any> = Object.fromEntries(issuedQuestions.map(q=>[String(q.id),{...q,type:normalizeType(q.type)}]));

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
                const isCaseSensitive=asFlag(examConfig.sqCaseSensitive ?? examConfig.sq_case_sensitive);
                const isPunctuationSensitive=asFlag(examConfig.sqPunctuationSensitive ?? examConfig.sq_punctuation_sensitive);
                const normalize=(value:any)=>{
                    let text=String(value ?? '').normalize('NFC').trim();
                    if(!isCaseSensitive)text=text.toLowerCase();
                    if(!isPunctuationSensitive)text=text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,'').replace(/\s+/g,' ').trim();
                    return text;
                };
                const acceptable=String(correctAnswer ?? '').split(/[|;]+/).map(normalize).filter(Boolean);
                const given=normalize(userAnswer);
                isCorrect=given!=='' && acceptable.includes(given);
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

                const isTf4CustomMode = asFlag(examConfig.tf4ScoringMode ?? examConfig.tf4_scoring_mode);
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

        // AI Grading for TL (Tự luận) - Hỗ trợ danh sách nhiều key cách nhau bằng dấu cách, tự động chuyển key khi hết hạn mức
        const isAutoGradeEssay = asFlag(examConfig.auto_grade_essay ?? examConfig.autoGradeEssay);
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
                                signal: AbortSignal.timeout(12000),
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
                                    const essayScore = Math.max(0, Math.min(pTL, Number(parsed.score) || 0));
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
        const finalScore = calculatedRaw;

        const cheatWarningCount = Math.min(100000,Math.max(0,Math.floor(Number(body.cheatWarningCount ?? body.studentInfo?.cheatWarningCount ?? 0) || 0)));
        const correctCount = detailedResults.filter((d: any) => d.isCorrect && d.question.type !== 'TL').length;

        const record={
            id:resultId,user_id:authenticatedUserId,student_name:authenticatedStudentName,
            student_class:decoded.subject?authenticatedDonvi:String(studentInfo.unit || ''),
            lop:authenticatedLop,don_vi:authenticatedDonvi,exam_name:String(examConfig.name || ''),
            exam_id:String(examConfig.id || ''),score:finalScore,
            time_taken:Math.max(0,Math.floor((Date.now()-Number(decoded.timestamp))/1000)),
            correct_count:correctCount,total_questions:questionIds.length,details:JSON.stringify(detailedResults),
            loai_thi_sinh:authenticatedUserId?'Authenticated':'Guest',cheat_warning_count:cheatWarningCount,
            created_at:new Date().toISOString()
        };
        const persisted=await persistExamResult(db,record,tokenHash,decoded.subject?.accountId || null,Number(decoded.maxAttempts || 0));
        if(persisted.existing)return responseForSaved(persisted.existing,true);
        if(!persisted.inserted)return new Response(JSON.stringify({error:'Attempt limit reached; no result was saved',code:'ATTEMPT_LIMIT'}),{status:403,headers:corsHeaders});

        // BẢO MẬT: Nếu cấu hình không cho xem chi tiết đáp án, loại bỏ hoàn toàn correctAnswer và ảnh đáp án trước khi trả về client
        const shouldShowDetails=asFlag(examConfig.show_details ?? examConfig.showDetails,true);
        const shouldShowScore=asFlag(examConfig.show_score ?? examConfig.showScore,true);
        const clientDetailedResults=detailedResults.map((d:any)=>restrictResultDetail(d,shouldShowDetails,shouldShowScore));

        return new Response(JSON.stringify({
            resultId,
            score: shouldShowScore ? finalScore : null,
            rawEarnedScore: shouldShowScore ? calculatedRaw : null,
            totalMaxScore: Number(totalMaxScore.toFixed(2)),
            scale10Score: shouldShowScore ? calculatedScale10 : null,
            correctCount: shouldShowScore ? correctCount : null,
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
