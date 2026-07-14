import { Platform } from 'react-native';
import { supabase } from './supabase';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { decode as base64Decode } from 'base64-arraybuffer';

interface OnboardingParams {
  email:    string;
  password: string;
  parent: {
    firstName:              string;
    lastName:               string;
    displayName:            string;
    mobile:                 string;
    address:                string;
    safetyPoolLimit:        number;
    weeklyAllowance:        number;
    marketingNotifications: boolean;
  };
  child: {
    displayName:  string;
    username:     string;
    password:     string;
    mobile:       string;
    age:          number;
    avatarEmoji:  string;
    trustScore:   number;
    balance:      number;
    loanedOut:    number;
    borrowed:     number;
    streak:       number;
    repaid:       number;
    missed:       number;
    totalBorrowed: number;
    totalLent:    number;
    points:       number;
  };
}

export const db = {
  /** Sign up parent with Supabase Auth, then insert both profile rows. Returns the auth user ID and new child UUID. */
  async saveOnboarding(p: OnboardingParams): Promise<{ userId: string; childId: string }> {
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: p.email,
      password: p.password,
    });
    if (authErr) throw authErr;
    const userId = authData.user!.id;

    // signUp() may not establish an active session (e.g. if email confirmation is
    // required, or if the client's async initialise() races ahead and clears the
    // in-memory token). signInWithPassword immediately after guarantees the client
    // holds a valid JWT before the RLS-protected inserts below.
    // insert_child uses auth.uid() for parent_id — a missing session causes not_authenticated.
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: p.email, password: p.password });
    if (signInErr) throw new Error('account_created_but_login_failed: ' + signInErr.message);

    const { error: parentErr } = await supabase.from('parents').insert({
      id:                        userId,
      first_name:                p.parent.firstName,
      last_name:                 p.parent.lastName,
      display_name:              p.parent.displayName,
      email:                     p.email,
      mobile:                    p.parent.mobile,
      address:                   p.parent.address,
      safety_pool_limit:         p.parent.safetyPoolLimit,
      weekly_allowance:          p.parent.weeklyAllowance,
      marketing_notifications:   p.parent.marketingNotifications,
      marketing_preference_updated_at: new Date().toISOString(),
    });
    if (parentErr) throw parentErr;

    // insert_child RPC bcrypt-hashes the password inside the database.
    // The plain-text password travels over TLS and is never stored anywhere.
    // Returns the new child's UUID which we store so the app knows who was just created.
    const { data: newChildId, error: childErr } = await supabase.rpc('insert_child', {
      p_display_name: p.child.displayName,
      p_username:     p.child.username,
      p_password:     p.child.password,
      p_mobile:       p.child.mobile,
      p_age:          p.child.age,
      p_avatar_emoji: p.child.avatarEmoji,
    });
    if (childErr) {
      if (childErr.message?.includes('username_taken')) throw new Error('username_taken');
      if (childErr.message?.includes('not_authenticated')) throw new Error('not_authenticated');
      throw childErr;
    }

    return { userId, childId: newChildId as string };
  },

  async checkUsernameExists(username: string): Promise<boolean> {
    const { data } = await supabase.rpc('check_username_exists', {
      p_username: username.toLowerCase().trim(),
    });
    return !!data;
  },

  async loadParent(userId: string) {
    const { data } = await supabase
      .from('parents')
      .select('*')
      .eq('id', userId)
      .single();
    return data;
  },

  async loadChild(parentId: string) {
    const { data } = await supabase
      .from('children')
      .select('*')
      .eq('parent_id', parentId)
      .single();
    return data;
  },

  async uploadParentProfileImage(userId: string, uri: string, mimeType: string): Promise<string> {
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const path = `parent_${userId}.${ext}`;

    let arrayBuffer: ArrayBuffer;
    if (Platform.OS === 'web') {
      const resp = await fetch(uri);
      arrayBuffer = await resp.arrayBuffer();
    } else {
      const base64 = await readAsStringAsync(uri, { encoding: 'base64' });
      arrayBuffer = base64Decode(base64);
    }

    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(path, arrayBuffer, { upsert: true, contentType: mimeType });
    if (uploadErr) throw new Error('upload error: ' + uploadErr.message);

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = data.publicUrl + '?t=' + Date.now();
    const { error: updateErr } = await supabase.from('parents').update({
      profile_image_url:        publicUrl,
      profile_image_updated_at: new Date().toISOString(),
    }).eq('id', userId);
    if (updateErr) throw new Error('update error: ' + updateErr.message);
    return publicUrl;
  },

  async removeParentProfileImage(userId: string): Promise<void> {
    const { error } = await supabase.from('parents').update({
      profile_image_url:        null,
      profile_image_updated_at: new Date().toISOString(),
    }).eq('id', userId);
    if (error) throw error;
  },

  async updateMarketingPreference(userId: string, value: boolean): Promise<void> {
    const { error } = await supabase.from('parents').update({
      marketing_notifications:         value,
      marketing_preference_updated_at: new Date().toISOString(),
    }).eq('id', userId);
    if (error) throw error;
  },

  async updatePasscodeHash(userId: string, passcodeHash: string): Promise<void> {
    const { error } = await supabase
      .from('parents')
      .update({
        passcode_hash:       passcodeHash,
        passcode_created:    true,
        passcode_created_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (error) throw error;
  },

  async searchChildren(query: string, excludeId?: string) {
    const { data, error } = await supabase.rpc('search_children', {
      p_query:      query,
      p_exclude_id: excludeId ?? null,
    });
    if (error) throw new Error('search error: ' + error.message);
    return (data ?? []) as Array<{ id: string; display_name: string; username: string; avatar_emoji: string; trust_score: number }>;
  },

  async sendCircleRequest(fromId: string, toId: string): Promise<string | null> {
    const { data, error } = await supabase.rpc('send_circle_request', { p_from_id: fromId, p_to_id: toId });
    if (error) throw new Error('send_circle_request error: ' + error.message);
    return (data as any)?.push_token ?? null;
  },

  async acceptCircleRequest(requestId: string): Promise<{ fromId: string; toId: string; fromPushToken: string | null }> {
    const { data, error } = await supabase.rpc('accept_circle_request', { p_request_id: requestId });
    if (error) throw new Error('accept_circle_request error: ' + error.message);
    const d = data as any;
    return { fromId: d.from_id, toId: d.to_id, fromPushToken: d.from_push_token ?? null };
  },

  async declineCircleRequest(requestId: string): Promise<{ fromPushToken: string | null }> {
    const { data, error } = await supabase.rpc('decline_circle_request', { p_request_id: requestId });
    if (error) throw new Error('decline_circle_request error: ' + error.message);
    return { fromPushToken: (data as any)?.from_push_token ?? null };
  },

  async getPendingRequests(childId: string) {
    const { data, error } = await supabase.rpc('get_pending_requests', { p_child_id: childId });
    if (error) throw new Error('get_pending_requests error: ' + error.message);
    return (data ?? []) as Array<{
      request_id: string; id: string; display_name: string;
      username: string; avatar_emoji: string; trust_score: number; created_at: string; avatar_url: string | null;
    }>;
  },

  async savePushToken(childId: string, token: string) {
    const { error } = await supabase.rpc('save_push_token', { p_child_id: childId, p_token: token });
    if (error) console.warn('save_push_token error:', error.message);
  },

  async getCircle(childId: string) {
    const { data, error } = await supabase.rpc('get_circle', { p_child_id: childId });
    if (error) throw new Error('get_circle error: ' + error.message);
    return (data ?? []) as Array<{ id: string; display_name: string; username: string; avatar_emoji: string; trust_score: number; avatar_url: string | null }>;
  },

  async loginChild(username: string, password: string) {
    const { data, error } = await supabase.rpc('login_child', {
      p_username: username.toLowerCase(),
      p_password: password,
    });
    if (error) throw new Error('RPC error: ' + error.message + ' [' + error.code + ']');
    if (!data) return null;
    // RPC returns { child: {...}, parent: {...} }
    return data as { child: Record<string, any>; parent: Record<string, any> };
  },

  async createMoneyRequest(
    fromId: string, amount: number, deadlineDays: number,
    viewerIds?: string[],
  ): Promise<{ requestId: string; pushTokens: string[] }> {
    const { data, error } = await supabase.rpc('create_money_request', {
      p_from_id: fromId, p_amount: amount, p_deadline_days: deadlineDays,
      p_reason: '', p_reason_emoji: '💸',
      p_viewer_ids: viewerIds ?? null,
    });
    if (error) throw new Error('create_money_request error: ' + error.message);
    const d = data as any;
    return { requestId: d.request_id, pushTokens: d.push_tokens ?? [] };
  },

  async getActiveRequests(childId: string) {
    const { data, error } = await supabase.rpc('get_active_requests', { p_child_id: childId });
    if (error) throw new Error('get_active_requests error: ' + error.message);
    return (data ?? []) as Array<{
      id: string; from_id: string; from_name: string; from_emoji: string;
      from_trust: number; amount: number; reason: string; reason_emoji: string;
      deadline_days: number; repay_by_date: string; expires_at: string;
      status: string; created_at: string; is_own: boolean;
      funded_by: string | null; funded_by_name: string | null; funded_by_emoji: string | null;
    }>;
  },

  async fundMoneyRequest(requestId: string, funderId: string, amount: number): Promise<{ borrowerPushToken: string | null }> {
    const { data, error } = await supabase.rpc('fund_money_request', {
      p_request_id: requestId, p_funder_id: funderId, p_amount: amount,
    });
    if (error) throw new Error('fund_money_request error: ' + error.message);
    return { borrowerPushToken: (data as any)?.borrower_push_token ?? null };
  },

  async repayMoneyRequest(requestId: string, borrowerId: string): Promise<{ funderPushToken: string | null; funderId: string; amount: number }> {
    const { data, error } = await supabase.rpc('repay_money_request', {
      p_request_id: requestId, p_borrower_id: borrowerId,
    });
    if (error) throw new Error('repay_money_request error: ' + error.message);
    const d = data as any;
    return { funderPushToken: d?.funder_push_token ?? null, funderId: d?.funder_id, amount: d?.amount };
  },

  async cancelMoneyRequest(requestId: string, childId: string): Promise<void> {
    const { error } = await supabase.rpc('cancel_money_request', {
      p_request_id: requestId, p_child_id: childId,
    });
    if (error) throw new Error('cancel_money_request error: ' + error.message);
  },

  async removeRequestActivities(requestId: string): Promise<void> {
    await supabase.rpc('remove_request_activities', { p_request_id: requestId });
  },

  async enableBiometric(childId: string, deviceId: string): Promise<void> {
    const { error } = await supabase.rpc('enable_biometric', { p_child_id: childId, p_device_id: deviceId });
    if (error) throw new Error('enable_biometric error: ' + error.message);
  },

  async disableBiometric(childId: string): Promise<void> {
    const { error } = await supabase.rpc('disable_biometric', { p_child_id: childId });
    if (error) throw new Error('disable_biometric error: ' + error.message);
  },

  async biometricLoginChild(childId: string, deviceId: string): Promise<{ child: any; parent: any } | null> {
    const { data, error } = await supabase.rpc('biometric_login_child', { p_child_id: childId, p_device_id: deviceId });
    if (error) throw new Error('biometric_login_child error: ' + error.message);
    return data ?? null;
  },

  async cancelCircleRequest(fromId: string, toId: string): Promise<void> {
    const { error } = await supabase.rpc('cancel_circle_request', { p_from_id: fromId, p_to_id: toId });
    if (error) throw new Error('cancel_circle_request error: ' + error.message);
  },

  async getOutgoingPendingRequests(childId: string) {
    const { data, error } = await supabase.rpc('get_outgoing_pending_requests', { p_child_id: childId });
    if (error) throw new Error('get_outgoing_pending_requests error: ' + error.message);
    return (data ?? []) as Array<{ id: string }>;
  },

  async getResolvedSentRequests(childId: string) {
    const { data, error } = await supabase.rpc('get_resolved_sent_requests', { p_child_id: childId });
    if (error) throw new Error('get_resolved_sent_requests error: ' + error.message);
    return (data ?? []) as Array<{ request_id: string; id: string; display_name: string; username: string; avatar_emoji: string; status: string; created_at: string }>;
  },

  async addActivityItem(childId: string, id: string, emoji: string, text: string, type: string): Promise<void> {
    await supabase.rpc('add_activity_item', {
      p_child_id: childId, p_id: id, p_emoji: emoji, p_text: text, p_type: type,
    });
  },

  async getActivityFeed(childId: string, limit = 100) {
    const { data, error } = await supabase.rpc('get_activity_feed', { p_child_id: childId, p_limit: limit });
    if (error) throw new Error('get_activity_feed error: ' + error.message);
    return (data ?? []) as Array<{ id: string; emoji: string; text: string; type: string; created_at: string }>;
  },

  async getChildTransactions(childId: string, limit = 20) {
    const { data, error } = await supabase.rpc('get_child_transactions', { p_child_id: childId, p_limit: limit });
    if (error) throw new Error('get_child_transactions error: ' + error.message);
    return (data ?? []) as Array<{
      id: string; type: string; amount: number;
      description: string; counterparty: string | null; created_at: string;
    }>;
  },

  async getChildStats(childId: string) {
    const { data, error } = await supabase.rpc('get_child_stats', { p_child_id: childId });
    if (error) throw new Error('get_child_stats error: ' + error.message);
    return data as { wallet_balance: number; loaned_out: number; borrowed: number; trust_score: number; points: number; streak: number; repaid: number; missed: number; total_borrowed: number; total_lent: number; times_borrowed: number; times_lent: number; profile_image_url: string | null; account_frozen: boolean; parent_debt: number } | null;
  },

  async uploadProfileImage(childId: string, uri: string, mimeType: string): Promise<string> {
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const path = `child_${childId}.${ext}`;

    // On web, the image picker returns a blob URL; fetch() can read it directly.
    // On native, expo-file-system's base64 read + arraybuffer decode is the reliable path.
    let arrayBuffer: ArrayBuffer;
    if (Platform.OS === 'web') {
      const resp = await fetch(uri);
      arrayBuffer = await resp.arrayBuffer();
    } else {
      const base64 = await readAsStringAsync(uri, { encoding: 'base64' });
      arrayBuffer = base64Decode(base64);
    }

    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(path, arrayBuffer, { upsert: true, contentType: mimeType });
    if (uploadErr) throw new Error('upload error: ' + uploadErr.message);

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = data.publicUrl + '?t=' + Date.now();
    const { error: updateErr } = await supabase.rpc('update_profile_image', {
      p_child_id: childId, p_image_url: publicUrl,
    });
    if (updateErr) throw new Error('update error: ' + updateErr.message);
    return publicUrl;
  },

  async updateChildAvatarEmoji(childId: string, emoji: string): Promise<void> {
    const { error } = await supabase
      .from('children')
      .update({ avatar_emoji: emoji })
      .eq('id', childId);
    if (error) throw error;
  },

  async persistTransaction(
    childId: string, type: string, amount: number,
    description: string, counterparty: string | null,
  ): Promise<void> {
    const { error } = await supabase.rpc('persist_transaction', {
      p_child_id:     childId,
      p_type:         type,
      p_amount:       amount,
      p_description:  description,
      p_counterparty: counterparty,
    });
    if (error) throw new Error('persistTransaction error: ' + error.message);
  },

  async removeFromCircle(childId: string, friendId: string): Promise<void> {
    const { error } = await supabase.rpc('remove_from_circle', { p_child_id: childId, p_friend_id: friendId });
    if (error) throw new Error('remove_from_circle error: ' + error.message);
  },

  /** Set the initial safety pool amount (onboarding — sets absolute value). */
  async setupSafetyPool(userId: string, amount: number): Promise<void> {
    const { error } = await supabase
      .from('parents')
      .update({ safety_pool_limit: amount })
      .eq('id', userId);
    if (error) throw error;
  },

  /** Atomically add `amount` to the existing safety pool balance. Returns new total. */
  async topUpSafetyPool(userId: string, amount: number): Promise<number> {
    const { data, error } = await supabase.rpc('top_up_safety_pool', {
      p_parent_id: userId,
      p_amount:    amount,
    });
    if (error) throw error;
    return data as number;
  },

  /** Persist allowance settings. nextPayment is an ISO date string or null. */
  async updateAllowance(
    userId: string,
    amount: number,
    frequency: string,
    nextPayment: string | null,
    active: boolean,
  ): Promise<void> {
    const { error } = await supabase
      .from('parents')
      .update({
        weekly_allowance:        amount,
        allowance_frequency:     frequency,
        allowance_next_payment:  nextPayment,
        allowance_active:        active,
      })
      .eq('id', userId);
    if (error) throw error;
  },

  /** Fetch just the parent's passcode fields (used to recover from stale context). */
  async getParentPasscodeHash(userId: string): Promise<{ hash: string | null; created: boolean } | null> {
    const { data } = await supabase
      .from('parents')
      .select('passcode_hash, passcode_created')
      .eq('id', userId)
      .single();
    if (!data) return null;
    return { hash: data.passcode_hash ?? null, created: data.passcode_created ?? false };
  },

  /** Fetch live Safety Pool balance from DB — used by the access guard. */
  async getSafetyPoolStatus(userId: string): Promise<{ limit: number; used: number } | null> {
    const { data } = await supabase
      .from('parents')
      .select('safety_pool_limit, safety_pool_used')
      .eq('id', userId)
      .single();
    if (!data) return null;
    return {
      limit: Number(data.safety_pool_limit ?? 0),
      used:  Number(data.safety_pool_used  ?? 0),
    };
  },

  /** Refresh parent financial data from DB (safety pool, allowance). */
  async getParentStats(userId: string) {
    const { data } = await supabase
      .from('parents')
      .select('safety_pool_limit, safety_pool_used, weekly_allowance, allowance_frequency, allowance_next_payment, allowance_active')
      .eq('id', userId)
      .single();
    return data as {
      safety_pool_limit:      number;
      safety_pool_used:       number;
      weekly_allowance:       number;
      allowance_frequency:    string;
      allowance_next_payment: string | null;
      allowance_active:       boolean;
    } | null;
  },

  async loginParent(email: string, password: string) {
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr || !authData.user) return null;
    const userId = authData.user.id;
    const { data: parentData } = await supabase
      .from('parents')
      .select('*')
      .eq('id', userId)
      .single();
    const { data: childData } = await supabase
      .from('children')
      .select('id, display_name, username, avatar_emoji, profile_image_url, trust_score, wallet_balance, loaned_out, borrowed, streak, repaid, missed, total_borrowed, total_lent, times_borrowed, times_lent, points, age, mobile, account_frozen, parent_debt')
      .eq('parent_id', userId)
      .single();
    if (!parentData) return null;
    return { userId, parent: parentData, child: childData };
  },

  async checkEmailExists(email: string): Promise<boolean> {
    const { data } = await supabase.rpc('check_email_exists', { p_email: email.toLowerCase() });
    return !!data;
  },

  async checkMobileExists(mobile: string): Promise<boolean> {
    const { data } = await supabase.rpc('check_mobile_exists', { p_mobile: mobile.trim() });
    return !!data;
  },

  /**
   * Parent sends money directly to child's wallet.
   * Requires the `parent_send_to_child` SECURITY DEFINER function in Supabase.
   *
   * SQL to create it:
   *
   * CREATE OR REPLACE FUNCTION parent_send_to_child(
   *   p_user_id uuid, p_child_id uuid, p_amount numeric, p_parent_name text
   * ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
   * DECLARE v_tx_id text := 'ps_' || floor(extract(epoch from now()))::bigint;
   * BEGIN
   *   IF NOT EXISTS (SELECT 1 FROM children WHERE id = p_child_id AND parent_id = p_user_id)
   *     THEN RAISE EXCEPTION 'not_parent'; END IF;
   *   UPDATE children SET wallet_balance = wallet_balance + p_amount WHERE id = p_child_id;
   *   INSERT INTO transactions (child_id, type, amount, description, counterparty)
   *     VALUES (p_child_id, 'topup', p_amount, 'Money from ' || p_parent_name, p_parent_name);
   *   INSERT INTO activity_feed (child_id, id, emoji, text, type)
   *     VALUES (p_child_id, 'act_' || v_tx_id, '💸',
   *             p_parent_name || ' sent you £' || round(p_amount, 2)::text, 'topup');
   * END; $$;
   */
  async parentSendToChild(userId: string, childId: string, amount: number, parentName: string): Promise<void> {
    const { error } = await supabase.rpc('parent_send_to_child', {
      p_user_id: userId,
      p_child_id: childId,
      p_amount: amount,
      p_parent_name: parentName,
    });
    if (error) throw new Error(error.message);
  },

  async getLoanHistory(childId: string) {
    const { data, error } = await supabase.rpc('get_loan_history', { p_child_id: childId });
    if (error) throw new Error('get_loan_history error: ' + error.message);
    return (data ?? []) as Array<{
      id: string;
      amount: number;
      reason: string;
      reason_emoji: string;
      created_at: string;
      repaid_at: string | null;
      repay_by_date: string;
      is_borrower: boolean;
      repaid_on_time: boolean;
      borrower_name: string;
      borrower_username: string;
      borrower_emoji: string;
      borrower_avatar_url: string | null;
      funder_name: string;
      funder_username: string;
      funder_emoji: string;
      funder_avatar_url: string | null;
    }>;
  },

  async recordWeeklyStreak(childId: string): Promise<number> {
    const { data, error } = await supabase.rpc('record_weekly_streak', { p_child_id: childId });
    if (error) return 0;
    return (data as any)?.new_streak ?? 0;
  },

  /** Expires streak to 0 if no qualifying activity in the past ISO week. Call at login. */
  async checkStreakExpiry(childId: string): Promise<number> {
    const { data, error } = await supabase.rpc('check_streak_expiry', { p_child_id: childId });
    if (error) return -1;
    return (data as any)?.streak ?? -1;
  },

  /** Returns IDs of funded loans that are past their repay_by_date. */
  async getOverdueFundedLoans(childId: string): Promise<Array<{ request_id: string }>> {
    const { data, error } = await supabase.rpc('get_overdue_funded_loans', { p_child_id: childId });
    if (error) return [];
    return (data ?? []) as Array<{ request_id: string }>;
  },

  /** Atomically handles a defaulted loan: charges safety pool, pays lender, freezes borrower. */
  async processLoanDefault(requestId: string): Promise<void> {
    await supabase.rpc('process_loan_default', { p_request_id: requestId });
  },

  /** Parent confirms child repaid: clears parent_debt, restores safety pool, unfreezes account. */
  async confirmParentRepayment(childId: string, parentId: string): Promise<void> {
    const { error } = await supabase.rpc('confirm_parent_repayment', {
      p_child_id: childId, p_parent_id: parentId,
    });
    if (error) throw new Error(error.message);
  },
};
