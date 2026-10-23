import { getDatabase, getDynamicSecret, verifyAuthSession, checkIsTeacherOrAdmin, checkIsAdmin } from './utils';
import { generateExamDocx } from '../../../src/exam-docx-generator';
import { generateExamAnswerExcel, ExamAnswerDoc } from '../../../src/exam-excel-generator';
import JSZip from 'jszip';

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
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

// Chuẩn hóa và đối sánh bài học chính xác tuyệt đối 100%
function normalizeLesson(l: any): string {
  if (!l) return '';
  return String(l).trim().toLowerCase().replace(/\s+/g, ' ');
}

function removeVietnameseTones(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function normalizeLessonKey(l: any): string {
  if (!l) return '';
  return removeVietnameseTones(String(l).trim().toLowerCase())
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLessonMatched(qLessonRaw: string, allowedLessons: string[]): boolean {
  if (!allowedLessons || allowedLessons.length === 0) return true;
  const qRaw = String(qLessonRaw || '').trim();
  if (!qRaw) return false;

  const qNorm = normalizeLesson(qRaw);
  const qKey = normalizeLessonKey(qRaw);

  for (const allowed of allowedLessons) {
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
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const db = getDatabase(context);
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);

  try {
    let params: any = {};
    if (request.method === 'POST') {
      try {
        params = await request.json();
      } catch (e) {
        params = {};
      }
    } else {
      const url = new URL(request.url);
      url.searchParams.forEach((val, key) => {
        params[key] = val;
      });
    }

    const examId = params.examId || params.id;
    let teacherId = params.teacherId;

    const authHeader = request.headers.get('Authorization');
    let tokenUser: any = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        tokenUser = await verifyAuthSession(token, SECRET, db);
      } catch (e) {}
    }

    if (!teacherId && tokenUser) {
      teacherId = tokenUser.id || tokenUser.user_id;
    }

    if (!examId && !params.examConfig && !params.examName) {
      return new Response(JSON.stringify({ error: 'Thiếu thông tin mã đề thi (examId)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 1. TRUY VẤN CẤU HÌNH GỐC CHÍNH XÁC TRỰC TIẾP TỪ CSDL NEON POSTGRESQL
    let dbExam: any = null;
    try {
      if (examId) {
        const { results } = await db.prepare("SELECT * FROM exam_configs WHERE id = ?").bind(String(examId)).all();
        if (results && results.length > 0) {
          dbExam = results[0];
        }
      }
      if (!dbExam && (teacherId || params.examName || params.deThiTitle)) {
        const searchName = (params.examName || params.deThiTitle || params.examConfig?.name || '').trim().toLowerCase();
        if (searchName) {
          let rows: any[] = [];
          if (teacherId) {
            const { results } = await db.prepare("SELECT * FROM exam_configs WHERE creator_id = ? ORDER BY updated_at DESC, created_at DESC").bind(String(teacherId)).all();
            rows = results || [];
          }
          if (!rows || rows.length === 0) {
            const { results } = await db.prepare("SELECT * FROM exam_configs ORDER BY updated_at DESC, created_at DESC").all();
            rows = results || [];
          }
          if (rows && rows.length > 0) {
            dbExam = rows.find((row: any) => {
              const rName = String(row.name || '').trim().toLowerCase();
              return rName === searchName || searchName.includes(rName) || rName.includes(searchName);
            });
          }
        }
      }
    } catch (dbErr) {
      console.error("Lỗi khi tìm cấu hình đề thi từ DB:", dbErr);
    }

    if (!checkIsTeacherOrAdmin(tokenUser) || (!checkIsAdmin(tokenUser) && String(dbExam?.creator_id || teacherId) !== String(tokenUser.id))) {
      return new Response(JSON.stringify({error:'Exam export is restricted to its owner'}),{status:403,headers:{'Content-Type':'application/json'}});
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

    let finalSelectedLessons: string[] = [];
    let finalCountsDetail: any = {};
    let targetCount41 = 0;
    let targetCountTF4 = 0;
    let targetCountSQ = 0;
    let targetCountTL = 0;
    let examName = 'Đề thi';
    let timeLimit = 45;
    let effectiveTeacherId = teacherId;

    if (dbExam) {
      const mapped = mapRowRead(dbExam);
      examName = mapped.name || 'Đề thi';
      effectiveTeacherId = mapped.creator_id || teacherId;
      timeLimit = Number(mapped.time_limit || 45);

      if (Array.isArray(mapped.selected_lessons)) {
        finalSelectedLessons = mapped.selected_lessons;
      } else if (typeof mapped.selected_lessons === 'string') {
        try { finalSelectedLessons = JSON.parse(mapped.selected_lessons); } catch { 
          finalSelectedLessons = mapped.selected_lessons ? [mapped.selected_lessons] : []; 
        }
      }

      if (mapped.counts_detail && typeof mapped.counts_detail === 'object') {
        finalCountsDetail = mapped.counts_detail;
      } else if (typeof mapped.counts_detail === 'string') {
        try { finalCountsDetail = JSON.parse(mapped.counts_detail); } catch { finalCountsDetail = {}; }
      }

      targetCount41 = Number(mapped.count_41 || mapped.count41 || 0);
      targetCountTF4 = Number(mapped.count_tf4 || mapped.countTF4 || 0);
      targetCountSQ = Number(mapped.count_sq || mapped.countSQ || 0);
      targetCountTL = Number(mapped.count_tl || mapped.countTL || 0);
    } else if (params.examConfig) {
      const cfg = typeof params.examConfig === 'object' ? params.examConfig : JSON.parse(params.examConfig);
      examName = cfg.name || 'Đề thi';
      effectiveTeacherId = cfg.creatorId || teacherId;
      timeLimit = Number(cfg.timeLimit || 45);
      finalSelectedLessons = Array.isArray(cfg.selectedLessons) ? cfg.selectedLessons : (Array.isArray(cfg.selected_lessons) ? cfg.selected_lessons : []);
      finalCountsDetail = cfg.countsDetail || cfg.counts_detail || {};
      targetCount41 = Number(cfg.count41 || cfg.count_41 || 0);
      targetCountTF4 = Number(cfg.countTF4 || cfg.count_tf4 || 0);
      targetCountSQ = Number(cfg.countSQ || cfg.count_sq || 0);
      targetCountTL = Number(cfg.countTL || cfg.count_tl || 0);
    }

    // Tự động tính số lượng câu từ chi tiết ma trận nếu số tổng chưa được đặt
    const sum41Detail = Number(finalCountsDetail.count41NB || 0) + Number(finalCountsDetail.count41TH || 0) + Number(finalCountsDetail.count41VD || 0);
    if (targetCount41 <= 0 && sum41Detail > 0) targetCount41 = sum41Detail;

    const sumTF4Detail = Number(finalCountsDetail.countTF4NB || 0) + Number(finalCountsDetail.countTF4TH || 0) + Number(finalCountsDetail.countTF4VD || 0);
    if (targetCountTF4 <= 0 && sumTF4Detail > 0) targetCountTF4 = sumTF4Detail;

    const sumSQDetail = Number(finalCountsDetail.countSQNB || 0) + Number(finalCountsDetail.countSQTH || 0) + Number(finalCountsDetail.countSQVD || 0);
    if (targetCountSQ <= 0 && sumSQDetail > 0) targetCountSQ = sumSQDetail;

    const sumTLDetail = Number(finalCountsDetail.countTLNB || 0) + Number(finalCountsDetail.countTLTH || 0) + Number(finalCountsDetail.countTLVD || 0);
    if (targetCountTL <= 0 && sumTLDetail > 0) targetCountTL = sumTLDetail;

    // 2. KIỂM TRA QUY TẮC BẮT BUỘC VỀ BÀI HỌC
    if (!finalSelectedLessons || finalSelectedLessons.length === 0) {
      return new Response(JSON.stringify({
        error: 'Đề thi này chưa được chọn Bài học/Chuyên đề trong cấu hình cài đặt. Vui lòng vào cấu hình đề thi và tích chọn ít nhất 1 bài học!'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3. TRUY VẤN TẤT CẢ CÂU HỎI CỦA GIÁO VIÊN HOẶC HỆ THỐNG TỪ CSDL
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
    } catch (err: any) {
      return new Response(JSON.stringify({ error: 'Lỗi truy vấn ngân hàng câu hỏi: ' + err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!allQuestions || allQuestions.length === 0) {
      return new Response(JSON.stringify({ error: 'Không tìm thấy câu hỏi nào trong ngân hàng đề!' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 4. LẤY THÔNG TIN ĐƠN VỊ CỦA GIÁO VIÊN ĐỂ IN VÀO HEADER ĐỀ THI
    let teacherDonVi = '';
    if (effectiveTeacherId) {
      try {
        const { results: accRows } = await db.prepare(
          "SELECT donvi, address FROM users WHERE id = ? OR id IN (SELECT user_id FROM accounts WHERE id = ? OR username = ?)"
        ).bind(String(effectiveTeacherId), String(effectiveTeacherId), String(effectiveTeacherId)).all();
        if (accRows && accRows.length > 0) {
          teacherDonVi = (accRows[0] as any).donvi || (accRows[0] as any).address || '';
        }
      } catch (e) {}
    }

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

    // 5. LỌC CÂU HỎI HỢP LỆ VÀ ĐÚNG 100% THEO BÀI HỌC ĐÃ CHỌN
    const seenQuestionIds = new Set<string>();
    const validPool = allQuestions
      .map(mapRowRead)
      .filter(q => {
        const qId = String(q.id || '');
        if (!qId || seenQuestionIds.has(qId)) return false;
        
        // Bỏ qua toàn bộ câu hỏi rỗng không có nội dung chữ
        const contentStr = String(q.content || '').trim();
        if (!contentStr) return false;

        seenQuestionIds.add(qId);
        return true;
      })
      .map(q => {
        let opts = q.options || {};
        if (typeof opts === 'string') {
          try { opts = JSON.parse(opts); } catch { opts = {}; }
        }
        return {
          id: q.id,
          type: normalizeType(q.type),
          level: normalizeLevel(q.level),
          lesson: q.lesson,
          content: q.content,
          options: opts,
          answer: q.answer,
          image: q.image || '',
          creatorId: q.creator_id
        };
      })
      .filter(q => {
        // Đối với câu hỏi trắc nghiệm 4-1, bắt buộc phải có ít nhất 1 phương án
        if (q.type === '4-1') {
          const opts = q.options || {};
          let hasOpt = false;
          if (Array.isArray(opts)) {
            hasOpt = opts.some(v => v !== null && v !== undefined && String(typeof v === 'object' ? (v.text || v.content || '') : v).trim().length > 0);
          } else if (typeof opts === 'object') {
            hasOpt = Object.values(opts).some(v => v !== null && v !== undefined && String(typeof v === 'object' ? (v.text || v.content || '') : v).trim().length > 0);
          }
          if (!hasOpt) return false;
        }
        return true;
      })
      .filter(q => isLessonMatched(q.lesson, finalSelectedLessons));

    const totalRequired = targetCount41 + targetCountTF4 + targetCountSQ + targetCountTL;
    if (totalRequired === 0) {
      return new Response(JSON.stringify({ error: 'Cấu hình đề thi chưa có số lượng câu hỏi nào (> 0)!' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const shuffle = (arr: any[]) => [...arr].sort(() => Math.random() - 0.5);

    const numExams = Math.min(20, Math.max(1, Number(params.soLuongDe || params.numExams || 1)));
    const baseMaDeRaw = String(params.maDe || '1201').trim();

    const formatNextMaDe = (baseStr: string, index: number) => {
      if (index === 0) return baseStr;
      const match = baseStr.match(/^(.*?)(\d+)$/);
      if (match) {
        const prefix = match[1];
        const digits = match[2];
        const nextVal = Number(digits) + index;
        const nextDigitsStr = String(nextVal).padStart(digits.length, '0');
        return prefix + nextDigitsStr;
      }
      return baseStr + "_" + (index + 1);
    };

    const generatedDocs: Array<{ maDe: string; fileName: string; buffer: any }> = [];
    const examAnswerDocs: ExamAnswerDoc[] = [];

    // 6. THỰC HIỆN BỐC CÂU HỎI CHUẨN XÁC THEO MA TRẬN VÀ BÀI HỌC CHO TỪNG MÃ ĐỀ
    for (let v = 0; v < numExams; v++) {
      const currentMaDe = formatNextMaDe(baseMaDeRaw, v);
      const selectedQuestions: any[] = [];

      const pickCategory = (type: string, typeLabel: string, targetCount: number, nbTarget: number, thTarget: number, vdTarget: number) => {
        if (targetCount <= 0) return;

        const pool = validPool.filter(q => q.type === type);
        if (pool.length < targetCount) {
          throw new Error(`Ngân hàng đề không đủ câu hỏi [${typeLabel}] trong các bài học đã chọn (${finalSelectedLessons.join(', ')})! Yêu cầu: ${targetCount} câu, nhưng chỉ có sẵn ${pool.length} câu.`);
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

          // Tự động bù từ các câu hỏi còn lại của cùng dạng bài và cùng bài học đã chọn
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
          selectedQuestions.push(...shuffle(pool).slice(0, targetCount));
        }
      };

      const cDetail = finalCountsDetail;
      try {
        pickCategory('4-1', 'Trắc nghiệm 4 lựa chọn', targetCount41, Number(cDetail.count41NB || 0), Number(cDetail.count41TH || 0), Number(cDetail.count41VD || 0));
        pickCategory('TF4', 'Đúng - Sai', targetCountTF4, Number(cDetail.countTF4NB || 0), Number(cDetail.countTF4TH || 0), Number(cDetail.countTF4VD || 0));
        pickCategory('SQ', 'Trả lời ngắn', targetCountSQ, Number(cDetail.countSQNB || 0), Number(cDetail.countSQTH || 0), Number(cDetail.countSQVD || 0));
        pickCategory('TL', 'Tự luận', targetCountTL, Number(cDetail.countTLNB || 0), Number(cDetail.countTLTH || 0), Number(cDetail.countTLVD || 0));
      } catch (pickErr: any) {
        return new Response(JSON.stringify({ error: pickErr.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (selectedQuestions.length !== totalRequired) {
        return new Response(JSON.stringify({
          error: `Số lượng câu hỏi bốc được (${selectedQuestions.length} câu) không khớp với cấu hình đề thi (${totalRequired} câu)!`
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Kiểm tra 100% câu hỏi bốc ra phải thuộc các bài học đã chọn
      const invalidQs = selectedQuestions.filter(q => !isLessonMatched(q.lesson, finalSelectedLessons));
      if (invalidQs.length > 0) {
        return new Response(JSON.stringify({
          error: 'Phát hiện câu hỏi không thuộc bài học đã chọn trong đề thi!'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const headerOpts = {
        soGiaoDuc: params.soGiaoDuc || "SỞ GIÁO DỤC VÀ ĐÀO TẠO GIA LAI",
        truongHoc: params.truongHoc || (teacherDonVi ? `TRƯỜNG ${teacherDonVi}` : "TRƯỜNG THPT LÊ HOÀN"),
        deThiTitle: params.deThiTitle || (examName.toUpperCase().includes('ĐỀ') ? examName : `ĐỀ KIỂM TRA: ${examName}`),
        namHoc: params.namHoc || "NĂM HỌC 2026 - 2027",
        monHoc: params.monHoc || (finalSelectedLessons.length > 0 ? `MÔN ${finalSelectedLessons[0].toUpperCase()}` : "MÔN TIN HỌC, LỚP 12"),
        thoiGian: params.thoiGian || timeLimit,
        maDe: currentMaDe
      };

      const docxData = await generateExamDocx(headerOpts, selectedQuestions);
      const safeFileName = `De_Thi_${examName.replace(/[^a-zA-Z0-9_\u00C0-\u1EF9]/g, '_')}_MaDe_${currentMaDe}.docx`;

      generatedDocs.push({
        maDe: currentMaDe,
        fileName: safeFileName,
        buffer: docxData
      });

      examAnswerDocs.push({
        maDe: currentMaDe,
        questions: selectedQuestions
      });
    }

    // 7. TẠO BẢNG ĐÁP ÁN EXCEL (.xlsx) CHỨA CÁC CỘT TƯƠNG ỨNG TỪNG MÃ ĐỀ THI
    const excelHeaderInfo = {
      deThiTitle: params.deThiTitle || examName,
      soGiaoDuc: params.soGiaoDuc || "SỞ GIÁO DỤC VÀ ĐÀO TẠO GIA LAI",
      truongHoc: params.truongHoc || (teacherDonVi ? `TRƯỜNG ${teacherDonVi}` : "TRƯỜNG THPT LÊ HOÀN"),
      monHoc: params.monHoc || (finalSelectedLessons.length > 0 ? `MÔN ${finalSelectedLessons[0].toUpperCase()}` : "MÔN TIN HỌC, LỚP 12"),
      namHoc: params.namHoc || "NĂM HỌC 2026 - 2027",
      thoiGian: params.thoiGian || timeLimit
    };
    const excelAnswerBuffer = generateExamAnswerExcel(excelHeaderInfo, examAnswerDocs);

    const startCode = generatedDocs[0].maDe;
    const endCode = generatedDocs[generatedDocs.length - 1].maDe;
    const safeExamName = examName.replace(/[^a-zA-Z0-9_\u00C0-\u1EF9]/g, '_');

    const zip = new JSZip();

    for (const doc of generatedDocs) {
      zip.file(doc.fileName, doc.buffer);
    }

    // Đưa file Excel đáp án vào file zip
    const excelFileName = numExams === 1
      ? `Bang_Dap_An_MaDe_${startCode}.xlsx`
      : `Bang_Dap_An_Tong_Hop_Cac_Ma_De_${startCode}_den_${endCode}.xlsx`;
    zip.file(excelFileName, excelAnswerBuffer);

    const zipUint8Array = await zip.generateAsync({ type: 'uint8array' });
    const zipFileName = numExams === 1
      ? `De_Thi_kem_Dap_An_${safeExamName}_MaDe_${startCode}.zip`
      : `Bo_De_Thi_${safeExamName}_Gom_${numExams}_MaDe_${startCode}_den_${endCode}_kem_Dap_An.zip`;

    return new Response(zipUint8Array, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(zipFileName)}"; filename*=UTF-8''${encodeURIComponent(zipFileName)}`
      }
    });

  } catch (err: any) {
    console.error("Lỗi xuất đề thi file Word trên Cloudflare Pages:", err);
    return new Response(JSON.stringify({ error: 'Lỗi khi tạo file Word đề thi: ' + (err.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};
