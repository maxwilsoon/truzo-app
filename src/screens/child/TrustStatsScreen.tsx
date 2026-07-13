import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, getTierInfo } from '../../theme/colors';
import { fmtAmt } from '../../lib/utils';
import { TrustScoreRing } from '../../components/TrustScoreRing';
import { useApp } from '../../context/AppContext';

const TIERS = [
  { min: 0,  max: 29,  emoji: '⚠️', tier: 'Risky',    desc: 'People avoid lending', color: colors.error },
  { min: 30, max: 49,  emoji: '🔄', tier: 'Unproven', desc: 'New or inconsistent',  color: colors.warning },
  { min: 50, max: 69,  emoji: '👍', tier: 'Reliable', desc: 'Default starting goal', color: '#2E7D32' },
  { min: 70, max: 84,  emoji: '⭐', tier: 'Trusted',  desc: 'Strong reputation',    color: colors.success },
  { min: 85, max: 100, emoji: '🏆', tier: 'Elite',    desc: 'Top user',              color: colors.gold },
];

export const TrustStatsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { child } = useApp();
  const tier = getTierInfo(child.trustScore);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-down" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Trust Stats</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Main score */}
        <View style={styles.scoreCard}>
          <TrustScoreRing score={child.trustScore} size={140} />
          <View style={styles.scoreRight}>
            <Text style={styles.tierLabel}>{tier.emoji} {tier.tier}</Text>
            <Text style={styles.tierDesc}>{tier.description}</Text>
            <View style={[styles.streakBadge, { backgroundColor: `${tier.color}20` }]}>
              <Text style={[styles.streakText, { color: tier.color }]}>🔥 {child.streak} week streak</Text>
            </View>
          </View>
        </View>

        {/* Stats grid */}
        <View style={styles.grid}>
          {[
            { label: 'On-time repayments', value: child.repaid, emoji: '✅', color: colors.success },
            { label: 'Missed repayments', value: child.missed, emoji: '❌', color: colors.error },
            { label: 'Times borrowed', value: child.timesBorrowed, emoji: '📩', color: '#2E7D32' },
            { label: 'Times lent', value: child.timesLent, emoji: '🤝', color: colors.cyan },
            { label: 'Amount borrowed', value: `£${fmtAmt(child.totalBorrowed)}`, emoji: '💸', color: colors.warning },
            { label: 'Amount lent', value: `£${fmtAmt(child.totalLent)}`, emoji: '💰', color: colors.success },
          ].map(s => (
            <View key={s.label} style={styles.gridItem}>
              <Text style={styles.gridEmoji}>{s.emoji}</Text>
              <Text style={[styles.gridValue, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.gridLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Trust tiers */}
        <Text style={styles.tiersTitle}>Trust Tiers</Text>
        {TIERS.map(t => (
          <View key={t.tier} style={[styles.tierRow, child.trustScore >= t.min && child.trustScore <= t.max && styles.tierRowActive]}>
            <Text style={styles.tierEmoji}>{t.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.tierName, { color: t.color }]}>{t.tier}</Text>
              <Text style={styles.tierRange}>{t.min}–{t.max} pts · {t.desc}</Text>
            </View>
            {child.trustScore >= t.min && child.trustScore <= t.max && (
              <View style={[styles.youBadge, { backgroundColor: `${t.color}20` }]}>
                <Text style={[styles.youText, { color: t.color }]}>You</Text>
              </View>
            )}
          </View>
        ))}
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  scroll: { padding: 16, gap: 16 },
  scoreCard: { flexDirection: 'row', alignItems: 'center', gap: 20, backgroundColor: colors.primaryLight, borderRadius: 20, padding: 20 },
  scoreRight: { flex: 1 },
  tierLabel: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 6 },
  tierDesc: { fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginBottom: 10 },
  streakBadge: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  streakText: { fontSize: 14, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridItem: { width: '47%', backgroundColor: colors.white, borderRadius: 16, padding: 16, alignItems: 'center' },
  gridEmoji: { fontSize: 28, marginBottom: 6 },
  gridValue: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  gridLabel: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', lineHeight: 16 },
  infoCard: { backgroundColor: colors.white, borderRadius: 16, padding: 16 },
  infoTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.surface },
  infoRowLabel: { fontSize: 14, color: colors.textSecondary },
  infoRowValue: { fontSize: 14, fontWeight: '700' },
  tiersTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.white, borderRadius: 14, padding: 14 },
  tierRowActive: { borderWidth: 2, borderColor: colors.primary },
  tierEmoji: { fontSize: 28 },
  tierName: { fontSize: 16, fontWeight: '700' },
  tierRange: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  youBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  youText: { fontSize: 13, fontWeight: '700' },
});
