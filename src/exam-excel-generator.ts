import * as XLSX from 'xlsx';

export interface ExamAnswerDoc {
  maDe: string;
  questions: Array<{
    id?: string | number;
    type: string;
    level?: string;
    lesson?: string;
    content: string;
    options?: any;
    answer: any;
    image?: string;
  }>;
}

export interface ExcelHeaderInfo {
  deThiTitle?: string;
  soGiaoDuc?: string;
  truongHoc?: string;
  namHoc?: string;
  monHoc?: string;
  thoiGian?: number | string;
}

/**
 * Format answer text cleanly based on question type
 */
export function formatAnswerDisplay(type: string, rawAnswer: any, options?: any): string {
  if (rawAnswer === undefined || rawAnswer === null) return '';

  let ans = rawAnswer;
  if (typeof ans === 'string' && (ans.startsWith('{') || ans.startsWith('['))) {
    try {
      ans = JSON.parse(ans);
    } catch (e) {}
  }

  const normType = String(type || '').trim().toLowerCase();

  // 1. Trắc nghiệm 4-1
  if (normType === '4-1' || normType === 'trac_nghiem' || normType === 'mcq') {
    if (typeof ans === 'string') {
      return ans.trim().toUpperCase();
    }
    if (typeof ans === 'object' && ans !== null) {
      return String(ans.key || ans.answer || ans.value || '').trim().toUpperCase();
    }
    return String(ans).trim().toUpperCase();
  }

  // 2. Đúng - Sai (TF4)
  if (normType === 'tf4' || normType === 'dung_sai' || normType === 'true_false') {
    // Nếu là object dạng { a: true/false, b: ... } hoặc { a: 'Đ'/'S', ... }
    if (typeof ans === 'object' && ans !== null) {
      const getTF = (val: any) => {
        if (val === true || val === 1 || String(val).toLowerCase() === 'true' || String(val).toUpperCase() === 'Đ' || String(val).toUpperCase() === 'D' || String(val).toUpperCase() === 'T') return 'Đ';
        return 'S';
      };
      const a = getTF(ans.a ?? ans.A);
      const b = getTF(ans.b ?? ans.B);
      const c = getTF(ans.c ?? ans.C);
      const d = getTF(ans.d ?? ans.D);
      return `a: ${a} | b: ${b} | c: ${c} | d: ${d}`;
    }

    const ansStr = String(ans).trim();
    // Dạng 'A&C' hoặc 'A,C' hoặc 'AC' (những ý đúng)
    if (ansStr.includes('&') || /^[A-D,\s]+$/i.test(ansStr)) {
      const upper = ansStr.toUpperCase();
      const isA = upper.includes('A');
      const isB = upper.includes('B');
      const isC = upper.includes('C');
      const isD = upper.includes('D');
      return `a: ${isA ? 'Đ' : 'S'} | b: ${isB ? 'Đ' : 'S'} | c: ${isC ? 'Đ' : 'S'} | d: ${isD ? 'Đ' : 'S'}`;
    }

    return ansStr;
  }

  // 3. Trả lời ngắn & Tự luận
  const cleanAns = String(ans || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\\\((.*?)\\\)/gs, '$1')
    .replace(/\\\[(.*?)\\\]/gs, '$1')
    .replace(/\$\$(.*?)\$\$/gs, '$1')
    .replace(/\$(.*?)\$/gs, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return cleanAns;
}

/**
 * Sinh file Excel bảng đáp án theo chuẩn giáo dục Việt Nam:
 * - Sheet 1: BẢNG ĐÁP ÁN TỔNG HỢP (Các cột tương ứng từng Mã đề thi)
 * - Sheet 2: Chi tiết câu hỏi và đáp án từng mã đề
 */
export function generateExamAnswerExcel(
  headerInfo: ExcelHeaderInfo,
  examDocs: ExamAnswerDoc[]
): Uint8Array {
  const wb = XLSX.utils.book_new();

  // -------------------------------------------------------------
  // SHEET 1: BẢNG ĐÁP ÁN TỔNG HỢP THEO MÃ ĐỀ (MATRIX VIEW)
  // -------------------------------------------------------------
  const title = (headerInfo.deThiTitle || 'ĐỀ KIỂM TRA').toUpperCase();
  const soGD = (headerInfo.soGiaoDuc || 'SỞ GIÁO DỤC VÀ ĐÀO TẠO').toUpperCase();
  const truong = (headerInfo.truongHoc || 'TRƯỜNG THPT').toUpperCase();
  const mon = (headerInfo.monHoc || '').toUpperCase();
  const nam = headerInfo.namHoc || 'NĂM HỌC 2026 - 2027';
  const time = headerInfo.thoiGian ? `${headerInfo.thoiGian} phút` : '45 phút';

  const matrixRows: any[][] = [];

  // Tiêu đề & Thông tin chung
  matrixRows.push([soGD, '', 'BẢNG ĐÁP ÁN ĐỀ THI TRẮC NGHIỆM']);
  matrixRows.push([truong, '', title]);
  matrixRows.push([`Môn: ${mon}`, '', `Năm học: ${nam} | Thời gian làm bài: ${time}`]);
  matrixRows.push([]); // Dòng trống

  // Header bảng: STT | Loại câu | Mã đề 1 | Mã đề 2 | ...
  const tableHeader = ['STT', 'Phần / Dạng câu'];
  for (const doc of examDocs) {
    tableHeader.push(`Mã đề ${doc.maDe}`);
  }
  matrixRows.push(tableHeader);

  // Tìm số lượng câu hỏi tối đa giữa các đề
  const maxQuestions = Math.max(...examDocs.map(d => d.questions.length), 0);

  for (let i = 0; i < maxQuestions; i++) {
    const qNum = i + 1;
    // Lấy dạng câu hỏi từ đề đầu tiên có câu này
    const refQ = examDocs.find(d => d.questions[i])?.questions[i];
    let typeLabel = 'Trắc nghiệm 4-1';
    if (refQ) {
      const t = String(refQ.type || '').toLowerCase();
      if (t === '4-1' || t === 'trac_nghiem') typeLabel = 'Phần I (Trắc nghiệm 4-1)';
      else if (t === 'tf4' || t === 'dung_sai') typeLabel = 'Phần II (Đúng - Sai)';
      else if (t === 'sq' || t === 'tra_loi_ngan') typeLabel = 'Phần III (Trả lời ngắn)';
      else if (t === 'tl' || t === 'tu_luan') typeLabel = 'Phần IV (Tự luận)';
    }

    const row: any[] = [`Câu ${qNum}`, typeLabel];

    for (const doc of examDocs) {
      const q = doc.questions[i];
      if (q) {
        row.push(formatAnswerDisplay(q.type, q.answer, q.options));
      } else {
        row.push('-');
      }
    }
    matrixRows.push(row);
  }

  const wsSummary = XLSX.utils.aoa_to_sheet(matrixRows);

  // Căn chỉnh độ rộng cột tự động
  const colWidths: any[] = [
    { wch: 10 },  // STT
    { wch: 28 },  // Dạng câu
  ];
  for (let c = 0; c < examDocs.length; c++) {
    colWidths.push({ wch: 26 }); // Cột từng mã đề
  }
  wsSummary['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, wsSummary, 'BANG_DAP_AN_TONG_HOP');

  // -------------------------------------------------------------
  // SHEET 2: CHI TIẾT ĐÁP ÁN TỪNG CÂU VÀ NỘI DUNG (DETAIL VIEW)
  // -------------------------------------------------------------
  const detailRows: any[][] = [];
  detailRows.push(['MÃ ĐỀ', 'CÂU', 'DẠNG CÂU', 'MỨC ĐỘ', 'BÀI HỌC', 'ĐÁP ÁN ĐÚNG', 'NỘI DUNG CÂU HỎI']);

  for (const doc of examDocs) {
    for (let i = 0; i < doc.questions.length; i++) {
      const q = doc.questions[i];
      const qNum = i + 1;
      const cleanContent = String(q.content || '')
        .replace(/<[^>]*>/g, '')
        .replace(/\\\((.*?)\\\)/gs, '$1')
        .replace(/\\\[(.*?)\\\]/gs, '$1')
        .replace(/\$\$(.*?)\$\$/gs, '$1')
        .replace(/\$(.*?)\$/gs, '$1')
        .replace(/\s+/g, ' ')
        .trim();

      detailRows.push([
        doc.maDe,
        `Câu ${qNum}`,
        q.type,
        q.level || 'NB',
        q.lesson || '',
        formatAnswerDisplay(q.type, q.answer, q.options),
        cleanContent
      ]);
    }
  }

  const wsDetail = XLSX.utils.aoa_to_sheet(detailRows);
  wsDetail['!cols'] = [
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 25 },
    { wch: 28 },
    { wch: 70 }
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'CHI_TIET_CAU_HOI');

  // Xuất file dạng Uint8Array tương thích 100% môi trường Cloudflare Pages, Node.js và Web
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(excelBuffer);
}
