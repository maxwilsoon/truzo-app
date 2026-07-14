import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, TextInput, TouchableOpacity, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { StepProgress } from '../../components/StepProgress';
import { BackButton } from '../../components/BackButton';
import { useApp } from '../../context/AppContext';

const GREEN = '#C8E8CB';
const GREEN_DARK = '#3D7A45';
const BG = '#F2F2F7';

// Expand 2-digit year: "03" → 2003, "80" → 1980
const expandYear = (yy: number): number => {
  const currentYY = new Date().getFullYear() % 100;
  return yy <= currentYY ? 2000 + yy : 1900 + yy;
};

const isValidDOB = (dob: string): boolean => {
  const m4 = dob.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const m2 = dob.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m4 && !m2) return false;
  const d  = parseInt(m4 ? m4[1] : m2![1], 10);
  const mo = parseInt(m4 ? m4[2] : m2![2], 10);
  const yr = m4 ? parseInt(m4[3], 10) : expandYear(parseInt(m2![3], 10));
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const birth = new Date(yr, mo - 1, d);
  const today = new Date();
  const age =
    today.getFullYear() - birth.getFullYear() -
    (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
  return age >= 18;
};

// Auto-insert slashes as user types digits
const formatDOB = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
};

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Address'> };

export const AddressScreen: React.FC<Props> = ({ navigation }) => {
  const { setParent } = useApp();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [dob, setDob]             = useState('');
  const [focused, setFocused]     = useState<string | null>(null);

  const canContinue = firstName.trim() && lastName.trim() && isValidDOB(dob);

  const fields = [
    {
      key: 'firstName', label: 'First name', value: firstName,
      onChange: setFirstName, autoCapitalize: 'words' as const,
      keyboardType: 'default' as const,
    },
    {
      key: 'lastName', label: 'Last name', value: lastName,
      onChange: setLastName, autoCapitalize: 'words' as const,
      keyboardType: 'default' as const,
    },
    {
      key: 'dob', label: 'Date of birth', value: dob,
      onChange: (t: string) => setDob(formatDOB(t)),
      autoCapitalize: 'none' as const,
      keyboardType: 'numeric' as const,
      hint: 'DD/MM/YYYY',
      maxLength: 10,
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackButton />
      <StepProgress current={8} total={8} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Your details</Text>
          <Text style={styles.sub}>The name and date of birth as stated on your official ID.</Text>

          {fields.map((f, i) => (
            <View key={f.key}>
              <View style={[styles.inputWrap, focused === f.key && styles.inputFocused]}>
                {f.value.length > 0 && (
                  <Text style={[styles.floatLabel, focused === f.key && styles.floatLabelActive]}>
                    {f.label}
                  </Text>
                )}
                <TextInput
                  style={styles.input}
                  placeholder={f.value.length > 0 ? '' : f.label}
                  placeholderTextColor="#AEAEB2"
                  value={f.value}
                  onChangeText={f.onChange}
                  keyboardType={f.keyboardType}
                  autoCapitalize={f.autoCapitalize}
                  autoFocus={i === 0}
                  maxLength={(f as any).maxLength}
                  onFocus={() => setFocused(f.key)}
                  onBlur={() => setFocused(null)}
                  autoCorrect={false}
                />
              </View>
              {(f as any).hint && (
                <Text style={styles.hint}>{(f as any).hint}</Text>
              )}
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.btn, !canContinue && styles.btnDisabled]}
            onPress={() => {
              setParent(p => ({ ...p, firstName: firstName.trim(), lastName: lastName.trim() }));
              navigation.navigate('Verifying');
            }}
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
  safe:   { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },

  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', marginBottom: 8 },
  sub:   { fontSize: 16, color: '#3C3C43', lineHeight: 23, marginBottom: 32 },

  inputWrap: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#D1D1D6',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    marginBottom: 4,
    minHeight: 62,
    justifyContent: 'center',
  },
  inputFocused: { borderColor: GREEN },

  floatLabel:       { fontSize: 12, fontWeight: '600', color: '#8E8E93', marginBottom: 2 },
  floatLabelActive: { color: GREEN_DARK },

  input: { fontSize: 17, color: '#1C1C1E', padding: 0 },

  hint: { fontSize: 13, color: '#8E8E93', marginLeft: 4, marginBottom: 18 },

  footer: { paddingHorizontal: 24, paddingBottom: 12, paddingTop: 8, backgroundColor: BG },
  btn: {
    backgroundColor: GREEN,
    borderRadius: 50,
    paddingVertical: 18,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText:     { color: '#1F2937', fontSize: 17, fontWeight: '700' },
});
