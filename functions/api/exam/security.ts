import { canManageExamConfig } from '../../../src/exam-config-deletion-policy';

/**
 * Explicit response allowlists for exam data sent to untrusted clients.
 * A signed JWT is readable by its holder; never put passwords, AI keys or prompts in it.
 */
const publicFields = [
  'id','name','creator_id','creatorId','creator_name','creatorName','teacher_donvi',
  'chedodethi','target_lop','targetLop','lop','target_donvi','donvi',
  'time_limit','time','timeLimit','tg_bd','tg_kt',
  'count_41','count_tf4','count_sq','count_tl',
  'count41','countTF4','countSQ','countTL',
  'count41NB','count41TH','count41VD','countTF4NB','countTF4TH','countTF4VD',
  'countSQNB','countSQTH','countSQVD','countTLNB','countTLTH','countTLVD',
  'counts_detail','selected_lessons','selectedLessons',
  'points_41','points_tf4','points_sq','points_tl',
  'points41','pointsTF4','pointsSQ','pointsTL',
  'tf4_scoring_mode','tf4_points','tf4ScoringMode','tf4Points',
  'immediate_feedback','immediateFeedback','show_score','show_details',
  'is_shared_results','isSharedResults','max_cheat_warnings','max_attempts',
  'num_trac_nghiem','num_dung_sai','num_tra_loi_ngan','num_tuluan',
  'created_at','updated_at'
];
export function isExamOwner(user: any, row: any): boolean {
  if (!user || !row) return false;
  const role = String(user.role || '').trim().toLowerCase();
  // Admin privilege comes only from the verified account role, not a profile label.
  return canManageExamConfig(user,row.creator_id,role === 'admin');
}
export function redactExamForPublic(row: any): any {
  const safe: any = {};
  for (const field of publicFields) {
    if (Object.prototype.hasOwnProperty.call(row, field)) safe[field] = row[field];
  }
  // Retain time-window information but not arbitrary private ACL metadata.
  if (row.access_control && typeof row.access_control === 'object') {
    const acl = row.access_control;
    safe.access_control = {
      enabled: acl.enabled === true || acl.enabled === 1 || acl.enabled === 'true',
      startTime: acl.startTime || '',
      endTime: acl.endTime || ''
    };
  }
  return safe;
}
/** Fields needed by server grading snapshot. Private fields are stripped before the readable JWT is returned. */
const gradeFields = [
  'id','name','creator_id','points41','points_41','pointsTF4','points_tf4',
  'pointsSQ','points_sq','pointsTL','points_tl','tf4Points','tf4_points',
  'tf4ScoringMode','tf4_scoring_mode','sqCaseSensitive','sq_case_sensitive',
  'sqPunctuationSensitive','sq_punctuation_sensitive','autoGradeEssay',
  'auto_grade_essay','aiPrompt','ai_prompt','keepRawScore','keep_raw_score','scoringScale',
  'showDetails','show_details','showScore','show_score'
];
export function makeGradeSessionConfig(row: any): any {
  const safe: any = {};
  for (const field of gradeFields) {
    if (Object.prototype.hasOwnProperty.call(row, field)) safe[field] = row[field];
  }
  return safe;
}
/** Compare access codes without early exit; server-side validation is authoritative. */
export function accessCodeMatches(given: unknown, stored: unknown): boolean {
  if (typeof given !== 'string' || typeof stored !== 'string' || !stored) return false;
  const enc = new TextEncoder();
  const a = enc.encode(given), b = enc.encode(stored);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] || 0) ^ (b[i] || 0);
  }
  return diff === 0;
}

/** Protected exams reveal only their selector entry until the server verifies a code. */
export function isProtectedExamForUser(user: any, row: any): boolean {
  return row?.chedodethi === 'Đề có mã bảo mật' && !isExamOwner(user,row);
}
export function protectedExamPreview(row: any): any {
  // Name and creator are necessary for the student to find the exam in the selector.
  // Never send counts, timing, lesson IDs, answers, access configuration or password.
  return {
    id: row.id,
    name: row.name,
    creator_id: row.creator_id,
    chedodethi: row.chedodethi,
    creator_name: row.creator_name || '',
    teacher_donvi: row.teacher_donvi || '',
    is_shared_results: row.is_shared_results === true ||
      row.is_shared_results === 1 || row.is_shared_results === 'true'
  };
}
export function examAccessChallenge(user: any, row: any, supplied: unknown):
    {status: number; code: string; error: string} | null {
  if (!isProtectedExamForUser(user, row)) return null;
  if (typeof supplied !== 'string' || !supplied.trim()) {
    return {status: 403, code:'EXAM_ACCESS_CODE_REQUIRED',
      error:'Vui lòng nhập mật mã truy cập đề thi để tiếp tục.'};
  }
  if (!accessCodeMatches(supplied, row.mabaomatdethi)) {
    return {status: 403, code:'EXAM_ACCESS_CODE_INVALID',
      error:'Mật mã truy cập đề thi không đúng. Vui lòng kiểm tra và nhập lại.'};
  }
  return null;
}
