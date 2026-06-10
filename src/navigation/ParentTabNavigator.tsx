import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { ParentHomeScreen } from '../screens/parent/ParentHomeScreen';
import { ParentAccountScreen } from '../screens/parent/ParentAccountScreen';

const Tab = createBottomTabNavigator();

export const ParentTabNavigator = () => {
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
      tabBarIcon: ({ focused, color }) => {
        if (route.name === 'ParentHome') {
          return <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />;
        }
        return <Ionicons name={focused ? 'person' : 'person-outline'} size={24} color={color} />;
      },
    })}
  >
    <Tab.Screen name="ParentHome" component={ParentHomeScreen} options={{ title: 'Home' }} />
    <Tab.Screen name="ParentAccount" component={ParentAccountScreen} options={{ title: 'Account' }} />
  </Tab.Navigator>
  );
};
