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
  const audience = String(user.target_audience || '').trim().toLowerCase();
  if (role === 'admin' || audience === 'admin' || audience === 'quản trị viên') return true;
  return !!row.creator_id && String(row.creator_id) === String(user.id);
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
/** Only the fields actually needed by /api/exam/grade are present in the signed session. */
const gradeFields = [
  'id','name','creator_id','points41','points_41','pointsTF4','points_tf4',
  'pointsSQ','points_sq','pointsTL','points_tl','tf4Points','tf4_points',
  'tf4ScoringMode','tf4_scoring_mode','sqCaseSensitive','sq_case_sensitive',
  'sqPunctuationSensitive','sq_punctuation_sensitive','autoGradeEssay',
  'auto_grade_essay','keepRawScore','keep_raw_score','scoringScale',
  'showDetails','show_details'
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
