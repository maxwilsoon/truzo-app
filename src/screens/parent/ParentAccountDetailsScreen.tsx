import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../../context/AppContext';

const PURPLE = '#4F35F3';

export const ParentAccountDetailsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { parent } = useApp();
  const [showPassword, setShowPassword] = useState(false);

  const rows: { icon: any; label: string; value: string; isPassword?: boolean; isAddress?: boolean }[] = [
    { icon: 'mail-outline',     label: 'Email address', value: parent.email },
    { icon: 'call-outline',     label: 'Phone number',  value: parent.mobile },
    { icon: 'lock-closed-outline', label: 'Password',   value: parent.password, isPassword: true },
    { icon: 'home-outline',     label: 'Home address',  value: parent.address, isAddress: true },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color="#1A1A3E" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          {rows.map((row, index) => (
            <View
              key={row.label}
              style={[styles.row, index < rows.length - 1 && styles.rowBorder]}
            >
              <View style={styles.iconWrap}>
                <Ionicons name={row.icon} size={20} color={PURPLE} />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                {row.isPassword ? (
                  <View style={styles.passwordRow}>
                    <Text style={styles.rowValue}>
                      {showPassword ? row.value : '•'.repeat(row.value.length)}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setShowPassword(v => !v)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons
                        name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                        size={20}
                        color="#9CA3AF"
                      />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={[styles.rowValue, row.isAddress && styles.rowValueAddress]}>
                    {row.value || '—'}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>

        <View style={styles.noticeWrap}>
          <Ionicons name="shield-checkmark-outline" size={18} color={PURPLE} />
          <Text style={styles.noticeText}>
            To update your details, please contact Truzo support.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F2F2F7' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A3E' },

  scroll: { padding: 16, paddingBottom: 40 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#EDE8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    marginTop: 2,
  },
  rowContent: { flex: 1 },
  rowLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    marginBottom: 4,
  },
  rowValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A3E',
  },
  rowValueAddress: {
    lineHeight: 22,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  noticeWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#EDE8FF',
    borderRadius: 14,
    padding: 14,
    marginTop: 16,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    color: '#4F35F3',
    lineHeight: 19,
    marginLeft: 10,
    fontWeight: '500',
  },
});
