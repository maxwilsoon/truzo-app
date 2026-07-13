import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { useApp } from '../../context/AppContext';
import { fmtAmt } from '../../lib/utils';

const TX_ICONS: Record<string, { icon: string; bg: string; color: string }> = {
  parent_transfer: { icon: 'gift-outline',              bg: '#D1FAE5', color: '#10B981' },
  topup:           { icon: 'shield-checkmark-outline',  bg: '#E8F5E9', color: '#C8E8CB' },
  allowance:       { icon: 'gift-outline',              bg: '#D1FAE5', color: '#10B981' },
  lend:            { icon: 'person-circle-outline',     bg: '#DBEAFE', color: '#3B82F6' },
  spend:           { icon: 'card-outline',              bg: '#F3F4F6', color: '#6B7280' },
  repay:           { icon: 'person-circle-outline',     bg: '#FEE2E2', color: '#EF4444' },
  borrow:          { icon: 'arrow-down-circle-outline', bg: '#D1FAE5', color: '#10B981' },
  receive:         { icon: 'person-circle-outline',     bg: '#D1FAE5', color: '#10B981' },
};

const CARD_ACTIONS = [
  { icon: 'snow-outline',     label: 'Freeze Card'   },
  { icon: 'eye-outline',      label: 'View PIN'      },
  { icon: 'settings-outline', label: 'Card Settings' },
] as const;

const MastercardLogo: React.FC = () => (
  <View style={s.mastercardWrap}>
    <View style={[s.mastercardCircle, { backgroundColor: '#EB001B' }]} />
    <View style={[s.mastercardCircle, { backgroundColor: '#F79E1B', marginLeft: -10 }]} />
  </View>
);

export const WalletScreen: React.FC = () => {
  const { child, transactions } = useApp();
  const [showAll, setShowAll] = useState(false);
  const displayTx = showAll ? transactions : transactions.slice(0, 4);

  const handleCardAction = (label: string) =>
    Alert.alert(label, `${label} is coming soon.`);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* Page header */}
        <View style={s.pageHeader}>
          <Text style={s.pageTitle}>Wallet</Text>
          <View style={s.pageHeaderIcon}>
            <Ionicons name="wallet-outline" size={22} color="#1A1A3E" />
          </View>
        </View>

        {/* Balance card */}
        <LinearGradient
          colors={['#C8E8CB', '#93C999'] as const}
          style={s.balanceCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Text style={s.balanceLabel}>Your Balance</Text>
          <Text style={s.balanceAmount}>£{fmtAmt(child.balance)}</Text>
          <View style={s.cardFooter}>
            <Text style={s.cardNumber}>•••• 4827</Text>
            <MastercardLogo />
          </View>
        </LinearGradient>

        {/* Card actions */}
        <View style={s.actionsCard}>
          {CARD_ACTIONS.map(a => (
            <TouchableOpacity
              key={a.label}
              style={s.actionBtn}
              onPress={() => handleCardAction(a.label)}
              activeOpacity={0.7}
            >
              <View style={s.actionCircle}>
                <Ionicons name={a.icon as any} size={22} color="#1A1A3E" />
              </View>
              <Text style={s.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Lending stats */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statLabel}>Amount Lent Out</Text>
            <Text style={s.statValue}>£{fmtAmt(child.loanedOut)}</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statLabel}>Amount Borrowed</Text>
            <Text style={[s.statValue, child.borrowed > 0 && s.statValueRed]}>
              £{fmtAmt(child.borrowed)}
            </Text>
          </View>
        </View>

        {/* Transactions header */}
        <View style={s.txHeader}>
          <Text style={s.txSectionTitle}>Transactions</Text>
          <TouchableOpacity onPress={() => setShowAll(v => !v)} activeOpacity={0.7}>
            <Text style={s.seeAll}>{showAll ? 'See less' : 'See all'}</Text>
          </TouchableOpacity>
        </View>

        {/* Transaction list */}
        <View style={s.txList}>
          {displayTx.length === 0 ? (
            <View style={s.txEmpty}>
              <Text style={s.txEmptyText}>No transactions yet</Text>
            </View>
          ) : (
            displayTx.map((tx, i) => {
              const icon = TX_ICONS[tx.type] ?? { icon: 'cash-outline', bg: '#D1FAE5', color: '#10B981' };
              const isPositive = tx.amount > 0;
              const isSpend    = tx.type === 'spend';
              return (
                <View
                  key={tx.id}
                  style={[s.txRow, i < displayTx.length - 1 && s.txRowBorder]}
                >
                  <View style={[s.txIconWrap, { backgroundColor: icon.bg }]}>
                    <Ionicons name={icon.icon as any} size={20} color={icon.color} />
                  </View>
                  <View style={s.txMid}>
                    <Text style={s.txName}>{tx.description}</Text>
                    <Text style={s.txDate}>{tx.date}</Text>
                  </View>
                  <Text style={[
                    s.txAmount,
                    isSpend    ? s.txAmountNeutral :
                    isPositive ? s.txAmountPos     : s.txAmountNeg,
                  ]}>
                    {isPositive ? '+£' : '-£'}{fmtAmt(Math.abs(tx.amount))}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F5F5F5' },
  scroll: { padding: 16, gap: 16 },

  // Page header
  pageHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 4 },
  pageTitle:     { fontSize: 24, fontWeight: '800', color: '#1A1A3E' },
  pageHeaderIcon:{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  // Balance card
  balanceCard:   { borderRadius: 24, padding: 22, minHeight: 158, justifyContent: 'space-between' },
  balanceLabel:  { fontSize: 13, color: 'rgba(0,0,0,0.6)', fontWeight: '500' },
  balanceAmount: { fontSize: 46, fontWeight: '900', color: '#1F2937', letterSpacing: -1, marginTop: 4 },
  cardFooter:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  cardNumber:    { fontSize: 15, color: 'rgba(0,0,0,0.55)', letterSpacing: 2, fontWeight: '500' },

  // Mastercard logo
  mastercardWrap:   { flexDirection: 'row', alignItems: 'center' },
  mastercardCircle: { width: 28, height: 28, borderRadius: 14, opacity: 0.92 },

  // Card actions
  actionsCard: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 20, paddingVertical: 18, paddingHorizontal: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  actionBtn:    { alignItems: 'center', gap: 8 },
  actionCircle: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#F5F5F5',
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { fontSize: 12, fontWeight: '600', color: '#374151' },

  // Lending stats
  statsRow:     { flexDirection: 'row', gap: 12 },
  statCard:     {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  statLabel:    { fontSize: 12, color: '#6B7280', fontWeight: '500' },
  statValue:    { fontSize: 20, fontWeight: '800', color: '#1A1A3E' },
  statValueRed: { color: '#EF4444' },

  // Transactions section
  txHeader:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  txSectionTitle: { fontSize: 18, fontWeight: '800', color: '#1A1A3E' },
  seeAll:         { fontSize: 14, fontWeight: '700', color: colors.primary },

  // Transaction list
  txList: {
    backgroundColor: '#FFFFFF', borderRadius: 20, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  txRow:           { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  txRowBorder:     { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F3F4F6' },
  txIconWrap:      { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  txMid:           { flex: 1 },
  txName:          { fontSize: 14, fontWeight: '700', color: '#1A1A3E', marginBottom: 2 },
  txDate:          { fontSize: 12, color: '#9CA3AF' },
  txAmount:        { fontSize: 15, fontWeight: '800' },
  txAmountPos:     { color: '#22C55E' },
  txAmountNeg:     { color: '#EF4444' },
  txAmountNeutral: { color: '#1A1A3E' },
  txEmpty:         { padding: 32, alignItems: 'center' },
  txEmptyText:     { fontSize: 14, color: '#9CA3AF' },
});
