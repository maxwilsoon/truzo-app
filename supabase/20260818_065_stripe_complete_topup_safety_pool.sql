-- M065 — extend stripe_complete_topup to handle safety_pool purpose
--
-- Previously only credited children.wallet_balance.
-- Now checks stripe_topups.purpose and either credits the child's wallet
-- (child_wallet) or increments the parent's safety_pool_limit (safety_pool).

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

  SELECT *
    INTO v_topup
    FROM stripe_topups
   WHERE stripe_payment_intent_id = p_payment_intent_id
     AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

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

  v_amount_gbp := v_topup.amount / 100.0;
  v_amount_str := CASE
    WHEN v_amount_gbp = floor(v_amount_gbp)
      THEN floor(v_amount_gbp)::integer::text
    ELSE round(v_amount_gbp, 2)::text
  END;

  IF v_topup.purpose = 'safety_pool' THEN
    -- Credit the parent's Safety Pool
    UPDATE parents
       SET safety_pool_limit = COALESCE(safety_pool_limit, 0) + v_amount_gbp
     WHERE id = v_topup.parent_id;

  ELSE
    -- Default: credit the child's wallet (purpose = 'child_wallet')
    IF NOT EXISTS (SELECT 1 FROM children WHERE id = v_topup.child_id) THEN
      RAISE EXCEPTION 'stripe_complete_topup: child % not found', v_topup.child_id;
    END IF;

    UPDATE children
       SET wallet_balance = wallet_balance + v_amount_gbp
     WHERE id = v_topup.child_id;

    INSERT INTO transactions (child_id, type, amount, description, counterparty)
    VALUES (
      v_topup.child_id,
      'parent_transfer',
      v_amount_gbp,
      v_parent_name || ' topped you up £' || v_amount_str,
      v_parent_name
    );

    INSERT INTO activity_feed (child_id, id, emoji, text, type)
    VALUES (
      v_topup.child_id,
      'act_stripe_' || p_payment_intent_id,
      '💚',
      v_parent_name || ' topped you up £' || v_amount_str,
      'topup'
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  UPDATE stripe_topups
     SET status       = 'completed',
         completed_at = now()
   WHERE id = v_topup.id;

END;
$$;

REVOKE ALL     ON FUNCTION public.stripe_complete_topup(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stripe_complete_topup(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.stripe_complete_topup(text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.stripe_complete_topup(text) TO service_role;
