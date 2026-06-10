import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  TextInput, TouchableOpacity, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { StepProgress } from '../../components/StepProgress';
import { BackButton } from '../../components/BackButton';
import { useApp } from '../../context/AppContext';

const PURPLE = '#4F35F3';
const BG = '#F2F2F7';

const rules = [
  { label: 'At least 8 characters',  test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter',   test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter',   test: (p: string) => /[a-z]/.test(p) },
  { label: 'One number',             test: (p: string) => /\d/.test(p) },
];

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Password'> };

export const PasswordScreen: React.FC<Props> = ({ navigation }) => {
  const { setParent } = useApp();
  const [password, setPassword]       = useState('');
  const [confirm, setConfirm]         = useState('');
  const [showPass, setShowPass]       = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  const allValid   = rules.every(r => r.test(password));
  const canContinue = allValid && confirm.length > 0;

  const proceed = () => {
    if (password !== confirm) { setConfirmError("Passwords don't match."); return; }
    setConfirmError('');
    setParent(p => ({ ...p, password }));
    navigation.navigate('Mobile');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackButton />
      <StepProgress current={2} total={8} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <Text style={styles.title}>Create a password</Text>
          <Text style={styles.sub}>For secure log in to your parent account.</Text>

          {/* Password field */}
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              placeholder="Create a password"
              placeholderTextColor="#AEAEB2"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <TouchableOpacity onPress={() => setShowPass(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={22} color="#AEAEB2" />
            </TouchableOpacity>
          </View>

          {/* Confirm field */}
          <View style={[styles.inputWrap, !!confirmError && styles.inputError]}>
            <TextInput
              style={styles.input}
              placeholder="Confirm password"
              placeholderTextColor="#AEAEB2"
              value={confirm}
              onChangeText={t => { setConfirm(t); if (confirmError) setConfirmError(''); }}
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={() => setShowConfirm(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={22} color="#AEAEB2" />
            </TouchableOpacity>
          </View>
          {!!confirmError && <Text style={styles.errorText}>{confirmError}</Text>}

          {/* Password rules — appear once user starts typing */}
          {password.length > 0 && (
            <View style={styles.rules}>
              {rules.map(r => (
                <View key={r.label} style={styles.rule}>
                  <Ionicons
                    name={r.test(password) ? 'checkmark-circle' : 'ellipse-outline'}
                    size={16}
                    color={r.test(password) ? '#059669' : '#AEAEB2'}
                  />
                  <Text style={[styles.ruleText, r.test(password) && styles.rulePass]}>
                    {r.label}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

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
  safe:   { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },

  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', marginBottom: 6 },
  sub:   { fontSize: 16, color: '#3C3C43', marginBottom: 28, lineHeight: 22 },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#D1D1D6',
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginBottom: 14,
  },
  inputError: { borderColor: '#FF3B30' },
  input:      { flex: 1, fontSize: 17, color: '#1C1C1E' },
  errorText:  { color: '#FF3B30', fontSize: 13, marginTop: -8, marginBottom: 12, marginLeft: 4 },

  rules: { gap: 8, marginTop: 4 },
  rule:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleText: { fontSize: 13, color: '#AEAEB2' },
  rulePass: { color: '#059669', fontWeight: '600' },

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
