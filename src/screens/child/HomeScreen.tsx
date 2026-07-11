import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../../navigation/types';
import { colors, getTierInfo, getTierPercentile } from '../../theme/colors';
import { TrustScoreRing } from '../../components/TrustScoreRing';
import { useApp } from '../../context/AppContext';
import { fmtAmt } from '../../lib/utils';

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { child, circle, frozenAccount, parentDebt, activityFeed } = useApp();
  const [showAllLeaderboard, setShowAllLeaderboard] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);

  // Activity feed is the public circle feed — hide private wallet events, sort newest first
  const now = Date.now();
  const circleActivity = activityFeed
    .filter(a => a.type !== 'topup' && a.type !== 'spend')
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : now;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : now;
      return tb - ta;
    });

  const tier = getTierInfo(child.trustScore);
  const percentile = getTierPercentile(child.trustScore);

  const leaderboard = [
    { rank: 1, name: 'You', emoji: child.avatarEmoji, photo: child.profileImageUrl, score: child.trustScore, isYou: true },
    ...circle.map((m, i) => ({ rank: i + 2, name: m.displayName, emoji: m.avatarEmoji, photo: m.profileImageUrl, score: m.trustScore, isYou: false })),
  ].sort((a, b) => b.score - a.score).map((m, i) => ({ ...m, rank: i + 1 }));

  const visibleLeaderboard = showAllLeaderboard ? leaderboard : leaderboard.slice(0, 3);
  const rankColors: Record<number, string> = { 1: colors.gold, 2: colors.silver, 3: colors.bronze };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.profileBtn} onPress={() => navigation.navigate('AvatarPicker')}>
          {child.profileImageUrl ? (
            <View style={styles.profileAvatarWrap}>
              <Image source={{ uri: child.profileImageUrl }} style={styles.profilePhoto} resizeMode="cover" />
            </View>
          ) : (
            <View style={styles.profileAvatar}>
              <Text style={styles.profileEmoji}>{child.avatarEmoji}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {frozenAccount && (
        <View style={styles.frozenBanner}>
          <Text style={styles.frozenText}>🔒 Account frozen — £{fmtAmt(parentDebt)} auto-paid to Jordan Lee from your parent's safety pool · -15 trust pts</Text>
          <Text style={styles.frozenSub}>Pay your parent back £{fmtAmt(parentDebt)}, then ask them to confirm in their app to unfreeze your account.</Text>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Trust Score Card */}
        <TouchableOpacity style={styles.trustCard} onPress={() => navigation.navigate('TrustStats')} activeOpacity={0.9}>
          <View style={styles.sparkle}><Text>✦</Text></View>
          <View style={styles.trustLeft}>
            <TrustScoreRing score={child.trustScore} size={110} />
          </View>
          <View style={styles.trustRight}>
            <Text style={styles.trustLabel}>TRUST SCORE</Text>
            <Text style={styles.trustTier}>{tier.emoji} <Text style={{ color: tier.color }}>{tier.tier}</Text></Text>
            <View style={styles.percentilePill}>
              <Text style={styles.percentileText}>{percentile}</Text>
            </View>
            <Text style={styles.trustDesc} numberOfLines={2}>{tier.description}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textLight} style={{ position: 'absolute', right: 0, top: 4 }} />
          </View>
          <View style={styles.trustStats}>
            <View style={styles.statPill}>
              <Text style={styles.statEmoji}>✅</Text>
              <Text style={[styles.statText, { color: colors.primary }]}>Repaid {child.repaid}</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statEmoji}>⚠️</Text>
              <Text style={styles.statText}>{child.missed} missed</Text>
            </View>
            {child.streak > 0 && (
              <View style={styles.statPill}>
                <Text style={styles.statEmoji}>🔥</Text>
                <Text style={styles.statText}>{child.streak} week streak</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        {/* Balance Card */}
        <LinearGradient colors={['#7C3AED', '#5B21B6']} style={styles.balanceCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceAmount}>£{fmtAmt(child.balance)}</Text>
          <TouchableOpacity style={[styles.requestBtn, frozenAccount && styles.requestBtnDisabled]} onPress={() => !frozenAccount && navigation.navigate('RequestMoney')} activeOpacity={0.85}>
            <View style={styles.requestIconWrap}>
              <Text style={{ fontSize: 18 }}>💸</Text>
            </View>
            <Text style={[styles.requestBtnText, frozenAccount && { color: colors.textSecondary }]}>
              {frozenAccount ? 'Account Frozen' : 'Request Money'}
            </Text>
            <Ionicons name={frozenAccount ? 'lock-closed-outline' : 'chevron-forward'} size={20} color={frozenAccount ? colors.textSecondary : colors.primary} />
          </TouchableOpacity>
        </LinearGradient>

        {/* Leaderboard */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🏆 Leaderboard</Text>
          <TouchableOpacity onPress={() => setShowAllLeaderboard(v => !v)}>
            <Text style={styles.viewAll}>{showAllLeaderboard ? 'Show less' : 'View all'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          {visibleLeaderboard.map(item => (
            <View key={item.rank} style={styles.leaderRow}>
              <View style={[styles.rankCircle, { backgroundColor: rankColors[item.rank] ?? '#D1D5DB' }]}>
                <Text style={styles.rankText}>{item.rank}</Text>
              </View>
              {item.photo ? (
                <View style={styles.leaderAvatarWrap}>
                  <Image source={{ uri: item.photo }} style={styles.leaderAvatarPhoto} resizeMode="cover" />
                </View>
              ) : (
                <View style={styles.leaderAvatar}>
                  <Text style={{ fontSize: 22 }}>{item.emoji}</Text>
                </View>
              )}
              <Text style={[styles.leaderName, item.isYou && styles.leaderNameYou]}>
                {item.name}{item.rank === 1 ? ' 👑' : ''}
              </Text>
              <Text style={[styles.leaderScore, { color: item.isYou ? colors.primary : colors.text }]}>{item.score}</Text>
            </View>
          ))}
        </View>

        {/* Activity */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>⚡ Activity</Text>
          <TouchableOpacity onPress={() => setShowAllActivity(v => !v)}>
            <Text style={styles.viewAll}>{showAllActivity ? 'Show less' : 'View all'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          {(showAllActivity ? circleActivity : circleActivity.slice(0, 3)).map(a => (
            <View key={a.id} style={styles.activityRow}>
              <View style={styles.activityIconWrap}>
                <Text style={{ fontSize: 16 }}>{a.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.activityText}>{a.text}</Text>
                <Text style={styles.activityTime}>{a.time}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: colors.white },
  profileBtn: {},
  profileAvatarWrap: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden' },
  profilePhoto: { width: 40, height: 40 },
  profileAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  profileEmoji: { fontSize: 20 },
  leaderAvatarWrap: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden' },
  leaderAvatarPhoto: { width: 40, height: 40 },
  headerGreeting: { fontSize: 17, fontWeight: '700', color: colors.text },
  frozenBanner: { backgroundColor: colors.errorLight, padding: 14, gap: 6 },
  frozenText: { fontSize: 13, color: colors.error, fontWeight: '700' },
  frozenSub: { fontSize: 13, color: '#991B1B', lineHeight: 18 },
  scroll: { padding: 16, gap: 16 },
  trustCard: {
    backgroundColor: colors.primaryLight, borderRadius: 20, padding: 16,
    flexDirection: 'row', flexWrap: 'wrap', gap: 12, position: 'relative',
  },
  sparkle: { position: 'absolute', top: 12, left: 12 },
  trustLeft: { paddingTop: 8 },
  trustRight: { flex: 1, justifyContent: 'center', paddingTop: 4, paddingRight: 20 },
  trustLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1, marginBottom: 4 },
  trustTier: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 6 },
  percentilePill: { alignSelf: 'flex-start', backgroundColor: colors.white, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 8 },
  percentileText: { fontSize: 13, fontWeight: '600', color: colors.text },
  trustDesc: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  trustStats: { flexDirection: 'row', width: '100%', gap: 8 },
  statPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.white, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  statEmoji: { fontSize: 13 },
  statText: { fontSize: 12, fontWeight: '600', color: colors.text },
  balanceCard: { borderRadius: 20, padding: 20 },
  balanceLabel: { fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: '600', marginBottom: 4 },
  balanceAmount: { fontSize: 40, fontWeight: '900', color: colors.white, marginBottom: 16, letterSpacing: -1 },
  requestBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  requestIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  requestBtnText: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.primary },
  requestBtnDisabled: { backgroundColor: colors.surface },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  viewAll: { fontSize: 14, fontWeight: '700', color: colors.primary },
  card: { backgroundColor: colors.white, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.surface },
  rankCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 13, fontWeight: '800', color: colors.text },
  leaderAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  leaderName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  leaderNameYou: { color: colors.primary },
  leaderScore: { fontSize: 17, fontWeight: '800' },
  activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.surface },
  activityIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  activityText: { fontSize: 14, color: colors.text, lineHeight: 20, fontWeight: '500' },
  activityTime: { fontSize: 12, color: colors.textLight, marginTop: 2 },
});
