-- ============================================================
-- Parent Profile Image Migration
-- Adds profile_image_url and profile_image_updated_at to parents.
-- Safe to run more than once.
-- ============================================================

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS profile_image_url        TEXT,
  ADD COLUMN IF NOT EXISTS profile_image_updated_at TIMESTAMPTZ;
