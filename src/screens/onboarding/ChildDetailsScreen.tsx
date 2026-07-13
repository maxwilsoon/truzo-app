import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { StepProgress } from '../../components/StepProgress';
import { BackButton } from '../../components/BackButton';
import { useApp } from '../../context/AppContext';

const GREEN = '#C8E8CB';
const GREEN_DARK = '#3D7A45';
const BG = '#F2F2F7';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'ChildDetails'> };

const expandYear = (yy: number): number => {
  const currentYY = new Date().getFullYear() % 100;
  return yy <= currentYY ? 2000 + yy : 1900 + yy;
};

export const ChildDetailsScreen: React.FC<Props> = ({ navigation }) => {
  const { setChild, parent, saveOnboardingToDb } = useApp();

  const [firstName, setFirstName] = useState('');
  const [dob, setDob]             = useState('');
  const [username, setUsername]   = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [phone, setPhone]         = useState('');
  const [loading, setLoading]     = useState(false);

  const [focused, setFocused]     = useState<string | null>(null);
  const [showPass, setShowPass]   = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [dobError, setDobError]   = useState('');
  const [passError, setPassError] = useState('');

  const passwordsMatch = password.length >= 8 && confirm === password;
  const canContinue =
    firstName.trim().length > 0 &&
    dob.replace(/\D/g, '').length >= 6 &&
    username.trim().length > 0 &&
    passwordsMatch &&
    phone.trim().length >= 7 &&
    !loading;

  const handleDob = (text: string) => {
    const prev = dob;
    const isDeleting = text.length < prev.length;
    let digits = text.replace(/\D/g, '').slice(0, 8);
    let formatted = digits;
    if (digits.length >= 3) formatted = digits.slice(0, 2) + '/' + digits.slice(2);
    if (digits.length >= 5) formatted = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
    setDob(isDeleting && text.endsWith('/') ? text.slice(0, -1) : formatted);
    setDobError('');
  };

  const handleContinue = async () => {
    const parts = dob.split('/');
    const digits = dob.replace(/\D/g, '');
    if (parts.length !== 3 || digits.length < 6) {
      setDobError('Please enter a valid date (DD/MM/YYYY).');
      return;
    }
    const [d, m, y] = parts.map(Number);
    const fullYear = y < 100 ? expandYear(y) : y;
    const birthDate = new Date(fullYear, m - 1, d);
    if (isNaN(birthDate.getTime()) || birthDate.getMonth() !== m - 1) {
      setDobError('Please enter a valid date.');
      return;
    }
    if (password !== confirm) {
      setPassError('Passwords do not match.');
      return;
    }
    setPassError('');

    const now = new Date();
    const age = now.getFullYear() - fullYear -
      (now.getMonth() < m - 1 || (now.getMonth() === m - 1 && now.getDate() < d) ? 1 : 0);

    const childDisplayName = `${firstName.trim()} ${parent.lastName}`.trim();
    const childUsername    = username.trim();
    const childMobile      = phone.trim();

    setChild(c => ({
      ...c,
      displayName:   childDisplayName,
      username:      childUsername,
      password,
      mobile:        childMobile,
      age,
      // Reset all stats so a new account always starts clean
      balance: 0, loanedOut: 0, borrowed: 0,
      streak: 0, repaid: 0, missed: 0,
      totalBorrowed: 0, totalLent: 0,
      timesBorrowed: 0, timesLent: 0,
      points: 0, trustScore: 50,
    }));

    setLoading(true);
    try {
      await saveOnboardingToDb({ displayName: childDisplayName, username: childUsername, password, mobile: childMobile, age });
    } catch (err) {
      console.warn('[Truzo] onboarding save failed:', err);
    } finally {
      setLoading(false);
    }

    navigation.navigate('WhoIsLoggingIn', { newAccount: true });
  };

  const field = (
    key: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts?: {
      placeholder?: string;
      keyboardType?: 'default' | 'phone-pad' | 'numbers-and-punctuation';
      autoCapitalize?: 'none' | 'words';
      autoFocus?: boolean;
      isPassword?: boolean;
      showToggle?: boolean;
      onToggle?: () => void;
      hint?: string;
      error?: string;
    }
  ) => {
    const isFocused = focused === key;
    const hasValue = value.length > 0;
    const isPass = opts?.isPassword;
    return (
      <View key={key}>
        <View style={[styles.inputWrap, isFocused && styles.inputFocused, !!opts?.error && styles.inputError]}>
          <View style={{ flex: 1 }}>
            {(isFocused || hasValue) && (
              <Text style={[styles.floatLabel, isFocused && styles.floatLabelActive]}>{label}</Text>
            )}
            <TextInput
              style={[styles.input, opts?.showToggle && { paddingRight: 8 }]}
              placeholder={isFocused || hasValue ? '' : label}
              placeholderTextColor="#AEAEB2"
              value={value}
              onChangeText={onChange}
              autoCapitalize={opts?.autoCapitalize ?? 'none'}
              autoCorrect={false}
              autoFocus={opts?.autoFocus}
              keyboardType={opts?.keyboardType ?? 'default'}
              secureTextEntry={isPass && !opts?.showToggle}
              onFocus={() => setFocused(key)}
              onBlur={() => setFocused(null)}
              returnKeyType="next"
            />
          </View>
          {isPass && (
            <TouchableOpacity onPress={opts?.onToggle} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons
                name={opts?.showToggle ? 'eye-off-outline' : 'eye-outline'}
                size={22}
                color="#AEAEB2"
              />
            </TouchableOpacity>
          )}
        </View>
        {opts?.error ? (
          <Text style={styles.errorText}>{opts.error}</Text>
        ) : opts?.hint ? (
          <Text style={styles.hintText}>{opts.hint}</Text>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackButton />
      <StepProgress current={9} total={9} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Your child's details</Text>
          <Text style={styles.sub}>
            They'll use their username and password to log in to the app.
          </Text>

          {field('firstName', "Child's first name", firstName, setFirstName, { autoFocus: true, autoCapitalize: 'words' })}
          <View style={styles.gap} />
          {field('dob', 'Date of birth (DD/MM/YYYY)', dob, handleDob, {
            keyboardType: 'numbers-and-punctuation',
            error: dobError,
          })}
          <View style={styles.gap} />
          {field('username', 'Username', username,
            t => setUsername(t.toLowerCase().replace(/\s/g, '_'))
          )}
          <View style={styles.gap} />
          {field('password', 'Password', password, t => { setPassword(t); setPassError(''); }, {
            isPassword: true,
            showToggle: showPass,
            onToggle: () => setShowPass(v => !v),
          })}
          <View style={styles.gap} />
          {field('confirm', 'Confirm password', confirm, t => { setConfirm(t); setPassError(''); }, {
            isPassword: true,
            showToggle: showConfirm,
            onToggle: () => setShowConfirm(v => !v),
            error: passError,
          })}
          <View style={styles.gap} />
          {field('phone', "Child's phone number", phone, setPhone, {
            keyboardType: 'phone-pad',
          })}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.btn, !canContinue && styles.btnDisabled]}
            onPress={handleContinue}
            disabled={!canContinue}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Continue</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },
  gap:    { height: 14 },

  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', marginBottom: 8 },
  sub:   { fontSize: 16, color: '#3C3C43', lineHeight: 23, marginBottom: 32 },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#D1D1D6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 62,
  },
  inputFocused: { borderColor: GREEN },
  inputError:   { borderColor: '#FF3B30' },

  floatLabel:       { fontSize: 12, fontWeight: '600', color: '#8E8E93', marginBottom: 2 },
  floatLabelActive: { color: GREEN_DARK },

  input: { fontSize: 17, color: '#1C1C1E', padding: 0, flex: 1 },

  hintText:  { fontSize: 13, color: '#8E8E93', marginTop: 5 },
  errorText: { fontSize: 13, color: '#FF3B30', marginTop: 5 },

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
