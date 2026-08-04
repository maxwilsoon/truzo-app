-- Migration 037: Add child-session enforcement to all child private-data read RPCs.
-- Remove hidden write side effect from get_active_requests.
--
-- Security: Each RPC now begins with:
--   PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);
-- An invalid, expired, revoked, or missing session raises 'invalid_child_session'
-- before any data is accessed.
--
-- get_active_requests: The per-call UPDATE money_requests SET status='cancelled'
-- side effect is removed. That write path must not be triggered by read RPCs.
--
-- Grant matrix for all 11 new signatures:
--   anon, postgres, service_role — EXECUTE GRANTED
--   PUBLIC, authenticated        — REVOKED
--
-- SET search_path = public, pg_catalog on every function.
--
-- Rollback: supabase/20260804_037_rollback.sql  (fail-closed: DROPs only, old
-- UUID-only signatures are NOT restored — feature becomes temporarily unavailable).

BEGIN;

-- ─── 1. search_children ──────────────────────────────────────────────────────
-- p_exclude_id doubles as the caller's identity for session validation.
-- Callers must always supply their own childId as p_exclude_id.

DROP FUNCTION IF EXISTS public.search_children(text, uuid);

CREATE OR REPLACE FUNCTION public.search_children(
  p_query         text,
  p_exclude_id    uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_results json;
BEGIN
  PERFORM require_valid_child_session(p_exclude_id, p_session_token, p_device_id);
  SELECT json_agg(row_to_json(r)) INTO v_results
  FROM (
    SELECT id, display_name, username, avatar_emoji, avatar_url, trust_score
    FROM children
    WHERE (id != p_exclude_id OR p_exclude_id IS NULL)
      AND (
        lower(username)     LIKE '%' || lower(p_query) || '%'
        OR lower(display_name) LIKE '%' || lower(p_query) || '%'
      )
    LIMIT 20
  ) r;
  RETURN COALESCE(v_results, '[]'::json);
END;
$$;

REVOKE ALL     ON FUNCTION public.search_children(text, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_children(text, uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.search_children(text, uuid, text, text) TO anon, postgres, service_role;


-- ─── 2. get_pending_requests ─────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_pending_requests(uuid);

CREATE OR REPLACE FUNCTION public.get_pending_requests(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_results json;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);
  SELECT json_agg(row_to_json(r)) INTO v_results
  FROM (
    SELECT cr.id AS request_id, c.id, c.display_name, c.username,
           c.avatar_emoji, c.avatar_url, c.trust_score, cr.created_at
    FROM circle_requests cr
    JOIN children c ON c.id = cr.from_id
    WHERE cr.to_id = p_child_id AND cr.status = 'pending'
    ORDER BY cr.created_at DESC
  ) r;
  RETURN COALESCE(v_results, '[]'::json);
END;
$$;

REVOKE ALL     ON FUNCTION public.get_pending_requests(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pending_requests(uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_pending_requests(uuid, text, text) TO anon, postgres, service_role;


-- ─── 3. get_circle ───────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_circle(uuid);

CREATE OR REPLACE FUNCTION public.get_circle(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_results json;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);
  SELECT json_agg(row_to_json(r)) INTO v_results
  FROM (
    SELECT c.id, c.display_name, c.username, c.avatar_emoji, c.avatar_url, c.trust_score
    FROM circles ci
    JOIN children c ON c.id = ci.friend_id
    WHERE ci.child_id = p_child_id
      AND ci.status = 'active'
    ORDER BY ci.created_at DESC
  ) r;
  RETURN COALESCE(v_results, '[]'::json);
END;
$$;

REVOKE ALL     ON FUNCTION public.get_circle(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_circle(uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_circle(uuid, text, text) TO anon, postgres, service_role;


-- ─── 4. get_active_requests (hidden write removed) ──────────────────────────
-- The UPDATE money_requests SET status='cancelled' ... that ran on every poll
-- is removed. Expiry is evaluated purely in the WHERE clause (expires_at > now()).

DROP FUNCTION IF EXISTS public.get_active_requests(uuid);

CREATE OR REPLACE FUNCTION public.get_active_requests(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_results json;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  SELECT json_agg(row_to_json(r)) INTO v_results
  FROM (
    SELECT
      mr.id, mr.from_id,
      c.display_name  AS from_name,
      c.avatar_emoji  AS from_emoji,
      c.avatar_url    AS from_url,
      c.trust_score   AS from_trust,
      mr.amount, mr.reason, mr.reason_emoji, mr.deadline_days,
      TO_CHAR(mr.repay_by_date, 'DD Mon') AS repay_by_date,
      mr.expires_at, mr.status, mr.created_at,
      (mr.from_id = p_child_id) AS is_own,
      mr.funded_by,
      fc.display_name AS funded_by_name,
      fc.avatar_emoji AS funded_by_emoji,
      fc.avatar_url   AS funded_by_url
    FROM money_requests mr
    JOIN      children c  ON c.id  = mr.from_id
    LEFT JOIN children fc ON fc.id = mr.funded_by
    WHERE
      ((mr.status = 'pending' AND mr.expires_at > now()) OR mr.status = 'funded')
      AND (
        mr.from_id = p_child_id
        OR mr.funded_by = p_child_id
        OR (
          mr.status = 'pending'
          AND mr.from_id IN (SELECT friend_id FROM circles WHERE child_id = p_child_id)
          AND (mr.viewer_ids IS NULL OR p_child_id = ANY(mr.viewer_ids))
        )
      )
    ORDER BY mr.created_at DESC
  ) r;

  RETURN COALESCE(v_results, '[]'::json);
END;
$$;

REVOKE ALL     ON FUNCTION public.get_active_requests(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_active_requests(uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_active_requests(uuid, text, text) TO anon, postgres, service_role;


-- ─── 5. get_outgoing_pending_requests ────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_outgoing_pending_requests(uuid);

CREATE OR REPLACE FUNCTION public.get_outgoing_pending_requests(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_results json;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);
  SELECT json_agg(row_to_json(r)) INTO v_results
  FROM (
    SELECT cr.to_id AS id
    FROM circle_requests cr
    WHERE cr.from_id = p_child_id AND cr.status = 'pending'
  ) r;
  RETURN COALESCE(v_results, '[]'::json);
END;
$$;

REVOKE ALL     ON FUNCTION public.get_outgoing_pending_requests(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_outgoing_pending_requests(uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_outgoing_pending_requests(uuid, text, text) TO anon, postgres, service_role;


-- ─── 6. get_resolved_sent_requests ───────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_resolved_sent_requests(uuid);

CREATE OR REPLACE FUNCTION public.get_resolved_sent_requests(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_results json;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);
  SELECT json_agg(row_to_json(r)) INTO v_results
  FROM (
    SELECT cr.id AS request_id, c.id, c.display_name, c.username,
           c.avatar_emoji, cr.status, cr.created_at
    FROM circle_requests cr
    JOIN children c ON c.id = cr.to_id
    WHERE cr.from_id = p_child_id AND cr.status IN ('accepted', 'declined')
    ORDER BY cr.created_at DESC
  ) r;
  RETURN COALESCE(v_results, '[]'::json);
END;
$$;

REVOKE ALL     ON FUNCTION public.get_resolved_sent_requests(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_resolved_sent_requests(uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_resolved_sent_requests(uuid, text, text) TO anon, postgres, service_role;


-- ─── 7. get_activity_feed ────────────────────────────────────────────────────
-- p_limit moved after session params; DEFAULT 20 preserved.

DROP FUNCTION IF EXISTS public.get_activity_feed(uuid, integer);

CREATE OR REPLACE FUNCTION public.get_activity_feed(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text,
  p_limit         integer DEFAULT 20
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_result json;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);
  SELECT json_agg(row_to_json(r))
  INTO   v_result
  FROM (
    SELECT id, emoji, text, type, created_at
    FROM   activity_feed
    WHERE  child_id = p_child_id
    ORDER  BY created_at DESC
    LIMIT  p_limit
  ) r;
  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

REVOKE ALL     ON FUNCTION public.get_activity_feed(uuid, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_activity_feed(uuid, text, text, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_activity_feed(uuid, text, text, integer) TO anon, postgres, service_role;


-- ─── 8. get_child_transactions ───────────────────────────────────────────────
-- p_limit moved after session params; DEFAULT 20 preserved.

DROP FUNCTION IF EXISTS public.get_child_transactions(uuid, integer);

CREATE OR REPLACE FUNCTION public.get_child_transactions(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text,
  p_limit         integer DEFAULT 20
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_result json;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);
  SELECT json_agg(row_to_json(r)) INTO v_result
  FROM (
    SELECT id, type, amount, description, counterparty, created_at
    FROM   transactions
    WHERE  child_id = p_child_id
    ORDER  BY created_at DESC
    LIMIT  p_limit
  ) r;
  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

REVOKE ALL     ON FUNCTION public.get_child_transactions(uuid, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_child_transactions(uuid, text, text, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_child_transactions(uuid, text, text, integer) TO anon, postgres, service_role;


-- ─── 9. get_child_stats ──────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_child_stats(uuid);

CREATE OR REPLACE FUNCTION public.get_child_stats(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_result json;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);
  SELECT json_build_object(
    'wallet_balance',    wallet_balance,
    'loaned_out',        loaned_out,
    'borrowed',          borrowed,
    'trust_score',       trust_score,
    'points',            points,
    'streak',            streak,
    'repaid',            repaid,
    'missed',            missed,
    'total_borrowed',    total_borrowed,
    'total_lent',        total_lent,
    'times_borrowed',    times_borrowed,
    'times_lent',        times_lent,
    'profile_image_url', COALESCE(profile_image_url, avatar_url),
    'account_frozen',    COALESCE(account_frozen, false),
    'parent_debt',       COALESCE(parent_debt, 0)
  ) INTO v_result FROM children WHERE id = p_child_id;
  RETURN v_result;
END;
$$;

REVOKE ALL     ON FUNCTION public.get_child_stats(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_child_stats(uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_child_stats(uuid, text, text) TO anon, postgres, service_role;


-- ─── 10. get_loan_history ────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_loan_history(uuid);

CREATE OR REPLACE FUNCTION public.get_loan_history(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_result json;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);
  SELECT json_agg(row_to_json(r) ORDER BY r.repaid_at DESC NULLS LAST) INTO v_result
  FROM (
    SELECT
      mr.id, mr.amount, mr.reason, mr.reason_emoji,
      mr.created_at, mr.repaid_at, mr.repay_by_date,
      mr.status,
      (mr.from_id = p_child_id) AS is_borrower,
      (mr.repaid_at IS NOT NULL AND mr.repaid_at::date <= mr.repay_by_date AND mr.status = 'repaid') AS repaid_on_time,
      bc.display_name AS borrower_name, bc.username AS borrower_username,
      bc.avatar_emoji AS borrower_emoji, COALESCE(bc.profile_image_url, bc.avatar_url) AS borrower_avatar_url,
      fc.display_name AS funder_name,   fc.username AS funder_username,
      fc.avatar_emoji AS funder_emoji,  COALESCE(fc.profile_image_url, fc.avatar_url) AS funder_avatar_url
    FROM money_requests mr
    JOIN children bc ON bc.id = mr.from_id
    JOIN children fc ON fc.id = mr.funded_by
    WHERE mr.status IN ('repaid', 'defaulted')
      AND (mr.from_id = p_child_id OR mr.funded_by = p_child_id)
    ORDER BY mr.repaid_at DESC NULLS LAST
    LIMIT 50
  ) r;
  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

REVOKE ALL     ON FUNCTION public.get_loan_history(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_loan_history(uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_loan_history(uuid, text, text) TO anon, postgres, service_role;


-- ─── 11. get_circle_history ──────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_circle_history(uuid);

CREATE OR REPLACE FUNCTION public.get_circle_history(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_results json;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);
  SELECT json_agg(row_to_json(r)) INTO v_results
  FROM (
    SELECT
      mr.id, mr.amount, mr.reason, mr.reason_emoji, mr.created_at,
      TO_CHAR(mr.repay_by_date, 'DD Mon YYYY') AS repay_by_date,
      (mr.from_id = p_child_id) AS is_borrower,
      b.display_name AS borrower_name, b.avatar_emoji AS borrower_emoji, b.avatar_url AS borrower_url,
      f.display_name AS funder_name,   f.avatar_emoji AS funder_emoji,   f.avatar_url AS funder_url
    FROM money_requests mr
    JOIN children b ON b.id = mr.from_id
    JOIN children f ON f.id = mr.funded_by
    WHERE mr.status = 'repaid'
      AND (mr.from_id = p_child_id OR mr.funded_by = p_child_id)
    ORDER BY mr.created_at DESC
    LIMIT 50
  ) r;
  RETURN COALESCE(v_results, '[]'::json);
END;
$$;

REVOKE ALL     ON FUNCTION public.get_circle_history(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_circle_history(uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_circle_history(uuid, text, text) TO anon, postgres, service_role;


NOTIFY pgrst, 'reload schema';

COMMIT;
