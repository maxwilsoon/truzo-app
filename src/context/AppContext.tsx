import React, { createContext, useContext, useState } from 'react';

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
  type: 'borrow' | 'lend' | 'repay' | 'topup' | 'spend' | 'allowance';
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
  points: number;
  age: number;
  mobile: string;
  email: string;
  password: string;
}

interface ParentProfile {
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
  parent: ParentProfile;
  setParent: React.Dispatch<React.SetStateAction<ParentProfile>>;
  circle: CircleMember[];
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
}

const defaultCircle: CircleMember[] = [
  { id: '2', displayName: 'Maya',  username: 'maya_s',  avatarEmoji: '🦋', trustScore: 72 },
  { id: '3', displayName: 'Sam',   username: 'sam_b',   avatarEmoji: '🎮', trustScore: 45 },
  { id: '4', displayName: 'Jordan', username: 'jordan_k', avatarEmoji: '🏀', trustScore: 88 },
  { id: '5', displayName: 'Riley', username: 'riley_m', avatarEmoji: '🎵', trustScore: 61 },
  { id: '6', displayName: 'Zara',  username: 'zara_x',  avatarEmoji: '🌸', trustScore: 79 },
  { id: '7', displayName: 'Leo',   username: 'leo_g',   avatarEmoji: '🦁', trustScore: 55 },
  { id: '8', displayName: 'Priya', username: 'priya_v', avatarEmoji: '⭐', trustScore: 91 },
  { id: '9', displayName: 'Jake',  username: 'jake_r',  avatarEmoji: '🚀', trustScore: 38 },
];

const defaultTransactions: Transaction[] = [
  { id: 't1', type: 'topup', amount: 20, description: 'Pocket money', date: '2 days ago', status: 'completed' },
  { id: 't2', type: 'spend', amount: -4.5, description: 'Starbucks', date: '3 days ago', status: 'completed' },
  { id: 't3', type: 'lend', amount: -15, description: 'Lent to Maya', date: '1 week ago', counterparty: 'Maya', status: 'active' },
  { id: 't4', type: 'allowance', amount: 10, description: 'Weekly allowance', date: '1 week ago', status: 'completed' },
  { id: 't5', type: 'repay', amount: 10, description: 'Repaid to Jordan', date: '2 weeks ago', counterparty: 'Jordan', status: 'completed' },
];

const defaultRequests: ActiveRequest[] = [
  {
    id: 'r1',
    fromId: '2',
    fromName: 'Maya',
    fromEmoji: '🦋',
    fromTrust: 72,
    amount: 25,
    reason: 'Bus pass',
    reasonEmoji: '🚌',
    deadline: '3 days',
    repayByDate: '12 Jun',
    expiresIn: 18,
    createdAt: '2h ago',
  },
];

const defaultActivity: ActivityItem[] = [
  { id: 'a1',  emoji: '🔔', text: 'Maya requested £25 for a bus pass', time: '2h ago', type: 'request' },
  { id: 'a2',  emoji: '💚', text: 'Zara funded Maya\'s request for £25', time: '3h ago', type: 'funded' },
  { id: 'a3',  emoji: '🔔', text: 'Leo requested £15 for food 🍕', time: '5h ago', type: 'request' },
  { id: 'a4',  emoji: '✅', text: 'Priya repaid Jordan £30 on time · +5 pts streak', time: '8h ago', type: 'repaid' },
  { id: 'a5',  emoji: '💚', text: 'You funded Jordan\'s request for £25 · +2 pts', time: '1d ago', type: 'funded' },
  { id: 'a6',  emoji: '🔔', text: 'Jake requested £20 for transport 🚌', time: '1d ago', type: 'request' },
  { id: 'a7',  emoji: '⚠️', text: 'Sam missed a repayment to Riley · −15 pts', time: '2d ago', type: 'missed' },
  { id: 'a8',  emoji: '💰', text: 'Riley repaid £20 to you on time', time: '2d ago', type: 'repaid' },
  { id: 'a9',  emoji: '💚', text: 'Jordan funded Leo\'s request for £15', time: '3d ago', type: 'funded' },
  { id: 'a10', emoji: '🔔', text: 'Zara requested £10 for school supplies 📚', time: '3d ago', type: 'request' },
  { id: 'a11', emoji: '✅', text: 'You repaid Maya £15 on time · +1 pt streak', time: '4d ago', type: 'repaid' },
  { id: 'a12', emoji: '🤝', text: 'Priya joined your circle', time: '5d ago', type: 'joined' },
  { id: 'a13', emoji: '🤝', text: 'Jake joined your circle', time: '5d ago', type: 'joined' },
  { id: 'a14', emoji: '⚠️', text: 'Jake missed a repayment to Zara · −15 pts', time: '6d ago', type: 'missed' },
  { id: 'a15', emoji: '🏆', text: 'Priya reached Elite tier! · 91 pts', time: '1w ago', type: 'tier' },
  { id: 'a16', emoji: '🏆', text: 'You reached Reliable tier! · 50 pts', time: '1w ago', type: 'tier' },
  { id: 'a17', emoji: '💰', text: 'Jordan repaid Sam £25 on time', time: '1w ago', type: 'repaid' },
  { id: 'a18', emoji: '🤝', text: 'Zara joined your circle', time: '2w ago', type: 'joined' },
  { id: 'a19', emoji: '🤝', text: 'Leo joined your circle', time: '2w ago', type: 'joined' },
];

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
  const [circle] = useState<CircleMember[]>(defaultCircle);
  const [transactions, setTransactions] = useState<Transaction[]>(defaultTransactions);
  const [activeRequests, setActiveRequests] = useState<ActiveRequest[]>(defaultRequests);
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>(defaultActivity);

  const [child, setChild] = useState<ChildProfile>({
    displayName: 'Alex',
    username: 'alex_t',
    avatarEmoji: '😊',
    trustScore: 50,
    balance: 65.50,
    loanedOut: 0,
    borrowed: 25,
    streak: 0,
    repaid: 5,
    missed: 0,
    totalBorrowed: 60,
    totalLent: 45,
    points: 0,
    age: 16,
    mobile: '07700000014',
    email: '',
    password: '12345678',
  });

  const [parent, setParent] = useState<ParentProfile>({
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
  };

  return (
    <AppContext.Provider value={{
      paymentMethods, addPaymentMethod, removePaymentMethod, setDefaultPaymentMethod,
      isOnboarded, setIsOnboarded,
      isChildLoggedIn, setIsChildLoggedIn,
      child, setChild,
      parent, setParent,
      circle, transactions,
      activeRequests, setActiveRequests,
      activityFeed, addActivity,
      frozenAccount, setFrozenAccount,
      parentDebt,
      adjustTrustScore,
      repayOnTime, lendMoney, missRepayment, repayParent,
      addTransaction,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);
