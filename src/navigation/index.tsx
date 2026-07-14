import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { useApp } from '../context/AppContext';
import { db } from '../lib/database';
import { ChildTabNavigator } from './ChildTabNavigator';
import { ParentTabNavigator } from './ParentTabNavigator';
import { CarouselScreen } from '../screens/onboarding/CarouselScreen';
import { EmailScreen } from '../screens/onboarding/EmailScreen';
import { PasswordScreen } from '../screens/onboarding/PasswordScreen';
import { MobileScreen } from '../screens/onboarding/MobileScreen';
import { NotificationsScreen } from '../screens/onboarding/NotificationsScreen';
import { DisplayNameScreen } from '../screens/onboarding/DisplayNameScreen';
import { IdentityScreen } from '../screens/onboarding/IdentityScreen';
import { AddressScreen } from '../screens/onboarding/AddressScreen';
import { HomeAddressScreen } from '../screens/onboarding/HomeAddressScreen';
import { VerifyingScreen } from '../screens/onboarding/VerifyingScreen';
import { ChildDetailsScreen } from '../screens/onboarding/ChildDetailsScreen';
import { SafetyPoolSetupScreen } from '../screens/onboarding/SafetyPoolSetupScreen';
import { SelectAccountScreen } from '../screens/auth/SelectAccountScreen';
import { WhoIsLoggingInScreen } from '../screens/auth/WhoIsLoggingInScreen';
import { GetAppScreen } from '../screens/auth/GetAppScreen';
import { ChildLoginScreen } from '../screens/auth/ChildLoginScreen';
import { ParentPasscodeScreen } from '../screens/auth/ParentPasscodeScreen';
import { ParentEmailLoginScreen } from '../screens/auth/ParentEmailLoginScreen';
import { TrustStatsScreen } from '../screens/child/TrustStatsScreen';
import { RequestMoneyScreen } from '../screens/child/RequestMoneyScreen';
import { AvatarPickerScreen } from '../screens/child/AvatarPickerScreen';
import { LeaderboardScreen } from '../screens/child/LeaderboardScreen';
import { ActivityFeedScreen } from '../screens/child/ActivityFeedScreen';
import { AddFriendsScreen } from '../screens/child/AddFriendsScreen';
import { ChildSettingsScreen } from '../screens/child/ChildSettingsScreen';
import { ProfileScreen } from '../screens/child/ProfileScreen';
import { PaymentMethodsScreen } from '../screens/parent/PaymentMethodsScreen';
import { ParentAccountDetailsScreen } from '../screens/parent/ParentAccountDetailsScreen';
import { ParentNotificationsScreen } from '../screens/parent/ParentNotificationsScreen';
import { RateTruzoScreen } from '../screens/shared/RateTruzoScreen';
import { BiometricSetupScreen } from '../screens/auth/BiometricSetupScreen';
import { BiometricLoginScreen } from '../screens/auth/BiometricLoginScreen';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator = () => {
  const { setChild, setChildId, setParent, setIsChildLoggedIn, setCircle, setPendingRequests } = useApp();
  const [navReady, setNavReady] = useState(false);

  // Dev-only auto-login: reads credentials from EXPO_PUBLIC_DEV_CHILD_USERNAME /
  // EXPO_PUBLIC_DEV_CHILD_PASSWORD in your local .env.local (gitignored).
  // __DEV__ is false in all production builds — Metro removes this entire block.
  useEffect(() => {
    if (!__DEV__ || !navReady) return;
    const username = process.env.EXPO_PUBLIC_DEV_CHILD_USERNAME;
    const password = process.env.EXPO_PUBLIC_DEV_CHILD_PASSWORD;
    if (!username || !password) return;
    db.loginChild(username, password).then(result => {
      if (!result) return;
      const { child: row, parent: par } = result;
      setChild(c => ({
        ...c,
        displayName:   row.display_name,
        username:      row.username,
        password:      row.password,
        avatarEmoji:     row.avatar_emoji,
        profileImageUrl: row.profile_image_url ?? undefined,
        trustScore:    row.trust_score,
        balance:       row.wallet_balance,
        loanedOut:     row.loaned_out,
        borrowed:      row.borrowed,
        streak:        row.streak,
        repaid:        row.repaid,
        missed:        row.missed,
        totalBorrowed: row.total_borrowed,
        totalLent:     row.total_lent,
        timesBorrowed: row.times_borrowed ?? 0,
        timesLent:     row.times_lent ?? 0,
        points:        row.points,
        age:           row.age,
        mobile:        row.mobile ?? '',
      }));
      if (par) {
        setParent(prev => ({
          ...prev,
          firstName:              par.first_name ?? '',
          lastName:               par.last_name ?? '',
          displayName:            par.display_name || par.first_name || '',
          mobile:                 par.mobile ?? '',
          address:                par.address ?? '',
          safetyPoolLimit:        par.safety_pool_limit ?? 0,
          safetyPoolUsed:         par.safety_pool_used ?? 0,
          weeklyAllowance:        par.weekly_allowance ?? 0,
          allowanceFrequency:     par.allowance_frequency ?? 'weekly',
          allowanceNextPayment:   par.allowance_next_payment ?? '',
          allowanceActive:        par.allowance_active ?? false,
          passcode:               '',
          passcodeHash:    par.passcode_hash    ?? prev.passcodeHash,
          passcodeCreated: par.passcode_created ?? prev.passcodeCreated,
          marketingNotifications: par.marketing_notifications ?? false,
          profileImageUrl:        par.profile_image_url ?? undefined,
        }));
      }
      setChildId(row.id);
      db.getCircle(row.id).then(members => {
        setCircle(members.map(m => ({
          id: m.id, displayName: m.display_name,
          username: m.username, avatarEmoji: m.avatar_emoji, trustScore: m.trust_score,
          profileImageUrl: m.avatar_url ?? undefined,
        })));
      }).catch(() => {});
      db.getPendingRequests(row.id).then(requests => {
        setPendingRequests(requests.map(r => ({
          requestId: r.request_id, id: r.id, displayName: r.display_name,
          username: r.username, avatarEmoji: r.avatar_emoji,
          trustScore: r.trust_score, createdAt: r.created_at,
          profileImageUrl: r.avatar_url ?? undefined,
        })));
      }).catch(() => {});
      setIsChildLoggedIn(true);
      navigationRef.navigate('ChildTabs' as never);
    }).catch(() => {});
  }, [navReady]);

  return (
    <NavigationContainer ref={navigationRef} onReady={() => setNavReady(true)}>
      <Stack.Navigator
        initialRouteName="Carousel"
        screenOptions={{
          headerShown: false,
          animation: Platform.OS === 'web' ? 'none' : 'slide_from_right',
        }}
      >
        <Stack.Screen name="Carousel" component={CarouselScreen} />
        <Stack.Screen name="Email" component={EmailScreen} />
        <Stack.Screen name="Password" component={PasswordScreen} />
        <Stack.Screen name="Mobile" component={MobileScreen} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
        <Stack.Screen name="DisplayName" component={DisplayNameScreen} />
        <Stack.Screen name="Identity" component={IdentityScreen} />
        <Stack.Screen name="Address" component={AddressScreen} />
        <Stack.Screen name="HomeAddress" component={HomeAddressScreen} />
        <Stack.Screen name="Verifying" component={VerifyingScreen} />
        <Stack.Screen name="ChildDetails" component={ChildDetailsScreen} />
        <Stack.Screen name="SafetyPool" component={SafetyPoolSetupScreen} />
        <Stack.Screen name="SelectAccount" component={SelectAccountScreen} />
        <Stack.Screen name="WhoIsLoggingIn" component={WhoIsLoggingInScreen} />
        <Stack.Screen name="GetApp" component={GetAppScreen} options={{ animation: Platform.OS === 'web' ? 'none' : 'slide_from_bottom' }} />
        <Stack.Screen name="ParentEmailLogin" component={ParentEmailLoginScreen} />
        <Stack.Screen name="ChildLogin" component={ChildLoginScreen} />
        <Stack.Screen name="ParentPasscode" component={ParentPasscodeScreen} />
        <Stack.Screen name="ParentTabs" component={ParentTabNavigator} />
        <Stack.Screen name="ChildTabs" component={ChildTabNavigator} />
        <Stack.Screen name="TrustStats" component={TrustStatsScreen} options={{ animation: Platform.OS === 'web' ? 'none' : 'slide_from_bottom' }} />
        <Stack.Screen name="RequestMoney" component={RequestMoneyScreen} options={{ animation: Platform.OS === 'web' ? 'none' : 'slide_from_bottom' }} />
        <Stack.Screen name="AvatarPicker" component={AvatarPickerScreen} options={{ animation: Platform.OS === 'web' ? 'none' : 'slide_from_bottom' }} />
        <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
        <Stack.Screen name="ActivityFeed" component={ActivityFeedScreen} />
        <Stack.Screen name="AddFriends" component={AddFriendsScreen} options={{ animation: Platform.OS === 'web' ? 'none' : 'slide_from_bottom' }} />
        <Stack.Screen name="ChildSettings" component={ChildSettingsScreen} />
        <Stack.Screen name="ChildProfile" component={ProfileScreen} />
        <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} />
        <Stack.Screen name="ParentAccountDetails" component={ParentAccountDetailsScreen} />
        <Stack.Screen name="ParentNotifications" component={ParentNotificationsScreen} />
        <Stack.Screen name="RateTruzo" component={RateTruzoScreen} options={{ animation: Platform.OS === 'web' ? 'none' : 'fade' }} />
        <Stack.Screen name="BiometricSetup" component={BiometricSetupScreen} options={{ animation: Platform.OS === 'web' ? 'none' : 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="BiometricLogin" component={BiometricLoginScreen} options={{ animation: Platform.OS === 'web' ? 'none' : 'fade', gestureEnabled: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
