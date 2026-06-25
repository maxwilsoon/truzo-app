import { supabase } from './supabase';

interface OnboardingParams {
  email:    string;
  password: string;
  parent: {
    firstName:       string;
    lastName:        string;
    displayName:     string;
    mobile:          string;
    address:         string;
    safetyPoolLimit: number;
    weeklyAllowance: number;
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
  /** Sign up parent with Supabase Auth, then insert both profile rows. Returns the auth user ID. */
  async saveOnboarding(p: OnboardingParams): Promise<string> {
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: p.email,
      password: p.password,
    });
    if (authErr) throw authErr;
    const userId = authData.user!.id;

    const { error: parentErr } = await supabase.from('parents').insert({
      id:                userId,
      first_name:        p.parent.firstName,
      last_name:         p.parent.lastName,
      mobile:            p.parent.mobile,
      address:           p.parent.address,
      safety_pool_limit: p.parent.safetyPoolLimit,
      weekly_allowance:  p.parent.weeklyAllowance,
    });
    if (parentErr) throw parentErr;

    const { error: childErr } = await supabase.from('children').insert({
      parent_id:     userId,
      display_name:  p.child.displayName,
      username:      p.child.username,
      password:      p.child.password,
      mobile:        p.child.mobile,
      age:           p.child.age,
      avatar_emoji:  p.child.avatarEmoji,
      trust_score:    p.child.trustScore,
      wallet_balance: p.child.balance,
      loaned_out:     p.child.loanedOut,
      borrowed:      p.child.borrowed,
      streak:        p.child.streak,
      repaid:        p.child.repaid,
      missed:        p.child.missed,
      total_borrowed: p.child.totalBorrowed,
      total_lent:    p.child.totalLent,
      points:        p.child.points,
    });
    if (childErr) throw childErr;

    return userId;
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

  async updatePasscode(userId: string, passcode: string): Promise<void> {
    const { error } = await supabase
      .from('parents')
      .update({ passcode })
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
      username: string; avatar_emoji: string; trust_score: number; created_at: string;
    }>;
  },

  async savePushToken(childId: string, token: string) {
    const { error } = await supabase.rpc('save_push_token', { p_child_id: childId, p_token: token });
    if (error) console.warn('save_push_token error:', error.message);
  },

  async getCircle(childId: string) {
    const { data, error } = await supabase.rpc('get_circle', { p_child_id: childId });
    if (error) throw new Error('get_circle error: ' + error.message);
    return (data ?? []) as Array<{ id: string; display_name: string; username: string; avatar_emoji: string; trust_score: number }>;
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
    fromId: string, amount: number, reason: string,
    reasonEmoji: string, deadlineDays: number,
  ): Promise<{ requestId: string; pushTokens: string[] }> {
    const { data, error } = await supabase.rpc('create_money_request', {
      p_from_id: fromId, p_amount: amount, p_reason: reason,
      p_reason_emoji: reasonEmoji, p_deadline_days: deadlineDays,
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
    return data as { wallet_balance: number; loaned_out: number; borrowed: number; trust_score: number; points: number; streak: number; repaid: number; missed: number; total_borrowed: number; total_lent: number; times_borrowed: number; times_lent: number } | null;
  },

  async removeFromCircle(childId: string, friendId: string): Promise<void> {
    const { error } = await supabase.rpc('remove_from_circle', { p_child_id: childId, p_friend_id: friendId });
    if (error) throw new Error('remove_from_circle error: ' + error.message);
  },

  async loginParent(email: string, password: string) {
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr || !authData.user) return null;
    const userId = authData.user.id;
    const { data: parentData } = await supabase.from('parents').select('*').eq('id', userId).single();
    const { data: childData }  = await supabase.from('children').select('*').eq('parent_id', userId).single();
    if (!parentData) return null;
    return { userId, parent: parentData, child: childData };
  },
};
