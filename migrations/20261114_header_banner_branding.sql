-- Additive tenant-safe migration for header branding in each Neon database.
-- Run per tenant (only if admin uses banner or during planned rollout).
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS header_display_mode TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS header_banner_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS header_banner_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS header_banner_alt TEXT NOT NULL DEFAULT '';

UPDATE public.app_settings
SET header_display_mode = 'text'
WHERE header_display_mode IS NULL OR header_display_mode NOT IN ('text', 'banner', 'both');
