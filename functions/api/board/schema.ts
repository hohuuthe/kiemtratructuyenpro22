const initialized = new Set<string>();

export async function ensureInteractiveBoardSchema(db: any) {
  if (!db) throw new Error('Database unavailable');
  const key = String(db.connectionUrl || 'default');
  if (initialized.has(key)) return;

  try {
    const existing:any = await db.prepare(
      "SELECT to_regclass('public.interactive_boards') AS boards, to_regclass('public.interactive_board_pages') AS pages, to_regclass('public.interactive_board_blocks') AS blocks, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='interactive_board_pages' AND column_name='background_image_url') AS has_background_image"
    ).first();
    if (existing?.boards && existing?.pages && existing?.blocks && existing?.has_background_image) {
      initialized.add(key);
      return;
    }
  } catch (error) {
    console.warn('[BOARD SCHEMA CHECK]', error);
  }

  const statements = [
    `ALTER TABLE interactive_board_pages ADD COLUMN IF NOT EXISTS background_image_url TEXT NOT NULL DEFAULT ''`,
    `CREATE TABLE IF NOT EXISTS interactive_boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','open','locked','closed','archived')),
      access_mode TEXT NOT NULL DEFAULT 'public'
        CHECK (access_mode IN ('public','unit','protected')),
      access_code_hash TEXT,
      target_donvi TEXT NOT NULL DEFAULT '',
      target_lop TEXT NOT NULL DEFAULT '',
      student_permission TEXT NOT NULL DEFAULT 'draw'
        CHECK (student_permission IN ('view','comment','draw')),
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      max_participants INTEGER NOT NULL DEFAULT 60,
      settings_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS interactive_board_pages (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      page_no INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      background_type TEXT NOT NULL DEFAULT 'white'
        CHECK (background_type IN ('white','grid','lined','dots')),
      background_image_url TEXT NOT NULL DEFAULT '',
      canvas_width INTEGER NOT NULL DEFAULT 1600,
      canvas_height INTEGER NOT NULL DEFAULT 900,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(board_id, page_no)
    )`,
    `CREATE TABLE IF NOT EXISTS interactive_board_blocks (
      board_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      blocked_by TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (board_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ib_creator_updated
      ON interactive_boards(creator_id, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_ib_access_status
      ON interactive_boards(access_mode, status, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_ib_unit_status
      ON interactive_boards(target_donvi, status, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_ib_pages_board
      ON interactive_board_pages(board_id, page_no)`,
    `CREATE INDEX IF NOT EXISTS idx_ib_blocks_board_updated
      ON interactive_board_blocks(board_id, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_ib_blocks_user
      ON interactive_board_blocks(user_id, updated_at DESC)`
  ];

  for (const sql of statements) {
    await db.prepare(sql).run();
  }
  initialized.add(key);
}
