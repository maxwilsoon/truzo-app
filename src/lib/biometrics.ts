import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// expo-secure-store key validation: /^[\w.-]+$/ — only alphanumeric, ".", "-", "_".
// Colons are NOT allowed. All compound keys here use "_" as separator.

// ─── Secure helpers ───────────────────────────────────────────────────────────

async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (e) {
    if (__DEV__) console.warn('[biometrics] secureGet error for key', key, String(e));
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (e) {
    if (__DEV__) console.warn('[biometrics] secureSet error for key', key, String(e));
  }
}

async function secureDel(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (e) {
    if (__DEV__) console.warn('[biometrics] secureDel error for key', key, String(e));
  }
}

// ─── Key helpers ─────────────────────────────────────────────────────────────
// All biometric state is scoped by childId so Child A's Face ID setup never
// leaks to Child B (even on the same device).
// Separator is "_" — colon ":" is rejected by SecureStore key validation.

const DEVICE_KEY      = 'truzo_device_id';
const LAST_CHILD_KEY  = 'truzo_last_child';
const LAST_PARENT_KEY = 'truzo_last_parent_id';
const tokenKey        = (childId: string) => `truzo_bio_token_${childId}`;
const declinedKey     = (childId: string) => `truzo_bio_declined_${childId}`;

// ─── Device ID (stable, per-install) ─────────────────────────────────────────

export async function getDeviceId(): Promise<string> {
  if (Platform.OS === 'web') return 'web';
  let id = await secureGet(DEVICE_KEY);
  if (!id) {
    const rand = () => Math.random().toString(36).slice(2);
    id = `${rand()}${rand()}${Date.now().toString(36)}`;
    await secureSet(DEVICE_KEY, id);
  }
  if (__DEV__) console.log('[biometrics] getDeviceId:', id);
  return id;
}

// ─── Hardware availability ────────────────────────────────────────────────────

export async function isBiometricAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const hasHw    = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (__DEV__) console.log('[biometrics] isBiometricAvailable: hasHw=', hasHw, 'enrolled=', enrolled);
    return hasHw && enrolled;
  } catch (e) {
    if (__DEV__) console.warn('[biometrics] isBiometricAvailable error:', String(e));
    return false;
  }
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
    if (__DEV__) console.log('[biometrics] promptBiometric result:', result);
    return result.success;
  } catch (e) {
    if (__DEV__) console.warn('[biometrics] promptBiometric error:', String(e));
    return false;
  }
}

// ─── Per-child biometric token ────────────────────────────────────────────────
// The token is a random string stored in SecureStore under a key scoped to the
// child's UUID. Its presence means biometric login is active for that child
// on this device. The DB RPC performs the actual authentication check
// (biometric_enabled = true AND last_device_id = deviceId).

export async function hasBiometricForChild(childId: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const key   = tokenKey(childId);
  const token = await secureGet(key);
  const has   = !!token;
  if (__DEV__) console.log('[biometrics] hasBiometricForChild', childId.slice(0, 8), '→', has, '(key:', key + ')');
  return has;
}

export async function saveBiometricForChild(childId: string): Promise<void> {
  const rand  = () => Math.random().toString(36).slice(2);
  const token = `${rand()}${rand()}${rand()}${Date.now().toString(36)}`;
  const key   = tokenKey(childId);
  await secureSet(key, token);
  if (__DEV__) console.log('[biometrics] saveBiometricForChild: wrote token to', key);
}

export async function clearBiometricForChild(childId: string): Promise<void> {
  const stored = await secureGet(LAST_CHILD_KEY);
  if (__DEV__) console.log('[biometrics] clearBiometricForChild', childId.slice(0, 8), 'LAST_CHILD_KEY matches:', stored === childId);
  await Promise.all([
    secureDel(tokenKey(childId)),
    secureDel(declinedKey(childId)),
    ...(stored === childId ? [secureDel(LAST_CHILD_KEY)] : []),
  ]);
}

// ─── Last-child persistence (survives logout) ────────────────────────────────
// Stores the childId of the most recently authenticated child in SecureStore so
// WhoIsLoggingInScreen can offer Face ID after logout or a cold app restart,
// even though the regular AsyncStorage cache is cleared on logout.

export async function setLastChildForBiometric(childId: string): Promise<void> {
  await secureSet(LAST_CHILD_KEY, childId);
  if (__DEV__) console.log('[biometrics] setLastChildForBiometric:', childId.slice(0, 8));
}

export async function getLastChildForBiometric(): Promise<string | null> {
  const id = await secureGet(LAST_CHILD_KEY);
  if (__DEV__) console.log('[biometrics] getLastChildForBiometric:', id ? id.slice(0, 8) : 'null');
  return id;
}

// ─── Last-parent persistence (survives logout and app restart) ────────────────
// Stores the parent UUID so ParentPasscodeScreen can compute the correct
// hashPasscode(parentId, pin) even when the AsyncStorage userId cache is stale
// or the parent has not done a fresh email login in this session.
// Contains only the UUID — no passcode or hash is stored here.

export async function setLastParentForPasscode(parentId: string): Promise<void> {
  await secureSet(LAST_PARENT_KEY, parentId);
}

export async function getLastParentForPasscode(): Promise<string | null> {
  return secureGet(LAST_PARENT_KEY);
}

// ─── Declined state ───────────────────────────────────────────────────────────
// Tracks whether a child tapped "Not Now" on the biometric setup prompt.
// The declined flag is child-and-device-specific so future logins don't
// auto-prompt the same child again, while a sibling or new child gets a
// fresh setup offer after their own first successful username/password login.

export async function setBiometricDeclined(childId: string): Promise<void> {
  const key = declinedKey(childId);
  await secureSet(key, '1');
  if (__DEV__) console.log('[biometrics] setBiometricDeclined:', childId.slice(0, 8));
}

export async function isBiometricDeclined(childId: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const key = declinedKey(childId);
  const val = await secureGet(key);
  const declined = val === '1';
  if (__DEV__) console.log('[biometrics] isBiometricDeclined', childId.slice(0, 8), '→', declined);
  return declined;
}

export async function clearBiometricDeclined(childId: string): Promise<void> {
  await secureDel(declinedKey(childId));
}
