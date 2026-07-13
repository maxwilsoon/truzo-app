import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useApp } from '../../context/AppContext';

const GREEN = '#C8E8CB';
const GREEN_DARK = '#3D7A45';
const BG = '#E8F5E9';

// Simple hand-drawn QR code using a pixel grid
const CELL = 7;
const GRID = [
  [1,1,1,1,1,1,1,0,0,1,0],
  [1,0,0,0,0,0,1,0,1,0,1],
  [1,0,1,1,1,0,1,0,0,0,0],
  [1,0,1,1,1,0,1,0,1,0,1],
  [1,0,1,1,1,0,1,0,0,1,0],
  [1,0,0,0,0,0,1,0,1,0,0],
  [1,1,1,1,1,1,1,0,0,1,1],
  [0,0,0,1,0,0,0,1,0,0,1],
  [1,1,0,0,1,1,0,0,1,1,0],
  [0,1,1,0,0,1,1,0,0,1,0],
  [1,0,0,1,1,0,0,1,1,0,1],
];

const QRCode = () => (
  <View style={qr.wrap}>
    {GRID.map((row, r) => (
      <View key={r} style={qr.row}>
        {row.map((cell, c) => (
          <View key={c} style={[qr.cell, cell ? qr.filled : qr.empty]} />
        ))}
      </View>
    ))}
  </View>
);

const steps = [
  {
    n: '1',
    text: 'Scan the QR code and download the app to their device',
    showQR: true,
  },
  {
    n: '2',
    text: "Get their login details - they'll need their username and PIN to log in",
    showQR: false,
  },
  {
    n: '3',
    text: 'Log in and watch their money skills start to grow',
    showQR: false,
  },
];

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'GetApp'> };

export const GetAppScreen: React.FC<Props> = ({ navigation }) => {
  const { child } = useApp();
  const childName = child.displayName.split(' ')[0];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* X close button */}
      <TouchableOpacity
        style={styles.close}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Ionicons name="close" size={26} color="#1A1A3E" />
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Get the app for {childName}</Text>
        <Text style={styles.sub}>
          {childName} can track their spending, start saving, learn &amp; earn rewards, and more.
        </Text>

        <View style={styles.steps}>
          {steps.map(step => (
            <View key={step.n} style={styles.stepRow}>
              <View style={styles.stepLeft}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{step.n}</Text>
                </View>
                <Text style={styles.stepText}>{step.text}</Text>
              </View>
              {step.showQR && (
                <View style={styles.qrBox}>
                  <QRCode />
                </View>
              )}
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.btn} activeOpacity={0.85} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Get login details</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

// ── QR styles ─────────────────────────────────────────────────────────────────
const qr = StyleSheet.create({
  wrap:   { backgroundColor: '#fff', padding: 6, borderRadius: 8 },
  row:    { flexDirection: 'row' },
  cell:   { width: CELL, height: CELL },
  filled: { backgroundColor: '#1A1A3E' },
  empty:  { backgroundColor: 'transparent' },
});

// ── Screen styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: BG },
  close:  { alignSelf: 'flex-end', padding: 20, paddingBottom: 4 },
  scroll: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 24 },

  title: { fontSize: 30, fontWeight: '800', color: '#1A1A3E', marginBottom: 12, lineHeight: 36 },
  sub:   { fontSize: 16, color: '#3C3C43', lineHeight: 24, marginBottom: 36 },

  steps:   { gap: 32 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  stepLeft: { flex: 1, flexDirection: 'row', gap: 14, alignItems: 'flex-start' },

  badge: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#C8E8CB',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 2,
  },
  badgeText: { fontSize: 15, fontWeight: '700', color: '#1A1A3E' },

  stepText: { flex: 1, fontSize: 16, color: '#1A1A3E', lineHeight: 24 },

  qrBox: {
    flexShrink: 0,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D1D1D6',
    overflow: 'hidden',
    backgroundColor: '#fff',
  },

  footer: { paddingHorizontal: 24, paddingBottom: 16, paddingTop: 8, backgroundColor: BG },
  btn: {
    backgroundColor: GREEN,
    borderRadius: 50,
    paddingVertical: 18,
    alignItems: 'center',
  },
  btnText: { color: '#1F2937', fontSize: 17, fontWeight: '700' },
});
