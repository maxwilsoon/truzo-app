import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../navigation/types';
import { useApp } from '../../context/AppContext';
import { hasBiometricSession } from '../../lib/biometrics';

const CIRCLE_BG = '#C4B5F4';
const DARK = '#1A1A3E';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'WhoIsLoggingIn'>;
  route: RouteProp<RootStackParamList, 'WhoIsLoggingIn'>;
};

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

export const WhoIsLoggingInScreen: React.FC<Props> = ({ navigation, route }) => {
  const { parent, child } = useApp();
  const newAccount = route.params?.newAccount ?? false;
  const childFirstName = (child.displayName || 'Child').split(' ')[0];

  const goParent = () => {
    if (newAccount) {
      // Arrived straight from onboarding — always create a fresh PIN
      navigation.navigate('ParentPasscode', { mode: 'create' });
    } else if (!parent.email) {
      // No cached session — full email + password login
      navigation.navigate('ParentEmailLogin');
    } else {
      // Parent has an account — they set up a PIN during onboarding.
      // Always go to 'enter' mode; PasscodeScreen recovers the hash from DB if context is stale.
      navigation.navigate('ParentPasscode', { mode: 'enter' });
    }
  };

  const goChild = async () => {
    if (Platform.OS !== 'web') {
      const hasBio = await hasBiometricSession();
      if (hasBio) {
        navigation.navigate('BiometricLogin');
        return;
      }
    }
    navigation.navigate('ChildLogin');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Text style={styles.title}>Who's logging in?</Text>

        {/* Top row: Parent + Child */}
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.item} onPress={goParent} activeOpacity={0.8}>
            <View style={styles.circle}>
              <Text style={styles.initials}>{getInitials(parent.displayName || 'Parent')}</Text>
            </View>
            <Text style={styles.name}>{parent.displayName || 'Parent'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.item} onPress={goChild} activeOpacity={0.8}>
            {child.profileImageUrl ? (
              <View style={styles.circlePhoto}>
                <Image source={{ uri: child.profileImageUrl }} style={styles.photo} resizeMode="cover" />
              </View>
            ) : (
              <View style={styles.circle}>
                <Text style={styles.initials}>{childFirstName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <Text style={styles.name}>{childFirstName}</Text>
          </TouchableOpacity>
        </View>

        {/* Other — centred below */}
        <TouchableOpacity style={styles.item} onPress={() => navigation.navigate('Carousel')} activeOpacity={0.8}>
          <View style={styles.circle}>
            <Text style={styles.plus}>+</Text>
          </View>
          <Text style={styles.name}>Other</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom banner */}
      <View style={styles.banner}>
        <View style={styles.bannerIconWrap}>
          <Ionicons name="phone-portrait-outline" size={24} color={DARK} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerBold}>Do your kids have their own device?</Text>
          <Text style={styles.bannerSub}>
            Get the app for them.{' '}
            <Text style={styles.bannerLink}>Here's how</Text>
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },

  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    paddingHorizontal: 24,
  },

  title: {
    fontSize: 32,
    fontWeight: '800',
    color: DARK,
    textAlign: 'center',
    marginBottom: 8,
  },

  topRow: {
    flexDirection: 'row',
    gap: 24,
    justifyContent: 'center',
  },

  item: {
    alignItems: 'center',
    gap: 14,
  },

  circle: {
    width: 115,
    height: 115,
    borderRadius: 58,
    backgroundColor: CIRCLE_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },

  circlePhoto: {
    width: 115,
    height: 115,
    borderRadius: 58,
    overflow: 'hidden',
  },

  photo: {
    width: 115,
    height: 115,
  },

  initials: {
    fontSize: 40,
    fontWeight: '600',
    color: DARK,
    letterSpacing: -0.5,
  },

  plus: {
    fontSize: 46,
    fontWeight: '300',
    color: DARK,
    lineHeight: 52,
  },

  name: {
    fontSize: 16,
    fontWeight: '400',
    color: DARK,
    textAlign: 'center',
  },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    margin: 16,
    backgroundColor: '#F0EFF8',
    borderRadius: 18,
    padding: 18,
  },

  bannerIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#E4E0F8',
    alignItems: 'center',
    justifyContent: 'center',
  },

  bannerBold: {
    fontSize: 14,
    fontWeight: '700',
    color: DARK,
    marginBottom: 3,
  },

  bannerSub: {
    fontSize: 13,
    color: '#6B7280',
  },

  bannerLink: {
    color: '#4F35F3',
    fontWeight: '700',
  },
});
