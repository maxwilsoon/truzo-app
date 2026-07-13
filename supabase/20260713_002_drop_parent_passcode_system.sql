-- Migration: Drop orphaned bcrypt parent-passcode system
-- Date: 2026-07-13
-- Reason: The app uses passcode_hash / passcode_created / passcode_created_at (SHA-256 via expo-crypto).
--         A separate bcrypt system (parent_passcode_hash, set_parent_passcode, verify_parent_passcode)
--         was never wired into the app. All 3 parents rows have parent_passcode_hash IS NULL and
--         parent_passcode_created = FALSE (verified 2026-07-13 pre-migration). No views, triggers,
--         indexes, or RLS policies depend on these columns. The only app-code reference
--         (BiometricLoginScreen.tsx:72 reading parent_passcode_created) was a bug — now fixed to
--         read passcode_created instead.
--
-- Verification before running:
--   SELECT COUNT(*) FROM parents WHERE parent_passcode_hash IS NOT NULL;   -- must be 0
--   SELECT COUNT(*) FROM parents WHERE parent_passcode_created = TRUE;      -- must be 0
--
-- ─────────────────────────────────────────────────────────────────────────────
-- FORWARD MIGRATION
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Drop orphaned bcrypt RPCs
DROP FUNCTION IF EXISTS public.set_parent_passcode(uuid, text);
DROP FUNCTION IF EXISTS public.verify_parent_passcode(uuid, text);

-- 2. Drop orphaned columns (all rows are NULL / FALSE — confirmed pre-migration)
ALTER TABLE public.parents DROP COLUMN IF EXISTS parent_passcode_hash;
ALTER TABLE public.parents DROP COLUMN IF EXISTS parent_passcode_created;
ALTER TABLE public.parents DROP COLUMN IF EXISTS parent_passcode_created_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-MIGRATION VERIFICATION
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this to confirm all objects are gone:
--
--   -- Columns gone:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'parents'
--     AND column_name LIKE 'parent_passcode%';
--   -- Expected: 0 rows
--
--   -- RPCs gone:
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('set_parent_passcode', 'verify_parent_passcode')
--     AND pronamespace = 'public'::regnamespace;
--   -- Expected: 0 rows
--
--   -- Active passcode system intact:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'parents'
--     AND column_name IN ('passcode_hash', 'passcode_created', 'passcode_created_at');
--   -- Expected: 3 rows

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SQL
-- ─────────────────────────────────────────────────────────────────────────────
-- -- Restore columns:
-- ALTER TABLE public.parents
--   ADD COLUMN IF NOT EXISTS parent_passcode_hash        TEXT,
--   ADD COLUMN IF NOT EXISTS parent_passcode_created     BOOLEAN NOT NULL DEFAULT FALSE,
--   ADD COLUMN IF NOT EXISTS parent_passcode_created_at  TIMESTAMPTZ;
--
-- -- Restore RPCs:
-- CREATE OR REPLACE FUNCTION public.set_parent_passcode(p_parent_id uuid, p_passcode text)
-- RETURNS void LANGUAGE plpgsql AS $$
-- BEGIN
--   UPDATE parents
--   SET parent_passcode_hash       = crypt(p_passcode, gen_salt('bf', 10)),
--       parent_passcode_created    = TRUE,
--       parent_passcode_created_at = COALESCE(parent_passcode_created_at, NOW())
--   WHERE id = p_parent_id;
-- END; $$;
--
-- CREATE OR REPLACE FUNCTION public.verify_parent_passcode(p_parent_id uuid, p_passcode text)
-- RETURNS boolean LANGUAGE plpgsql AS $$
-- DECLARE stored_hash TEXT;
-- BEGIN
--   SELECT parent_passcode_hash INTO stored_hash FROM parents WHERE id = p_parent_id;
--   IF stored_hash IS NULL THEN RETURN FALSE; END IF;
--   RETURN crypt(p_passcode, stored_hash) = stored_hash;
-- END; $$;
