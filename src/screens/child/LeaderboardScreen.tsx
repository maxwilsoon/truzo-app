import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, getTierInfo } from '../../theme/colors';
import { useApp } from '../../context/AppContext';

export const LeaderboardScreen: React.FC = () => {
  const navigation = useNavigation();
  const { child, circle } = useApp();

  const all = [
    { id: 'me', displayName: 'You', avatarEmoji: child.avatarEmoji, trustScore: child.trustScore, isYou: true },
    ...circle.map(m => ({ ...m, isYou: false })),
  ].sort((a, b) => b.trustScore - a.trustScore).map((m, i) => ({ ...m, rank: i + 1 }));

  const medalColors: Record<number, string> = { 1: colors.gold, 2: colors.silver, 3: colors.bronze };
  const tier = getTierInfo;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🏆 Leaderboard</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Top 3 podium */}
      <View style={styles.podium}>
        {all.slice(0, 3).map(m => (
          <View key={m.id} style={[styles.podiumItem, m.rank === 1 && styles.podiumFirst]}>
            {m.rank === 1 && <Text style={styles.crown}>👑</Text>}
            <View style={[styles.podiumAvatar, { backgroundColor: m.isYou ? colors.primary : colors.primaryLight }]}>
              <Text style={{ fontSize: m.rank === 1 ? 28 : 22 }}>{m.avatarEmoji}</Text>
            </View>
            <Text style={[styles.podiumName, m.rank === 1 && styles.podiumNameLarge]}>{m.isYou ? 'You' : m.displayName}</Text>
            <Text style={[styles.podiumScore, { color: medalColors[m.rank] }]}>{m.trustScore} pts</Text>
          </View>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {all.map(m => {
          const t = tier(m.trustScore);
          return (
            <View key={m.id} style={[styles.row, m.isYou && styles.rowYou]}>
              <View style={[styles.rankBadge, { backgroundColor: medalColors[m.rank] ?? colors.surface }]}>
                <Text style={[styles.rankText, !medalColors[m.rank] && { color: colors.textSecondary }]}>{m.rank}</Text>
              </View>
              <View style={[styles.avatar, { backgroundColor: m.isYou ? colors.primary : colors.primaryLight }]}>
                <Text style={{ fontSize: 20 }}>{m.avatarEmoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, m.isYou && { color: colors.primary }]}>
                  {m.isYou ? 'You' : m.displayName}{m.rank === 1 ? ' 👑' : ''}
                </Text>
                <Text style={[styles.tierLabel, { color: t.color }]}>{t.emoji} {t.tier}</Text>
              </View>
              <Text style={[styles.score, { color: m.isYou ? colors.primary : colors.text }]}>{m.trustScore}</Text>
            </View>
          );
        })}
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
  podium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 16, padding: 24, backgroundColor: colors.primaryLight },
  podiumItem: { alignItems: 'center', gap: 6 },
  podiumFirst: { marginBottom: 12 },
  crown: { fontSize: 24 },
  podiumAvatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  podiumName: { fontSize: 13, fontWeight: '700', color: colors.text },
  podiumNameLarge: { fontSize: 15 },
  podiumScore: { fontSize: 14, fontWeight: '800' },
  scroll: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 14, padding: 14 },
  rowYou: { borderWidth: 2, borderColor: colors.primary },
  rankBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 13, fontWeight: '800', color: colors.white },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  tierLabel: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  score: { fontSize: 18, fontWeight: '800' },
});
