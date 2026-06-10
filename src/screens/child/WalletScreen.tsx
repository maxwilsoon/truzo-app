import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { useApp } from '../../context/AppContext';

const GIFT_CARDS = [
  { id: 'gc1', name: 'Xbox',        emoji: '🎮', cost: 500, value: '£10' },
  { id: 'gc2', name: 'Starbucks',   emoji: '☕', cost: 500, value: '£5'  },
  { id: 'gc3', name: 'Vue Cinema',  emoji: '🎬', cost: 600, value: '£8'  },
  { id: 'gc4', name: "McDonald's",  emoji: '🍔', cost: 500, value: '£5'  },
  { id: 'gc5', name: 'Spotify',     emoji: '🎵', cost: 750, value: '1 mo' },
];

const TX_ICONS: Record<string, { icon: string; bg: string; color: string }> = {
  topup:     { icon: 'shield-checkmark-outline', bg: '#EDE9FE', color: '#7C3AED' },
  allowance: { icon: 'wallet-outline',           bg: '#D1FAE5', color: '#10B981' },
  lend:      { icon: 'arrow-up-circle-outline',  bg: '#DBEAFE', color: '#3B82F6' },
  spend:     { icon: 'card-outline',             bg: '#FEE2E2', color: '#EF4444' },
  repay:     { icon: 'checkmark-circle-outline', bg: '#D1FAE5', color: '#10B981' },
};

export const WalletScreen: React.FC = () => {
  const { child, transactions } = useApp();
  const [showAll, setShowAll] = useState(false);
  const displayTx = showAll ? transactions : transactions.slice(0, 4);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Virtual Card */}
        <LinearGradient colors={['#7C3AED', '#6D28D9']} style={styles.card} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <View style={styles.cardTop}>
            <Text style={styles.cardBrand}>truzo</Text>
            <View style={styles.cardChipWrap}>
              <View style={styles.cardChip} />
            </View>
          </View>
          <View style={styles.cardBottom}>
            <Text style={styles.cardNumber}>•••• •••• •••• 2025</Text>
            <Text style={styles.cardHolder}>{child.displayName.toUpperCase()}</Text>
          </View>
        </LinearGradient>

        {/* Wallet balance */}
        <View style={styles.sectionRow}>
          <Ionicons name="wallet-outline" size={20} color={colors.text} />
          <Text style={styles.sectionHeading}>Wallet</Text>
        </View>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available balance</Text>
          <Text style={styles.balanceAmount}>£{(child.balance + child.borrowed - child.loanedOut).toFixed(2)}</Text>
          <View style={styles.balanceSplit}>
            <View style={styles.balanceSplitItem}>
              <Text style={styles.splitEmoji}>🤝</Text>
              <View>
                <Text style={styles.splitAmount}>£{child.loanedOut.toFixed(2)}</Text>
                <Text style={styles.splitLabel}>Lent out</Text>
              </View>
            </View>
            <View style={styles.splitDivider} />
            <View style={styles.balanceSplitItem}>
              <Text style={styles.splitEmoji}>⏳</Text>
              <View>
                <Text style={[styles.splitAmount, child.borrowed > 0 && { color: colors.error }]}>
                  £{child.borrowed.toFixed(2)}
                </Text>
                <Text style={styles.splitLabel}>Borrowed</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Rewards */}
        <View style={styles.rewardsCard}>
          <View style={styles.rewardsTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rewardsTitle}>Rewards</Text>
              <Text style={styles.rewardsSub}>Earn by repaying on time & funding friends</Text>
            </View>
            <View style={styles.ptsBadge}>
              <Ionicons name="star" size={22} color={colors.gold} />
              <Text style={styles.ptsNum}>{child.points}</Text>
              <Text style={styles.ptsLabel}>pts</Text>
            </View>
          </View>

          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${Math.min((child.points / 500) * 100, 100)}%` }]} />
          </View>
          <Text style={styles.progressNote}>{Math.max(0, 500 - child.points)} pts to next reward</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.giftRow}>
            {GIFT_CARDS.map(gc => {
              const locked = child.points < gc.cost;
              return (
                <View key={gc.id} style={styles.giftCard}>
                  <Text style={styles.giftEmoji}>{gc.emoji}</Text>
                  <Text style={styles.giftName}>{gc.name}</Text>
                  <Text style={styles.giftValue}>£{gc.value.replace('£','')}</Text>
                  <Text style={styles.giftPts}>{gc.cost} pts</Text>
                  <View style={[styles.giftBtn, locked && styles.giftBtnLocked]}>
                    {locked && <Ionicons name="lock-closed-outline" size={13} color="#9CA3AF" />}
                    <Text style={[styles.giftBtnText, locked && styles.giftBtnTextLocked]}>
                      {gc.cost}
                    </Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* Money In & Out */}
        <View style={styles.sectionRow}>
          <Ionicons name="swap-vertical-outline" size={20} color={colors.text} />
          <Text style={styles.sectionHeading}>Money In & Out</Text>
          <TouchableOpacity onPress={() => setShowAll(v => !v)} style={{ marginLeft: 'auto' }}>
            <Text style={styles.viewAll}>{showAll ? 'Show less' : 'View all'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.txList}>
          {displayTx.map((tx, i) => {
            const icon = TX_ICONS[tx.type] ?? { icon: 'cash-outline', bg: '#D1FAE5', color: '#10B981' };
            const isPositive = tx.amount > 0;
            return (
              <View key={tx.id} style={[styles.txRow, i < displayTx.length - 1 && styles.txRowBorder]}>
                <View style={[styles.txIconWrap, { backgroundColor: icon.bg }]}>
                  <Ionicons name={icon.icon as any} size={20} color={icon.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.txTitle}>{tx.description}</Text>
                  <Text style={styles.txSub}>{tx.type === 'topup' ? 'Parent Added' : tx.type === 'allowance' ? 'Pocket Money' : tx.type === 'lend' ? 'Loan Received' : tx.type === 'spend' ? 'Card Spend' : 'Repayment'} · {tx.date}</Text>
                </View>
                <Text style={[styles.txAmount, { color: isPositive ? '#22C55E' : colors.error }]}>
                  {isPositive ? '+£' : '-£'}{Math.abs(tx.amount).toFixed(2)}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F4FC' },
  scroll: { padding: 16, gap: 16 },

  // Card
  card: { borderRadius: 22, padding: 24, height: 200 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardBrand: { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  cardChipWrap: { width: 44, height: 34, borderRadius: 8, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center' },
  cardChip: { width: 28, height: 20, borderRadius: 4, borderWidth: 2, borderColor: 'rgba(0,0,0,0.25)' },
  cardBottom: { marginTop: 'auto', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  cardNumber: { fontSize: 16, letterSpacing: 2, color: 'rgba(255,255,255,0.9)', fontWeight: '500' },
  cardHolder: { fontSize: 14, fontWeight: '700', color: '#fff', letterSpacing: 1 },

  // Section heading
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  sectionHeading: { fontSize: 18, fontWeight: '800', color: '#1A1A3E' },
  viewAll: { fontSize: 14, fontWeight: '700', color: colors.primary },

  // Balance card
  balanceCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 16 },
  balanceLabel: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  balanceAmount: { fontSize: 40, fontWeight: '900', color: '#1A1A3E', letterSpacing: -1, marginTop: -8 },
  balanceSplit: { flexDirection: 'row', backgroundColor: '#F5F4FC', borderRadius: 14, overflow: 'hidden' },
  balanceSplitItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 10 },
  splitDivider: { width: 1, backgroundColor: colors.border },
  splitEmoji: { fontSize: 22 },
  splitAmount: { fontSize: 15, fontWeight: '800', color: '#1A1A3E' },
  splitLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },

  // Rewards
  rewardsCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 12 },
  rewardsTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rewardsTitle: { fontSize: 18, fontWeight: '800', color: '#1A1A3E', marginBottom: 4 },
  rewardsSub: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  ptsBadge: { width: 68, backgroundColor: '#F5F4FC', borderRadius: 16, alignItems: 'center', paddingVertical: 10 },
  ptsNum: { fontSize: 22, fontWeight: '900', color: colors.primary },
  ptsLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  progressBg: { height: 6, backgroundColor: '#EDE9FE', borderRadius: 3 },
  progressFill: { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
  progressNote: { fontSize: 13, color: colors.textSecondary },
  giftRow: { gap: 10, paddingBottom: 4 },
  giftCard: {
    width: 120, backgroundColor: '#F9F8FF', borderRadius: 16, padding: 14,
    alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: '#EDE9FE',
  },
  giftName: { fontSize: 13, fontWeight: '700', color: '#1A1A3E' },
  giftValue: { fontSize: 16, fontWeight: '900', color: colors.primary },
  giftEmoji: { fontSize: 28 },
  giftPts: { fontSize: 12, color: colors.textSecondary },
  giftBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EDE9FE', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 },
  giftBtnLocked: { backgroundColor: '#F3F4F6' },
  giftBtnText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  giftBtnTextLocked: { color: colors.textSecondary },

  // Transactions
  txList: { backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden' },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  txRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F5F4FC' },
  txIconWrap: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  txTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A3E', marginBottom: 3 },
  txSub: { fontSize: 12, color: colors.textSecondary },
  txAmount: { fontSize: 16, fontWeight: '800' },
});
