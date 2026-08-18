// Breesh – parent-pin-login Edge Function
//
// Verifies a parent's 6-digit PIN using the existing rate-limited
// verify_parent_passcode DB function, then creates a real Supabase Auth
// session and returns the JWT so the Expo app can make authenticated calls
// (e.g. Stripe PaymentIntent) without ever requiring an email+password login.
//
// Session strategy: admin.generateLink (server-side only, no email sent) +
// anon.verifyOtp. The OTP is generated and consumed entirely within this
// function so the parent never sees it.
//
// Deploy: supabase functions deploy parent-pin-login --no-verify-jwt
//
// Required secrets (auto-set by Supabase):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN_RE  = /^\d{6}$/;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body: { parent_id?: unknown; pin?: unknown };
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: 'invalid_json' });
  }

  const parentId = typeof body.parent_id === 'string' ? body.parent_id : '';
  const pin      = typeof body.pin      === 'string' ? body.pin      : '';

  if (!UUID_RE.test(parentId)) return respond(400, { error: 'invalid_parent_id' });
  if (!PIN_RE.test(pin))       return respond(400, { error: 'invalid_pin_format' });

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')             ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  // verify_parent_passcode is SECURITY DEFINER with built-in rate limiting.
  const { data: pinValid, error: pinErr } = await supabaseAdmin.rpc(
    'verify_parent_passcode',
    { p_parent_id: parentId, p_pin: pin },
  );

  if (pinErr) {
    const msg = pinErr.message ?? '';
    if (msg.includes('rate_limit_exceeded')) {
      return respond(429, { error: 'rate_limit_exceeded' });
    }
    console.error('[parent-pin-login] verify_parent_passcode error:', msg);
    return respond(500, { error: 'verification_failed' });
  }

  if (!pinValid) {
    return respond(401, { error: 'invalid_credentials' });
  }

  // PIN correct — look up the parent's email from Auth (needed for generateLink).
  const { data: { user: authUser }, error: authErr } = await supabaseAdmin.auth.admin.getUserById(parentId);

  if (authErr || !authUser?.email) {
    console.error('[parent-pin-login] getUserById error:', authErr?.message);
    return respond(500, { error: 'user_not_found' });
  }

  // Generate a one-time magic link server-side. admin.generateLink does NOT
  // send any email — it returns the raw hashed_token for us to consume here.
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: authUser.email,
    options: { shouldCreateUser: false },
  });

  if (linkErr || !linkData?.properties?.hashed_token) {
    console.error('[parent-pin-login] generateLink error:', linkErr?.message);
    return respond(500, { error: 'session_creation_failed' });
  }

  // Exchange the hashed token for a full Supabase Auth session using the anon
  // client. verifyOtp consumes (deletes) the OTP and returns a JWT identical
  // to one from signInWithPassword — works with all JWT-gated Edge Functions.
  const supabaseAnon = createClient(
    Deno.env.get('SUPABASE_URL')      ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { data: sessionData, error: sessionErr } = await supabaseAnon.auth.verifyOtp({
    type: 'email',
    token_hash: linkData.properties.hashed_token,
  });

  if (sessionErr || !sessionData?.session) {
    console.error('[parent-pin-login] verifyOtp error:', sessionErr?.message);
    return respond(500, { error: 'session_creation_failed' });
  }

  return respond(200, {
    access_token:  sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
    expires_in:    sessionData.session.expires_in,
  });
});

function respond(status: number, data: object): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
