import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../../navigation/types';
import { useApp } from '../../context/AppContext';
import { hashPasscode } from '../../lib/passcode';
import { db } from '../../lib/database';
import { navigateToParentDash } from '../../lib/parentAccessGuard';
import { getLastParentForPasscode } from '../../lib/biometrics';
import { registerPushToken } from '../../lib/notifications';

const GREEN_DARK = '#3D7A45';
const PAD = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ParentPasscode'>;
  route: RouteProp<RootStackParamList, 'ParentPasscode'>;
};

export const ParentPasscodeScreen: React.FC<Props> = ({ navigation, route }) => {
  const { mode, pinToConfirm, onSuccess } = route.params;
  const { parent, setParent, savePasscodeToDb, userId, setUserId } = useApp();
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);

  // In 'enter' mode, ensure userId is available (needed for server-side PIN verification).
  // When userId is missing from context (e.g. after child logout + app restart),
  // fall back to the SecureStore key written at child/parent login time.
  useEffect(() => {
    if (mode !== 'enter') return;
    if (parent.passcodeCreated) return;
    (async () => {
      let effectiveUserId = userId;
      if (!effectiveUserId) {
        effectiveUserId = await getLastParentForPasscode();
        if (effectiveUserId) setUserId(effectiveUserId);
      }
      if (!effectiveUserId) {
        navigation.replace('ParentEmailLogin');
        return;
      }
      try {
        const created = await db.getParentPasscodeStatus(effectiveUserId);
        if (created) {
          setParent(p => ({ ...p, passcodeCreated: true }));
        } else {
          navigation.replace('ParentEmailLogin');
        }
      } catch {
        navigation.replace('ParentEmailLogin');
      }
    })();
  }, []);

  const firstName = (parent.displayName || 'there').split(' ')[0];

  const headings = {
    create:  { title: 'Create your PIN',  sub: 'Choose a 4-digit parent PIN' },
    confirm: { title: 'Confirm your PIN', sub: 'Re-enter your PIN to confirm' },
    enter:   { title: `Hi ${firstName}`,  sub: 'Enter your 4-digit parent PIN' },
  };
  const { title, sub } = headings[mode];

  const shake = () => {
    Vibration.vibrate(400);
    setError(true);
    setTimeout(() => { setCode(''); setError(false); }, 700);
  };

  const press = async (key: string) => {
    if (key === '⌫') {
      setCode(c => c.slice(0, -1));
      setError(false);
      return;
    }
    if (key === '' || code.length >= 4) return;

    const next = code + key;
    setCode(next);
    if (next.length < 4) return;

    if (mode === 'create') {
      setTimeout(() => {
        navigation.push('ParentPasscode', { mode: 'confirm', pinToConfirm: next, onSuccess });
      }, 150);

    } else if (mode === 'confirm') {
      if (next === pinToConfirm) {
        const hash = await hashPasscode(userId ?? '', next);
        // Save to DB first; then update context WITHOUT the hash so it is never written to AsyncStorage.
        try { await savePasscodeToDb(hash); } catch { /* DB save best-effort */ }
        setParent(p => ({ ...p, passcodeHash: '', passcodeCreated: true, passcode: '' }));
        setTimeout(async () => {
          if (onSuccess === 'ParentTabs') {
            // Login-time PIN creation: run Safety Pool guard before granting dashboard access.
            await navigateToParentDash(navigation, userId);
          } else {
            // Onboarding PIN creation: proceed to Safety Pool setup (required step).
            navigation.navigate('SafetyPool');
          }
        }, 150);
      } else {
        shake();
      }

    } else {
      // Enter mode — verify PIN server-side; the hash never leaves the DB.
      const ok = await db.verifyParentPasscode(userId ?? '', next);
      if (ok) {
        if (userId) registerPushToken(userId, 'parent').catch(() => {});
        setTimeout(async () => { await navigateToParentDash(navigation, userId); }, 150);
      } else {
        shake();
      }
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Back button */}
      <TouchableOpacity
        style={styles.back}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Ionicons name="chevron-back" size={28} color="#fff" />
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{sub}</Text>

        {/* 4 indicator dots */}
        <View style={styles.dots}>
          {[0,1,2,3].map(i => (
            <View
              key={i}
              style={[
                styles.dot,
                code.length > i && styles.dotFilled,
                error && styles.dotError,
              ]}
            />
          ))}
        </View>

        {/* Number pad */}
        <View style={styles.pad}>
          {PAD.map((key, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.keyBtn, key === '' && styles.keyHidden]}
              onPress={() => press(key)}
              disabled={key === ''}
              activeOpacity={0.45}
            >
              {key === '⌫' ? (
                <Ionicons name="backspace-outline" size={28} color="#fff" />
              ) : (
                <Text style={styles.keyText}>{key}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={() => navigation.navigate('ParentEmailLogin')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.footerLink}>Sign in with email</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.navigate('WhoIsLoggingIn')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.footerLink}>Switch account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: GREEN_DARK },
  back:    { position: 'absolute', top: 56, left: 24, zIndex: 10 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },

  title: { fontSize: 36, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 10 },
  sub:   { fontSize: 16, color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginBottom: 48 },

  dots: { flexDirection: 'row', gap: 20, marginBottom: 56 },
  dot: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: '#fff',
    backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: '#fff' },
  dotError:  { backgroundColor: '#FF6B6B', borderColor: '#FF6B6B' },

  pad:    { flexDirection: 'row', flexWrap: 'wrap', width: '100%', maxWidth: 340 },
  keyBtn: { width: '33.33%', height: 88, alignItems: 'center', justifyContent: 'center' },
  keyHidden: { opacity: 0 },
  keyText:   { fontSize: 34, fontWeight: '600', color: '#fff' },

  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
    paddingBottom: 20,
  },
  footerLink: { fontSize: 15, color: '#fff', fontWeight: '500' },
});
