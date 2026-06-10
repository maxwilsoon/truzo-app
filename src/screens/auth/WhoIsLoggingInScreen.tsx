import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useApp } from '../../context/AppContext';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'WhoIsLoggingIn'> };

const getInitials = (name: string) =>
  name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

export const WhoIsLoggingInScreen: React.FC<Props> = ({ navigation }) => {
  const { child, parent } = useApp();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Text style={styles.title}>Who's logging in?</Text>

        <View style={styles.row}>
          <TouchableOpacity
            style={styles.profileItem}
            onPress={() => navigation.navigate('ParentPasscode', { mode: parent.passcode ? 'enter' : 'create' })}
            activeOpacity={0.75}
          >
            <View style={styles.avatar}>
              <Text style={styles.initials}>{getInitials(parent.displayName)}</Text>
            </View>
            <Text style={styles.name}>{parent.displayName}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.profileItem} onPress={() => navigation.navigate('ChildLogin')} activeOpacity={0.75}>
            <View style={styles.avatar}>
              <Text style={styles.initials}>{getInitials(child.displayName)}</Text>
            </View>
            <Text style={styles.name}>{child.displayName}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.profileItem} onPress={() => navigation.navigate('Carousel')} activeOpacity={0.75}>
          <View style={styles.avatar}>
            <Text style={styles.plus}>+</Text>
          </View>
          <Text style={styles.name}>Other</Text>
        </TouchableOpacity>
      </View>

      {/* Kids device banner */}
      <TouchableOpacity
        style={styles.banner}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('GetApp')}
      >
        <Ionicons name="phone-portrait-outline" size={28} color="#1A1A3E" style={styles.bannerIcon} />
        <View style={styles.bannerText}>
          <Text style={styles.bannerTitle}>Do your kids have their own device?</Text>
          <Text style={styles.bannerSub}>
            Get the app for them.{' '}
            <Text style={styles.bannerLink}>Here's how</Text>
          </Text>
        </View>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const AVATAR = 120;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1A1A3E',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: 36,
  },
  profileItem: {
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: '#C4B5F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontSize: 36,
    fontWeight: '700',
    color: '#1A1A3E',
  },
  plus: {
    fontSize: 44,
    fontWeight: '300',
    color: '#1A1A3E',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A3E',
  },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8E3FF',
    marginHorizontal: 20,
    marginBottom: 24,
    borderRadius: 18,
    padding: 18,
    gap: 14,
  },
  bannerIcon:  { flexShrink: 0 },
  bannerText:  { flex: 1 },
  bannerTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A3E', marginBottom: 3 },
  bannerSub:   { fontSize: 14, color: '#3C3C43' },
  bannerLink:  { color: '#4F35F3', fontWeight: '600' },
});
