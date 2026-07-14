-- Migration 004: Fix create_money_request parameter mismatch and add caller auth check
--
-- Problem: The live function requires 6 params with NO DEFAULTS, but the frontend
--          sends only 4 (p_from_id, p_amount, p_deadline_days, p_viewer_ids).
--          PostgREST cannot resolve the function and returns:
--          "Could not find the function public.create_money_request
--           (p_amount, p_deadline_days, p_from_id, p_viewer_ids) in the schema cache"
--
-- Fix 1: Add DEFAULT '' to p_reason and DEFAULT '💸' to p_reason_emoji so that
--        the 4-param RPC call resolves correctly.
--        (The frontend is also updated to send all 6 params explicitly as belt-and-
--        suspenders, but this change protects against any future frontend regression.)
-- Fix 2: Add DEFAULT NULL to p_viewer_ids (table column already allows NULL).
-- Fix 3: Add caller-authorization check — auth.uid() must be the parent of p_from_id.
--        This ensures a parent cannot create a money request on behalf of another
--        family's child even if they know the child UUID.
--
-- All existing validations are preserved unchanged:
--   - account_frozen check (from original)
--   - already_borrowing guard (added in migration 003)
--   - amount_exceeds_limit check (from original)

DROP FUNCTION IF EXISTS public.create_money_request(uuid, numeric, integer, text, text, uuid[]);

CREATE FUNCTION public.create_money_request(
  p_from_id       uuid,
  p_amount        numeric,
  p_deadline_days integer,
  p_reason        text    DEFAULT '',
  p_reason_emoji  text    DEFAULT '💸',
  p_viewer_ids    uuid[]  DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req_id     uuid;
  v_tokens     json;
  v_trust      int;
  v_max_borrow numeric;
  v_frozen     boolean;
BEGIN
  -- Verify the authenticated parent owns the child for whom the request is made.
  -- auth.uid() is the parent's Supabase Auth UUID; children have no Auth account.
  IF NOT EXISTS (
    SELECT 1 FROM children WHERE id = p_from_id AND parent_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT trust_score, COALESCE(account_frozen, false)
    INTO v_trust, v_frozen
    FROM children WHERE id = p_from_id;

  IF v_frozen THEN RAISE EXCEPTION 'account_frozen'; END IF;

  -- Guard: block if this child already has an active pending or funded borrow request.
  -- Only the borrower role (from_id) is checked; lending does not block borrowing.
  IF EXISTS (
    SELECT 1 FROM money_requests
    WHERE from_id = p_from_id
      AND status  IN ('pending', 'funded')
  ) THEN
    RAISE EXCEPTION 'already_borrowing';
  END IF;

  v_max_borrow := CASE
    WHEN v_trust < 50 THEN 20
    WHEN v_trust < 70 THEN 30
    WHEN v_trust < 85 THEN 50
    ELSE 100
  END;

  IF p_amount > v_max_borrow THEN
    RAISE EXCEPTION 'amount_exceeds_limit:%', v_max_borrow;
  END IF;

  INSERT INTO money_requests
    (from_id, amount, reason, reason_emoji, deadline_days, repay_by_date, expires_at, viewer_ids)
  VALUES (
    p_from_id, p_amount, p_reason, p_reason_emoji, p_deadline_days,
    (now() + (p_deadline_days || ' days'::text)::interval)::date,
    now() + interval '24 hours',
    p_viewer_ids
  ) RETURNING id INTO v_req_id;

  PERFORM _update_weekly_streak(p_from_id);

  SELECT json_agg(c.push_token) INTO v_tokens
  FROM circles ci
  JOIN children c ON c.id = ci.friend_id
  WHERE ci.child_id = p_from_id
    AND c.push_token IS NOT NULL
    AND (p_viewer_ids IS NULL OR ci.friend_id = ANY(p_viewer_ids));

  RETURN json_build_object(
    'request_id', v_req_id,
    'push_tokens', COALESCE(v_tokens, '[]'::json)
  );
END;
$$;

-- Force PostgREST to reload its schema cache immediately
NOTIFY pgrst, 'reload schema';
