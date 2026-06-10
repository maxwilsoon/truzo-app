import { supabase } from './supabase';

interface OnboardingParams {
  email:    string;
  password: string;
  parent: {
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
      display_name:      p.parent.displayName,
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
      trust_score:   p.child.trustScore,
      balance:       p.child.balance,
      loaned_out:    p.child.loanedOut,
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
};
