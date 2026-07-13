import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { useApp } from '../../context/AppContext';

const GREEN = '#C8E8CB';
const GREEN_DARK = '#3D7A45';

type RowProps = {
  icon: string;
  iconBg: string;
  iconColor: string;
  title: string;
  subtitle: string;
  value: boolean;
  onToggle?: (v: boolean) => void;
  locked?: boolean;
};

const NotifRow: React.FC<RowProps> = ({ icon, iconBg, iconColor, title, subtitle, value, onToggle, locked }) => (
  <View style={styles.row}>
    <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
      <Ionicons name={icon as any} size={20} color={iconColor} />
    </View>
    <View style={styles.rowBody}>
      <Text style={styles.rowTitle}>{title}</Text>
      <Text style={styles.rowSub}>{subtitle}</Text>
    </View>
    {locked ? (
      <View style={styles.lockedBadge}>
        <Text style={styles.lockedText}>Always on</Text>
      </View>
    ) : (
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#D1D1D6', true: GREEN }}
        thumbColor="#fff"
        ios_backgroundColor="#D1D1D6"
      />
    )}
  </View>
);

export const ParentNotificationsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { parent, setMarketingNotifications } = useApp();
  const [saving, setSaving] = useState(false);

  const handleMarketingToggle = async (value: boolean) => {
    setSaving(true);
    try {
      await setMarketingNotifications(value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        {saving ? (
          <ActivityIndicator size="small" color={GREEN_DARK} style={{ width: 40 }} />
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Marketing & Updates */}
        <Text style={styles.sectionLabel}>MARKETING & UPDATES</Text>
        <View style={styles.card}>
          <NotifRow
            icon="megaphone-outline"
            iconBg="#E8F5E9"
            iconColor={GREEN_DARK}
            title="Product updates"
            subtitle="New features, app improvements and announcements"
            value={parent.marketingNotifications}
            onToggle={handleMarketingToggle}
          />
          <View style={styles.divider} />
          <NotifRow
            icon="mail-outline"
            iconBg="#E8F5E9"
            iconColor={GREEN_DARK}
            title="Marketing emails"
            subtitle="Offers, tips and Truzo news delivered to your inbox"
            value={parent.marketingNotifications}
            onToggle={handleMarketingToggle}
          />
          <View style={styles.divider} />
          <NotifRow
            icon="gift-outline"
            iconBg="#E8F5E9"
            iconColor={GREEN_DARK}
            title="Promotions & offers"
            subtitle="Special deals and partner offers relevant to your family"
            value={parent.marketingNotifications}
            onToggle={handleMarketingToggle}
          />
        </View>

        <Text style={styles.hint}>
          Turning this off stops all optional marketing and product update communications. Your essential account notifications are not affected.
        </Text>

        {/* Essential notifications — always on */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>ESSENTIAL NOTIFICATIONS</Text>
        <View style={styles.card}>
          <NotifRow
            icon="cash-outline"
            iconBg="#ECFDF5"
            iconColor="#059669"
            title="Loan requests & repayments"
            subtitle="When your child requests money or repays a loan"
            value={true}
            locked
          />
          <View style={styles.divider} />
          <NotifRow
            icon="checkmark-circle-outline"
            iconBg="#ECFDF5"
            iconColor="#059669"
            title="Payment confirmations"
            subtitle="Top-ups and transfers sent to your child"
            value={true}
            locked
          />
          <View style={styles.divider} />
          <NotifRow
            icon="shield-outline"
            iconBg="#ECFDF5"
            iconColor="#059669"
            title="Safety pool activity"
            subtitle="When the safety pool is used to cover a missed repayment"
            value={true}
            locked
          />
          <View style={styles.divider} />
          <NotifRow
            icon="lock-closed-outline"
            iconBg="#ECFDF5"
            iconColor="#059669"
            title="Security & account alerts"
            subtitle="Login attempts, password resets and verification codes"
            value={true}
            locked
          />
        </View>

        <Text style={styles.hint}>
          Essential notifications keep you informed about your family's account activity and cannot be turned off.
        </Text>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 12,
    backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.text },

  scroll: { padding: 16 },

  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: colors.textSecondary,
    letterSpacing: 0.6, marginBottom: 8, paddingHorizontal: 4,
  },

  card: { backgroundColor: colors.white, borderRadius: 16, overflow: 'hidden', marginBottom: 8 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, gap: 14,
  },
  rowIcon: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  rowBody:  { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 2 },
  rowSub:   { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },

  lockedBadge: {
    backgroundColor: '#ECFDF5', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  lockedText: { fontSize: 12, fontWeight: '700', color: '#059669' },

  divider: { height: 1, backgroundColor: colors.surface, marginLeft: 68 },

  hint: {
    fontSize: 13, color: colors.textLight, lineHeight: 19,
    paddingHorizontal: 4, marginBottom: 4,
  },
});
