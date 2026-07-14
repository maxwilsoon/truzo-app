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

const GREEN_DARK = '#3D7A45';
const PAD = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ParentPasscode'>;
  route: RouteProp<RootStackParamList, 'ParentPasscode'>;
};

export const ParentPasscodeScreen: React.FC<Props> = ({ navigation, route }) => {
  const { mode, pinToConfirm, onSuccess } = route.params;
  const { parent, setParent, savePasscodeToDb, userId } = useApp();
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);

  // If we arrive in 'enter' mode with no hash in context (e.g. child login cleared it),
  // fetch the hash from DB so the parent can still verify their PIN.
  // If the DB also has no hash (legacy account), fall back to email login.
  useEffect(() => {
    if (mode !== 'enter') return;
    if (parent.passcodeHash || parent.passcode) return; // already have what we need
    if (!userId) {
      navigation.replace('ParentEmailLogin');
      return;
    }
    db.getParentPasscodeHash(userId).then(result => {
      if (result?.hash) {
        setParent(p => ({ ...p, passcodeHash: result.hash!, passcodeCreated: true }));
      } else {
        // No passcode in DB — should only happen for pre-PIN legacy accounts
        navigation.replace('ParentEmailLogin');
      }
    }).catch(() => {
      navigation.replace('ParentEmailLogin');
    });
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
        setParent(p => ({ ...p, passcodeHash: hash, passcodeCreated: true, passcode: '' }));
        try { await savePasscodeToDb(hash); } catch { /* context + cache already updated */ }
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
      // Enter mode — try hash comparison first, fall back to plain text for migrating old accounts.
      // Always run the Safety Pool guard before granting dashboard access.
      if (parent.passcodeHash) {
        const hash = await hashPasscode(userId ?? '', next);
        if (hash === parent.passcodeHash) {
          setTimeout(async () => { await navigateToParentDash(navigation, userId); }, 150);
        } else {
          shake();
        }
      } else if (parent.passcode) {
        // Migration path: old plain-text passcode in cache
        if (next === parent.passcode) {
          // Auto-upgrade: hash and save, clear plain text
          const hash = await hashPasscode(userId ?? '', next);
          setParent(p => ({ ...p, passcodeHash: hash, passcodeCreated: true, passcode: '' }));
          savePasscodeToDb(hash).catch(() => {});
          setTimeout(async () => { await navigateToParentDash(navigation, userId); }, 150);
        } else {
          shake();
        }
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
