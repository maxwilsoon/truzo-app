import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  Animated, ActivityIndicator, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  visible: boolean;
  amount: number;
  description: string;
  onSuccess: () => void;
  onCancel: () => void;
}

type Stage = 'idle' | 'processing' | 'success';

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_H = 340;

export const PaymentSheet: React.FC<Props> = ({
  visible, amount, description, onSuccess, onCancel,
}) => {
  const [stage, setStage] = useState<Stage>('idle');
  const slideY = useRef(new Animated.Value(SHEET_H)).current;

  useEffect(() => {
    if (visible) {
      setStage('idle');
      Animated.spring(slideY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 200,
      }).start();
    } else {
      Animated.timing(slideY, {
        toValue: SHEET_H,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const handlePay = () => {
    setStage('processing');
    setTimeout(() => {
      setStage('success');
      setTimeout(() => {
        onSuccess();
      }, 900);
    }, 1600);
  };

  const handleCancel = () => {
    if (stage === 'idle') onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleCancel}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={handleCancel}
      />

      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideY }] }]}>
        {/* Handle */}
        <View style={styles.handle} />

        {stage === 'success' ? (
          <View style={styles.successContainer}>
            <View style={styles.successCircle}>
              <Ionicons name="checkmark" size={40} color="#fff" />
            </View>
            <Text style={styles.successText}>Payment Authorised</Text>
            <Text style={styles.successSub}>£{amount.toFixed(2)} · {description}</Text>
          </View>
        ) : stage === 'processing' ? (
          <View style={styles.successContainer}>
            <ActivityIndicator size="large" color="#fff" style={{ marginBottom: 20 }} />
            <Text style={styles.successText}>Authorising…</Text>
            <Text style={styles.successSub}>Please wait</Text>
          </View>
        ) : (
          <>
            {/* Merchant info */}
            <View style={styles.merchantRow}>
              <View style={styles.merchantIcon}>
                <Text style={{ fontSize: 18 }}>💜</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.merchantName}>Truzo</Text>
                <Text style={styles.merchantSecure}>truzo.app · Secure payment</Text>
              </View>
              <Ionicons name="lock-closed" size={14} color="#8E8E93" />
            </View>

            {/* Amount */}
            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>{description}</Text>
              <Text style={styles.amountValue}>£{amount.toFixed(2)}</Text>
            </View>

            {/* Divider */}
            <View style={styles.divider} />

            {/* Pay button */}
            <TouchableOpacity style={styles.payBtn} onPress={handlePay} activeOpacity={0.85}>
              <Ionicons name="logo-apple" size={22} color="#000" />
              <Text style={styles.payBtnText}>Pay with Apple Pay</Text>
            </TouchableOpacity>

            {/* Cancel */}
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.7}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_H,
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  handle: {
    width: 38, height: 4, borderRadius: 2,
    backgroundColor: '#48484A',
    alignSelf: 'center', marginTop: 10, marginBottom: 24,
  },

  merchantRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20,
  },
  merchantIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#2C2C2E',
    alignItems: 'center', justifyContent: 'center',
  },
  merchantName: { fontSize: 16, fontWeight: '700', color: '#fff' },
  merchantSecure: { fontSize: 12, color: '#8E8E93', marginTop: 2 },

  amountRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 20,
  },
  amountLabel: { fontSize: 15, color: '#EBEBF5', opacity: 0.7 },
  amountValue: { fontSize: 28, fontWeight: '800', color: '#fff' },

  divider: { height: 1, backgroundColor: '#38383A', marginBottom: 24 },

  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#fff',
    borderRadius: 14, paddingVertical: 16, marginBottom: 12,
  },
  payBtnText: { fontSize: 17, fontWeight: '700', color: '#000' },

  cancelBtn: {
    alignItems: 'center', paddingVertical: 10,
  },
  cancelText: { fontSize: 16, color: '#8E8E93', fontWeight: '500' },

  successContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  successCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#30D158',
    alignItems: 'center', justifyContent: 'center',
  },
  successText: { fontSize: 20, fontWeight: '800', color: '#fff' },
  successSub: { fontSize: 14, color: '#8E8E93' },
});
