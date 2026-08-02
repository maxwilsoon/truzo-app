-- Migration 021: Child session token table and helper functions
--
-- Purpose: Introduce short-lived, device-bound cryptographic session tokens for child
-- authentication. These tokens are required by migration 023 to secure all child write RPCs.
-- Until this migration runs, children are authenticated by bare UUID (C3 vulnerability).
--
-- ── Token design ─────────────────────────────────────────────────────────────────────────
--
--   Generation:  raw_token  = encode(gen_random_bytes(32), 'hex')
--                           → 64 lowercase hex characters (256 bits of entropy)
--
--   Storage:     token_hash = encode(digest(raw_token, 'sha256'), 'hex')
--                           → only this SHA-256 hash is stored in the DB
--
--   Client:      raw_token is returned ONCE in the login response and stored in
--                SecureStore on the device. It is never stored in AsyncStorage, logs,
--                notification payloads, or the DB.
--
-- ── Why SHA-256 instead of bcrypt ────────────────────────────────────────────────────────
--
--   bcrypt is designed for low-entropy human-chosen secrets (passwords). Its cost factor
--   exists to slow offline brute-force attacks against dictionary-guessable inputs.
--
--   A 256-bit CSPRNG token is not dictionary-guessable. There are 2^256 ≈ 10^77 possible
--   values — an attacker who stole the DB would need ~10^67 years to brute-force it even
--   at 10^10 hashes/second. SHA-256 is single-pass (~1 µs per call) and perfectly
--   appropriate. Using bcrypt here would add 50–100 ms of latency to every authenticated
--   RPC call with zero security benefit.
--
-- ── Session lifecycle ─────────────────────────────────────────────────────────────────────
--
--   Created:  login_child or biometric_login_child; raw token returned once, hash stored.
--   Active:   each successful validation extends expires_at by 1 hour (sliding window),
--             capped at absolute_expires_at (30 days from creation).
--   Expired:  expires_at < now()  →  child_session_expired
--             absolute_expires_at < now()  →  child_session_expired
--   Revoked:  revoked_at set; reason recorded.
--
-- ── Revocation triggers ───────────────────────────────────────────────────────────────────
--
--   logout                  – revoke_child_session() called by client
--   new login (any device)  – all prior sessions superseded in login RPCs
--   parent freezes child    – require_valid_child_session rejects frozen account immediately
--   account deletion        – ON DELETE CASCADE removes all rows automatically
--   biometric disabled      – disable_biometric calls revoke_all_child_sessions (migration 022)
--   password change/reset   – revoke_all_child_sessions() from the relevant RPC (Phase 2)
--
-- ── Device binding ────────────────────────────────────────────────────────────────────────
--
--   Every session is bound to the device_id supplied at login. All protected RPCs must
--   pass the same device_id alongside the session token. Mismatched device_id → rejection.
--   No fallback to an unbound session is permitted.
--
-- Rollback: 20260803_021_rollback.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── Table ─────────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.child_sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id            uuid        NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  token_hash          text        NOT NULL UNIQUE,
  device_id           text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Sliding idle timeout; extended on every successful validation; never exceeds absolute_expires_at
  expires_at          timestamptz NOT NULL,
  -- Fixed maximum lifetime; set at creation and never changed
  absolute_expires_at timestamptz NOT NULL,
  last_seen_at        timestamptz,
  revoked_at          timestamptz,
  revoked_reason      text,

  CONSTRAINT child_sessions_token_hash_length   CHECK (length(token_hash) = 64),
  CONSTRAINT child_sessions_device_id_nonempty  CHECK (device_id <> ''),
  CONSTRAINT child_sessions_expiry_order        CHECK (expires_at <= absolute_expires_at)
);

CREATE INDEX ON child_sessions (child_id, revoked_at, expires_at);
CREATE INDEX ON child_sessions (token_hash);

-- RLS: no direct client access — all access is via SECURITY DEFINER functions only
ALTER TABLE child_sessions ENABLE ROW LEVEL SECURITY;


-- ── Internal helper: require_valid_child_session ──────────────────────────────────────────
--
-- Must be called at the top of every protected child-facing RPC BEFORE any read or write.
-- Updates last_seen_at and extends expires_at on every successful call (sliding window).
-- NOT client-callable. No GRANT. Only invoked from other SECURITY DEFINER functions.

CREATE OR REPLACE FUNCTION public.require_valid_child_session(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session child_sessions%ROWTYPE;
  v_hash    text;
  v_now     timestamptz := now();
BEGIN
  IF p_session_token IS NULL OR length(p_session_token) <> 64 THEN
    RAISE EXCEPTION 'invalid_child_session';
  END IF;
  IF p_device_id IS NULL OR p_device_id = '' THEN
    RAISE EXCEPTION 'invalid_child_session';
  END IF;
  IF p_child_id IS NULL THEN
    RAISE EXCEPTION 'invalid_child_session';
  END IF;

  v_hash := encode(digest(p_session_token, 'sha256'), 'hex');

  SELECT * INTO v_session
    FROM child_sessions
    WHERE token_hash = v_hash
      AND child_id   = p_child_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_child_session';
  END IF;

  IF v_session.device_id <> p_device_id THEN
    RAISE EXCEPTION 'invalid_child_session';
  END IF;

  IF v_session.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'child_session_revoked';
  END IF;

  IF v_session.expires_at < v_now THEN
    RAISE EXCEPTION 'child_session_expired';
  END IF;

  IF v_session.absolute_expires_at < v_now THEN
    RAISE EXCEPTION 'child_session_expired';
  END IF;

  IF EXISTS (SELECT 1 FROM children WHERE id = p_child_id AND account_frozen = true) THEN
    RAISE EXCEPTION 'invalid_child_session';
  END IF;

  UPDATE child_sessions
    SET last_seen_at = v_now,
        expires_at   = LEAST(v_now + interval '1 hour', v_session.absolute_expires_at)
    WHERE id = v_session.id;
END;
$$;
-- No GRANT — internal helper only


-- ── Client-callable: revoke_child_session ─────────────────────────────────────────────────
--
-- Called by the client on explicit logout. Best-effort: caller ignores errors.
-- Accepts only a well-formed 64-character token. Any other input silently no-ops.
-- Cannot revoke by child UUID alone — must supply the raw token.
-- Does not log the token at any severity level.

CREATE OR REPLACE FUNCTION public.revoke_child_session(
  p_session_token text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_hash text;
BEGIN
  -- Silently ignore malformed or missing tokens — never log the raw token
  IF p_session_token IS NULL OR length(p_session_token) <> 64 THEN
    RETURN;
  END IF;
  v_hash := encode(digest(p_session_token, 'sha256'), 'hex');
  UPDATE child_sessions
    SET revoked_at     = now(),
        revoked_reason = 'logout'
    WHERE token_hash = v_hash
      AND revoked_at IS NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.revoke_child_session(text) TO anon;


-- ── Internal helper: revoke_all_child_sessions ────────────────────────────────────────────
--
-- Bulk-revokes every active session for a child. Called by:
--   - Login RPCs (supersede prior sessions on new login)
--   - disable_biometric (biometric credential revoked)
--   - Parent freeze / password reset RPCs (Phase 2)
-- NOT client-callable. No GRANT.

CREATE OR REPLACE FUNCTION public.revoke_all_child_sessions(
  p_child_id uuid,
  p_reason   text DEFAULT 'admin_action'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE child_sessions
    SET revoked_at     = now(),
        revoked_reason = p_reason
    WHERE child_id   = p_child_id
      AND revoked_at IS NULL;
END;
$$;
-- No GRANT — internal helper only

NOTIFY pgrst, 'reload schema';

COMMIT;
