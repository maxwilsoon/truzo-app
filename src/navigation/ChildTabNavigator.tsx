import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, GestureResponderEvent } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { HomeScreen } from '../screens/child/HomeScreen';
import { CircleScreen } from '../screens/child/CircleScreen';
import { RequestMoneyScreen } from '../screens/child/RequestMoneyScreen';
import { WalletScreen } from '../screens/child/WalletScreen';
import { RewardsScreen } from '../screens/child/RewardsScreen';

const Tab = createBottomTabNavigator();
type IoniconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<string, { active: IoniconName; inactive: IoniconName }> = {
  Home:    { active: 'home',    inactive: 'home-outline' },
  Circle:  { active: 'people', inactive: 'people-outline' },
  Wallet:  { active: 'wallet', inactive: 'wallet-outline' },
  Rewards: { active: 'star',   inactive: 'star-outline' },
};

// Custom elevated pill button for the Borrow centre tab
const BorrowTabButton: React.FC<{ onPress?: ((e: GestureResponderEvent) => void) | null; accessibilityState?: { selected?: boolean } }> = ({ onPress }) => (
  <TouchableOpacity style={tb.borrowWrap} onPress={onPress ?? undefined} activeOpacity={0.85}>
    <View style={tb.borrowPill}>
      <Ionicons name="cash-outline" size={24} color="#FFFFFF" />
    </View>
    <Text style={tb.borrowLabel}>Borrow</Text>
  </TouchableOpacity>
);

const tb = StyleSheet.create({
  borrowWrap:  { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 },
  borrowPill:  { width: 60, height: 44, borderRadius: 22, backgroundColor: '#3D7A45', alignItems: 'center', justifyContent: 'center', marginBottom: 3, shadowColor: '#3D7A45', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 8 },
  borrowLabel: { fontSize: 11, fontWeight: '600', color: colors.textLight },
});

export const ChildTabNavigator = () => {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#2E7D32',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#F3F4F6',
          borderTopWidth: 1,
          paddingBottom: insets.bottom + 4,
          paddingTop: 8,
          height: 62 + insets.bottom,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ focused, color }) => {
          const icon = TAB_ICONS[route.name];
          if (!icon) return null;
          return <Ionicons name={focused ? icon.active : icon.inactive} size={24} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Circle" component={CircleScreen} />
      <Tab.Screen
        name="Borrow"
        component={RequestMoneyScreen}
        options={{
          unmountOnBlur: true,
          tabBarLabel: () => null,
          tabBarIcon: () => null,
          tabBarButton: (props) => <BorrowTabButton onPress={props.onPress} />,
        }}
      />
      <Tab.Screen name="Wallet" component={WalletScreen} />
      <Tab.Screen name="Rewards" component={RewardsScreen} />
    </Tab.Navigator>
  );
};
