import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { cache } from '../lib/cache';
import { db } from '../lib/database';
import { fmtAmt } from '../lib/utils';

export type CardNetwork = 'visa' | 'mastercard' | 'amex' | 'other';

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank';
  label: string;        // e.g. "Visa" / "Barclays"
  last4: string;
  expiry?: string;      // MM/YY — cards only
  network?: CardNetwork;
  sortCode?: string;    // banks only
  isDefault: boolean;
}

export interface CircleMember {
  id: string;
  displayName: string;
  username: string;
  avatarEmoji: string;
  trustScore: number;
  profileImageUrl?: string;
}

export interface Transaction {
  id: string;
  type: 'borrow' | 'lend' | 'repay' | 'receive' | 'topup' | 'spend' | 'allowance' | 'parent_transfer';
  amount: number;
  description: string;
  date: string;
  counterparty?: string;
  status: 'pending' | 'active' | 'completed' | 'missed';
}

export interface ActiveRequest {
  id: string;
  fromId: string;
  fromName: string;
  fromEmoji: string;
  fromTrust: number;
  amount: number;
  reason: string;
  reasonEmoji: string;
  deadline: string;
  repayByDate: string;
  expiresIn: number;
  createdAt: string;
  isOwn?: boolean;
  isFunded?: boolean;
  fundedById?: string;
  fundedByName?: string;
  fundedByEmoji?: string;
}

export interface PendingRequest {
  requestId: string;
  id: string;
  displayName: string;
  username: string;
  avatarEmoji: string;
  trustScore: number;
  createdAt: string;
  profileImageUrl?: string;
}

export interface ActivityItem {
  id: string;
  emoji: string;
  text: string;
  time: string;
  type: 'request' | 'funded' | 'repaid' | 'missed' | 'joined' | 'tier' | 'topup' | 'spend';
  createdAt?: string; // ISO timestamp — used for sort order
}

interface ChildProfile {
  displayName: string;
  username: string;
  avatarEmoji: string;
  trustScore: number;
  balance: number;   // liquid cash in wallet
  loanedOut: number; // money lent TO friends (they owe this back to you)
  borrowed: number;  // money borrowed FROM friends (you owe this back to them)
  streak: number;
  repaid: number;
  missed: number;
  totalBorrowed: number;
  totalLent: number;
  timesBorrowed: number;
  timesLent: number;
  points: number;
  age: number;
  mobile: string;
  email: string;
  password: string;
  profileImageUrl?: string;
  biometricEnabled: boolean;
}

interface ParentProfile {
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  mobile: string;
  password: string;
  address: string;
  safetyPoolLimit: number;
  safetyPoolUsed: number;
  weeklyAllowance: number;
  allowanceFrequency: string;    // 'weekly' | 'fortnightly' | 'monthly'
  allowanceNextPayment: string;  // ISO date string or ''
  allowanceActive: boolean;
  passcode: string;              // kept for cache backward-compat migration only
  passcodeHash: string;          // SHA-256(userId:pin) — used for all new logins
  passcodeCreated: boolean;      // true once a passcode has been set up
  marketingNotifications: boolean;
  profileImageUrl?: string;
}

interface AppContextType {
  paymentMethods: PaymentMethod[];
  addPaymentMethod: (m: PaymentMethod) => void;
  removePaymentMethod: (id: string) => void;
  setDefaultPaymentMethod: (id: string) => void;
  isOnboarded: boolean;
  setIsOnboarded: (v: boolean) => void;
  isChildLoggedIn: boolean;
  setIsChildLoggedIn: (v: boolean) => void;
  child: ChildProfile;
  setChild: React.Dispatch<React.SetStateAction<ChildProfile>>;
  childId: string | null;
  setChildId: (id: string | null) => void;
  pendingRequests: PendingRequest[];
  setPendingRequests: React.Dispatch<React.SetStateAction<PendingRequest[]>>;
  parent: ParentProfile;
  setParent: React.Dispatch<React.SetStateAction<ParentProfile>>;
  circle: CircleMember[];
  setCircle: React.Dispatch<React.SetStateAction<CircleMember[]>>;
  transactions: Transaction[];
  activeRequests: ActiveRequest[];
  setActiveRequests: React.Dispatch<React.SetStateAction<ActiveRequest[]>>;
  activityFeed: ActivityItem[];
  addActivity: (item: ActivityItem) => void;
  removeActivity: (id: string) => void;
  frozenAccount: boolean;
  setFrozenAccount: (v: boolean) => void;
  parentDebt: number;
  setParentDebt: (v: number) => void;
  adjustTrustScore: (delta: number) => void;
  repayOnTime: () => void;
  lendMoney: () => void;
  missRepayment: (amount: number) => void;
  repayParent: () => void;
  addTransaction: (t: Transaction) => void;
  userId: string | null;
  setUserId: (id: string | null) => void;
  saveOnboardingToDb: (childOverride?: { displayName?: string; username?: string; password?: string; mobile?: string; age?: number }) => Promise<void>;
  savePasscodeToDb: (passcode: string) => Promise<void>;
  setupSafetyPool: (amount: number) => Promise<void>;
  topUpSafetyPool: (amount: number) => Promise<void>;
  saveAllowanceToDb: (amount: number, frequency: string, nextPayment: string | null, active: boolean) => Promise<void>;
  setMarketingNotifications: (value: boolean) => Promise<void>;
  recordWeeklyStreak: () => Promise<void>;
  biometricEnabled: boolean;
  setBiometricEnabled: (v: boolean) => void;
}

const defaultCircle: CircleMember[] = [];
const defaultTransactions: Transaction[] = [];
const defaultRequests: ActiveRequest[] = [];
const defaultActivity: ActivityItem[] = [];

const AppContext = createContext<AppContextType>({} as AppContextType);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  const addPaymentMethod = (m: PaymentMethod) =>
    setPaymentMethods(prev => prev.some(p => p.id === m.id) ? prev : [...prev, m]);

  const removePaymentMethod = (id: string) =>
    setPaymentMethods(prev => prev.filter(p => p.id !== id));

  const setDefaultPaymentMethod = (id: string) =>
    setPaymentMethods(prev => prev.map(p => ({ ...p, isDefault: p.id === id })));

  const [isOnboarded, setIsOnboarded] = useState(false);
  const [isChildLoggedIn, setIsChildLoggedIn] = useState(false);
  const [frozenAccount, setFrozenAccount] = useState(false);
  const [parentDebt, setParentDebt] = useState(0);
  const [circle, setCircle] = useState<CircleMember[]>(defaultCircle);
  const [childId, setChildId] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>(defaultTransactions);
  const [activeRequests, setActiveRequests] = useState<ActiveRequest[]>(defaultRequests);
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>(defaultActivity);
  const [userId, setUserId] = useState<string | null>(null);

  const [child, setChild] = useState<ChildProfile>({
    displayName: '',
    username: '',
    avatarEmoji: '😊',
    trustScore: 50,
    balance: 0,
    loanedOut: 0,
    borrowed: 0,
    streak: 0,
    repaid: 0,
    missed: 0,
    totalBorrowed: 0,
    totalLent: 0,
    timesBorrowed: 0,
    timesLent: 0,
    points: 0,
    age: 16,
    mobile: '',
    email: '',
    password: '',
    biometricEnabled: false,
  });

  const [biometricEnabled, setBiometricEnabled] = useState(false);

  const [parent, setParent] = useState<ParentProfile>({
    firstName: '',
    lastName: '',
    displayName: '',
    email: '',
    mobile: '',
    password: '',
    address: '',
    safetyPoolLimit: 0,
    safetyPoolUsed: 0,
    weeklyAllowance: 10,
    allowanceFrequency: 'weekly',
    allowanceNextPayment: '',
    allowanceActive: false,
    passcode: '',
    passcodeHash: '',
    passcodeCreated: false,
    marketingNotifications: false,
  });

  // Tracks whether the initial AsyncStorage hydration has completed.
  // Cache writes are gated on this so the in-memory defaults never
  // overwrite real cached data on the first render.
  const hydrated = useRef(false);
  const childIdRef = useRef<string | null>(null);

  // Hydrate from local cache on mount (instant), then background-sync from DB.
  useEffect(() => {
    const hydrate = async () => {
      const [cachedParent, cachedChild, cachedUserId] = await Promise.all([
        cache.loadParent<Partial<typeof parent>>(),
        cache.loadChild<Partial<typeof child> & { childId?: string }>(),
        cache.loadUserId(),
      ]);
      if (cachedParent) setParent(p => ({ ...p, ...cachedParent }));
      if (cachedChild) {
        setChild(c => ({ ...c, ...cachedChild }));
        if (cachedChild.childId) setChildId(cachedChild.childId);
      }
      if (cachedUserId) setUserId(cachedUserId);
      hydrated.current = true;
    };
    hydrate();
  }, []);

  // Keep the local cache in sync after every state update.
  useEffect(() => { if (hydrated.current) cache.saveParent(parent); }, [parent]);
  useEffect(() => {
    if (hydrated.current) {
      // Always persist childId alongside child data so it survives polling updates
      cache.saveChild({ ...child, ...(childId ? { childId } : {}) });
    }
  }, [child, childId]);
  useEffect(() => { childIdRef.current = childId; }, [childId]);

  const adjustTrustScore = (delta: number) => {
    setChild(c => ({
      ...c,
      trustScore: Math.max(0, Math.min(100, c.trustScore + delta)),
      points: Math.max(0, c.points + delta),
    }));
  };

  const repayOnTime = () => {
    setChild(c => ({
      ...c,
      trustScore: Math.min(100, c.trustScore + 5),
      points: Math.max(0, c.points + 5),
      repaid: c.repaid + 1,
    }));
  };

  const lendMoney = () => {
    setChild(c => ({
      ...c,
      trustScore: Math.min(100, c.trustScore + 2),
      points: Math.max(0, c.points + 2),
    }));
  };

  // Calls the DB's weekly streak RPC and updates local streak from the result.
  const recordWeeklyStreak = async () => {
    if (!childIdRef.current) return;
    const newStreak = await db.recordWeeklyStreak(childIdRef.current);
    if (newStreak > 0) {
      setChild(c => ({ ...c, streak: newStreak }));
    }
  };

  const missRepayment = (amount: number) => {
    setFrozenAccount(true);
    setParentDebt(amount);
    setChild(c => ({
      ...c,
      trustScore: Math.max(0, c.trustScore - 15),
      points: Math.max(0, c.points - 15),
      streak: 0,
      missed: c.missed + 1,
      borrowed: Math.max(0, c.borrowed - amount), // parent safety pool covers it
    }));
    setParent(p => ({
      ...p,
      safetyPoolUsed: Math.min(p.safetyPoolLimit, p.safetyPoolUsed + amount),
    }));
  };

  const repayParent = () => {
    const debt = parentDebt;
    // Optimistic update
    setChild(c => ({ ...c, balance: Math.max(0, c.balance - debt) }));
    setParent(p => ({ ...p, safetyPoolUsed: Math.max(0, p.safetyPoolUsed - debt) }));
    setParentDebt(0);
    setFrozenAccount(false);
    // Persist: clear parent_debt, restore safety pool, unfreeze in DB
    if (childIdRef.current && userId) {
      db.confirmParentRepayment(childIdRef.current, userId).catch(err =>
        console.warn('[Truzo] confirmParentRepayment failed:', err)
      );
    }
  };

  const addTransaction = (t: Transaction) => {
    setTransactions(prev => [t, ...prev]);
  };

  const addActivity = (item: ActivityItem) => {
    const stamped = { ...item, createdAt: item.createdAt ?? new Date().toISOString() };
    setActivityFeed(prev => [stamped, ...prev]);
    if (childIdRef.current) {
      db.addActivityItem(childIdRef.current, item.id, item.emoji, item.text, item.type).catch(() => {});
    }
  };

  const removeActivity = (id: string) => {
    setActivityFeed(prev => prev.filter(a => a.id !== id));
  };

  const saveOnboardingToDb = async (childOverride?: { displayName?: string; username?: string; password?: string; mobile?: string; age?: number }) => {
    const uid = await db.saveOnboarding({
      email:    parent.email,
      password: parent.password,
      parent: {
        firstName:              parent.firstName,
        lastName:               parent.lastName,
        displayName:            parent.displayName,
        mobile:                 parent.mobile,
        address:                parent.address,
        safetyPoolLimit:        parent.safetyPoolLimit,
        weeklyAllowance:        parent.weeklyAllowance,
        marketingNotifications: parent.marketingNotifications,
      },
      child: {
        displayName:   childOverride?.displayName   ?? child.displayName,
        username:      childOverride?.username      ?? child.username,
        password:      childOverride?.password      ?? child.password,
        mobile:        childOverride?.mobile        ?? child.mobile,
        age:           childOverride?.age           ?? child.age,
        avatarEmoji:   child.avatarEmoji,
        trustScore:    50,
        balance:       0,
        loanedOut:     0,
        borrowed:      0,
        streak:        0,
        repaid:        0,
        missed:        0,
        totalBorrowed: 0,
        totalLent:     0,
        points:        0,
      },
    });
    setUserId(uid);
    await cache.saveUserId(uid);
    // Clear any stale child identity from a previous session so the fast-path
    // login check in ChildLoginScreen can't fire with the wrong child UUID.
    setChildId(null);
    // New account has no passcode yet. Clear any stale passcode data that
    // may have been left in cache from a previous session or account.
    setParent(p => ({ ...p, passcode: '', passcodeHash: '', passcodeCreated: false }));
  };

  const savePasscodeToDb = async (passcodeHash: string) => {
    if (!userId) return;
    await db.updatePasscodeHash(userId, passcodeHash);
  };

  const setupSafetyPool = async (amount: number) => {
    setParent(p => ({ ...p, safetyPoolLimit: amount, safetyPoolUsed: 0 }));
    if (userId) await db.setupSafetyPool(userId, amount);
  };

  const topUpSafetyPool = async (amount: number) => {
    if (!userId) return;
    const newLimit = await db.topUpSafetyPool(userId, amount);
    setParent(p => ({ ...p, safetyPoolLimit: newLimit }));
  };

  const saveAllowanceToDb = async (amount: number, frequency: string, nextPayment: string | null, active: boolean) => {
    setParent(p => ({
      ...p,
      weeklyAllowance:     amount,
      allowanceFrequency:  frequency,
      allowanceNextPayment: nextPayment ?? '',
      allowanceActive:     active,
    }));
    if (userId) await db.updateAllowance(userId, amount, frequency, nextPayment, active);
  };

  const setMarketingNotifications = async (value: boolean) => {
    setParent(p => ({ ...p, marketingNotifications: value }));
    if (userId) await db.updateMarketingPreference(userId, value);
  };

  // Refresh parent financial data whenever userId is available (on login + every 30 s).
  useEffect(() => {
    if (!userId) return;
    const refresh = () => {
      db.getParentStats(userId).then(stats => {
        if (!stats) return;
        setParent(p => ({
          ...p,
          safetyPoolLimit:     stats.safety_pool_limit,
          safetyPoolUsed:      stats.safety_pool_used,
          weeklyAllowance:     stats.weekly_allowance,
          allowanceFrequency:  stats.allowance_frequency ?? 'weekly',
          allowanceNextPayment: stats.allowance_next_payment ?? '',
          allowanceActive:     stats.allowance_active ?? false,
        }));
      }).catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [userId]);

  // Poll every 5 seconds while a child is logged in — picks up new friend requests, circle changes, and resolved sent requests
  useEffect(() => {
    if (!childId) return;
    const seenRequestIds = new Set<string>();
    const seenResolvedIds = new Set<string>();
    const seenFundedIds = new Set<string>();
    const seenMoneyRequestIds = new Set<string>();
    const seenExpiredIds = new Set<string>();
    // Each flag turns true after the FIRST async response for that call,
    // so pre-existing DB rows are silently seeded without generating feed items.
    let pendingFirstDone = false;
    let resolvedFirstDone = false;
    let fundedFirstDone = false;
    let moneyReqFirstDone = false;
    let expiredFirstDone = false;

    const deadlineDaysToLabel = (days: number) => {
      if (days === 1) return '1d';
      if (days === 3) return '3d';
      if (days === 7) return '1w';
      if (days === 14) return '2w';
      return `${days}d`;
    };
    const formatCreatedAt = (iso: string) => {
      const hours = (Date.now() - new Date(iso).getTime()) / 3600000;
      if (hours < 1) return 'Just now';
      if (hours < 24) return `${Math.floor(hours)}h ago`;
      return `${Math.floor(hours / 24)}d ago`;
    };
    const expiresInHours = (iso: string) =>
      Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3600000));

    const poll = async () => {
      // Each call is independent — one failing cannot block the others

      // 0. Activity feed — merged on every cycle so:
      //    a) DB-written items from counterparty RPCs appear without re-login.
      //    b) Optimistic items added this tick (before this fetch resolved) are not lost.
      //    Sorted by created_at DESC so newest is always first regardless of RPC order.
      db.getActivityFeed(childId).then(items => {
        const dbIds = new Set(items.map(i => i.id));
        const dbMapped: ActivityItem[] = items.map(i => ({
          id: i.id,
          emoji: i.emoji,
          text: i.text,
          time: formatCreatedAt(i.created_at),
          type: i.type as ActivityItem['type'],
          createdAt: i.created_at,
        }));
        setActivityFeed(prev => {
          // Preserve any optimistic items not yet persisted to DB
          const optimistic = prev.filter(a => !dbIds.has(a.id));
          return [...optimistic, ...dbMapped].sort((a, b) => {
            const ta = a.createdAt ? new Date(a.createdAt).getTime() : Date.now();
            const tb = b.createdAt ? new Date(b.createdAt).getTime() : Date.now();
            return tb - ta;
          });
        });
      }).catch(() => {});

      // 0a. Transaction history from DB (live for both parties)
      db.getChildTransactions(childId).then(txs => {
        setTransactions(txs.map(t => ({
          id: t.id,
          type: t.type as Transaction['type'],
          amount: t.amount,
          description: t.description,
          date: formatCreatedAt(t.created_at),
          counterparty: t.counterparty ?? undefined,
          status: 'completed' as const,
        })));
      }).catch(() => {});

      // 0b. Child's own financials — balance, borrowed, loaned_out, trust score, frozen state
      db.getChildStats(childId).then(stats => {
        if (!stats) return;
        setChild(c => ({
          ...c,
          balance:         stats.wallet_balance,
          loanedOut:       stats.loaned_out,
          borrowed:        stats.borrowed,
          trustScore:      stats.trust_score,
          points:          stats.points,
          streak:          stats.streak,
          repaid:          stats.repaid,
          missed:          stats.missed,
          totalBorrowed:   stats.total_borrowed,
          totalLent:       stats.total_lent,
          timesBorrowed:   stats.times_borrowed,
          timesLent:       stats.times_lent,
          profileImageUrl: stats.profile_image_url ?? c.profileImageUrl,
        }));
        setFrozenAccount(stats.account_frozen ?? false);
        setParentDebt(stats.parent_debt ?? 0);
      }).catch(() => {});

      // 0c. Overdue funded loans — process defaults atomically on the server
      db.getOverdueFundedLoans(childId).then(overdue => {
        overdue.forEach(({ request_id }) => {
          db.processLoanDefault(request_id).catch(() => {});
        });
      }).catch(() => {});

      // 1. Circle members (most critical — must always succeed)
      db.getCircle(childId).then(members => {
        setCircle(members.map(m => ({
          id: m.id, displayName: m.display_name,
          username: m.username, avatarEmoji: m.avatar_emoji, trustScore: m.trust_score,
          profileImageUrl: m.avatar_url ?? undefined,
        })));
      }).catch(() => {});

      // 2. Incoming friend requests
      db.getPendingRequests(childId).then(requests => {
        const mapped = requests.map(r => ({
          requestId: r.request_id, id: r.id, displayName: r.display_name,
          username: r.username, avatarEmoji: r.avatar_emoji,
          trustScore: r.trust_score, createdAt: r.created_at,
          profileImageUrl: r.avatar_url ?? undefined,
        }));
        mapped.forEach(req => {
          if (!seenRequestIds.has(req.requestId)) {
            seenRequestIds.add(req.requestId);
            if (pendingFirstDone) {
              addActivity({
                id: `req_${req.requestId}`,
                emoji: '👋',
                text: `${req.displayName} wants to join your circle`,
                time: 'Just now',
                type: 'request' as const,
              });
            }
          }
        });
        pendingFirstDone = true;
        setPendingRequests(mapped);
      }).catch(() => {});

      // 3. Resolved sent requests (accepted / declined by others)
      db.getResolvedSentRequests(childId).then(resolved => {
        resolved.forEach(req => {
          if (!seenResolvedIds.has(req.request_id)) {
            seenResolvedIds.add(req.request_id);
            if (resolvedFirstDone) {
              if (req.status === 'accepted') {
                addActivity({
                  id: `resolved_${req.request_id}`,
                  emoji: '✅',
                  text: `${req.display_name} accepted your friend request — you're now in each other's circles!`,
                  time: 'Just now',
                  type: 'joined' as const,
                });
              } else {
                addActivity({
                  id: `resolved_${req.request_id}`,
                  emoji: '❌',
                  text: `${req.display_name} declined your friend request`,
                  time: 'Just now',
                  type: 'request' as const,
                });
              }
            }
          }
        });
        resolvedFirstDone = true;
      }).catch(() => {});

      // 4. Active money requests from self + circle
      db.getActiveRequests(childId).then(moneyReqs => {
        const now = Date.now();
        const isExpired = (r: typeof moneyReqs[0]) =>
          r.status === 'pending' && new Date(r.expires_at).getTime() <= now;

        moneyReqs.forEach(r => {
          // Detect own requests that just became funded → notify borrower
          if (r.is_own && r.status === 'funded' && r.funded_by_name && !seenFundedIds.has(r.id)) {
            seenFundedIds.add(r.id);
            if (fundedFirstDone) {
              addActivity({
                id: `funded_${r.id}`,
                emoji: '💚',
                text: `${r.funded_by_name} funded your request of £${fmtAmt(Number(r.amount))}!`,
                time: 'Just now',
                type: 'funded' as const,
              });
            }
          }
          // Detect new pending requests from circle members → notify everyone in their circle
          if (!r.is_own && r.status === 'pending' && !isExpired(r) && !seenMoneyRequestIds.has(r.id)) {
            seenMoneyRequestIds.add(r.id);
            if (moneyReqFirstDone) {
              addActivity({
                id: `moneyreq_${r.id}`,
                emoji: '💸',
                text: `${r.from_name} needs £${fmtAmt(Number(r.amount))} for ${r.reason}`,
                time: 'Just now',
                type: 'request' as const,
              });
            }
          }
          // Detect own pending requests that just expired → notify requester
          if (r.is_own && isExpired(r) && !seenExpiredIds.has(r.id)) {
            seenExpiredIds.add(r.id);
            if (expiredFirstDone) {
              addActivity({
                id: `expired_${r.id}`,
                emoji: '⏰',
                text: `Your request for £${fmtAmt(Number(r.amount))} expired unfunded`,
                time: 'Just now',
                type: 'missed' as const,
              });
            }
          }
        });
        fundedFirstDone = true;
        moneyReqFirstDone = true;
        expiredFirstDone = true;

        // Exclude expired pending requests — they drop off everyone's circle page
        // via this same poll; funded requests are kept until repaid.
        setActiveRequests(() =>
          moneyReqs
            .filter(r => !isExpired(r))
            .map(r => ({
              id: r.id,
              fromId: r.from_id,
              fromName: r.from_name,
              fromEmoji: r.from_emoji,
              fromTrust: r.from_trust,
              amount: r.amount,
              reason: r.reason,
              reasonEmoji: r.reason_emoji,
              deadline: deadlineDaysToLabel(r.deadline_days),
              repayByDate: r.repay_by_date,
              expiresIn: expiresInHours(r.expires_at),
              createdAt: formatCreatedAt(r.created_at),
              isOwn: r.is_own,
              isFunded: r.status === 'funded',
              fundedById: r.funded_by ?? undefined,
              fundedByName: r.funded_by_name ?? undefined,
              fundedByEmoji: r.funded_by_emoji ?? undefined,
            }))
        );
      }).catch(() => {});
    };
    // On login, expire streak to 0 if the child missed an entire ISO week
    db.checkStreakExpiry(childId).then(freshStreak => {
      if (freshStreak >= 0) setChild(c => ({ ...c, streak: freshStreak }));
    }).catch(() => {});

    poll(); // immediate first fetch
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [childId]);

  return (
    <AppContext.Provider value={{
      paymentMethods, addPaymentMethod, removePaymentMethod, setDefaultPaymentMethod,
      isOnboarded, setIsOnboarded,
      isChildLoggedIn, setIsChildLoggedIn,
      child, setChild,
      childId, setChildId,
      pendingRequests, setPendingRequests,
      parent, setParent,
      circle, setCircle,
      transactions,
      activeRequests, setActiveRequests,
      activityFeed, addActivity, removeActivity,
      frozenAccount, setFrozenAccount,
      parentDebt, setParentDebt,
      adjustTrustScore,
      repayOnTime, lendMoney, missRepayment, repayParent,
      addTransaction,
      userId, setUserId,
      saveOnboardingToDb,
      savePasscodeToDb,
      setupSafetyPool,
      topUpSafetyPool,
      saveAllowanceToDb,
      setMarketingNotifications,
      recordWeeklyStreak,
      biometricEnabled,
      setBiometricEnabled,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);
