import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { StepProgress } from '../../components/StepProgress';
import { BackButton } from '../../components/BackButton';

const PURPLE = '#4F35F3';
const BG = '#F2F2F7';

// ID card built from Views
const IDCard = () => (
  <View style={card.outer}>
    {/* Photo section */}
    <View style={card.photo}>
      <Text style={card.photoEmoji}>🧑</Text>
    </View>

    {/* Details section */}
    <View style={card.details}>
      <View style={card.line} />
      <View style={card.line} />
      <View style={[card.line, { width: '55%' }]} />

      {/* Signature row */}
      <View style={card.sigRow}>
        <Text style={card.sig}>{'John~'}</Text>
        <View style={card.stamp} />
      </View>
    </View>
  </View>
);

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Identity'> };

export const IdentityScreen: React.FC<Props> = ({ navigation }) => (
  <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <BackButton />
    <StepProgress current={6} total={8} />

    <View style={styles.content}>
      <Text style={styles.title}>{"Let's verify your\nidentity"}</Text>
      <Text style={styles.sub}>
        We need to confirm it's you to keep your parent account secure. This isn't a credit check.
      </Text>

      <View style={styles.illuArea}>
        <IDCard />
      </View>
    </View>

    <View style={styles.footer}>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => navigation.navigate('Address')}
        activeOpacity={0.85}
      >
        <Text style={styles.btnText}>Continue</Text>
      </TouchableOpacity>
    </View>
  </SafeAreaView>
);

// ─── ID Card styles ───────────────────────────────────────────────────────────
const card = StyleSheet.create({
  outer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#1C1C1E',
    overflow: 'hidden',
    width: 300,
    height: 190,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  photo: {
    width: 120,
    backgroundColor: '#C4B5F4',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 0,
    borderRightWidth: 2,
    borderRightColor: '#1C1C1E',
  },
  photoEmoji: { fontSize: 72, lineHeight: 110 },
  details: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
    gap: 10,
  },
  line: {
    height: 2.5,
    width: '85%',
    backgroundColor: '#1C1C1E',
    borderRadius: 2,
    opacity: 0.55,
  },
  sigRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  sig: {
    fontSize: 20,
    color: '#1C1C1E',
    fontStyle: 'italic',
    opacity: 0.7,
    fontWeight: '300',
  },
  stamp: {
    width: 32,
    height: 22,
    borderRadius: 4,
    backgroundColor: '#C4B5F4',
    opacity: 0.7,
  },
});

// ─── Screen styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: BG },
  content:  { flex: 1, paddingHorizontal: 24, paddingTop: 20 },
  title:    { fontSize: 32, fontWeight: '800', color: '#1C1C1E', lineHeight: 38, marginBottom: 10 },
  sub:      { fontSize: 16, color: '#3C3C43', lineHeight: 23, marginBottom: 0 },
  illuArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  footer:   { paddingHorizontal: 24, paddingBottom: 12, paddingTop: 8, backgroundColor: BG },
  btn: {
    backgroundColor: PURPLE,
    borderRadius: 50,
    paddingVertical: 18,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
