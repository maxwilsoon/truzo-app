-- Verification SQL for migrations 025 + 026
-- Run each section in order. Expected results are shown in comments.

-- ─── 1. Exactly one named cron job ───────────────────────────────────────────
-- Expected: 1 row, schedule = '*/15 * * * *'

SELECT jobid, jobname, schedule, command, active
FROM   cron.job
WHERE  jobname = 'process-loan-defaults';

-- ─── 2. Next scheduled run ───────────────────────────────────────────────────
-- Expected: a row with next_run within 15 minutes of now()

SELECT jobname, next_run
FROM   cron.job
WHERE  jobname = 'process-loan-defaults';

-- ─── 3. process_due_loan_defaults grants ─────────────────────────────────────
-- Expected: no rows for anon or authenticated
-- postgres and service_role may appear (implicit privilege)

SELECT r.routine_name, g.grantee, g.privilege_type
FROM   information_schema.routine_privileges g
JOIN   information_schema.routines r
         ON r.specific_name  = g.specific_name
        AND r.routine_schema = g.specific_schema
WHERE  r.routine_schema = 'public'
  AND  r.routine_name   = 'process_due_loan_defaults'
ORDER  BY g.grantee;

-- ─── 4. Old RPCs are absent ──────────────────────────────────────────────────
-- Expected: 0 rows

SELECT proname
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  p.proname IN ('process_loan_default', 'get_overdue_funded_loans');

-- ─── 5. Function exists with correct security settings ───────────────────────
-- Expected: security_definer=true, config contains search_path=''

SELECT p.proname,
       pg_get_userbyid(p.proowner)   AS owner,
       p.prosecdef                   AS security_definer,
       p.proconfig                   AS config
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  p.proname = 'process_due_loan_defaults';

-- ─── 6. notification_queue table ─────────────────────────────────────────────
-- Expected: table exists; anon and authenticated have no privileges

SELECT table_name FROM information_schema.tables
WHERE  table_schema = 'public' AND table_name = 'notification_queue';

SELECT grantee, privilege_type
FROM   information_schema.role_table_grants
WHERE  table_schema = 'public' AND table_name = 'notification_queue'
ORDER  BY grantee;

-- ─── 7. Index for default-scan hot path ──────────────────────────────────────
-- Expected: 1 row

SELECT indexname, indexdef
FROM   pg_indexes
WHERE  schemaname = 'public'
  AND  indexname  = 'idx_money_requests_funded_overdue';

-- ─── 8. Service-role / internal execution still works ────────────────────────
-- Expected: JSON result with processed + skipped keys; no ERROR

SELECT public.process_due_loan_defaults();

-- ─── 9. No duplicate default processing (idempotency) ────────────────────────
-- Insert a test loan already in 'defaulted' state (should not be re-processed)

DO $$
DECLARE
  v_parent_id uuid;
  v_child_id  uuid;
  v_req_id    uuid;
  v_before    numeric;
  v_after     numeric;
BEGIN
  INSERT INTO parents (first_name, last_name, email, safety_pool_limit)
    VALUES ('Verify','Test','verify@test.invalid', 50) RETURNING id INTO v_parent_id;

  INSERT INTO children (parent_id, display_name, username, password_hash, wallet_balance)
    VALUES (v_parent_id, 'VChild', 'vchild_test', 'x', 100) RETURNING id INTO v_child_id;

  INSERT INTO money_requests (from_id, funded_by, amount, repay_by_date, expires_at, status, repaid_at)
    VALUES (v_child_id, v_child_id, 7.00, CURRENT_DATE - 1, now() - interval '1d', 'defaulted', now())
    RETURNING id INTO v_req_id;

  SELECT wallet_balance INTO v_before FROM children WHERE id = v_child_id;
  PERFORM public.process_due_loan_defaults();
  SELECT wallet_balance INTO v_after  FROM children WHERE id = v_child_id;

  IF v_before <> v_after THEN
    RAISE EXCEPTION 'FAIL: already-defaulted loan was reprocessed (before=% after=%)', v_before, v_after;
  ELSE
    RAISE NOTICE 'PASS: already-defaulted loan was not reprocessed';
  END IF;

  -- Cleanup
  DELETE FROM money_requests WHERE id = v_req_id;
  DELETE FROM children WHERE id = v_child_id;
  DELETE FROM parents  WHERE id = v_parent_id;
END $$;

-- ─── 10. Partial-state rollback on forced failure ────────────────────────────
-- Inserts a funded overdue loan, makes one required table unwritable by
-- temporarily dropping a column reference — simulates a mid-processing failure
-- and verifies no partial state is left.
--
-- NOTE: this test cannot be fully automated here because we cannot easily
-- force a mid-transaction failure without altering table structure.
-- Instead, verify atomicity by checking that after a ROLLBACK, none of:
--   money_requests.status, parents.safety_pool_used, children.wallet_balance,
--   transactions rows, activity_feed rows, notification_queue rows
-- are in a partially-updated state.
--
-- Manual verification:
--   1. Start a psql session.
--   2. BEGIN;
--   3. INSERT a funded overdue loan.
--   4. Call process_due_loan_defaults() — it will process it.
--   5. ROLLBACK;
--   6. Confirm the loan is still 'funded' and no balance/activity changes exist.
SELECT 'Manual atomicity test required — see comment above' AS note;

-- ─── 11. Rollback does not restore anonymous access ──────────────────────────
-- After running 026_rollback.sql (remove schedule only), verify the old RPCs
-- are still absent. Run this after rollback testing.

SELECT proname
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  p.proname IN ('process_loan_default', 'get_overdue_funded_loans');
-- Expected: 0 rows

-- ─── 12. Recent cron run history (after first automatic execution) ────────────

SELECT jobid, status, start_time, end_time,
       return_message
FROM   cron.job_run_details
WHERE  jobid = (SELECT jobid FROM cron.job WHERE jobname = 'process-loan-defaults')
ORDER  BY start_time DESC
LIMIT  5;
