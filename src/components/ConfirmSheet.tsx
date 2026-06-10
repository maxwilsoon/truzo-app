import React, { useEffect, useRef } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  Animated, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

interface Props {
  visible: boolean;
  emoji: string;
  title: string;
  subtitle: string;
  amount: number;
  balanceAfter: number;
  confirmLabel: string;
  confirmColor?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_H = 360;

export const ConfirmSheet: React.FC<Props> = ({
  visible, emoji, title, subtitle, amount, balanceAfter,
  confirmLabel, confirmColor = colors.primary, onConfirm, onCancel,
}) => {
  const slideY = useRef(new Animated.Value(SHEET_H)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
      }).start();
    } else {
      Animated.timing(slideY, {
        toValue: SHEET_H,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onCancel} />

      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideY }] }]}>
        <View style={styles.handle} />

        {/* Icon */}
        <View style={[styles.iconCircle, { backgroundColor: `${confirmColor}18` }]}>
          <Text style={styles.iconEmoji}>{emoji}</Text>
        </View>

        {/* Title */}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {/* Amount row */}
        <View style={styles.amountRow}>
          <Text style={styles.amountLabel}>Amount</Text>
          <Text style={[styles.amountValue, { color: confirmColor }]}>£{amount.toFixed(2)}</Text>
        </View>

        {/* Balance after */}
        <View style={[styles.amountRow, { borderTopWidth: 0, paddingTop: 4 }]}>
          <Text style={styles.amountLabel}>Wallet after</Text>
          <Text style={[styles.amountValue, { color: balanceAfter < 0 ? colors.error : colors.text, fontSize: 15 }]}>
            £{balanceAfter.toFixed(2)}
          </Text>
        </View>

        {/* Confirm */}
        <TouchableOpacity
          style={[styles.confirmBtn, { backgroundColor: confirmColor }]}
          onPress={onConfirm}
          activeOpacity={0.85}
        >
          <Text style={styles.confirmBtnText}>{confirmLabel}</Text>
        </TouchableOpacity>

        {/* Cancel */}
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: SHEET_H,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: 'center',
  },
  handle: {
    width: 38, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center', marginTop: 10, marginBottom: 20,
  },
  iconCircle: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 20, fontWeight: '800', color: colors.text,
    textAlign: 'center', marginBottom: 4,
  },
  subtitle: {
    fontSize: 14, color: colors.textSecondary,
    textAlign: 'center', marginBottom: 20,
  },
  amountRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    width: '100%', paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: colors.surface,
  },
  amountLabel: { fontSize: 14, color: colors.textSecondary },
  amountValue: { fontSize: 18, fontWeight: '800' },
  confirmBtn: {
    width: '100%', borderRadius: 16,
    paddingVertical: 16, alignItems: 'center',
    marginTop: 20,
  },
  confirmBtnText: { fontSize: 16, fontWeight: '800', color: colors.white },
  cancelBtn: { paddingVertical: 12 },
  cancelText: { fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
  iconEmoji: { fontSize: 32 },
});
