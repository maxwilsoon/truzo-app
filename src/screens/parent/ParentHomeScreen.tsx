import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, getTierInfo } from '../../theme/colors';
import { TrustScoreRing } from '../../components/TrustScoreRing';
import { PaymentSheet } from '../../components/PaymentSheet';
import { MoneySheet } from '../../components/MoneySheet';
import { useApp } from '../../context/AppContext';

export const ParentHomeScreen: React.FC = () => {
  const { child, parent, setParent, setChild, addActivity, addTransaction, frozenAccount, parentDebt, repayParent } = useApp();
  const [topUpVisible, setTopUpVisible] = useState(false);
  const [allowanceVisible, setAllowanceVisible] = useState(false);
  const [sendMoneyVisible, setSendMoneyVisible] = useState(false);
  const [topUpPaymentVisible, setTopUpPaymentVisible] = useState(false);
  const [topUpPaymentAmount, setTopUpPaymentAmount] = useState(0);
  const [sendPaymentVisible, setSendPaymentVisible] = useState(false);
  const [sendPaymentAmount, setSendPaymentAmount] = useState(0);
  const tier = getTierInfo(child.trustScore);
  const poolPercent = (parent.safetyPoolUsed / parent.safetyPoolLimit) * 100;

  const ACTIVITY = [
    { id: '1', emoji: '🔔', text: 'Alex requested £15 for gaming', time: '2h ago' },
    { id: '2', emoji: '💚', text: "Alex funded Maya's request · +2 pts", time: '1d ago' },
    { id: '3', emoji: '📈', text: "Alex's trust score reached 50", time: '3d ago' },
    { id: '4', emoji: '✅', text: 'Alex repaid Jordan on time · +1 streak', time: '5d ago' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerGreeting}>Hello, {parent.displayName}</Text>
          <Text style={styles.headerSub}>Parent dashboard</Text>
        </View>
        <View style={styles.headerAvatar}>
          <Ionicons name="person-outline" size={24} color={colors.primary} />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Child overview */}
        <View style={styles.childCard}>
          <View style={styles.childHeader}>
            <View style={styles.childAvatar}><Text style={{ fontSize: 28 }}>{child.avatarEmoji}</Text></View>
            <View>
              <Text style={styles.childName}>{child.displayName}</Text>
              <Text style={styles.childUsername}>@{child.username}</Text>
            </View>
            <View style={[styles.tierPill, { backgroundColor: `${tier.color}20` }]}>
              <Text style={[styles.tierText, { color: tier.color }]}>{tier.emoji} {tier.tier}</Text>
            </View>
          </View>
          <View style={styles.childStats}>
            <TrustScoreRing score={child.trustScore} size={100} />
            <View style={styles.childStatsRight}>
              <View style={styles.childStatRow}>
                <Text style={styles.childStatLabel}>Balance</Text>
                <Text style={styles.childStatValue}>£{child.balance.toFixed(2)}</Text>
              </View>
              <View style={styles.childStatRow}>
                <Text style={styles.childStatLabel}>Lent to friends</Text>
                <Text style={[styles.childStatValue, { color: colors.warning }]}>£{child.loanedOut.toFixed(2)}</Text>
              </View>
              <View style={styles.childStatRow}>
                <Text style={styles.childStatLabel}>Owes to circle</Text>
                <Text style={[styles.childStatValue, { color: child.borrowed > 0 ? colors.error : colors.success }]}>£{child.borrowed.toFixed(2)}</Text>
              </View>
              <View style={styles.childStatRow}>
                <Text style={styles.childStatLabel}>Streak</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="flame-outline" size={14} color="#F97316" />
                  <Text style={styles.childStatValue}>{child.streak}</Text>
                </View>
              </View>
              <View style={styles.childStatRow}>
                <Text style={styles.childStatLabel}>Repaid</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[styles.childStatValue, { color: colors.success }]}>{child.repaid}</Text>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                </View>
              </View>
            </View>
          </View>
          {frozenAccount && (
            <View style={styles.frozenBanner}>
              <View style={styles.frozenRow}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="lock-closed" size={14} color={colors.error} />
                    <Text style={styles.frozenTitle}>Account frozen</Text>
                  </View>
                  <Text style={styles.frozenText}>
                    {child.displayName} missed a loan repayment — £{parentDebt.toFixed(2)} was auto-paid from your safety pool. Once they repay you, confirm below to unfreeze their account.
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.confirmRepayBtn}
                activeOpacity={0.85}
                onPress={() => {
                  repayParent();
                  addActivity({
                    id: `a_repayparent_${Date.now()}`,
                    emoji: '✅',
                    text: `${parent.displayName} confirmed repayment of £${parentDebt.toFixed(2)} · ${child.displayName}'s account unfrozen`,
                    time: 'Just now',
                    type: 'repaid',
                  });
                }}
              >
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                <Text style={styles.confirmRepayText}>Confirm repayment of £{parentDebt.toFixed(2)}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Safety Pool */}
        <LinearGradient colors={['#7C3AED', '#5B21B6']} style={styles.poolCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <View style={styles.poolHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="shield-checkmark-outline" size={16} color="rgba(255,255,255,0.9)" />
            <Text style={styles.poolTitle}>Safety Pool</Text>
          </View>
            <TouchableOpacity style={styles.topUpChip} onPress={() => setTopUpVisible(true)}>
              <Text style={styles.topUpChipText}>Top up</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.poolAmount}>£{parent.safetyPoolLimit - parent.safetyPoolUsed} <Text style={styles.poolSub}>available</Text></Text>
          <View style={styles.poolBar}>
            <View style={[styles.poolFill, { width: `${Math.min(poolPercent, 100)}%` }]} />
          </View>
          <View style={styles.poolFooter}>
            <Text style={styles.poolFooterText}>£{parent.safetyPoolUsed} used of £{parent.safetyPoolLimit}</Text>
            {poolPercent >= 80 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="alert-circle" size={14} color="#FDE68A" />
                <Text style={styles.poolWarning}>80%+ used</Text>
              </View>
            )}
          </View>
        </LinearGradient>

        {/* Quick actions */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setAllowanceVisible(true)}>
            <View style={styles.actionIcon}><Ionicons name="wallet-outline" size={24} color={colors.primary} /></View>
            <Text style={styles.actionLabel}>Set Allowance</Text>
            <Text style={styles.actionValue}>£{parent.weeklyAllowance}/wk</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setSendMoneyVisible(true)}>
            <View style={styles.actionIcon}><Ionicons name="send-outline" size={24} color={colors.primary} /></View>
            <Text style={styles.actionLabel}>Send Money</Text>
            <Text style={styles.actionValue}>Now</Text>
          </TouchableOpacity>
        </View>

        {/* Activity */}
        <View style={styles.sectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="flash-outline" size={16} color={colors.gold} />
            <Text style={styles.sectionTitle}>Recent Activity</Text>
          </View>
        </View>
        <View style={styles.activityList}>
          {ACTIVITY.map(a => (
            <View key={a.id} style={styles.activityRow}>
              <View style={styles.activityIcon}><Text style={{ fontSize: 18 }}>{a.emoji}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.activityText}>{a.text}</Text>
                <Text style={styles.activityTime}>{a.time}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Top up safety pool */}
      <MoneySheet
        visible={topUpVisible}
        title="Top up Safety Pool"
        subtitle={`Current pool: £${parent.safetyPoolLimit} · £${parent.safetyPoolUsed} used`}
        confirmLabel="Pay with Apple Pay"
        isPayment
        onClose={() => setTopUpVisible(false)}
        onConfirm={amt => {
          setTopUpPaymentAmount(amt);
          setTopUpVisible(false);
          setTopUpPaymentVisible(true);
        }}
      />

      {/* Send money to child */}
      <MoneySheet
        visible={sendMoneyVisible}
        title={`Send to ${child.displayName}`}
        subtitle="Added directly to their wallet balance"
        confirmLabel="Pay with Apple Pay"
        isPayment
        onClose={() => setSendMoneyVisible(false)}
        onConfirm={amt => {
          setSendPaymentAmount(amt);
          setSendMoneyVisible(false);
          setSendPaymentVisible(true);
        }}
      />

      {/* Apple Pay — top up safety pool */}
      <PaymentSheet
        visible={topUpPaymentVisible}
        amount={topUpPaymentAmount}
        description="Top up Safety Pool"
        onSuccess={() => {
          setParent(p => ({ ...p, safetyPoolLimit: p.safetyPoolLimit + topUpPaymentAmount }));
          setTopUpPaymentVisible(false);
        }}
        onCancel={() => {
          setTopUpPaymentVisible(false);
          setTopUpVisible(true);
        }}
      />

      {/* Apple Pay — send money to child */}
      <PaymentSheet
        visible={sendPaymentVisible}
        amount={sendPaymentAmount}
        description={`Send to ${child.displayName}`}
        onSuccess={() => {
          setChild(c => ({ ...c, balance: c.balance + sendPaymentAmount }));
          addTransaction({
            id: `tx_send_${Date.now()}`,
            type: 'topup',
            amount: sendPaymentAmount,
            description: `Money from ${parent.displayName}`,
            date: 'Just now',
            status: 'completed',
          });
          addActivity({
            id: `a_topup_${Date.now()}`,
            emoji: '💸',
            text: `${parent.displayName} sent you £${sendPaymentAmount.toFixed(2)}`,
            time: 'Just now',
            type: 'topup',
          });
          setSendPaymentVisible(false);
        }}
        onCancel={() => {
          setSendPaymentVisible(false);
          setSendMoneyVisible(true);
        }}
      />

      {/* Set weekly allowance */}
      <MoneySheet
        visible={allowanceVisible}
        title="Weekly Allowance"
        subtitle={`Currently £${parent.weeklyAllowance}/week · sent automatically`}
        confirmLabel="Set"
        amountSuffix="/week"
        isPayment={false}
        onClose={() => setAllowanceVisible(false)}
        onConfirm={amt => {
          setParent(p => ({ ...p, weeklyAllowance: amt }));
          setAllowanceVisible(false);
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingBottom: 12, backgroundColor: colors.white },
  headerGreeting: { fontSize: 20, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  headerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 16 },
  childCard: { backgroundColor: colors.white, borderRadius: 20, padding: 16 },
  childHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  childAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  childName: { fontSize: 17, fontWeight: '800', color: colors.text },
  childUsername: { fontSize: 13, color: colors.textSecondary },
  tierPill: { marginLeft: 'auto', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  tierText: { fontSize: 12, fontWeight: '700' },
  childStats: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  childStatsRight: { flex: 1, gap: 10 },
  childStatRow: { flexDirection: 'row', justifyContent: 'space-between' },
  childStatLabel: { fontSize: 13, color: colors.textSecondary },
  childStatValue: { fontSize: 13, fontWeight: '700', color: colors.text },
  frozenBanner: { marginTop: 14, backgroundColor: '#FEF2F2', borderRadius: 12, padding: 14, gap: 12, borderWidth: 1.5, borderColor: '#FECACA' },
  frozenRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  frozenTitle: { fontSize: 14, fontWeight: '800', color: colors.error, marginBottom: 4 },
  frozenText: { fontSize: 13, color: '#991B1B', lineHeight: 18 },
  confirmRepayBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#16A34A', borderRadius: 12, paddingVertical: 14 },
  confirmRepayText: { fontSize: 14, fontWeight: '700', color: colors.white, flexShrink: 1 },
  poolCard: { borderRadius: 20, padding: 20 },
  poolHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  poolTitle: { fontSize: 16, fontWeight: '700', color: colors.white },
  topUpChip: { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  topUpChipText: { fontSize: 13, fontWeight: '700', color: colors.white },
  poolAmount: { fontSize: 36, fontWeight: '900', color: colors.white, marginBottom: 12 },
  poolSub: { fontSize: 16, fontWeight: '500', color: 'rgba(255,255,255,0.7)' },
  poolBar: { height: 8, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 4, marginBottom: 8 },
  poolFill: { height: 8, backgroundColor: colors.white, borderRadius: 4 },
  poolFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  poolFooterText: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },
  poolWarning: { fontSize: 13, color: colors.warningLight, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 12 },
  actionBtn: { flex: 1, backgroundColor: colors.white, borderRadius: 16, padding: 16, alignItems: 'center', gap: 6 },
  actionIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  actionValue: { fontSize: 12, color: colors.primary, fontWeight: '700' },
  sectionHeader: { paddingHorizontal: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  activityList: { backgroundColor: colors.white, borderRadius: 16, overflow: 'hidden' },
  activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.surface },
  activityIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  activityText: { fontSize: 14, fontWeight: '500', color: colors.text, lineHeight: 20 },
  activityTime: { fontSize: 12, color: colors.textLight, marginTop: 2 },
});
