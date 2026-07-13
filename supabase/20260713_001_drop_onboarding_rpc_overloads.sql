-- Migration: Drop obsolete save_onboarding_data overloads
-- Date: 2026-07-13
-- Reason: Overloads 2 and 3 write to parents.password, which was dropped.
--         They will fail at runtime if called. The app does not call any
--         save_onboarding_data overload (it uses direct table inserts via
--         the Supabase client). Overload 1 (23 args, no password) is kept.
--
-- Verification before running:
--   SELECT proname, pg_get_function_identity_arguments(oid) AS args
--   FROM pg_proc WHERE proname = 'save_onboarding_data' AND pronamespace = 'public'::regnamespace;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- FORWARD MIGRATION
-- ─────────────────────────────────────────────────────────────────────────────

-- Overload 2 (25 args): added p_email + p_password, writes parents.password
DROP FUNCTION IF EXISTS public.save_onboarding_data(
  uuid,     -- p_parent_id
  text,     -- p_first_name
  text,     -- p_last_name
  text,     -- p_mobile
  text,     -- p_address
  numeric,  -- p_safety_pool_limit
  numeric,  -- p_weekly_allowance
  text,     -- p_email        ← distinguishes from overload 1
  text,     -- p_password     ← writes to parents.password (dropped)
  text,     -- p_child_display_name
  text,     -- p_child_username
  text,     -- p_child_password
  text,     -- p_child_mobile
  integer,  -- p_child_age
  text,     -- p_child_avatar_emoji
  integer,  -- p_child_trust_score
  numeric,  -- p_child_balance
  numeric,  -- p_child_loaned_out
  numeric,  -- p_child_borrowed
  integer,  -- p_child_streak
  integer,  -- p_child_repaid
  integer,  -- p_child_missed
  numeric,  -- p_child_total_borrowed
  numeric,  -- p_child_total_lent
  integer   -- p_child_points
);

-- Overload 3 (26 args): added p_email + p_password + p_display_name, writes parents.password
DROP FUNCTION IF EXISTS public.save_onboarding_data(
  uuid,     -- p_parent_id
  text,     -- p_first_name
  text,     -- p_last_name
  text,     -- p_mobile
  text,     -- p_address
  numeric,  -- p_safety_pool_limit
  numeric,  -- p_weekly_allowance
  text,     -- p_email        ← distinguishes from overload 1
  text,     -- p_password     ← writes to parents.password (dropped)
  text,     -- p_display_name ← distinguishes from overload 2
  text,     -- p_child_display_name
  text,     -- p_child_username
  text,     -- p_child_password
  text,     -- p_child_mobile
  integer,  -- p_child_age
  text,     -- p_child_avatar_emoji
  integer,  -- p_child_trust_score
  numeric,  -- p_child_balance
  numeric,  -- p_child_loaned_out
  numeric,  -- p_child_borrowed
  integer,  -- p_child_streak
  integer,  -- p_child_repaid
  integer,  -- p_child_missed
  numeric,  -- p_child_total_borrowed
  numeric,  -- p_child_total_lent
  integer   -- p_child_points
);

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-MIGRATION VERIFICATION
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this to confirm only overload 1 (23 args, no password param) remains:
--
--   SELECT proname, pg_get_function_identity_arguments(oid) AS args
--   FROM pg_proc WHERE proname = 'save_onboarding_data' AND pronamespace = 'public'::regnamespace;
--
-- Expected: exactly one row with 23 args (no p_email, no p_password).

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SQL
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: Rollback restores the function signatures but NOT their functionality —
--       parents.password was dropped and cannot be written to. Only restore if
--       you also restore the parents.password column (see git history).
--
-- -- Restore overload 2:
-- CREATE OR REPLACE FUNCTION public.save_onboarding_data(
--   p_parent_id uuid, p_first_name text, p_last_name text, p_mobile text, p_address text,
--   p_safety_pool_limit numeric, p_weekly_allowance numeric, p_email text, p_password text,
--   p_child_display_name text, p_child_username text, p_child_password text, p_child_mobile text,
--   p_child_age integer, p_child_avatar_emoji text, p_child_trust_score integer,
--   p_child_balance numeric, p_child_loaned_out numeric, p_child_borrowed numeric,
--   p_child_streak integer, p_child_repaid integer, p_child_missed integer,
--   p_child_total_borrowed numeric, p_child_total_lent numeric, p_child_points integer
-- ) RETURNS void LANGUAGE plpgsql AS $$
-- BEGIN
--   INSERT INTO parents (id, first_name, last_name, mobile, address, safety_pool_limit, weekly_allowance, email, password)
--   VALUES (p_parent_id, p_first_name, p_last_name, p_mobile, p_address, p_safety_pool_limit, p_weekly_allowance, p_email, p_password)
--   ON CONFLICT (id) DO UPDATE SET
--     first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, mobile = EXCLUDED.mobile,
--     address = EXCLUDED.address, email = EXCLUDED.email, password = EXCLUDED.password;
--   IF EXISTS (SELECT 1 FROM children WHERE parent_id = p_parent_id) THEN
--     UPDATE children SET display_name = p_child_display_name, username = p_child_username,
--       password = p_child_password, mobile = p_child_mobile, age = p_child_age, avatar_emoji = p_child_avatar_emoji
--     WHERE parent_id = p_parent_id;
--   ELSE
--     INSERT INTO children (parent_id, display_name, username, password, mobile, age, avatar_emoji,
--       trust_score, wallet_balance, loaned_out, borrowed, streak, repaid, missed, total_borrowed, total_lent, points)
--     VALUES (p_parent_id, p_child_display_name, p_child_username, p_child_password, p_child_mobile, p_child_age,
--       p_child_avatar_emoji, p_child_trust_score, p_child_balance, p_child_loaned_out, p_child_borrowed,
--       p_child_streak, p_child_repaid, p_child_missed, p_child_total_borrowed, p_child_total_lent, p_child_points);
--   END IF;
-- END; $$;
--
-- -- Restore overload 3:
-- CREATE OR REPLACE FUNCTION public.save_onboarding_data(
--   p_parent_id uuid, p_first_name text, p_last_name text, p_mobile text, p_address text,
--   p_safety_pool_limit numeric, p_weekly_allowance numeric, p_email text, p_password text, p_display_name text,
--   p_child_display_name text, p_child_username text, p_child_password text, p_child_mobile text,
--   p_child_age integer, p_child_avatar_emoji text, p_child_trust_score integer,
--   p_child_balance numeric, p_child_loaned_out numeric, p_child_borrowed numeric,
--   p_child_streak integer, p_child_repaid integer, p_child_missed integer,
--   p_child_total_borrowed numeric, p_child_total_lent numeric, p_child_points integer
-- ) RETURNS void LANGUAGE plpgsql AS $$
-- BEGIN
--   INSERT INTO parents (id, first_name, last_name, mobile, address, safety_pool_limit, weekly_allowance, email, password, display_name)
--   VALUES (p_parent_id, p_first_name, p_last_name, p_mobile, p_address, p_safety_pool_limit, p_weekly_allowance,
--           p_email, p_password, COALESCE(p_display_name, p_first_name))
--   ON CONFLICT (id) DO UPDATE SET
--     first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, mobile = EXCLUDED.mobile,
--     address = EXCLUDED.address, email = EXCLUDED.email, password = EXCLUDED.password, display_name = EXCLUDED.display_name;
--   IF EXISTS (SELECT 1 FROM children WHERE parent_id = p_parent_id) THEN
--     UPDATE children SET display_name = p_child_display_name, username = p_child_username,
--       password = p_child_password, mobile = p_child_mobile, age = p_child_age, avatar_emoji = p_child_avatar_emoji
--     WHERE parent_id = p_parent_id;
--   ELSE
--     INSERT INTO children (parent_id, display_name, username, password, mobile, age, avatar_emoji,
--       trust_score, wallet_balance, loaned_out, borrowed, streak, repaid, missed, total_borrowed, total_lent, points)
--     VALUES (p_parent_id, p_child_display_name, p_child_username, p_child_password, p_child_mobile, p_child_age,
--       p_child_avatar_emoji, p_child_trust_score, p_child_balance, p_child_loaned_out, p_child_borrowed,
--       p_child_streak, p_child_repaid, p_child_missed, p_child_total_borrowed, p_child_total_lent, p_child_points);
--   END IF;
-- END; $$;
