-- Migration 030: pg_cron schedule + remove old client RPCs
--
-- Prerequisites:
--   • Migration 029 (process_due_loan_defaults function) must be applied first.
--   • pg_cron extension must be enabled via Supabase Dashboard →
--     Database → Extensions → pg_cron (BEFORE running this migration).
--
-- What this migration does
-- ─────────────────────────
-- 1. Hard-fails if pg_cron is not installed (no silent NOTICE).
-- 2. Hard-fails if process_due_loan_defaults() does not exist.
-- 3. Schedules process_due_loan_defaults() every 15 minutes via cron.schedule.
-- 4. Drops the old client-callable RPCs:
--      process_loan_default(uuid)    — any bearer of the anon key could call this
--      get_overdue_funded_loans(uuid) — same exposure
--
-- Deployment order
-- ─────────────────
-- 027 (schema) → 028 (RPCs) → 029 (processor) → pg_cron enable in dashboard →
-- 030 (this file) → client deploy → Edge Function redeploy
--
-- The gap between 029 and 030 is safe: no processing happens (old client RPCs
-- are still present; the new processor is deployed but not yet scheduled).
-- There is no window where NEITHER old polling NOR cron runs because:
--   - The client still calls the old RPCs until client code is deployed.
--   - After 030, the old RPCs are gone and the cron schedule is active.
--   - Client deploy happens after 030 (removes the polling calls).
--
-- Rollback: 20260803_030_rollback.sql
-- Rollback effect: unschedules the cron job. Old RPCs are NOT recreated.
-- Rolling back 030 pauses default processing. Apply 029 + 030 again to restore.

BEGIN;

-- ─── 1. Hard guard: pg_cron must be installed ────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE EXCEPTION
      'pg_cron extension is not installed. '
      'Enable it via Supabase Dashboard → Database → Extensions → pg_cron, '
      'then re-run this migration.';
  END IF;
END $$;

-- ─── 2. Hard guard: processor function must exist ────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'process_due_loan_defaults'
  ) THEN
    RAISE EXCEPTION
      'public.process_due_loan_defaults() does not exist. '
      'Apply migration 029 before applying this migration.';
  END IF;
END $$;

-- ─── 3. Schedule (idempotent: unschedule existing before scheduling) ──────────

SELECT cron.unschedule('process-loan-defaults')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-loan-defaults');

SELECT cron.schedule(
  'process-loan-defaults',
  '*/15 * * * *',
  $$SELECT public.process_due_loan_defaults()$$
);

-- ─── 4. Drop old client-callable RPCs ────────────────────────────────────────
-- These were callable by any bearer of the anon key with no ownership check.
-- The cron-driven process_due_loan_defaults() replaces them both.

DROP FUNCTION IF EXISTS public.process_loan_default(uuid);
DROP FUNCTION IF EXISTS public.get_overdue_funded_loans(uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
