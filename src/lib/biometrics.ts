import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// expo-secure-store requires a native build and is unavailable in Expo Go
// and web. Every call is wrapped so failures degrade gracefully.

async function secureGet(key: string): Promise<string | null> {
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}

async function secureSet(key: string, value: string): Promise<void> {
  try { await SecureStore.setItemAsync(key, value); } catch {}
}

async function secureDel(key: string): Promise<void> {
  try { await SecureStore.deleteItemAsync(key); } catch {}
}

// ─── Key helpers ─────────────────────────────────────────────────────────────
// All biometric state is scoped by childId so Child A's Face ID setup never
// leaks to Child B (even on the same device).

const DEVICE_KEY   = 'truzo_device_id';
const tokenKey     = (childId: string) => `truzo_bio_token:${childId}`;
const declinedKey  = (childId: string) => `truzo_bio_declined:${childId}`;

// ─── Device ID (stable, per-install) ─────────────────────────────────────────

export async function getDeviceId(): Promise<string> {
  if (Platform.OS === 'web') return 'web';
  let id = await secureGet(DEVICE_KEY);
  if (!id) {
    const rand = () => Math.random().toString(36).slice(2);
    id = `${rand()}${rand()}${Date.now().toString(36)}`;
    await secureSet(DEVICE_KEY, id);
  }
  return id;
}

// ─── Hardware availability ────────────────────────────────────────────────────

export async function isBiometricAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const hasHw    = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHw && enrolled;
  } catch { return false; }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

export async function promptBiometric(reason: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    return result.success;
  } catch { return false; }
}

// ─── Per-child biometric token ────────────────────────────────────────────────
// The token is a random string stored in SecureStore under a key scoped to the
// child's UUID. Its presence means biometric login is active for that child
// on this device. The DB RPC performs the actual authentication check
// (biometric_enabled = true AND last_device_id = deviceId).

export async function hasBiometricForChild(childId: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const token = await secureGet(tokenKey(childId));
  return !!token;
}

export async function saveBiometricForChild(childId: string): Promise<void> {
  const rand = () => Math.random().toString(36).slice(2);
  const token = `${rand()}${rand()}${rand()}${Date.now().toString(36)}`;
  await secureSet(tokenKey(childId), token);
}

export async function clearBiometricForChild(childId: string): Promise<void> {
  await Promise.all([
    secureDel(tokenKey(childId)),
    secureDel(declinedKey(childId)),
  ]);
}

// ─── Declined state ───────────────────────────────────────────────────────────
// Tracks whether a child tapped "Not Now" on the biometric setup prompt.
// The declined flag is child-and-device-specific so future logins don't
// auto-prompt the same child again, while a sibling or new child gets a
// fresh setup offer after their own first successful username/password login.

export async function setBiometricDeclined(childId: string): Promise<void> {
  await secureSet(declinedKey(childId), '1');
}

export async function isBiometricDeclined(childId: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const val = await secureGet(declinedKey(childId));
  return val === '1';
}

export async function clearBiometricDeclined(childId: string): Promise<void> {
  await secureDel(declinedKey(childId));
}
