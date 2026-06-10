import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform,
  TouchableWithoutFeedback, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp, PaymentMethod, CardNetwork } from '../../context/AppContext';

const PURPLE = '#4F35F3';

const detectNetwork = (num: string): CardNetwork => {
  const n = num.replace(/\s/g, '');
  if (n.startsWith('4')) return 'visa';
  if (n.startsWith('5') || n.startsWith('2')) return 'mastercard';
  if (n.startsWith('3')) return 'amex';
  return 'other';
};

const formatCardNumber = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(.{4})/g, '$1 ').trim();
};

const formatExpiry = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length >= 3) return digits.slice(0, 2) + '/' + digits.slice(2);
  return digits;
};

const formatSortCode = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  if (digits.length >= 5) return digits.slice(0, 2) + '-' + digits.slice(2, 4) + '-' + digits.slice(4);
  if (digits.length >= 3) return digits.slice(0, 2) + '-' + digits.slice(2);
  return digits;
};

const networkLabel: Record<CardNetwork, string> = {
  visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', other: 'Card',
};

const cardBg: Record<CardNetwork, string> = {
  visa: '#1A1F6E',
  mastercard: '#3B1F6E',
  amex: '#1F5E3B',
  other: '#374151',
};

export const PaymentMethodsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { paymentMethods, addPaymentMethod, removePaymentMethod, setDefaultPaymentMethod } = useApp();
  const [sheet, setSheet] = useState<'card' | 'bank' | null>(null);

  // Card form state
  const [cardNum, setCardNum] = useState('');
  const [cardName, setCardName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [showCvv, setShowCvv] = useState(false);

  // Bank form state
  const [bankName, setBankName] = useState('');
  const [sortCode, setSortCode] = useState('');
  const [accNum, setAccNum] = useState('');

  const cards = paymentMethods.filter(m => m.type === 'card');
  const banks = paymentMethods.filter(m => m.type === 'bank');

  const resetCardForm = () => {
    setCardNum(''); setCardName(''); setExpiry(''); setCvv(''); setShowCvv(false);
  };
  const resetBankForm = () => {
    setBankName(''); setSortCode(''); setAccNum('');
  };

  const openSheet = (type: 'card' | 'bank') => {
    if (type === 'card') resetCardForm();
    else resetBankForm();
    setSheet(type);
  };

  const closeSheet = () => setSheet(null);

  const handleAddCard = () => {
    const digits = cardNum.replace(/\s/g, '');
    const network = detectNetwork(digits);
    const parts = expiry.split('/');
    const month = parseInt(parts[0], 10);
    if (month < 1 || month > 12) {
      Alert.alert('Invalid expiry', 'Please enter a valid month (01–12).');
      return;
    }
    const m: PaymentMethod = {
      id: `card_${Date.now()}`,
      type: 'card',
      label: networkLabel[network],
      last4: digits.slice(-4),
      expiry,
      network,
      isDefault: paymentMethods.length === 0,
    };
    addPaymentMethod(m);
    closeSheet();
  };

  const handleAddBank = () => {
    const m: PaymentMethod = {
      id: `bank_${Date.now()}`,
      type: 'bank',
      label: bankName.trim(),
      last4: accNum.replace(/\D/g, '').slice(-4),
      sortCode,
      isDefault: paymentMethods.length === 0,
    };
    addPaymentMethod(m);
    closeSheet();
  };

  const confirmRemove = (method: PaymentMethod) => {
    Alert.alert(
      'Remove payment method',
      `Remove ${method.label} ending ${method.last4}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removePaymentMethod(method.id) },
      ]
    );
  };

  const cardDigits = cardNum.replace(/\s/g, '');
  const cardNetwork = detectNetwork(cardDigits);
  const canSaveCard = cardDigits.length >= 15 && cardName.trim().length > 0 && expiry.length === 5 && cvv.length >= 3;
  const sortDigits = sortCode.replace(/\D/g, '');
  const canSaveBank = bankName.trim().length > 0 && sortDigits.length === 6 && accNum.replace(/\D/g, '').length === 8;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color="#1A1A3E" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payment methods</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle-outline" size={20} color={PURPLE} />
          <Text style={styles.infoText}>
            Your linked card or bank account will be charged automatically for allowances, money transfers, and safety pool top-ups.
          </Text>
        </View>

        {cards.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Cards</Text>
            {cards.map(m => (
              <View key={m.id} style={styles.cardTileWrap}>
                <View style={[styles.cardTile, { backgroundColor: cardBg[m.network ?? 'other'] }]}>
                  <View style={styles.cardTileTop}>
                    <Text style={styles.cardTileNetwork}>{networkLabel[m.network ?? 'other']}</Text>
                    {m.isDefault && (
                      <View style={styles.defaultBadge}>
                        <Text style={styles.defaultBadgeText}>Default</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.cardChipRow}>
                    <View style={styles.cardChip} />
                  </View>
                  <View style={styles.cardTileBottom}>
                    <Text style={styles.cardNumber}>•••• •••• •••• {m.last4}</Text>
                    <Text style={styles.cardExpiry}>Expires {m.expiry}</Text>
                  </View>
                </View>
                <View style={styles.cardTileActions}>
                  {!m.isDefault && (
                    <TouchableOpacity style={styles.cardAction} onPress={() => setDefaultPaymentMethod(m.id)}>
                      <Ionicons name="star-outline" size={16} color={PURPLE} />
                      <Text style={[styles.cardActionText, { color: PURPLE }]}>Set default</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.cardAction} onPress={() => confirmRemove(m)}>
                    <Ionicons name="trash-outline" size={16} color="#EF4444" />
                    <Text style={[styles.cardActionText, { color: '#EF4444' }]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        )}

        {banks.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Bank accounts</Text>
            {banks.map(m => (
              <View key={m.id} style={styles.bankTile}>
                <View style={styles.bankIcon}>
                  <Ionicons name="business-outline" size={22} color={PURPLE} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bankName}>{m.label}</Text>
                  <Text style={styles.bankSub}>
                    Account •••• {m.last4}{m.sortCode ? ` · Sort code ${m.sortCode}` : ''}
                  </Text>
                </View>
                {m.isDefault && (
                  <View style={styles.defaultBadge}>
                    <Text style={styles.defaultBadgeText}>Default</Text>
                  </View>
                )}
                <TouchableOpacity
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() =>
                    Alert.alert('Remove bank account', `Remove ${m.label}?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => removePaymentMethod(m.id) },
                    ])
                  }
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {paymentMethods.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="card-outline" size={36} color={PURPLE} />
            </View>
            <Text style={styles.emptyTitle}>No payment methods yet</Text>
            <Text style={styles.emptySub}>
              Add a card or bank account to start sending money and setting allowances.
            </Text>
          </View>
        )}

        <TouchableOpacity style={styles.addBtn} onPress={() => openSheet('card')} activeOpacity={0.85}>
          <View style={styles.addBtnIcon}>
            <Ionicons name="card-outline" size={20} color={PURPLE} />
          </View>
          <Text style={styles.addBtnText}>Add debit or credit card</Text>
          <Ionicons name="chevron-forward" size={18} color="#C4B5F4" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.addBtn} onPress={() => openSheet('bank')} activeOpacity={0.85}>
          <View style={styles.addBtnIcon}>
            <Ionicons name="business-outline" size={20} color={PURPLE} />
          </View>
          <Text style={styles.addBtnText}>Link bank account</Text>
          <Ionicons name="chevron-forward" size={18} color="#C4B5F4" />
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={sheet !== null}
        transparent
        animationType="slide"
        onRequestClose={closeSheet}
      >
        <View style={styles.sheetOverlay}>
          <TouchableWithoutFeedback onPress={closeSheet}>
            <View style={{ flex: 1 }} />
          </TouchableWithoutFeedback>

          {sheet === 'card' && (
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <View style={styles.sheet}>
                <View style={styles.handle} />
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle}>Add debit or credit card</Text>
                  <TouchableOpacity onPress={closeSheet} style={styles.closeBtn}>
                    <Ionicons name="close" size={20} color="#636366" />
                  </TouchableOpacity>
                </View>

                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>Card number</Text>
                  <View style={styles.fieldRow}>
                    <TextInput
                      style={[styles.fieldInput, { flex: 1 }]}
                      value={cardNum}
                      onChangeText={t => setCardNum(formatCardNumber(t))}
                      keyboardType="number-pad"
                      placeholder="1234 5678 9012 3456"
                      placeholderTextColor="#C4B5F4"
                      autoFocus
                    />
                    {cardNetwork !== 'other' && (
                      <View style={styles.networkTagWrap}>
                        <Text style={styles.networkTagText}>{networkLabel[cardNetwork]}</Text>
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>Name on card</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={cardName}
                    onChangeText={setCardName}
                    placeholder="J. SMITH"
                    placeholderTextColor="#C4B5F4"
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </View>

                <View style={styles.fieldRow}>
                  <View style={[styles.fieldWrap, { flex: 1 }]}>
                    <Text style={styles.fieldLabel}>Expiry</Text>
                    <TextInput
                      style={styles.fieldInput}
                      value={expiry}
                      onChangeText={t => {
                        const isDeleting = t.length < expiry.length;
                        const d = t.replace(/\D/g, '').slice(0, 4);
                        setExpiry(isDeleting && t.endsWith('/') ? t.slice(0, -1) : formatExpiry(d));
                      }}
                      keyboardType="number-pad"
                      placeholder="MM/YY"
                      placeholderTextColor="#C4B5F4"
                    />
                  </View>
                  <View style={[styles.fieldWrap, { flex: 1 }]}>
                    <Text style={styles.fieldLabel}>CVV</Text>
                    <View style={styles.cvvRow}>
                      <TextInput
                        style={[styles.fieldInput, { flex: 1 }]}
                        value={cvv}
                        onChangeText={t => setCvv(t.replace(/\D/g, '').slice(0, 4))}
                        keyboardType="number-pad"
                        placeholder="•••"
                        placeholderTextColor="#C4B5F4"
                        secureTextEntry={!showCvv}
                      />
                      <TouchableOpacity onPress={() => setShowCvv(v => !v)} style={{ padding: 4 }}>
                        <Ionicons name={showCvv ? 'eye-off-outline' : 'eye-outline'} size={18} color="#9CA3AF" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.saveBtn, !canSaveCard && styles.saveBtnDisabled]}
                  onPress={handleAddCard}
                  disabled={!canSaveCard}
                  activeOpacity={0.85}
                >
                  <Text style={styles.saveBtnText}>Add card</Text>
                </TouchableOpacity>

                <View style={styles.secureNote}>
                  <Ionicons name="lock-closed" size={13} color="#9CA3AF" />
                  <Text style={styles.secureNoteText}>Your card details are encrypted and stored securely.</Text>
                </View>
              </View>
            </KeyboardAvoidingView>
          )}

          {sheet === 'bank' && (
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <View style={styles.sheet}>
                <View style={styles.handle} />
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle}>Link bank account</Text>
                  <TouchableOpacity onPress={closeSheet} style={styles.closeBtn}>
                    <Ionicons name="close" size={20} color="#636366" />
                  </TouchableOpacity>
                </View>

                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>Bank name</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={bankName}
                    onChangeText={setBankName}
                    placeholder="e.g. Barclays"
                    placeholderTextColor="#C4B5F4"
                    autoCapitalize="words"
                    autoFocus
                  />
                </View>

                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>Sort code</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={sortCode}
                    onChangeText={t => {
                      const isDeleting = t.length < sortCode.length;
                      const d = t.replace(/\D/g, '').slice(0, 6);
                      setSortCode(isDeleting && t.endsWith('-') ? t.slice(0, -1) : formatSortCode(d));
                    }}
                    keyboardType="number-pad"
                    placeholder="XX-XX-XX"
                    placeholderTextColor="#C4B5F4"
                  />
                </View>

                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>Account number</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={accNum}
                    onChangeText={t => setAccNum(t.replace(/\D/g, '').slice(0, 8))}
                    keyboardType="number-pad"
                    placeholder="12345678"
                    placeholderTextColor="#C4B5F4"
                  />
                </View>

                <TouchableOpacity
                  style={[styles.saveBtn, !canSaveBank && styles.saveBtnDisabled]}
                  onPress={handleAddBank}
                  disabled={!canSaveBank}
                  activeOpacity={0.85}
                >
                  <Text style={styles.saveBtnText}>Link account</Text>
                </TouchableOpacity>

                <View style={styles.secureNote}>
                  <Ionicons name="lock-closed" size={13} color="#9CA3AF" />
                  <Text style={styles.secureNoteText}>Bank details are encrypted and stored securely.</Text>
                </View>
              </View>
            </KeyboardAvoidingView>
          )}
        </View>
      </Modal>
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

  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#EDE8FF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  infoText: { flex: 1, fontSize: 14, color: '#1A1A3E', lineHeight: 20, marginLeft: 10 },

  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#636366',
    letterSpacing: 0.4,
    paddingHorizontal: 4,
    marginBottom: 8,
    marginTop: 4,
  },

  cardTileWrap: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#fff', marginBottom: 12 },
  cardTile: { padding: 20, height: 160 },
  cardTileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTileNetwork: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  defaultBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  defaultBadgeText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  cardChipRow: { flex: 1, justifyContent: 'flex-end', paddingBottom: 12 },
  cardChip: {
    width: 36,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#F59E0B',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  cardTileBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  cardNumber: { fontSize: 15, letterSpacing: 2, color: 'rgba(255,255,255,0.9)', fontWeight: '500' },
  cardExpiry: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  cardTileActions: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardAction: { flexDirection: 'row', alignItems: 'center', marginRight: 20 },
  cardActionText: { fontSize: 14, fontWeight: '600', marginLeft: 6 },

  bankTile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
  },
  bankIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#EDE8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  bankName: { fontSize: 15, fontWeight: '700', color: '#1A1A3E' },
  bankSub: { fontSize: 13, color: '#636366', marginTop: 2 },

  emptyState: { alignItems: 'center', paddingVertical: 32, marginBottom: 14 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#EDE8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#1A1A3E', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#636366', textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#EDE8FF',
    marginBottom: 10,
  },
  addBtnIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#EDE8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  addBtnText: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1A1A3E' },

  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 36,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D1D6',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  sheetTitle: { flex: 1, fontSize: 20, fontWeight: '800', color: '#1A1A3E' },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },

  fieldWrap: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#636366', marginBottom: 8 },
  fieldInput: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A3E',
  },
  fieldRow: { flexDirection: 'row' },
  networkTagWrap: {
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#EDE8FF',
    borderRadius: 8,
    marginLeft: 8,
  },
  networkTagText: { fontSize: 13, fontWeight: '700', color: PURPLE },
  cvvRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingRight: 12,
  },

  saveBtn: {
    backgroundColor: PURPLE,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },

  secureNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  secureNoteText: { fontSize: 13, color: '#9CA3AF', lineHeight: 18, marginLeft: 6 },
});
