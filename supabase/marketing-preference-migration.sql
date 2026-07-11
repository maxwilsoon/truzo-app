-- ============================================================
-- Marketing Preference Migration
-- Adds marketing_notifications and marketing_preference_updated_at
-- to the parents table.  Safe to run more than once.
--
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS marketing_notifications        BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_preference_updated_at TIMESTAMPTZ;
