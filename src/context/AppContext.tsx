import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { cache } from '../lib/cache';
import { db } from '../lib/database';

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
}

export interface Transaction {
  id: string;
  type: 'borrow' | 'lend' | 'repay' | 'receive' | 'topup' | 'spend' | 'allowance';
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
}

export interface ActivityItem {
  id: string;
  emoji: string;
  text: string;
  time: string;
  type: 'request' | 'funded' | 'repaid' | 'missed' | 'joined' | 'tier' | 'topup' | 'spend';
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
  passcode: string;
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
  frozenAccount: boolean;
  setFrozenAccount: (v: boolean) => void;
  parentDebt: number;
  adjustTrustScore: (delta: number) => void;
  repayOnTime: () => void;
  lendMoney: () => void;
  missRepayment: (amount: number) => void;
  repayParent: () => void;
  addTransaction: (t: Transaction) => void;
  userId: string | null;
  saveOnboardingToDb: () => Promise<void>;
  savePasscodeToDb: (passcode: string) => Promise<void>;
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
  });

  const [parent, setParent] = useState<ParentProfile>({
    firstName: '',
    lastName: '',
    displayName: 'Sarah',
    email: 'sarah@example.com',
    mobile: '+44 7700 900000',
    password: 'Password1',
    address: '123 Example Street, London, SW1A 1AA',
    safetyPoolLimit: 50,
    safetyPoolUsed: 0,
    weeklyAllowance: 10,
    passcode: '',
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
  useEffect(() => { if (hydrated.current) cache.saveChild(child);   }, [child]);
  useEffect(() => { childIdRef.current = childId; }, [childId]);

  const adjustTrustScore = (delta: number) => {
    setChild(c => ({
      ...c,
      trustScore: Math.max(0, Math.min(100, c.trustScore + delta)),
      points: Math.max(0, c.points + delta),
    }));
  };

  const repayOnTime = () => {
    setChild(c => {
      const newStreak = c.streak + 1;
      const bonus = newStreak === 3 ? 3 : newStreak === 5 ? 5 : newStreak === 10 ? 10 : 0;
      const gain = 5 + bonus;
      return {
        ...c,
        trustScore: Math.min(100, c.trustScore + gain),
        points: Math.max(0, c.points + gain),
        streak: newStreak,
        repaid: c.repaid + 1,
      };
    });
  };

  const lendMoney = () => {
    setChild(c => ({
      ...c,
      trustScore: Math.min(100, c.trustScore + 2),
      points: Math.max(0, c.points + 2),
    }));
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
    setChild(c => ({ ...c, balance: Math.max(0, c.balance - parentDebt) }));
    setParent(p => ({ ...p, safetyPoolUsed: Math.max(0, p.safetyPoolUsed - parentDebt) }));
    setParentDebt(0);
    setFrozenAccount(false);
  };

  const addTransaction = (t: Transaction) => {
    setTransactions(prev => [t, ...prev]);
  };

  const addActivity = (item: ActivityItem) => {
    setActivityFeed(prev => [item, ...prev]);
    if (childIdRef.current) {
      db.addActivityItem(childIdRef.current, item.id, item.emoji, item.text, item.type).catch(() => {});
    }
  };

  const saveOnboardingToDb = async () => {
    const uid = await db.saveOnboarding({
      email:    parent.email,
      password: parent.password,
      parent: {
        firstName:       parent.firstName,
        lastName:        parent.lastName,
        displayName:     parent.displayName,
        mobile:          parent.mobile,
        address:         parent.address,
        safetyPoolLimit: parent.safetyPoolLimit,
        weeklyAllowance: parent.weeklyAllowance,
      },
      child: {
        displayName:   child.displayName,
        username:      child.username,
        password:      child.password,
        mobile:        child.mobile,
        age:           child.age,
        avatarEmoji:   child.avatarEmoji,
        trustScore:    child.trustScore,
        balance:       child.balance,
        loanedOut:     child.loanedOut,
        borrowed:      child.borrowed,
        streak:        child.streak,
        repaid:        child.repaid,
        missed:        child.missed,
        totalBorrowed: child.totalBorrowed,
        totalLent:     child.totalLent,
        points:        child.points,
      },
    });
    setUserId(uid);
    await cache.saveUserId(uid);
  };

  const savePasscodeToDb = async (passcode: string) => {
    if (!userId) return;
    await db.updatePasscode(userId, passcode);
  };

  // Poll every 5 seconds while a child is logged in — picks up new friend requests, circle changes, and resolved sent requests
  useEffect(() => {
    if (!childId) return;
    const seenRequestIds = new Set<string>();
    const seenResolvedIds = new Set<string>();
    const seenFundedIds = new Set<string>();
    const seenMoneyRequestIds = new Set<string>();
    // Each flag turns true after the FIRST async response for that call,
    // so pre-existing DB rows are silently seeded without generating feed items.
    let pendingFirstDone = false;
    let resolvedFirstDone = false;
    let fundedFirstDone = false;
    let moneyReqFirstDone = false;

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

    // Load persisted activity feed from DB so history survives logout/login
    db.getActivityFeed(childId).then(items => {
      if (items.length === 0) return;
      setActivityFeed(items.map(i => ({
        id: i.id,
        emoji: i.emoji,
        text: i.text,
        time: formatCreatedAt(i.created_at),
        type: i.type as ActivityItem['type'],
      })));
    }).catch(() => {});

    const poll = async () => {
      // Each call is independent — one failing cannot block the others

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

      // 0b. Child's own financials — balance, borrowed, loaned_out, trust score
      db.getChildStats(childId).then(stats => {
        if (!stats) return;
        setChild(c => ({
          ...c,
          balance:       stats.wallet_balance,
          loanedOut:     stats.loaned_out,
          borrowed:      stats.borrowed,
          trustScore:    stats.trust_score,
          points:        stats.points,
          streak:        stats.streak,
          repaid:        stats.repaid,
          missed:        stats.missed,
          totalBorrowed: stats.total_borrowed,
          totalLent:     stats.total_lent,
          timesBorrowed: stats.times_borrowed,
          timesLent:     stats.times_lent,
        }));
      }).catch(() => {});

      // 1. Circle members (most critical — must always succeed)
      db.getCircle(childId).then(members => {
        setCircle(members.map(m => ({
          id: m.id, displayName: m.display_name,
          username: m.username, avatarEmoji: m.avatar_emoji, trustScore: m.trust_score,
        })));
      }).catch(() => {});

      // 2. Incoming friend requests
      db.getPendingRequests(childId).then(requests => {
        const mapped = requests.map(r => ({
          requestId: r.request_id, id: r.id, displayName: r.display_name,
          username: r.username, avatarEmoji: r.avatar_emoji,
          trustScore: r.trust_score, createdAt: r.created_at,
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
        moneyReqs.forEach(r => {
          // Detect own requests that just became funded → notify borrower
          if (r.is_own && r.status === 'funded' && r.funded_by_name && !seenFundedIds.has(r.id)) {
            seenFundedIds.add(r.id);
            if (fundedFirstDone) {
              addActivity({
                id: `funded_${r.id}`,
                emoji: '💚',
                text: `${r.funded_by_name} funded your request of £${Number(r.amount).toFixed(2)}!`,
                time: 'Just now',
                type: 'funded' as const,
              });
            }
          }
          // Detect new pending requests from circle members → notify everyone in their circle
          if (!r.is_own && r.status === 'pending' && !seenMoneyRequestIds.has(r.id)) {
            seenMoneyRequestIds.add(r.id);
            if (moneyReqFirstDone) {
              addActivity({
                id: `moneyreq_${r.id}`,
                emoji: '💸',
                text: `${r.from_name} needs £${Number(r.amount).toFixed(2)} for ${r.reason}`,
                time: 'Just now',
                type: 'request' as const,
              });
            }
          }
        });
        fundedFirstDone = true;
        moneyReqFirstDone = true;

        setActiveRequests(() =>
          moneyReqs.map(r => ({
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
      activityFeed, addActivity,
      frozenAccount, setFrozenAccount,
      parentDebt,
      adjustTrustScore,
      repayOnTime, lendMoney, missRepayment, repayParent,
      addTransaction,
      userId,
      saveOnboardingToDb,
      savePasscodeToDb,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);
