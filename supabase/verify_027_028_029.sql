-- Verification for migrations 027 + 028 + 029 (Option C Safety Pool reservation)
-- Run after 027 + 028 + 029 are applied, but BEFORE 030 (pg_cron schedule).
-- Each section states what it expects. Run in a psql session or via the
-- Supabase SQL editor.
--
-- KNOWN SCHEMA CONSTRAINTS:
--   • parents.id → auth.users.id (FK). Every INSERT into parents must first
--     insert a matching row into auth.users. The DO blocks below handle this.
--   • parents.id has no DEFAULT. Always pass gen_random_uuid() explicitly.
--   • require_valid_child_session requires length(token) = 64 chars.
--     Use encode(gen_random_bytes(32), 'hex') to generate valid test tokens.

-- ─── T1. Schema: new columns exist ───────────────────────────────────────────
-- Expected: 3 rows — safety_pool_reserved (parents), safety_pool_reserved_amount
--           (money_requests), safety_pool_reservation_released_at (money_requests)

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  (
         (table_name = 'parents'        AND column_name = 'safety_pool_reserved')
      OR (table_name = 'money_requests' AND column_name IN (
            'safety_pool_reserved_amount',
            'safety_pool_reservation_released_at'))
       )
ORDER  BY table_name, column_name;

-- ─── T2. Schema: check constraints exist ─────────────────────────────────────
-- Expected: chk_parents_sp_invariant, chk_parents_sp_reserved_nonneg,
--           chk_parents_sp_used_nonneg, chk_mr_sp_reserved_nonneg

SELECT tc.table_name, tc.constraint_name, cc.check_clause
FROM   information_schema.table_constraints tc
JOIN   information_schema.check_constraints cc
         ON cc.constraint_name  = tc.constraint_name
        AND cc.constraint_schema = tc.constraint_schema
WHERE  tc.table_schema = 'public'
  AND  tc.table_name   IN ('parents', 'money_requests')
  AND  tc.constraint_name LIKE 'chk_%sp%'
ORDER  BY tc.table_name, tc.constraint_name;

-- ─── T3. fund_money_request: reservation incremented at funding time ──────────
-- Creates test parent + two children (borrower, funder), funds a loan,
-- verifies parents.safety_pool_reserved = loan amount,
-- and money_requests.safety_pool_reserved_amount = loan amount.
--
-- NOTE: parents.id must be explicitly provided and match a row in auth.users.
--       Session token must be exactly 64 hex chars (use gen_random_bytes(32)).

DO $$
DECLARE
  v_parent_id   uuid := gen_random_uuid();
  v_borrower_id uuid;
  v_funder_id   uuid;
  v_req_id      uuid;
  v_token       text;
  v_reserved    numeric;
  v_req_rsv     numeric;
BEGIN
  -- Seed auth.users so parents FK constraint is satisfied
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
    VALUES (v_parent_id, 'authenticated', 'authenticated',
            'test_t3@verify.invalid', now(), now())
    ON CONFLICT (id) DO NOTHING;

  v_token := encode(gen_random_bytes(32), 'hex'); -- 64-char hex token

  INSERT INTO parents (id, first_name, last_name, email, safety_pool_limit)
    VALUES (v_parent_id, 'Test','Parent','test_t3@verify.invalid', 100);

  INSERT INTO children (parent_id, display_name, username, password_hash, wallet_balance)
    VALUES (v_parent_id, 'T3Borrower', 't3borrower', crypt('pass', gen_salt('bf',4)), 50)
    RETURNING id INTO v_borrower_id;

  INSERT INTO children (parent_id, display_name, username, password_hash, wallet_balance)
    VALUES (v_parent_id, 'T3Funder', 't3funder', crypt('pass', gen_salt('bf',4)), 200)
    RETURNING id INTO v_funder_id;

  INSERT INTO money_requests (from_id, amount, repay_by_date, expires_at, status)
    VALUES (v_borrower_id, 30, CURRENT_DATE + 7, now() + interval '7d', 'pending')
    RETURNING id INTO v_req_id;

  INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (v_funder_id,
            encode(digest(v_token, 'sha256'), 'hex'),
            'device_t3',
            now() + interval '1h',
            now() + interval '30d');

  PERFORM public.fund_money_request(
    v_req_id, v_funder_id, 30::numeric, v_token, 'device_t3'
  );

  SELECT safety_pool_reserved INTO v_reserved FROM parents WHERE id = v_parent_id;
  SELECT safety_pool_reserved_amount INTO v_req_rsv FROM money_requests WHERE id = v_req_id;

  IF v_reserved <> 30 THEN
    RAISE EXCEPTION 'T3 FAIL: parents.safety_pool_reserved = % (expected 30)', v_reserved;
  END IF;
  IF v_req_rsv <> 30 THEN
    RAISE EXCEPTION 'T3 FAIL: money_requests.safety_pool_reserved_amount = % (expected 30)', v_req_rsv;
  END IF;
  RAISE NOTICE 'T3 PASS: reservation set correctly at funding time';

  -- Cleanup
  DELETE FROM transactions   WHERE child_id IN (SELECT id FROM children WHERE parent_id = v_parent_id);
  DELETE FROM child_sessions WHERE child_id IN (SELECT id FROM children WHERE parent_id = v_parent_id);
  DELETE FROM money_requests WHERE from_id  IN (SELECT id FROM children WHERE parent_id = v_parent_id);
  DELETE FROM children       WHERE parent_id = v_parent_id;
  DELETE FROM parents        WHERE id = v_parent_id;
  DELETE FROM auth.users     WHERE id = v_parent_id;
END $$;

-- ─── T4. repay_money_request: reservation released at repayment ───────────────
-- Mirrors T3 setup: fund a loan, then repay it.
-- Expects: safety_pool_reserved = 0, reservation_released_at IS NOT NULL.

DO $$
DECLARE
  v_parent_id   uuid := gen_random_uuid();
  v_borrower_id uuid;
  v_funder_id   uuid;
  v_req_id      uuid;
  v_tok_fund    text;
  v_tok_repay   text;
  v_reserved    numeric;
  v_released_at timestamptz;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
    VALUES (v_parent_id, 'authenticated', 'authenticated',
            'test_t4@verify.invalid', now(), now())
    ON CONFLICT (id) DO NOTHING;

  v_tok_fund  := encode(gen_random_bytes(32), 'hex');
  v_tok_repay := encode(gen_random_bytes(32), 'hex');

  INSERT INTO parents (id, first_name, last_name, email, safety_pool_limit)
    VALUES (v_parent_id, 'Test','Parent','test_t4@verify.invalid', 100);

  INSERT INTO children (parent_id, display_name, username, password_hash, wallet_balance)
    VALUES (v_parent_id, 'T4Borrower', 't4borrower', crypt('pass', gen_salt('bf',4)), 200)
    RETURNING id INTO v_borrower_id;

  INSERT INTO children (parent_id, display_name, username, password_hash, wallet_balance)
    VALUES (v_parent_id, 'T4Funder', 't4funder', crypt('pass', gen_salt('bf',4)), 200)
    RETURNING id INTO v_funder_id;

  INSERT INTO money_requests (from_id, amount, repay_by_date, expires_at, status)
    VALUES (v_borrower_id, 25, CURRENT_DATE + 7, now() + interval '7d', 'pending')
    RETURNING id INTO v_req_id;

  INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (v_funder_id,
            encode(digest(v_tok_fund, 'sha256'), 'hex'),
            'device_t4', now() + interval '1h', now() + interval '30d');

  PERFORM public.fund_money_request(
    v_req_id, v_funder_id, 25::numeric, v_tok_fund, 'device_t4'
  );

  INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (v_borrower_id,
            encode(digest(v_tok_repay, 'sha256'), 'hex'),
            'device_t4b', now() + interval '1h', now() + interval '30d');

  PERFORM public.repay_money_request(
    v_req_id, v_borrower_id, v_tok_repay, 'device_t4b'
  );

  SELECT safety_pool_reserved     INTO v_reserved    FROM parents       WHERE id = v_parent_id;
  SELECT safety_pool_reservation_released_at INTO v_released_at FROM money_requests WHERE id = v_req_id;

  IF v_reserved <> 0 THEN
    RAISE EXCEPTION 'T4 FAIL: parents.safety_pool_reserved = % after repayment (expected 0)', v_reserved;
  END IF;
  IF v_released_at IS NULL THEN
    RAISE EXCEPTION 'T4 FAIL: safety_pool_reservation_released_at is NULL after repayment';
  END IF;
  RAISE NOTICE 'T4 PASS: reservation released correctly at repayment';

  -- Cleanup
  DELETE FROM activity_feed  WHERE child_id IN (SELECT id FROM children WHERE parent_id = v_parent_id);
  DELETE FROM transactions   WHERE child_id IN (SELECT id FROM children WHERE parent_id = v_parent_id);
  DELETE FROM child_sessions WHERE child_id IN (SELECT id FROM children WHERE parent_id = v_parent_id);
  DELETE FROM money_requests WHERE from_id  IN (SELECT id FROM children WHERE parent_id = v_parent_id);
  DELETE FROM children       WHERE parent_id = v_parent_id;
  DELETE FROM parents        WHERE id = v_parent_id;
  DELETE FROM auth.users     WHERE id = v_parent_id;
END $$;

-- ─── T5. process_due_loan_defaults: reserved → used, invariant preserved ──────
-- Creates a funded overdue loan and runs the processor.
-- Expects: reserved = 0, used = loan amount, status = 'defaulted',
--          reservation_released_at IS NOT NULL.

DO $$
DECLARE
  v_parent_id   uuid := gen_random_uuid();
  v_borrower_id uuid;
  v_funder_id   uuid;
  v_req_id      uuid;
  v_reserved    numeric;
  v_used        numeric;
  v_released_at timestamptz;
  v_status      text;
  v_result      json;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
    VALUES (v_parent_id, 'authenticated', 'authenticated',
            'test_t5@verify.invalid', now(), now())
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO parents (id, first_name, last_name, email, safety_pool_limit, safety_pool_reserved)
    VALUES (v_parent_id, 'Test','Parent','test_t5@verify.invalid', 100, 40);

  INSERT INTO children (parent_id, display_name, username, password_hash, wallet_balance)
    VALUES (v_parent_id, 'T5Borrower', 't5borrower', 'x', 0)
    RETURNING id INTO v_borrower_id;

  INSERT INTO children (parent_id, display_name, username, password_hash, wallet_balance)
    VALUES (v_parent_id, 'T5Funder', 't5funder', 'x', 0)
    RETURNING id INTO v_funder_id;

  -- Insert an already-funded overdue loan (bypassing fund_money_request for speed)
  INSERT INTO money_requests (from_id, funded_by, amount, repay_by_date, expires_at,
                               status, funded_at, safety_pool_reserved_amount)
    VALUES (v_borrower_id, v_funder_id, 40,
            CURRENT_DATE - 1,      -- overdue
            now() - interval '1d',
            'funded', now() - interval '2d', 40)
    RETURNING id INTO v_req_id;

  -- Run processor
  SELECT public.process_due_loan_defaults() INTO v_result;
  RAISE NOTICE 'T5 processor result: %', v_result;

  SELECT safety_pool_reserved, COALESCE(safety_pool_used, 0)
    INTO v_reserved, v_used
    FROM parents WHERE id = v_parent_id;

  SELECT safety_pool_reservation_released_at INTO v_released_at FROM money_requests WHERE id = v_req_id;
  SELECT status INTO v_status FROM money_requests WHERE id = v_req_id;

  IF v_status <> 'defaulted' THEN
    RAISE EXCEPTION 'T5 FAIL: status = % (expected defaulted)', v_status;
  END IF;
  IF v_reserved <> 0 THEN
    RAISE EXCEPTION 'T5 FAIL: safety_pool_reserved = % (expected 0)', v_reserved;
  END IF;
  IF v_used <> 40 THEN
    RAISE EXCEPTION 'T5 FAIL: safety_pool_used = % (expected 40)', v_used;
  END IF;
  IF v_released_at IS NULL THEN
    RAISE EXCEPTION 'T5 FAIL: safety_pool_reservation_released_at IS NULL';
  END IF;
  RAISE NOTICE 'T5 PASS: default processor moves reserved→used atomically';

  -- Cleanup
  DELETE FROM notification_queue WHERE child_id IN (SELECT id FROM children WHERE parent_id = v_parent_id);
  DELETE FROM activity_feed      WHERE child_id IN (SELECT id FROM children WHERE parent_id = v_parent_id);
  DELETE FROM transactions       WHERE child_id IN (SELECT id FROM children WHERE parent_id = v_parent_id);
  DELETE FROM money_requests     WHERE id = v_req_id;
  DELETE FROM children           WHERE parent_id = v_parent_id;
  DELETE FROM parents            WHERE id = v_parent_id;
  DELETE FROM auth.users         WHERE id = v_parent_id;
END $$;

-- ─── T6. fund_money_request: over-commitment rejected ─────────────────────────
-- Parent has limit=50, reserved=30, used=0 → available=20.
-- Attempts to fund a 25-loan → must fail with safety_pool_insufficient.

DO $$
DECLARE
  v_parent_id   uuid := gen_random_uuid();
  v_borrower_id uuid;
  v_funder_id   uuid;
  v_req_id      uuid;
  v_token       text;
  v_caught      boolean := false;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
    VALUES (v_parent_id, 'authenticated', 'authenticated',
            'test_t6@verify.invalid', now(), now())
    ON CONFLICT (id) DO NOTHING;

  v_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO parents (id, first_name, last_name, email, safety_pool_limit, safety_pool_reserved)
    VALUES (v_parent_id, 'Test','Parent','test_t6@verify.invalid', 50, 30);

  INSERT INTO children (parent_id, display_name, username, password_hash, wallet_balance)
    VALUES (v_parent_id, 'T6Borrower', 't6borrower', crypt('pass', gen_salt('bf',4)), 10)
    RETURNING id INTO v_borrower_id;

  INSERT INTO children (parent_id, display_name, username, password_hash, wallet_balance)
    VALUES (v_parent_id, 'T6Funder', 't6funder', crypt('pass', gen_salt('bf',4)), 500)
    RETURNING id INTO v_funder_id;

  INSERT INTO money_requests (from_id, amount, repay_by_date, expires_at, status)
    VALUES (v_borrower_id, 25, CURRENT_DATE + 7, now() + interval '7d', 'pending')
    RETURNING id INTO v_req_id;

  INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (v_funder_id,
            encode(digest(v_token, 'sha256'), 'hex'),
            'device_t6', now() + interval '1h', now() + interval '30d');

  BEGIN
    PERFORM public.fund_money_request(
      v_req_id, v_funder_id, 25::numeric, v_token, 'device_t6'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%safety_pool_insufficient%' THEN
      v_caught := true;
    ELSE
      RAISE EXCEPTION 'T6 FAIL: unexpected error: %', SQLERRM;
    END IF;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'T6 FAIL: over-commitment was not rejected';
  END IF;
  RAISE NOTICE 'T6 PASS: over-commitment correctly rejected';

  -- Cleanup
  DELETE FROM child_sessions WHERE child_id IN (SELECT id FROM children WHERE parent_id = v_parent_id);
  DELETE FROM money_requests  WHERE from_id  IN (SELECT id FROM children WHERE parent_id = v_parent_id);
  DELETE FROM children        WHERE parent_id = v_parent_id;
  DELETE FROM parents         WHERE id = v_parent_id;
  DELETE FROM auth.users      WHERE id = v_parent_id;
END $$;

-- ─── T7. DB constraint: used + reserved <= limit enforced ─────────────────────
-- Direct INSERT that violates the invariant must fail.
-- Expected: an error containing the constraint name.

DO $$
DECLARE
  v_caught boolean := false;
  v_bad_id uuid    := gen_random_uuid();
BEGIN
  -- Seed auth.users first
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
    VALUES (v_bad_id, 'authenticated', 'authenticated',
            'cv@verify.invalid', now(), now())
    ON CONFLICT (id) DO NOTHING;

  BEGIN
    INSERT INTO parents (id, first_name, last_name, email,
                         safety_pool_limit, safety_pool_used, safety_pool_reserved)
      VALUES (v_bad_id, 'Constraint', 'Violator', 'cv@verify.invalid', 10, 6, 7);
    -- 6 + 7 = 13 > 10 → should fail
  EXCEPTION WHEN check_violation THEN
    v_caught := true;
  END;

  DELETE FROM auth.users WHERE id = v_bad_id;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'T7 FAIL: constraint chk_parents_sp_invariant was not enforced';
  END IF;
  RAISE NOTICE 'T7 PASS: combined invariant constraint is enforced at DB level';
END $$;

-- ─── T8. update_safety_pool: cannot reduce limit below used + reserved ─────────
-- Parent has used=20, reserved=15; attempt to set limit=30 (< 35) must fail.

DO $$
DECLARE
  v_parent_id uuid    := gen_random_uuid();
  v_caught    boolean := false;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
    VALUES (v_parent_id, 'authenticated', 'authenticated',
            'test_t8@verify.invalid', now(), now())
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO parents (id, first_name, last_name, email,
                       safety_pool_limit, safety_pool_used, safety_pool_reserved)
    VALUES (v_parent_id, 'Test','Parent','test_t8@verify.invalid', 100, 20, 15);

  BEGIN
    PERFORM public.update_safety_pool(v_parent_id, 30::numeric);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Cannot reduce Safety Pool limit%' THEN
      v_caught := true;
    ELSE
      RAISE EXCEPTION 'T8 FAIL: unexpected error: %', SQLERRM;
    END IF;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'T8 FAIL: update_safety_pool did not reject limit reduction below used+reserved';
  END IF;
  RAISE NOTICE 'T8 PASS: update_safety_pool rejects limit reduction below used + reserved';

  DELETE FROM parents   WHERE id = v_parent_id;
  DELETE FROM auth.users WHERE id = v_parent_id;
END $$;

-- ─── T9. get_parent_safety_pool_status returns 4 columns ─────────────────────
-- Expected: pool_limit, pool_used, pool_reserved, pool_available all present.

DO $$
DECLARE
  v_parent_id    uuid    := gen_random_uuid();
  v_limit        numeric;
  v_used         numeric;
  v_reserved     numeric;
  v_available    numeric;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
    VALUES (v_parent_id, 'authenticated', 'authenticated',
            'test_t9@verify.invalid', now(), now())
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO parents (id, first_name, last_name, email,
                       safety_pool_limit, safety_pool_used, safety_pool_reserved)
    VALUES (v_parent_id, 'Test','Parent','test_t9@verify.invalid', 100, 10, 30);

  SELECT pool_limit, pool_used, pool_reserved, pool_available
    INTO v_limit, v_used, v_reserved, v_available
    FROM public.get_parent_safety_pool_status(v_parent_id);

  IF v_limit     <> 100 THEN RAISE EXCEPTION 'T9 FAIL: pool_limit = %', v_limit; END IF;
  IF v_used      <> 10  THEN RAISE EXCEPTION 'T9 FAIL: pool_used = %', v_used; END IF;
  IF v_reserved  <> 30  THEN RAISE EXCEPTION 'T9 FAIL: pool_reserved = %', v_reserved; END IF;
  IF v_available <> 60  THEN RAISE EXCEPTION 'T9 FAIL: pool_available = % (expected 60)', v_available; END IF;

  RAISE NOTICE 'T9 PASS: get_parent_safety_pool_status returns correct 4-column result';
  DELETE FROM parents    WHERE id = v_parent_id;
  DELETE FROM auth.users WHERE id = v_parent_id;
END $$;

-- ─── T10. process_due_loan_defaults: idempotency (no double-processing) ────────
-- Inserts a loan already in 'defaulted' state.
-- Expected: processor skips it, no balance changes, processed=0, skipped≥0.

DO $$
DECLARE
  v_parent_id   uuid := gen_random_uuid();
  v_borrower_id uuid;
  v_funder_id   uuid;
  v_req_id      uuid;
  v_bal_before  numeric;
  v_bal_after   numeric;
  v_result      json;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
    VALUES (v_parent_id, 'authenticated', 'authenticated',
            'test_t10@verify.invalid', now(), now())
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO parents (id, first_name, last_name, email, safety_pool_limit)
    VALUES (v_parent_id, 'Test','Parent','test_t10@verify.invalid', 50);

  INSERT INTO children (parent_id, display_name, username, password_hash, wallet_balance)
    VALUES (v_parent_id, 'T10Borrower', 't10borrower', 'x', 0)
    RETURNING id INTO v_borrower_id;

  INSERT INTO children (parent_id, display_name, username, password_hash, wallet_balance)
    VALUES (v_parent_id, 'T10Funder', 't10funder', 'x', 100)
    RETURNING id INTO v_funder_id;

  -- Insert a loan that is ALREADY defaulted (reservation already released)
  INSERT INTO money_requests (from_id, funded_by, amount, repay_by_date, expires_at,
                               status, funded_at, repaid_at,
                               safety_pool_reserved_amount,
                               safety_pool_reservation_released_at)
    VALUES (v_borrower_id, v_funder_id, 15,
            CURRENT_DATE - 5,
            now() - interval '5d',
            'defaulted', now() - interval '6d', now() - interval '5d',
            15, now() - interval '5d')
    RETURNING id INTO v_req_id;

  SELECT wallet_balance INTO v_bal_before FROM children WHERE id = v_funder_id;
  SELECT public.process_due_loan_defaults() INTO v_result;
  SELECT wallet_balance INTO v_bal_after  FROM children WHERE id = v_funder_id;

  IF v_bal_before <> v_bal_after THEN
    RAISE EXCEPTION 'T10 FAIL: already-defaulted loan was reprocessed (balance changed from % to %)',
      v_bal_before, v_bal_after;
  END IF;
  RAISE NOTICE 'T10 PASS: already-defaulted loan skipped; processor result: %', v_result;

  -- Cleanup
  DELETE FROM money_requests WHERE id = v_req_id;
  DELETE FROM children       WHERE parent_id = v_parent_id;
  DELETE FROM parents        WHERE id = v_parent_id;
  DELETE FROM auth.users     WHERE id = v_parent_id;
END $$;

-- ─── T11. Safety Pool invariant holds throughout default processing ────────────
-- Before default: used=0, reserved=50, limit=50  →  sum=50 ≤ 50 ✓
-- After  default: used=50, reserved=0, limit=50  →  sum=50 ≤ 50 ✓
-- This is verified by T5 above; this test checks DB constraint is not violated.

SELECT 'T11 note: invariant continuity verified by T5 (reserved→used keeps sum constant)'
  AS test_note;

-- ─── T12. process_due_loan_defaults access control ────────────────────────────
-- Expected: function exists, no EXECUTE to PUBLIC / anon / authenticated.

SELECT p.proname,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef                 AS security_definer,
       p.proconfig                 AS config
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  p.proname = 'process_due_loan_defaults';
-- Expected: security_definer=true, config contains search_path=""

SELECT grantee, privilege_type
FROM   information_schema.routine_privileges rp
WHERE  rp.specific_schema = 'public'
  AND  rp.routine_name    = 'process_due_loan_defaults'
ORDER  BY grantee;
-- Expected: no rows for anon or authenticated

-- ─── T13. notification_queue table access control ────────────────────────────
-- Expected: no SELECT / INSERT / UPDATE / DELETE for anon or authenticated.

SELECT grantee, privilege_type
FROM   information_schema.role_table_grants
WHERE  table_schema = 'public' AND table_name = 'notification_queue'
ORDER  BY grantee;
-- Expected: no rows for anon or authenticated

-- ─── T14. Partial index for hot path ─────────────────────────────────────────
-- Expected: 1 row

SELECT indexname, indexdef
FROM   pg_indexes
WHERE  schemaname = 'public'
  AND  indexname  = 'idx_money_requests_funded_overdue';
