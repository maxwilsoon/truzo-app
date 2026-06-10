import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../../theme/colors';
import { useApp } from '../../context/AppContext';

interface MenuItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  last?: boolean;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, onPress, destructive, last }) => (
  <TouchableOpacity
    style={[styles.menuRow, !last && styles.menuRowBorder]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Ionicons name={icon} size={22} color={destructive ? colors.error : colors.text} style={styles.menuIcon} />
    <Text style={[styles.menuLabel, destructive && { color: colors.error }]}>{label}</Text>
    <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
  </TouchableOpacity>
);

export const ProfileScreen: React.FC = () => {
  const { child } = useApp();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Header row — name left, avatar right */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.name}>{child.displayName}</Text>
            <Text style={styles.username}>@{child.username}</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('AvatarPicker')}>
            <View style={styles.avatar}>
              <Text style={styles.avatarEmoji}>{child.avatarEmoji}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Settings — solo */}
        <View style={styles.menuGroup}>
          <MenuItem icon="settings-outline" label="Settings" onPress={() => navigation.navigate('ChildSettings')} last />
        </View>

        {/* Help, Rate, Privacy — grouped */}
        <View style={styles.menuGroup}>
          <MenuItem icon="help-circle-outline" label="Help Centre" onPress={() => {}} />
          <MenuItem icon="star-outline" label="Rate Truzo" onPress={() => navigation.navigate('RateTruzo')} />
          <MenuItem icon="shield-outline" label="Privacy Policy" onPress={() => {}} last />
        </View>

        {/* Log Out — solo */}
        <View style={styles.menuGroup}>
          <MenuItem
            icon="log-out-outline"
            label="Log Out"
            last
            onPress={() =>
              Alert.alert('Log out', 'Are you sure?', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Log out',
                  style: 'destructive',
                  onPress: () => navigation.navigate('WhoIsLoggingIn'),
                },
              ])
            }
          />
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0EFF8' },
  scroll: { paddingHorizontal: 24, paddingTop: 32, gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: { flex: 1 },
  name: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1A1A3E',
    letterSpacing: -0.5,
  },
  username: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 2,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 32,
  },
  menuGroup: {
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  menuRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  menuIcon: {
    marginRight: 16,
  },
  menuLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A3E',
  },
});
