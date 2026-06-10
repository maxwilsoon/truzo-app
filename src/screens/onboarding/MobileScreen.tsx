import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  TextInput, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { StepProgress } from '../../components/StepProgress';
import { BackButton } from '../../components/BackButton';
import { useApp } from '../../context/AppContext';

const PURPLE = '#4F35F3';
const BG = '#F2F2F7';

// UK mobile: starts with 07, total 11 digits (ignoring spaces/dashes)
const isValidUK = (num: string) => {
  const digits = num.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('07');
};

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Mobile'> };

export const MobileScreen: React.FC<Props> = ({ navigation }) => {
  const { setParent } = useApp();
  const [mobile, setMobile] = useState('');
  const [error, setError]   = useState('');
  const [focused, setFocused] = useState(false);

  const handleChange = (text: string) => {
    // Only allow digits and spaces
    const cleaned = text.replace(/[^\d\s]/g, '');
    setMobile(cleaned);
    if (error) setError('');
  };

  const proceed = () => {
    if (!isValidUK(mobile)) {
      setError('Enter a valid 11-digit UK mobile number starting with 07.');
      return;
    }
    setError('');
    setParent(p => ({ ...p, mobile: mobile.trim() }));
    navigation.navigate('Notifications');
  };

  const canContinue = isValidUK(mobile);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackButton />
      <StepProgress current={3} total={8} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <Text style={styles.title}>Mobile number</Text>
          <Text style={styles.sub}>
            We'll send you a verification code via SMS the first time you log in to your parent account.
          </Text>

          {/* Country code + number input row */}
          <View style={styles.row}>
            {/* Country picker (UK only) */}
            <View style={styles.countryBox}>
              <Text style={styles.flag}>🇬🇧</Text>
              <Text style={styles.dialCode}>+44</Text>
            </View>

            {/* Number input */}
            <View style={[styles.inputWrap, focused && styles.inputFocused, !!error && styles.inputError]}>
              {focused || mobile.length > 0
                ? <Text style={styles.floatLabel}>Mobile number</Text>
                : null}
              <TextInput
                style={styles.input}
                placeholder={focused ? '07700 000000' : 'Mobile number'}
                placeholderTextColor="#AEAEB2"
                value={mobile}
                onChangeText={handleChange}
                keyboardType="phone-pad"
                autoFocus
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                maxLength={13}
              />
            </View>
          </View>

          {!!error && <Text style={styles.errorText}>{error}</Text>}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.btn, !canContinue && styles.btnDisabled]}
            onPress={proceed}
            disabled={!canContinue}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: BG },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },

  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', marginBottom: 6 },
  sub:   { fontSize: 16, color: '#3C3C43', marginBottom: 28, lineHeight: 23 },

  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },

  countryBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E5E5EA',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 18,
  },
  flag:     { fontSize: 22 },
  dialCode: { fontSize: 16, fontWeight: '600', color: '#1C1C1E' },

  inputWrap: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#D1D1D6',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    minHeight: 62,
    justifyContent: 'center',
  },
  inputFocused: { borderColor: PURPLE },
  inputError:   { borderColor: '#FF3B30' },

  floatLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: PURPLE,
    marginBottom: 2,
  },
  input: { fontSize: 17, color: '#1C1C1E', padding: 0 },

  errorText: {
    color: '#FF3B30',
    fontSize: 13,
    marginTop: 8,
    marginLeft: 4,
  },

  footer: { paddingHorizontal: 24, paddingBottom: 12, paddingTop: 8, backgroundColor: BG },
  btn: {
    backgroundColor: PURPLE,
    borderRadius: 50,
    paddingVertical: 18,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText:     { color: '#fff', fontSize: 17, fontWeight: '700' },
});
