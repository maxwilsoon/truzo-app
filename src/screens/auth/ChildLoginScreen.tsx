import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  TextInput, TouchableOpacity, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useApp } from '../../context/AppContext';
import { db } from '../../lib/database';
import { cache } from '../../lib/cache';
import { registerPushToken } from '../../lib/notifications';
import {
  getDeviceId, isBiometricAvailable,
  saveBiometricForChild, isBiometricDeclined, clearBiometricDeclined,
  setLastChildForBiometric, setLastParentForPasscode,
} from '../../lib/biometrics';

const GREEN = '#C8E8CB';
const GREEN_DARK = '#3D7A45';
const BG = '#E8F5E9';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'ChildLogin'> };

export const ChildLoginScreen: React.FC<Props> = ({ navigation }) => {
  const { child, setChild, childId, setChildId, setParent, setUserId, setIsChildLoggedIn, setCircle, setPendingRequests, setBiometricEnabled, setFrozenAccount, setParentDebt } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass]  = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [userFocused, setUserFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  // True when this device has a record that the cached child previously
  // declined Face ID setup — used to show the opt-in link.
  const [showBioSetupLink, setShowBioSetupLink] = useState(false);

  // Check declined state for the cached child on mount so we can show
  // the "Set up Face ID" link without waiting for a login attempt.
  useEffect(() => {
    if (Platform.OS === 'web' || !childId) return;
    isBiometricAvailable().then(async available => {
      if (!available) return;
      const declined = await isBiometricDeclined(childId);
      setShowBioSetupLink(declined);
    }).catch(() => {});
  }, [childId]);

  const canContinue = username.trim().length > 0 && password.length > 0;

  const login = async () => {
    const u = username.trim().toLowerCase();
    const p = password;

    // Always authenticate via Supabase so the DB can verify parent ownership.
    // Never use cached credentials — stale state from a previous session could
    // grant access to a different family's child account.
    setLoading(true);
    try {
      const result = await db.loginChild(u, p);
      if (!result) {
        setUsernameError('Username or password incorrect.');
        setPasswordError(' ');
        return;
      }
      const { child: row, parent: par } = result;
      setChild(c => ({
        ...c,
        displayName:   row.display_name,
        username:      row.username,
        avatarEmoji:     row.avatar_emoji,
        profileImageUrl: row.profile_image_url ?? undefined,
        trustScore:    row.trust_score,
        balance:       row.wallet_balance,
        loanedOut:     row.loaned_out,
        borrowed:      row.borrowed,
        streak:        row.streak,
        repaid:        row.repaid,
        missed:        row.missed,
        totalBorrowed: row.total_borrowed,
        totalLent:     row.total_lent,
        timesBorrowed: row.times_borrowed ?? 0,
        timesLent:     row.times_lent ?? 0,
        points:        row.points,
        age:           row.age,
        mobile:        row.mobile ?? '',
      }));
      setFrozenAccount(row.account_frozen ?? false);
      setParentDebt(row.parent_debt ?? 0);
      if (par) {
        setParent(prev => ({
          ...prev,
          firstName:       par.first_name ?? '',
          lastName:        par.last_name ?? '',
          displayName:     par.display_name || par.first_name || '',
          mobile:          par.mobile ?? '',
          address:         par.address ?? '',
          safetyPoolLimit:     par.safety_pool_limit ?? 0,
          safetyPoolUsed:      par.safety_pool_used ?? 0,
          weeklyAllowance:     par.weekly_allowance ?? 0,
          allowanceFrequency:  par.allowance_frequency ?? 'weekly',
          allowanceNextPayment: par.allowance_next_payment ?? '',
          allowanceActive:     par.allowance_active ?? false,
          passcode:               '',
          passcodeHash:    par.passcode_hash    ?? prev.passcodeHash,
          passcodeCreated: par.passcode_created ?? prev.passcodeCreated,
          marketingNotifications: par.marketing_notifications ?? false,
          profileImageUrl:        par.profile_image_url ?? undefined,
        }));
      }
      setChildId(row.id);
      await cache.saveChild({ username: row.username, childId: row.id });
      // Persist childId in SecureStore so WhoIsLoggingInScreen can offer Face ID
      // on the next visit even after logout clears the AsyncStorage cache.
      setLastChildForBiometric(row.id).catch(() => {});
      // Set the parent's userId from the login response so PasscodeScreen can
      // verify the PIN with hashPasscode(userId, pin) even without a prior parent
      // email login in this session. Also persist to cache and SecureStore so the
      // value survives a fresh app restart.
      if (par?.id) {
        setUserId(par.id);
        cache.saveUserId(par.id).catch(() => {});
        setLastParentForPasscode(par.id).catch(() => {});
      }

      // Register device for push notifications (best-effort, won't block login)
      registerPushToken(row.id).catch(() => {});

      // Load circle + pending requests — each independently so one failure can't block another
      db.getCircle(row.id).then(members => {
        setCircle(members.map(m => ({
          id: m.id, displayName: m.display_name,
          username: m.username, avatarEmoji: m.avatar_emoji, trustScore: m.trust_score,
          profileImageUrl: m.avatar_url ?? undefined,
        })));
      }).catch(() => {});

      db.getPendingRequests(row.id).then(requests => {
        setPendingRequests(requests.map(r => ({
          requestId: r.request_id, id: r.id, displayName: r.display_name,
          username: r.username, avatarEmoji: r.avatar_emoji,
          trustScore: r.trust_score, createdAt: r.created_at,
          profileImageUrl: r.avatar_url ?? undefined,
        })));
      }).catch(() => {});


      setIsChildLoggedIn(true);

      // Decide whether to offer Face ID setup or go straight to the dashboard.
      // All biometric checks are best-effort — any failure falls back to ChildTabs.
      let destination: 'BiometricSetup' | 'ChildTabs' = 'ChildTabs';
      if (Platform.OS !== 'web') {
        try {
          const biometricsAvailable = await isBiometricAvailable();
          if (biometricsAvailable) {
            const deviceId = await getDeviceId();
            if (row.biometric_enabled && row.last_device_id === deviceId) {
              // Biometric was previously set up for this child on this device.
              // Refresh the child-scoped local token so WhoIsLoggingIn can
              // offer Face ID next time (even after an app reinstall).
              await saveBiometricForChild(row.id);
              setBiometricEnabled(true);
            } else {
              // Not yet set up (new account or new device).
              // Only show the setup prompt if the child hasn't already declined.
              const declined = await isBiometricDeclined(row.id);
              if (!declined) destination = 'BiometricSetup';
            }
          }
        } catch {
          // Native module unavailable (Expo Go) — skip silently
        }
      }

      navigation.navigate(destination);
    } catch (err: any) {
      Alert.alert('Login error', String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TouchableOpacity
        style={styles.back}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Ionicons name="chevron-back" size={26} color="#1A1A3E" />
      </TouchableOpacity>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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

          <View style={[styles.inputWrap, userFocused && styles.inputFocused, !!usernameError && styles.inputError]}>
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor="#AEAEB2"
              value={username}
              onChangeText={t => { setUsername(t); setUsernameError(''); setPasswordError(''); }}
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

          <View style={[styles.inputWrap, styles.inputWrapRow, passFocused && styles.inputFocused, !!passwordError && styles.inputError]}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Password"
              placeholderTextColor="#AEAEB2"
              value={password}
              onChangeText={t => { setPassword(t); setPasswordError(''); setUsernameError(''); }}
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
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.btn, (!canContinue || loading) && styles.btnDisabled]}
            onPress={login}
            disabled={!canContinue || loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#1F2937" />
              : <Text style={styles.btnText}>Continue</Text>
            }
          </TouchableOpacity>

          {/* Shown only after the cached child has previously declined Face ID —
              lets them opt in later without being prompted automatically. */}
          {showBioSetupLink && (
            <TouchableOpacity
              style={styles.bioSetupLink}
              onPress={async () => {
                if (childId) await clearBiometricDeclined(childId);
                setShowBioSetupLink(false);
                Alert.alert(
                  'Face ID',
                  "You'll be asked to set up Face ID after you sign in.",
                  [{ text: 'OK' }],
                );
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="finger-print" size={16} color={GREEN_DARK} style={{ marginRight: 6 }} />
              <Text style={styles.bioSetupLinkText}>Set up Face ID</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: BG },
  back:   { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  scroll: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16 },

  title: { fontSize: 28, fontWeight: '800', color: '#1A1A3E', marginBottom: 10 },
  sub:   { fontSize: 16, color: '#3C3C43', lineHeight: 24, marginBottom: 32 },
  link:  { color: GREEN_DARK, fontWeight: '600' },

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
  inputFocused:  { borderColor: GREEN },
  inputError:    { borderColor: '#FF3B30' },

  input: { fontSize: 17, color: '#1A1A3E', padding: 0 },

  forgotLink: { color: GREEN_DARK, fontSize: 14, fontWeight: '600', marginBottom: 24 },
  errorText:  { color: '#FF3B30', fontSize: 13, marginBottom: 20 },

  footer: { paddingHorizontal: 24, paddingBottom: 16, paddingTop: 8, backgroundColor: BG },
  btn: {
    backgroundColor: GREEN,
    borderRadius: 50,
    paddingVertical: 18,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText:     { color: '#1F2937', fontSize: 17, fontWeight: '700' },

  bioSetupLink: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', paddingVertical: 12, marginTop: 4,
  },
  bioSetupLinkText: { color: GREEN_DARK, fontSize: 14, fontWeight: '600' },
});
