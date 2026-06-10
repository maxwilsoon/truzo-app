import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme/colors';
import { useApp } from '../../context/AppContext';

const MenuItem = ({ icon, label, value, onPress, color }: { icon: any; label: string; value?: string; onPress: () => void; color?: string }) => (
  <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
    <View style={[styles.menuIcon, { backgroundColor: color ? `${color}20` : colors.surface }]}>
      <Ionicons name={icon} size={20} color={color ?? colors.textSecondary} />
    </View>
    <Text style={[styles.menuLabel, color && { color }]}>{label}</Text>
    {value && <Text style={styles.menuValue}>{value}</Text>}
    <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
  </TouchableOpacity>
);

export const ParentAccountScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { parent } = useApp();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Account</Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Profile card */}
        <View style={styles.profileCard}>
          <View style={styles.profileLeft}>
            <Text style={styles.profileName}>{parent.displayName}</Text>
            <Text style={styles.profileEmail}>{parent.email}</Text>
            <Text style={styles.profileMobile}>{parent.mobile}</Text>
          </View>
          <View style={styles.profileAvatar}>
            <Text style={{ fontSize: 32 }}>👤</Text>
          </View>
        </View>

        {/* Your account */}
        <Text style={styles.sectionTitle}>Your account</Text>
        <View style={styles.menuSection}>
          <MenuItem icon="shield-checkmark-outline" label="Membership" value="Free" onPress={() => {}} />
          <MenuItem icon="card-outline" label="Payment methods" onPress={() => navigation.navigate('PaymentMethods')} />
          <MenuItem icon="repeat-outline" label="Auto top-up" onPress={() => {}} />
          <MenuItem icon="person-outline" label="Account details" onPress={() => navigation.navigate('ParentAccountDetails')} />
          <MenuItem icon="document-text-outline" label="Parent statements" onPress={() => {}} />
        </View>

        {/* More */}
        <Text style={styles.sectionTitle}>More</Text>
        <View style={styles.menuSection}>
          <MenuItem icon="help-circle-outline" label="Help Centre" onPress={() => {}} />
          <MenuItem icon="star-outline" label="Rate Truzo" onPress={() => navigation.navigate('RateTruzo')} />
          <MenuItem icon="lock-closed-outline" label="Privacy Policy" onPress={() => {}} />
          <MenuItem icon="gift-outline" label="Refer a friend" onPress={() => {}} />
        </View>

        {/* Logout */}
        <View style={styles.menuSection}>
          <MenuItem
            icon="log-out-outline"
            label="Log out"
            color={colors.error}
            onPress={() => {
              Alert.alert('Log out', 'Are you sure you want to log out?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Log out', style: 'destructive', onPress: () => navigation.navigate('WhoIsLoggingIn') },
              ]);
            }}
          />
        </View>

        <Text style={styles.version}>Truzo v1.0.0 · © 2025</Text>
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { padding: 20, paddingBottom: 12, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  scroll: { padding: 16, gap: 16 },
  profileCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.white, borderRadius: 20, padding: 20 },
  profileLeft: { flex: 1 },
  profileName: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 4 },
  profileEmail: { fontSize: 14, color: colors.textSecondary, marginBottom: 2 },
  profileMobile: { fontSize: 14, color: colors.textSecondary },
  profileAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5, paddingHorizontal: 4 },
  menuSection: { backgroundColor: colors.white, borderRadius: 16, overflow: 'hidden' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.surface },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  menuValue: { fontSize: 14, color: colors.textSecondary, marginRight: 4 },
  version: { textAlign: 'center', fontSize: 13, color: colors.textLight },
});
