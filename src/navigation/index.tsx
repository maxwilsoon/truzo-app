import React from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
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
import { WhoIsLoggingInScreen } from '../screens/auth/WhoIsLoggingInScreen';
import { GetAppScreen } from '../screens/auth/GetAppScreen';
import { ChildLoginScreen } from '../screens/auth/ChildLoginScreen';
import { ParentPasscodeScreen } from '../screens/auth/ParentPasscodeScreen';
import { TrustStatsScreen } from '../screens/child/TrustStatsScreen';
import { RequestMoneyScreen } from '../screens/child/RequestMoneyScreen';
import { AvatarPickerScreen } from '../screens/child/AvatarPickerScreen';
import { LeaderboardScreen } from '../screens/child/LeaderboardScreen';
import { ActivityFeedScreen } from '../screens/child/ActivityFeedScreen';
import { AddFriendsScreen } from '../screens/child/AddFriendsScreen';
import { ChildSettingsScreen } from '../screens/child/ChildSettingsScreen';
import { PaymentMethodsScreen } from '../screens/parent/PaymentMethodsScreen';
import { ParentAccountDetailsScreen } from '../screens/parent/ParentAccountDetailsScreen';
import { RateTruzoScreen } from '../screens/shared/RateTruzoScreen';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator = () => {
  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        initialRouteName="Carousel"
        screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
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
        <Stack.Screen name="WhoIsLoggingIn" component={WhoIsLoggingInScreen} />
        <Stack.Screen name="GetApp" component={GetAppScreen} options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="ChildLogin" component={ChildLoginScreen} />
        <Stack.Screen name="ParentPasscode" component={ParentPasscodeScreen} />
        <Stack.Screen name="ParentTabs" component={ParentTabNavigator} />
        <Stack.Screen name="ChildTabs" component={ChildTabNavigator} />
        <Stack.Screen name="TrustStats" component={TrustStatsScreen} options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="RequestMoney" component={RequestMoneyScreen} options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="AvatarPicker" component={AvatarPickerScreen} options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
        <Stack.Screen name="ActivityFeed" component={ActivityFeedScreen} />
        <Stack.Screen name="AddFriends" component={AddFriendsScreen} options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="ChildSettings" component={ChildSettingsScreen} />
        <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} />
        <Stack.Screen name="ParentAccountDetails" component={ParentAccountDetailsScreen} />
        <Stack.Screen name="RateTruzo" component={RateTruzoScreen} options={{ animation: 'fade' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
