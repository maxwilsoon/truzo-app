-- M063 — stripe_complete_topup
--
-- Atomically credits a child's wallet after a Stripe PaymentIntent is confirmed.
-- Called server-side only by the Stripe webhook Edge Function using the
-- service_role key. Never called by the Expo app or any authenticated client.
--
-- Idempotency: the FOR UPDATE lock on stripe_topups WHERE status = 'pending'
-- guarantees the credit runs exactly once. A second call for the same
-- payment_intent_id finds no pending row and returns immediately.

CREATE OR REPLACE FUNCTION public.stripe_complete_topup(
  p_payment_intent_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_topup       record;
  v_parent_name text;
  v_amount_gbp  numeric;
  v_amount_str  text;
BEGIN

  -- ── 1. Lock the pending stripe_topups row ─────────────────────────────────
  --
  -- FOR UPDATE acquires a row-level lock so concurrent webhook retries queue
  -- behind this call rather than racing. If the row is not found (already
  -- completed, cancelled, or never created) return immediately — nothing to do.
  SELECT *
    INTO v_topup
    FROM stripe_topups
   WHERE stripe_payment_intent_id = p_payment_intent_id
     AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- ── 2. Verify the child still exists ──────────────────────────────────────
  --
  -- Raises an exception so the transaction rolls back entirely if the account
  -- was deleted between PaymentIntent creation and webhook delivery.
  IF NOT EXISTS (
    SELECT 1 FROM children WHERE id = v_topup.child_id
  ) THEN
    RAISE EXCEPTION 'stripe_complete_topup: child % not found', v_topup.child_id;
  END IF;

  -- ── 3. Resolve parent display name ────────────────────────────────────────
  --
  -- display_name and first_name are both nullable; fall back through the chain
  -- in the same order the app uses.
  SELECT COALESCE(
           NULLIF(TRIM(display_name), ''),
           NULLIF(TRIM(first_name),   ''),
           'Your parent'
         )
    INTO v_parent_name
    FROM parents
   WHERE id = v_topup.parent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stripe_complete_topup: parent % not found', v_topup.parent_id;
  END IF;

  -- ── 4. Convert pence → pounds ─────────────────────────────────────────────
  --
  -- stripe_topups.amount is stored in pence (integer).
  -- children.wallet_balance and transactions.amount are in pounds (numeric).
  v_amount_gbp := v_topup.amount / 100.0;

  -- Format: whole pounds as integer ("10"), fractional as 2 dp ("10.50").
  -- Matches the formatting used throughout the existing financial RPCs.
  v_amount_str := CASE
    WHEN v_amount_gbp = floor(v_amount_gbp)
      THEN floor(v_amount_gbp)::integer::text
    ELSE round(v_amount_gbp, 2)::text
  END;

  -- ── 5. Credit the child's wallet ──────────────────────────────────────────
  UPDATE children
     SET wallet_balance = wallet_balance + v_amount_gbp
   WHERE id = v_topup.child_id;

  -- ── 6. Ledger entry ───────────────────────────────────────────────────────
  INSERT INTO transactions (child_id, type, amount, description, counterparty)
  VALUES (
    v_topup.child_id,
    'parent_transfer',
    v_amount_gbp,
    v_parent_name || ' topped you up £' || v_amount_str,
    v_parent_name
  );

  -- ── 7. Activity feed entry ────────────────────────────────────────────────
  --
  -- id is derived deterministically from p_payment_intent_id, so
  -- ON CONFLICT (id) DO NOTHING makes this insert safe under concurrent retries
  -- even after the FOR UPDATE lock is released.
  INSERT INTO activity_feed (child_id, id, emoji, text, type)
  VALUES (
    v_topup.child_id,
    'act_stripe_' || p_payment_intent_id,
    '💚',
    v_parent_name || ' topped you up £' || v_amount_str,
    'topup'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── 8. Mark the top-up complete ───────────────────────────────────────────
  UPDATE stripe_topups
     SET status       = 'completed',
         completed_at = now()
   WHERE id = v_topup.id;

END;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────
--
-- Callable only by the service_role (the Stripe webhook Edge Function).
-- Explicitly revoked from PUBLIC, anon, and authenticated so no client
-- can invoke this directly.
REVOKE ALL     ON FUNCTION public.stripe_complete_topup(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stripe_complete_topup(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.stripe_complete_topup(text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.stripe_complete_topup(text) TO service_role;
