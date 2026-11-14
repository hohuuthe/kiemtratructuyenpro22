-- Additive tenant-safe migration for header branding in each Neon database.
-- Run per tenant (only if admin uses banner or during planned rollout).
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS header_display_mode TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS header_banner_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS header_banner_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS header_banner_alt TEXT NOT NULL DEFAULT '';

-- Optional device-specific assets. Desktop remains mandatory as the fallback.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS header_banner_tablet_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS header_banner_tablet_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS header_banner_mobile_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS header_banner_mobile_key TEXT NOT NULL DEFAULT '';

UPDATE public.app_settings
SET header_display_mode = 'text'
WHERE header_display_mode IS NULL OR header_display_mode NOT IN ('text', 'banner', 'both');

-- Independent student exam fullscreen branding mode. Safe for all older tenants.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS exam_header_display_mode TEXT NOT NULL DEFAULT 'text';

UPDATE public.app_settings
SET exam_header_display_mode = 'text'
WHERE exam_header_display_mode IS NULL
   OR exam_header_display_mode NOT IN ('text', 'banner', 'both');
