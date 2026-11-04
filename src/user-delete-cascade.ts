/**
 * Atomic hard-delete for any non-admin user profile.
 *
 * The function is intentionally fail-closed:
 * - all exact relationships are keyed by users.id or linked accounts.id;
 * - no destructive decision is made from a display name;
 * - any exception aborts the single PostgreSQL statement and rolls back all deletes.
 *
 * This supersedes the old non-teacher path (accounts -> users only) and is used
 * for students as well as legacy profiles whose role may have changed over time.
 */
export const USER_DELETE_CASCADE_SQL = String.raw`
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

CREATE OR REPLACE FUNCTION public.delete_user_cascade(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $user_delete$
DECLARE
  v_profile RECORD;
  v_identity_ids TEXT[];
  v_exam_ids TEXT[] := ARRAY[]::TEXT[];
  v_result_ids TEXT[] := ARRAY[]::TEXT[];
  v_token_hashes TEXT[] := ARRAY[]::TEXT[];
  v_qr_session_ids TEXT[] := ARRAY[]::TEXT[];
  v_board_ids TEXT[] := ARRAY[]::TEXT[];
  v_count BIGINT := 0;
  v_counts JSONB := '{}'::JSONB;
  v_account_count BIGINT := 0;
  v_user_count BIGINT := 0;
  v_has_orphans BOOLEAN := FALSE;
BEGIN
  IF p_user_id IS NULL OR BTRIM(p_user_id) = '' THEN
    RAISE EXCEPTION 'USER_DELETE_ID_REQUIRED';
  END IF;

  SELECT id, full_name, target_audience
    INTO v_profile
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_DELETE_NOT_FOUND';
  END IF;

  -- Admin is protected at the database layer, not only in UI/API.
  IF LOWER(COALESCE(v_profile.target_audience, '')) IN ('quản trị viên','admin')
     OR EXISTS (
       SELECT 1
       FROM public.accounts
       WHERE (user_id = p_user_id OR id = p_user_id)
         AND (
           LOWER(COALESCE(role,'')) = 'admin'
           OR LOWER(COALESCE(username,'')) IN ('admin','adminhht')
           OR LOWER(COALESCE(id,'')) IN ('admin','adminhht')
         )
     )
  THEN
    RAISE EXCEPTION 'USER_DELETE_PROTECTED_ADMIN';
  END IF;

  -- Historical rows may store either profile id or account id.
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

  -- Serialize ownership writes while the principal is being destroyed.
  LOCK TABLE public.users, public.accounts, public.results, public.questions,
             public.exam_configs, public.teacher_classes,
             public._submitted_exam_tokens
    IN SHARE ROW EXCLUSIVE MODE;

  IF to_regclass('public.quan_ly_tai_lieu') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.quan_ly_tai_lieu IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.interactive_boards') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.interactive_boards IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.interactive_board_pages') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.interactive_board_pages IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.interactive_board_blocks') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.interactive_board_blocks IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.qr_answer_cards') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.qr_answer_cards IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.qr_answer_sessions') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.qr_answer_sessions IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.qr_answer_responses') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.qr_answer_responses IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.qr_answer_result_links') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.qr_answer_result_links IN SHARE ROW EXCLUSIVE MODE';
  END IF;

  -- If a profile used to be a teacher, these legacy owned resources must still
  -- be cleaned so changing role cannot create orphaned creator_id references.
  SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::TEXT[])
    INTO v_exam_ids
  FROM public.exam_configs
  WHERE creator_id = ANY(v_identity_ids);

  SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::TEXT[])
    INTO v_result_ids
  FROM public.results
  WHERE user_id = ANY(v_identity_ids)
     OR exam_id = ANY(v_exam_ids);

  -- Token ownership is exact when user_id is present. For legacy tokens with no
  -- user_id we only take rows that can be joined to an already exact result,
  -- and only when no other user shares that exam/name pair. Never delete by
  -- display name alone.
  SELECT COALESCE(ARRAY_AGG(t.token_hash), ARRAY[]::TEXT[])
    INTO v_token_hashes
  FROM public._submitted_exam_tokens t
  WHERE t.user_id = ANY(v_identity_ids)
     OR t.exam_id = ANY(v_exam_ids)
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

  IF to_regclass('public.qr_answer_sessions') IS NOT NULL THEN
    EXECUTE
      'SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::TEXT[])
         FROM public.qr_answer_sessions
        WHERE creator_id = ANY($1) OR exam_id = ANY($2)'
      INTO v_qr_session_ids
      USING v_identity_ids, v_exam_ids;
  END IF;

  IF to_regclass('public.interactive_boards') IS NOT NULL THEN
    EXECUTE
      'SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::TEXT[])
         FROM public.interactive_boards
        WHERE creator_id = ANY($1)'
      INTO v_board_ids
      USING v_identity_ids;
  END IF;

  ---------------------------------------------------------------------------
  -- STEP 1: exam results and anti-replay submission records.
  ---------------------------------------------------------------------------
  IF to_regclass('public.qr_answer_result_links') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.qr_answer_result_links
        WHERE session_id = ANY($1)
           OR user_id = ANY($2)
           OR result_id = ANY($3)'
      USING v_qr_session_ids, v_identity_ids, v_result_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('qr_result_links', v_count);
  END IF;

  DELETE FROM public.results WHERE id = ANY(v_result_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('results', v_count);

  DELETE FROM public._submitted_exam_tokens
   WHERE token_hash = ANY(v_token_hashes)
      OR user_id = ANY(v_identity_ids)
      OR exam_id = ANY(v_exam_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('submitted_tokens', v_count);

  ---------------------------------------------------------------------------
  -- STEP 2: participation data (QR and smart-board references).
  ---------------------------------------------------------------------------
  IF to_regclass('public.qr_answer_responses') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.qr_answer_responses
        WHERE session_id = ANY($1) OR user_id = ANY($2)'
      USING v_qr_session_ids, v_identity_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('qr_responses', v_count);
  END IF;

  IF to_regclass('public.qr_answer_cards') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.qr_answer_cards
        WHERE user_id = ANY($1) OR created_by = ANY($1)'
      USING v_identity_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('qr_cards', v_count);
  END IF;

  IF to_regclass('public.interactive_board_blocks') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.interactive_board_blocks
        WHERE board_id = ANY($1)
           OR user_id = ANY($2)
           OR blocked_by = ANY($2)'
      USING v_board_ids, v_identity_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('board_blocks', v_count);
  END IF;

  ---------------------------------------------------------------------------
  -- STEP 3: owned resources, including legacy resources from a previous role.
  ---------------------------------------------------------------------------
  IF to_regclass('public.qr_answer_sessions') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.qr_answer_sessions WHERE id = ANY($1)'
      USING v_qr_session_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('qr_sessions', v_count);
  END IF;

  IF to_regclass('public.interactive_board_pages') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.interactive_board_pages WHERE board_id = ANY($1)'
      USING v_board_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('board_pages', v_count);
  END IF;

  IF to_regclass('public.interactive_boards') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.interactive_boards WHERE id = ANY($1)'
      USING v_board_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('boards', v_count);
  END IF;

  IF to_regclass('public.quan_ly_tai_lieu') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.quan_ly_tai_lieu WHERE id_nguoi_tao = ANY($1)'
      USING v_identity_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('documents', v_count);

    EXECUTE
      'UPDATE public.quan_ly_tai_lieu
          SET id_nguoi_cap_nhat = NULL
        WHERE id_nguoi_cap_nhat = ANY($1)'
      USING v_identity_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('documents_updater_unlinked', v_count);
  END IF;

  DELETE FROM public.questions WHERE creator_id = ANY(v_identity_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('questions', v_count);

  DELETE FROM public.exam_configs WHERE id = ANY(v_exam_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('exams', v_count);

  DELETE FROM public.teacher_classes WHERE teacher_id = ANY(v_identity_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('teacher_classes', v_count);

  ---------------------------------------------------------------------------
  -- STEP 4/5: login principal, then profile last.
  ---------------------------------------------------------------------------
  DELETE FROM public.accounts
   WHERE id = ANY(v_identity_ids) OR user_id = p_user_id;
  GET DIAGNOSTICS v_account_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('accounts', v_account_count);

  DELETE FROM public.users WHERE id = p_user_id;
  GET DIAGNOSTICS v_user_count = ROW_COUNT;
  IF v_user_count <> 1 THEN
    RAISE EXCEPTION 'USER_DELETE_PROFILE_CONFLICT';
  END IF;
  v_counts := v_counts || jsonb_build_object('users', v_user_count);

  ---------------------------------------------------------------------------
  -- Final invariant audit. Any exact reference left behind aborts + rolls back.
  ---------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM public.accounts WHERE user_id = p_user_id OR id = ANY(v_identity_ids))
     OR EXISTS (SELECT 1 FROM public.questions WHERE creator_id = ANY(v_identity_ids))
     OR EXISTS (SELECT 1 FROM public.exam_configs WHERE creator_id = ANY(v_identity_ids))
     OR EXISTS (SELECT 1 FROM public.results WHERE id = ANY(v_result_ids) OR user_id = ANY(v_identity_ids))
     OR EXISTS (SELECT 1 FROM public.teacher_classes WHERE teacher_id = ANY(v_identity_ids))
     OR EXISTS (
       SELECT 1 FROM public._submitted_exam_tokens
        WHERE user_id = ANY(v_identity_ids)
           OR exam_id = ANY(v_exam_ids)
           OR token_hash = ANY(v_token_hashes)
     )
  THEN
    RAISE EXCEPTION 'USER_DELETE_ORPHAN_AUDIT_FAILED';
  END IF;

  IF to_regclass('public.quan_ly_tai_lieu') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.quan_ly_tai_lieu
          WHERE id_nguoi_tao = ANY($1) OR id_nguoi_cap_nhat = ANY($1)
       )'
      INTO v_has_orphans USING v_identity_ids;
    IF v_has_orphans THEN RAISE EXCEPTION 'USER_DELETE_DOCUMENT_AUDIT_FAILED'; END IF;
  END IF;

  IF to_regclass('public.interactive_boards') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.interactive_boards WHERE creator_id = ANY($1)
       )'
      INTO v_has_orphans USING v_identity_ids;
    IF v_has_orphans THEN RAISE EXCEPTION 'USER_DELETE_BOARD_AUDIT_FAILED'; END IF;
  END IF;

  IF to_regclass('public.interactive_board_blocks') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.interactive_board_blocks
          WHERE board_id = ANY($1)
             OR user_id = ANY($2)
             OR blocked_by = ANY($2)
       )'
      INTO v_has_orphans USING v_board_ids, v_identity_ids;
    IF v_has_orphans THEN RAISE EXCEPTION 'USER_DELETE_BOARD_BLOCK_AUDIT_FAILED'; END IF;
  END IF;

  IF to_regclass('public.interactive_board_pages') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.interactive_board_pages WHERE board_id = ANY($1)
       )'
      INTO v_has_orphans USING v_board_ids;
    IF v_has_orphans THEN RAISE EXCEPTION 'USER_DELETE_BOARD_PAGE_AUDIT_FAILED'; END IF;
  END IF;

  IF to_regclass('public.qr_answer_sessions') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.qr_answer_sessions
          WHERE creator_id = ANY($1) OR exam_id = ANY($2)
       )'
      INTO v_has_orphans USING v_identity_ids, v_exam_ids;
    IF v_has_orphans THEN RAISE EXCEPTION 'USER_DELETE_QR_SESSION_AUDIT_FAILED'; END IF;
  END IF;

  IF to_regclass('public.qr_answer_cards') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.qr_answer_cards
          WHERE user_id = ANY($1) OR created_by = ANY($1)
       )'
      INTO v_has_orphans USING v_identity_ids;
    IF v_has_orphans THEN RAISE EXCEPTION 'USER_DELETE_QR_CARD_AUDIT_FAILED'; END IF;
  END IF;

  IF to_regclass('public.qr_answer_responses') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.qr_answer_responses
          WHERE session_id = ANY($1) OR user_id = ANY($2)
       )'
      INTO v_has_orphans USING v_qr_session_ids, v_identity_ids;
    IF v_has_orphans THEN RAISE EXCEPTION 'USER_DELETE_QR_RESPONSE_AUDIT_FAILED'; END IF;
  END IF;

  IF to_regclass('public.qr_answer_result_links') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.qr_answer_result_links
          WHERE session_id = ANY($1)
             OR user_id = ANY($2)
             OR result_id = ANY($3)
       )'
      INTO v_has_orphans USING v_qr_session_ids, v_identity_ids, v_result_ids;
    IF v_has_orphans THEN RAISE EXCEPTION 'USER_DELETE_QR_RESULT_LINK_AUDIT_FAILED'; END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'user_id', p_user_id,
    'full_name', COALESCE(v_profile.full_name, ''),
    'target_audience', COALESCE(v_profile.target_audience, ''),
    'identity_ids', v_identity_ids,
    'exam_ids', v_exam_ids,
    'counts', v_counts,
    'steps', jsonb_build_array(
      jsonb_build_object(
        'key','results',
        'label','Kết quả bài làm và dữ liệu nộp bài',
        'count',
          COALESCE((v_counts->>'results')::BIGINT,0)
        + COALESCE((v_counts->>'submitted_tokens')::BIGINT,0)
      ),
      jsonb_build_object(
        'key','questions',
        'label','Câu hỏi/dữ liệu nội dung do người dùng tạo',
        'count',COALESCE((v_counts->>'questions')::BIGINT,0)
      ),
      jsonb_build_object(
        'key','exams',
        'label','Đề kiểm tra do người dùng tạo',
        'count',COALESCE((v_counts->>'exams')::BIGINT,0)
      ),
      jsonb_build_object(
        'key','related',
        'label','Dữ liệu liên quan',
        'count',
          COALESCE((v_counts->>'qr_result_links')::BIGINT,0)
        + COALESCE((v_counts->>'qr_responses')::BIGINT,0)
        + COALESCE((v_counts->>'qr_cards')::BIGINT,0)
        + COALESCE((v_counts->>'qr_sessions')::BIGINT,0)
        + COALESCE((v_counts->>'board_blocks')::BIGINT,0)
        + COALESCE((v_counts->>'board_pages')::BIGINT,0)
        + COALESCE((v_counts->>'boards')::BIGINT,0)
        + COALESCE((v_counts->>'documents')::BIGINT,0)
        + COALESCE((v_counts->>'teacher_classes')::BIGINT,0)
      ),
      jsonb_build_object('key','accounts','label','Tài khoản đăng nhập','count',v_account_count),
      jsonb_build_object('key','user','label','Hồ sơ người dùng','count',v_user_count)
    )
  );
END;
$user_delete$;
`;

export const USER_DELETE_CALL_SQL =
  'SELECT public.delete_user_cascade(?) AS deletion';

export function parseUserDeletionResult(row: any) {
  const raw = row?.deletion;
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

export function userDeleteHttpError(error: unknown) {
  const message = String((error as any)?.message || error || '');
  if (message.includes('USER_DELETE_ID_REQUIRED')) {
    return { status: 400, error: 'Thiếu mã người dùng cần xóa.', code: 'USER_DELETE_ID_REQUIRED' };
  }
  if (message.includes('USER_DELETE_NOT_FOUND')) {
    return { status: 404, error: 'Không tìm thấy hồ sơ người dùng hoặc hồ sơ đã được xóa.', code: 'USER_DELETE_NOT_FOUND' };
  }
  if (message.includes('USER_DELETE_PROTECTED_ADMIN')) {
    return { status: 400, error: 'BẢO MẬT HỆ THỐNG: Không được xóa tài khoản Quản trị viên.', code: 'USER_DELETE_PROTECTED_ADMIN' };
  }
  if (message.includes('USER_DELETE_')) {
    return {
      status: 409,
      error: 'Không thể hoàn tất việc xóa. Toàn bộ thay đổi đã được hoàn tác; không có dữ liệu nào bị xóa một phần.',
      code: 'USER_DELETE_ROLLED_BACK'
    };
  }
  return {
    status: 500,
    error: 'Xóa hồ sơ người dùng thất bại. Cơ sở dữ liệu đã hoàn tác toàn bộ giao dịch.',
    code: 'USER_DELETE_FAILED'
  };
}
