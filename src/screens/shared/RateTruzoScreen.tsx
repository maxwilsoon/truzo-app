import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

const { height: SCREEN_H } = Dimensions.get('window');

const RATINGS = [
  { emoji: '😠', bg: '#D95050', label: 'Very unhappy' },
  { emoji: '😕', bg: '#F2AFAF', label: 'Unhappy' },
  { emoji: '🙂', bg: '#A8EDD0', label: 'Good' },
  { emoji: '😄', bg: '#3DB85C', label: 'Love it' },
];

export const RateTruzoScreen: React.FC = () => {
  const navigation = useNavigation();
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSelect = (index: number) => {
    setSelected(index);
    setSubmitted(true);
    setTimeout(() => navigation.goBack(), 1400);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Close button */}
      <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
        <Ionicons name="close" size={26} color="#1A1A3E" />
      </TouchableOpacity>

      {/* Content — positioned in the upper-middle */}
      <View style={styles.content}>
        {submitted ? (
          <View style={styles.thankYou}>
            <Text style={styles.thankYouEmoji}>🎉</Text>
            <Text style={styles.thankYouText}>Thanks for your feedback!</Text>
          </View>
        ) : (
          <>
            <Text style={styles.title}>Are you enjoying{'\n'}our app?</Text>
            <View style={styles.row}>
              {RATINGS.map((r, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.circle, { backgroundColor: r.bg }]}
                  onPress={() => handleSelect(i)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.faceEmoji}>{r.emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  closeBtn: {
    position: 'absolute',
    top: 56,
    right: 24,
    zIndex: 10,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    fontSize: 40,
    fontWeight: '800',
    color: '#1A1A3E',
    lineHeight: 48,
    marginBottom: 40,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'center',
  },
  circle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceEmoji: {
    fontSize: 36,
  },
  thankYou: {
    alignItems: 'center',
    gap: 12,
  },
  thankYouEmoji: { fontSize: 52 },
  thankYouText: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1A1A3E',
    lineHeight: 40,
    textAlign: 'center',
  },
});
