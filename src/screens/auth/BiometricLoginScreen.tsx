import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useApp } from '../../context/AppContext';
import { db } from '../../lib/database';
import { registerPushToken } from '../../lib/notifications';
import {
  getDeviceId,
  getStoredBiometricChildId,
  promptBiometric,
  clearBiometricSession,
} from '../../lib/biometrics';

const GREEN = '#C8E8CB';
const GREEN_DARK = '#3D7A45';
const BG = '#E8F5E9';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'BiometricLogin'> };

type Status = 'idle' | 'authenticating' | 'success' | 'failed';

export const BiometricLoginScreen: React.FC<Props> = ({ navigation }) => {
  const {
    setChild, setChildId, setParent, setIsChildLoggedIn,
    setCircle, setPendingRequests, setUserId, setBiometricEnabled,
  } = useApp();
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const applyLoginResult = useCallback(async (result: { child: Record<string, any>; parent: Record<string, any> }) => {
    const { child: row, parent: par } = result;
    setChild(c => ({
      ...c,
      displayName:   row.display_name,
      username:      row.username,
      password:      row.password ?? '',
      avatarEmoji:   row.avatar_emoji,
      avatarUrl:     row.avatar_url ?? undefined,
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
    if (par) {
      setUserId(par.id);
      setParent(prev => ({
        ...prev,
        firstName:       par.first_name ?? '',
        lastName:        par.last_name ?? '',
        displayName:     par.first_name ?? '',
        mobile:          par.mobile ?? '',
        address:         par.address ?? '',
        safetyPoolLimit:        par.safety_pool_limit ?? 50,
        weeklyAllowance:        par.weekly_allowance ?? 10,
        passcodeCreated:        par.passcode_created ?? false,
        marketingNotifications: par.marketing_notifications ?? null,
        profileImageUrl:        par.profile_image_url ?? undefined,
      }));
    }
    setChildId(row.id);
    setBiometricEnabled(true);
    registerPushToken(row.id).catch(() => {});
    db.getCircle(row.id).then(members => {
      setCircle(members.map(m => ({
        id: m.id, displayName: m.display_name,
        username: m.username, avatarEmoji: m.avatar_emoji, trustScore: m.trust_score,
      })));
    }).catch(() => {});
    db.getPendingRequests(row.id).then(requests => {
      setPendingRequests(requests.map(r => ({
        requestId: r.request_id, id: r.id, displayName: r.display_name,
        username: r.username, avatarEmoji: r.avatar_emoji,
        trustScore: r.trust_score, createdAt: r.created_at,
      })));
    }).catch(() => {});
    setIsChildLoggedIn(true);
  }, [setChild, setChildId, setParent, setIsChildLoggedIn, setCircle, setPendingRequests, setUserId, setBiometricEnabled]);

  const authenticate = useCallback(async () => {
    setStatus('authenticating');
    setErrorMsg('');
    try {
      const childId = await getStoredBiometricChildId();
      if (!childId) {
        setStatus('failed');
        setErrorMsg('No saved login found on this device.');
        return;
      }
      const success = await promptBiometric('Unlock your TRUZO account');
      if (!success) {
        setStatus('failed');
        setErrorMsg('Biometric authentication was cancelled or failed.');
        return;
      }
      const deviceId = await getDeviceId();
      const result = await db.biometricLoginChild(childId, deviceId);
      if (!result) {
        // Biometric was revoked or device changed — clear the stored session
        await clearBiometricSession();
        setStatus('failed');
        setErrorMsg('Face ID login is no longer active. Please sign in with your password.');
        return;
      }
      setStatus('success');
      await applyLoginResult(result);
      navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'ChildTabs' }] }));
    } catch {
      setStatus('failed');
      setErrorMsg('Something went wrong. Please try again.');
    }
  }, [applyLoginResult, navigation]);

  useEffect(() => {
    authenticate();
  }, []);

  const usePassword = () => {
    navigation.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: 'WhoIsLoggingIn' }] })
    );
    // Small delay to avoid navigate during reset
    setTimeout(() => navigation.navigate('ChildLogin'), 50);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={[styles.iconCircle, status === 'failed' && styles.iconCircleFailed]}>
          {status === 'authenticating'
            ? <ActivityIndicator size="large" color={GREEN_DARK} />
            : status === 'success'
              ? <Ionicons name="checkmark-circle" size={56} color="#34C759" />
              : status === 'failed'
                ? <Ionicons name="alert-circle" size={56} color="#FF3B30" />
                : <Ionicons name="finger-print" size={56} color={GREEN_DARK} />
          }
        </View>

        <Text style={styles.title}>Unlock with{'\n'}Face ID</Text>

        {status === 'failed' && errorMsg ? (
          <Text style={styles.errorText}>{errorMsg}</Text>
        ) : (
          <Text style={styles.body}>
            {status === 'authenticating'
              ? 'Authenticating…'
              : status === 'success'
                ? 'Success! Signing you in…'
                : 'Authenticate to sign in to your TRUZO account.'}
          </Text>
        )}
      </View>

      <View style={styles.footer}>
        {status === 'failed' && (
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={authenticate}
            activeOpacity={0.85}
          >
            <Ionicons name="refresh" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.passwordBtn} onPress={usePassword} activeOpacity={0.7}>
          <Text style={styles.passwordBtnText}>Use Password Instead</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  iconCircleFailed: { backgroundColor: '#FFF0F0' },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#1A1A3E',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 38,
  },
  body: {
    fontSize: 16,
    color: '#3C3C43',
    textAlign: 'center',
    lineHeight: 24,
  },
  errorText: {
    fontSize: 15,
    color: '#FF3B30',
    textAlign: 'center',
    lineHeight: 22,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 12,
  },
  retryBtn: {
    backgroundColor: GREEN,
    borderRadius: 50,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: { color: '#1F2937', fontSize: 17, fontWeight: '700' },
  passwordBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  passwordBtnText: { color: GREEN_DARK, fontSize: 16, fontWeight: '600' },
});
