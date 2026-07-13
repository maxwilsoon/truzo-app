import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useApp } from '../../context/AppContext';
import { db } from '../../lib/database';
import {
  getDeviceId,
  promptBiometric,
  saveBiometricSession,
} from '../../lib/biometrics';

const GREEN = '#C8E8CB';
const GREEN_DARK = '#3D7A45';
const BG = '#E8F5E9';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'BiometricSetup'> };

export const BiometricSetupScreen: React.FC<Props> = ({ navigation }) => {
  const { childId, setBiometricEnabled } = useApp();
  const [loading, setLoading] = useState(false);

  const goToDashboard = () => {
    navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'ChildTabs' }] }));
  };

  const handleEnable = async () => {
    if (!childId) { goToDashboard(); return; }
    setLoading(true);
    try {
      const success = await promptBiometric('Verify your identity to enable Face ID login');
      if (!success) {
        setLoading(false);
        return;
      }
      const deviceId = await getDeviceId();
      await db.enableBiometric(childId, deviceId);
      await saveBiometricSession(childId);
      setBiometricEnabled(true);
      goToDashboard();
    } catch {
      setLoading(false);
      Alert.alert('Error', 'Could not enable Face ID. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons name="finger-print" size={56} color={GREEN_DARK} />
        </View>

        <Text style={styles.title}>Use Face ID for{'\n'}faster login?</Text>

        <Text style={styles.body}>
          Securely sign in to your TRUZO account using Face ID or your device's biometrics.
        </Text>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, loading && styles.btnDisabled]}
          onPress={handleEnable}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#1F2937" />
            : <>
                <Ionicons name="finger-print" size={20} color="#1F2937" style={{ marginRight: 8 }} />
                <Text style={styles.primaryBtnText}>Enable Face ID</Text>
              </>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipBtn} onPress={goToDashboard} activeOpacity={0.7}>
          <Text style={styles.skipBtnText}>Not Now</Text>
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
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: GREEN,
    borderRadius: 50,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#1F2937', fontSize: 17, fontWeight: '700' },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  skipBtnText: { color: GREEN_DARK, fontSize: 16, fontWeight: '600' },
});
