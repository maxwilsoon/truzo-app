-- M059: Broadcast missed-payment events to the borrower's entire circle
--
-- Previously only the funder and the borrower got activity_feed entries on
-- a loan default. This migration rewrites process_due_loan_defaults() to
-- also write a feed entry for every active circle member of the borrower so
-- the missed payment appears in their feeds like a social event.
--
-- Circle broadcast text: "@Maya missed their £10 repayment — -15 pts"
--
-- The funder keeps their existing richer entry (🛡️ Safety Pool payout) and
-- is excluded from the circle broadcast to avoid a duplicate.
--
-- Lender account credits (already present, confirmed correct):
--   Step 5: wallet_balance += amount, loaned_out -= amount
--   Step 7: +amount 'receive' transaction written for funder
-- These are unchanged — included in the full rewrite for completeness.

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

  -- Scalar copies of v_req fields — needed for INSERT...SELECT where PL/pgSQL
  -- record variables are not accessible (parsed as SQL table references).
  v_loan_id      uuid;
  v_borrower_id  uuid;
  v_funder_id    uuid;

  -- Notification sweep
  v_notif RECORD;
BEGIN
  FOR v_req IN
    SELECT mr.id,
           mr.from_id                    AS borrower_id,
           mr.funded_by                  AS funder_id,
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
      -- Step 1: Lock borrower's parent first (consistent lock order → deadlock-free)
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

      -- Step 2: Atomically mark defaulted (idempotency guard)
      UPDATE public.money_requests
        SET status                              = 'defaulted',
            repaid_at                           = now(),
            safety_pool_reservation_released_at = now()
        WHERE id      = v_req.id
          AND status  = 'funded'
          AND repay_by_date < CURRENT_DATE
          AND safety_pool_reservation_released_at IS NULL;

      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 0 THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Scalar copies used in INSERT...SELECT (record fields not in scope there)
      v_loan_id     := v_req.id;
      v_borrower_id := v_req.borrower_id;
      v_funder_id   := v_req.funder_id;

      -- Step 3: Release Safety Pool reservation; convert to used
      v_reserved := COALESCE(v_req.safety_pool_reserved_amount, v_req.amount);

      UPDATE public.parents
        SET safety_pool_reserved = GREATEST(0, COALESCE(safety_pool_reserved, 0) - v_reserved),
            safety_pool_used     = COALESCE(safety_pool_used, 0) + v_req.amount
        WHERE id = v_parent_id;

      -- Step 4: Display names for feed / notification copy
      v_amt_str := '£' || to_char(v_req.amount, 'FM999990.00');

      SELECT username, display_name
        INTO v_funder_user, v_funder_name
        FROM public.children WHERE id = v_req.funder_id;

      SELECT username, display_name
        INTO v_borrower_user, v_borrower_name
        FROM public.children WHERE id = v_req.borrower_id;

      -- Step 5: Credit lender — Safety Pool pays them back
      UPDATE public.children
        SET wallet_balance = wallet_balance + v_req.amount,
            loaned_out     = GREATEST(0, loaned_out - v_req.amount)
        WHERE id = v_req.funder_id;

      -- Step 6: Freeze borrower; record debt and trust penalty
      UPDATE public.children
        SET account_frozen = true,
            parent_debt    = COALESCE(parent_debt, 0) + v_req.amount,
            borrowed       = GREATEST(0, borrowed - v_req.amount),
            trust_score    = GREATEST(0, trust_score - 15),
            points         = GREATEST(0, points - 15),
            streak         = 0,
            missed         = missed + 1
        WHERE id = v_req.borrower_id;

      -- Step 7: Transaction record for lender (+amount, visible in wallet)
      INSERT INTO public.transactions (child_id, type, amount, description, counterparty)
        VALUES (v_req.funder_id, 'receive', v_req.amount,
                v_amt_str || ' received from Parent Safety Pool (Loan Guarantee)',
                'Safety Pool');

      -- Step 8a: Activity feed — funder (rich Safety Pool payout entry)
      INSERT INTO public.activity_feed (child_id, id, emoji, text, type)
        VALUES (v_req.funder_id,
                'default_recv_' || v_req.id::text, '🛡️',
                v_amt_str || ' received from Safety Pool · @' || v_borrower_user || ' defaulted',
                'funded')
        ON CONFLICT (id) DO NOTHING;

      -- Step 8b: Activity feed — borrower
      INSERT INTO public.activity_feed (child_id, id, emoji, text, type)
        VALUES (v_req.borrower_id,
                'default_brw_' || v_req.id::text, '🔒',
                'Missed repayment · Safety Pool paid ' || v_amt_str || ' to @' || v_funder_user ||
                ' · -15 pts · Account frozen',
                'missed')
        ON CONFLICT (id) DO NOTHING;

      -- Step 8c: Activity feed — all of the borrower's circle members (social broadcast)
      -- Each circle member sees "@Maya missed their £10 repayment — -15 pts"
      -- The funder is excluded (they already have the richer 8a entry above).
      INSERT INTO public.activity_feed (child_id, id, emoji, text, type)
        SELECT c.child_id,
               'default_circle_' || v_loan_id::text || '_' || c.child_id::text,
               '⚠️',
               '@' || v_borrower_user || ' missed their ' || v_amt_str ||
               ' repayment — -15 pts',
               'missed'
        FROM   public.circles c
        WHERE  c.friend_id = v_borrower_id
          AND  c.status    = 'active'
          AND  c.child_id <> v_funder_id
        ON CONFLICT (id) DO NOTHING;

      -- Step 9: Queue push notifications
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

  -- Notification sweep — fire pending queue rows via _trigger_notification
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

REVOKE ALL ON FUNCTION public.process_due_loan_defaults() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_due_loan_defaults() FROM anon;
REVOKE ALL ON FUNCTION public.process_due_loan_defaults() FROM authenticated;

NOTIFY pgrst, 'reload schema';
