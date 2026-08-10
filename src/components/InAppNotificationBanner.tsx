import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';

type Props = {
  title: string;
  body: string;
  data?: Record<string, any>;
  onDismiss: () => void;
  onPress: (data?: Record<string, any>) => void;
};

const SLIDE_OFFSET = -110;
const DISPLAY_MS   = 3500;
const SLIDE_OUT_MS = 280;

export const InAppNotificationBanner = ({ title, body, data, onDismiss, onPress }: Props) => {
  const insets     = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SLIDE_OFFSET)).current;
  const opacity    = useRef(new Animated.Value(0)).current;
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slideOut = (callback?: () => void) => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: SLIDE_OFFSET, duration: SLIDE_OUT_MS, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 0,            duration: SLIDE_OUT_MS, useNativeDriver: true }),
    ]).start(() => callback?.());
  };

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 100, friction: 12 }),
      Animated.timing(opacity,    { toValue: 1, duration: 200,         useNativeDriver: true }),
    ]).start();

    timerRef.current = setTimeout(() => slideOut(onDismiss), DISPLAY_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const handlePress = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    slideOut(() => {
      onDismiss();
      onPress(data);
    });
  };

  return (
    <Animated.View style={[styles.container, { top: insets.top + 8, opacity, transform: [{ translateY }] }]}>
      <TouchableOpacity activeOpacity={0.9} onPress={handlePress} style={styles.inner}>
        <View style={styles.accentBar} />
        <View style={styles.textBlock}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.body}  numberOfLines={2}>{body}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position:      'absolute',
    left:          16,
    right:         16,
    zIndex:        9999,
    elevation:     10,
    borderRadius:  14,
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius:  10,
  },
  inner: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: colors.white,
    borderRadius:    14,
    overflow:        'hidden',
    paddingVertical: 12,
    paddingRight:    16,
  },
  accentBar: {
    width:           4,
    alignSelf:       'stretch',
    backgroundColor: colors.accent,
    marginHorizontal: 12,
    borderRadius:    2,
  },
  textBlock: { flex: 1 },
  title: {
    fontSize:     14,
    fontWeight:   '600',
    color:        colors.text,
    marginBottom: 2,
  },
  body: {
    fontSize:   13,
    color:      colors.textSecondary,
    lineHeight: 18,
  },
});
