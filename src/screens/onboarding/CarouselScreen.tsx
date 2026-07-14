import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useApp } from '../../context/AppContext';

const { width } = Dimensions.get('window');
const GREEN      = '#C8E8CB';
const GREEN_DARK = '#3D7A45'; // dark enough for white text (4.3:1 contrast)

// ─── Slide 1: Peer-to-peer transaction ───────────────────────────────────────
// Layout: two avatars connected by a transaction arrow (horizontal)
const Slide1 = () => (
  <View style={s1.wrap}>
    <View style={s1.row}>
      <View style={s1.person}>
        <View style={[s1.avatar, { backgroundColor: '#C8E8CB' }]}>
          <Text style={s1.emoji}>😊</Text>
        </View>
        <Text style={s1.name}>You</Text>
        <View style={s1.badge}><Text style={s1.badgeText}>Borrower</Text></View>
      </View>

      <View style={s1.mid}>
        <View style={s1.amtChip}><Text style={s1.amtText}>£25</Text></View>
        <View style={s1.dashes}>
          {[0,1,2,3,4].map(i => <View key={i} style={s1.dash} />)}
        </View>
        <Text style={s1.arrow}>▶</Text>
      </View>

      <View style={s1.person}>
        <View style={[s1.avatar, { backgroundColor: '#BBF7D0' }]}>
          <Text style={s1.emoji}>🏀</Text>
        </View>
        <Text style={s1.name}>Jordan</Text>
        <View style={[s1.badge, { backgroundColor: '#15803D' }]}><Text style={s1.badgeText}>Lender</Text></View>
      </View>
    </View>

    <View style={s1.funded}>
      <View style={s1.greenDot} />
      <Text style={s1.fundedText}>Funded instantly · Repay by 12 Jun</Text>
    </View>

    <View style={s1.requestCard}>
      <Text style={s1.requestIcon}>🚌</Text>
      <View style={{ flex: 1 }}>
        <Text style={s1.requestTitle}>Bus pass · Jordan Lee</Text>
        <Text style={s1.requestSub}>Requested 2 hours ago</Text>
      </View>
      <Text style={s1.requestAmt}>£25</Text>
    </View>
  </View>
);

// ─── Slide 2: Social circle — grid of friends ────────────────────────────────
// Layout: 3×2 grid of friend cards (very different from slide 1)
const FRIENDS = [
  { emoji: '🦋', name: 'Maya',   score: 72, color: '#818CF8' },
  { emoji: '🎮', name: 'Sam',    score: 45, color: '#94A3B8' },
  { emoji: '🏀', name: 'Jordan', score: 88, color: '#34D399' },
  { emoji: '🎵', name: 'Riley',  score: 61, color: '#60A5FA' },
  { emoji: '🌸', name: 'Zara',   score: 79, color: '#F472B6' },
  { emoji: '🦁', name: 'Leo',    score: 55, color: '#FBBF24' },
];
const Slide2 = () => (
  <View style={s2.wrap}>
    {[0, 1].map(row => (
      <View key={row} style={s2.row}>
        {FRIENDS.slice(row * 3, row * 3 + 3).map((f, i) => (
          <View key={i} style={s2.card}>
            <Text style={s2.emoji}>{f.emoji}</Text>
            <Text style={s2.name}>{f.name}</Text>
            <View style={[s2.scorePill, { backgroundColor: f.color + '33', borderColor: f.color }]}>
              <Text style={[s2.score, { color: f.color }]}>{f.score}</Text>
            </View>
          </View>
        ))}
      </View>
    ))}
    <Text style={s2.hint}>Trust scores update with every repayment</Text>
  </View>
);

// ─── Slide 3: Parent safety pool — vertical dashboard card ───────────────────
// Layout: tall card with pool details (very different — looks like a UI widget)
const Slide3 = () => (
  <View style={s3.wrap}>
    <View style={s3.card}>
      <View style={s3.cardTop}>
        <View style={s3.shieldCircle}><Text style={{ fontSize: 24 }}>🛡️</Text></View>
        <View>
          <Text style={s3.cardTitle}>Parent Safety Pool</Text>
          <Text style={s3.cardSub}>Managed by Sarah</Text>
        </View>
      </View>
      <Text style={s3.amount}>£50.00</Text>
      <Text style={s3.amountLbl}>available to cover loans</Text>
      <View style={s3.barBg}>
        <View style={[s3.barFill, { width: '0%' }]} />
      </View>
      <View style={s3.barLabels}>
        <Text style={s3.barLblText}>£0 used</Text>
        <Text style={s3.barLblText}>£50 limit</Text>
      </View>
    </View>

    <View style={s3.chips}>
      <View style={s3.chip}><Text style={s3.chipEmoji}>✅</Text><Text style={s3.chipText}>Every loan backed</Text></View>
      <View style={s3.chip}><Text style={s3.chipEmoji}>🔒</Text><Text style={s3.chipText}>Parent-controlled</Text></View>
    </View>

    <View style={s3.parentRow}>
      <View style={s3.parentAv}><Text style={{ fontSize: 20 }}>👤</Text></View>
      <View>
        <Text style={s3.parentName}>Sarah · Parent</Text>
        <Text style={s3.parentSub}>🟢 Monitoring activity</Text>
      </View>
    </View>
  </View>
);

// ─── Slide 4: Trust score + tiers — large score gauge ───────────────────────
// Layout: prominent score circle + tier progression + stats row (very different)
const TIERS = [
  { label: 'Starter',  color: '#94A3B8', active: false },
  { label: 'Reliable', color: '#60A5FA', active: true  },
  { label: 'Trusted',  color: '#34D399', active: false },
  { label: 'Elite',    color: '#FBBF24', active: false },
];
const Slide4 = () => (
  <View style={s4.wrap}>
    <View style={s4.top}>
      <View style={s4.scoreCircle}>
        <Text style={s4.scoreNum}>85</Text>
        <Text style={s4.scoreLbl}>Trust{'\n'}Score</Text>
      </View>
      <View style={s4.tierCol}>
        {TIERS.map((t, i) => (
          <View key={i} style={[s4.tier, t.active && { backgroundColor: t.color + '30', borderColor: t.color }]}>
            <View style={[s4.tierDot, { backgroundColor: t.active ? t.color : 'rgba(255,255,255,0.2)' }]} />
            <Text style={[s4.tierLabel, t.active && { color: '#fff', fontWeight: '800' }]}>{t.label}</Text>
            {t.active && <Text style={[s4.tierTag, { color: t.color }]}>You</Text>}
          </View>
        ))}
      </View>
    </View>

    <View style={s4.statsRow}>
      {[
        { icon: '✅', val: '5', lbl: 'Repaid' },
        { icon: '🔥', val: '3',  lbl: 'Streak' },
        { icon: '💎', val: '+25', lbl: 'Points' },
        { icon: '⬆️', val: '#4',  lbl: 'Rank' },
      ].map((s, i) => (
        <View key={i} style={s4.stat}>
          <Text style={s4.statIcon}>{s.icon}</Text>
          <Text style={s4.statVal}>{s.val}</Text>
          <Text style={s4.statLbl}>{s.lbl}</Text>
        </View>
      ))}
    </View>
  </View>
);

// ─── Slide data ───────────────────────────────────────────────────────────────
const SLIDES = [
  { label: 'Peer-to-peer lending',  title: 'Borrow from\nyour circle',  subtitle: 'Friends fund friends instantly. Request money from people you trust — no banks needed.',            Illustration: Slide1 },
  { label: 'Social funding',        title: 'Your trusted\nfriend circle', subtitle: 'Build a network of trusted friends. The stronger your circle, the more support you have.',       Illustration: Slide2 },
  { label: 'Parent-backed safety',  title: 'A safety net\nfor every loan', subtitle: "Parents fund a safety pool that covers every loan — so if something goes wrong, everyone's protected.", Illustration: Slide3 },
  { label: 'Build your reputation', title: 'Earn your\ntrust score',    subtitle: 'Repay on time to climb from Starter to Elite, unlock bigger limits and earn real rewards.',          Illustration: Slide4 },
];

// ─── Main component ───────────────────────────────────────────────────────────
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Carousel'> };

export const CarouselScreen: React.FC<Props> = ({ navigation }) => {
  const { resetSession } = useApp();
  const [idx, setIdx] = useState(0);
  const [footerH, setFooterH] = useState(140);
  const opacity = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fadeTo = (next: number) => {
    const clamped = ((next % SLIDES.length) + SLIDES.length) % SLIDES.length;
    Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      setIdx(clamped);
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
  };

  const handleNav = (next: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    fadeTo(next);
    timerRef.current = setInterval(() => {
      setIdx(prev => {
        const n = (prev + 1) % SLIDES.length;
        fadeTo(n);
        return prev; // actual update happens inside fadeTo
      });
    }, 3000);
  };

  useEffect(() => {
    timerRef.current = setInterval(() => {
      fadeTo(idx + 1);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [idx]);

  const slide = SLIDES[idx];

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.purple} edges={['top']}>
        {/* Progress bars */}
        <View style={styles.bars}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.bar, { opacity: i === idx ? 1 : 0.3 }]} />
          ))}
        </View>

        {/* Slide content fades in/out */}
        <Animated.View style={[styles.slideWrap, { opacity }]}>
          <Text style={styles.label}>{slide.label}</Text>
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.subtitle}>{slide.subtitle}</Text>
          <View style={styles.illuArea}>
            <slide.Illustration />
          </View>
        </Animated.View>
      </SafeAreaView>

      {/* Left / right tap zones */}
      <TouchableOpacity
        style={[styles.tapZone, { left: 0, bottom: footerH }]}
        onPress={() => handleNav(idx - 1)}
        activeOpacity={1}
      />
      <TouchableOpacity
        style={[styles.tapZone, { right: 0, bottom: footerH }]}
        onPress={() => handleNav(idx + 1)}
        activeOpacity={1}
      />

      {/* Fixed footer */}
      <SafeAreaView style={styles.footer} edges={['bottom']} onLayout={e => setFooterH(e.nativeEvent.layout.height)}>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => { resetSession(); navigation.navigate('Email'); }}>
          <Text style={styles.primaryText}>Parent sign up</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.outlineBtn} onPress={() => navigation.navigate('SelectAccount')}>
          <Text style={styles.outlineText}>Have an account? Log in</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
};

// ─── Main styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: GREEN_DARK },
  purple:    { flex: 1, backgroundColor: GREEN_DARK },
  bars:      { flexDirection: 'row', gap: 6, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6 },
  bar:       { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#fff' },
  slideWrap: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  label:     { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600', letterSpacing: 0.3, marginBottom: 10 },
  title:     { color: '#fff', fontSize: 38, fontWeight: '800', lineHeight: 44, marginBottom: 12 },
  subtitle:  { color: 'rgba(255,255,255,0.82)', fontSize: 14, lineHeight: 21 },
  illuArea:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  tapZone:   { position: 'absolute', top: 0, width: '30%' },
  footer:    { backgroundColor: '#E8F5E9', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8, gap: 10 },
  primaryBtn:  { backgroundColor: GREEN, borderRadius: 50, paddingVertical: 16, alignItems: 'center' },
  primaryText: { color: '#1F2937', fontSize: 17, fontWeight: '700' },
  outlineBtn:  { borderRadius: 50, paddingVertical: 16, alignItems: 'center', borderWidth: 1.5, borderColor: GREEN_DARK },
  outlineText: { color: GREEN_DARK, fontSize: 17, fontWeight: '600' },
});

// ─── Illustration styles ──────────────────────────────────────────────────────
const W = width - 48;

const s1 = StyleSheet.create({
  wrap:        { width: W, gap: 12 },
  row:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  person:      { alignItems: 'center', gap: 6, width: 76 },
  avatar:      { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  emoji:       { fontSize: 30 },
  name:        { color: '#fff', fontWeight: '700', fontSize: 14 },
  badge:       { backgroundColor: GREEN, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:   { color: '#fff', fontSize: 10, fontWeight: '700' },
  mid:         { flex: 1, alignItems: 'center', gap: 4 },
  amtChip:     { backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  amtText:     { color: '#fff', fontWeight: '900', fontSize: 18 },
  dashes:      { flexDirection: 'row', gap: 3, width: '100%', justifyContent: 'center' },
  dash:        { width: 6, height: 2, backgroundColor: 'rgba(255,255,255,0.35)', borderRadius: 1 },
  arrow:       { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  funded:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(74,222,128,0.15)', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(74,222,128,0.3)' },
  greenDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ADE80' },
  fundedText:  { color: 'rgba(255,255,255,0.9)', fontSize: 13 },
  requestCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: 14 },
  requestIcon: { fontSize: 28 },
  requestTitle:{ color: '#fff', fontWeight: '700', fontSize: 14 },
  requestSub:  { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 },
  requestAmt:  { color: '#fff', fontWeight: '900', fontSize: 20 },
});

const s2 = StyleSheet.create({
  wrap: { width: W, gap: 10 },
  row:  { flexDirection: 'row', gap: 10 },
  card: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: 12, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  emoji:     { fontSize: 28 },
  name:      { color: '#fff', fontWeight: '700', fontSize: 13 },
  scorePill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1 },
  score:     { fontSize: 12, fontWeight: '800' },
  hint:      { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', marginTop: 2 },
});

const s3 = StyleSheet.create({
  wrap:        { width: W, gap: 12 },
  card:        { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 18, padding: 18, gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  cardTop:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shieldCircle:{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  cardTitle:   { color: '#fff', fontWeight: '800', fontSize: 15 },
  cardSub:     { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  amount:      { color: '#fff', fontSize: 36, fontWeight: '900' },
  amountLbl:   { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: -4 },
  barBg:       { height: 8, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 4 },
  barFill:     { height: 8, backgroundColor: '#4ADE80', borderRadius: 4 },
  barLabels:   { flexDirection: 'row', justifyContent: 'space-between' },
  barLblText:  { color: 'rgba(255,255,255,0.5)', fontSize: 11 },
  chips:       { flexDirection: 'row', gap: 10 },
  chip:        { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 10 },
  chipEmoji:   { fontSize: 16 },
  chipText:    { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },
  parentRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: 12 },
  parentAv:    { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  parentName:  { color: '#fff', fontWeight: '700', fontSize: 14 },
  parentSub:   { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
});

const s4 = StyleSheet.create({
  wrap:        { width: W, gap: 14 },
  top:         { flexDirection: 'row', gap: 14, alignItems: 'center' },
  scoreCircle: { width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', gap: 2 },
  scoreNum:    { color: '#fff', fontSize: 40, fontWeight: '900', lineHeight: 44 },
  scoreLbl:    { color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: '600', textAlign: 'center' },
  tierCol:     { flex: 1, gap: 7 },
  tier:        { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  tierDot:     { width: 10, height: 10, borderRadius: 5 },
  tierLabel:   { flex: 1, color: 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: '600' },
  tierTag:     { fontSize: 11, fontWeight: '800' },
  statsRow:    { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 16, paddingVertical: 14, justifyContent: 'space-around', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  stat:        { alignItems: 'center', gap: 3 },
  statIcon:    { fontSize: 18 },
  statVal:     { color: '#fff', fontSize: 18, fontWeight: '900' },
  statLbl:     { color: 'rgba(255,255,255,0.55)', fontSize: 11 },
});
