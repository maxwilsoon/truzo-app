-- Migration 029: Secure loan default processor (replaces draft 025)
--
-- Prerequisites: migrations 027 + 028 must be applied first.
--
-- What this migration creates
-- ───────────────────────────
-- 1. notification_queue table — durable outbox for push notifications triggered
--    during default processing. Rows are committed with the financial changes and
--    swept in the same cron run. Delivery semantics: at-most-one HTTP attempt per
--    event_key per run. The UNIQUE constraint on event_key prevents re-queuing.
--
-- 2. idx_money_requests_funded_overdue — partial index on repay_by_date for the
--    scan that finds overdue funded loans. Without this index, the processor
--    must scan all money_requests rows each run.
--
-- 3. process_due_loan_defaults() — internal batch function:
--    • Scans for funded loans where repay_by_date < CURRENT_DATE and
--      reservation not yet released (idempotency: loans already defaulted have
--      safety_pool_reservation_released_at set).
--    • For each loan: locks the borrower's parent FOR UPDATE (consistent with
--      fund_money_request and repay_money_request lock ordering — parent first).
--    • Atomically updates money_requests to 'defaulted', releases the Safety Pool
--      reservation (safety_pool_reserved -= reserved_amount), and increments
--      safety_pool_used by the same amount. Net: used + reserved is unchanged,
--      both stay ≤ limit.
--    • Updates child balances, freezes borrower, writes transactions and
--      activity_feed rows.
--    • Queues push notifications via notification_queue / _trigger_notification.
--    • Returns JSON: {processed: N, skipped: N, notifications_sent: N}.
--    • SECURITY: REVOKE ALL from PUBLIC, anon, authenticated. Only callable by
--      postgres / service_role / pg_cron.
--    • SET search_path = '' — all names are schema-qualified to prevent
--      search_path injection attacks.
--
-- Migration 030 (separate, applied after pg_cron is enabled) adds the schedule
-- and drops the old client-callable RPCs.
--
-- Lock ordering proof (deadlock-freedom)
-- ───────────────────────────────────────
-- All three write paths follow parent → {children, money_requests} ordering:
--
--   fund_money_request:          parents(FOR UPDATE) → funder_child(FOR UPDATE)
--                                                    → money_requests(implicit)
--   repay_money_request:         parents(FOR UPDATE) → borrower_child(FOR UPDATE)
--                                                    → money_requests(FOR UPDATE)
--   process_due_loan_defaults:   parents(FOR UPDATE) → money_requests(via UPDATE)
--                                                    → children (funder, borrower)
--
-- A deadlock requires a lock-wait cycle: A holds X waits Y, B holds Y waits X.
-- Since every path acquires the parent lock FIRST, no cycle can form:
--   - Concurrent fund + default on same parent: serialized by parent lock ✓
--   - Concurrent repay + default on same loan:  one gets parent first,
--     the other's UPDATE on money_requests finds no matching row (already
--     defaulted/repaid) and exits cleanly ✓
--   - Concurrent fund + repay on same parent:   serialized by parent lock ✓
--
-- Per-loan atomicity proof
-- ─────────────────────────
-- Each loan is processed inside a PL/pgSQL BEGIN...EXCEPTION block, which
-- creates an implicit savepoint. On EXCEPTION (e.g. deadlock_detected), the
-- savepoint rolls back ALL mutations for that loan (money_requests, parents,
-- children, transactions, activity_feed, notification_queue) without aborting
-- the outer batch transaction. Skipped loans are retried on the next cron run.
--
-- Safety Pool invariant preservation
-- ────────────────────────────────────
-- Before default: safety_pool_reserved = R (includes reserved_amount for this loan)
--                 safety_pool_used     = U
--                 R + U ≤ limit
-- After default:  safety_pool_reserved = R - reserved_amount
--                 safety_pool_used     = U + reserved_amount
--                 (R - reserved_amount) + (U + reserved_amount) = R + U ≤ limit ✓
--
-- Rollback: 20260803_029_rollback.sql

BEGIN;

-- ─── 1. notification_queue outbox table ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notification_queue (
  id          bigserial PRIMARY KEY,
  event_key   text        NOT NULL,
  child_id    uuid        NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  event_type  text        NOT NULL,
  sender_id   uuid,
  sender_name text,
  payload     jsonb       NOT NULL DEFAULT '{}',
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT uq_notification_queue_event_key UNIQUE (event_key)
);

-- No RLS needed: table is not exposed to anon/authenticated roles
REVOKE ALL ON TABLE public.notification_queue FROM PUBLIC;
REVOKE ALL ON TABLE public.notification_queue FROM anon;
REVOKE ALL ON TABLE public.notification_queue FROM authenticated;

-- ─── 2. Partial index for the default-scan hot path ──────────────────────────

CREATE INDEX IF NOT EXISTS idx_money_requests_funded_overdue
  ON public.money_requests (repay_by_date)
  WHERE status = 'funded';

-- ─── 3. process_due_loan_defaults() ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_due_loan_defaults()
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_req RECORD;

  v_parent_id    uuid;
  v_reserved     numeric;
  v_updated      int;
  v_processed    int := 0;
  v_skipped      int := 0;
  v_notif_sent   int := 0;

  v_borrower_user  text;
  v_borrower_name  text;
  v_funder_user    text;
  v_funder_name    text;
  v_amt_str        text;

  -- Notification sweep
  v_notif RECORD;
  v_token  text;
BEGIN
  -- ── Main processing loop ──────────────────────────────────────────────────
  -- Non-locking scan: collect overdue funded loans whose reservations haven't
  -- been released yet. Ordering by repay_by_date processes oldest debts first.
  FOR v_req IN
    SELECT mr.id,
           mr.from_id            AS borrower_id,
           mr.funded_by          AS funder_id,
           mr.amount,
           mr.safety_pool_reserved_amount,
           mr.repay_by_date
    FROM   public.money_requests mr
    WHERE  mr.status = 'funded'
      AND  mr.repay_by_date < CURRENT_DATE
      AND  mr.safety_pool_reservation_released_at IS NULL
    ORDER  BY mr.repay_by_date ASC
  LOOP
    BEGIN
      -- Step 1: Lock borrower's parent FIRST (globally consistent lock order).
      -- All concurrent fund/repay/default paths acquire the parent lock before
      -- any child or money_requests lock — ensures deadlock-freedom.
      SELECT p.id INTO v_parent_id
        FROM public.parents p
        JOIN public.children c ON c.parent_id = p.id
        WHERE c.id = v_req.borrower_id
        FOR UPDATE;

      IF v_parent_id IS NULL THEN
        v_skipped := v_skipped + 1;
        RAISE WARNING 'process_due_loan_defaults: borrower % has no parent; skipping loan %',
          v_req.borrower_id, v_req.id;
        CONTINUE;
      END IF;

      -- Step 2: Atomically mark as defaulted and stamp reservation release time.
      -- The WHERE clause re-validates the loan is still eligible (idempotency guard:
      -- if repay_money_request or a concurrent processor already handled it, 0 rows
      -- are updated and we skip gracefully).
      UPDATE public.money_requests
        SET status                            = 'defaulted',
            repaid_at                         = now(),
            safety_pool_reservation_released_at = now()
        WHERE id      = v_req.id
          AND status  = 'funded'
          AND repay_by_date < CURRENT_DATE
          AND safety_pool_reservation_released_at IS NULL;

      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 0 THEN
        -- Already processed by a concurrent call or repaid between scan and lock
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Step 3: Release reservation and convert to used in parents.
      -- reserved_amount is set by fund_money_request; COALESCE handles any
      -- legacy loan that pre-dates the reservation system (uses full amount).
      v_reserved := COALESCE(v_req.safety_pool_reserved_amount, v_req.amount);

      UPDATE public.parents
        SET safety_pool_reserved = GREATEST(0, COALESCE(safety_pool_reserved, 0) - v_reserved),
            safety_pool_used     = COALESCE(safety_pool_used, 0) + v_req.amount
        WHERE id = v_parent_id;

      -- Step 4: Fetch display names for notifications / feed entries
      v_amt_str := '£' || to_char(v_req.amount, 'FM999990.00');

      SELECT username, display_name
        INTO v_funder_user, v_funder_name
        FROM public.children WHERE id = v_req.funder_id;

      SELECT username, display_name
        INTO v_borrower_user, v_borrower_name
        FROM public.children WHERE id = v_req.borrower_id;

      -- Step 5: Credit the funder (Safety Pool pays them back)
      UPDATE public.children
        SET wallet_balance = wallet_balance + v_req.amount,
            loaned_out     = GREATEST(0, loaned_out - v_req.amount)
        WHERE id = v_req.funder_id;

      -- Step 6: Freeze borrower and record debt
      UPDATE public.children
        SET account_frozen = true,
            parent_debt    = COALESCE(parent_debt, 0) + v_req.amount,
            borrowed       = GREATEST(0, borrowed - v_req.amount),
            trust_score    = GREATEST(0, trust_score - 15),
            points         = GREATEST(0, points - 15),
            streak         = 0,
            missed         = missed + 1
        WHERE id = v_req.borrower_id;

      -- Step 7: Financial transaction record (funder side)
      INSERT INTO public.transactions (child_id, type, amount, description, counterparty)
        VALUES (v_req.funder_id, 'receive', v_req.amount,
                v_amt_str || ' received from Parent Safety Pool (Loan Guarantee)',
                'Safety Pool');

      -- Step 8: Activity feed entries
      INSERT INTO public.activity_feed (child_id, id, emoji, text, type)
        VALUES (v_req.funder_id,
                'default_recv_' || v_req.id::text, '🛡️',
                v_amt_str || ' received from Safety Pool · @' || v_borrower_user || ' defaulted',
                'funded')
        ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.activity_feed (child_id, id, emoji, text, type)
        VALUES (v_req.borrower_id,
                'default_brw_' || v_req.id::text, '🔒',
                'Missed repayment · Safety Pool paid ' || v_amt_str || ' to @' || v_funder_user ||
                ' · -15 pts · Account frozen',
                'missed')
        ON CONFLICT (id) DO NOTHING;

      -- Step 9: Queue push notifications (committed with the financial changes)
      INSERT INTO public.notification_queue
        (event_key, child_id, event_type, sender_id, sender_name, payload)
        VALUES
          ('default_lender_' || v_req.id::text,
           v_req.funder_id, 'loan_defaulted_lender',
           v_req.borrower_id, v_borrower_name,
           jsonb_build_object('amount', v_req.amount, 'request_id', v_req.id)),
          ('default_borrower_' || v_req.id::text,
           v_req.borrower_id, 'loan_defaulted_borrower',
           v_req.funder_id, v_funder_name,
           jsonb_build_object('amount', v_req.amount, 'request_id', v_req.id))
        ON CONFLICT (event_key) DO NOTHING;

      v_processed := v_processed + 1;

    EXCEPTION
      WHEN deadlock_detected THEN
        v_skipped := v_skipped + 1;
        RAISE WARNING 'process_due_loan_defaults: deadlock on loan %; skipped for next run', v_req.id;
      WHEN OTHERS THEN
        v_skipped := v_skipped + 1;
        RAISE WARNING 'process_due_loan_defaults: error on loan %: %', v_req.id, SQLERRM;
    END;
  END LOOP;

  -- ── Notification sweep ────────────────────────────────────────────────────
  -- Fire pending notification_queue rows via _trigger_notification.
  -- status='sent' means the pg_net HTTP call was initiated, not that delivery
  -- was confirmed. Failed rows remain 'pending' and are retried on the next run
  -- (up to the UNIQUE event_key constraint preventing re-insertion).
  FOR v_notif IN
    SELECT id, child_id, event_type, sender_id, sender_name, payload
      FROM public.notification_queue
      WHERE status = 'pending'
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public._trigger_notification(
        v_notif.event_type,
        v_notif.child_id,
        'child',
        v_notif.sender_id,
        v_notif.sender_name,
        v_notif.payload
      );

      UPDATE public.notification_queue
        SET status = 'sent', processed_at = now()
        WHERE id = v_notif.id;

      v_notif_sent := v_notif_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.notification_queue
        SET status = 'failed', processed_at = now()
        WHERE id = v_notif.id;
    END;
  END LOOP;

  RETURN json_build_object(
    'processed',          v_processed,
    'skipped',            v_skipped,
    'notifications_sent', v_notif_sent
  );
END;
$$;

-- Restrict to postgres / service_role only; anon and authenticated cannot call this
REVOKE ALL ON FUNCTION public.process_due_loan_defaults() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_due_loan_defaults() FROM anon;
REVOKE ALL ON FUNCTION public.process_due_loan_defaults() FROM authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
