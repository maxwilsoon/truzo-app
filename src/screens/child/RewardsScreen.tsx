import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { useApp } from '../../context/AppContext';

// ─── Reward data ──────────────────────────────────────────────────────────────

const REWARDS = [
  { id: 'r1', name: 'Amazon £10',      brand: 'amazon',  cost: 1000 },
  { id: 'r2', name: 'Spotify Premium', brand: 'spotify', cost: 1000 },
  { id: 'r3', name: 'Netflix £10',     brand: 'netflix', cost: 1500 },
  { id: 'r4', name: 'Nike £10',        brand: 'nike',    cost: 1500 },
  { id: 'r5', name: 'Xbox £10',        brand: 'xbox',    cost: 500  },
  { id: 'r6', name: "McDonald's £5",   brand: 'mcdonalds', cost: 500 },
];

// ─── Brand logo ───────────────────────────────────────────────────────────────

const BrandLogo: React.FC<{ brand: string }> = ({ brand }) => {
  switch (brand) {
    case 'amazon':
      return (
        <View style={[s.brandBase, { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#F3F4F6' }]}>
          <Text style={{ fontSize: 32, fontWeight: '900', color: '#FF9900', lineHeight: 38 }}>a</Text>
        </View>
      );
    case 'spotify':
      return (
        <View style={[s.brandBase, { backgroundColor: '#1DB954', borderRadius: 30 }]}>
          <Ionicons name="musical-notes" size={26} color="#FFFFFF" />
        </View>
      );
    case 'netflix':
      return (
        <View style={[s.brandBase, { backgroundColor: '#E50914' }]}>
          <Text style={{ fontSize: 32, fontWeight: '900', color: '#FFFFFF', fontStyle: 'italic', lineHeight: 38 }}>N</Text>
        </View>
      );
    case 'nike':
      return (
        <View style={[s.brandBase, { backgroundColor: '#111111' }]}>
          <Ionicons name="checkmark" size={30} color="#FFFFFF" />
        </View>
      );
    case 'xbox':
      return (
        <View style={[s.brandBase, { backgroundColor: '#107C10' }]}>
          <Text style={{ fontSize: 26, fontWeight: '900', color: '#FFFFFF', lineHeight: 32 }}>X</Text>
        </View>
      );
    case 'mcdonalds':
      return (
        <View style={[s.brandBase, { backgroundColor: '#DA291C' }]}>
          <Text style={{ fontSize: 28, fontWeight: '900', color: '#FFC72C', lineHeight: 34 }}>M</Text>
        </View>
      );
    default:
      return (
        <View style={[s.brandBase, { backgroundColor: '#F3F4F6' }]}>
          <Ionicons name="gift-outline" size={24} color="#6B7280" />
        </View>
      );
  }
};

// ─── Motivational message ─────────────────────────────────────────────────────

const getMotivation = (pts: number): string => {
  if (pts >= 2000) return "You're crushing it! 🔥";
  if (pts >= 1000) return "You're doing amazing! 🚀";
  if (pts >= 500)  return "Great progress, keep going! ⭐";
  return "Start earning TRUZO Points! 💪";
};

const fmtPts = (n: number) =>
  n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ─── Component ────────────────────────────────────────────────────────────────

export const RewardsScreen: React.FC = () => {
  const { child } = useApp();

  const handleRedeem = (name: string, cost: number) => {
    if (child.points < cost) {
      Alert.alert(
        'Not enough points',
        `You need ${fmtPts(cost)} pts to redeem ${name}. You currently have ${fmtPts(child.points)} pts.`,
      );
      return;
    }
    Alert.alert(
      `Redeem ${name}`,
      `Use ${fmtPts(cost)} of your ${fmtPts(child.points)} pts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Redeem', onPress: () => Alert.alert('Coming soon', 'Reward redemption is coming soon!') },
      ],
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── SUMMARY CARD ── */}
        <View style={s.summaryCard}>
          <View style={s.summaryLeft}>
            <Text style={s.summaryLabel}>Your TRUZO Points</Text>
            <Text style={s.summaryPoints}>{fmtPts(child.points)}</Text>
            <Text style={s.summaryMotivation}>{getMotivation(child.points)}</Text>
          </View>
          {/* Hexagon-style badge */}
          <View style={s.badgeOuter}>
            <View style={s.badgeInner}>
              <Text style={s.badgeStar}>⭐</Text>
            </View>
          </View>
        </View>

        {/* ── REDEEM REWARDS ── */}
        <View style={s.sectionRow}>
          <Text style={s.sectionTitle}>Redeem Rewards</Text>
        </View>

        {/* ── 2-COLUMN GRID ── */}
        <View style={s.grid}>
          {REWARDS.map(r => {
            const locked = child.points < r.cost;
            return (
              <TouchableOpacity
                key={r.id}
                style={[s.rewardCard, locked && s.rewardCardLocked]}
                onPress={() => handleRedeem(r.name, r.cost)}
                activeOpacity={0.82}
              >
                <BrandLogo brand={r.brand} />
                <Text style={s.rewardName} numberOfLines={2}>{r.name}</Text>
                <Text style={s.rewardPts}>{fmtPts(r.cost)} pts</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F5F5F5' },
  scroll: { padding: 16, gap: 16 },

  // Summary card
  summaryCard: {
    backgroundColor: '#FFFFFF', borderRadius: 22,
    padding: 22, flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 10, elevation: 4,
  },
  summaryLeft:      { flex: 1 },
  summaryLabel:     { fontSize: 13, color: '#6B7280', fontWeight: '500', marginBottom: 4 },
  summaryPoints:    { fontSize: 40, fontWeight: '900', color: '#111827', letterSpacing: -1, lineHeight: 46 },
  summaryMotivation:{ fontSize: 13, color: '#6B7280', marginTop: 6 },

  // Badge (hexagon approximation)
  badgeOuter: {
    width: 76, height: 76, borderRadius: 20,
    backgroundColor: '#93C999',
    alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '10deg' }],
    shadowColor: '#6BBF71', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  badgeInner: {
    width: 64, height: 64, borderRadius: 16,
    backgroundColor: '#C8E8CB',
    alignItems: 'center', justifyContent: 'center',
  },
  badgeStar: { fontSize: 32 },

  // Section header
  sectionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },

  // Reward grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

  rewardCard: {
    width: '47.5%',
    backgroundColor: '#FFFFFF', borderRadius: 18,
    padding: 18, alignItems: 'flex-start', gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  rewardCardLocked: { opacity: 0.6 },

  // Brand logo base
  brandBase: {
    width: 56, height: 56, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },

  // Reward text
  rewardName: { fontSize: 14, fontWeight: '700', color: '#111827', lineHeight: 18 },
  rewardPts:  { fontSize: 13, color: '#6B7280', fontWeight: '500' },
});
