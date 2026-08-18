import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// SecureStore key format: ^[\w.-]+$ — use _ separator only.
const sessionKey = (childId: string) => `breesh_child_session_${childId}`;

interface StoredSession {
  token: string;
  expiresAt: string;
}

// Web storage: sessionStorage (cleared when the browser tab closes).
// sessionStorage is accessible to any JS on the same origin — it is NOT
// hardware-backed. Tokens are scoped per child by including the childId in the
// key so Child A's session never overwrites Child B's.
// Native storage: iOS Keychain / Android Keychain via expo-secure-store.

const webGet = (key: string): StoredSession | null => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
};

const webSet = (key: string, value: StoredSession): void => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sessionStorage unavailable (e.g. private mode with storage blocked)
    // Session will be in-memory only for this render cycle.
  }
};

const webDel = (key: string): void => {
  try {
    sessionStorage.removeItem(key);
  } catch {}
};

export async function saveChildSession(
  childId: string,
  token: string,
  expiresAt: string,
): Promise<void> {
  const key = sessionKey(childId);
  if (Platform.OS === 'web') {
    webSet(key, { token, expiresAt });
    return;
  }
  await SecureStore.setItemAsync(key, JSON.stringify({ token, expiresAt }));
}

export async function getChildSession(
  childId: string,
): Promise<{ token: string; expiresAt: string } | null> {
  const key = sessionKey(childId);
  if (Platform.OS === 'web') {
    return webGet(key);
  }
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export async function clearChildSession(childId: string): Promise<void> {
  const key = sessionKey(childId);
  if (Platform.OS === 'web') {
    webDel(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {}
}
