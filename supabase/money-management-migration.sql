-- Truzo money management migration
-- Adds allowance persistence columns and atomic safety-pool top-up RPC

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS allowance_frequency    TEXT    DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS allowance_next_payment DATE,
  ADD COLUMN IF NOT EXISTS allowance_active       BOOLEAN DEFAULT false;

-- Atomic safety-pool top-up: increments safety_pool_limit, returns new total
CREATE OR REPLACE FUNCTION top_up_safety_pool(p_parent_id UUID, p_amount NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new_limit NUMERIC;
BEGIN
  UPDATE parents
    SET safety_pool_limit = COALESCE(safety_pool_limit, 0) + p_amount
  WHERE id = p_parent_id
  RETURNING safety_pool_limit INTO v_new_limit;
  RETURN v_new_limit;
END; $$;
