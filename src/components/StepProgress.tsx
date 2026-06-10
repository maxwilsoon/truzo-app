import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

interface Props {
  current: number;
  total: number;
}

export const StepProgress: React.FC<Props> = ({ current, total }) => (
  <View style={styles.container}>
    {Array.from({ length: total }).map((_, i) => (
      <View
        key={i}
        style={[
          styles.bar,
          i < current ? styles.active : styles.inactive,
          i === current - 1 && styles.current,
        ]}
      />
    ))}
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
  },
  bar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  active: {
    backgroundColor: colors.primary,
  },
  current: {
    backgroundColor: colors.primary,
  },
  inactive: {
    backgroundColor: colors.border,
  },
});
