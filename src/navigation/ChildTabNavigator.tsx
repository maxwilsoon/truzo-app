import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { HomeScreen } from '../screens/child/HomeScreen';
import { CircleScreen } from '../screens/child/CircleScreen';
import { WalletScreen } from '../screens/child/WalletScreen';
import { ProfileScreen } from '../screens/child/ProfileScreen';

const Tab = createBottomTabNavigator();

export const ChildTabNavigator = () => {
  const insets = useSafeAreaInsets();
  return (
  <Tab.Navigator
    screenOptions={({ route }) => ({
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textLight,
      tabBarStyle: {
        backgroundColor: colors.white,
        borderTopColor: colors.border,
        borderTopWidth: 1,
        paddingBottom: insets.bottom + 6,
        paddingTop: 10,
        height: 62 + insets.bottom,
      },
      tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      tabBarIcon: ({ focused, color, size }) => {
        const icons: Record<string, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
          Home: { active: 'home', inactive: 'home-outline' },
          Circle: { active: 'ellipse-outline', inactive: 'ellipse-outline' },
          Wallet: { active: 'wallet', inactive: 'wallet-outline' },
          Profile: { active: 'person', inactive: 'person-outline' },
        };
        const icon = icons[route.name];
        return <Ionicons name={focused ? icon.active : icon.inactive} size={24} color={color} />;
      },
    })}
  >
    <Tab.Screen name="Home" component={HomeScreen} />
    <Tab.Screen name="Circle" component={CircleScreen} />
    <Tab.Screen name="Wallet" component={WalletScreen} />
    <Tab.Screen name="Profile" component={ProfileScreen} />
  </Tab.Navigator>
  );
};
