-- Atomic teacher hard-delete migration.
-- Idempotent: safe to apply repeatedly to every Neon tenant.
-- Any invocation of delete_teacher_cascade() is a single PostgreSQL transaction statement.


CREATE OR REPLACE FUNCTION public.delete_teacher_cascade(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $teacher_delete$
DECLARE
  v_profile RECORD;
  v_identity_ids TEXT[];
  v_exam_ids TEXT[];
  v_qr_session_ids TEXT[] := ARRAY[]::TEXT[];
  v_board_ids TEXT[] := ARRAY[]::TEXT[];
  v_count BIGINT := 0;
  v_counts JSONB := '{}'::JSONB;
  v_account_count BIGINT := 0;
  v_user_count BIGINT := 0;
  v_has_orphans BOOLEAN := FALSE;
BEGIN
  IF p_user_id IS NULL OR BTRIM(p_user_id) = '' THEN
    RAISE EXCEPTION 'TEACHER_DELETE_ID_REQUIRED';
  END IF;

  -- Lock the principal first. This also makes duplicate delete requests serialize.
  SELECT id, full_name, target_audience
    INTO v_profile
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEACHER_DELETE_NOT_FOUND';
  END IF;

  -- Defense in depth: admin can never be removed by this function.
  IF LOWER(COALESCE(v_profile.target_audience, '')) IN ('quản trị viên','admin')
     OR EXISTS (
       SELECT 1 FROM public.accounts
       WHERE (user_id = p_user_id OR id = p_user_id)
         AND (
           LOWER(COALESCE(role,'')) = 'admin'
           OR LOWER(COALESCE(username,'')) IN ('admin','adminhht')
           OR LOWER(COALESCE(id,'')) IN ('admin','adminhht')
         )
     )
  THEN
    RAISE EXCEPTION 'TEACHER_DELETE_PROTECTED_ADMIN';
  END IF;

  -- Include both the canonical users.id and all linked account IDs because
  -- historical creator_id values may use either representation.
  SELECT ARRAY(
    SELECT DISTINCT ident
    FROM (
      SELECT p_user_id AS ident
      UNION ALL
      SELECT id FROM public.accounts WHERE user_id = p_user_id OR id = p_user_id
    ) ids
    WHERE ident IS NOT NULL AND BTRIM(ident) <> ''
  )
  INTO v_identity_ids;

  -- Prevent concurrent writes to the core ownership tables for the short
  -- duration of this rare administrative operation.
  LOCK TABLE public.users, public.accounts, public.results, public.questions,
             public.exam_configs, public.teacher_classes
    IN SHARE ROW EXCLUSIVE MODE;

  -- Optional feature tables exist only on newer tenants. Lock them when present.
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
  IF to_regclass('public._submitted_exam_tokens') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public._submitted_exam_tokens IN SHARE ROW EXCLUSIVE MODE';
  END IF;

  SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::TEXT[])
    INTO v_exam_ids
  FROM public.exam_configs
  WHERE creator_id = ANY(v_identity_ids);

  IF to_regclass('public.qr_answer_sessions') IS NOT NULL THEN
    EXECUTE
      'SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::TEXT[]) FROM public.qr_answer_sessions
       WHERE creator_id = ANY($1) OR exam_id = ANY($2)'
      INTO v_qr_session_ids
      USING v_identity_ids, v_exam_ids;
  END IF;

  IF to_regclass('public.interactive_boards') IS NOT NULL THEN
    EXECUTE
      'SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::TEXT[]) FROM public.interactive_boards
       WHERE creator_id = ANY($1)'
      INTO v_board_ids
      USING v_identity_ids;
  END IF;

  ---------------------------------------------------------------------------
  -- STEP 1: Results / submissions and dependent live-session records.
  ---------------------------------------------------------------------------
  IF to_regclass('public.qr_answer_result_links') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.qr_answer_result_links
       WHERE session_id = ANY($1)
          OR user_id = ANY($2)
          OR result_id IN (
            SELECT id FROM public.results
            WHERE exam_id = ANY($3) OR user_id = ANY($2)
          )'
      USING v_qr_session_ids, v_identity_ids, v_exam_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('qr_result_links', v_count);
  END IF;

  IF to_regclass('public.qr_answer_responses') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.qr_answer_responses
       WHERE session_id = ANY($1) OR user_id = ANY($2)'
      USING v_qr_session_ids, v_identity_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('qr_responses', v_count);
  END IF;

  DELETE FROM public.results
  WHERE exam_id = ANY(v_exam_ids) OR user_id = ANY(v_identity_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('results', v_count);

  IF to_regclass('public._submitted_exam_tokens') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public._submitted_exam_tokens WHERE exam_id = ANY($1)'
      USING v_exam_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('submitted_tokens', v_count);
  END IF;

  IF to_regclass('public.qr_answer_sessions') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.qr_answer_sessions WHERE id = ANY($1)'
      USING v_qr_session_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('qr_sessions', v_count);
  END IF;

  IF to_regclass('public.qr_answer_cards') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.qr_answer_cards
       WHERE created_by = ANY($1) OR user_id = ANY($1)'
      USING v_identity_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('qr_cards', v_count);
  END IF;

  ---------------------------------------------------------------------------
  -- Related teacher-owned resources. These are removed before the principal
  -- so they cannot retain creator/user references.
  ---------------------------------------------------------------------------
  IF to_regclass('public.interactive_board_pages') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.interactive_board_pages WHERE board_id = ANY($1)'
      USING v_board_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('board_pages', v_count);
  END IF;

  IF to_regclass('public.interactive_board_blocks') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.interactive_board_blocks
       WHERE board_id = ANY($1) OR user_id = ANY($2) OR blocked_by = ANY($2)'
      USING v_board_ids, v_identity_ids;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('board_blocks', v_count);
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

  ---------------------------------------------------------------------------
  -- STEP 2: Teacher-created questions.
  ---------------------------------------------------------------------------
  DELETE FROM public.questions WHERE creator_id = ANY(v_identity_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('questions', v_count);

  ---------------------------------------------------------------------------
  -- STEP 3: Teacher-created exams (all exact-ID results were deleted above).
  ---------------------------------------------------------------------------
  DELETE FROM public.exam_configs WHERE id = ANY(v_exam_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('exams', v_count);

  ---------------------------------------------------------------------------
  -- Assignment references are principal metadata and must be gone before
  -- account/profile removal.
  ---------------------------------------------------------------------------
  DELETE FROM public.teacher_classes WHERE teacher_id = ANY(v_identity_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('teacher_classes', v_count);

  ---------------------------------------------------------------------------
  -- STEP 4: Login accounts.
  ---------------------------------------------------------------------------
  DELETE FROM public.accounts
  WHERE id = ANY(v_identity_ids) OR user_id = p_user_id;
  GET DIAGNOSTICS v_account_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('accounts', v_account_count);

  ---------------------------------------------------------------------------
  -- STEP 5: Teacher profile, always last.
  ---------------------------------------------------------------------------
  DELETE FROM public.users WHERE id = p_user_id;
  GET DIAGNOSTICS v_user_count = ROW_COUNT;
  IF v_user_count <> 1 THEN
    RAISE EXCEPTION 'TEACHER_DELETE_PROFILE_CONFLICT';
  END IF;
  v_counts := v_counts || jsonb_build_object('users', v_user_count);

  -- Final invariant audit for every ownership/reference column this application
  -- currently defines. Any hit means ROLLBACK, never partial success.
  IF EXISTS (SELECT 1 FROM public.accounts WHERE user_id = p_user_id OR id = ANY(v_identity_ids))
     OR EXISTS (SELECT 1 FROM public.questions WHERE creator_id = ANY(v_identity_ids))
     OR EXISTS (SELECT 1 FROM public.exam_configs WHERE creator_id = ANY(v_identity_ids))
     OR EXISTS (SELECT 1 FROM public.results WHERE exam_id = ANY(v_exam_ids) OR user_id = ANY(v_identity_ids))
     OR EXISTS (SELECT 1 FROM public.teacher_classes WHERE teacher_id = ANY(v_identity_ids))
  THEN
    RAISE EXCEPTION 'TEACHER_DELETE_ORPHAN_AUDIT_FAILED';
  END IF;

  IF to_regclass('public.quan_ly_tai_lieu') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.quan_ly_tai_lieu
         WHERE id_nguoi_tao = ANY($1) OR id_nguoi_cap_nhat = ANY($1)
       )'
      INTO v_has_orphans
      USING v_identity_ids;
    IF v_has_orphans THEN
      RAISE EXCEPTION 'TEACHER_DELETE_DOCUMENT_AUDIT_FAILED';
    END IF;
  END IF;

  IF to_regclass('public.interactive_boards') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.interactive_boards WHERE creator_id = ANY($1)
       )'
      INTO v_has_orphans
      USING v_identity_ids;
    IF v_has_orphans THEN
      RAISE EXCEPTION 'TEACHER_DELETE_BOARD_AUDIT_FAILED';
    END IF;
  END IF;

  IF to_regclass('public.qr_answer_sessions') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.qr_answer_sessions
         WHERE creator_id = ANY($1) OR exam_id = ANY($2)
       )'
      INTO v_has_orphans
      USING v_identity_ids, v_exam_ids;
    IF v_has_orphans THEN
      RAISE EXCEPTION 'TEACHER_DELETE_QR_SESSION_AUDIT_FAILED';
    END IF;
  END IF;

  IF to_regclass('public.qr_answer_cards') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.qr_answer_cards
         WHERE created_by = ANY($1) OR user_id = ANY($1)
       )'
      INTO v_has_orphans
      USING v_identity_ids;
    IF v_has_orphans THEN
      RAISE EXCEPTION 'TEACHER_DELETE_QR_CARD_AUDIT_FAILED';
    END IF;
  END IF;

  IF to_regclass('public.qr_answer_responses') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.qr_answer_responses
         WHERE session_id = ANY($1) OR user_id = ANY($2)
       )'
      INTO v_has_orphans
      USING v_qr_session_ids, v_identity_ids;
    IF v_has_orphans THEN
      RAISE EXCEPTION 'TEACHER_DELETE_QR_RESPONSE_AUDIT_FAILED';
    END IF;
  END IF;

  IF to_regclass('public.qr_answer_result_links') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.qr_answer_result_links
         WHERE session_id = ANY($1) OR user_id = ANY($2)
       )'
      INTO v_has_orphans
      USING v_qr_session_ids, v_identity_ids;
    IF v_has_orphans THEN
      RAISE EXCEPTION 'TEACHER_DELETE_QR_RESULT_LINK_AUDIT_FAILED';
    END IF;
  END IF;

  IF to_regclass('public.interactive_board_pages') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.interactive_board_pages WHERE board_id = ANY($1)
       )'
      INTO v_has_orphans
      USING v_board_ids;
    IF v_has_orphans THEN
      RAISE EXCEPTION 'TEACHER_DELETE_BOARD_PAGE_AUDIT_FAILED';
    END IF;
  END IF;

  IF to_regclass('public.interactive_board_blocks') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.interactive_board_blocks
         WHERE board_id = ANY($1)
            OR user_id = ANY($2)
            OR blocked_by = ANY($2)
       )'
      INTO v_has_orphans
      USING v_board_ids, v_identity_ids;
    IF v_has_orphans THEN
      RAISE EXCEPTION 'TEACHER_DELETE_BOARD_BLOCK_AUDIT_FAILED';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'user_id', p_user_id,
    'teacher_name', COALESCE(v_profile.full_name, ''),
    'identity_ids', v_identity_ids,
    'exam_ids', v_exam_ids,
    'counts', v_counts,
    'steps', jsonb_build_array(
      jsonb_build_object('key','results','label','Kết quả bài làm và dữ liệu nộp bài','count',COALESCE((v_counts->>'results')::BIGINT,0)),
      jsonb_build_object('key','questions','label','Câu hỏi của giáo viên','count',COALESCE((v_counts->>'questions')::BIGINT,0)),
      jsonb_build_object('key','exams','label','Đề kiểm tra của giáo viên','count',COALESCE((v_counts->>'exams')::BIGINT,0)),
      jsonb_build_object(
        'key','related','label','Dữ liệu liên quan',
        'count',
          COALESCE((v_counts->>'teacher_classes')::BIGINT,0)
        + COALESCE((v_counts->>'documents')::BIGINT,0)
        + COALESCE((v_counts->>'boards')::BIGINT,0)
        + COALESCE((v_counts->>'qr_sessions')::BIGINT,0)
        + COALESCE((v_counts->>'qr_cards')::BIGINT,0)
      ),
      jsonb_build_object('key','accounts','label','Tài khoản đăng nhập','count',v_account_count),
      jsonb_build_object('key','user','label','Hồ sơ giáo viên','count',v_user_count)
    )
  );
END;
$teacher_delete$;

