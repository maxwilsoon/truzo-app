import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { StepProgress } from '../../components/StepProgress';
import { BackButton } from '../../components/BackButton';
import { useApp } from '../../context/AppContext';
import { db } from '../../lib/database';

const GREEN = '#C8E8CB';
const GREEN_DARK = '#3D7A45';
const BG = '#F2F2F7';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Email'> };

export const EmailScreen: React.FC<Props> = ({ navigation }) => {
  const { setParent } = useApp();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showLoginLink, setShowLoginLink] = useState(false);

  const validate = () => {
    if (!email.includes('@') || !email.includes('.')) {
      setError('Please enter a valid email address.');
      return false;
    }
    setError('');
    return true;
  };

  const handleContinue = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const exists = await db.checkEmailExists(email.trim());
      if (exists) {
        setError('Email already in use. Would you like to log in?');
        setShowLoginLink(true);
        return;
      }
    } catch {
      // If check fails, allow continuation
    } finally {
      setLoading(false);
    }
    setParent(p => ({ ...p, email: email.trim() }));
    navigation.navigate('Password');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackButton />
      <StepProgress current={1} total={8} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Title */}
          <Text style={styles.title}>Email address</Text>
          <Text style={styles.sub}>Add parent or guardian email.</Text>

          {/* Input */}
          <View style={[styles.inputWrap, error ? styles.inputError : null]}>
            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor="#AEAEB2"
              value={email}
              onChangeText={t => { setEmail(t); if (error) setError(''); }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
          </View>
          {!!error && <Text style={styles.errorText}>{error}</Text>}
          {showLoginLink && (
            <TouchableOpacity onPress={() => navigation.navigate('ParentEmailLogin')}>
              <Text style={styles.loginLink}>Log in instead</Text>
            </TouchableOpacity>
          )}

          {/* Trust text */}
          <Text style={styles.legalText}>
            Truzo is a peer-to-peer lending platform for young people, supervised and backed by parents.
          </Text>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.consent}>
            By pressing "Continue", you agree to the Truzo{' '}
            <Text style={styles.link}>terms and conditions</Text>
            {', '}
            <Text style={styles.link}>cardholder agreement</Text>
            {', and '}
            <Text style={styles.link}>privacy policy</Text>
            {'.'}
          </Text>
          <TouchableOpacity
            style={[styles.btn, (!email || loading) && styles.btnDisabled]}
            onPress={handleContinue}
            disabled={!email || loading}
            activeOpacity={0.85}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Continue</Text>}
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
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#D1D1D6',
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginBottom: 6,
  },
  inputError: { borderColor: '#FF3B30' },
  input: { fontSize: 17, color: '#1C1C1E' },
  errorText: { color: '#FF3B30', fontSize: 13, marginBottom: 8, marginLeft: 4 },
  loginLink: { color: GREEN_DARK, fontSize: 14, fontWeight: '600', marginBottom: 12, marginLeft: 4 },

  legalText: { fontSize: 13, color: '#8E8E93', lineHeight: 19, marginTop: 8 },

  footer: {
    paddingHorizontal: 24,
    paddingBottom: 12,
    paddingTop: 8,
    gap: 14,
    backgroundColor: BG,
  },
  consent: { fontSize: 13, color: '#8E8E93', textAlign: 'center', lineHeight: 19 },
  link:    { color: GREEN_DARK, fontWeight: '600' },

  btn: {
    backgroundColor: GREEN,
    borderRadius: 50,
    paddingVertical: 18,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: '#1F2937', fontSize: 17, fontWeight: '700' },
});
