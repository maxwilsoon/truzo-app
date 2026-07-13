import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Platform, Image,
  Modal, FlatList, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { useApp } from '../../context/AppContext';
import { ActiveRequest } from '../../context/AppContext';
import { db } from '../../lib/database';
import { sendPushNotification } from '../../lib/notifications';
import { fmtAmt } from '../../lib/utils';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_FRIEND_AVATARS = 4;

const DEADLINES = [
  { label: 'Tomorrow',  days: 1 },
  { label: '3 days',   days: 3 },
  { label: '1 week',   days: 7 },
  { label: '2 weeks',  days: 14 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDeadlineDate = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  });
};

// ─── Component ────────────────────────────────────────────────────────────────

export const RequestMoneyScreen: React.FC = () => {
  const navigation = useNavigation();
  const {
    child, childId, parent, circle,
    activeRequests, setActiveRequests, addActivity, recordWeeklyStreak, frozenAccount,
  } = useApp();

  // Form state
  const [amount,           setAmount]           = useState('');
  const [deadlineDays,     setDeadlineDays]     = useState(7);
  const [showDeadlineOpts, setShowDeadlineOpts] = useState(false);
  const [sending,          setSending]          = useState(false);

  // Audience state — all circle members selected by default
  const [excludedIds,       setExcludedIds]       = useState<Set<string>>(new Set());
  const [showAudienceModal, setShowAudienceModal] = useState(false);

  // ── Derived ────────────────────────────────────────────────────────────────

  const maxBorrow = Math.min(
    child.trustScore < 50 ? 20 : child.trustScore < 70 ? 30 : child.trustScore < 85 ? 50 : 100,
    parent.safetyPoolLimit - parent.safetyPoolUsed,
  );

  const amountNum   = parseFloat(amount) || 0;
  const viewerIds   = circle.filter(m => !excludedIds.has(m.id)).map(m => m.id);
  const selectedCnt = viewerIds.length;

  const isAlreadyBorrowing = child.borrowed > 0 || activeRequests.some(r => r.isOwn && !r.isFunded);
  const noMembersSelected  = circle.length > 0 && selectedCnt === 0;

  const canSend =
    !frozenAccount &&
    !isAlreadyBorrowing &&
    amountNum > 0 &&
    amountNum <= maxBorrow &&
    deadlineDays > 0 &&
    !noMembersSelected;

  // Quick amounts: standard steps below max + max as final option
  const quickAmounts = [5, 10, 20]
    .filter(a => a < maxBorrow)
    .concat(maxBorrow > 0 ? [maxBorrow] : []);

  // Audience preview: up to 4 friends + overflow chip when circle.length > 4
  const hasOverflow    = circle.length > MAX_FRIEND_AVATARS;
  const previewMembers = circle.slice(0, MAX_FRIEND_AVATARS);
  const overflowCount  = circle.length - MAX_FRIEND_AVATARS;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const toggleMember = (id: string) => {
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSendPress = () => {
    const overBalance = amountNum > child.balance;
    const hasLoaned   = child.loanedOut > 0;

    if (!overBalance && !hasLoaned) { sendRequest(); return; }

    const lines: string[] = [];
    if (overBalance)
      lines.push(`You're requesting £${fmtAmt(amountNum)} but only have £${fmtAmt(child.balance)} in your wallet.`);
    if (hasLoaned)
      lines.push(`You also have £${fmtAmt(child.loanedOut)} loaned out to friends that hasn't been paid back yet.`);
    lines.push('');
    lines.push('💡 Tip: set your repayment date after you expect to receive that money back.');

    if (Platform.OS === 'web') {
      if (window.confirm(`Heads up\n\n${lines.join('\n')}\n\nSend the request anyway?`)) sendRequest();
    } else {
      Alert.alert('Heads up 💡', lines.join('\n'), [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send anyway', onPress: sendRequest },
      ]);
    }
  };

  const sendRequest = async () => {
    if (!childId) return;
    setSending(true);
    try {
      const { requestId, pushTokens } = await db.createMoneyRequest(
        childId, amountNum, deadlineDays,
        viewerIds.length > 0 ? viewerIds : undefined,
      );
      recordWeeklyStreak().catch(() => {});

      const newRequest: ActiveRequest = {
        id: requestId,
        fromId: childId,
        fromName: child.displayName,
        fromEmoji: child.avatarEmoji,
        fromTrust: child.trustScore,
        amount: amountNum,
        reason: '',
        reasonEmoji: '💸',
        deadline: `${deadlineDays}d`,
        repayByDate: formatDeadlineDate(deadlineDays),
        expiresIn: 24,
        createdAt: 'Just now',
        isOwn: true,
      };
      setActiveRequests(prev => [newRequest, ...prev]);
      addActivity({
        id: `a_req_${requestId}`,
        emoji: '💸',
        text: `You requested £${fmtAmt(amountNum)} — expires in 24h`,
        time: 'Just now',
        type: 'request',
      });

      pushTokens.forEach(token => {
        sendPushNotification(
          token,
          `💸 ${child.displayName} needs money`,
          `${child.displayName} requested £${fmtAmt(amountNum)}`,
        ).catch(() => {});
      });

      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not send request.');
    } finally {
      setSending(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.headerBtn} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Borrow</Text>
        <TouchableOpacity style={s.headerBtn} accessibilityRole="button">
          <Ionicons name="information-circle-outline" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Safety pool gate */}
          {parent.safetyPoolLimit === 0 && (
            <View style={s.safetyGate}>
              <Ionicons name="shield-outline" size={20} color="#7C3AED" />
              <Text style={s.safetyGateText}>
                Your parent hasn't set up a Safety Pool yet. Ask them to add one before you can borrow.
              </Text>
            </View>
          )}

          {/* Already borrowing gate */}
          {isAlreadyBorrowing && (
            <View style={[s.safetyGate, { borderColor: '#FCA5A5', backgroundColor: '#FFF1F2' }]}>
              <Ionicons name="alert-circle-outline" size={20} color="#DC2626" />
              <Text style={[s.safetyGateText, { color: '#991B1B' }]}>
                You already have an active request or outstanding loan.
              </Text>
            </View>
          )}

          {/* Amount */}
          <Text style={s.questionLabel}>How much do you need?</Text>

          <View style={s.amountRow}>
            <Text style={s.currencySymbol}>£</Text>
            <TextInput
              style={s.amountInput}
              value={amount}
              onChangeText={v => {
                const clean = v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                setAmount(clean);
              }}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#D1D5DB"
              maxLength={6}
              selectionColor={colors.primary}
            />
          </View>
          <Text style={s.limitNote}>Max borrow limit £{fmtAmt(maxBorrow)}</Text>

          {/* Quick amounts */}
          <View style={s.quickRow}>
            {quickAmounts.map(a => {
              const active = amount === String(a);
              return (
                <TouchableOpacity
                  key={a}
                  style={[s.quickChip, active && s.quickChipActive]}
                  onPress={() => setAmount(String(a))}
                  activeOpacity={0.7}
                >
                  <Text style={[s.quickChipText, active && s.quickChipTextActive]}>£{a}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* By when */}
          <TouchableOpacity
            style={s.dateCard}
            onPress={() => setShowDeadlineOpts(v => !v)}
            activeOpacity={0.8}
          >
            <Text style={s.dateText}>{formatDeadlineDate(deadlineDays)}</Text>
            <Ionicons
              name={showDeadlineOpts ? 'calendar' : 'calendar-outline'}
              size={20}
              color={colors.primary}
            />
          </TouchableOpacity>

          {showDeadlineOpts && (
            <View style={s.deadlinePanel}>
              {DEADLINES.map(d => {
                const active = d.days === deadlineDays;
                return (
                  <TouchableOpacity
                    key={d.days}
                    style={[s.deadlineRow, active && s.deadlineRowActive]}
                    onPress={() => { setDeadlineDays(d.days); setShowDeadlineOpts(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.deadlineLabel, active && s.deadlineLabelActive]}>{d.label}</Text>
                    <Text style={[s.deadlineDate, active && s.deadlineDateActive]}>
                      {formatDeadlineDate(d.days)}
                    </Text>
                    {active && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Who will see this request */}
          <View style={s.audienceCard}>
            <Text style={s.audienceTitle}>Who will see this request?</Text>
            <Text style={s.audienceSub}>This request will be sent to your circle</Text>

            {circle.length === 0 ? (
              <Text style={s.audienceEmpty}>Add friends to your circle to send requests.</Text>
            ) : (
              <View style={s.avatarsRow}>
                {previewMembers.map(m => {
                  const excluded = excludedIds.has(m.id);
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={s.avatarWrap}
                      onPress={() => toggleMember(m.id)}
                      activeOpacity={0.75}
                    >
                      <View style={[s.avatarRing, !excluded && s.avatarRingSelected]}>
                        {m.profileImageUrl ? (
                          <Image source={{ uri: m.profileImageUrl }} style={s.avatarImg} resizeMode="cover" />
                        ) : (
                          <View style={s.avatarFallback}>
                            <Text style={{ fontSize: 22 }}>{m.avatarEmoji}</Text>
                          </View>
                        )}
                        {excluded && (
                          <View style={s.avatarExcluded}>
                            <Ionicons name="close" size={14} color="#FFFFFF" />
                          </View>
                        )}
                      </View>
                      <Text style={s.avatarUsername} numberOfLines={1}>@{m.username}</Text>
                    </TouchableOpacity>
                  );
                })}

                {hasOverflow && (
                  <TouchableOpacity
                    style={s.overflowChip}
                    onPress={() => setShowAudienceModal(true)}
                    activeOpacity={0.8}
                  >
                    <Text style={s.overflowText}>+{overflowCount}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={s.footer}>
          {isAlreadyBorrowing ? (
            <View style={s.disabledBtn}>
              <Text style={s.disabledBtnText}>Already Borrowing</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[s.requestBtn, (!canSend || sending) && s.requestBtnDisabled]}
              onPress={handleSendPress}
              disabled={!canSend || sending}
              activeOpacity={0.85}
            >
              {sending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={s.requestBtnText}>
                  Request {amountNum > 0 ? `£${fmtAmt(amountNum)}` : '£—'}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Audience selection modal */}
      <Modal
        visible={showAudienceModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAudienceModal(false)}
      >
        <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Select audience</Text>
            <TouchableOpacity onPress={() => setShowAudienceModal(false)} style={s.modalDone}>
              <Text style={s.modalDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.modalSub}>Tap to include or exclude each person</Text>

          <FlatList
            data={circle}
            keyExtractor={m => m.id}
            contentContainerStyle={s.modalList}
            renderItem={({ item: m }) => {
              const excluded = excludedIds.has(m.id);
              return (
                <TouchableOpacity
                  style={[s.modalRow, !excluded && s.modalRowSelected]}
                  onPress={() => toggleMember(m.id)}
                  activeOpacity={0.7}
                >
                  <View style={[s.modalAvatar, !excluded && s.modalAvatarSelected]}>
                    {m.profileImageUrl ? (
                      <Image source={{ uri: m.profileImageUrl }} style={s.modalAvatarImg} resizeMode="cover" />
                    ) : (
                      <Text style={{ fontSize: 20 }}>{m.avatarEmoji}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.modalName, excluded && s.modalNameExcluded]}>{m.displayName}</Text>
                    <Text style={s.modalUsername}>@{m.username}</Text>
                  </View>
                  <View style={[s.checkbox, !excluded && s.checkboxChecked]}>
                    {!excluded && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                  </View>
                </TouchableOpacity>
              );
            }}
          />

          <View style={s.modalFooter}>
            <Text style={s.modalCount}>
              {selectedCnt} {selectedCnt === 1 ? 'person' : 'people'} will see this request
            </Text>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 56;

const s = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { padding: 20, paddingBottom: 8, gap: 18 },

  // Header
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  headerBtn:   { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },

  // Gates
  safetyGate:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#F5F3FF', borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: '#DDD6FE' },
  safetyGateText: { flex: 1, fontSize: 14, color: '#4C1D95', lineHeight: 20 },

  // Amount
  questionLabel: { fontSize: 16, fontWeight: '700', color: '#111827', textAlign: 'center' },
  amountRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  currencySymbol:{ fontSize: 42, fontWeight: '800', color: '#111827', marginRight: 4, lineHeight: 72 },
  amountInput:   { fontSize: 72, fontWeight: '900', color: '#111827', minWidth: 80, textAlign: 'center', padding: 0 },
  limitNote:     { textAlign: 'center', fontSize: 13, color: '#9CA3AF', marginTop: -8 },

  // Quick amounts
  quickRow:           { flexDirection: 'row', gap: 10 },
  quickChip:          { flex: 1, paddingVertical: 12, borderRadius: 50, borderWidth: 1.5, borderColor: '#E5E7EB', alignItems: 'center', backgroundColor: '#F9FAFB' },
  quickChipActive:    { backgroundColor: colors.primary, borderColor: colors.primary },
  quickChipText:      { fontSize: 15, fontWeight: '700', color: '#374151' },
  quickChipTextActive:{ color: '#FFFFFF' },

  // Date picker
  dateCard:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#F9FAFB' },
  dateText:  { fontSize: 15, fontWeight: '600', color: '#111827' },
  deadlinePanel:       { borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 14, overflow: 'hidden', marginTop: -10 },
  deadlineRow:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, backgroundColor: '#FFFFFF', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F3F4F6' },
  deadlineRowActive:   { backgroundColor: colors.primaryLight },
  deadlineLabel:       { fontSize: 14, fontWeight: '600', color: '#374151', width: 70 },
  deadlineLabelActive: { color: colors.primary },
  deadlineDate:        { flex: 1, fontSize: 13, color: '#9CA3AF' },
  deadlineDateActive:  { color: colors.primary },

  // Audience card
  audienceCard:  { backgroundColor: '#F5F3FF', borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: '#DDD6FE' },
  audienceTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 2 },
  audienceSub:   { fontSize: 13, color: '#6B7280', marginBottom: 14 },
  audienceEmpty: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', paddingVertical: 8 },

  avatarsRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' },
  avatarWrap:    { alignItems: 'center', gap: 5, width: AVATAR_SIZE },
  avatarUsername:{ fontSize: 10, fontWeight: '600', color: '#6B7280', textAlign: 'center', width: AVATAR_SIZE },
  avatarRing:         { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, borderWidth: 2.5, borderColor: '#D1D5DB', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  avatarRingSelected: { borderColor: colors.primary },
  avatarImg:          { width: AVATAR_SIZE, height: AVATAR_SIZE },
  avatarFallback:     { width: AVATAR_SIZE, height: AVATAR_SIZE, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarExcluded: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },

  overflowChip: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  overflowText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },

  // Footer
  footer:             { paddingHorizontal: 20, paddingBottom: 8, paddingTop: 12 },
  requestBtn:         { backgroundColor: colors.primary, borderRadius: 50, paddingVertical: 18, alignItems: 'center' },
  requestBtnDisabled: { backgroundColor: '#C4B5FD' },
  requestBtnText:     { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  disabledBtn:        { backgroundColor: '#F3F4F6', borderRadius: 50, paddingVertical: 18, alignItems: 'center', borderWidth: 1.5, borderColor: '#E5E7EB' },
  disabledBtnText:    { fontSize: 16, fontWeight: '700', color: '#9CA3AF' },

  // Audience modal
  modalSafe:        { flex: 1, backgroundColor: '#FFFFFF' },
  modalHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  modalTitle:       { fontSize: 17, fontWeight: '800', color: '#111827' },
  modalDone:        { paddingHorizontal: 4, paddingVertical: 4 },
  modalDoneText:    { fontSize: 16, fontWeight: '700', color: colors.primary },
  modalSub:         { fontSize: 13, color: '#6B7280', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  modalList:        { paddingHorizontal: 16, paddingTop: 8, gap: 8, paddingBottom: 16 },
  modalRow:         { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: '#F9FAFB', borderWidth: 1.5, borderColor: '#F3F4F6', opacity: 0.55 },
  modalRowSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary, opacity: 1 },
  modalAvatar:         { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  modalAvatarSelected: { borderWidth: 2, borderColor: colors.primary },
  modalAvatarImg:      { width: 44, height: 44 },
  modalName:           { fontSize: 15, fontWeight: '700', color: '#111827' },
  modalNameExcluded:   { color: '#9CA3AF' },
  modalUsername:       { fontSize: 13, color: '#6B7280', marginTop: 1 },
  checkbox:        { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  modalFooter: { paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E7EB' },
  modalCount:  { fontSize: 14, fontWeight: '700', color: colors.primary, textAlign: 'center' },
});
