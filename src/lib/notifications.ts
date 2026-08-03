import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { db } from './database';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Hold the last registered push token and its owner for the current session.
// Both are required by deregisterCurrentPushToken() to satisfy the ownership check added in migration 017.
let _currentPushToken: string | null = null;
let _currentUserId:    string | null = null;

/**
 * Requests push permission, obtains an Expo push token, and registers it in the
 * device_tokens table (plus the legacy children.push_token column).
 *
 * @param userId   - UUID of the logged-in user (child or parent)
 * @param userType - 'child' | 'parent'
 */
export async function registerPushToken(
  userId: string,
  userType: 'child' | 'parent' = 'child',
): Promise<string | null> {
  if (!Device.isDevice) return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId;
  if (!projectId) {
    if (__DEV__) console.warn('[Truzo] No Expo project ID — push notifications disabled.');
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    _currentPushToken = token;
    _currentUserId    = userId;

    // Register in device_tokens table (and keep legacy children.push_token in sync)
    await db.registerDeviceToken(
      userId,
      userType,
      token,
      Platform.OS,
      Constants.expoConfig?.version ?? undefined,
    );

    return token;
  } catch (e) {
    if (__DEV__) console.warn('[Truzo] Push token registration failed:', e);
    return null;
  }
}

/**
 * Deactivates the push token registered during the current session.
 * Call this on logout so the device stops receiving notifications while logged out.
 */
export async function deregisterCurrentPushToken(): Promise<void> {
  if (!_currentPushToken || !_currentUserId) return;
  try {
    await db.deregisterDeviceToken(_currentPushToken, _currentUserId);
  } catch (e) {
    if (__DEV__) console.warn('[Truzo] Push token deregistration failed:', e);
  } finally {
    _currentPushToken = null;
    _currentUserId    = null;
  }
}

/**
 * Returns the Expo push token registered in the current session (if any).
 * Useful for passing to deregistration flows outside of this module.
 */
export function getCurrentPushToken(): string | null {
  return _currentPushToken;
}
