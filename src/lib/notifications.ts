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

// Per-session registration state — cleared on deregister.
let _currentPushToken:    string | null = null;
let _currentUserId:       string | null = null;
let _currentUserType:     'child' | 'parent' | null = null;
let _currentSessionToken: string | null = null;
let _currentDeviceId:     string | null = null;

export async function registerPushToken(
  userId: string,
  userType: 'child' | 'parent' = 'child',
  sessionToken?: string,
  deviceId?: string,
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

    if (userType === 'parent') {
      await db.registerParentDeviceToken(
        token,
        Platform.OS,
        Constants.expoConfig?.version ?? undefined,
      );
    } else {
      if (!sessionToken || !deviceId) {
        if (__DEV__) console.warn('[Truzo] registerPushToken: child path requires sessionToken + deviceId');
        return null;
      }
      await db.registerChildDeviceToken(
        userId,
        sessionToken,
        deviceId,
        token,
        Platform.OS,
        Constants.expoConfig?.version ?? undefined,
      );
    }

    _currentPushToken    = token;
    _currentUserId       = userId;
    _currentUserType     = userType;
    _currentSessionToken = sessionToken ?? null;
    _currentDeviceId     = deviceId ?? null;
    return token;
  } catch (e) {
    if (__DEV__) console.warn('[Truzo] Push token registration failed:', e);
    return null;
  }
}

/**
 * Deactivates the push token registered during the current session.
 * Propagates errors to the caller (resetSession awaits this before revoking
 * the child session, so the session must still be valid when this runs).
 */
export async function deregisterCurrentPushToken(): Promise<void> {
  if (!_currentPushToken || !_currentUserType) return;
  const token     = _currentPushToken;
  const userId    = _currentUserId;
  const userType  = _currentUserType;
  const sessToken = _currentSessionToken;
  const devId     = _currentDeviceId;

  // Clear state before the async call so a second concurrent deregister is a no-op.
  _currentPushToken    = null;
  _currentUserId       = null;
  _currentUserType     = null;
  _currentSessionToken = null;
  _currentDeviceId     = null;

  if (userType === 'parent') {
    await db.deregisterParentDeviceToken(token);
  } else {
    if (userId && sessToken && devId) {
      await db.deregisterChildDeviceToken(token, userId, sessToken, devId);
    }
  }
}

export function getCurrentPushToken(): string | null {
  return _currentPushToken;
}
