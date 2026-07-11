-- ============================================================
-- Passcode Hash Migration
-- Adds secure hashed passcode columns and migrates existing
-- plain-text passcodes.  Safe to run more than once.
--
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- pgcrypto is required for digest() — enabled by default on Supabase
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Add new columns
ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS passcode_hash        TEXT,
  ADD COLUMN IF NOT EXISTS passcode_created     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS passcode_created_at  TIMESTAMPTZ;

-- 2. Migrate existing plain-text passcodes to SHA-256 hashes.
--    Hash format must match the app: SHA-256(id::text || ':' || passcode)
UPDATE parents
SET
  passcode_hash       = encode(digest(id::text || ':' || passcode, 'sha256'), 'hex'),
  passcode_created    = TRUE,
  passcode_created_at = NOW()
WHERE
  passcode IS NOT NULL
  AND passcode <> ''
  AND (passcode_hash IS NULL OR passcode_hash = '');

-- 3. Clear the plain-text column for all migrated rows so nothing
--    sensitive remains in the old column.
UPDATE parents
SET passcode = NULL
WHERE passcode_created = TRUE;
