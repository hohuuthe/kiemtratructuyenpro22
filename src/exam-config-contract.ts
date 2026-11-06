/**
 * Canonical, side-effect-free contract for the two exam configuration tabs.
 * A partial update preserves unspecified persisted fields. Explicit 0/false
 * are never replaced by defaults, and invalid values are rejected, not coerced.
 */
export class ExamConfigInputError extends Error {
  status = 400;
  code = 'INVALID_EXAM_CONFIG';
  constructor(message: string) { super(message); this.name = 'ExamConfigInputError'; }
}
type Row = Record<string, any>;
const own = (object: Row, key: string) => Object.prototype.hasOwnProperty.call(object, key);
function from(body: Row, old: Row | null, keys: string[], fallback: any): any {
  for (const key of keys) if (own(body, key) && body[key] !== undefined) return body[key];
  if (old) for (const key of keys) if (own(old, key) && old[key] !== undefined && old[key] !== null) return old[key];
  return fallback;
}
function string(value: any, name: string, max = 2000): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw new ExamConfigInputError(name + ' phải là chuỗi ký tự.');
  const cleaned = value.trim();
  if (cleaned.length > max) throw new ExamConfigInputError(name + ' vượt giới hạn ' + max + ' ký tự.');
  return cleaned;
}
function integer(value: any, name: string, min: number, max: number): number {
  if (value === null || value === '' || typeof value === 'boolean') throw new ExamConfigInputError(name + ' không hợp lệ.');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new ExamConfigInputError(name + ' phải là số nguyên từ ' + min + ' đến ' + max + '.');
  return number;
}
function decimal(value: any, name: string, min = 0, max = 1000): number {
  if (value === null || value === '' || typeof value === 'boolean') throw new ExamConfigInputError(name + ' không hợp lệ.');
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new ExamConfigInputError(name + ' phải nằm trong khoảng ' + min + ' đến ' + max + '.');
  return number;
}
export function examConfigFlag(value: any, name = 'Tùy chọn'): number {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true','1','yes','on'].includes(v)) return 1;
    if (['false','0','no','off',''].includes(v)) return 0;
  }
  throw new ExamConfigInputError(name + ' phải là bật hoặc tắt.');
}
function jsonValue(value: any, name: string, fallback: any): any {
  if (value === null || value === '' || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); }
    catch { throw new ExamConfigInputError(name + ' không phải JSON hợp lệ.'); }
  }
  return value;
}
function objectValue(value: any, name: string): Row {
  const parsed = jsonValue(value,name,{});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ExamConfigInputError(name + ' phải là một đối tượng.');
  return parsed;
}
function lessons(value: any): string {
  const parsed = jsonValue(value,'Danh sách bài học',[]);
  if (!Array.isArray(parsed)) throw new ExamConfigInputError('Danh sách bài học không hợp lệ.');
  const result = [...new Set(parsed.map((lesson) => string(lesson,'Tên bài học',250)).filter(Boolean))];
  if (!result.length) throw new ExamConfigInputError('Đề thi phải chọn ít nhất một bài học/chuyên đề.');
  if (result.length > 500) throw new ExamConfigInputError('Danh sách bài học quá lớn.');
  return JSON.stringify(result);
}
const types: Array<[string,string]> = [['41','Trắc nghiệm'],['TF4','Đúng/Sai'],['SQ','Trả lời ngắn'],['TL','Tự luận']];
function counts(value: any, totals: Row): string {
  const raw = objectValue(value,'Chi tiết cơ cấu câu hỏi');
  const result: Row = {};
  for (const [type,label] of types) {
    let sum = 0;
    for (const level of ['NB','TH','VD']) {
      const key = 'count'+type+level;
      const n = integer(raw[key] ?? 0, 'Số câu ' + label + ' ' + level,0,10000);
      result[key] = n; sum += n;
    }
    const total = totals['count_'+type.toLowerCase()];
    // Legacy configs without a difficulty breakdown remain valid and editable.
    if (sum !== 0 && sum !== total) throw new ExamConfigInputError('Cơ cấu ' + label + ' (' + sum + ') khác tổng (' + total + ').');
  }
  return JSON.stringify(result);
}
function tf4Points(value: any): string {
  const raw = objectValue(value,'Điểm từng ý Đúng/Sai');
  const defaults: Row = {'1':0.25,'2':0.5,'3':0.75,'4':1};
  const result: Row = {};
  for (const key of ['1','2','3','4']) result[key] = decimal(raw[key] ?? defaults[key],'Điểm đúng ' + key + ' ý');
  if (!(result['1'] <= result['2'] && result['2'] <= result['3'] && result['3'] <= result['4'])) {
    throw new ExamConfigInputError('Điểm Đúng/Sai tùy chỉnh phải tăng dần theo số ý trả lời đúng.');
  }
  return JSON.stringify(result);
}
function acl(value: any): string {
  const raw = objectValue(value,'Giới hạn thời gian và đơn vị');
  // Retain historical allowedUnits metadata, since some existing exams use it.
  const start = string(raw.startTime ?? '', 'Ngày bắt đầu',50);
  const end = string(raw.endTime ?? '', 'Ngày kết thúc',50);
  for (const date of [start,end]) if (date && !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(date)) {
    throw new ExamConfigInputError('Thời gian phải có dạng ngày và giờ hợp lệ.');
  }
  if (start && end && start >= end) throw new ExamConfigInputError('Thời gian kết thúc phải sau thời gian bắt đầu.');
  const result: Row = {...raw, enabled: examConfigFlag(raw.enabled ?? false,'Kích hoạt lịch'), startTime:start,endTime:end};
  return JSON.stringify(result);
}
export function normalizeExamConfigInput(body: Row, old: Row | null = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ExamConfigInputError('Dữ liệu cấu hình đề thi không hợp lệ.');
  const value = (key: string, alias: string | null, fallback: any) =>
    from(body,old,alias ? [key,alias]:[key],fallback);
  const name=string(value('name',null,''),'Tên đề thi',200);
  if (!name) throw new ExamConfigInputError('Tên đề thi không được để trống.');
  const mode=string(value('chedodethi',null,'Đề công khai'),'Chế độ đề thi',50);
  if (!['Đề công khai','Đề cho đơn vị','Đề thi cho đơn vị','Đề có mã bảo mật'].includes(mode)) {
    throw new ExamConfigInputError('Chế độ đề thi không hợp lệ.');
  }
  const time_limit=integer(from(body,old,['time_limit','timeLimit','time'],45),'Thời gian làm bài',1,180);
  const count_41=integer(from(body,old,['count_41','count41','num_trac_nghiem'],0),'Số câu Trắc nghiệm',0,10000);
  const count_tf4=integer(from(body,old,['count_tf4','countTF4','num_dung_sai'],0),'Số câu Đúng/Sai',0,10000);
  const count_sq=integer(from(body,old,['count_sq','countSQ','num_tra_loi_ngan'],0),'Số câu Trả lời ngắn',0,10000);
  const count_tl=integer(from(body,old,['count_tl','countTL','num_tuluan'],0),'Số câu Tự luận',0,10000);
  const total = count_41+count_tf4+count_sq+count_tl;
  if (total < 1 || total > 10000) throw new ExamConfigInputError('Đề thi phải có từ 1 đến 10000 câu hỏi.');
  const show_score=examConfigFlag(value('show_score','showScore',1),'Xem điểm');
  const show_details=examConfigFlag(value('show_details','showDetails',0),'Xem chi tiết');
  const immediate_feedback=examConfigFlag(value('immediate_feedback','immediateFeedback',0),'Phản hồi tức thời');
  const auto_grade_essay=examConfigFlag(value('auto_grade_essay','autoGradeEssay',0),'Chấm tự luận');
  const mabaomatdethi=mode === 'Đề có mã bảo mật'
      ? string(value('mabaomatdethi',null,''),'Mã bảo mật',200) : '';
  if (mode === 'Đề có mã bảo mật' && !mabaomatdethi) throw new ExamConfigInputError('Đề có mã bảo mật phải được đặt mật khẩu.');
  const ai_grading_key=string(value('ai_grading_key','aiGradingKey',''),'Khóa chấm AI',5000);
  if (auto_grade_essay && !ai_grading_key) throw new ExamConfigInputError('Bật chấm tự luận phải có khóa chấm AI.');
  const publicMode=mode==='Đề công khai';
  const target_lop=publicMode?'':string(from(body,old,['target_lop','targetLop','lop'],''),'Lớp áp dụng',1500);
  const target_donvi=publicMode?'':string(from(body,old,['target_donvi','targetDonvi','donvi'],''),'Đơn vị áp dụng',500);
  const tg_bd=string(value('tg_bd','tgBd',''),'Thời gian bắt đầu',50) || null;
  const tg_kt=string(value('tg_kt','tgKt',''),'Thời gian kết thúc',50) || null;
  const access = acl(value('access_control','accessControl',{}));
  const scheduled=JSON.parse(access) as Row;
  const start=tg_bd ?? scheduled.startTime ?? null;
  const end=tg_kt ?? scheduled.endTime ?? null;
  if (start && end && start >= end) throw new ExamConfigInputError('Thời gian kết thúc phải sau thời gian bắt đầu.');
  return {
    name, chedodethi:mode, mabaomatdethi, time_limit,
    count_41,count_tf4,count_sq,count_tl,
    points_41:decimal(value('points_41','points41',1),'Điểm Trắc nghiệm'),
    points_tf4:decimal(value('points_tf4','pointsTF4',1),'Điểm Đúng/Sai'),
    points_sq:decimal(value('points_sq','pointsSQ',1),'Điểm Trả lời ngắn'),
    points_tl:decimal(value('points_tl','pointsTL',1),'Điểm Tự luận'),
    selected_lessons:lessons(value('selected_lessons','selectedLessons',[])),
    counts_detail:counts(value('counts_detail','countsDetail',{}),{count_41,count_tf4,count_sq,count_tl}),
    tf4_scoring_mode:examConfigFlag(value('tf4_scoring_mode','tf4ScoringMode',0),'Chấm Đúng/Sai'),
    tf4_points:tf4Points(value('tf4_points','tf4Points',{})),
    access_control:access,
    immediate_feedback,show_score,show_details,
    sq_case_sensitive:examConfigFlag(value('sq_case_sensitive','sqCaseSensitive',0),'Phân biệt hoa thường'),
    sq_punctuation_sensitive:examConfigFlag(value('sq_punctuation_sensitive','sqPunctuationSensitive',0),'Phân biệt dấu câu'),
    auto_grade_essay,
    is_shared_results:examConfigFlag(value('is_shared_results','isSharedResults',0),'Chia sẻ kết quả'),
    max_cheat_warnings:integer(value('max_cheat_warnings','maxCheatWarnings',5),'Số lần cảnh báo',1,100),
    max_attempts:integer(value('max_attempts','maxAttempts',0),'Số lần làm bài',0,100),
    target_lop,lop:target_lop,target_donvi,donvi:target_donvi,
    tg_bd: start || null,tg_kt:end || null,
    ai_prompt:string(value('ai_prompt','aiPrompt',''),'Hướng dẫn chấm AI',20000),
    ai_grading_key,
    tieu_de_bai_thi:string(value('tieu_de_bai_thi','tieuDeBaiThi',''),'Tiêu đề hiển thị',500),
    keep_raw_score:examConfigFlag(value('keep_raw_score','keepRawScore',0),'Giữ điểm gốc')
  };
}
