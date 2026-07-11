import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Dimensions, FlatList, Platform, Image,
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
import { fmtAmt } from '../../lib/utils';

const AVATAR_COLORS = ['#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#8B5CF6', '#EC4899'];
// 4 friend avatars visible at once; remainder scroll horizontally
const CARD_INNER_W = Dimensions.get('window').width - 32;
const FRIEND_AVATAR_SIZE = 52;
const FRIEND_ITEM_W = Math.floor((CARD_INNER_W - 24) / 4);


export const CircleScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { activeRequests, setActiveRequests, circle, setCircle, child, childId, setChild, addTransaction, addActivity, removeActivity, pendingRequests, setPendingRequests, recordWeeklyStreak, frozenAccount } = useApp();
  const [tab, setTab] = useState<'activity' | 'history'>('activity');
  const [fundingRequest, setFundingRequest] = useState<ActiveRequest | null>(null);
  const [repayingRequest, setRepayingRequest] = useState<ActiveRequest | null>(null);
  const [loanHistory, setLoanHistory] = useState<Array<{
    id: string; amount: number; reason: string; reasonEmoji: string;
    createdAt: string; repaidAt: string | null; repayByDate: string;
    status: string; isBorrower: boolean; repaidOnTime: boolean;
    borrowerName: string; borrowerUsername: string; borrowerEmoji: string; borrowerAvatarUrl: string | null;
    funderName: string; funderUsername: string; funderEmoji: string; funderAvatarUrl: string | null;
  }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!childId || historyLoading) return;
    setHistoryLoading(true);
    try {
      const rows = await db.getLoanHistory(childId);
      setLoanHistory(rows.map(r => ({
        id: r.id, amount: r.amount, reason: r.reason, reasonEmoji: r.reason_emoji,
        createdAt: r.created_at, repaidAt: r.repaid_at, repayByDate: r.repay_by_date,
        status: (r as any).status ?? 'repaid',
        isBorrower: r.is_borrower, repaidOnTime: r.repaid_on_time,
        borrowerName: r.borrower_name, borrowerUsername: r.borrower_username,
        borrowerEmoji: r.borrower_emoji, borrowerAvatarUrl: r.borrower_avatar_url,
        funderName: r.funder_name, funderUsername: r.funder_username,
        funderEmoji: r.funder_emoji, funderAvatarUrl: r.funder_avatar_url,
      })));
    } catch { /* best-effort */ } finally { setHistoryLoading(false); }
  }, [childId]);

  useEffect(() => { if (tab === 'history') loadHistory(); }, [tab]);

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
          profileImageUrl: accepted.profileImageUrl,
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

        // Cancel any unfunded money requests from the removed member and remove
        // them from the local active-requests list. The DB cancellation propagates
        // to other circle members within their next 5-second poll.
        const pendingToCancel = activeRequests.filter(
          r => r.fromId === memberId && !r.isFunded,
        );
        if (pendingToCancel.length > 0) {
          setActiveRequests(prev => prev.filter(
            r => !(r.fromId === memberId && !r.isFunded),
          ));
          pendingToCancel.forEach(req => {
            db.cancelMoneyRequest(req.id, memberId).catch(() => {});
          });
        }

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
    if (frozenAccount) {
      Alert.alert('Account frozen', 'Your account is frozen. Repay your parent to unlock lending.');
      return;
    }
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
      // Sync streak from DB (RPC already incremented it)
      recordWeeklyStreak().catch(() => {});
      setActiveRequests(prev => prev.map(r =>
        r.id === req.id ? { ...r, isFunded: true, fundedById: childId, fundedByName: child.displayName, fundedByEmoji: child.avatarEmoji } : r
      ));
      // Mirror every stat the DB RPC updated
      setChild(c => ({
        ...c,
        balance:    c.balance    - req.amount,
        loanedOut:  c.loanedOut  + req.amount,
        totalLent:  c.totalLent  + req.amount,
        timesLent:  c.timesLent  + 1,
        trustScore: Math.min(100, c.trustScore + 2),
        points:     c.points     + 2,
      }));
      // Resolve @username for activity / transaction description
      const borrowerUser = circle.find(m => m.id === req.fromId)?.username ?? req.fromName;
      // Activity written to DB by addActivity; uses predictable id so poll deduplicates by id.
      addActivity({
        id:    `fund_${req.id}`,
        emoji: '💚',
        text:  `£${fmtAmt(req.amount)} lent to @${borrowerUser} · +2 pts`,
        time:  'Just now',
        type:  'funded',
      });
      // Local-only transaction; poll overwrites with DB copy within 5 s
      addTransaction({
        id:          `t_fund_${Date.now()}`,
        type:        'lend',
        amount:      -req.amount,
        description: `£${fmtAmt(req.amount)} lent to @${borrowerUser}`,
        date:        'Just now',
        counterparty: req.fromName,
        status:      'active',
      });
      if (borrowerPushToken) {
        sendPushNotification(
          borrowerPushToken,
          `💚 ${child.displayName} funded your request!`,
          `${child.displayName} sent you £${fmtAmt(req.amount)} for ${req.reason}`,
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
      const { funderPushToken, amount: paidAmount } = await db.repayMoneyRequest(req.id, childId);
      const amt = paidAmount ?? req.amount;
      setActiveRequests(prev => prev.filter(r => r.id !== req.id));

      // The repay_money_request RPC already handles:
      //   - funder's wallet_balance +
      //   - funder's loaned_out -
      //   - borrower's wallet_balance -
      //   - borrower's borrowed, repaid, trust_score, points
      //   - transactions for BOTH parties
      //   - funder's activity_feed entry ('recv_' || requestId)
      // We only need local optimistic updates + borrower's own activity entry.
      setChild(c => ({
        ...c,
        balance:    c.balance    - amt,
        borrowed:   Math.max(0, c.borrowed - amt),
        trustScore: Math.min(100, c.trustScore + 5),
        points:     c.points     + 5,
        repaid:     c.repaid     + 1,
        // streak: let the 5-second poll sync from DB (it's per-week logic in the RPC)
      }));
      // Resolve @username for descriptions
      const funderUser = circle.find(m => m.id === req.fundedById)?.username ?? req.fundedByName ?? 'friend';
      // Borrower's activity — predictable id, written to DB by addActivity
      addActivity({
        id:    `repay_${req.id}`,
        emoji: '✅',
        text:  `You repaid £${fmtAmt(amt)} to @${funderUser} · +5 pts`,
        time:  'Just now',
        type:  'repaid',
      });
      // Local-only transaction; poll overwrites with DB copy within 5 s
      addTransaction({
        id:          `t_repay_${Date.now()}`,
        type:        'repay',
        amount:      -amt,
        description: `Repaid £${fmtAmt(amt)} to @${funderUser}`,
        date:        'Just now',
        counterparty: req.fundedByName,
        status:      'completed',
      });
      if (funderPushToken) {
        sendPushNotification(
          funderPushToken,
          `✅ ${child.displayName} repaid you!`,
          `${child.displayName} repaid £${fmtAmt(amt)}`,
        ).catch(() => {});
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not repay.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Friends card */}
        <View style={styles.friendsCard}>
          <View style={styles.friendsCardHeader}>
            <Text style={styles.friendsCardTitle}>Friends</Text>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => navigation.navigate('AddFriends')}
              activeOpacity={0.8}
            >
              <Text style={styles.addBtnText}>+ Add</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={circle}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={m => m.id}
            contentContainerStyle={styles.friendsList}
            decelerationRate="fast"
            renderItem={({ item: m }) => (
              <View style={styles.friendItem}>
                <View style={styles.friendAvatarContainer}>
                  {m.profileImageUrl ? (
                    <View style={styles.friendAvatarPhotoWrap}>
                      <Image source={{ uri: m.profileImageUrl }} style={styles.friendAvatarPhoto} resizeMode="cover" />
                    </View>
                  ) : (
                    <View style={styles.friendAvatarBubble}>
                      <Text style={styles.friendAvatarEmoji}>{m.avatarEmoji}</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.removeBtn}
                    onPress={() => handleRemoveFriend(m.id, m.displayName)}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="close" size={10} color="#fff" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.friendUsername} numberOfLines={1}>@{m.username}</Text>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.friendsEmpty}>
                <Text style={styles.friendsEmptyText}>No friends yet — tap Add to invite someone!</Text>
              </View>
            }
          />
        </View>

        {/* Tabs — below friends bar, scrolls with content */}
        <View style={styles.tabsWrap}>
          <TouchableOpacity
            style={[styles.tab, tab === 'activity' && styles.tabActive]}
            onPress={() => setTab('activity')}
          >
            <Text style={[styles.tabText, tab === 'activity' && styles.tabTextActive]}>Activity</Text>
            {(pendingRequests.length + activeRequests.filter(r => !r.isOwn).length) > 0 && (
              <View style={[styles.tabBadge, tab === 'activity' && styles.tabBadgeActive]}>
                <Text style={[styles.tabBadgeText, tab === 'activity' && styles.tabBadgeTextActive]}>
                  {pendingRequests.length + activeRequests.filter(r => !r.isOwn).length}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'history' && styles.tabActive]}
            onPress={() => setTab('history')}
          >
            <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>History</Text>
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
                      {req.profileImageUrl ? (
                        <View style={[styles.avatarCircle, { marginRight: 12, overflow: 'hidden', backgroundColor: 'transparent' }]}>
                          <Image source={{ uri: req.profileImageUrl }} style={{ width: 40, height: 40 }} resizeMode="cover" />
                        </View>
                      ) : (
                        <View style={[styles.avatarCircle, { backgroundColor: colors.primaryLight, marginRight: 12 }]}>
                          <Text style={{ fontSize: 22 }}>{req.avatarEmoji}</Text>
                        </View>
                      )}
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
                    <Text style={styles.loanTitle}>£{fmtAmt(req.amount)} in your wallet</Text>
                    <Text style={styles.loanSub}>{req.reasonEmoji} {req.reason}</Text>
                  </View>
                </View>
                <View style={styles.infoRow}>
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>£{fmtAmt(req.amount)}</Text>
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
                  <Text style={styles.repayBtnText}>Repay £{fmtAmt(req.amount)}</Text>
                </TouchableOpacity>
              </View>
            ))}

            {/* ── YOUR OWN REQUESTS (waiting to be funded) ── */}
            {activeRequests.filter(r => r.isOwn && !r.isFunded).map(req => (
              <View key={req.id} style={[styles.activeLoanCard, styles.ownRequestCard]}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTime}>{req.createdAt}</Text>
                  <View style={styles.expiryPill}>
                    <Ionicons name="time-outline" size={12} color="#D97706" />
                    <Text style={styles.expiryText}>{req.expiresIn}h left</Text>
                  </View>
                </View>
                <View style={styles.loanRow}>
                  <View style={[styles.avatarCircle, { backgroundColor: colors.primaryLight, marginRight: 12 }]}>
                    <Text style={{ fontSize: 20 }}>{req.fromEmoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.loanTitle}>You requested £{fmtAmt(req.amount)}</Text>
                    <Text style={styles.loanSub}>{req.reasonEmoji} {req.reason} · waiting for your circle</Text>
                  </View>
                </View>
                <View style={styles.infoRow}>
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>£{fmtAmt(req.amount)}</Text>
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
                    removeActivity(`a_req_${req.id}`);
                    removeActivity(`moneyreq_${req.id}`);
                    if (childId) db.cancelMoneyRequest(req.id, childId).catch(() => {});
                    db.removeRequestActivities(req.id).catch(() => {});
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
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTime}>{req.createdAt}</Text>
                  <View style={styles.expiryPill}>
                    <Ionicons name="time-outline" size={12} color="#D97706" />
                    <Text style={styles.expiryText}>{req.expiresIn}h left</Text>
                  </View>
                </View>
                <View style={styles.loanRow}>
                  <View style={[styles.avatarCircle, { backgroundColor: colors.primaryLight, marginRight: 12 }]}>
                    <Text style={{ fontSize: 22 }}>{req.fromEmoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.loanTitle}>{req.fromName} needs £{fmtAmt(req.amount)}</Text>
                    <Text style={styles.loanSub}>{req.reasonEmoji} {req.reason}</Text>
                  </View>
                </View>
                <View style={styles.infoRow}>
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>£{fmtAmt(req.amount)}</Text>
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
                  <Text style={styles.loanAmount}>£{fmtAmt(req.amount)}</Text>
                </View>
                <View style={styles.infoRow}>
                  <View style={styles.infoCell}>
                    <Text style={styles.infoCellValue}>£{fmtAmt(req.amount)}</Text>
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
              <TouchableOpacity onPress={loadHistory} style={{ marginLeft: 'auto' }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="refresh-outline" size={18} color={colors.primary} />
              </TouchableOpacity>
            </View>

            {historyLoading && (
              <View style={styles.emptyState}>
                <Text style={styles.emptySubtitle}>Loading…</Text>
              </View>
            )}

            {!historyLoading && loanHistory.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>📋</Text>
                <Text style={styles.emptyTitle}>No history yet</Text>
                <Text style={styles.emptySubtitle}>Completed loans and repayments will appear here once you repay or get repaid.</Text>
              </View>
            )}

            {loanHistory.map(loan => {
              const formatDate = (iso: string | null) => {
                if (!iso) return '—';
                const d = new Date(iso);
                return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
              };
              const counterparty = loan.isBorrower ? loan.funderName : loan.borrowerName;
              const counterpartyUser = loan.isBorrower ? loan.funderUsername : loan.borrowerUsername;
              const counterpartyEmoji = loan.isBorrower ? loan.funderEmoji : loan.borrowerEmoji;
              const counterpartyAvatar = loan.isBorrower ? loan.funderAvatarUrl : loan.borrowerAvatarUrl;

              return (
                <View key={loan.id} style={[styles.activeLoanCard, { borderWidth: 1, borderColor: loan.repaidOnTime ? '#D1FAE5' : '#FEE2E2' }]}>
                  <View style={styles.loanRow}>
                    {counterpartyAvatar ? (
                      <View style={[styles.avatarCircle, { marginRight: 12, overflow: 'hidden', backgroundColor: 'transparent' }]}>
                        <Image source={{ uri: counterpartyAvatar }} style={{ width: 40, height: 40 }} resizeMode="cover" />
                      </View>
                    ) : (
                      <View style={[styles.avatarCircle, { backgroundColor: colors.primaryLight, marginRight: 12 }]}>
                        <Text style={{ fontSize: 22 }}>{counterpartyEmoji}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.loanTitle}>
                        {loan.isBorrower ? 'Borrowed from' : 'Lent to'} @{counterpartyUser}
                      </Text>
                      <Text style={styles.loanSub}>{loan.reasonEmoji} {loan.reason}</Text>
                    </View>
                    <Text style={styles.loanAmount}>£{fmtAmt(loan.amount)}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <View style={styles.infoCell}>
                      <Text style={styles.infoCellValue}>{formatDate(loan.createdAt)}</Text>
                      <Text style={styles.infoCellLabel}>started</Text>
                    </View>
                    <View style={styles.infoDivider} />
                    <View style={styles.infoCell}>
                      <Text style={styles.infoCellValue}>{formatDate(loan.repaidAt)}</Text>
                      <Text style={styles.infoCellLabel}>repaid</Text>
                    </View>
                    <View style={styles.infoDivider} />
                    <View style={styles.infoCell}>
                      <View style={[styles.fundedBadge, { backgroundColor: loan.repaidOnTime ? '#F0FDF4' : '#FEF2F2' }]}>
                        <Ionicons name={loan.repaidOnTime ? 'checkmark-circle' : 'close-circle'} size={13} color={loan.repaidOnTime ? '#16A34A' : colors.error} />
                        <Text style={[styles.fundedBadgeText, { color: loan.repaidOnTime ? '#16A34A' : colors.error }]}>
                          {loan.repaidOnTime ? 'On time' : loan.status === 'defaulted' ? 'Defaulted' : 'Late'}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
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
        confirmLabel={`Fund £${fmtAmt(fundingRequest?.amount ?? 0)}`}
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
        confirmLabel={`Repay £${fmtAmt(repayingRequest?.amount ?? 0)}`}
        confirmColor="#16A34A"
        onConfirm={confirmRepay}
        onCancel={() => setRepayingRequest(null)}
      />


    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F4FC' },

  // Friends card
  friendsCard: {
    backgroundColor: '#fff', borderRadius: 20, paddingTop: 12, paddingBottom: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  friendsCardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, marginBottom: 8,
  },
  friendsCardTitle: { fontSize: 16, fontWeight: '800', color: '#1A1A3E' },
  addBtn: {
    backgroundColor: colors.primaryLight, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  addBtnText: { fontSize: 13, fontWeight: '700', color: colors.primary },

  // Friends avatar row — compact, 4 per view, horizontally scrollable
  friendsList: { paddingHorizontal: 12, paddingBottom: 14 },
  friendItem: { width: FRIEND_ITEM_W, alignItems: 'center', paddingVertical: 6, gap: 5 },
  friendAvatarContainer: { position: 'relative' },
  removeBtn: {
    position: 'absolute', top: -2, right: -2,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#fff',
  },
  friendAvatarPhotoWrap: { width: FRIEND_AVATAR_SIZE, height: FRIEND_AVATAR_SIZE, borderRadius: FRIEND_AVATAR_SIZE / 2, overflow: 'hidden' },
  friendAvatarPhoto: { width: FRIEND_AVATAR_SIZE, height: FRIEND_AVATAR_SIZE },
  friendAvatarBubble: {
    width: FRIEND_AVATAR_SIZE, height: FRIEND_AVATAR_SIZE, borderRadius: FRIEND_AVATAR_SIZE / 2,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  friendAvatarEmoji: { fontSize: 24 },
  friendUsername: { fontSize: 11, fontWeight: '600', color: '#1A1A3E', textAlign: 'center', maxWidth: FRIEND_ITEM_W - 8 },
  friendsEmpty: { paddingHorizontal: 4, paddingBottom: 14, paddingTop: 4, justifyContent: 'center' },
  friendsEmptyText: { fontSize: 13, color: colors.textSecondary },

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
  cardHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10,
  },
  cardTime: {
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
