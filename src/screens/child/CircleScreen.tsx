import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Dimensions, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { colors, getTierInfo } from '../../theme/colors';
import { ActiveRequest, useApp } from '../../context/AppContext';
import { ConfirmSheet } from '../../components/ConfirmSheet';

const AVATAR_COLORS = ['#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#8B5CF6', '#EC4899'];
const PAGE_WIDTH = Dimensions.get('window').width - 32; // 16px padding each side
const ITEM_WIDTH = PAGE_WIDTH / 4;

const HISTORY = [
  {
    id: 'h1', name: 'Riley Kim',    initial: 'R', color: '#F59E0B',
    title: 'Lent to Riley Kim',     reason: 'New art supplies 🎨',
    amount: 20,  time: '10d ago',   status: 'Repaid',  statusColor: '#16A34A', statusBg: '#F0FDF4',
  },
  {
    id: 'h2', name: 'Maya Singh',   initial: 'M', color: '#10B981',
    title: 'Funded Maya\'s request', reason: 'Bus pass 🚌',
    amount: 25,  time: '2 weeks ago', status: 'Repaid', statusColor: '#16A34A', statusBg: '#F0FDF4',
  },
  {
    id: 'h3', name: 'Jordan Lee',   initial: 'J', color: '#3B82F6',
    title: 'Borrowed from Jordan',  reason: 'Transport 🚌',
    amount: 25,  time: '3 weeks ago', status: 'Repaid', statusColor: '#16A34A', statusBg: '#F0FDF4',
  },
];

const ACTIVE_LOAN = {
  lenderName: 'Jordan Lee', lenderInitial: 'J', lenderColor: '#3B82F6',
  amount: 25, reason: 'Transport', reasonEmoji: '🚌',
  dueIn: '3d', deadline: 'Jun 12', createdAt: '1d ago',
  isOverdue: false,
};

export const CircleScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { activeRequests, setActiveRequests, circle, child, setChild, addTransaction, addActivity, repayOnTime, lendMoney, missRepayment, frozenAccount } = useApp();
  const [tab, setTab] = useState<'activity' | 'history'>('activity');
  const [friendPage, setFriendPage] = useState(0);
  const totalFriendPages = Math.ceil(circle.length / 4);
  const [repaidLoan, setRepaidLoan] = useState(false);
  const [loanDefaulted, setLoanDefaulted] = useState(false);
  const [repaySheetVisible, setRepaySheetVisible] = useState(false);
  const [fundingRequest, setFundingRequest] = useState<ActiveRequest | null>(null);

  const handleRepay = () => {
    if (child.balance < ACTIVE_LOAN.amount) {
      Alert.alert('Insufficient balance', 'You don\'t have enough balance to repay this loan.');
      return;
    }
    setRepaySheetVisible(true);
  };

  const confirmRepay = () => {
    setRepaySheetVisible(false);
    setRepaidLoan(true);
    setChild(c => ({
      ...c,
      borrowed: Math.max(0, c.borrowed - ACTIVE_LOAN.amount),
    }));
    const newStreak = child.streak + 1;
    const bonus = newStreak === 3 ? 3 : newStreak === 5 ? 5 : newStreak === 10 ? 10 : 0;
    const gained = 5 + bonus;
    repayOnTime();
    addTransaction({
      id: `t_repay_${Date.now()}`,
      type: 'repay',
      amount: -ACTIVE_LOAN.amount,
      description: `Repaid loan to ${ACTIVE_LOAN.lenderName}`,
      date: 'Just now',
      counterparty: ACTIVE_LOAN.lenderName,
      status: 'completed',
    });
    addActivity({
      id: `a_repay_${Date.now()}`,
      emoji: '✅',
      text: `You repaid ${ACTIVE_LOAN.lenderName} on time · +${gained} pts${bonus > 0 ? ` 🔥 ${newStreak}-week streak!` : ''}`,
      time: 'Just now',
      type: 'repaid',
    });
  };

  const simulateOverdueAutoProcess = () => {
    missRepayment(ACTIVE_LOAN.amount);
    setLoanDefaulted(true);
    addActivity({
      id: `a_default_${Date.now()}`,
      emoji: '🔒',
      text: `£${ACTIVE_LOAN.amount.toFixed(2)} auto-paid to ${ACTIVE_LOAN.lenderName} from parent safety pool · account frozen · -15 pts`,
      time: 'Just now',
      type: 'missed',
    });
  };

  const handleFund = (req: ActiveRequest) => {
    if (child.balance < req.amount) {
      Alert.alert('Insufficient balance', 'You don\'t have enough balance to fund this request.');
      return;
    }
    setFundingRequest(req);
  };

  const confirmFund = () => {
    if (!fundingRequest) return;
    const req = fundingRequest;
    setFundingRequest(null);
    setActiveRequests(prev => prev.map(r => r.id === req.id ? { ...r, isFunded: true } : r));
    setChild(c => ({ ...c, balance: c.balance - req.amount, loanedOut: c.loanedOut + req.amount }));
    addTransaction({
      id: `t_fund_${Date.now()}`,
      type: 'lend',
      amount: -req.amount,
      description: `Funded ${req.fromName}'s request`,
      date: 'Just now',
      counterparty: req.fromName,
      status: 'active',
    });
    addActivity({
      id: `a_fund_${Date.now()}`,
      emoji: '💚',
      text: `You funded ${req.fromName}'s request for £${req.amount.toFixed(2)} · +2 pts`,
      time: 'Just now',
      type: 'funded',
    });
    lendMoney();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('AddFriends')}
          activeOpacity={0.8}
        >
          <Ionicons name="person-add-outline" size={15} color={colors.primary} />
          <Text style={styles.addBtnText}>Add friend</Text>
        </TouchableOpacity>
      </View>


      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Friends avatar row — 4 per page, swipeable */}
        <View style={styles.friendsScrollOuter}>
          <FlatList
            data={circle}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={m => m.id}
            getItemLayout={(_, index) => ({ length: ITEM_WIDTH, offset: ITEM_WIDTH * index, index })}
            onMomentumScrollEnd={e => {
              const page = Math.round(e.nativeEvent.contentOffset.x / PAGE_WIDTH);
              setFriendPage(page);
            }}
            renderItem={({ item: m }) => (
              <TouchableOpacity style={styles.friendAvatarWrap} activeOpacity={0.8}>
                <View style={styles.friendAvatar}>
                  <Text style={styles.friendAvatarEmoji}>{m.avatarEmoji}</Text>
                </View>
                <Text style={styles.friendAvatarName}>{m.displayName.split(' ')[0]}</Text>
              </TouchableOpacity>
            )}
          />
        </View>

        {/* Tabs — below friends bar, scrolls with content */}
        <View style={styles.tabsWrap}>
          <TouchableOpacity
            style={[styles.tab, tab === 'activity' && styles.tabActive]}
            onPress={() => setTab('activity')}
          >
            <Text style={[styles.tabText, tab === 'activity' && styles.tabTextActive]}>Activity</Text>
            <View style={[styles.tabBadge, tab === 'activity' && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, tab === 'activity' && styles.tabBadgeTextActive]}>
                {1 + activeRequests.length}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'history' && styles.tabActive]}
            onPress={() => setTab('history')}
          >
            <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>History</Text>
            <View style={[styles.tabBadge, tab === 'history' && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, tab === 'history' && styles.tabBadgeTextActive]}>
                {HISTORY.length}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {tab === 'activity' ? (
          <>
            <View style={styles.sectionRow}>
              <Ionicons name="swap-horizontal-outline" size={18} color="#1A1A3E" />
              <Text style={styles.sectionHeading}>Active Transactions</Text>
            </View>

            {/* ── 1. ACTIVE LOANS (must repay) ── */}
            {!repaidLoan && !loanDefaulted && (
              <View style={[styles.activeLoanCard, ACTIVE_LOAN.isOverdue && styles.overdueLoanCard]}>
                <Text style={styles.cardTime}>{ACTIVE_LOAN.createdAt}</Text>
                {ACTIVE_LOAN.isOverdue && (
                  <View style={styles.overdueBadgeRow}>
                    <View style={styles.overdueBadge}>
                      <Text style={styles.overdueBadgeText}>⚠️ OVERDUE</Text>
                    </View>
                  </View>
                )}
                <View style={styles.loanRow}>
                  <View style={styles.avatarStack}>
                    <View style={[styles.avatarCircle, { backgroundColor: colors.primaryLight, zIndex: 2 }]}>
                      <Text style={{ fontSize: 20 }}>{child.avatarEmoji}</Text>
                    </View>
                    <View style={[styles.avatarCircle, { backgroundColor: colors.primaryLight, marginLeft: -12, zIndex: 1 }]}>
                      <Text style={{ fontSize: 20 }}>🏀</Text>
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.loanTitle}>{ACTIVE_LOAN.lenderName} funded you</Text>
                    <Text style={styles.loanSub}>{ACTIVE_LOAN.reasonEmoji} {ACTIVE_LOAN.reason}</Text>
                  </View>
                  <Text style={styles.loanAmount}>£{ACTIVE_LOAN.amount.toFixed(2)}</Text>
                </View>
                <View style={styles.infoRow}>
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>£{ACTIVE_LOAN.amount.toFixed(2)}</Text>
                    <Text style={styles.infoCellLabel}>amount</Text>
                  </View>
                  <View style={styles.infoDivider} />
                  <View style={styles.infoCell}>
                    <Text style={[styles.infoCellValue, ACTIVE_LOAN.isOverdue && { color: colors.error }]}>{ACTIVE_LOAN.dueIn}</Text>
                    <Text style={styles.infoCellLabel}>status</Text>
                  </View>
                  <View style={styles.infoDivider} />
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>{ACTIVE_LOAN.deadline}</Text>
                    <Text style={styles.infoCellLabel}>deadline</Text>
                  </View>
                </View>
                {ACTIVE_LOAN.isOverdue ? (
                  <>
                    <View style={styles.overdueWarning}>
                      <Text style={styles.overdueWarningText}>
                        Deadline passed — your parent's safety pool will automatically cover this repayment and your account will be frozen.
                      </Text>
                    </View>
                    <TouchableOpacity style={styles.simulateBtn} onPress={simulateOverdueAutoProcess} activeOpacity={0.8}>
                      <Text style={styles.simulateBtnText}>⚙️ Simulate: process overdue payment</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity style={styles.repayBtn} onPress={handleRepay} activeOpacity={0.85}>
                    <Ionicons name="return-down-back-outline" size={18} color="#fff" />
                    <Text style={styles.repayBtnText}>Repay £{ACTIVE_LOAN.amount.toFixed(2)}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {loanDefaulted && frozenAccount && (
              <View style={[styles.activeLoanCard, styles.defaultedCard]}>
                <View style={styles.loanRow}>
                  <View style={[styles.avatarCircle, { backgroundColor: colors.errorLight, marginRight: 12 }]}>
                    <Text style={{ fontSize: 20 }}>🔒</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.loanTitle, { color: colors.error }]}>Auto-payment processed</Text>
                    <Text style={styles.loanSub}>Jordan Lee · £{ACTIVE_LOAN.amount.toFixed(2)}</Text>
                  </View>
                </View>
                <Text style={styles.defaultedNote}>
                  £{ACTIVE_LOAN.amount.toFixed(2)} was automatically taken from your parent's safety pool and paid to {ACTIVE_LOAN.lenderName}. Your account is now frozen — go to Home to repay your parent and unlock your account.
                </Text>
              </View>
            )}

            {/* ── 2. YOUR OWN REQUESTS (waiting to be funded) ── */}
            {activeRequests.filter(r => r.isOwn).map(req => (
              <View key={req.id} style={[styles.activeLoanCard, styles.ownRequestCard]}>
                <Text style={styles.cardTime}>{req.createdAt}</Text>
                <View style={styles.loanRow}>
                  <View style={[styles.avatarCircle, { backgroundColor: colors.primaryLight, marginRight: 12 }]}>
                    <Text style={{ fontSize: 20 }}>{req.fromEmoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.loanTitle}>You requested £{req.amount.toFixed(2)}</Text>
                    <Text style={styles.loanSub}>{req.reasonEmoji} {req.reason} · waiting for your circle</Text>
                  </View>
                  <View style={styles.expiryPill}>
                    <Ionicons name="time-outline" size={12} color="#D97706" />
                    <Text style={styles.expiryText}>{req.expiresIn}h left</Text>
                  </View>
                </View>
                <View style={styles.infoRow}>
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>£{req.amount.toFixed(2)}</Text>
                    <Text style={styles.infoCellLabel}>amount</Text>
                  </View>
                  <View style={styles.infoDivider} />
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>{req.deadline}</Text>
                    <Text style={styles.infoCellLabel}>repay by</Text>
                  </View>
                  <View style={styles.infoDivider} />
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>{req.repayByDate}</Text>
                    <Text style={styles.infoCellLabel}>due date</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.cancelRequestBtn}
                  onPress={() => setActiveRequests(prev => prev.filter(r => r.id !== req.id))}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelRequestText}>Cancel request</Text>
                </TouchableOpacity>
              </View>
            ))}

            {/* ── 3. FRIENDS REQUESTING MONEY (pending) ── */}
            {activeRequests.filter(r => !r.isOwn && !r.isFunded).map(req => (
              <View key={req.id} style={styles.activeLoanCard}>
                <Text style={styles.cardTime}>{req.createdAt}</Text>
                <View style={styles.loanRow}>
                  <View style={[styles.avatarCircle, { backgroundColor: colors.primaryLight, marginRight: 12 }]}>
                    <Text style={{ fontSize: 22 }}>{req.fromEmoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.loanTitle}>{req.fromName} needs £{req.amount.toFixed(2)}</Text>
                    <Text style={styles.loanSub}>{req.reasonEmoji} {req.reason}</Text>
                  </View>
                  <View style={styles.expiryPill}>
                    <Ionicons name="time-outline" size={12} color="#D97706" />
                    <Text style={styles.expiryText}>{req.expiresIn}h left</Text>
                  </View>
                </View>
                <View style={styles.infoRow}>
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>£{req.amount.toFixed(2)}</Text>
                    <Text style={styles.infoCellLabel}>amount</Text>
                  </View>
                  <View style={styles.infoDivider} />
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>{req.deadline}</Text>
                    <Text style={styles.infoCellLabel}>repay by</Text>
                  </View>
                  <View style={styles.infoDivider} />
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>{req.repayByDate}</Text>
                    <Text style={styles.infoCellLabel}>deadline</Text>
                  </View>
                </View>
                <View style={styles.reqActions}>
                  <TouchableOpacity style={styles.fundBtn} onPress={() => handleFund(req)} activeOpacity={0.85}>
                    <Text style={styles.fundBtnText}>Fund it 💚</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {/* Funded requests — awaiting repayment */}
            {activeRequests.filter(r => !r.isOwn && r.isFunded).map(req => (
              <View key={req.id} style={[styles.activeLoanCard, styles.fundedCard]}>
                <Text style={styles.cardTime}>{req.createdAt}</Text>
                <View style={styles.fundedBadgeRow}>
                  <View style={styles.fundedBadge}>
                    <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
                    <Text style={styles.fundedBadgeText}>Funded</Text>
                  </View>
                </View>
                <View style={styles.loanRow}>
                  <View style={[styles.avatarCircle, { backgroundColor: colors.primaryLight, marginRight: 12 }]}>
                    <Text style={{ fontSize: 22 }}>{req.fromEmoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.loanTitle}>You funded {req.fromName}</Text>
                    <Text style={styles.loanSub}>{req.reasonEmoji} {req.reason}</Text>
                  </View>
                  <Text style={styles.loanAmount}>£{req.amount.toFixed(2)}</Text>
                </View>
                <View style={styles.infoRow}>
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>£{req.amount.toFixed(2)}</Text>
                    <Text style={styles.infoCellLabel}>lent</Text>
                  </View>
                  <View style={styles.infoDivider} />
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>{req.deadline}</Text>
                    <Text style={styles.infoCellLabel}>agreed term</Text>
                  </View>
                  <View style={styles.infoDivider} />
                  <View style={styles.infoCell}>
                    <Text style={[styles.infoCellValue, { color: '#16A34A' }]}>{req.repayByDate}</Text>
                    <Text style={styles.infoCellLabel}>repay by</Text>
                  </View>
                </View>
                <View style={styles.awaitingRow}>
                  <Ionicons name="time-outline" size={15} color={colors.textSecondary} />
                  <Text style={styles.awaitingText}>Waiting for {req.fromName} to repay by {req.repayByDate}</Text>
                </View>
              </View>
            ))}
          </>
        ) : (
          <>
            {/* History heading */}
            <View style={styles.sectionRow}>
              <Ionicons name="time-outline" size={18} color="#1A1A3E" />
              <Text style={styles.sectionHeading}>History</Text>
            </View>

            {/* Missed payment entry — appears after parent repaid */}
            {loanDefaulted && !frozenAccount && (
              <View style={[styles.historyCard, styles.missedHistoryCard]}>
                <View style={[styles.historyAvatar, { backgroundColor: '#FEE2E2' }]}>
                  <Text style={styles.historyAvatarInitial}>⚠️</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.loanTitle, { color: colors.error }]}>Missed payment</Text>
                  <Text style={styles.loanSub}>{ACTIVE_LOAN.reasonEmoji} {ACTIVE_LOAN.reason} · {ACTIVE_LOAN.lenderName}</Text>
                  <Text style={styles.historyTime}>Today</Text>
                </View>
                <View style={styles.historyRight}>
                  <Text style={[styles.historyAmount, { color: colors.error }]}>£{ACTIVE_LOAN.amount.toFixed(2)}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: '#FEE2E2' }]}>
                    <Text style={[styles.statusBadgeText, { color: colors.error }]}>Missed</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Repaid loan entry — appears after repaying Jordan */}
            {repaidLoan && (
              <View style={styles.historyCard}>
                <View style={[styles.historyAvatar, { backgroundColor: ACTIVE_LOAN.lenderColor }]}>
                  <Text style={styles.historyAvatarInitial}>{ACTIVE_LOAN.lenderInitial}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.loanTitle}>Repaid {ACTIVE_LOAN.lenderName}</Text>
                  <Text style={styles.loanSub}>{ACTIVE_LOAN.reasonEmoji} {ACTIVE_LOAN.reason}</Text>
                  <Text style={styles.historyTime}>Today</Text>
                </View>
                <View style={styles.historyRight}>
                  <Text style={styles.historyAmount}>£{ACTIVE_LOAN.amount.toFixed(2)}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: '#F0FDF4' }]}>
                    <Text style={[styles.statusBadgeText, { color: '#16A34A' }]}>Repaid</Text>
                  </View>
                </View>
              </View>
            )}

            {/* History cards */}
            {HISTORY.map(item => (
              <View key={item.id} style={styles.historyCard}>
                <View style={[styles.historyAvatar, { backgroundColor: item.color }]}>
                  <Text style={styles.historyAvatarInitial}>{item.initial}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.loanTitle}>{item.title}</Text>
                  <Text style={styles.loanSub}>{item.reason}</Text>
                  <Text style={styles.historyTime}>{item.time}</Text>
                </View>
                <View style={styles.historyRight}>
                  <Text style={styles.historyAmount}>£{item.amount.toFixed(2)}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: item.statusBg }]}>
                    <Text style={[styles.statusBadgeText, { color: item.statusColor }]}>{item.status}</Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Repay confirmation sheet */}
      <ConfirmSheet
        visible={repaySheetVisible}
        emoji="💸"
        title={`Repay ${ACTIVE_LOAN.lenderName}`}
        subtitle={`${ACTIVE_LOAN.reasonEmoji} ${ACTIVE_LOAN.reason} · due ${ACTIVE_LOAN.deadline}`}
        amount={ACTIVE_LOAN.amount}
        balanceAfter={(child.balance + child.borrowed - child.loanedOut) - ACTIVE_LOAN.amount}
        confirmLabel={`Repay £${ACTIVE_LOAN.amount.toFixed(2)}`}
        confirmColor="#16A34A"
        onConfirm={confirmRepay}
        onCancel={() => setRepaySheetVisible(false)}
      />

      {/* Fund confirmation sheet */}
      <ConfirmSheet
        visible={fundingRequest !== null}
        emoji="💚"
        title={`Fund ${fundingRequest?.fromName ?? ''}`}
        subtitle={`${fundingRequest?.reasonEmoji ?? ''} ${fundingRequest?.reason ?? ''}`}
        amount={fundingRequest?.amount ?? 0}
        balanceAfter={(child.balance + child.borrowed - child.loanedOut) - (fundingRequest?.amount ?? 0)}
        confirmLabel={`Fund £${(fundingRequest?.amount ?? 0).toFixed(2)}`}
        confirmColor={colors.primary}
        onConfirm={confirmFund}
        onCancel={() => setFundingRequest(null)}
      />


    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F4FC' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F0EFF8',
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primaryLight, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  addBtnText: { fontSize: 13, fontWeight: '700', color: colors.primary },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', marginHorizontal: 16, marginTop: 10,
    borderRadius: 14, paddingHorizontal: 14, height: 48,
    borderWidth: 1.5, borderColor: colors.primaryLight,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#1A1A3E' },
  searchResults: {
    marginHorizontal: 16, marginTop: 4,
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
  },
  searchNoResult: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },

  // Friends avatar row at top
  friendsScrollOuter: { backgroundColor: '#fff', borderRadius: 20 },
  friendAvatarWrap: { width: ITEM_WIDTH, alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 6 },
  friendAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  friendAvatarEmoji: { fontSize: 26 },
  friendAvatarName: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },

  // Tabs
  tabsWrap: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderRadius: 20, padding: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: 16,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  tabTextActive: { color: '#fff' },
  tabBadge: { backgroundColor: '#E5E7EB', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.3)' },
  tabBadgeText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  tabBadgeTextActive: { color: '#fff' },

  scroll: { padding: 16, gap: 14 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  sectionHeading: { fontSize: 17, fontWeight: '800', color: '#1A1A3E' },

  // Active loan card
  activeLoanCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 16, gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    position: 'relative',
  },
  cardTime: {
    position: 'absolute', top: 12, right: 14,
    fontSize: 11, color: colors.textLight, fontWeight: '500',
  },
  needsRepayBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: '#F0FDF4', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
  },
  needsRepayText: { fontSize: 13, fontWeight: '700', color: '#16A34A' },
  expiryPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FEF3C7', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  expiryText: { fontSize: 12, fontWeight: '700', color: '#D97706' },

  loanRow: { flexDirection: 'row', alignItems: 'center' },
  avatarStack: { flexDirection: 'row', alignItems: 'center', marginRight: 12 },
  avatarCircle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  avatarInitial: { fontSize: 16, fontWeight: '800', color: '#fff' },
  loanTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A3E', marginBottom: 2 },
  loanSub: { fontSize: 13, color: colors.textSecondary },
  loanAmount: { fontSize: 20, fontWeight: '800', color: '#1A1A3E', marginLeft: 8 },

  infoRow: { flexDirection: 'row', backgroundColor: '#F5F4FC', borderRadius: 14, overflow: 'hidden' },
  infoCell: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  infoDivider: { width: 1, backgroundColor: '#E5E7EB' },
  infoCellValue: { fontSize: 16, fontWeight: '800', color: '#1A1A3E' },
  infoCellLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },

  repayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#16A34A', borderRadius: 16, paddingVertical: 16,
  },
  repayBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  overdueLoanCard: { borderColor: colors.error, borderWidth: 1.5 },
  missedHistoryCard: { borderWidth: 1.5, borderColor: '#FECACA' },
  overdueBadgeRow: { flexDirection: 'row', marginBottom: 8 },
  overdueBadge: { backgroundColor: '#FEE2E2', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  overdueBadgeText: { fontSize: 12, fontWeight: '700', color: colors.error },
  overdueWarning: { backgroundColor: '#FEF2F2', borderRadius: 12, padding: 12 },
  overdueWarningText: { fontSize: 13, color: '#991B1B', lineHeight: 18 },
  simulateBtn: { alignItems: 'center', paddingVertical: 10 },
  simulateBtnText: { fontSize: 12, color: colors.textSecondary, textDecorationLine: 'underline' },
  ownRequestCard: { borderWidth: 1.5, borderColor: colors.primary },
  fundedCard: { borderWidth: 1.5, borderColor: '#16A34A' },
  fundedBadgeRow: { flexDirection: 'row' },
  fundedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F0FDF4', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  fundedBadgeText: { fontSize: 12, fontWeight: '700', color: '#16A34A' },
  awaitingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F0FDF4', borderRadius: 12, padding: 12,
  },
  awaitingText: { fontSize: 13, color: '#16A34A', fontWeight: '600', flex: 1 },
  cancelRequestBtn: { alignItems: 'center', paddingVertical: 4 },
  cancelRequestText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  defaultedCard: { borderWidth: 1.5, borderColor: colors.error },
  defaultedNote: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },

  tierPill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  tierPillText: { fontSize: 13, fontWeight: '700' },
  reqActions: { flexDirection: 'row', gap: 10 },
  fundBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  fundBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  passBtn: { flex: 0.45, backgroundColor: '#F5F4FC', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  passBtnText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },

  // History cards
  historyCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    backgroundColor: '#fff', borderRadius: 20, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  historyAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  historyAvatarInitial: { fontSize: 20, fontWeight: '800', color: '#fff' },
  historyTime: { fontSize: 12, color: colors.textLight, marginTop: 4 },
  historyRight: { alignItems: 'flex-end', gap: 6 },
  historyAmount: { fontSize: 18, fontWeight: '800', color: '#1A1A3E' },
  statusBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 13, fontWeight: '700' },
});
