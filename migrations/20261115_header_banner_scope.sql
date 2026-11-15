-- Tenant-scoped banner placement; additive and non-destructive.
-- Existing tenant banners continue to show in both modes.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS header_banner_scope TEXT NOT NULL DEFAULT 'both';
