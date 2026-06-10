import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  PARENT:  '@truzo/parent',
  CHILD:   '@truzo/child',
  USER_ID: '@truzo/userId',
} as const;

async function load<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export const cache = {
  saveParent:  (data: object)  => AsyncStorage.setItem(KEYS.PARENT,  JSON.stringify(data)),
  loadParent:  <T>()           => load<T>(KEYS.PARENT),
  saveChild:   (data: object)  => AsyncStorage.setItem(KEYS.CHILD,   JSON.stringify(data)),
  loadChild:   <T>()           => load<T>(KEYS.CHILD),
  saveUserId:  (id: string)    => AsyncStorage.setItem(KEYS.USER_ID, id),
  loadUserId:  ()              => AsyncStorage.getItem(KEYS.USER_ID),
  clear:       ()              => AsyncStorage.multiRemove(Object.values(KEYS)),
};
