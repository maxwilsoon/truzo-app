-- Rollback for migration 036 — FAIL-CLOSED
--
-- SECURITY CONSTRAINT: This rollback does NOT restore any insecure function signatures.
-- Per project policy, rollbacks must never restore:
--   - UUID-only authorization
--   - Insecure biometric signatures (no session validation)
--   - PUBLIC grants on any function
--
-- Post-rollback state:
--   enable_biometric   — UNAVAILABLE (4-param dropped; insecure 3-param NOT restored)
--   disable_biometric  — UNAVAILABLE (3-param dropped; insecure 1-param NOT restored)
--   confirm_parent_repayment — RETAINED with auth.uid() guard (safe, cannot revert)
--   persist_transaction      — RETAINED postgres/service_role only (safe, cannot revert)
--   parent_send_money        — NOT restored (confirmed unused dead code)
--   Internal helper REVOKEs  — RETAINED (re-opening gains no app value)
--
-- Biometric setup and disable become temporarily non-functional after rollback.
-- Password login, biometric LOGIN (biometric_login_child), and core account recovery
-- remain fully available throughout.
--
-- Apply:
--   psql $DATABASE_URL -f supabase/20260803_036_rollback.sql

BEGIN;

-- Drop new secured biometric signatures.
-- Any call to enable_biometric or disable_biometric will receive
-- "function does not exist" until migration 036 is re-applied.
DROP FUNCTION IF EXISTS public.enable_biometric(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.disable_biometric(uuid, text, text);

-- confirm_parent_repayment: auth.uid() guard and search_path RETAINED.
-- Removing them would restore an unauthenticated financial-write path (H-02).

-- persist_transaction: postgres/service_role-only RETAINED.
-- Removing this would restore an externally callable financial write (H-03).

-- parent_send_money: NOT restored.
-- Zero client references confirmed at snapshot time (2026-08-04).

-- Internal helper REVOKEs (H-05): RETAINED.
-- Restoring PUBLIC/anon grants on _trigger_notification, add_activity_item, etc.
-- provides no operational value and widens the attack surface.

NOTIFY pgrst, 'reload schema';

COMMIT;
