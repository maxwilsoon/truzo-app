import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { db } from './database';

// Foreground suppression: setNotificationHandler is ONLY called when the app is open.
// Background and closed-app notifications are delivered by the OS directly and are
// unaffected by this handler. Setting everything to false prevents the OS from
// showing a system alert/banner while the user is actively using the app — the
// in-app banner in AppNavigator handles foreground events instead.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: false,
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
  if (!Device.isDevice) {
    if (__DEV__) console.log('[Push] not a physical device — skipping registration');
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId;

  if (__DEV__) {
    console.log('[Push] registerPushToken —',
      'platform:', Platform.OS,
      '| userType:', userType,
      '| userId prefix:', userId.slice(0, 8),
      '| projectId present:', !!projectId,
      '| deviceId present:', !!deviceId,
      '| sessionToken present:', !!sessionToken,
    );
  }

  if (!projectId) {
    if (__DEV__) console.warn('[Push] EAS projectId missing — push notifications disabled. Check app.json extra.eas.projectId.');
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (__DEV__) console.log('[Push] existing permission status:', existing);

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (__DEV__) console.log('[Push] permission:', finalStatus);

  if (finalStatus !== 'granted') {
    if (__DEV__) console.warn('[Push] permission denied — no push token will be registered');
    return null;
  }

  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
      if (__DEV__) console.log('[Push] Android notification channel created (importance=MAX)');
    } catch (e) {
      if (__DEV__) console.warn('[Push] Android channel setup failed:', e);
    }
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;
    const tokenObtained = !!token && token.length > 0;

    if (__DEV__) {
      console.log('[Push] tokenExists:', tokenObtained,
        '| format:', token?.startsWith('ExponentPushToken[') ? 'ExponentPushToken' :
                    token?.startsWith('ExpoPushToken[')      ? 'ExpoPushToken' : 'unknown',
        '| suffix: ...', token?.slice(-4) ?? 'n/a',
      );
    }

    if (!tokenObtained) {
      if (__DEV__) console.warn('[Push] getExpoPushTokenAsync returned empty token');
      return null;
    }

    if (userType === 'parent') {
      if (__DEV__) console.log('[Push] registrationAttempt — userType: parent | platform:', Platform.OS);
      await db.registerParentDeviceToken(
        token,
        Platform.OS,
        Constants.expoConfig?.version ?? undefined,
      );
      if (__DEV__) console.log('[Push] registrationSuccess — parent token active in device_tokens');
    } else {
      if (!sessionToken || !deviceId) {
        if (__DEV__) console.warn('[Push] child registration requires sessionToken + deviceId — both must be present');
        return null;
      }
      if (__DEV__) console.log('[Push] registrationAttempt — userType: child | platform:', Platform.OS, '| userId prefix:', userId.slice(0, 8));
      await db.registerChildDeviceToken(
        userId,
        sessionToken,
        deviceId,
        token,
        Platform.OS,
        Constants.expoConfig?.version ?? undefined,
      );
      if (__DEV__) console.log('[Push] registrationSuccess — child token active in device_tokens');
    }

    _currentPushToken    = token;
    _currentUserId       = userId;
    _currentUserType     = userType;
    _currentSessionToken = sessionToken ?? null;
    _currentDeviceId     = deviceId ?? null;
    return token;
  } catch (e: any) {
    // Never treat a push registration failure as fatal — the login must succeed regardless.
    if (__DEV__) {
      console.warn('[Push] registrationError —',
        'error:', e?.message ?? String(e),
        '| code:', e?.code ?? 'n/a',
      );
    }
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

  if (__DEV__) {
    console.log('[Push] deregisterCurrentPushToken —',
      'userType:', userType,
      '| userId prefix:', userId?.slice(0, 8) ?? 'null',
      '| token suffix: ...', token.slice(-4),
    );
  }

  // Clear state before the async call so a second concurrent deregister is a no-op.
  _currentPushToken    = null;
  _currentUserId       = null;
  _currentUserType     = null;
  _currentSessionToken = null;
  _currentDeviceId     = null;

  if (userType === 'parent') {
    await db.deregisterParentDeviceToken(token);
    if (__DEV__) console.log('[Push] parent token deregistered');
  } else {
    if (userId && sessToken && devId) {
      await db.deregisterChildDeviceToken(token, userId, sessToken, devId);
      if (__DEV__) console.log('[Push] child token deregistered');
    } else {
      if (__DEV__) console.warn('[Push] deregister: missing userId/sessToken/devId — skipping RPC');
    }
  }
}

export function getCurrentPushToken(): string | null {
  return _currentPushToken;
}
