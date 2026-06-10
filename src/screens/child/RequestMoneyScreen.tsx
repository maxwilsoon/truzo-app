import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useApp } from '../../context/AppContext';
import { ActiveRequest } from '../../context/AppContext';

const DEADLINES = [
  { label: 'Tomorrow', value: '1d', days: 1 },
  { label: '3 days', value: '3d', days: 3 },
  { label: '1 week', value: '1w', days: 7 },
  { label: '2 weeks', value: '2w', days: 14 },
];

const deadlineToDate = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const REASONS = [
  { label: 'Food', emoji: '🍕' },
  { label: 'Transport', emoji: '🚌' },
  { label: 'Cinema', emoji: '🎬' },
  { label: 'Gaming', emoji: '🎮' },
  { label: 'School', emoji: '📚' },
  { label: 'Clothes', emoji: '👕' },
  { label: 'Drinks', emoji: '🧃' },
  { label: 'Music', emoji: '🎵' },
];

export const RequestMoneyScreen: React.FC = () => {
  const navigation = useNavigation();
  const { child, parent, activeRequests, setActiveRequests, addActivity } = useApp();
  const [amount, setAmount] = useState('');
  const [deadline, setDeadline] = useState('');
  const [reason, setReason] = useState('');
  const [otherReason, setOtherReason] = useState('');

  const maxBorrow = Math.min(
    child.trustScore < 50 ? 20 : child.trustScore < 70 ? 30 : child.trustScore < 85 ? 50 : 100,
    parent.safetyPoolLimit - parent.safetyPoolUsed
  ) - child.loanedOut;

  const amountNum = parseFloat(amount) || 0;
  const isAlreadyBorrowing = child.borrowed > 0 || activeRequests.some(r => r.isOwn && !r.isFunded);
  const canSend = !isAlreadyBorrowing && amountNum > 0 && amountNum <= maxBorrow && deadline && (reason || otherReason.trim());

  const sendRequest = () => {
    const selectedReason = REASONS.find(r => r.label === reason);
    const selectedDeadline = DEADLINES.find(d => d.value === deadline);
    const newRequest: ActiveRequest = {
      id: `own_${Date.now()}`,
      fromId: child.username,
      fromName: child.displayName,
      fromEmoji: child.avatarEmoji,
      fromTrust: child.trustScore,
      amount: amountNum,
      reason: reason || otherReason.trim(),
      reasonEmoji: selectedReason?.emoji ?? '💸',
      deadline: deadline,
      repayByDate: deadlineToDate(selectedDeadline?.days ?? 7),
      expiresIn: 24,
      createdAt: 'Just now',
      isOwn: true,
    };
    setActiveRequests(prev => [newRequest, ...prev]);
    addActivity({
      id: `a_req_${Date.now()}`,
      emoji: '💸',
      text: `You requested £${amountNum.toFixed(2)} — expires in 24h`,
      time: 'Just now',
      type: 'request',
    });
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-down" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Request Money</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Amount */}
        <View style={styles.amountCard}>
          <Text style={styles.amountPrefix}>£</Text>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.textLight}
            maxLength={6}
          />
        </View>
        <Text style={styles.limitNote}>
          Max you can borrow: <Text style={{ color: colors.primary, fontWeight: '700' }}>£{maxBorrow.toFixed(2)}</Text>
        </Text>

        {/* Deadline */}
        <Text style={styles.sectionLabel}>Repay within</Text>
        <View style={styles.chipRow}>
          {DEADLINES.map(d => (
            <TouchableOpacity
              key={d.value}
              style={[styles.chip, deadline === d.value && styles.chipActive]}
              onPress={() => setDeadline(d.value)}
            >
              <Text style={[styles.chipText, deadline === d.value && styles.chipTextActive]}>{d.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Reason */}
        <Text style={styles.sectionLabel}>What's it for?</Text>
        <View style={styles.reasonGrid}>
          {REASONS.map(r => (
            <TouchableOpacity
              key={r.label}
              style={[styles.reasonChip, reason === r.label && styles.reasonChipActive]}
              onPress={() => setReason(r.label)}
            >
              <Text style={styles.reasonEmoji}>{r.emoji}</Text>
              <Text style={[styles.reasonLabel, reason === r.label && styles.reasonLabelActive]}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.otherInput}>
          <TextInput
            style={styles.otherText}
            value={otherReason}
            onChangeText={setOtherReason}
            placeholder="Other reason..."
            placeholderTextColor={colors.textLight}
          />
        </View>

        {/* Info note */}
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>⏰ Your request expires in 24 hours if no one funds it.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {isAlreadyBorrowing ? (
          <View style={styles.alreadyBorrowingBtn}>
            <Text style={styles.alreadyBorrowingText}>Already Borrowing</Text>
          </View>
        ) : (
          <PrimaryButton label="Send Request 🚀" onPress={sendRequest} disabled={!canSend} />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  scroll: { padding: 20, gap: 16 },
  amountCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
  amountPrefix: { fontSize: 40, fontWeight: '800', color: colors.text, marginRight: 4 },
  amountInput: { fontSize: 64, fontWeight: '900', color: colors.text, minWidth: 100, textAlign: 'center' },
  limitNote: { textAlign: 'center', fontSize: 14, color: colors.textSecondary, marginTop: -8 },
  sectionLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  chipRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: colors.primary },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  reasonChip: { width: '22%', alignItems: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  reasonChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  reasonEmoji: { fontSize: 24, marginBottom: 4 },
  reasonLabel: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  reasonLabelActive: { color: colors.primary },
  otherInput: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 16, height: 48, justifyContent: 'center', backgroundColor: colors.surface },
  otherText: { fontSize: 15, color: colors.text },
  infoBox: { backgroundColor: colors.primaryXLight, borderRadius: 12, padding: 14 },
  infoText: { fontSize: 13, color: colors.primary, lineHeight: 20 },
  footer: { padding: 20, paddingTop: 8 },
  alreadyBorrowingBtn: {
    backgroundColor: colors.surface, borderRadius: 50,
    paddingVertical: 20, alignItems: 'center',
    borderWidth: 1.5, borderColor: colors.border,
  },
  alreadyBorrowingText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
});
