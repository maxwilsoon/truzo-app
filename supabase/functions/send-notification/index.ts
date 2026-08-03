// Truzo – send-notification Edge Function
//
// Called by DB RPCs via pg_net when a social or financial event occurs.
// Looks up device tokens, sends to Expo Push API, and cleans up invalid tokens.
//
// Deploy: supabase functions deploy send-notification --no-verify-jwt
//
// Required secrets (set in Supabase Dashboard → Edge Functions → Secrets):
//   NOTIFICATION_SECRET  — must match app.notification_secret DB setting
//   SUPABASE_URL         — auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;

// ── Types ────────────────────────────────────────────────────────────────────

interface NotificationRequest {
  type: string;
  recipient_id?: string;
  recipient_ids?: string[];
  recipient_type?: string;
  sender_id?: string;
  sender_name?: string;
  data?: {
    amount?: number;
    request_id?: string;
    [key: string]: unknown;
  };
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data: {
    type: string;
    screen: string;
    sender_id?: string;
    request_id?: string;
  };
}

interface DeviceTokenRow {
  expo_push_token: string;
  user_id: string;
}

interface ChildRow {
  id: string;
  push_token: string | null;
}

// ── Notification content builder ──────────────────────────────────────────────

function fmtAmount(amount: number | undefined): string {
  if (amount == null) return '';
  const s = amount.toFixed(2).replace(/\.00$/, '');
  return `£${s}`;
}

function buildMessage(token: string, req: NotificationRequest): ExpoMessage | null {
  const sender = req.sender_name ?? 'Someone';
  const amount = fmtAmount(req.data?.amount);

  switch (req.type) {
    case 'friend_request':
      return {
        to: token, sound: 'default',
        title: '👋 New friend request',
        body: `${sender} wants to join your circle`,
        data: { type: req.type, screen: 'Circle', sender_id: req.sender_id },
      };

    case 'friend_accepted':
      return {
        to: token, sound: 'default',
        title: '✅ Friend request accepted',
        body: `${sender} accepted your friend request`,
        data: { type: req.type, screen: 'Circle' },
      };

    case 'friend_declined':
      return {
        to: token, sound: 'default',
        title: 'Friend request declined',
        body: `${sender} didn't accept your request`,
        data: { type: req.type, screen: 'Circle' },
      };

    case 'money_request':
      return {
        to: token, sound: 'default',
        title: `💸 ${sender} needs money`,
        body: `${sender} requested ${amount}`,
        data: { type: req.type, screen: 'Circle', request_id: req.data?.request_id },
      };

    case 'money_funded':
      return {
        to: token, sound: 'default',
        title: '💚 Money received!',
        body: `${sender} funded your ${amount} request`,
        data: { type: req.type, screen: 'Home', request_id: req.data?.request_id },
      };

    case 'money_repaid':
      return {
        to: token, sound: 'default',
        title: '✅ Repayment received',
        body: `${sender} repaid you ${amount}`,
        data: { type: req.type, screen: 'Home', request_id: req.data?.request_id },
      };

    case 'loan_defaulted_lender':
      return {
        to: token, sound: 'default',
        title: '🛡️ Safety Pool paid out',
        body: `${sender} missed their repayment. You've been paid ${amount} from the Safety Pool.`,
        data: { type: req.type, screen: 'Home', request_id: req.data?.request_id },
      };

    case 'loan_defaulted_borrower':
      return {
        to: token, sound: 'default',
        title: '🔒 Account frozen',
        body: `You missed your ${amount} repayment to ${sender}. Your parent has been notified.`,
        data: { type: req.type, screen: 'Home', request_id: req.data?.request_id },
      };

    default:
      return null;
  }
}

function isValidExpoToken(token: string): boolean {
  return token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[');
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Validate internal secret — protects against arbitrary callers since this
  // function is deployed with --no-verify-jwt
  const secret = Deno.env.get('NOTIFICATION_SECRET') ?? '';
  const provided = req.headers.get('x-notification-secret') ?? '';
  if (!secret || provided !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: NotificationRequest;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Resolve recipient IDs to a flat array
  const recipientIds: string[] = body.recipient_ids?.length
    ? body.recipient_ids
    : body.recipient_id
    ? [body.recipient_id]
    : [];

  if (recipientIds.length === 0) {
    return respond({ sent: 0, reason: 'no_recipients' });
  }

  const recipientType = body.recipient_type ?? 'child';

  // Admin client — bypasses RLS to read device_tokens and children tables
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  // ── Collect device tokens ────────────────────────────────────────────────

  const tokenSet = new Set<string>();

  // Primary source: device_tokens table (supports multiple devices per user)
  const { data: dtRows, error: dtErr } = await supabase
    .from('device_tokens')
    .select('expo_push_token, user_id')
    .in('user_id', recipientIds)
    .eq('user_type', recipientType)
    .eq('active', true) as { data: DeviceTokenRow[] | null; error: unknown };

  if (dtErr) {
    console.error('[send-notification] device_tokens query error:', dtErr);
  }
  for (const row of dtRows ?? []) {
    if (row.expo_push_token) tokenSet.add(row.expo_push_token);
  }

  // Fallback: legacy children.push_token for users not yet in device_tokens
  if (recipientType === 'child') {
    const { data: childRows, error: childErr } = await supabase
      .from('children')
      .select('id, push_token')
      .in('id', recipientIds)
      .not('push_token', 'is', null) as { data: ChildRow[] | null; error: unknown };

    if (childErr) {
      console.error('[send-notification] children fallback query error:', childErr);
    }
    for (const row of childRows ?? []) {
      if (row.push_token) tokenSet.add(row.push_token);
    }
  }

  if (tokenSet.size === 0) {
    console.log(`[send-notification] type=${body.type} — no tokens found for ${recipientIds.length} recipient(s)`);
    return respond({ sent: 0, reason: 'no_tokens' });
  }

  // ── Build Expo messages ───────────────────────────────────────────────────

  const messages: ExpoMessage[] = [];
  for (const token of tokenSet) {
    if (!isValidExpoToken(token)) continue;
    const msg = buildMessage(token, body);
    if (msg) messages.push(msg);
  }

  if (messages.length === 0) {
    return respond({ sent: 0, reason: 'no_valid_tokens' });
  }

  // ── Send in batches of 100 ────────────────────────────────────────────────

  const invalidTokens: string[] = [];
  let sent = 0;

  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        const txt = await res.text();
        console.error(`[send-notification] Expo API ${res.status}: ${txt}`);
        continue;
      }

      const result = await res.json() as {
        data: Array<{
          status: string;
          message?: string;
          details?: { error?: string };
        }>;
      };

      (result.data ?? []).forEach((r, idx) => {
        if (r.status === 'ok') {
          sent++;
        } else {
          const errCode = r.details?.error ?? '';
          const token = batch[idx]?.to ?? '';
          if (errCode === 'DeviceNotRegistered' || errCode === 'InvalidCredentials') {
            invalidTokens.push(token);
            console.warn(`[send-notification] Invalid token removed: ${token} (${errCode})`);
          } else {
            console.error(`[send-notification] Push error token=${token} status=${r.status} msg=${r.message}`);
          }
        }
      });
    } catch (err) {
      console.error('[send-notification] Fetch failed:', err);
    }
  }

  // ── Clean up invalid tokens ───────────────────────────────────────────────

  if (invalidTokens.length > 0) {
    await supabase
      .from('device_tokens')
      .update({ active: false, updated_at: new Date().toISOString() })
      .in('expo_push_token', invalidTokens);

    // Clear from children.push_token
    await supabase
      .from('children')
      .update({ push_token: null })
      .in('push_token', invalidTokens);
  }

  console.log(
    `[send-notification] type=${body.type} recipients=${recipientIds.length} ` +
    `tokens=${messages.length} sent=${sent} invalid=${invalidTokens.length}`,
  );

  return respond({ sent, invalid: invalidTokens.length });
});

function respond(data: object): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
