-- Parent transfer migration
-- 1. Ensure 'parent_transfer' is an allowed type in the transactions table
-- 2. Update parent_send_to_child to use friendly description and new type

-- Relax or extend the type CHECK CONSTRAINT if one exists
DO $$
DECLARE
  v_con text;
BEGIN
  SELECT constraint_name INTO v_con
  FROM information_schema.table_constraints tc
  JOIN information_schema.check_constraints cc USING (constraint_name)
  WHERE tc.table_name = 'transactions'
    AND tc.constraint_type = 'CHECK'
    AND cc.check_clause ILIKE '%type%'
  LIMIT 1;

  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT %I', v_con);
    ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
      CHECK (type IN ('borrow','lend','repay','receive','topup','spend','allowance','parent_transfer'));
  END IF;
END $$;

-- Update the RPC to use the friendly display-name description and new type
CREATE OR REPLACE FUNCTION parent_send_to_child(
  p_user_id    uuid,
  p_child_id   uuid,
  p_amount     numeric,
  p_parent_name text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tx_id      text := 'ps_' || floor(extract(epoch from now()))::bigint;
  v_amount_str text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM children WHERE id = p_child_id AND parent_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'not_parent';
  END IF;

  -- Format amount: no trailing zeros for whole numbers
  v_amount_str := CASE
    WHEN p_amount = floor(p_amount) THEN floor(p_amount)::integer::text
    ELSE round(p_amount, 2)::text
  END;

  UPDATE children
    SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_child_id;

  INSERT INTO transactions (child_id, type, amount, description, counterparty)
    VALUES (
      p_child_id,
      'parent_transfer',
      p_amount,
      p_parent_name || ' sent you £' || v_amount_str,
      p_parent_name
    );

  INSERT INTO activity_feed (child_id, id, emoji, text, type)
    VALUES (
      p_child_id,
      'act_' || v_tx_id,
      '💚',
      p_parent_name || ' sent you £' || v_amount_str,
      'topup'
    );
END; $$;
