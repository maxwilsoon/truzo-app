import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  PARENT:  '@truzo/parent',
  CHILD:   '@truzo/child',
  USER_ID: '@truzo/userId',
} as const;

// AsyncStorage can throw "Native module is null, cannot access legacy storage"
// on certain Expo Go / build configurations. Cache is best-effort — a failure
// must never block authentication.
async function safeSave(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Silently ignore — app works without local cache
  }
}

async function safeLoad<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function safeClear(keys: string[]): Promise<void> {
  try {
    await Promise.all(keys.map(k => AsyncStorage.removeItem(k)));
  } catch {
    // best-effort
  }
}

export const cache = {
  saveParent:  (data: object)  => safeSave(KEYS.PARENT,  JSON.stringify(data)),
  loadParent:  <T>()           => safeLoad<T>(KEYS.PARENT),
  saveChild:   (data: object)  => safeSave(KEYS.CHILD,   JSON.stringify(data)),
  loadChild:   <T>()           => safeLoad<T>(KEYS.CHILD),
  saveUserId:  (id: string)    => safeSave(KEYS.USER_ID, id),
  loadUserId:  ()              => safeLoad<string>(KEYS.USER_ID),
  clear:       ()              => safeClear(Object.values(KEYS)),
};
