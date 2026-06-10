import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme/colors';
import { useApp } from '../../context/AppContext';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Verifying'> };

export const VerifyingScreen: React.FC<Props> = ({ navigation }) => {
  const { saveOnboardingToDb } = useApp();

  useEffect(() => {
    let cancelled = false;

    // Run the DB save and the minimum animation delay in parallel.
    // We cap the DB wait at 6 s so a slow network never blocks the user forever.
    const dbPromise = Promise.race([
      saveOnboardingToDb().catch(err => console.warn('[Truzo] onboarding save failed:', err)),
      new Promise<void>(resolve => setTimeout(resolve, 6000)),
    ]);
    const animationDelay = new Promise<void>(resolve => setTimeout(resolve, 2800));

    Promise.all([dbPromise, animationDelay]).then(() => {
      if (!cancelled) navigation.navigate('WhoIsLoggingIn');
    });

    return () => { cancelled = true; };
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>🔍</Text>
        </View>
        <Text style={styles.title}>Verifying your identity</Text>
        <Text style={styles.sub}>This only takes a moment. Please don't close the app.</Text>
        <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 32 }} />
        <View style={styles.steps}>
          {['Checking your details', 'Verifying address', 'Confirming identity'].map((s, i) => (
            <View key={s} style={styles.step}>
              <Text style={styles.stepDot}>✓</Text>
              <Text style={styles.stepText}>{s}</Text>
            </View>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  iconWrap: {
    width: 100, height: 100, borderRadius: 30,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 28,
  },
  icon: { fontSize: 48 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, marginBottom: 12, textAlign: 'center' },
  sub: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  steps: { marginTop: 40, gap: 16, width: '100%' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepDot: { fontSize: 16, color: colors.success },
  stepText: { fontSize: 15, color: colors.textSecondary },
});
