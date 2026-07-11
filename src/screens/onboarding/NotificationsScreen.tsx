import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { StepProgress } from '../../components/StepProgress';
import { BackButton } from '../../components/BackButton';
import { useApp } from '../../context/AppContext';

const PURPLE = '#4F35F3';
const BG = '#F2F2F7';

// Megaphone illustration built from Views + emoji
const MegaphoneIllustration = () => (
  <View style={il.wrap}>
    {/* Motion lines top-right */}
    <View style={[il.line, { top: '18%', right: '18%', transform: [{ rotate: '40deg' }] }]} />
    {/* Motion line right */}
    <View style={[il.line, { top: '46%', right: '8%', transform: [{ rotate: '0deg' }], width: 32 }]} />
    {/* Motion line bottom-right */}
    <View style={[il.line, { bottom: '22%', right: '16%', transform: [{ rotate: '-40deg' }] }]} />

    {/* Megaphone emoji — large centred */}
    <Text style={il.emoji}>📣</Text>
  </View>
);

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Notifications'> };

export const NotificationsScreen: React.FC<Props> = ({ navigation }) => {
  const { setParent } = useApp();

  const choose = (value: boolean) => {
    setParent(p => ({ ...p, marketingNotifications: value }));
    navigation.navigate('DisplayName');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <BackButton />
      <StepProgress current={4} total={8} />

      <View style={styles.content}>
        <Text style={styles.title}>Stay in the know</Text>
        <Text style={styles.sub}>
          With email and push notification updates about new features, offers and reminders.
        </Text>

        <View style={styles.illuArea}>
          <MegaphoneIllustration />
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.yesBtn}
          onPress={() => choose(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.yesBtnText}>Yes, send me updates</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => choose(false)}
          activeOpacity={0.6}
          style={styles.noBtn}
        >
          <Text style={styles.noBtnText}>No thanks</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: BG },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },

  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', marginBottom: 10 },
  sub:   { fontSize: 16, color: '#3C3C43', lineHeight: 23, maxWidth: 320 },

  illuArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  footer: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 8,
    backgroundColor: BG,
    gap: 16,
    alignItems: 'center',
  },
  yesBtn: {
    width: '100%',
    backgroundColor: PURPLE,
    borderRadius: 50,
    paddingVertical: 18,
    alignItems: 'center',
  },
  yesBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  noBtn:      { paddingVertical: 4 },
  noBtnText:  { color: PURPLE, fontSize: 16, fontWeight: '600' },
});

const il = StyleSheet.create({
  wrap: {
    width: 260,
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 140,
    transform: [{ scaleX: -1 }], // flip so it faces right like the design
  },
  line: {
    position: 'absolute',
    width: 24,
    height: 2.5,
    backgroundColor: '#1C1C1E',
    borderRadius: 2,
    opacity: 0.35,
  },
});
