import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';

const Row: React.FC<{ label: string; value: string; isLast?: boolean }> = ({ label, value, isLast }) => (
  <View style={[styles.row, !isLast && styles.rowBorder]}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue}>{value}</Text>
  </View>
);

export const ChildSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { child } = useApp();
  const initial = child.displayName.charAt(0).toUpperCase();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color="#1A1A3E" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
            <TouchableOpacity style={styles.editBtn} onPress={() => navigation.navigate('AvatarPicker' as never)}>
              <Ionicons name="pencil" size={13} color="#555" />
            </TouchableOpacity>
          </View>
          <Text style={styles.name}>{child.displayName}</Text>
          <Text style={styles.ageLine}>Age {child.age}</Text>
        </View>

        {/* Contact details */}
        <View style={styles.section}>
          <Row label="Mobile number" value={child.mobile || 'Not set'} isLast />
        </View>

        {/* Login details */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Your login details</Text>
          <Row label="Username" value={child.username} />
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>Password</Text>
            <View style={styles.passwordRow}>
              <Text style={styles.rowValue}>
                {showPassword ? child.password : '•'.repeat(child.password.length)}
              </Text>
              <TouchableOpacity
                onPress={() => setShowPassword(v => !v)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={{ marginLeft: 8 }}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color="#9CA3AF"
                />
              </TouchableOpacity>
            </View>
          </View>
          <Row label="Date of birth" value={child.age ? `Age ${child.age}` : 'Not set'} isLast />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A3E' },
  scroll: { paddingBottom: 40 },

  avatarSection: { alignItems: 'center', paddingTop: 24, paddingBottom: 32 },
  avatarWrap: { position: 'relative', marginBottom: 14 },
  avatarCircle: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: '#3D8B6E',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 44, fontWeight: '700', color: '#fff' },
  editBtn: {
    position: 'absolute', bottom: 2, right: 2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#F0F0F0',
    borderWidth: 2, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: 22, fontWeight: '800', color: '#1A1A3E', marginBottom: 4 },
  ageLine: { fontSize: 15, color: '#9CA3AF' },

  section: {
    borderTopWidth: 1, borderTopColor: '#E5E7EB',
  },
  sectionHeader: {
    fontSize: 15, fontWeight: '700', color: '#1A1A3E',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 18,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  rowLabel: { fontSize: 16, color: '#1A1A3E' },
  rowValue: { fontSize: 16, color: '#9CA3AF' },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
});
