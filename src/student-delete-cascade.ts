/**
 * Student-specific atomic hard-delete.
 *
 * IMPORTANT:
 * - Only data a student legitimately owns/participates in is deleted.
 * - Teacher-owned resources are NEVER deleted by this function.
 * - If a profile marked as student still owns teacher resources, deletion fails
 *   closed with STUDENT_DELETE_ROLE_DATA_CONFLICT before any destructive work.
 * - All destructive work runs inside one PostgreSQL statement transaction.
 */
export const STUDENT_DELETE_CASCADE_SQL = String.raw`
CREATE TABLE IF NOT EXISTS public._submitted_exam_tokens (
  token_hash TEXT PRIMARY KEY,
  exam_id TEXT,
  student_name TEXT,
  user_id TEXT,
  submitted_at TEXT
);
ALTER TABLE public._submitted_exam_tokens ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_submitted_tokens_user_id
  ON public._submitted_exam_tokens(user_id);

CREATE OR REPLACE FUNCTION public.delete_student_cascade(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $student_delete$
DECLARE
  v_profile RECORD;
  v_identity_ids TEXT[];
  v_result_ids TEXT[] := ARRAY[]::TEXT[];
  v_token_hashes TEXT[] := ARRAY[]::TEXT[];
  v_count BIGINT := 0;
  v_counts JSONB := '{}'::JSONB;
  v_account_count BIGINT := 0;
  v_user_count BIGINT := 0;
  v_has_conflict BOOLEAN := FALSE;
  v_has_orphans BOOLEAN := FALSE;
BEGIN
  IF p_user_id IS NULL OR BTRIM(p_user_id) = '' THEN
    RAISE EXCEPTION 'STUDENT_DELETE_ID_REQUIRED';
  END IF;

  SELECT id, full_name, target_audience
    INTO v_profile
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STUDENT_DELETE_NOT_FOUND';
  END IF;

  IF LOWER(BTRIM(COALESCE(v_profile.target_audience,''))) NOT IN ('học sinh','student') THEN
    RAISE EXCEPTION 'STUDENT_DELETE_WRONG_PROFILE_TYPE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounts
    WHERE (user_id = p_user_id OR id = p_user_id)
      AND (
        LOWER(COALESCE(role,'')) = 'admin'
        OR LOWER(COALESCE(username,'')) IN ('admin','adminhht')
        OR LOWER(COALESCE(id,'')) IN ('admin','adminhht')
      )
  ) THEN
    RAISE EXCEPTION 'STUDENT_DELETE_PROTECTED_ADMIN';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT ident
    FROM (
      SELECT p_user_id AS ident
      UNION ALL
      SELECT id FROM public.accounts WHERE user_id = p_user_id OR id = p_user_id
    ) x
    WHERE ident IS NOT NULL AND BTRIM(ident) <> ''
  )
  INTO v_identity_ids;

  -- Student-owned/participation tables.
  LOCK TABLE public.users, public.accounts, public.results,
             public._submitted_exam_tokens
    IN SHARE ROW EXCLUSIVE MODE;

  IF to_regclass('public.qr_answer_cards') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.qr_answer_cards IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.qr_answer_responses') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.qr_answer_responses IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.qr_answer_result_links') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.qr_answer_result_links IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.interactive_board_blocks') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.interactive_board_blocks IN SHARE ROW EXCLUSIVE MODE';
  END IF;

  -- Teacher/creator tables are locked only to guarantee a stable preflight audit.
  -- They are intentionally NOT deleted by the student workflow.
  LOCK TABLE public.questions, public.exam_configs, public.teacher_classes
    IN SHARE ROW EXCLUSIVE MODE;
  IF to_regclass('public.quan_ly_tai_lieu') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.quan_ly_tai_lieu IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.interactive_boards') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.interactive_boards IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.qr_answer_sessions') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.qr_answer_sessions IN SHARE ROW EXCLUSIVE MODE';
  END IF;

  ---------------------------------------------------------------------------
  -- PRE-FLIGHT ROLE AUDIT:
  -- A student deletion must never erase teacher-owned resources.
  ---------------------------------------------------------------------------
  SELECT
    EXISTS (SELECT 1 FROM public.questions WHERE creator_id = ANY(v_identity_ids))
    OR EXISTS (SELECT 1 FROM public.exam_configs WHERE creator_id = ANY(v_identity_ids))
    OR EXISTS (SELECT 1 FROM public.teacher_classes WHERE teacher_id = ANY(v_identity_ids))
  INTO v_has_conflict;

  IF NOT v_has_conflict AND to_regclass('public.quan_ly_tai_lieu') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.quan_ly_tai_lieu
         WHERE id_nguoi_tao = ANY($1) OR id_nguoi_cap_nhat = ANY($1)
       )'
      INTO v_has_conflict
      USING v_identity_ids;
  END IF;

  IF NOT v_has_conflict AND to_regclass('public.interactive_boards') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.interactive_boards WHERE creator_id = ANY($1)
       )'
      INTO v_has_conflict
      USING v_identity_ids;
  END IF;

  IF NOT v_has_conflict AND to_regclass('public.qr_answer_sessions') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.qr_answer_sessions WHERE creator_id = ANY($1)
       )'
      INTO v_has_conflict
      USING v_identity_ids;
  END IF;

  IF NOT v_has_conflict AND to_regclass('public.qr_answer_cards') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.qr_answer_cards WHERE created_by = ANY($1)
       )'
      INTO v_has_conflict
      USING v_identity_ids;
  END IF;

  IF NOT v_has_conflict AND to_regclass('public.interactive_board_blocks') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.interactive_board_blocks WHERE blocked_by = ANY($1)
       )'
      INTO v_has_conflict
      USING v_identity_ids;
  END IF;

  IF v_has_conflict THEN
    RAISE EXCEPTION 'STUDENT_DELETE_ROLE_DATA_CONFLICT';
  END IF;

  ---------------------------------------------------------------------------
  -- Discover exact student result rows.
  -- QR result links are included as an exact secondary identity path.
  ---------------------------------------------------------------------------
  SELECT COALESCE(ARRAY_AGG(DISTINCT id), ARRAY[]::TEXT[])
    INTO v_result_ids
  FROM public.results
  WHERE user_id = ANY(v_identity_ids);

  IF to_regclass('public.qr_answer_result_links') IS NOT NULL THEN
    EXECUTE
      'SELECT COALESCE(ARRAY_AGG(DISTINCT rid), ARRAY[]::TEXT[])
       FROM (
         SELECT UNNEST($1::TEXT[]) AS rid
         UNION
         SELECT result_id FROM public.qr_answer_result_links
         WHERE user_id = ANY($2)
       ) q'
      INTO v_result_ids
      USING v_result_ids, v_identity_ids;
  END IF;

  ---------------------------------------------------------------------------
  -- Resolve anti-replay tokens exactly.
  -- New rows use user_id. Legacy rows without user_id are included only when
  -- exam/name uniquely maps to this student's exact result set.
  ---------------------------------------------------------------------------
  SELECT COALESCE(ARRAY_AGG(DISTINCT t.token_hash), ARRAY[]::TEXT[])
    INTO v_token_hashes
  FROM public._submitted_exam_tokens t
  WHERE t.user_id = ANY(v_identity_ids)
     OR (
       NULLIF(BTRIM(COALESCE(t.user_id,'')), '') IS NULL
       AND EXISTS (
         SELECT 1
         FROM public.results r
         WHERE r.id = ANY(v_result_ids)
           AND r.exam_id IS NOT DISTINCT FROM t.exam_id
           AND LOWER(BTRIM(COALESCE(r.student_name,''))) =
               LOWER(BTRIM(COALESCE(t.student_name,'')))
       )
       AND NOT EXISTS (
         SELECT 1
         FROM public.results other_r
         WHERE NOT (other_r.id = ANY(v_result_ids))
           AND other_r.exam_id IS NOT DISTINCT FROM t.exam_id
           AND LOWER(BTRIM(COALESCE(other_r.student_name,''))) =
               LOWER(BTRIM(COALESCE(t.student_name,'')))
       )
     );

  ---------------------------------------------------------------------------
  -- STEP 1: Results / attempts.
  ---------------------------------------------------------------------------
  IF to_regclass('public.qr_answer_result_links') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.qr_answer_result_links
       WHERE user_id = ANY($1) OR result_id = ANY($2)'
      USING v_identity_ids, v_result_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('qr_result_links', v_count);
  END IF;

  DELETE FROM public.results
  WHERE id = ANY(v_result_ids) OR user_id = ANY(v_identity_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('results', v_count);

  ---------------------------------------------------------------------------
  -- STEP 2: Submission/replay records.
  ---------------------------------------------------------------------------
  DELETE FROM public._submitted_exam_tokens
  WHERE user_id = ANY(v_identity_ids) OR token_hash = ANY(v_token_hashes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('submitted_tokens', v_count);

  ---------------------------------------------------------------------------
  -- STEP 3: Student participation data.
  ---------------------------------------------------------------------------
  IF to_regclass('public.qr_answer_responses') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.qr_answer_responses WHERE user_id = ANY($1)'
      USING v_identity_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('qr_responses', v_count);
  END IF;

  IF to_regclass('public.qr_answer_cards') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.qr_answer_cards WHERE user_id = ANY($1)'
      USING v_identity_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('qr_cards', v_count);
  END IF;

  IF to_regclass('public.interactive_board_blocks') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.interactive_board_blocks WHERE user_id = ANY($1)'
      USING v_identity_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('board_blocks', v_count);
  END IF;

  ---------------------------------------------------------------------------
  -- STEP 4: Login account(s).
  ---------------------------------------------------------------------------
  DELETE FROM public.accounts
  WHERE id = ANY(v_identity_ids) OR user_id = p_user_id;
  GET DIAGNOSTICS v_account_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('accounts', v_account_count);

  ---------------------------------------------------------------------------
  -- STEP 5: Student profile LAST.
  ---------------------------------------------------------------------------
  DELETE FROM public.users WHERE id = p_user_id;
  GET DIAGNOSTICS v_user_count = ROW_COUNT;
  IF v_user_count <> 1 THEN
    RAISE EXCEPTION 'STUDENT_DELETE_PROFILE_CONFLICT';
  END IF;
  v_counts := v_counts || jsonb_build_object('users', v_user_count);

  ---------------------------------------------------------------------------
  -- Final student-only orphan audit.
  ---------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM public.accounts WHERE user_id = p_user_id OR id = ANY(v_identity_ids))
     OR EXISTS (SELECT 1 FROM public.results WHERE user_id = ANY(v_identity_ids) OR id = ANY(v_result_ids))
     OR EXISTS (
       SELECT 1 FROM public._submitted_exam_tokens
       WHERE user_id = ANY(v_identity_ids) OR token_hash = ANY(v_token_hashes)
     )
  THEN
    RAISE EXCEPTION 'STUDENT_DELETE_ORPHAN_AUDIT_FAILED';
  END IF;

  IF to_regclass('public.qr_answer_cards') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (SELECT 1 FROM public.qr_answer_cards WHERE user_id = ANY($1))'
      INTO v_has_orphans USING v_identity_ids;
    IF v_has_orphans THEN RAISE EXCEPTION 'STUDENT_DELETE_QR_CARD_AUDIT_FAILED'; END IF;
  END IF;

  IF to_regclass('public.qr_answer_responses') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (SELECT 1 FROM public.qr_answer_responses WHERE user_id = ANY($1))'
      INTO v_has_orphans USING v_identity_ids;
    IF v_has_orphans THEN RAISE EXCEPTION 'STUDENT_DELETE_QR_RESPONSE_AUDIT_FAILED'; END IF;
  END IF;

  IF to_regclass('public.qr_answer_result_links') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.qr_answer_result_links
         WHERE user_id = ANY($1) OR result_id = ANY($2)
       )'
      INTO v_has_orphans USING v_identity_ids, v_result_ids;
    IF v_has_orphans THEN RAISE EXCEPTION 'STUDENT_DELETE_QR_RESULT_LINK_AUDIT_FAILED'; END IF;
  END IF;

  IF to_regclass('public.interactive_board_blocks') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.interactive_board_blocks WHERE user_id = ANY($1)
       )'
      INTO v_has_orphans USING v_identity_ids;
    IF v_has_orphans THEN RAISE EXCEPTION 'STUDENT_DELETE_BOARD_BLOCK_AUDIT_FAILED'; END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'user_id', p_user_id,
    'student_name', COALESCE(v_profile.full_name, ''),
    'identity_ids', v_identity_ids,
    'result_ids', v_result_ids,
    'counts', v_counts,
    'steps', jsonb_build_array(
      jsonb_build_object(
        'key','results',
        'label','Kết quả và các lần làm bài',
        'count',
          COALESCE((v_counts->>'results')::BIGINT,0)
        + COALESCE((v_counts->>'qr_result_links')::BIGINT,0)
      ),
      jsonb_build_object(
        'key','submissions',
        'label','Dữ liệu phiên/nộp bài chống nộp trùng',
        'count',COALESCE((v_counts->>'submitted_tokens')::BIGINT,0)
      ),
      jsonb_build_object(
        'key','participation',
        'label','Dữ liệu tham gia quét thẻ và bảng tương tác',
        'count',
          COALESCE((v_counts->>'qr_responses')::BIGINT,0)
        + COALESCE((v_counts->>'qr_cards')::BIGINT,0)
        + COALESCE((v_counts->>'board_blocks')::BIGINT,0)
      ),
      jsonb_build_object('key','accounts','label','Tài khoản đăng nhập','count',v_account_count),
      jsonb_build_object('key','user','label','Hồ sơ học sinh','count',v_user_count)
    )
  );
END;
$student_delete$;
`;

export const STUDENT_DELETE_CALL_SQL =
  'SELECT public.delete_student_cascade(?) AS deletion';

export function parseStudentDeletionResult(row: any) {
  const raw = row?.deletion;
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

export function studentDeleteHttpError(error: unknown) {
  const message = String((error as any)?.message || error || '');
  if (message.includes('STUDENT_DELETE_ID_REQUIRED')) {
    return { status: 400, error: 'Thiếu mã học sinh cần xóa.', code: 'STUDENT_DELETE_ID_REQUIRED' };
  }
  if (message.includes('STUDENT_DELETE_NOT_FOUND')) {
    return { status: 404, error: 'Không tìm thấy hồ sơ học sinh hoặc hồ sơ đã được xóa.', code: 'STUDENT_DELETE_NOT_FOUND' };
  }
  if (message.includes('STUDENT_DELETE_WRONG_PROFILE_TYPE')) {
    return { status: 409, error: 'Hồ sơ này không phải hồ sơ Học sinh. Hệ thống đã dừng để tránh xóa sai loại dữ liệu.', code: 'STUDENT_DELETE_WRONG_PROFILE_TYPE' };
  }
  if (message.includes('STUDENT_DELETE_ROLE_DATA_CONFLICT')) {
    return {
      status: 409,
      error: 'Hồ sơ đang là Học sinh nhưng còn dữ liệu thuộc vai trò Giáo viên/người tạo. Hệ thống không xóa nhầm các dữ liệu đó. Hãy kiểm tra lại loại hồ sơ trước khi xóa.',
      code: 'STUDENT_DELETE_ROLE_DATA_CONFLICT'
    };
  }
  if (message.includes('STUDENT_DELETE_PROTECTED_ADMIN')) {
    return { status: 400, error: 'BẢO MẬT HỆ THỐNG: Không được xóa tài khoản Quản trị viên.', code: 'STUDENT_DELETE_PROTECTED_ADMIN' };
  }
  if (message.includes('STUDENT_DELETE_')) {
    return {
      status: 409,
      error: 'Không thể hoàn tất việc xóa học sinh. Toàn bộ thay đổi đã rollback, không có dữ liệu nào bị xóa một phần.',
      code: 'STUDENT_DELETE_ROLLED_BACK'
    };
  }
  return {
    status: 500,
    error: 'Xóa hồ sơ học sinh thất bại. Cơ sở dữ liệu đã hoàn tác toàn bộ giao dịch.',
    code: 'STUDENT_DELETE_FAILED'
  };
}
