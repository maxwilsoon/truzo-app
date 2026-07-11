import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { fmtAmt } from '../lib/utils';

const PURPLE = '#4F35F3';
const PRESETS = [10, 20, 50, 100];

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** Label shown on the confirm button, e.g. "Pay" or "Save" */
  confirmLabel: string;
  /** If true, renders the button in Apple Pay style (black + logo) */
  isPayment?: boolean;
  /** Optional suffix shown after amount on confirm button, e.g. "/week" */
  amountSuffix?: string;
  onConfirm: (amount: number) => void;
  onClose: () => void;
}

export const MoneySheet: React.FC<Props> = ({
  visible, title, subtitle, confirmLabel, isPayment = true, amountSuffix = '',
  onConfirm, onClose,
}) => {
  const [raw, setRaw] = useState('');
  const amount = parseFloat(raw) || 0;
  const canConfirm = amount > 0;

  useEffect(() => {
    if (!visible) setRaw('');
  }, [visible]);

  const handleChange = (text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return;
    if (parts[1] && parts[1].length > 2) return;
    setRaw(cleaned);
  };

  const btnLabel = canConfirm
    ? `${confirmLabel} £${fmtAmt(amount)}${amountSuffix}`
    : confirmLabel;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kvWrap}
        >
          <View style={styles.sheet}>
            {/* Handle */}
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{title}</Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color="#636366" />
              </TouchableOpacity>
            </View>

            {/* Amount display */}
            <View style={styles.amountArea}>
              <Text style={[styles.currencySign, !canConfirm && styles.currencySignDim]}>£</Text>
              <TextInput
                style={[styles.amountInput, !canConfirm && styles.amountInputDim]}
                value={raw}
                onChangeText={handleChange}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="#C4B5F4"
                autoFocus
                returnKeyType="done"
                selectionColor={PURPLE}
              />
            </View>
            <View style={[styles.amountUnderline, canConfirm && styles.amountUnderlineActive]} />

            {/* Preset chips */}
            <View style={styles.presetsRow}>
              {PRESETS.map(v => {
                const active = raw === String(v);
                return (
                  <TouchableOpacity
                    key={v}
                    style={[styles.preset, active && styles.presetActive]}
                    onPress={() => setRaw(String(v))}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.presetText, active && styles.presetTextActive]}>£{v}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Confirm button */}
            {isPayment ? (
              <TouchableOpacity
                style={[styles.payBtn, !canConfirm && styles.btnDisabled]}
                onPress={() => canConfirm && onConfirm(amount)}
                disabled={!canConfirm}
                activeOpacity={0.85}
              >
                <Ionicons name="logo-apple" size={22} color={canConfirm ? '#000' : '#999'} />
                <Text style={[styles.payBtnText, !canConfirm && styles.payBtnTextDim]}>{btnLabel}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.saveBtn, !canConfirm && styles.btnDisabled]}
                onPress={() => canConfirm && onConfirm(amount)}
                disabled={!canConfirm}
                activeOpacity={0.85}
              >
                <Text style={styles.saveBtnText}>{btnLabel}</Text>
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  kvWrap: {
    // KeyboardAvoidingView needs a defined layout
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 36,
  },

  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#D1D1D6',
    alignSelf: 'center',
    marginTop: 10, marginBottom: 20,
  },

  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginBottom: 32,
  },
  title: { fontSize: 20, fontWeight: '800', color: '#1A1A3E', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#636366' },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F2F2F7',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },

  // Amount
  amountArea: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 8,
  },
  currencySign: {
    fontSize: 48, fontWeight: '300', color: PURPLE, lineHeight: 68,
  },
  currencySignDim: { color: '#C4B5F4' },
  amountInput: {
    fontSize: 72, fontWeight: '700', color: '#1A1A3E',
    minWidth: 80, textAlign: 'left',
    padding: 0,
    lineHeight: 80,
  },
  amountInputDim: { color: '#C4B5F4' },
  amountUnderline: {
    height: 3, borderRadius: 2,
    backgroundColor: '#E5E5EA',
    marginHorizontal: 8, marginBottom: 28,
  },
  amountUnderlineActive: { backgroundColor: PURPLE },

  // Presets
  presetsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 28,
  },
  preset: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  presetActive: {
    backgroundColor: '#EDE8FF',
    borderColor: PURPLE,
  },
  presetText: { fontSize: 15, fontWeight: '700', color: '#636366' },
  presetTextActive: { color: PURPLE },

  // Buttons
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    backgroundColor: '#000',
    borderRadius: 16, paddingVertical: 18,
  },
  payBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  payBtnTextDim: { color: '#ccc' },

  saveBtn: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: PURPLE,
    borderRadius: 16, paddingVertical: 18,
  },
  saveBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },

  btnDisabled: { opacity: 0.45 },
});
