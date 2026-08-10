import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, AppState } from 'react-native';
import Constants from 'expo-constants';
import { db } from './database';

// setNotificationHandler is called when the app receives a push notification.
// On iOS it is only called in the foreground (the OS delivers directly when
// backgrounded). On Android the JS process stays alive in the background, so
// the handler fires even when the app is minimised — we must return
// shouldShowAlert:true in that state so the system banner appears.
//
// Rule: suppress the system notification only when the app is active (foreground);
// let the OS show it in all other states. The in-app banner (AppNavigator) handles
// the foreground case instead.
Notifications.setNotificationHandler({
  handleNotification: async () => {
    const isForeground = AppState.currentState === 'active';
    return {
      shouldShowAlert: !isForeground,
      shouldPlaySound: !isForeground,
      shouldSetBadge: false,
      shouldShowBanner: !isForeground,
      shouldShowList:  !isForeground,
    };
  },
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

  // Stage 1: obtain Expo push token from Expo's service.
  let token: string;
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    token = tokenData.data;

    if (__DEV__) {
      console.log('[Push] tokenExists:', !!token && token.length > 0,
        '| format:', token?.startsWith('ExponentPushToken[') ? 'ExponentPushToken' :
                    token?.startsWith('ExpoPushToken[')      ? 'ExpoPushToken' : 'unknown',
        '| suffix: ...', token?.slice(-4) ?? 'n/a',
      );
    }

    if (!token || token.length === 0) {
      if (__DEV__) console.warn('[Push] getExpoPushTokenAsync returned empty token');
      return null;
    }
  } catch (e: any) {
    // Token fetch fails when: EAS project not found, permission revoked, network error.
    if (__DEV__) console.warn('[Push] getExpoPushTokenAsync FAILED —', e?.message ?? String(e), '| code:', e?.code ?? 'n/a');
    return null;
  }

  // Stage 2: register the token in the DB.
  try {
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
  } catch (e: any) {
    // DB registration failure — never block the login flow, but log clearly.
    if (__DEV__) console.warn('[Push] DB registrationError —', e?.message ?? String(e), '| code:', e?.code ?? 'n/a');
    return null;
  }

  _currentPushToken    = token;
  _currentUserId       = userId;
  _currentUserType     = userType;
  _currentSessionToken = sessionToken ?? null;
  _currentDeviceId     = deviceId ?? null;
  return token;
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
