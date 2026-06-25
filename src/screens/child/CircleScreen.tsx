import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Dimensions, FlatList, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme/colors';
import { ActiveRequest, useApp } from '../../context/AppContext';
import { db } from '../../lib/database';
import { sendPushNotification } from '../../lib/notifications';
import { ConfirmSheet } from '../../components/ConfirmSheet';

const AVATAR_COLORS = ['#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#8B5CF6', '#EC4899'];
const PAGE_WIDTH = Dimensions.get('window').width - 32; // 16px padding each side
const ITEM_WIDTH = PAGE_WIDTH / 4;


export const CircleScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { activeRequests, setActiveRequests, circle, setCircle, child, childId, setChild, addTransaction, addActivity, pendingRequests, setPendingRequests } = useApp();
  const [tab, setTab] = useState<'activity' | 'history'>('activity');
  const [friendPage, setFriendPage] = useState(0);
  const [fundingRequest, setFundingRequest] = useState<ActiveRequest | null>(null);
  const [repayingRequest, setRepayingRequest] = useState<ActiveRequest | null>(null);

  const handleAcceptRequest = async (requestId: string) => {
    try {
      const { fromId, fromPushToken } = await db.acceptCircleRequest(requestId);
      const accepted = pendingRequests.find(r => r.requestId === requestId);
      setPendingRequests(prev => prev.filter(r => r.requestId !== requestId));
      if (accepted) {
        setCircle(prev => [...prev, {
          id: accepted.id, displayName: accepted.displayName,
          username: accepted.username, avatarEmoji: accepted.avatarEmoji,
          trustScore: accepted.trustScore,
        }]);
        addActivity({
          id: `a_friend_${Date.now()}`,
          emoji: '🤝',
          text: `${accepted.displayName} has joined your circle!`,
          time: 'Just now',
          type: 'joined',
        });
        // Notify the sender their request was accepted
        if (fromPushToken) {
          sendPushNotification(
            fromPushToken,
            'Friend request accepted ✅',
            `${child.displayName} accepted your request — you're now in each other's circles!`,
          ).catch(() => {});
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not accept request.');
    }
  };

  const handleRemoveFriend = (memberId: string, displayName: string) => {
    if (!childId) return;

    // Block if there's an active funded loan between these two users
    const activeLoan = activeRequests.find(r =>
      r.isFunded === true &&
      ((r.fromId === childId && r.fundedById === memberId) ||
       (r.fromId === memberId && r.fundedById === childId))
    );
    if (activeLoan) {
      const msg = `You can't remove ${displayName} while there's an active loan between you. Repay the loan first.`;
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('Active loan', msg);
      }
      return;
    }

    const doRemove = async () => {
      try {
        await db.removeFromCircle(childId, memberId);
        setCircle(prev => prev.filter(m => m.id !== memberId));
        addActivity({
          id: `a_remove_${Date.now()}`,
          emoji: '👋',
          text: `You removed ${displayName} from your circle`,
          time: 'Just now',
          type: 'request',
        });
      } catch (e: any) {
        // DB also enforces this — surface its message if it fires
        const msg = e.message ?? 'Could not remove friend.';
        const isLoanBlock = msg.includes('active_loan');
        if (Platform.OS === 'web') {
          window.alert(isLoanBlock
            ? `You can't remove ${displayName} while there's an active loan. Repay the loan first.`
            : msg);
        } else {
          Alert.alert(
            isLoanBlock ? 'Active loan' : 'Error',
            isLoanBlock
              ? `You can't remove ${displayName} while there's an active loan. Repay the loan first.`
              : msg,
          );
        }
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Remove ${displayName} from your circle?`)) doRemove();
    } else {
      Alert.alert(
        'Remove friend?',
        `${displayName} will be removed from your circle. They won't be able to lend or borrow with you.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: doRemove },
        ]
      );
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    try {
      const declined = pendingRequests.find(r => r.requestId === requestId);
      const { fromPushToken } = await db.declineCircleRequest(requestId);
      setPendingRequests(prev => prev.filter(r => r.requestId !== requestId));
      if (declined) {
        addActivity({
          id: `a_decline_${Date.now()}`,
          emoji: '❌',
          text: `You declined ${declined.displayName}'s request`,
          time: 'Just now',
          type: 'request',
        });
        // Notify the sender their request was declined
        if (fromPushToken) {
          sendPushNotification(
            fromPushToken,
            'Friend request declined',
            `${child.displayName} didn't accept your request`,
          ).catch(() => {});
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not decline request.');
    }
  };

  const handleFund = (req: ActiveRequest) => {
    if (child.balance < req.amount) {
      Alert.alert('Insufficient balance', 'You don\'t have enough balance to fund this request.');
      return;
    }
    setFundingRequest(req);
  };

  const confirmFund = async () => {
    if (!fundingRequest || !childId) return;
    const req = fundingRequest;
    setFundingRequest(null);
    try {
      const { borrowerPushToken } = await db.fundMoneyRequest(req.id, childId, req.amount);
      setActiveRequests(prev => prev.map(r =>
        r.id === req.id ? { ...r, isFunded: true, fundedById: childId, fundedByName: child.displayName, fundedByEmoji: child.avatarEmoji } : r
      ));
      setChild(c => ({
        ...c,
        balance: c.balance - req.amount,
        loanedOut: c.loanedOut + req.amount,
        trustScore: Math.min(100, c.trustScore + 2),
        points: c.points + 2,
      }));
      addActivity({
        id: `a_fund_${Date.now()}`,
        emoji: '💚',
        text: `You funded ${req.fromName}'s request for £${req.amount.toFixed(2)} · +2 pts`,
        time: 'Just now',
        type: 'funded',
      });
      addTransaction({
        id: `t_fund_${Date.now()}`,
        type: 'lend',
        amount: -req.amount,
        description: `Funded ${req.fromName}'s request`,
        date: 'Just now',
        counterparty: req.fromName,
        status: 'active',
      });
      if (borrowerPushToken) {
        sendPushNotification(
          borrowerPushToken,
          `💚 ${child.displayName} funded your request!`,
          `${child.displayName} sent you £${req.amount.toFixed(2)} for ${req.reason}`,
        ).catch(() => {});
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not fund request.');
    }
  };

  const handleRepay = (req: ActiveRequest) => {
    if (child.balance < req.amount) {
      if (Platform.OS === 'web') {
        window.alert("You don't have enough balance to repay.");
      } else {
        Alert.alert('Insufficient balance', "You don't have enough balance to repay.");
      }
      return;
    }
    setRepayingRequest(req);
  };

  const confirmRepay = async () => {
    if (!repayingRequest || !childId) return;
    const req = repayingRequest;
    setRepayingRequest(null);
    try {
      const { funderPushToken } = await db.repayMoneyRequest(req.id, childId);
      setActiveRequests(prev => prev.filter(r => r.id !== req.id));
      setChild(c => ({
        ...c,
        balance: c.balance - req.amount,
        borrowed: Math.max(0, c.borrowed - req.amount),
        trustScore: Math.min(100, c.trustScore + 5),
        points: c.points + 5,
        streak: c.streak + 1,
        repaid: c.repaid + 1,
      }));
      addActivity({
        id: `a_repay_${Date.now()}`,
        emoji: '✅',
        text: `You repaid £${req.amount.toFixed(2)} to ${req.fundedByName ?? 'your friend'} · +5 pts`,
        time: 'Just now',
        type: 'repaid',
      });
      addTransaction({
        id: `t_repay_${Date.now()}`,
        type: 'repay',
        amount: -req.amount,
        description: `Repaid ${req.fundedByName ?? 'friend'}`,
        date: 'Just now',
        counterparty: req.fundedByName,
        status: 'completed',
      });
      if (funderPushToken) {
        sendPushNotification(
          funderPushToken,
          `✅ ${child.displayName} repaid you!`,
          `${child.displayName} repaid £${req.amount.toFixed(2)}`,
        ).catch(() => {});
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not repay.');
    }
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
              <View style={styles.friendAvatarWrap}>
                <View style={styles.friendAvatarContainer}>
                  <View style={styles.friendAvatar}>
                    <Text style={styles.friendAvatarEmoji}>{m.avatarEmoji}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.removeBtn}
                    onPress={() => handleRemoveFriend(m.id, m.displayName)}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="close" size={10} color="#fff" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.friendAvatarName}>{m.displayName.split(' ')[0]}</Text>
              </View>
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
                {pendingRequests.length + activeRequests.length}
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
                0
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {tab === 'activity' ? (
          <>
            {/* ── PENDING FRIEND REQUESTS ── */}
            {pendingRequests.length > 0 && (
              <>
                <View style={styles.sectionRow}>
                  <Ionicons name="person-add-outline" size={18} color="#1A1A3E" />
                  <Text style={styles.sectionHeading}>Friend Requests</Text>
                  <View style={[styles.tabBadge, { backgroundColor: '#EDE9FE', marginLeft: 4 }]}>
                    <Text style={[styles.tabBadgeText, { color: colors.primary }]}>{pendingRequests.length}</Text>
                  </View>
                </View>
                {pendingRequests.map(req => (
                  <View key={req.requestId} style={[styles.activeLoanCard, styles.friendReqCard]}>
                    <View style={styles.loanRow}>
                      <View style={[styles.avatarCircle, { backgroundColor: colors.primaryLight, marginRight: 12 }]}>
                        <Text style={{ fontSize: 22 }}>{req.avatarEmoji}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.loanTitle}>{req.displayName} wants to join your circle</Text>
                        <Text style={styles.loanSub}>@{req.username} · Trust score: {req.trustScore}</Text>
                      </View>
                    </View>
                    <View style={styles.reqActions}>
                      <TouchableOpacity
                        style={styles.acceptBtn}
                        onPress={() => handleAcceptRequest(req.requestId)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="checkmark-outline" size={16} color="#fff" />
                        <Text style={styles.acceptBtnText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.declineBtn}
                        onPress={() => handleDeclineRequest(req.requestId)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.declineBtnText}>Decline</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </>
            )}

            <View style={styles.sectionRow}>
              <Ionicons name="swap-horizontal-outline" size={18} color="#1A1A3E" />
              <Text style={styles.sectionHeading}>Active Transactions</Text>
            </View>

            {activeRequests.length === 0 && pendingRequests.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>💸</Text>
                <Text style={styles.emptyTitle}>No active transactions</Text>
                <Text style={styles.emptySubtitle}>When you borrow or lend money with your circle, it will show up here.</Text>
              </View>
            )}

            {/* ── YOUR OWN FUNDED LOANS (need to repay) ── */}
            {activeRequests.filter(r => r.isOwn && r.isFunded).map(req => (
              <View key={req.id} style={[styles.activeLoanCard, styles.needsRepayCard]}>
                <Text style={styles.cardTime}>{req.createdAt}</Text>
                <View style={styles.fundedBadgeRow}>
                  <View style={styles.fundedBadge}>
                    <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
                    <Text style={styles.fundedBadgeText}>Funded by {req.fundedByName}</Text>
                  </View>
                </View>
                <View style={styles.loanRow}>
                  <View style={[styles.avatarCircle, { backgroundColor: '#F0FDF4', marginRight: 12 }]}>
                    <Text style={{ fontSize: 22 }}>{req.fundedByEmoji ?? '💚'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.loanTitle}>£{req.amount.toFixed(2)} in your wallet</Text>
                    <Text style={styles.loanSub}>{req.reasonEmoji} {req.reason}</Text>
                  </View>
                </View>
                <View style={styles.infoRow}>
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>£{req.amount.toFixed(2)}</Text>
                    <Text style={styles.infoCellLabel}>borrowed</Text>
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
                <TouchableOpacity style={styles.repayBtn} onPress={() => handleRepay(req)} activeOpacity={0.85}>
                  <Ionicons name="arrow-undo-outline" size={18} color="#fff" />
                  <Text style={styles.repayBtnText}>Repay £{req.amount.toFixed(2)}</Text>
                </TouchableOpacity>
              </View>
            ))}

            {/* ── YOUR OWN REQUESTS (waiting to be funded) ── */}
            {activeRequests.filter(r => r.isOwn && !r.isFunded).map(req => (
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
                  onPress={async () => {
                    setActiveRequests(prev => prev.filter(r => r.id !== req.id));
                    if (childId) db.cancelMoneyRequest(req.id, childId).catch(() => {});
                  }}
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
            <View style={styles.sectionRow}>
              <Ionicons name="time-outline" size={18} color="#1A1A3E" />
              <Text style={styles.sectionHeading}>History</Text>
            </View>
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📋</Text>
              <Text style={styles.emptyTitle}>No history yet</Text>
              <Text style={styles.emptySubtitle}>Completed loans and repayments will appear here.</Text>
            </View>
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Fund confirmation sheet */}
      <ConfirmSheet
        visible={fundingRequest !== null}
        emoji="💚"
        title={`Fund ${fundingRequest?.fromName ?? ''}`}
        subtitle={`${fundingRequest?.reasonEmoji ?? ''} ${fundingRequest?.reason ?? ''}`}
        amount={fundingRequest?.amount ?? 0}
        balanceAfter={child.balance - (fundingRequest?.amount ?? 0)}
        confirmLabel={`Fund £${(fundingRequest?.amount ?? 0).toFixed(2)}`}
        confirmColor={colors.primary}
        onConfirm={confirmFund}
        onCancel={() => setFundingRequest(null)}
      />

      {/* Repay confirmation sheet */}
      <ConfirmSheet
        visible={repayingRequest !== null}
        emoji="✅"
        title={`Repay ${repayingRequest?.fundedByName ?? ''}`}
        subtitle={`${repayingRequest?.reasonEmoji ?? ''} ${repayingRequest?.reason ?? ''}`}
        amount={repayingRequest?.amount ?? 0}
        balanceAfter={child.balance - (repayingRequest?.amount ?? 0)}
        confirmLabel={`Repay £${(repayingRequest?.amount ?? 0).toFixed(2)}`}
        confirmColor="#16A34A"
        onConfirm={confirmRepay}
        onCancel={() => setRepayingRequest(null)}
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
  friendAvatarContainer: { position: 'relative' },
  removeBtn: {
    position: 'absolute', top: -4, right: -4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#fff',
  },
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
  needsRepayCard: { borderWidth: 1.5, borderColor: '#16A34A' },
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
  friendReqCard: { borderWidth: 1.5, borderColor: colors.primary },
  acceptBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14,
  },
  acceptBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  declineBtn: {
    flex: 0.5, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F5F4FC', borderRadius: 14, paddingVertical: 14,
  },
  declineBtnText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  defaultedCard: { borderWidth: 1.5, borderColor: colors.error },
  defaultedNote: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },

  tierPill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  tierPillText: { fontSize: 13, fontWeight: '700' },
  reqActions: { flexDirection: 'row', gap: 10 },
  fundBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  fundBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  passBtn: { flex: 0.45, backgroundColor: '#F5F4FC', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  passBtnText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },

  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyEmoji: { fontSize: 38 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A3E' },
  emptySubtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 16 },

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
