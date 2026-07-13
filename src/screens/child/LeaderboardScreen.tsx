import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, getTierInfo } from '../../theme/colors';
import { useApp } from '../../context/AppContext';

const firstNameOf = (full: string) => full.split(' ')[0];

const MEDAL: Record<number, { bg: string; fg: string }> = {
  1: { bg: '#F59E0B', fg: '#FFFFFF' },
  2: { bg: '#9CA3AF', fg: '#FFFFFF' },
  3: { bg: '#CD7F32', fg: '#FFFFFF' },
};

export const LeaderboardScreen: React.FC = () => {
  const navigation = useNavigation();
  const { child, circle } = useApp();

  const all = [
    {
      id: 'me',
      displayName: child.displayName,
      username: child.username,
      avatarEmoji: child.avatarEmoji,
      profileImageUrl: child.profileImageUrl,
      trustScore: child.trustScore,
      isYou: true,
    },
    ...circle.map(m => ({ ...m, isYou: false as const })),
  ]
    .sort((a, b) => b.trustScore - a.trustScore || a.id.localeCompare(b.id))
    .map((m, i) => ({ ...m, rank: i + 1 }));

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Circle Leaderboard</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Empty state when no circle members */}
      {circle.length === 0 ? (
        <View style={s.emptyWrap} accessibilityRole="text">
          <Text style={s.emptyEmoji}>🏆</Text>
          <Text style={s.emptyTitle}>No circle members yet</Text>
          <Text style={s.emptyBody}>Add friends to your circle to see how you all rank.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          accessibilityRole="list"
        >
          {all.map(m => {
            const tier = getTierInfo(m.trustScore);
            const medal = MEDAL[m.rank];
            return (
              <View
                key={m.id}
                style={[s.row, m.isYou && s.rowYou]}
                accessibilityRole="text"
                accessibilityLabel={`Rank ${m.rank}: ${m.isYou ? 'You' : firstNameOf(m.displayName)}, ${m.trustScore} points`}
              >
                {/* Rank badge */}
                <View style={[s.rankBadge, medal ? { backgroundColor: medal.bg } : s.rankBadgePlain]}>
                  <Text style={[s.rankText, !medal && s.rankTextPlain]}>{m.rank}</Text>
                </View>

                {/* Avatar */}
                <View style={[s.avatar, m.isYou && s.avatarYou]}>
                  {m.profileImageUrl ? (
                    <Image source={{ uri: m.profileImageUrl }} style={s.avatarImg} resizeMode="cover" />
                  ) : (
                    <Text style={s.avatarEmoji}>{m.avatarEmoji}</Text>
                  )}
                </View>

                {/* Name + tier */}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.name, m.isYou && s.nameYou]} numberOfLines={1}>
                    {m.isYou ? 'You' : firstNameOf(m.displayName)}
                  </Text>
                  <Text style={[s.tierLabel, { color: tier.color }]} numberOfLines={1}>
                    {tier.emoji} {tier.tier}
                  </Text>
                </View>

                {/* Score */}
                <View style={s.scoreWrap}>
                  <Text style={[s.score, m.isYou && s.scoreYou]}>{m.trustScore}</Text>
                  <Text style={s.scorePts}>pts</Text>
                </View>
              </View>
            );
          })}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9FAFB' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  backBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },

  list: { padding: 16, gap: 10 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  rowYou: { borderWidth: 2, borderColor: colors.primary, shadowOpacity: 0.12 },

  rankBadge:      { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  rankBadgePlain: { backgroundColor: '#F3F4F6' },
  rankText:       { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  rankTextPlain:  { color: '#6B7280' },

  avatar:      { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarYou:   { borderWidth: 2, borderColor: colors.primary },
  avatarImg:   { width: 48, height: 48 },
  avatarEmoji: { fontSize: 22 },

  name:      { fontSize: 15, fontWeight: '700', color: '#111827' },
  nameYou:   { color: colors.primary },
  tierLabel: { fontSize: 12, fontWeight: '600', marginTop: 2 },

  scoreWrap: { alignItems: 'flex-end' },
  score:     { fontSize: 20, fontWeight: '800', color: '#111827' },
  scoreYou:  { color: colors.primary },
  scorePts:  { fontSize: 11, fontWeight: '600', color: '#9CA3AF', marginTop: -2 },

  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#111827', textAlign: 'center' },
  emptyBody:  { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
});
