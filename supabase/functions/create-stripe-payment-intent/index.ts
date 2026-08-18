// Breesh — create-stripe-payment-intent Edge Function
//
// Creates a Stripe PaymentIntent and records a pending stripe_topups row.
// Supports two purposes:
//   child_wallet  — credits the child's wallet on webhook confirmation
//   safety_pool   — credits the parent's safety_pool_limit on webhook confirmation
//
// The webhook Edge Function (stripe-webhook) calls stripe_complete_topup() when
// payment_intent.succeeded fires; that function routes the credit by purpose.
// NEVER update any balance directly from this function.
//
// Deploy: supabase functions deploy create-stripe-payment-intent
//         (JWT verification enabled — keep it on)
//
// Required secrets:
//   STRIPE_SECRET_KEY          (set via supabase secrets set)
//   SUPABASE_URL               (auto-set)
//   SUPABASE_ANON_KEY          (auto-set)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-set)

import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VALID_PURPOSES = ['child_wallet', 'safety_pool'] as const;
type Purpose = typeof VALID_PURPOSES[number];

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return respond(405, { error: 'method_not_allowed' });
  }

  // ── Auth: verify the parent JWT ──────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return respond(401, { error: 'unauthorized' });

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')      ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !user) {
    return respond(401, { error: 'unauthorized' });
  }
  const parentId = user.id;

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: { child_id?: unknown; amount?: unknown; purpose?: unknown };
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: 'invalid_json' });
  }

  const childId = typeof body.child_id === 'string' ? body.child_id : null;
  const amount  = typeof body.amount   === 'number' ? body.amount   : null;
  const purpose: Purpose =
    VALID_PURPOSES.includes(body.purpose as Purpose)
      ? (body.purpose as Purpose)
      : 'child_wallet';

  if (!childId) return respond(400, { error: 'missing_child_id' });
  if (amount === null || amount < 50 || !Number.isInteger(amount)) {
    return respond(400, { error: 'invalid_amount' });
  }

  // ── Create Stripe PaymentIntent ──────────────────────────────────────────
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });

  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'gbp',
      automatic_payment_methods: { enabled: true },
      metadata: { parent_id: parentId, child_id: childId, purpose },
    });
  } catch (stripeErr: any) {
    console.error('[create-stripe-payment-intent] stripe error:', stripeErr?.message);
    return respond(500, { error: 'stripe_error', detail: stripeErr?.message });
  }

  // ── Record pending top-up ────────────────────────────────────────────────
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')             ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { error: insertErr } = await supabaseAdmin.from('stripe_topups').insert({
    stripe_payment_intent_id: paymentIntent.id,
    parent_id: parentId,
    child_id:  childId,
    amount,
    purpose,
    status: 'pending',
  });

  if (insertErr) {
    console.error('[create-stripe-payment-intent] insert error:', insertErr.message);
    // Cancel the PaymentIntent so the user is not charged for a lost record
    await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {});
    return respond(500, { error: 'database_error' });
  }

  return respond(200, { client_secret: paymentIntent.client_secret });
});

function respond(status: number, data: object): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
