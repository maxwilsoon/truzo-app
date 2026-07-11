import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEYS = {
  TOKEN:     'truzo_biometric_token',
  CHILD_ID:  'truzo_biometric_child_id',
  DEVICE_ID: 'truzo_device_id',
};

// expo-secure-store requires a native build and is unavailable in Expo Go
// and web. Every call is wrapped so failures degrade gracefully instead of
// throwing and blocking authentication.

async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // best-effort — biometric persistence unavailable
  }
}

async function secureDel(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // best-effort
  }
}

export async function getDeviceId(): Promise<string> {
  if (Platform.OS === 'web') return 'web';
  let id = await secureGet(KEYS.DEVICE_ID);
  if (!id) {
    const rand = () => Math.random().toString(36).slice(2);
    id = `${rand()}${rand()}${Date.now().toString(36)}`;
    await secureSet(KEYS.DEVICE_ID, id);
  }
  return id;
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const hasHw   = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHw && enrolled;
  } catch {
    return false;
  }
}

export async function promptBiometric(reason: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}

export async function saveBiometricSession(childId: string): Promise<void> {
  const rand = () => Math.random().toString(36).slice(2);
  const token = `${rand()}${rand()}${rand()}${Date.now().toString(36)}`;
  await secureSet(KEYS.TOKEN, token);
  await secureSet(KEYS.CHILD_ID, childId);
}

export async function getStoredBiometricChildId(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  return secureGet(KEYS.CHILD_ID);
}

export async function hasBiometricSession(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const token = await secureGet(KEYS.TOKEN);
  return !!token;
}

export async function clearBiometricSession(): Promise<void> {
  if (Platform.OS === 'web') return;
  await Promise.all([
    secureDel(KEYS.TOKEN),
    secureDel(KEYS.CHILD_ID),
  ]);
}
