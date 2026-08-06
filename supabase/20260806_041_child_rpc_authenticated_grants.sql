-- M041: Grant authenticated EXECUTE on all client-callable child RPCs
--
-- Root cause: the security migrations (M036-M040) enforced Supabase Auth sessions for
-- parent RPCs and added 'authenticated' grants to those parent functions.  However,
-- child-facing RPCs (which use their own require_valid_child_session guard instead of
-- auth.uid()) were only ever granted to 'anon'.
--
-- When a parent logs in via email/password, supabase-js stores a JWT in its in-memory
-- GoTrueClient storage.  That JWT persists until supabase.auth.signOut() is called.
-- If the child logs in next (via login_child, which returns a custom session_token —
-- NOT a Supabase Auth JWT), the supabase-js client still sends
--   Authorization: Bearer <parent-jwt>
-- for every subsequent RPC call.  PostgREST evaluates the JWT, identifies the caller
-- as 'authenticated', and rejects every child RPC with:
--   42501 permission denied for function <name>
--
-- Fix: grant EXECUTE to 'authenticated' on all client-callable child RPCs.
-- These functions are secured by require_valid_child_session (or equivalent internal
-- logic); the Supabase role is irrelevant to their access control.
-- We do NOT revoke the existing 'anon' grant — anon is needed for cold-start flows
-- (app restart with no parent session).
-- We do NOT add auth.uid() checks — child functions must remain callable regardless
-- of which Supabase role the caller presents.

-- Child session management
GRANT EXECUTE ON FUNCTION public.revoke_child_session(p_session_token text)            TO authenticated;

-- Search
GRANT EXECUTE ON FUNCTION public.search_children(p_query text, p_exclude_id uuid, p_session_token text, p_device_id text) TO authenticated;

-- Circle / friend management
GRANT EXECUTE ON FUNCTION public.get_circle(p_child_id uuid, p_session_token text, p_device_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_circle_history(p_child_id uuid, p_session_token text, p_device_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_outgoing_pending_requests(p_child_id uuid, p_session_token text, p_device_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_requests(p_child_id uuid, p_session_token text, p_device_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_circle_request(p_from_id uuid, p_to_id uuid, p_session_token text, p_device_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_circle_request(p_request_id uuid, p_acting_child_id uuid, p_session_token text, p_device_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_circle_request(p_from_id uuid, p_to_id uuid, p_session_token text, p_device_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_circle_request(p_request_id uuid, p_acting_child_id uuid, p_session_token text, p_device_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_from_circle(p_child_id uuid, p_friend_id uuid, p_session_token text, p_device_id text) TO authenticated;

-- Money requests
GRANT EXECUTE ON FUNCTION public.get_active_requests(p_child_id uuid, p_session_token text, p_device_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_resolved_sent_requests(p_child_id uuid, p_session_token text, p_device_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_money_request(p_from_id uuid, p_amount numeric, p_deadline_days integer, p_session_token text, p_device_id text, p_reason text, p_reason_emoji text, p_viewer_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_money_request(p_request_id uuid, p_child_id uuid, p_session_token text, p_device_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fund_money_request(p_request_id uuid, p_funder_id uuid, p_amount numeric, p_session_token text, p_device_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repay_money_request(p_request_id uuid, p_borrower_id uuid, p_session_token text, p_device_id text) TO authenticated;

-- Child data reads
GRANT EXECUTE ON FUNCTION public.get_child_stats(p_child_id uuid, p_session_token text, p_device_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_child_transactions(p_child_id uuid, p_session_token text, p_device_id text, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_activity_feed(p_child_id uuid, p_session_token text, p_device_id text, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_loan_history(p_child_id uuid, p_session_token text, p_device_id text) TO authenticated;

-- Biometrics
GRANT EXECUTE ON FUNCTION public.enable_biometric(p_child_id uuid, p_device_id text, p_biometric_token_hash text, p_session_token text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disable_biometric(p_child_id uuid, p_session_token text, p_device_id text) TO authenticated;

-- Push token registration / deregistration
GRANT EXECUTE ON FUNCTION public.register_child_device_token(p_child_id uuid, p_session_token text, p_device_id text, p_expo_push_token text, p_platform text, p_app_version text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deregister_child_device_token(p_expo_push_token text, p_child_id uuid, p_session_token text, p_device_id text) TO authenticated;

-- Profile
GRANT EXECUTE ON FUNCTION public.update_profile_image(p_child_id uuid, p_image_url text, p_session_token text, p_device_id text) TO authenticated;

-- Streak tracking (no session token — grant both roles since these were missing anon too)
GRANT EXECUTE ON FUNCTION public.record_weekly_streak(p_child_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_weekly_streak(p_child_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.check_streak_expiry(p_child_id uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_streak_expiry(p_child_id uuid)  TO anon;
