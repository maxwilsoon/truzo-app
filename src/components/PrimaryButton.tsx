import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { colors } from '../theme/colors';

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  style?: ViewStyle;
}

export const PrimaryButton: React.FC<Props> = ({
  label, onPress, disabled, loading, variant = 'primary', style,
}) => (
  <TouchableOpacity
    style={[
      styles.base,
      variant === 'primary' && styles.primary,
      variant === 'secondary' && styles.secondary,
      variant === 'ghost' && styles.ghost,
      (disabled || loading) && styles.disabled,
      style,
    ]}
    onPress={onPress}
    disabled={disabled || loading}
    activeOpacity={0.8}
  >
    {loading
      ? <ActivityIndicator color={variant === 'primary' ? colors.white : colors.primary} />
      : <Text style={[styles.label, variant !== 'primary' && styles.labelAlt]}>{label}</Text>
    }
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  base: {
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.primaryLight,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: 0.2,
  },
  labelAlt: {
    color: colors.primary,
  },
});
