import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../../context/AppContext';
import { getTierInfo } from '../../theme/colors';
import { fmtAmt } from '../../lib/utils';

const PURPLE = '#4F35F3';
const GREEN  = '#059669';
const BG     = '#F2F2F7';

type SectionProps = { title: string; icon: string; iconBg: string; iconColor: string; children: React.ReactNode };
const Section: React.FC<SectionProps> = ({ title, icon, iconBg, iconColor, children }) => (
  <View style={styles.section}>
    <View style={styles.sectionHeading}>
      <View style={[styles.sectionIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon as any} size={18} color={iconColor} />
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
    <View style={styles.card}>{children}</View>
  </View>
);

type RowProps = { label: string; value: string; icon: string; last?: boolean; password?: boolean };
const InfoRow: React.FC<RowProps> = ({ label, value, icon, last, password }) => {
  const [show, setShow] = useState(false);
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <View style={styles.rowIconWrap}>
        <Ionicons name={icon as any} size={18} color={PURPLE} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        {password ? (
          <View style={styles.passwordRow}>
            <Text style={styles.rowValue}>{show ? value : '•'.repeat(Math.min(value.length, 12))}</Text>
            <TouchableOpacity onPress={() => setShow(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={18} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.rowValue}>{value || '—'}</Text>
        )}
      </View>
    </View>
  );
};

type StatProps = { label: string; value: string; color?: string };
const Stat: React.FC<StatProps> = ({ label, value, color }) => (
  <View style={styles.stat}>
    <Text style={[styles.statValue, color ? { color } : {}]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

export const ParentAccountDetailsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { parent, child } = useApp();
  const tier = getTierInfo(child.trustScore);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color="#1A1A3E" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Family account</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Parent ─────────────────────────────────────────── */}
        <Section title="Parent account" icon="person-circle-outline" iconBg="#EDE8FF" iconColor={PURPLE}>
          {/* Name badge */}
          <View style={styles.nameBadge}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>
                {(parent.firstName || parent.displayName || 'P').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View>
              <Text style={styles.fullName}>
                {parent.firstName && parent.lastName
                  ? `${parent.firstName} ${parent.lastName}`
                  : parent.displayName || '—'}
              </Text>
              <Text style={styles.displayNameLabel}>
                {parent.displayName ? `Display name: ${parent.displayName}` : ''}
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <InfoRow icon="mail-outline"       label="Email address"  value={parent.email}    />
          <InfoRow icon="call-outline"       label="Phone number"   value={parent.mobile}   />
          <InfoRow icon="lock-closed-outline" label="Password"      value={parent.password} password />
          <InfoRow icon="home-outline"       label="Home address"   value={parent.address}  last />
        </Section>

        {/* Connector arrow */}
        <View style={styles.connector}>
          <View style={styles.connectorLine} />
          <View style={styles.connectorDot}>
            <Ionicons name="people-outline" size={16} color={PURPLE} />
          </View>
          <View style={styles.connectorLine} />
        </View>

        {/* ── Child ──────────────────────────────────────────── */}
        <Section title="Linked child" icon="happy-outline" iconBg="#ECFDF5" iconColor={GREEN}>
          {/* Name badge */}
          <View style={styles.nameBadge}>
            <View style={[styles.avatarCircle, { backgroundColor: '#C4B5F4' }]}>
              <Text style={styles.avatarEmoji}>{child.avatarEmoji || '😊'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fullName}>{child.displayName || '—'}</Text>
              <Text style={styles.displayNameLabel}>@{child.username || '—'}</Text>
            </View>
            {/* Tier pill */}
            <View style={[styles.tierPill, { backgroundColor: `${tier.color}20` }]}>
              <Text style={[styles.tierText, { color: tier.color }]}>{tier.emoji} {tier.tier}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Quick stats row */}
          <View style={styles.statsRow}>
            <Stat label="Balance"     value={`£${fmtAmt(child.balance)}`}     color={PURPLE}  />
            <View style={styles.statDivider} />
            <Stat label="Trust score" value={`${child.trustScore}`}            color={tier.color} />
            <View style={styles.statDivider} />
            <Stat label="Streak"      value={`${child.streak}`}               />
            <View style={styles.statDivider} />
            <Stat label="Age"         value={`${child.age || '—'}`}           />
          </View>

          <View style={styles.divider} />

          <InfoRow icon="at-outline"        label="Username"      value={child.username}      />
          <InfoRow icon="call-outline"      label="Phone number"  value={child.mobile || '—'} />
          <InfoRow icon="wallet-outline"    label="Balance"       value={`£${fmtAmt(child.balance)}`} />
          <InfoRow icon="trending-up-outline" label="Lent to friends" value={`£${fmtAmt(child.loanedOut)}`} />
          <InfoRow icon="trending-down-outline" label="Owes to circle" value={`£${fmtAmt(child.borrowed)}`} last />
        </Section>

        {/* Notice */}
        <View style={styles.notice}>
          <Ionicons name="shield-checkmark-outline" size={16} color={PURPLE} />
          <Text style={styles.noticeText}>To update any details, please contact Truzo support.</Text>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 12,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  backBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A3E' },

  scroll: { padding: 16, paddingBottom: 16 },

  section: { marginBottom: 0 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sectionIcon: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A3E' },

  card: { backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden' },

  nameBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16,
  },
  avatarCircle: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#EDE8FF',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 22, fontWeight: '800', color: PURPLE },
  avatarEmoji:   { fontSize: 24 },
  fullName:      { fontSize: 17, fontWeight: '800', color: '#1A1A3E' },
  displayNameLabel: { fontSize: 13, color: '#9CA3AF', marginTop: 2 },

  divider: { height: 1, backgroundColor: '#F2F2F7', marginHorizontal: 16 },

  row: { flexDirection: 'row', alignItems: 'flex-start', padding: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#F2F2F7' },
  rowIconWrap: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: '#EDE8FF',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12, marginTop: 1,
  },
  rowBody:    { flex: 1 },
  rowLabel:   { fontSize: 12, fontWeight: '600', color: '#9CA3AF', marginBottom: 3 },
  rowValue:   { fontSize: 15, fontWeight: '600', color: '#1A1A3E' },
  passwordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16,
  },
  stat:        { flex: 1, alignItems: 'center' },
  statValue:   { fontSize: 17, fontWeight: '800', color: '#1A1A3E', marginBottom: 3 },
  statLabel:   { fontSize: 11, color: '#9CA3AF', fontWeight: '600' },
  statDivider: { width: 1, height: 32, backgroundColor: '#E5E7EB' },

  tierPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  tierText: { fontSize: 12, fontWeight: '700' },

  connector: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 24, marginVertical: 8,
  },
  connectorLine: { flex: 1, height: 1, backgroundColor: '#D1D1D6' },
  connectorDot:  {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#EDE8FF',
    alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 8,
  },

  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#EDE8FF', borderRadius: 14, padding: 14, marginTop: 16,
  },
  noticeText: { flex: 1, fontSize: 13, color: PURPLE, lineHeight: 19, fontWeight: '500' },
});
