import * as SecureStore from 'expo-secure-store';

// SecureStore key format: ^[\w.-]+$ — use _ separator only.
const sessionKey = (childId: string) => `truzo_child_session_${childId}`;

interface StoredSession {
  token: string;
  expiresAt: string;
}

export async function saveChildSession(
  childId: string,
  token: string,
  expiresAt: string,
): Promise<void> {
  await SecureStore.setItemAsync(sessionKey(childId), JSON.stringify({ token, expiresAt }));
}

export async function getChildSession(
  childId: string,
): Promise<{ token: string; expiresAt: string } | null> {
  try {
    const raw = await SecureStore.getItemAsync(sessionKey(childId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export async function clearChildSession(childId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(sessionKey(childId));
  } catch {}
}
