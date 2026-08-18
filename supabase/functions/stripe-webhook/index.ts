// Breesh – stripe-webhook Edge Function
//
// Receives Stripe events, verifies the signature, and for
// payment_intent.succeeded calls stripe_complete_topup() to credit
// the child's wallet. All other events are acknowledged immediately.
//
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
//
// Required secrets (Supabase Dashboard → Edge Functions → Secrets):
//   STRIPE_WEBHOOK_SECRET    — signing secret from Stripe Dashboard → Webhooks
//   SUPABASE_URL             — auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Stripe rejects events older than 5 minutes (replay-attack protection)
const STRIPE_TOLERANCE_SECONDS = 300;

// ── Stripe signature verification ────────────────────────────────────────────
//
// Implements the Stripe-Signature header spec without the Stripe SDK:
//   header format:  t=<unix_ts>,v1=<hex_sig>[,v1=<hex_sig>...]
//   signed payload: "<timestamp>.<raw_body>"
//   algorithm:      HMAC-SHA256 keyed with STRIPE_WEBHOOK_SECRET
//
// Multiple v1 values are present during webhook secret rotation — any match passes.

async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
): Promise<boolean> {
  // Parse the header into { t: ['...'], v1: ['...', '...'] }
  const pairs: Record<string, string[]> = {};
  for (const part of sigHeader.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!pairs[k]) pairs[k] = [];
    pairs[k].push(v);
  }

  const timestamp  = pairs['t']?.[0];
  const signatures = pairs['v1'] ?? [];
  if (!timestamp || signatures.length === 0) return false;

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > STRIPE_TOLERANCE_SECONDS) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return signatures.some(s => s === expected);
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured');
    return new Response('Server misconfiguration', { status: 500 });
  }

  // Must read the raw body before any JSON parsing — the signature is computed
  // over the exact bytes Stripe sent.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const sigHeader = req.headers.get('stripe-signature') ?? '';

  let verified: boolean;
  try {
    verified = await verifyStripeSignature(rawBody, sigHeader, webhookSecret);
  } catch (err) {
    console.error('[stripe-webhook] signature verification threw:', err);
    return new Response('Bad request', { status: 400 });
  }

  if (!verified) {
    console.warn('[stripe-webhook] signature verification failed — possible replay or wrong secret');
    return new Response('Unauthorized', { status: 401 });
  }

  // Parse the verified payload
  let event: {
    type: string;
    data: { object: { id: string } };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Acknowledge any event we don't handle so Stripe stops retrying it.
  if (event.type !== 'payment_intent.succeeded') {
    return respond({ received: true });
  }

  const paymentIntentId: string = event.data?.object?.id ?? '';
  if (!paymentIntentId.startsWith('pi_')) {
    console.error('[stripe-webhook] unexpected payment_intent id format:', paymentIntentId.slice(0, 8));
    return new Response('Bad request', { status: 400 });
  }

  // ── Credit the child's wallet ─────────────────────────────────────────────
  //
  // stripe_complete_topup is SECURITY DEFINER, callable only by service_role.
  // It is idempotent: a second call for the same payment_intent_id is a no-op.
  // Returning 500 on failure tells Stripe to retry — safe because the function
  // uses FOR UPDATE + status='pending' to ensure at-most-one credit.

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { error } = await supabase.rpc('stripe_complete_topup', {
    p_payment_intent_id: paymentIntentId,
  });

  if (error) {
    console.error(JSON.stringify({
      msg:     '[stripe-webhook] stripe_complete_topup failed',
      pi_id:   paymentIntentId,
      code:    error.code,
      message: error.message,
      details: error.details,
      hint:    error.hint,
    }));
    // 500 → Stripe retries. stripe_complete_topup is idempotent so retries are safe.
    return new Response('Internal Server Error', { status: 500 });
  }

  console.log(`[stripe-webhook] stripe_complete_topup ok — pi=${paymentIntentId}`);
  return respond({ received: true });
});

function respond(data: object): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
