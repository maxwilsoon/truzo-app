import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  TextInput, TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useApp } from '../../context/AppContext';

const PURPLE = '#4F35F3';
const BG = '#EDE8FF';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'ChildLogin'> };

export const ChildLoginScreen: React.FC<Props> = ({ navigation }) => {
  const { child } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass]  = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [userFocused, setUserFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);

  const canContinue = username.trim().length > 0 && password.length > 0;

  const login = () => {
    let ok = true;
    if (username.trim() !== child.username) {
      setUsernameError('Username not found.');
      ok = false;
    } else {
      setUsernameError('');
    }
    if (password !== child.password) {
      setPasswordError('Incorrect password or PIN.');
      ok = false;
    } else {
      setPasswordError('');
    }
    if (ok) navigation.navigate('ChildTabs');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Back button */}
      <TouchableOpacity
        style={styles.back}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Ionicons name="chevron-back" size={26} color="#1A1A3E" />
      </TouchableOpacity>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <Text style={styles.title}>Hi 👋 let's log in</Text>
          <Text style={styles.sub}>
            Ask your parent or guardian for your login details.{' '}
            <Text
              style={styles.link}
              onPress={() => Alert.alert('Login details', 'Ask your parent to open the Truzo app and go to your profile to find your login details.')}
            >
              How do I get my login details?
            </Text>
          </Text>

          {/* Username */}
          <View style={[styles.inputWrap, userFocused && styles.inputFocused, !!usernameError && styles.inputError]}>
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor="#AEAEB2"
              value={username}
              onChangeText={t => { setUsername(t); setUsernameError(''); }}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              onFocus={() => setUserFocused(true)}
              onBlur={() => setUserFocused(false)}
            />
          </View>
          {usernameError
            ? <Text style={styles.errorText}>{usernameError}</Text>
            : (
              <TouchableOpacity onPress={() => Alert.alert('Forgot username?', 'Ask your parent to check the app for your username.')}>
                <Text style={styles.forgotLink}>Forgot username?</Text>
              </TouchableOpacity>
            )
          }

          {/* Password */}
          <View style={[styles.inputWrap, styles.inputWrapRow, passFocused && styles.inputFocused, !!passwordError && styles.inputError]}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Password or card PIN"
              placeholderTextColor="#AEAEB2"
              value={password}
              onChangeText={t => { setPassword(t); setPasswordError(''); }}
              secureTextEntry={!showPass}
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setPassFocused(true)}
              onBlur={() => setPassFocused(false)}
            />
            <TouchableOpacity onPress={() => setShowPass(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={22} color="#AEAEB2" />
            </TouchableOpacity>
          </View>
          {passwordError
            ? <Text style={styles.errorText}>{passwordError}</Text>
            : (
              <TouchableOpacity onPress={() => Alert.alert('Forgot password?', 'Ask your parent to reset your password in the Truzo app.')}>
                <Text style={styles.forgotLink}>Forgot password?</Text>
              </TouchableOpacity>
            )
          }
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.btn, !canContinue && styles.btnDisabled]}
            onPress={login}
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
  back:    { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 16 },

  title: { fontSize: 28, fontWeight: '800', color: '#1A1A3E', marginBottom: 10 },
  sub:   { fontSize: 16, color: '#3C3C43', lineHeight: 24, marginBottom: 32 },
  link:  { color: PURPLE, fontWeight: '600' },

  inputWrap: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#D1D1D6',
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginBottom: 8,
  },
  inputWrapRow:  { flexDirection: 'row', alignItems: 'center' },
  inputFocused:  { borderColor: PURPLE },
  inputError:    { borderColor: '#FF3B30' },

  input: { fontSize: 17, color: '#1A1A3E', padding: 0 },

  forgotLink: { color: PURPLE, fontSize: 14, fontWeight: '600', marginBottom: 24 },
  errorText:  { color: '#FF3B30', fontSize: 13, marginBottom: 20 },

  footer: { paddingHorizontal: 24, paddingBottom: 16, paddingTop: 8, backgroundColor: BG },
  btn: {
    backgroundColor: PURPLE,
    borderRadius: 50,
    paddingVertical: 18,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText:     { color: '#fff', fontSize: 17, fontWeight: '700' },
});
