import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { RootStackParamList } from '../../navigation/types';
import { colors, getTierInfo } from '../../theme/colors';
import { useApp } from '../../context/AppContext';
import { ActivityItem } from '../../context/AppContext';
import { fmtAmt, repayDueLabel, repayCalendarDate } from '../../lib/utils';

// ─── HomeGauge ────────────────────────────────────────────────────────────────
// Arc-only gauge — no text inside, green fill on white track.
// TrustScoreRing (used on TrustStats screen) is not changed.

const GAUGE_START  = 225;
const GAUGE_SWEEP  = 270;

function gaugeXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function gaugePath(cx: number, cy: number, r: number, sweep: number): string {
  if (sweep <= 0) return '';
  const clamped = Math.min(sweep, GAUGE_SWEEP - 0.01);
  const s = gaugeXY(cx, cy, r, GAUGE_START);
  const e = gaugeXY(cx, cy, r, GAUGE_START + clamped);
  const large = clamped > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

const HomeGauge: React.FC<{ score: number; size?: number }> = ({ score, size = 110 }) => {
  const sw = 11;
  const r  = (size - sw) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const filled = GAUGE_SWEEP * (Math.min(100, Math.max(0, score)) / 100);
  return (
    <Svg width={size} height={size}>
      {/* Track */}
      <Path d={gaugePath(cx, cy, r, GAUGE_SWEEP)} stroke="#E5E7EB" strokeWidth={sw} fill="none" strokeLinecap="round" />
      {/* Fill */}
      {filled > 0 && (
        <Path d={gaugePath(cx, cy, r, filled)} stroke="#22C55E" strokeWidth={sw} fill="none" strokeLinecap="round" />
      )}
    </Svg>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────


const getSubtitle = (score: number): string => {
  if (score >= 90) return "You're a trust legend! 🌟";
  if (score >= 75) return "You're building amazing trust.";
  if (score >= 60) return "Keep it up — trust is growing!";
  return "Let's build your trust score!";
};

// Splits activity text into title + optional sub-line for two-line display.
const parseActivity = (text: string): { title: string; sub?: string } => {
  const reqM = text.match(/^(.+?)\s+needs\s+(£[\d,.]+)\s+for\s+(.+)$/);
  if (reqM) {
    const [, name, amt, reason] = reqM;
    return { title: `${name} requested ${amt}`, sub: reason.charAt(0).toUpperCase() + reason.slice(1) };
  }
  const repM = text.match(/^(You repaid)\s+(£[\d,.]+)\s+to\s+(.+)$/);
  if (repM) return { title: `${repM[1]} ${repM[3]}`, sub: repM[2] };
  const funM = text.match(/^(.+?)\s+funded your request of\s+(£[\d,.]+)/);
  if (funM) return { title: `${funM[1]} funded you`, sub: funM[2] };
  const funA = text.match(/^(.+?)\s+funded your request\b/);
  if (funA) { const a = text.match(/(£[\d,.]+)/); return { title: `${funA[1]} funded you`, sub: a?.[1] }; }
  return { title: text };
};

// ─── Component ────────────────────────────────────────────────────────────────

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { child, circle, frozenAccount, parentDebt, activityFeed, activeRequests, setRepayHighlightId } = useApp();
  const [showAllActivity, setShowAllActivity] = useState(false);

  // Activity feed — circle-visible events sorted newest first
  const now = Date.now();
  const circleActivity = activityFeed
    .filter(a => a.type !== 'topup' && a.type !== 'spend')
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : now;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : now;
      return tb - ta;
    });

  const tier = getTierInfo(child.trustScore);

  // Repayment reminder
  const ownFunded  = activeRequests.find(r => r.isOwn && r.isFunded);
  const repayDate  = ownFunded ? repayCalendarDate(ownFunded.repayByDate) : null;
  const dueLabel   = ownFunded ? repayDueLabel(ownFunded.repayByDate) : '';
  const isUrgent   = dueLabel.startsWith('Overdue') || dueLabel === 'Due today';

  const getMember = (text: string) => circle.find(m => m.displayName && text.includes(m.displayName));
  const avatarBg  = (type: ActivityItem['type']) => {
    if (type === 'tier')   return colors.primary;
    if (type === 'joined') return colors.success;
    if (type === 'missed') return colors.error;
    return colors.primaryLight;
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── HEADER ──────────────────────────────────────────────── */}
        <View style={s.header}>
          <View style={s.greetCol}>
            <Text style={s.greetName}>Hey {child.displayName.split(' ')[0]}! 👋</Text>
            <Text style={s.greetSub}>{getSubtitle(child.trustScore)}</Text>
          </View>
          <TouchableOpacity
            style={s.avatarBtn}
            onPress={() => navigation.navigate('ChildProfile')}
            activeOpacity={0.8}
          >
            {child.profileImageUrl ? (
              <Image source={{ uri: child.profileImageUrl }} style={s.headerAvatar} resizeMode="cover" />
            ) : (
              <View style={s.headerAvatarFallback}>
                <Text style={s.headerAvatarEmoji}>{child.avatarEmoji}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ── FROZEN BANNER ───────────────────────────────────────── */}
        {frozenAccount && (
          <View style={s.frozenBanner}>
            <Ionicons name="lock-closed" size={14} color="#991B1B" />
            <Text style={s.frozenText}>
              Account frozen — repay £{fmtAmt(parentDebt)} to your parent to unlock.
            </Text>
          </View>
        )}

        {/* ── REPAYMENT CARD ──────────────────────────────────────── */}
        {ownFunded && (
          <View style={s.repayCard}>
            <View style={s.repayLeft}>
              <Text style={s.repayHeading}>You have a repayment</Text>
              <Text style={s.repayAmount}>
                £{fmtAmt(ownFunded.amount)} to {ownFunded.fundedByName ?? 'friend'}
              </Text>
              <Text style={[s.dueLabel, isUrgent && s.dueLabelUrgent]}>{dueLabel}</Text>
              <TouchableOpacity
                style={s.repayBtn}
                onPress={() => {
                  setRepayHighlightId(ownFunded.id);
                  (navigation as any).navigate('ChildTabs', { screen: 'Circle' });
                }}
                activeOpacity={0.8}
              >
                <Text style={s.repayBtnText}>Repay Now  →</Text>
              </TouchableOpacity>
            </View>
            {repayDate && (
              <View style={s.cal}>
                <View style={s.calTop}>
                  <Text style={s.calMonth}>{repayDate.month}</Text>
                </View>
                <View style={s.calBody}>
                  <Text style={s.calDay}>{repayDate.day}</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ── BALANCE CARD ────────────────────────────────────────── */}
        <LinearGradient
          colors={['#C8E8CB', '#93C999'] as const}
          style={s.balCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View pointerEvents="none" style={s.balDecor1} />
          <View pointerEvents="none" style={s.balDecor2} />
          <Text style={s.balLabel}>{frozenAccount ? '🔒 Account Frozen' : 'Balance'}</Text>
          <Text style={s.balAmount}>£{fmtAmt(child.balance)}</Text>
        </LinearGradient>

        {/* ── TRUST SCORE ─────────────────────────────────────────── */}
        <TouchableOpacity activeOpacity={0.92} onPress={() => navigation.navigate('TrustStats')}>
          <View style={s.trustCard}>
            <View style={s.trustLeft}>
              <Text style={s.trustLabel}>Trust Score</Text>
              <Text style={s.trustBig}>{child.trustScore}</Text>
              <Text style={s.trustTier}>{tier.tier}</Text>
              {child.streak > 0 && (
                <View style={s.streakPill}>
                  <Text style={s.streakText}>🔥 {child.streak} week streak</Text>
                </View>
              )}
            </View>
            <HomeGauge score={child.trustScore} size={110} />
          </View>
        </TouchableOpacity>

        {/* ── RECENT ACTIVITY ─────────────────────────────────────── */}
        <View style={s.sectionRow}>
          <Text style={s.sectionTitle}>Recent Activity</Text>
          <TouchableOpacity onPress={() => setShowAllActivity(v => !v)}>
            <Text style={s.seeAll}>{showAllActivity ? 'Show less' : 'See all'}</Text>
          </TouchableOpacity>
        </View>

        {/* Outer wrapper carries shadow; inner clips border-radius */}
        <View style={s.cardOuter}>
          <View style={s.cardInner}>
            {circleActivity.length === 0 ? (
              <Text style={s.emptyMsg}>No recent activity yet</Text>
            ) : (
              (showAllActivity ? circleActivity : circleActivity.slice(0, 6)).map((a, idx, arr) => {
                const member  = getMember(a.text);
                const { title, sub } = parseActivity(a.text);
                const isBadge = !member && (a.type === 'tier' || a.type === 'joined' || a.type === 'missed');
                const bg      = member ? colors.primaryLight : avatarBg(a.type);

                return (
                  <View key={a.id} style={[s.row, idx < arr.length - 1 && s.rowDivider]}>
                    <View style={[s.avatar, { backgroundColor: bg }]}>
                      {member?.profileImageUrl ? (
                        <Image source={{ uri: member.profileImageUrl }} style={s.avatarImg} resizeMode="cover" />
                      ) : (
                        <Text style={[s.avatarEmoji, isBadge && { color: '#FFFFFF' }]}>
                          {member ? member.avatarEmoji : a.emoji}
                        </Text>
                      )}
                    </View>
                    <View style={s.rowText}>
                      <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
                      {sub ? <Text style={s.rowSub} numberOfLines={1}>{sub}</Text> : null}
                    </View>
                    <Text style={s.rowTime}>{a.time}</Text>
                  </View>
                );
              })
            )}
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { backgroundColor: '#FFFFFF', paddingBottom: 16 },

  // Header
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18 },
  greetCol:  { flex: 1, marginRight: 12 },
  greetName: { fontSize: 24, fontWeight: '800', color: '#111827', letterSpacing: -0.5, marginBottom: 3 },
  greetSub:  { fontSize: 14, color: '#6B7280', fontWeight: '400' },
  avatarBtn:           { padding: 2 },
  headerAvatar:        { width: 46, height: 46, borderRadius: 23 },
  headerAvatarFallback:{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  headerAvatarEmoji:   { fontSize: 24 },

  // Frozen banner
  frozenBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 12, backgroundColor: colors.errorLight, borderRadius: 12, padding: 12 },
  frozenText:   { flex: 1, fontSize: 13, color: '#991B1B', fontWeight: '600', lineHeight: 18 },

  // Repayment card (dark)
  repayCard:    { marginHorizontal: 16, marginBottom: 14, backgroundColor: '#0E0E2C', borderRadius: 20, padding: 22, flexDirection: 'row', alignItems: 'center' },
  repayLeft:    { flex: 1, marginRight: 16 },
  repayHeading: { fontSize: 13, color: 'rgba(255,255,255,0.45)', fontWeight: '500', marginBottom: 6 },
  repayAmount:  { fontSize: 28, color: '#FFFFFF', fontWeight: '800', letterSpacing: -0.5, lineHeight: 34, marginBottom: 8 },
  dueLabel:       { fontSize: 13, fontWeight: '700', color: '#C8E8CB', marginBottom: 16 },
  dueLabelUrgent: { color: '#FCA5A5' },
  repayBtn:     { backgroundColor: '#C8E8CB', borderRadius: 50, paddingVertical: 13, alignItems: 'center' },
  repayBtnText: { fontSize: 15, fontWeight: '700', color: '#1E2900' },

  // Calendar widget
  cal:      { borderRadius: 14, overflow: 'hidden', width: 70 },
  calTop:   { backgroundColor: colors.primary, paddingVertical: 9, alignItems: 'center' },
  calMonth: { fontSize: 11, fontWeight: '800', color: '#1F2937', letterSpacing: 1.5 },
  calBody:  { backgroundColor: '#FFFFFF', paddingVertical: 9, alignItems: 'center' },
  calDay:   { fontSize: 34, fontWeight: '900', color: '#111827', lineHeight: 38 },

  // Balance card
  balCard:   { marginHorizontal: 16, marginBottom: 14, borderRadius: 18, paddingHorizontal: 22, paddingVertical: 22, minHeight: 96, overflow: 'hidden' },
  balLabel:  { fontSize: 13, color: 'rgba(0,0,0,0.6)', fontWeight: '500', marginBottom: 6 },
  balAmount: { fontSize: 36, fontWeight: '900', color: '#1F2937', letterSpacing: -1 },
  balDecor1: { position: 'absolute', top: -28, right: -18, width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(255,255,255,0.22)' },
  balDecor2: { position: 'absolute', top: 16, right: 34, width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(255,255,255,0.14)' },

  // Trust Score card
  trustCard:  { marginHorizontal: 16, marginBottom: 6, backgroundColor: '#FFFFFF', borderRadius: 16, paddingLeft: 22, paddingRight: 12, paddingVertical: 20, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  trustLeft:  { flex: 1 },
  trustLabel: { fontSize: 13, color: '#6B7280', fontWeight: '500', marginBottom: 4 },
  trustBig:   { fontSize: 48, fontWeight: '900', color: '#111827', letterSpacing: -2, lineHeight: 52 },
  trustTier:  { fontSize: 15, color: '#6B7280', fontWeight: '400', marginTop: 2 },
  streakPill: { alignSelf: 'flex-start', marginTop: 10, backgroundColor: colors.primaryLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  streakText: { fontSize: 12, fontWeight: '700', color: '#2E7D32' },

  // Section headers
  sectionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 10 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  seeAll:       { fontSize: 14, fontWeight: '600', color: '#2E7D32' },

  // Card wrapper — outer carries shadow, inner clips border-radius (iOS fix)
  cardOuter: { marginHorizontal: 16, borderRadius: 16, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  cardInner: { borderRadius: 16, overflow: 'hidden' },
  emptyMsg:  { padding: 20, textAlign: 'center', color: colors.textLight, fontSize: 14 },

  // Rows (shared by activity + leaderboard)
  row:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },

  // Activity avatars
  avatar:      { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg:   { width: 44, height: 44 },
  avatarEmoji: { fontSize: 20 },

  // Activity text
  rowText:  { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#111827', lineHeight: 20 },
  rowSub:   { fontSize: 12, fontWeight: '400', color: '#6B7280', lineHeight: 17, marginTop: 1 },
  rowTime:  { fontSize: 12, color: '#9CA3AF', fontWeight: '400' },

});
